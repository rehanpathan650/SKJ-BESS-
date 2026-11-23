"""Record-level access control. Every customer/project lookup goes through these helpers so that
an employee can never read a record outside their scope by guessing its ID (IDOR)."""
from __future__ import annotations

from sqlalchemy import Select, false, or_, select
from sqlalchemy.orm import Session

from app.deps import Principal, not_found
from app.models import Bill, Calculation, Customer, CustomerAssignment, Project, Proposal


def customer_scope(p: Principal) -> Select:
    q = select(Customer)
    if p.has("customers.view_all"):
        return q
    conds = []
    if p.has("customers.view"):
        assigned = select(CustomerAssignment.customer_id).where(CustomerAssignment.user_id == p.id)
        engineer_of = select(Project.customer_id).where(Project.engineer_id == p.id)
        conds += [Customer.owner_id == p.id, Customer.id.in_(assigned), Customer.id.in_(engineer_of)]
    if p.has("customers.view_department") and p.user.department_id:
        conds.append(Customer.department_id == p.user.department_id)
    if not conds:
        return q.where(false())
    return q.where(or_(*conds))


def visible_customer_ids(p: Principal):
    return customer_scope(p).with_only_columns(Customer.id).scalar_subquery()


def get_customer(db: Session, p: Principal, customer_id: str) -> Customer:
    c = db.execute(customer_scope(p).where(Customer.id == customer_id)).scalar_one_or_none()
    if c is None:
        raise not_found()
    return c


def project_scope(p: Principal) -> Select:
    return select(Project).where(Project.customer_id.in_(visible_customer_ids(p)))


def get_project(db: Session, p: Principal, project_id: str) -> Project:
    pr = db.execute(project_scope(p).where(Project.id == project_id)).scalar_one_or_none()
    if pr is None:
        raise not_found()
    return pr


def get_bill(db: Session, p: Principal, bill_id: str) -> Bill:
    b = db.execute(
        select(Bill).where(Bill.id == bill_id, Bill.customer_id.in_(visible_customer_ids(p)))
    ).scalar_one_or_none()
    if b is None:
        raise not_found()
    return b


def get_calculation(db: Session, p: Principal, calc_id: str) -> Calculation:
    c = db.get(Calculation, calc_id)
    if c is None:
        raise not_found()
    get_project(db, p, c.project_id)
    return c


def get_proposal(db: Session, p: Principal, proposal_id: str) -> Proposal:
    pr = db.get(Proposal, proposal_id)
    if pr is None or not p.has("proposals.view"):
        raise not_found()
    get_project(db, p, pr.project_id)
    return pr
