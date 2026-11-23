"""Proposal generation, approval workflow, revisions, secure download and share links."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from fastapi import Response as FastAPIResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, joinedload

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import Principal, active_user, not_found, require
from app.models import Calculation, Proposal, ShareLink, StoredFile
from app.security import ratelimit
from app.security.crypto import new_token, sha256_hex
from app.services import access, proposal_pdf, quotation_pdf, storage
from app.services.notify import notify, users_with_permission

router = APIRouter(tags=["proposals"])
public = APIRouter(prefix="/public", tags=["public"])


def utcnow():
    return datetime.now(timezone.utc)


def aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def proposal_out(pr: Proposal) -> dict:
    f = pr.calculation.results["financial"]
    s = pr.calculation.results["summary"]
    return {
        "id": pr.id, "project_id": pr.project_id, "project_name": pr.project.name,
        "customer_id": pr.project.customer_id, "customer_name": pr.project.customer.name,
        "calculation_id": pr.calculation_id, "revision": pr.revision, "title": pr.title, "status": pr.status,
        "status_note": pr.status_note, "created_by_id": pr.created_by_id, "approved_by_id": pr.approved_by_id,
        "approved_at": pr.approved_at, "created_at": pr.created_at, "updated_at": pr.updated_at,
        "has_pdf": pr.file_id is not None,
        "has_quotation": pr.quotation is not None,
        "quotation_number": (pr.quotation or {}).get("number"),
        "key_figures": {"battery_capacity_kwh": s["battery_capacity_kwh"], "battery_power_kw": s["battery_power_kw"],
                        "capex_inr": f["capex_inr"], "year1_net_saving_inr": f["year1_net_saving_inr"],
                        "simple_payback_years": f["simple_payback_years"], "irr_pct": f["irr_pct"]},
    }


def _render(db: Session, pr: Proposal, user_id: str) -> None:
    c = pr.project.customer
    if pr.quotation:  # techno-commercial quotation: re-render the same content (DRAFT mark until approved)
        pdf = quotation_pdf.render(pr.quotation, draft=pr.status not in ("approved", "sent", "accepted"))
        old = db.get(StoredFile, pr.file_id) if pr.file_id else None
        f = storage.save(db, pdf, f"Quotation-{pr.quotation['number'].replace('/', '-')}.pdf", "application/pdf",
                         user_id, scan_status="clean")
        pr.file_id = f.id
        if old:
            db.flush()
            storage.delete(old)
            db.delete(old)
        return
    pdf = proposal_pdf.render(
        customer={"name": c.name, "company": c.company},
        project={"name": pr.project.name, "site_address": pr.project.site_address},
        calc={"results": pr.calculation.results, "inputs": pr.calculation.inputs},
        title=pr.title, revision=pr.revision, approved=pr.status in ("approved", "sent", "accepted"),
    )
    old = db.get(StoredFile, pr.file_id) if pr.file_id else None
    f = storage.save(db, pdf, f"SKJ-Proposal-R{pr.revision}.pdf", "application/pdf", user_id, scan_status="clean")
    pr.file_id = f.id
    if old:
        db.flush()
        storage.delete(old)
        db.delete(old)


class CreateIn(BaseModel):
    calculation_id: str = Field(max_length=36)
    title: str = Field(default="Battery Energy Storage System Proposal", min_length=3, max_length=200)


@router.post("/projects/{project_id}/proposals", status_code=201)
def create_proposal(project_id: str, data: CreateIn, p: Principal = Depends(require("proposals.create")),
                    db: Session = Depends(get_db)):
    project = access.get_project(db, p, project_id)
    calc = db.get(Calculation, data.calculation_id)
    if calc is None or calc.project_id != project.id:
        raise not_found()
    single = get_settings().single_user_mode
    if calc.validation_status != "approved" and not single:
        raise HTTPException(400, "The configuration must be technically validated by an engineer first.")
    last = db.execute(select(func.max(Proposal.revision)).where(Proposal.project_id == project.id)).scalar() or 0
    db.execute(update(Proposal).where(Proposal.project_id == project.id,
                                      Proposal.status.in_(["draft", "pending_approval", "rejected"]))
               .values(status="superseded"))
    pr = Proposal(project_id=project.id, calculation_id=calc.id, revision=last + 1, title=data.title,
                  created_by_id=p.id, status="approved" if single else "draft",
                  approved_by_id=p.id if single else None,
                  approved_at=datetime.now(timezone.utc) if single else None)
    db.add(pr)
    db.flush()
    db.refresh(pr)
    _render(db, pr, p.id)
    if project.stage in ("lead", "site_survey", "technical_validation"):
        project.stage = "proposal"
    db.commit()
    audit.record("proposal", "proposal.generated", actor=p.user, target_type="proposal", target_id=pr.id,
                 details={"revision": pr.revision, "calculation_id": calc.id})
    return proposal_out(pr)


@router.get("/proposals")
def list_proposals(response: FastAPIResponse, status: str | None = None, limit: int = Query(100, ge=1, le=500),
                   offset: int = Query(0, ge=0), p: Principal = Depends(require("proposals.view")),
                   db: Session = Depends(get_db)):
    stmt = select(Proposal).where(Proposal.project_id.in_(
        access.project_scope(p).with_only_columns(access.Project.id).scalar_subquery()))
    if status:
        stmt = stmt.where(Proposal.status == status)
    response.headers["X-Total-Count"] = str(db.execute(stmt.with_only_columns(func.count()).order_by(None)).scalar())
    rows = db.execute(stmt.options(joinedload(Proposal.project).joinedload(access.Project.customer),
                                   joinedload(Proposal.calculation))
                      .order_by(Proposal.updated_at.desc()).limit(limit).offset(offset)).scalars().unique()
    return [proposal_out(x) for x in rows]


@router.get("/projects/{project_id}/proposals")
def project_proposals(project_id: str, p: Principal = Depends(require("proposals.view")),
                      db: Session = Depends(get_db)):
    project = access.get_project(db, p, project_id)
    rows = db.execute(select(Proposal).where(Proposal.project_id == project.id)
                      .order_by(Proposal.revision.desc())).scalars()
    return [proposal_out(x) for x in rows]


@router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    out = proposal_out(pr)
    out["results"] = pr.calculation.results
    out["quotation"] = pr.quotation  # customer-facing content only (no vendor cost or margin)
    return out


@router.post("/proposals/{proposal_id}/submit")
def submit(proposal_id: str, p: Principal = Depends(require("proposals.create")), db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    if pr.status not in ("draft", "rejected"):
        raise HTTPException(400, f"Cannot submit a proposal that is {pr.status}")
    pr.status = "pending_approval"
    approvers = [u for u in users_with_permission(db, "proposals.approve") if u != p.id]
    notify(db, approvers, "proposal_approval", f"Proposal awaiting approval: {pr.project.name}",
           f"Revision {pr.revision} for {pr.project.customer.name}", f"/proposals/{pr.id}")
    db.commit()
    audit.record("proposal", "proposal.submitted", actor=p.user, target_type="proposal", target_id=pr.id)
    return proposal_out(pr)


class DecisionIn(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/proposals/{proposal_id}/approve")
def approve(proposal_id: str, data: DecisionIn, p: Principal = Depends(require("proposals.approve")),
            db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    if pr.status != "pending_approval":
        raise HTTPException(400, "Only proposals awaiting approval can be approved")
    if pr.created_by_id == p.id and "*" not in p.perms:
        raise HTTPException(403, "You cannot approve your own proposal.")
    pr.status = "approved"
    pr.status_note = data.note
    pr.approved_by_id = p.id
    pr.approved_at = utcnow()
    _render(db, pr, p.id)  # re-render without the DRAFT watermark
    notify(db, [pr.created_by_id], "proposal_approval", f"Proposal approved: {pr.project.name}", data.note[:200],
           f"/proposals/{pr.id}")
    db.commit()
    audit.record("proposal", "proposal.approved", actor=p.user, target_type="proposal", target_id=pr.id)
    return proposal_out(pr)


@router.post("/proposals/{proposal_id}/reject")
def reject(proposal_id: str, data: DecisionIn, p: Principal = Depends(require("proposals.approve")),
           db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    if pr.status != "pending_approval":
        raise HTTPException(400, "Only proposals awaiting approval can be rejected")
    pr.status = "rejected"
    pr.status_note = data.note
    notify(db, [pr.created_by_id], "proposal_approval", f"Proposal returned: {pr.project.name}", data.note[:200],
           f"/proposals/{pr.id}")
    db.commit()
    audit.record("proposal", "proposal.rejected", actor=p.user, target_type="proposal", target_id=pr.id)
    return proposal_out(pr)


class StatusIn(BaseModel):
    status: Literal["sent", "accepted", "declined"]
    note: str = Field(default="", max_length=2000)


@router.post("/proposals/{proposal_id}/status")
def set_status(proposal_id: str, data: StatusIn,
               p: Principal = Depends(require("proposals.share", "proposals.approve", any_of=True)),
               db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    allowed = {"sent": {"approved"}, "accepted": {"sent", "approved"}, "declined": {"sent", "approved"}}
    if pr.status not in allowed[data.status]:
        raise HTTPException(400, f"Cannot change a {pr.status} proposal to {data.status}")
    pr.status = data.status
    pr.status_note = data.note
    if data.status == "accepted":
        pr.project.stage = "won"
        pr.project.progress_pct = max(pr.project.progress_pct, 60)
    elif data.status == "declined":
        pr.project.stage = "lost"
    elif data.status == "sent":
        pr.project.stage = "negotiation" if pr.project.stage == "proposal" else pr.project.stage
    mgmt = users_with_permission(db, "reports.view")
    if data.status in ("accepted", "declined"):
        notify(db, mgmt, "management", f"Proposal {data.status}: {pr.project.customer.name}",
               f"{pr.project.name}, revision {pr.revision}", f"/proposals/{pr.id}")
    db.commit()
    audit.record("proposal", f"proposal.{data.status}", actor=p.user, target_type="proposal", target_id=pr.id)
    return proposal_out(pr)


@router.get("/proposals/{proposal_id}/pdf")
def download_pdf(proposal_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    if not pr.file_id:
        raise not_found()
    data = storage.load(db.get(StoredFile, pr.file_id))
    audit.record("file", "proposal.downloaded", actor=p.user, target_type="proposal", target_id=pr.id)
    return Response(content=data, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="SKJ-Proposal-R{pr.revision}.pdf"',
        "Content-Security-Policy": "default-src 'none'; sandbox",
    })


class ShareIn(BaseModel):
    recipient_note: str = Field(default="", max_length=200)
    days: int = Field(default=7, ge=1, le=30)
    max_downloads: int = Field(default=10, ge=1, le=100)


@router.post("/proposals/{proposal_id}/share", status_code=201)
def create_share(proposal_id: str, data: ShareIn, p: Principal = Depends(require("proposals.share")),
                 db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    if pr.status not in ("approved", "sent", "accepted"):
        raise HTTPException(400, "Only approved proposals can be shared")
    raw = new_token(32)
    link = ShareLink(proposal_id=pr.id, token_hash=sha256_hex(raw), created_by_id=p.id,
                     recipient_note=data.recipient_note, expires_at=utcnow() + timedelta(days=data.days),
                     max_downloads=data.max_downloads)
    db.add(link)
    if pr.status == "approved":
        pr.status = "sent"
    db.commit()
    audit.record("proposal", "proposal.share_created", actor=p.user, target_type="proposal", target_id=pr.id,
                 details={"days": data.days, "recipient": data.recipient_note})
    base = get_settings().public_base_url.rstrip("/")
    return {"id": link.id, "url": f"{base}/api/v1/public/proposals/{raw}", "expires_at": link.expires_at}


@router.get("/proposals/{proposal_id}/shares")
def list_shares(proposal_id: str, p: Principal = Depends(require("proposals.share")), db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    rows = db.execute(select(ShareLink).where(ShareLink.proposal_id == pr.id)
                      .order_by(ShareLink.created_at.desc())).scalars()
    return [{"id": s.id, "recipient_note": s.recipient_note, "expires_at": s.expires_at, "revoked_at": s.revoked_at,
             "download_count": s.download_count, "max_downloads": s.max_downloads, "created_at": s.created_at}
            for s in rows]


@router.delete("/proposals/{proposal_id}/shares/{share_id}")
def revoke_share(proposal_id: str, share_id: str, p: Principal = Depends(require("proposals.share")),
                 db: Session = Depends(get_db)):
    pr = access.get_proposal(db, p, proposal_id)
    s = db.get(ShareLink, share_id)
    if s is None or s.proposal_id != pr.id:
        raise not_found()
    s.revoked_at = utcnow()
    db.commit()
    audit.record("proposal", "proposal.share_revoked", actor=p.user, target_type="proposal", target_id=pr.id)
    return {"detail": "Link revoked"}


@public.get("/proposals/{token}")
def public_proposal(token: str, request: Request, db: Session = Depends(get_db)):
    if not ratelimit.check(f"share:{request.state.client_ip}", 20):
        raise HTTPException(429, "Too many requests")
    if len(token) > 100:
        raise not_found()
    s = db.execute(select(ShareLink).where(ShareLink.token_hash == sha256_hex(token))).scalar_one_or_none()
    if (s is None or s.revoked_at is not None or aware(s.expires_at) < utcnow()
            or s.download_count >= s.max_downloads):
        audit.record("security", "share_link.invalid", outcome="denied")
        raise HTTPException(404, "This link is invalid or has expired")
    pr = db.get(Proposal, s.proposal_id)
    if pr is None or pr.status not in ("sent", "accepted", "approved") or not pr.file_id:
        raise HTTPException(404, "This link is invalid or has expired")
    s.download_count += 1
    db.commit()
    audit.record("file", "proposal.external_download", target_type="proposal", target_id=pr.id,
                 details={"share_id": s.id})
    data = storage.load(db.get(StoredFile, pr.file_id))
    return Response(content=data, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="SKJ-Proposal-R{pr.revision}.pdf"',
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex",
    })
