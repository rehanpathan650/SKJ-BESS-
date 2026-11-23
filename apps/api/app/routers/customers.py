"""Customers, assignments, notes and projects. All reads are scoped by services.access."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app import audit
from app.db import get_db
from app.deps import Principal, active_user, require
from app.models import (
    Bill, Calculation, Customer, CustomerAssignment, CustomerNote, Department, Project, ProjectStage,
    Proposal, User, UserStatus,
)
from app.services import access
from app.services.notify import notify

router = APIRouter(tags=["customers"])


def customer_out(c: Customer, detail: bool = False) -> dict:
    out = {
        "id": c.id, "name": c.name, "company": c.company, "industry": c.industry,
        "contact_name": c.contact_name, "email": c.email, "phone": c.phone, "state": c.state,
        "discom": c.discom, "tariff_category": c.tariff_category,
        "owner": {"id": c.owner.id, "full_name": c.owner.full_name} if c.owner else None,
        "department_id": c.department_id, "updated_at": c.updated_at, "created_at": c.created_at,
    }
    if detail:
        out.update(address=c.address, gstin=c.gstin, consumer_number=c.consumer_number,
                   assignments=[{"user_id": a.user_id, "full_name": a.user.full_name} for a in c.assignments])
    return out


def project_out(p: Project) -> dict:
    return {
        "id": p.id, "name": p.name, "customer_id": p.customer_id, "customer_name": p.customer.name,
        "site_address": p.site_address, "stage": p.stage, "progress_pct": p.progress_pct,
        "estimated_value_inr": p.estimated_value_inr, "target_capacity_kwh": p.target_capacity_kwh,
        "engineer": {"id": p.engineer.id, "full_name": p.engineer.full_name} if p.engineer else None,
        "owner": {"id": p.owner.id, "full_name": p.owner.full_name} if p.owner else None,
        "created_at": p.created_at, "updated_at": p.updated_at,
    }


class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    company: str = Field(default="", max_length=200)
    industry: str = Field(default="", max_length=100)
    contact_name: str = Field(default="", max_length=200)
    email: EmailStr | None = None
    phone: str = Field(default="", max_length=30, pattern=r"^[0-9+\-() ]*$")
    address: str = Field(default="", max_length=2000)
    state: str = Field(default="", max_length=100)
    gstin: str = Field(default="", max_length=20, pattern=r"^[0-9A-Za-z]*$")
    discom: str = Field(default="", max_length=150)
    consumer_number: str = Field(default="", max_length=60)
    tariff_category: str = Field(default="", max_length=100)


class CustomerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    contact_name: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30, pattern=r"^[0-9+\-() ]*$")
    address: str | None = Field(default=None, max_length=2000)
    state: str | None = Field(default=None, max_length=100)
    gstin: str | None = Field(default=None, max_length=20, pattern=r"^[0-9A-Za-z]*$")
    discom: str | None = Field(default=None, max_length=150)
    consumer_number: str | None = Field(default=None, max_length=60)
    tariff_category: str | None = Field(default=None, max_length=100)
    # Only for customers.assign
    owner_id: str | None = Field(default=None, max_length=36)
    department_id: str | None = Field(default=None, max_length=36)


@router.get("/customers")
def list_customers(q: str | None = Query(default=None, max_length=100), limit: int = Query(50, ge=1, le=200),
                   offset: int = Query(0, ge=0), p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    stmt = access.customer_scope(p)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Customer.name).like(like), func.lower(Customer.company).like(like),
                              func.lower(Customer.contact_name).like(like), Customer.phone.like(like)))
    total = db.execute(stmt.with_only_columns(func.count()).order_by(None)).scalar()
    rows = db.execute(stmt.options(joinedload(Customer.owner)).order_by(Customer.updated_at.desc())
                      .limit(limit).offset(offset)).scalars().unique().all()
    return {"total": total, "items": [customer_out(c) for c in rows]}


@router.post("/customers", status_code=201)
def create_customer(data: CustomerIn, p: Principal = Depends(require("customers.create")),
                    db: Session = Depends(get_db)):
    c = Customer(**data.model_dump(exclude={"email"}), email=data.email or "",
                 owner_id=p.id, department_id=p.user.department_id)
    db.add(c)
    db.flush()
    db.add(CustomerAssignment(customer_id=c.id, user_id=p.id))
    db.commit()
    audit.record("data", "customer.created", actor=p.user, target_type="customer", target_id=c.id)
    return customer_out(c, detail=True)


@router.get("/customers/{customer_id}")
def get_customer(customer_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    audit.record("data", "customer.viewed", actor=p.user, target_type="customer", target_id=c.id)
    out = customer_out(c, detail=True)
    projects = db.execute(select(Project).options(joinedload(Project.customer), joinedload(Project.engineer),
                                                  joinedload(Project.owner))
                          .where(Project.customer_id == c.id).order_by(Project.created_at.desc()))
    out["projects"] = [project_out(pr) for pr in projects.scalars().unique()]
    return out


@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, data: CustomerPatch, p: Principal = Depends(require("customers.edit")),
                    db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    changes = data.model_dump(exclude_unset=True)
    if ("owner_id" in changes or "department_id" in changes) and not p.has("customers.assign"):
        raise HTTPException(403, "You cannot change the owner or department.")
    if changes.get("owner_id"):
        owner = db.get(User, changes["owner_id"])
        if owner is None or owner.status != UserStatus.ACTIVE:
            raise HTTPException(400, "Owner must be an active employee")
    if changes.get("department_id") and db.get(Department, changes["department_id"]) is None:
        raise HTTPException(400, "Unknown department")
    for k, v in changes.items():
        setattr(c, k, v if v is not None else ("" if k not in ("owner_id", "department_id") else None))
    others = [a.user_id for a in c.assignments if a.user_id != p.id]
    notify(db, others, "customer_updated", f"Customer updated: {c.name}", f"Updated by {p.user.full_name}",
           f"/customers/{c.id}")
    db.commit()
    audit.record("data", "customer.updated", actor=p.user, target_type="customer", target_id=c.id,
                 details={"fields": sorted(changes)})
    return customer_out(c, detail=True)


@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: str, p: Principal = Depends(require("customers.delete")),
                    db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    db.delete(c)
    db.commit()
    audit.record("data", "customer.deleted", actor=p.user, target_type="customer", target_id=customer_id,
                 details={"name": c.name})
    return {"detail": "Customer deleted"}


class AssignIn(BaseModel):
    user_id: str = Field(max_length=36)


@router.post("/customers/{customer_id}/assignments", status_code=201)
def assign_customer(customer_id: str, data: AssignIn, p: Principal = Depends(require("customers.assign")),
                    db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    u = db.get(User, data.user_id)
    if u is None or u.status != UserStatus.ACTIVE:
        raise HTTPException(400, "User must be an active employee")
    exists = db.execute(select(CustomerAssignment).where(CustomerAssignment.customer_id == c.id,
                                                         CustomerAssignment.user_id == u.id)).scalar_one_or_none()
    if not exists:
        db.add(CustomerAssignment(customer_id=c.id, user_id=u.id))
        notify(db, [u.id], "project_assigned", f"You were assigned to {c.name}", "", f"/customers/{c.id}")
    db.commit()
    audit.record("data", "customer.assigned", actor=p.user, target_type="customer", target_id=c.id,
                 details={"user_id": u.id})
    return {"detail": "Assigned"}


@router.delete("/customers/{customer_id}/assignments/{user_id}")
def unassign_customer(customer_id: str, user_id: str, p: Principal = Depends(require("customers.assign")),
                      db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    a = db.execute(select(CustomerAssignment).where(CustomerAssignment.customer_id == c.id,
                                                    CustomerAssignment.user_id == user_id)).scalar_one_or_none()
    if a:
        db.delete(a)
        db.commit()
    audit.record("data", "customer.unassigned", actor=p.user, target_type="customer", target_id=c.id,
                 details={"user_id": user_id})
    return {"detail": "Unassigned"}


# ---------- notes ----------

class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


@router.get("/customers/{customer_id}/notes")
def list_notes(customer_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    rows = db.execute(select(CustomerNote).where(CustomerNote.customer_id == c.id)
                      .order_by(CustomerNote.created_at.desc()).limit(200)).scalars()
    return [{"id": n.id, "body": n.body, "author": n.author.full_name, "created_at": n.created_at} for n in rows]


@router.post("/customers/{customer_id}/notes", status_code=201)
def add_note(customer_id: str, data: NoteIn,
             p: Principal = Depends(require("customers.edit", "projects.edit", "bills.upload", any_of=True)),
             db: Session = Depends(get_db)):
    c = access.get_customer(db, p, customer_id)
    n = CustomerNote(customer_id=c.id, author_id=p.id, body=data.body.strip())
    db.add(n)
    db.commit()
    audit.record("data", "customer.note_added", actor=p.user, target_type="customer", target_id=c.id)
    return {"id": n.id, "body": n.body, "author": p.user.full_name, "created_at": n.created_at}


# ---------- projects ----------

class ProjectIn(BaseModel):
    customer_id: str = Field(max_length=36)
    name: str = Field(min_length=2, max_length=200)
    site_address: str = Field(default="", max_length=2000)
    estimated_value_inr: float = Field(default=0, ge=0, le=1e11)
    target_capacity_kwh: float = Field(default=0, ge=0, le=1e7)
    engineer_id: str | None = Field(default=None, max_length=36)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    site_address: str | None = Field(default=None, max_length=2000)
    stage: str | None = None
    progress_pct: int | None = Field(default=None, ge=0, le=100)
    estimated_value_inr: float | None = Field(default=None, ge=0, le=1e11)
    target_capacity_kwh: float | None = Field(default=None, ge=0, le=1e7)
    engineer_id: str | None = Field(default=None, max_length=36)

    @field_validator("stage")
    @classmethod
    def _stage(cls, v):
        if v is not None and v not in ProjectStage.ALL:
            raise ValueError("invalid stage")
        return v


def _check_engineer(db: Session, engineer_id: str | None) -> None:
    if engineer_id:
        u = db.get(User, engineer_id)
        if u is None or u.status != UserStatus.ACTIVE:
            raise HTTPException(400, "Engineer must be an active employee")


@router.get("/projects")
def list_projects(response: Response, customer_id: str | None = None, stage: str | None = None, mine: bool = False,
                  limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                  p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    stmt = access.project_scope(p)
    if customer_id:
        stmt = stmt.where(Project.customer_id == customer_id)
    if stage:
        stmt = stmt.where(Project.stage == stage)
    if mine:
        stmt = stmt.where(or_(Project.engineer_id == p.id, Project.owner_id == p.id))
    response.headers["X-Total-Count"] = str(db.execute(stmt.with_only_columns(func.count()).order_by(None)).scalar())
    rows = db.execute(stmt.options(joinedload(Project.customer), joinedload(Project.engineer), joinedload(Project.owner))
                      .order_by(Project.updated_at.desc()).limit(limit).offset(offset)).scalars().unique()
    return [project_out(pr) for pr in rows]


@router.post("/projects", status_code=201)
def create_project(data: ProjectIn, p: Principal = Depends(require("projects.create")),
                   db: Session = Depends(get_db)):
    c = access.get_customer(db, p, data.customer_id)
    _check_engineer(db, data.engineer_id)
    pr = Project(customer_id=c.id, name=data.name, site_address=data.site_address,
                 estimated_value_inr=data.estimated_value_inr, target_capacity_kwh=data.target_capacity_kwh,
                 engineer_id=data.engineer_id, owner_id=p.id)
    db.add(pr)
    db.flush()
    if data.engineer_id:
        notify(db, [data.engineer_id], "project_assigned", f"New project: {pr.name}",
               f"Customer: {c.name}", f"/projects/{pr.id}")
    db.commit()
    audit.record("data", "project.created", actor=p.user, target_type="project", target_id=pr.id)
    db.refresh(pr)
    return project_out(pr)


@router.get("/projects/{project_id}")
def get_project(project_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    pr = access.get_project(db, p, project_id)
    out = project_out(pr)
    out["bill_count"] = db.execute(select(func.count()).select_from(Bill).where(Bill.project_id == pr.id)).scalar()
    out["calculation_count"] = db.execute(
        select(func.count()).select_from(Calculation).where(Calculation.project_id == pr.id)).scalar()
    out["proposal_count"] = db.execute(
        select(func.count()).select_from(Proposal).where(Proposal.project_id == pr.id)).scalar()
    return out


@router.patch("/projects/{project_id}")
def update_project(project_id: str, data: ProjectPatch, p: Principal = Depends(require("projects.edit")),
                   db: Session = Depends(get_db)):
    pr = access.get_project(db, p, project_id)
    changes = data.model_dump(exclude_unset=True)
    if "engineer_id" in changes:
        _check_engineer(db, changes["engineer_id"])
        if changes["engineer_id"] and changes["engineer_id"] != pr.engineer_id:
            notify(db, [changes["engineer_id"]], "project_assigned", f"New project: {pr.name}",
                   f"Customer: {pr.customer.name}", f"/projects/{pr.id}")
    for k, v in changes.items():
        setattr(pr, k, v)
    if changes.get("stage") in ("won", "commissioned"):
        pr.progress_pct = 100 if changes["stage"] == "commissioned" else max(pr.progress_pct, 60)
    db.commit()
    audit.record("data", "project.updated", actor=p.user, target_type="project", target_id=pr.id,
                 details={k: v for k, v in changes.items() if k in ("stage", "progress_pct", "engineer_id")})
    db.refresh(pr)
    return project_out(pr)


@router.get("/users-directory")
def users_directory(p: Principal = Depends(require("customers.assign", "projects.edit", "projects.create",
                                                   any_of=True)),
                    db: Session = Depends(get_db)):
    """Minimal list of active employees for assignment pickers (no emails or roles)."""
    rows = db.execute(select(User).where(User.status == UserStatus.ACTIVE).order_by(User.full_name)).scalars()
    return [{"id": u.id, "full_name": u.full_name, "role": u.role.name if u.role else None} for u in rows]
