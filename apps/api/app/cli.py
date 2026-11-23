"""Admin command line.

  python -m app.cli init-db                 create tables (dev/test; production uses `alembic upgrade head`)
  python -m app.cli seed                    create default roles and departments
  python -m app.cli create-superadmin       create the first Super Administrator (prompts for password)
  python -m app.cli create-user --email x@skjenergy.com --name "X" --role "Sales Executive"
  python -m app.cli verify-audit            verify the audit hash chain
  python -m app.cli demo-data               add sample customers/projects (development only)
  python -m app.cli dev-users               add one test login per role (development only; see dev-logins.txt)
"""
from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import select

from app import audit
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.models import Department, Role, User, UserStatus
from app.security import permissions as P
from app.security.passwords import hash_password, password_problems


def init_db() -> None:
    """Create tables and any missing indexes (safe to re-run on an existing dev database)."""
    Base.metadata.create_all(engine)
    # Development databases: add new nullable columns to existing tables (production uses Alembic migrations).
    # Uses Alembic's schema operations, so no SQL text is assembled by hand.
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import Column, inspect

    insp = inspect(engine)
    with engine.begin() as conn:
        ops = Operations(MigrationContext.configure(conn))
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing and col.nullable:
                    ops.add_column(table.name, Column(col.name, col.type, nullable=True))
                    print(f"Added column {table.name}.{col.name}")
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            index.create(engine, checkfirst=True)
    print("Tables and indexes are in place.")


def seed() -> None:
    db = SessionLocal()
    try:
        for name, spec in P.DEFAULT_ROLES.items():
            role = db.execute(select(Role).where(Role.name == name)).scalar_one_or_none()
            if role is None:
                db.add(Role(name=name, description=spec["description"], permissions=spec["permissions"], is_system=True))
        for name in P.DEFAULT_DEPARTMENTS:
            if db.execute(select(Department).where(Department.name == name)).scalar_one_or_none() is None:
                db.add(Department(name=name))
        db.commit()
        print("Default roles and departments are in place.")
    finally:
        db.close()


def create_superadmin(email: str, name: str, password: str | None) -> None:
    seed()
    password = password or getpass.getpass("Password (min 12 chars): ")
    problems = password_problems(password, email, name)
    if problems:
        sys.exit("; ".join(problems))
    db = SessionLocal()
    try:
        role = db.execute(select(Role).where(Role.name == "Super Administrator")).scalar_one()
        it = db.execute(select(Department).where(Department.name == "IT")).scalar_one_or_none()
        if db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none():
            sys.exit("A user with this email already exists.")
        u = User(email=email.lower(), full_name=name, password_hash=hash_password(password), status=UserStatus.ACTIVE,
                 role_id=role.id, department_id=it.id if it else None)
        db.add(u)
        db.commit()
        audit.record("user", "superadmin.created_via_cli", actor=u, target_type="user", target_id=u.id)
        print(f"Super Administrator {email} created. MFA setup will be required at first login.")
    finally:
        db.close()


def create_user(email: str, name: str, role_name: str, password: str | None) -> None:
    """Create an already-approved user (for scripted test accounts; normal users sign up)."""
    password = password or getpass.getpass("Password (min 12 chars): ")
    problems = password_problems(password, email, name)
    if problems:
        sys.exit("; ".join(problems))
    db = SessionLocal()
    try:
        role = db.execute(select(Role).where(Role.name == role_name)).scalar_one_or_none()
        if role is None:
            sys.exit(f"Unknown role: {role_name}")
        if db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none():
            sys.exit("A user with this email already exists.")
        u = User(email=email.lower(), full_name=name, password_hash=hash_password(password), status=UserStatus.ACTIVE,
                 role_id=role.id)
        db.add(u)
        db.commit()
        audit.record("user", "user.created_via_cli", actor=u, target_type="user", target_id=u.id,
                     details={"role": role_name})
        print(f"User {email} created with role {role_name}.")
    finally:
        db.close()


DEV_USERS = [
    # (email, full name, role, department)
    ("it.test@skjenergy.com", "Irfan IT", "IT/Security Administrator", "IT"),
    ("management.test@skjenergy.com", "Meera Management", "Management", "Management"),
    ("engineer.test@skjenergy.com", "Esha Engineer", "BESS Engineer", "Engineering"),
    ("sales.test@skjenergy.com", "Sameer Sales", "Sales Executive", "Sales"),
    ("finance.test@skjenergy.com", "Farah Finance", "Finance/Commercial Team", "Finance"),
    ("readonly.test@skjenergy.com", "Rohan Readonly", "Read-only User", None),
]


def dev_users() -> None:
    """Development only: one approved test login per role, all sharing one generated password.

    Adds missing users only (never changes or deletes existing ones). The password is written to
    apps/api/dev-logins.txt (git-ignored), not printed. Roles that require MFA set it up at first login.
    """
    import secrets
    from pathlib import Path

    if get_settings().is_production:
        sys.exit("Refusing to create test logins in production.")
    seed()
    password = "Dev-" + secrets.token_urlsafe(9)
    db = SessionLocal()
    created = []
    try:
        for email, name, role_name, dept_name in DEV_USERS:
            if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
                continue
            role = db.execute(select(Role).where(Role.name == role_name)).scalar_one()
            dept = db.execute(select(Department).where(Department.name == dept_name)).scalar_one_or_none() if dept_name else None
            db.add(User(email=email, full_name=name, password_hash=hash_password(password), status=UserStatus.ACTIVE,
                        role_id=role.id, department_id=dept.id if dept else None))
            created.append((email, role_name))
        db.commit()
    finally:
        db.close()
    out = Path(__file__).resolve().parents[1] / "dev-logins.txt"
    if created:
        lines = ["SKJ local test logins (development database only; do not use anywhere else)", "",
                 f"Password for the accounts below: {password}", ""]
        lines += [f"{role:28} {email}" for email, role in created]
        lines += ["", "IT/Security and Finance must set up an authenticator app (MFA) at first login."]
        previous = out.read_text(encoding="utf-8") if out.exists() else ""
        out.write_text("\n".join(lines) + ("\n\n--- earlier ---\n" + previous if previous else "\n"), encoding="utf-8")
        print(f"Created {len(created)} test login(s). Emails and password saved to {out}")
    else:
        print("All test logins already exist; nothing changed. See dev-logins.txt for the password.")


def reset_mfa(email: str) -> None:
    """Turn off two-step login for one account (lost phone, or single-login mode). Recorded in the audit log."""
    db = SessionLocal()
    try:
        user = db.execute(select(User).where(User.email == email.strip().lower())).scalar_one_or_none()
        if not user:
            sys.exit(f"No account with email {email}")
        if not user.mfa_enabled and not user.mfa_secret_enc:
            print("Two-step login is already off for this account.")
            return
        user.mfa_enabled = False
        user.mfa_secret_enc = None
        db.commit()
        audit.record("security", "mfa.reset_via_cli", actor=user, target_type="user", target_id=user.id)
        print(f"Two-step login turned off for {user.email}. They now sign in with email and password.")
    finally:
        db.close()


def demo_data() -> None:
    if get_settings().is_production:
        sys.exit("Refusing to add demo data in production.")
    from app.models import Customer, CustomerAssignment, Project

    db = SessionLocal()
    try:
        owner = db.execute(select(User).where(User.status == UserStatus.ACTIVE)).scalars().first()
        samples = [
            ("Shree Textiles Pvt Ltd", "Textiles", "Maharashtra", "MSEDCL", 180000, 650),
            ("Deccan Cold Storage", "Cold chain", "Telangana", "TSSPDCL", 95000, 420),
            ("Ganga Auto Components", "Automotive", "Uttar Pradesh", "PVVNL", 260000, 900),
        ]
        for name, ind, state, discom, value_kwh, kva in samples:
            c = Customer(name=name, company=name, industry=ind, state=state, discom=discom,
                         tariff_category="HT Industrial", owner_id=owner.id if owner else None)
            db.add(c)
            db.flush()
            if owner:
                db.add(CustomerAssignment(customer_id=c.id, user_id=owner.id))
            db.add(Project(customer_id=c.id, name=f"{name.split()[0]} BESS", stage="lead",
                           estimated_value_inr=value_kwh * 45, target_capacity_kwh=round(kva * 1.2, -1),
                           owner_id=owner.id if owner else None))
        db.commit()
        print("Demo data added.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    sub.add_parser("seed")
    sa = sub.add_parser("create-superadmin")
    sa.add_argument("--email", required=True)
    sa.add_argument("--name", required=True)
    sa.add_argument("--password", help="Avoid in shared shells; omit to be prompted")
    cu = sub.add_parser("create-user")
    cu.add_argument("--email", required=True)
    cu.add_argument("--name", required=True)
    cu.add_argument("--role", required=True)
    cu.add_argument("--password", help="Avoid in shared shells; omit to be prompted")
    sub.add_parser("verify-audit")
    sub.add_parser("demo-data")
    sub.add_parser("dev-users")
    rm = sub.add_parser("reset-mfa", help="Turn off two-step login for one account")
    rm.add_argument("--email", required=True)
    args = ap.parse_args()
    if args.cmd == "init-db":
        init_db()
    elif args.cmd == "seed":
        seed()
    elif args.cmd == "create-superadmin":
        create_superadmin(args.email, args.name, args.password)
    elif args.cmd == "create-user":
        create_user(args.email, args.name, args.role, args.password)
    elif args.cmd == "verify-audit":
        print(audit.verify_chain())
    elif args.cmd == "demo-data":
        demo_data()
    elif args.cmd == "dev-users":
        dev_users()
    elif args.cmd == "reset-mfa":
        reset_mfa(args.email)


if __name__ == "__main__":
    main()
