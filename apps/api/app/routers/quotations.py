"""Quotation flow: customer's bill in -> techno-commercial quotation (web view + PDF) out.

1. POST /quotations/start           upload the bill(s); creates the customer and project when none is given
2. (worker reads the bill; the user checks the values on the bill page)
3. POST /projects/{id}/quotation/preview   live figures while choosing size, finance and price
4. POST /projects/{id}/quotation           save the configuration + quotation (PDF stored)
In single-login mode step 4 needs no engineer validation or approval (there is nobody else to do it).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import Principal, active_user, require
from app.models import AppSetting, Bill, Calculation, Customer, CustomerAssignment, Project, Proposal, StoredFile
from app.routers.bills import upload_bills
from app.routers.proposals import proposal_out
from app.services import access, quotation, quotation_pdf, storage
from app.services.app_settings import get_commercial
from app.services.bess import CalcInputs, calculate
from app.services.bill_analysis import analyse

router = APIRouter(tags=["quotations"])
public = APIRouter(tags=["public"])

DEFAULT_COMPANY = {"name": "SKJ Energy Solutions", "address": "", "phone": "", "email": "", "gstin": "", "signatory": ""}
PLACEHOLDER_NAME = "New customer (from bill)"


def get_company(db: Session) -> dict:
    row = db.get(AppSetting, "company")
    return {**DEFAULT_COMPANY, **(row.value if row else {})}


@public.get("/app-config")
def app_config():
    """Public, non-sensitive settings the login screen needs."""
    return {"single_user_mode": get_settings().single_user_mode}


class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    address: str = Field(default="", max_length=400)
    phone: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=200)
    gstin: str = Field(default="", max_length=20, pattern=r"^[0-9A-Z]{0,20}$")
    signatory: str = Field(default="", max_length=120)


@router.get("/settings/company")
def read_company(p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    return get_company(db)


@router.put("/settings/company")
def save_company(data: CompanyIn, p: Principal = Depends(require("pricing.manage")), db: Session = Depends(get_db)):
    row = db.get(AppSetting, "company")
    if row is None:
        db.add(AppSetting(key="company", value=data.model_dump(), updated_by_id=p.id))
    else:
        row.value, row.updated_by_id = data.model_dump(), p.id
    db.commit()
    audit.record("admin", "company.updated", actor=p.user)
    return get_company(db)


@router.get("/quotations/defaults")
def defaults(p: Principal = Depends(require("calculator.use")), db: Session = Depends(get_db)):
    return {"options": quotation.QuoteOptions().model_dump(), "purposes": quotation.PURPOSES,
            "gst_pct": get_commercial(db)["gst_pct"], "company": get_company(db),
            "single_user_mode": get_settings().single_user_mode}


@router.post("/quotations/start", status_code=201)
async def start(files: list[UploadFile] = File(...), customer_id: str | None = Form(default=None),
                p: Principal = Depends(require("bills.upload")), db: Session = Depends(get_db)):
    """Upload a customer's bill to start a quotation. Without customer_id a customer and project are created and
    filled in from the bill once it has been read."""
    if customer_id:
        c = access.get_customer(db, p, customer_id)
    else:
        if not p.has("customers.create"):
            raise HTTPException(403, "Choose an existing customer")
        c = Customer(name=PLACEHOLDER_NAME, owner_id=p.id, department_id=p.user.department_id)
        db.add(c)
        db.flush()
        db.add(CustomerAssignment(customer_id=c.id, user_id=p.id))
    pr = db.execute(select(Project).where(Project.customer_id == c.id).order_by(Project.created_at.desc())).scalars().first()
    if pr is None:
        pr = Project(customer_id=c.id, name="BESS quotation", owner_id=p.id)
        db.add(pr)
    db.commit()
    bills = await upload_bills(c.id, files, pr.id, p, db)
    return {"customer_id": c.id, "project_id": pr.id, "bills": bills}


def fill_customer_from_bill(db: Session, bill: Bill) -> None:
    """Worker hook: a customer created from a bill gets its name and details from that bill."""
    c = db.get(Customer, bill.customer_id)
    data = bill.extracted or {}
    if c is None or c.name != PLACEHOLDER_NAME or not data.get("consumer_name"):
        return
    c.name = str(data["consumer_name"])[:200]
    c.company = c.company or c.name
    for field, key in (("address", "consumer_address"), ("discom", "discom"), ("consumer_number", "consumer_number"),
                       ("tariff_category", "tariff_category"), ("industry", "activity")):
        if data.get(key) and not getattr(c, field, None):
            setattr(c, field, str(data[key])[:300])
    if c.discom == "MSEDCL" and not c.state:
        c.state = "Maharashtra"
    for pr in db.execute(select(Project).where(Project.customer_id == c.id, Project.name == "BESS quotation")).scalars():
        short = re.sub(r"^\s*M\s*/\s*S\.?\s*", "", c.name, flags=re.I).split()  # drop a leading "M/S." prefix
        pr.name = f"{short[0].strip('.,') if short else c.name} BESS"[:200]


def _bill_facts(db: Session, project: Project) -> tuple[dict, dict]:
    """Values of the latest bill (confirmed values preferred) and the analysis across the project's bills."""
    bills = list(db.execute(select(Bill).where(Bill.project_id == project.id)).scalars()) or \
        list(db.execute(select(Bill).where(Bill.customer_id == project.customer_id)).scalars())
    reviewed = [b for b in bills if b.status == "reviewed" and b.reviewed]
    if not reviewed:
        raise HTTPException(400, "Confirm the values of at least one bill first.")
    latest = max(reviewed, key=lambda b: ((b.reviewed or {}).get("bill_month") or "", b.created_at))
    return dict(latest.reviewed), analyse(bills)


class QuoteIn(BaseModel):
    inputs: CalcInputs | None = None  # blank = sized automatically from the confirmed bills
    options: quotation.QuoteOptions = Field(default_factory=quotation.QuoteOptions)
    calculation_id: str | None = Field(default=None, max_length=36)  # multi-user mode: a validated configuration
    title: str = Field(default="BESS techno-commercial quotation", min_length=3, max_length=200)


def _inputs(db: Session, data: QuoteIn, analysis: dict) -> tuple[CalcInputs, list[dict]]:
    """Inputs for the quotation and a size comparison. Blank inputs = the best-value size from the optimiser."""
    prefill = {k: v for k, v in (analysis.get("calculator_prefill") or {}).items()
               if k in CalcInputs.model_fields and v is not None}
    if not prefill.get("monthly_consumption_kwh"):
        raise HTTPException(400, "The confirmed bill values are not enough to size a system. Check units consumed.")
    best, table = quotation.optimise_size(prefill, get_commercial(db))
    if data.inputs is not None:
        chosen = data.inputs
        for row in table:
            row["recommended"] = False
    else:
        try:
            chosen = CalcInputs(**best)
        except ValueError:
            raise HTTPException(400, "The confirmed bill values are not enough to size a system.")
    return chosen, table


def _content(db: Session, p: Principal, project: Project, inputs: CalcInputs, options: quotation.QuoteOptions,
             number: str, sizes: list[dict] | None = None) -> tuple[dict, dict, dict]:
    bill, _ = _bill_facts(db, project)
    try:
        results, commercial = calculate(inputs, get_commercial(db))
    except ValueError as exc:
        raise HTTPException(400, str(exc).splitlines()[0][:300])
    c = project.customer
    content = quotation.build(number=number, customer={"name": c.name, "address": c.address}, bill=bill,
                              inputs=inputs.model_dump(), results=results, options=options, company=get_company(db),
                              gst_pct=get_commercial(db)["gst_pct"])
    content["size_options"] = sizes or []
    return content, results, commercial


def _next_number(db: Session) -> str:
    today = date.today()
    fy_start = date(today.year if today.month >= 4 else today.year - 1, 4, 1)
    n = db.execute(select(func.count()).select_from(Proposal).where(
        Proposal.quotation.is_not(None), Proposal.created_at >= datetime(fy_start.year, 4, 1, tzinfo=timezone.utc))).scalar() or 0
    return quotation.quotation_number(n + 1, today)


@router.post("/projects/{project_id}/quotation/preview")
def preview(project_id: str, data: QuoteIn, p: Principal = Depends(require("calculator.use")),
            db: Session = Depends(get_db)):
    project = access.get_project(db, p, project_id)
    _, analysis = _bill_facts(db, project)
    inputs, sizes = _inputs(db, data, analysis)
    content, _, commercial = _content(db, p, project, inputs, data.options, "PREVIEW", sizes)
    out = {"inputs": inputs.model_dump(), "content": content}
    if p.has("commercial.confidential.view"):
        out["commercial"] = commercial
    return out


@router.post("/projects/{project_id}/quotation", status_code=201)
def create(project_id: str, data: QuoteIn, p: Principal = Depends(require("proposals.create")),
           db: Session = Depends(get_db)):
    project = access.get_project(db, p, project_id)
    single = get_settings().single_user_mode
    _, analysis = _bill_facts(db, project)
    if data.calculation_id:
        calc = db.get(Calculation, data.calculation_id)
        if calc is None or calc.project_id != project.id:
            raise HTTPException(404, "Not found")
        if calc.validation_status != "approved":
            raise HTTPException(400, "The configuration must be technically validated by an engineer first.")
        inputs = CalcInputs.model_validate(calc.inputs)
    elif single:
        inputs, sizes = _inputs(db, data, analysis)
        calc = None
    else:
        raise HTTPException(400, "Choose a configuration validated by an engineer (or enable single-login mode).")

    number = _next_number(db)
    if data.calculation_id:
        sizes = []
    content, results, commercial = _content(db, p, project, inputs, data.options, number, sizes)
    content = quotation.ai_narrative(db, content, p.id)
    now = datetime.now(timezone.utc)
    if calc is None:
        calc = Calculation(project_id=project.id, name=f"Quotation {number}", inputs=inputs.model_dump(), results=results,
                           commercial=commercial, created_by_id=p.id, validation_status="approved",
                           validation_note="Single-login mode: no separate engineer validation.",
                           validated_by_id=p.id, validated_at=now)
        db.add(calc)
        db.flush()
    last = db.execute(select(func.max(Proposal.revision)).where(Proposal.project_id == project.id)).scalar() or 0
    db.execute(update(Proposal).where(Proposal.project_id == project.id,
                                      Proposal.status.in_(["draft", "pending_approval", "rejected"])).values(status="superseded"))
    pr = Proposal(project_id=project.id, calculation_id=calc.id, revision=last + 1, title=data.title,
                  created_by_id=p.id, quotation=content,
                  status="approved" if single else "draft",
                  approved_by_id=p.id if single else None, approved_at=now if single else None)
    db.add(pr)
    db.flush()
    pdf = quotation_pdf.render(content, draft=not single)
    f = storage.save(db, pdf, f"Quotation-{number.replace('/', '-')}.pdf", "application/pdf", p.id, scan_status="clean")
    pr.file_id = f.id
    if project.stage in ("lead", "site_survey", "technical_validation"):
        project.stage = "proposal"
    db.commit()
    db.refresh(pr)
    audit.record("proposal", "quotation.generated", actor=p.user, target_type="proposal", target_id=pr.id,
                 details={"number": number, "revision": pr.revision, "narrative": content["narrative_source"],
                         "single_user_mode": single})
    return proposal_out(pr)


def rerender_quotation_pdf(db: Session, pr: Proposal, user_id: str) -> bool:
    """Used after approval in multi-user mode: re-render without the DRAFT mark. Returns False for old proposals."""
    if not pr.quotation:
        return False
    old = db.get(StoredFile, pr.file_id) if pr.file_id else None
    pdf = quotation_pdf.render(pr.quotation, draft=pr.status not in ("approved", "sent", "accepted"))
    f = storage.save(db, pdf, f"Quotation-{pr.quotation['number'].replace('/', '-')}.pdf", "application/pdf",
                     user_id, scan_status="clean")
    pr.file_id = f.id
    if old:
        db.flush()
        storage.delete(old)
        db.delete(old)
    return True
