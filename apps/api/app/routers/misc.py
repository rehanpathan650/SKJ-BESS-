"""Notifications, push tokens, dashboards/reports, commercial settings."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app import audit
from app.db import get_db
from app.deps import Principal, active_user, any_user, require
from app.models import Bill, Calculation, Customer, Notification, Project, Proposal, PushToken
from app.services import access, cache
from app.services.app_settings import get_commercial, set_commercial

router = APIRouter(tags=["misc"])


# ---------- notifications ----------

@router.get("/notifications")
def list_notifications(unread: bool = False, p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    stmt = select(Notification).where(Notification.user_id == p.id)
    if unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = db.execute(stmt.order_by(Notification.created_at.desc()).limit(100)).scalars()
    unread_count = db.execute(select(func.count()).select_from(Notification).where(
        Notification.user_id == p.id, Notification.read_at.is_(None))).scalar()
    return {"unread": unread_count, "items": [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "read": n.read_at is not None,
         "created_at": n.created_at} for n in rows]}


@router.post("/notifications/{nid}/read")
def mark_read(nid: str, p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.id == nid, Notification.user_id == p.id)
               .values(read_at=datetime.now(timezone.utc)))
    db.commit()
    return {"detail": "ok"}


@router.post("/notifications/read-all")
def mark_all_read(p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == p.id, Notification.read_at.is_(None))
               .values(read_at=datetime.now(timezone.utc)))
    db.commit()
    return {"detail": "ok"}


class PushIn(BaseModel):
    token: str = Field(min_length=10, max_length=200, pattern=r"^ExponentPushToken\[[A-Za-z0-9_\-]+\]$")


@router.post("/push-tokens")
def register_push(data: PushIn, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    existing = db.execute(select(PushToken).where(PushToken.token == data.token)).scalar_one_or_none()
    if existing:
        existing.user_id = p.id
    else:
        db.add(PushToken(user_id=p.id, token=data.token))
    db.commit()
    return {"detail": "registered"}


@router.delete("/push-tokens")
def unregister_push(data: PushIn, p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    t = db.execute(select(PushToken).where(PushToken.token == data.token, PushToken.user_id == p.id)).scalar_one_or_none()
    if t:
        db.delete(t)
        db.commit()
    return {"detail": "removed"}


# ---------- dashboard ----------

ACTIVE_STAGES = ("lead", "site_survey", "technical_validation", "proposal", "negotiation", "installation")
WON_STAGES = ("won", "installation", "commissioned")


def _dashboard(db: Session, p: Principal) -> dict:
    """All counts and sums are done by the database (no per-row loading), so cost stays flat as data grows."""
    cust_ids = access.visible_customer_ids(p)
    proj_scope = select(Project.id).where(Project.customer_id.in_(cust_ids)).scalar_subquery()

    by_stage = {s: n for s, n in db.execute(
        select(Project.stage, func.count()).where(Project.customer_id.in_(cust_ids)).group_by(Project.stage)).all()}
    active = db.execute(select(func.count(), func.coalesce(func.sum(Project.estimated_value_inr), 0),
                               func.coalesce(func.sum(Project.target_capacity_kwh), 0))
                        .where(Project.customer_id.in_(cust_ids), Project.stage.in_(ACTIVE_STAGES))).one()
    won = sum(by_stage.get(s, 0) for s in WON_STAGES)
    lost = by_stage.get("lost", 0)
    prop_status: dict[str, int] = {}
    if p.has("proposals.view"):
        prop_status = {s: n for s, n in db.execute(
            select(Proposal.status, func.count()).where(Proposal.project_id.in_(proj_scope)).group_by(Proposal.status)).all()}
    pending_validation = db.execute(select(func.count()).select_from(Calculation).where(
        Calculation.project_id.in_(proj_scope), Calculation.validation_status == "pending")).scalar()
    bills_to_review = db.execute(select(func.count()).select_from(Bill).where(
        Bill.customer_id.in_(cust_ids), Bill.status == "needs_review")).scalar()

    mine = db.execute(
        select(Project.id, Project.name, Customer.name, Project.stage, Project.progress_pct)
        .join(Customer, Customer.id == Project.customer_id)
        .where(Project.customer_id.in_(cust_ids), or_(Project.engineer_id == p.id, Project.owner_id == p.id))
        .order_by(Project.updated_at.desc()).limit(10)).all()
    opps = db.execute(
        select(Project.id, Project.name, Customer.name, Project.stage, Project.estimated_value_inr, Project.target_capacity_kwh)
        .join(Customer, Customer.id == Project.customer_id)
        .where(Project.customer_id.in_(cust_ids), Project.stage.in_(ACTIVE_STAGES))
        .order_by(Project.estimated_value_inr.desc()).limit(10)).all()

    # Pipeline created per month (last 12 months) for the trend chart.
    # All 12 months are present (zeros included) so the chart shows quiet months instead of hiding them.
    today = datetime.now(timezone.utc)
    monthly: dict[str, dict] = {}
    for back in range(11, -1, -1):
        y, m = divmod(today.year * 12 + today.month - 1 - back, 12)
        key = f"{y:04d}-{m + 1:02d}"
        monthly[key] = {"month": key, "created_value_inr": 0.0, "won_value_inr": 0.0, "projects": 0}
    since = datetime(int(min(monthly)[:4]), int(min(monthly)[5:]), 1, tzinfo=timezone.utc)
    for created, stage, value in db.execute(
            select(Project.created_at, Project.stage, Project.estimated_value_inr)
            .where(Project.customer_id.in_(cust_ids), Project.created_at >= since)).all():
        m = monthly.get(created.strftime("%Y-%m"))
        if m is None:
            continue
        m["projects"] += 1
        m["created_value_inr"] += value or 0
        if stage in WON_STAGES:
            m["won_value_inr"] += value or 0

    out = {
        "kpis": {
            "customers": db.execute(select(func.count()).select_from(Customer).where(Customer.id.in_(cust_ids))).scalar(),
            "active_projects": active[0],
            "pipeline_value_inr": round(active[1]),
            "pipeline_capacity_kwh": round(active[2]),
            "won_projects": won,
            "win_rate_pct": round(won / (won + lost) * 100, 1) if (won + lost) else None,
            "proposals_pending_approval": prop_status.get("pending_approval", 0),
            "pending_technical_validations": pending_validation,
            "bills_to_review": bills_to_review,
        },
        "projects_by_stage": by_stage,
        "proposals_by_status": prop_status,
        "pipeline_by_month": [monthly[k] for k in sorted(monthly)],
        "my_projects": [{"id": r[0], "name": r[1], "customer_name": r[2], "stage": r[3], "progress_pct": r[4]} for r in mine],
        "opportunities": [{"id": r[0], "name": r[1], "customer_name": r[2], "stage": r[3], "estimated_value_inr": r[4],
                           "target_capacity_kwh": r[5]} for r in opps],
    }
    if p.has("reports.view") and p.has("commercial.confidential.view"):
        approved = select(Proposal.calculation_id).where(
            Proposal.project_id.in_(proj_scope), Proposal.status.in_(["approved", "sent", "accepted"])).scalar_subquery()
        margin = 0.0
        for (commercial,) in db.execute(select(Calculation.commercial).where(Calculation.id.in_(approved))).all():
            margin += (commercial or {}).get("gross_margin_inr", 0)
        out["kpis"]["gross_margin_in_open_proposals_inr"] = round(margin)
    return out


@router.get("/dashboard")
def dashboard(p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    # Cached briefly per user and per permission set (never shared between users).
    v = cache.version()
    if v < 0:  # cache unavailable: compute directly
        return _dashboard(db, p)
    key = f"dash:{v}:{p.id}:{hash(tuple(sorted(p.perms)))}"
    return cache.get_or_set(key, 20, lambda: _dashboard(db, p))


# ---------- commercial settings (confidential) ----------

class CommercialIn(BaseModel):
    vendor_battery_inr_per_kwh: float | None = Field(default=None, gt=0, le=200_000)
    vendor_pcs_inr_per_kw: float | None = Field(default=None, ge=0, le=200_000)
    installation_pct: float | None = Field(default=None, ge=0, le=100)
    margin_pct: float | None = Field(default=None, ge=0, le=200)
    gst_pct: float | None = Field(default=None, ge=0, le=40)
    om_pct_of_capex: float | None = Field(default=None, ge=0, le=10)
    discount_rate_pct: float | None = Field(default=None, ge=0, le=30)
    tariff_escalation_pct: float | None = Field(default=None, ge=-10, le=20)
    degradation_pct_per_year: float | None = Field(default=None, ge=0, le=20)
    project_life_years: int | None = Field(default=None, ge=1, le=25)
    max_sales_discount_pct: float | None = Field(default=None, ge=0, le=50)


@router.get("/settings/commercial")
def get_commercial_settings(p: Principal = Depends(require("commercial.confidential.view")),
                            db: Session = Depends(get_db)):
    return get_commercial(db)


@router.put("/settings/commercial")
def put_commercial_settings(data: CommercialIn, p: Principal = Depends(require("pricing.manage")),
                            db: Session = Depends(get_db)):
    values = data.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(400, "Nothing to update")
    before = get_commercial(db)
    merged = set_commercial(db, values, p.id)
    db.commit()
    audit.record("admin", "pricing.updated", actor=p.user, target_type="settings", target_id="commercial",
                 details={k: {"from": before.get(k), "to": v} for k, v in values.items()})
    return merged
