"""Security operations dashboard: login activity, audit search, alerts, AI usage, chain verification."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit
from app.db import get_db
from app.deps import Principal, require
from app.models import AuditLog, AuthSession, LLMUsage, User

router = APIRouter(prefix="/security", tags=["security"])


def _entry(e: AuditLog) -> dict:
    return {"id": e.id, "ts": e.ts, "category": e.category, "action": e.action, "outcome": e.outcome,
            "actor_id": e.actor_id, "actor_email": e.actor_email, "target_type": e.target_type,
            "target_id": e.target_id, "ip": e.ip, "details": e.details}


@router.get("/overview")
def overview(p: Principal = Depends(require("security.view")), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    day = now - timedelta(days=1)

    def count(*conds):
        return db.execute(select(func.count()).select_from(AuditLog).where(*conds)).scalar()

    active_sessions = 0
    for s in db.execute(select(AuthSession).where(AuthSession.revoked_at.is_(None))).scalars():
        exp = s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=timezone.utc)
        active_sessions += exp > now
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return {
        "logins_24h": count(AuditLog.action == "login.success", AuditLog.ts >= day),
        "failed_logins_24h": count(AuditLog.action == "login.failed", AuditLog.ts >= day),
        "locked_accounts": db.execute(select(func.count()).select_from(User).where(User.locked_until > now)).scalar(),
        "permission_denials_24h": count(AuditLog.action == "permission.denied", AuditLog.ts >= day),
        "rate_limited_24h": count(AuditLog.action.in_(["rate_limited", "login.rate_limited"]), AuditLog.ts >= day),
        "active_sessions": active_sessions,
        "pending_users": db.execute(select(func.count()).select_from(User).where(User.status == "pending_approval")).scalar(),
        "ai_calls_month": db.execute(select(func.count()).select_from(LLMUsage).where(LLMUsage.created_at >= month_start)).scalar(),
        "ai_cost_month_usd": round(db.execute(select(func.coalesce(func.sum(LLMUsage.cost_usd), 0.0))
                                              .where(LLMUsage.created_at >= month_start)).scalar() or 0, 2),
        "alerts": alerts(db),
    }


def alerts(db: Session) -> list[dict]:
    now = datetime.now(timezone.utc)
    hour = now - timedelta(hours=1)
    out = []
    rows = db.execute(select(AuditLog.ip, func.count()).where(AuditLog.action == "login.failed", AuditLog.ts >= hour)
                      .group_by(AuditLog.ip)).all()
    for ip, n in rows:
        if n >= 10:
            out.append({"severity": "high", "type": "brute_force_suspected",
                        "message": f"{n} failed logins from {ip or 'unknown IP'} in the last hour"})
    for action, sev, msg in [
        ("refresh.reuse_detected", "high", "Refresh token reuse detected (possible token theft)"),
        ("privilege_escalation.blocked", "high", "Blocked attempt to grant higher privileges"),
        ("account.locked", "medium", "Account locked after repeated failed logins"),
        ("csrf.rejected", "medium", "Request rejected by CSRF protection"),
        ("token.invalid", "medium", "Invalid or tampered access token presented"),
        ("bill.flagged", "medium", "Uploaded document flagged by security screening"),
        ("file.infected", "high", "Malware detected in an uploaded file"),
    ]:
        n = db.execute(select(func.count()).select_from(AuditLog).where(AuditLog.action == action,
                                                                         AuditLog.ts >= now - timedelta(days=1))).scalar()
        if n:
            out.append({"severity": sev, "type": action, "message": f"{msg} ({n} in 24h)"})
    denied = db.execute(select(AuditLog.actor_email, func.count()).where(
        AuditLog.action == "permission.denied", AuditLog.ts >= hour).group_by(AuditLog.actor_email)).all()
    for email, n in denied:
        if n >= 20:
            out.append({"severity": "medium", "type": "access_probing",
                        "message": f"{email or 'A user'} hit {n} permission denials in the last hour"})
    return out


@router.get("/audit")
def search_audit(category: str | None = Query(default=None, max_length=30),
                 action: str | None = Query(default=None, max_length=80),
                 actor: str | None = Query(default=None, max_length=254),
                 outcome: str | None = Query(default=None, max_length=20),
                 target_id: str | None = Query(default=None, max_length=64),
                 days: int = Query(default=7, ge=1, le=3650),
                 limit: int = Query(default=200, ge=1, le=1000),
                 p: Principal = Depends(require("audit.view")), db: Session = Depends(get_db)):
    stmt = select(AuditLog).where(AuditLog.ts >= datetime.now(timezone.utc) - timedelta(days=days))
    if category:
        stmt = stmt.where(AuditLog.category == category)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if actor:
        stmt = stmt.where(AuditLog.actor_email.like(f"%{actor.lower()}%"))
    if outcome:
        stmt = stmt.where(AuditLog.outcome == outcome)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    rows = db.execute(stmt.order_by(AuditLog.id.desc()).limit(limit)).scalars()
    audit.record("security", "audit.searched", actor=p.user,
                 details={"category": category, "action": action, "actor": actor})
    return [_entry(e) for e in rows]


@router.get("/logins")
def login_activity(p: Principal = Depends(require("security.view")), db: Session = Depends(get_db)):
    rows = db.execute(select(AuditLog).where(AuditLog.category == "auth", AuditLog.action.like("login.%"))
                      .order_by(AuditLog.id.desc()).limit(300)).scalars()
    return [_entry(e) for e in rows]


@router.get("/ai-usage")
def ai_usage(p: Principal = Depends(require("security.view")), db: Session = Depends(get_db)):
    rows = db.execute(select(LLMUsage).order_by(LLMUsage.created_at.desc()).limit(200)).scalars()
    return [{"id": u.id, "user_id": u.user_id, "bill_id": u.bill_id, "model": u.model, "input_tokens": u.input_tokens,
             "output_tokens": u.output_tokens, "cost_usd": round(u.cost_usd, 4), "outcome": u.outcome,
             "created_at": u.created_at} for u in rows]


@router.get("/audit/verify")
def verify(p: Principal = Depends(require("audit.view")), db: Session = Depends(get_db)):
    result = audit.verify_chain()
    audit.record("security", "audit.chain_verified", actor=p.user, outcome="success" if result["valid"] else "failure",
                 details=result)
    return result
