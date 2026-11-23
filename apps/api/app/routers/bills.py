"""Electricity bill upload, review/correction, analysis and secure download."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app import audit
from app.db import get_db
from app.deps import Principal, active_user, not_found, require
from app.models import Bill
from app.security import ratelimit
from app.services import access, storage
from app.services.app_settings import get_commercial
from app.services.bill_analysis import analyse, estimate
from app.services.extraction import EDITABLE_FIELDS, validate_output
from app.services.jobs import enqueue

router = APIRouter(tags=["bills"])

MAX_FILES_PER_UPLOAD = 12


def bill_out(b: Bill, detail: bool = False) -> dict:
    out = {
        "id": b.id, "customer_id": b.customer_id, "project_id": b.project_id, "status": b.status,
        "status_detail": b.status_detail, "file_name": b.file.original_name, "file_size": b.file.size,
        "mime": b.file.mime, "scan_status": b.file.scan_status, "extraction_method": b.extraction_method,
        "security_flags": b.security_flags or [], "created_at": b.created_at, "reviewed_at": b.reviewed_at,
        "bill_month": (b.reviewed or b.extracted or {}).get("bill_month"),
        "units_kwh": (b.reviewed or b.extracted or {}).get("units_kwh"),
    }
    if detail:
        out.update(extracted=b.extracted, reviewed=b.reviewed, editable_fields=EDITABLE_FIELDS)
    return out


@router.post("/customers/{customer_id}/bills", status_code=201)
async def upload_bills(customer_id: str, files: list[UploadFile] = File(...),
                       project_id: str | None = Form(default=None),
                       p: Principal = Depends(require("bills.upload")), db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    if project_id:
        pr = access.get_project(db, p, project_id)
        if pr.customer_id != c.id:
            raise HTTPException(400, "Project belongs to another customer")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(400, f"Upload at most {MAX_FILES_PER_UPLOAD} files at once")
    if not ratelimit.check(f"upload:{p.id}", 60, 3600):
        raise HTTPException(429, "Upload limit reached. Try again later.")
    created = []
    for f in files:
        v = await storage.read_and_validate(f)
        stored = storage.save(db, v.data, v.safe_name, v.mime, p.id)
        bill = Bill(customer_id=c.id, project_id=project_id, file_id=stored.id, uploaded_by_id=p.id,
                    status="queued", status_detail="Waiting for malware scan and extraction")
        db.add(bill)
        db.flush()
        enqueue(db, "process_bill", {"bill_id": bill.id})
        created.append(bill)
        audit.record("file", "bill.uploaded", actor=p.user, target_type="bill", target_id=bill.id,
                     details={"customer_id": c.id, "size": v.data.__len__(), "mime": v.mime})
    db.commit()
    return [bill_out(b) for b in created]


@router.get("/customers/{customer_id}/bills")
def customer_bills(customer_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    rows = db.execute(select(Bill).options(joinedload(Bill.file)).where(Bill.customer_id == c.id)
                      .order_by(Bill.created_at.desc()).limit(500)).scalars()
    return [bill_out(b) for b in rows]


@router.get("/projects/{project_id}/bills")
def project_bills(project_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    pr = access.get_project(db, p, project_id)
    rows = db.execute(select(Bill).options(joinedload(Bill.file)).where(Bill.project_id == pr.id)
                      .order_by(Bill.created_at.desc()).limit(500)).scalars()
    return [bill_out(b) for b in rows]


@router.get("/bills/{bill_id}")
def get_bill(bill_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    return bill_out(access.get_bill(db, p, bill_id), detail=True)


class ReviewIn(BaseModel):
    values: dict = Field(default_factory=dict)
    confirm: bool = True


@router.put("/bills/{bill_id}/review")
def review_bill(bill_id: str, data: ReviewIn, p: Principal = Depends(require("bills.review")),
                db: Session = Depends(get_db)):
    b = access.get_bill(db, p, bill_id)
    if b.status not in ("needs_review", "reviewed"):
        raise HTTPException(400, f"Bill cannot be reviewed while {b.status}")
    if len(data.values) > len(EDITABLE_FIELDS):
        raise HTTPException(400, "Too many fields")
    unknown = set(data.values) - set(EDITABLE_FIELDS)
    if unknown:
        raise HTTPException(400, f"Unknown fields: {', '.join(sorted(unknown)[:5])}")
    merged = {**(b.extracted or {}), **data.values, "document_is_electricity_bill": True,
              "embedded_instructions_detected": False, "confidence": 1.0}
    clean, flags = validate_output(merged)
    if not clean:
        raise HTTPException(400, "Some values are not valid numbers or text")
    rejected = [f for f in flags if f.startswith(("out_of_range", "invalid:"))]
    if rejected:
        raise HTTPException(400, "Values out of range: " + ", ".join(f.split(":", 1)[1] for f in rejected))
    changed = sorted(k for k in data.values if (b.extracted or {}).get(k) != clean.get(k))
    b.reviewed = clean
    if data.confirm:
        b.status = "reviewed"
        b.reviewed_by_id = p.id
        b.reviewed_at = datetime.now(timezone.utc)
        b.status_detail = "Reviewed and confirmed by a person"
    db.commit()
    audit.record("data", "bill.reviewed", actor=p.user, target_type="bill", target_id=b.id,
                 details={"corrected_fields": changed, "confirmed": data.confirm})
    return bill_out(b, detail=True)


@router.post("/bills/{bill_id}/reprocess")
def reprocess_bill(bill_id: str, p: Principal = Depends(require("bills.upload")), db: Session = Depends(get_db)):
    b = access.get_bill(db, p, bill_id)
    if b.file.scan_status == "infected":
        raise HTTPException(400, "Infected files cannot be processed")
    b.status = "queued"
    b.status_detail = "Queued for re-extraction"
    enqueue(db, "process_bill", {"bill_id": b.id})
    db.commit()
    audit.record("data", "bill.reprocess", actor=p.user, target_type="bill", target_id=b.id)
    return bill_out(b)


@router.get("/bills/{bill_id}/file")
def download_bill(bill_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    b = access.get_bill(db, p, bill_id)
    if b.file.scan_status not in ("clean", "skipped"):
        raise HTTPException(409, "File is not available (not scanned or failed the malware scan)")
    data = storage.load(b.file)
    audit.record("file", "bill.downloaded", actor=p.user, target_type="bill", target_id=b.id)
    return Response(content=data, media_type=b.file.mime, headers={
        "Content-Disposition": f'attachment; filename="{b.file.original_name}"',
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    })


@router.delete("/bills/{bill_id}")
def delete_bill(bill_id: str, p: Principal = Depends(require("bills.upload")), db: Session = Depends(get_db)):
    b = access.get_bill(db, p, bill_id)
    if b.uploaded_by_id != p.id and not p.has("customers.edit"):
        raise not_found()
    f = b.file
    db.delete(b)
    db.flush()
    storage.delete(f)
    db.delete(f)
    db.commit()
    audit.record("file", "bill.deleted", actor=p.user, target_type="bill", target_id=bill_id)
    return {"detail": "Bill deleted"}


def _with_estimate(db: Session, p: Principal, bills: list[Bill]) -> dict:
    """Bill analysis (confirmed values) plus, for calculator users, an automatic estimate. The estimate falls back
    to extracted, unconfirmed values while nothing has been confirmed yet (marked as such)."""
    out = analyse(bills)
    if p.has("calculator.use"):
        source = out if out.get("bill_count") else analyse(bills, include_unreviewed=True)
        out["estimate"] = _strip(estimate(source, get_commercial(db)), p)
    return out


def _strip(est: dict, p: Principal) -> dict:
    # Vendor cost and margin only for commercial.confidential.view (same rule as the calculator).
    if not p.has("commercial.confidential.view"):
        est.pop("commercial", None)
    return est


@router.get("/customers/{customer_id}/bill-analysis")
def customer_bill_analysis(customer_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    return _with_estimate(db, p, list(db.execute(select(Bill).where(Bill.customer_id == c.id)).scalars()))


@router.get("/projects/{project_id}/bill-analysis")
def project_bill_analysis(project_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    pr = access.get_project(db, p, project_id)
    bills = list(db.execute(select(Bill).where(Bill.project_id == pr.id)).scalars())
    if not bills:  # fall back to the customer's bills
        bills = list(db.execute(select(Bill).where(Bill.customer_id == pr.customer_id)).scalars())
    return _with_estimate(db, p, bills)


@router.get("/bills/{bill_id}/estimate")
def bill_estimate(bill_id: str, p: Principal = Depends(require("calculator.use")), db: Session = Depends(get_db)):
    """Automatic estimate for one bill, available as soon as its values are extracted."""
    bill = access.get_bill(db, p, bill_id)
    if bill.status not in ("needs_review", "reviewed"):
        return {"available": False, "basis": "unreviewed", "bill_count": 0,
                "reason": "The estimate appears once the bill has been scanned and read."}
    return _strip(estimate(analyse([bill], include_unreviewed=True), get_commercial(db)), p)
