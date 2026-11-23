"""Create a fresh, throwaway database for end-to-end tests and UI review.

  python e2e/seed_e2e.py            (run from apps/api)

* Never touches dev.db or any real database: it refuses to run unless DATABASE_URL points at e2e/e2e.db.
* One active user per role. A random test password and per-user authenticator secrets are generated on every
  run and written to apps/web/e2e/.auth/fixtures.json (git-ignored) for Playwright. Nothing is printed.
* Sample customers/projects spread over the last 12 months so the dashboard charts have something to show.
"""
from __future__ import annotations

import json
import os
import random
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "e2e.db"
FIXTURES = HERE.parents[1] / "web" / "e2e" / ".auth" / "fixtures.json"
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB.as_posix()}")
os.environ.setdefault("STORAGE_DIR", str(HERE / "storage"))
if Path(os.environ["DATABASE_URL"].removeprefix("sqlite:///")).resolve() != DB.resolve():
    sys.exit("Refusing to run: DATABASE_URL must point at apps/api/e2e/e2e.db")
sys.path.insert(0, str(HERE.parent))

import pyotp  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.cli import seed  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Customer, CustomerAssignment, Department, Project, Role, User, UserStatus  # noqa: E402
from app.security import mfa  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402

PEOPLE = {
    # key: (role name, department, email)
    "admin": ("Super Administrator", "IT", "e2e.admin@skjenergy.com"),
    "it": ("IT/Security Administrator", "IT", "e2e.it@skjenergy.com"),
    "mgmt": ("Management", "Management", "e2e.mgmt@skjenergy.com"),
    "engineer": ("BESS Engineer", "Engineering", "e2e.engineer@skjenergy.com"),
    "sales": ("Sales Executive", "Sales", "e2e.sales@skjenergy.com"),
    "sales2": ("Sales Executive", "Sales", "e2e.sales2@skjenergy.com"),
    "finance": ("Finance/Commercial Team", "Finance", "e2e.finance@skjenergy.com"),
    "readonly": ("Read-only User", None, "e2e.readonly@skjenergy.com"),
}
MFA_PERMS = {"*", "users.manage", "roles.manage", "sessions.manage", "settings.manage", "pricing.manage"}

CUSTOMERS = [
    ("Shree Textiles Pvt Ltd", "Textiles", "Maharashtra", "MSEDCL"), ("Deccan Cold Storage", "Cold chain", "Telangana", "TSSPDCL"),
    ("Ganga Auto Components", "Automotive", "Uttar Pradesh", "PVVNL"), ("Kaveri Pharma", "Pharmaceuticals", "Karnataka", "BESCOM"),
    ("Narmada Steel Works", "Steel", "Gujarat", "DGVCL"), ("Malabar Seafoods", "Food processing", "Kerala", "KSEB"),
    ("Thar Cement", "Cement", "Rajasthan", "JVVNL"), ("Hooghly Paper Mills", "Paper", "West Bengal", "WBSEDCL"),
]
STAGES = ["lead", "site_survey", "technical_validation", "proposal", "negotiation", "won", "installation", "lost"]


def main() -> None:
    if DB.exists():
        DB.unlink()
    Base.metadata.create_all(engine)
    seed()
    rng = random.Random(7)
    password = "E2e-" + secrets.token_urlsafe(12)
    db = SessionLocal()
    out = {"password": password, "users": {}}
    try:
        users = {}
        for key, (role_name, dept_name, email) in PEOPLE.items():
            role = db.execute(select(Role).where(Role.name == role_name)).scalar_one()
            dept = db.execute(select(Department).where(Department.name == dept_name)).scalar_one_or_none() if dept_name else None
            need_mfa = bool(set(role.permissions) & MFA_PERMS)
            secret = pyotp.random_base32()
            u = User(email=email, full_name=f"{key.title()} Tester", password_hash=hash_password(password), status=UserStatus.ACTIVE,
                     role_id=role.id, department_id=dept.id if dept else None, mfa_enabled=need_mfa,
                     mfa_secret_enc=mfa.encrypt_secret(secret) if need_mfa else None)
            db.add(u)
            db.flush()
            users[key] = u
            out["users"][key] = {"email": email, "role": role_name, "totp_secret": secret if need_mfa else None}
        now = datetime.now(timezone.utc)
        for i, (name, industry, state, discom) in enumerate(CUSTOMERS):
            owner = users["sales"] if i % 2 == 0 else users["sales2"]
            c = Customer(name=name, company=name, industry=industry, state=state, discom=discom, tariff_category="HT Industrial",
                         contact_name="Plant Head", phone="+91 98200 00000", owner_id=owner.id, department_id=owner.department_id)
            db.add(c)
            db.flush()
            db.add(CustomerAssignment(customer_id=c.id, user_id=owner.id))
            for j in range(2):
                created = now - timedelta(days=rng.randint(5, 350))
                db.add(Project(customer_id=c.id, name=f"{name.split()[0]} BESS {'phase ' + str(j + 1) if j else ''}".strip(),
                               stage=rng.choice(STAGES), estimated_value_inr=rng.randint(8, 90) * 1_000_000,
                               target_capacity_kwh=rng.randint(2, 30) * 100, owner_id=owner.id,
                               engineer_id=users["engineer"].id if rng.random() < 0.6 else None,
                               progress_pct=rng.choice([0, 25, 50, 75, 100]), created_at=created, updated_at=created))
        db.commit()
    finally:
        db.close()
    FIXTURES.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"E2E database ready ({len(PEOPLE)} users, {len(CUSTOMERS)} customers). Logins saved to {FIXTURES}")


if __name__ == "__main__":
    main()
