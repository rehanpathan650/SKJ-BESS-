"""Compare the old (row-loading) dashboard with the new (database-aggregate) one on the load-test data.

  python loadtest/dashboard_compare.py

Runs both against the same database for a user who sees everything (management view, all 2,400 projects)
and for a sales user (30 customers). Cache is bypassed: this measures the query work only.
"""
import os
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
os.environ.update(ENVIRONMENT="test", DATABASE_URL=f"sqlite:///{(HERE / 'loadtest.db').as_posix()}",
                  STORAGE_DIR=str(HERE / "storage"))
sys.path.insert(0, str(HERE.parent))

from sqlalchemy import func, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.deps import Principal  # noqa: E402
from app.models import Bill, Calculation, Customer, Project, Proposal, User  # noqa: E402
from app.routers.misc import _dashboard  # noqa: E402
from app.services import access  # noqa: E402


def old_dashboard(db, p):
    """The previous implementation, verbatim apart from formatting: loads every visible project row."""
    cust_ids = access.visible_customer_ids(p)
    projects = list(db.execute(select(Project).where(Project.customer_id.in_(cust_ids))).scalars())
    project_ids = [x.id for x in projects]
    active_stages = {"lead", "site_survey", "technical_validation", "proposal", "negotiation", "installation"}
    by_stage = {}
    for pr in projects:
        by_stage[pr.stage] = by_stage.get(pr.stage, 0) + 1
    proposals = list(db.execute(select(Proposal).where(Proposal.project_id.in_(project_ids))).scalars()) \
        if project_ids and p.has("proposals.view") else []
    won = sum(1 for x in projects if x.stage in ("won", "installation", "commissioned"))
    db.execute(select(func.count()).select_from(Calculation).where(
        Calculation.project_id.in_(project_ids), Calculation.validation_status == "pending")).scalar()
    db.execute(select(func.count()).select_from(Bill).where(Bill.customer_id.in_(cust_ids), Bill.status == "needs_review")).scalar()
    [{"customer_name": x.customer.name} for x in sorted(projects, key=lambda x: x.updated_at, reverse=True)
     if x.engineer_id == p.id or x.owner_id == p.id][:10]
    [{"customer_name": x.customer.name} for x in sorted(projects, key=lambda x: x.estimated_value_inr, reverse=True)
     if x.stage in active_stages][:10]
    db.execute(select(func.count()).select_from(Customer).where(Customer.id.in_(cust_ids))).scalar()
    return by_stage, won, len(proposals)


def timeit(fn, n=10):
    out = []
    for _ in range(n):
        db = SessionLocal()
        t0 = time.perf_counter()
        fn(db)
        out.append((time.perf_counter() - t0) * 1000)
        db.close()
    return statistics.median(out)


db = SessionLocal()
sales_user = db.execute(select(User).where(User.email == "load1@skjenergy.com")).scalar_one()
db.close()
views = {
    "management (all 2,400 projects)": {"*"},
    "sales (own 60 projects)": {"customers.view", "proposals.view"},
}
print(f"{'view':34} {'old ms':>8} {'new ms':>8} {'faster':>7}")
for label, perms in views.items():
    p = Principal(user=sales_user, session=SimpleNamespace(), perms=perms)
    # same answer from both
    db = SessionLocal()
    assert old_dashboard(db, p)[0] == _dashboard(db, p)["projects_by_stage"], "results differ"
    db.close()
    old = timeit(lambda d: old_dashboard(d, p))
    new = timeit(lambda d: _dashboard(d, p))
    print(f"{label:34} {old:8.1f} {new:8.1f} {old / new:6.1f}x")
