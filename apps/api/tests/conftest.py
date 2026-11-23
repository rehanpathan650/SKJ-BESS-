import os
import shutil
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="skj-test-"))
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": f"sqlite:///{(_tmp / 'test.db').as_posix()}",
    "STORAGE_DIR": str(_tmp / "storage"),
    "ALLOWED_EMAIL_DOMAINS": "skjenergy.com",
    "ANTHROPIC_API_KEY": "",
    "AI_ENABLED": "false",
    "RATE_LIMIT_PER_MINUTE": "100000",
    "LOGIN_RATE_LIMIT_PER_MINUTE": "1000",
    "PUSH_ENABLED": "false",
    "SINGLE_USER_MODE": "false",  # tests must not depend on the developer's local .env; single-login tests opt in
})

import pyotp  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.cli import seed  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Department, Role, User, UserStatus  # noqa: E402
from app.security import mfa, ratelimit  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402

PASSWORD = "Correct-Horse-Battery-9"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed()
    ratelimit.store().reset()
    yield


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_tmp, ignore_errors=True)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def emails(monkeypatch):
    sent = []
    import app.routers.admin as admin_mod
    import app.routers.auth as auth_mod

    def fake(db, to, subject, body):
        sent.append({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr(auth_mod, "queue_email", fake)
    monkeypatch.setattr(admin_mod, "queue_email", fake)
    return sent


def make_user(role_name: str, email: str, department: str | None = None, mfa_enabled: bool | None = None) -> dict:
    db = SessionLocal()
    try:
        role = db.execute(select(Role).where(Role.name == role_name)).scalar_one()
        dept = db.execute(select(Department).where(Department.name == department)).scalar_one_or_none() \
            if department else None
        secret = pyotp.random_base32()
        need_mfa = mfa_enabled if mfa_enabled is not None else bool(
            set(role.permissions) & {"*", "users.manage", "roles.manage", "sessions.manage", "settings.manage",
                                     "pricing.manage"})
        u = User(email=email, full_name=email.split("@")[0].title(), password_hash=hash_password(PASSWORD),
                 status=UserStatus.ACTIVE, role_id=role.id, department_id=dept.id if dept else None,
                 mfa_enabled=need_mfa, mfa_secret_enc=mfa.encrypt_secret(secret) if need_mfa else None)
        db.add(u)
        db.commit()
        return {"id": u.id, "email": email, "secret": secret if need_mfa else None}
    finally:
        db.close()


def login(client, user: dict) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": user["email"], "password": PASSWORD, "client": "mobile"})
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("mfa_required"):
        r = client.post("/api/v1/auth/mfa/login", json={"mfa_ticket": body["mfa_ticket"],
                                                         "code": pyotp.TOTP(user["secret"]).now(), "client": "mobile"})
        assert r.status_code == 200, r.text
        body = r.json()
    return {"Authorization": f"Bearer {body['access_token']}"}


@pytest.fixture
def team(client):
    """A small team of users with bearer headers."""
    people = {
        "admin": make_user("Super Administrator", "admin@skjenergy.com", "IT"),
        "it": make_user("IT/Security Administrator", "it@skjenergy.com", "IT"),
        "sales": make_user("Sales Executive", "sales@skjenergy.com", "Sales"),
        "sales2": make_user("Sales Executive", "sales2@skjenergy.com", "Sales"),
        "engineer": make_user("BESS Engineer", "engineer@skjenergy.com", "Engineering"),
        "finance": make_user("Finance/Commercial Team", "finance@skjenergy.com", "Finance"),
        "mgmt": make_user("Management", "mgmt@skjenergy.com", "Management"),
        "readonly": make_user("Read-only User", "readonly@skjenergy.com"),
    }
    for p in people.values():
        p["h"] = login(client, p)
    return people
