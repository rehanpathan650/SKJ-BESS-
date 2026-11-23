import re

import pyotp

from tests.conftest import PASSWORD, login, make_user

API = "/api/v1"


def _token_from(email_body: str) -> str:
    return re.search(r"token=([A-Za-z0-9_\-]+)", email_body).group(1)


def test_signup_verify_approve_flow(client, emails, team):
    # 1. Sign up
    r = client.post(f"{API}/auth/signup", json={"full_name": "Asha Rao", "email": "asha@skjenergy.com",
                                                "password": "Solar-Battery-Plan-42"})
    assert r.status_code == 202
    # 2. Cannot log in before verifying email
    r = client.post(f"{API}/auth/login", json={"email": "asha@skjenergy.com", "password": "Solar-Battery-Plan-42",
                                               "client": "mobile"})
    assert r.status_code == 403
    # 3. Verify email
    token = _token_from(emails[-1]["body"])
    assert client.post(f"{API}/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post(f"{API}/auth/verify-email", json={"token": token}).status_code == 400  # single use
    # 4. Pending user can log in but sees nothing
    r = client.post(f"{API}/auth/login", json={"email": "asha@skjenergy.com", "password": "Solar-Battery-Plan-42",
                                               "client": "mobile"})
    assert r.status_code == 200 and r.json()["status"] == "pending_approval"
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = client.get(f"{API}/auth/me", headers=h).json()
    assert me["status"] == "pending_approval" and me["permissions"] == []
    assert client.get(f"{API}/customers", headers=h).status_code == 403
    # 5. Admin sees pending user and approves with a role
    pending = client.get(f"{API}/users?status=pending_approval", headers=team["admin"]["h"]).json()
    assert [u["email"] for u in pending] == ["asha@skjenergy.com"]
    roles = {x["name"]: x["id"] for x in client.get(f"{API}/roles", headers=team["admin"]["h"]).json()}
    r = client.post(f"{API}/users/{pending[0]['id']}/approve", json={"role_id": roles["Sales Executive"]},
                    headers=team["admin"]["h"])
    assert r.status_code == 200 and r.json()["status"] == "active"
    # 6. Now has access
    assert client.get(f"{API}/customers", headers=h).status_code == 200
    me = client.get(f"{API}/auth/me", headers=h).json()
    assert "customers.create" in me["permissions"]


def test_signup_rejects_outside_domain_and_weak_password(client, emails):
    r = client.post(f"{API}/auth/signup", json={"full_name": "X Y", "email": "x@gmail.com", "password": "Strong-Pass-123!"})
    assert r.status_code == 400
    r = client.post(f"{API}/auth/signup", json={"full_name": "X Y", "email": "x@skjenergy.com", "password": "short"})
    assert r.status_code == 400
    r = client.post(f"{API}/auth/signup", json={"full_name": "X Y", "email": "x@skjenergy.com", "password": "password123"})
    assert r.status_code == 400


def test_duplicate_signup_is_not_revealed(client, emails, team):
    r = client.post(f"{API}/auth/signup", json={"full_name": "Dup", "email": "sales@skjenergy.com",
                                                "password": "Another-Strong-Pass-1"})
    assert r.status_code == 202  # same response as a new account


def test_login_errors_are_generic_and_lockout(client):
    make_user("Sales Executive", "lock@skjenergy.com")
    bad = {"email": "lock@skjenergy.com", "password": "wrong-password-xx", "client": "mobile"}
    unknown = client.post(f"{API}/auth/login", json={**bad, "email": "nobody@skjenergy.com"})
    wrong = client.post(f"{API}/auth/login", json=bad)
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]
    for _ in range(4):
        client.post(f"{API}/auth/login", json=bad)
    # Locked now: even the right password fails
    r = client.post(f"{API}/auth/login", json={**bad, "password": PASSWORD})
    assert r.status_code == 401


def test_mfa_required_for_admin_roles(client):
    u = make_user("IT/Security Administrator", "newit@skjenergy.com", mfa_enabled=False)
    r = client.post(f"{API}/auth/login", json={"email": u["email"], "password": PASSWORD, "client": "mobile"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get(f"{API}/users", headers=h).json()["detail"] == "mfa_setup_required"
    setup = client.post(f"{API}/auth/mfa/setup", headers=h).json()
    code = pyotp.TOTP(setup["secret"]).now()
    assert client.post(f"{API}/auth/mfa/enable", json={"code": code}, headers=h).status_code == 200
    assert client.get(f"{API}/users", headers=h).status_code == 200
    # Next login asks for the code
    r = client.post(f"{API}/auth/login", json={"email": u["email"], "password": PASSWORD, "client": "mobile"})
    assert r.json()["mfa_required"] is True
    r2 = client.post(f"{API}/auth/mfa/login", json={"mfa_ticket": r.json()["mfa_ticket"], "code": "000000",
                                                     "client": "mobile"})
    assert r2.status_code == 401


def test_refresh_rotation_and_reuse_detection(client):
    u = make_user("Sales Executive", "rot@skjenergy.com")
    r = client.post(f"{API}/auth/login", json={"email": u["email"], "password": PASSWORD, "client": "mobile"}).json()
    first = r["refresh_token"]
    r2 = client.post(f"{API}/auth/refresh", json={"refresh_token": first})
    assert r2.status_code == 200
    second = r2.json()["refresh_token"]
    assert second != first
    # Replaying the old token kills the whole session
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": first}).status_code == 401
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": second}).status_code == 401
    h = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    assert client.get(f"{API}/auth/me", headers=h).status_code == 401


def test_logout_revokes_access_token(client):
    u = make_user("Sales Executive", "out@skjenergy.com")
    h = login(client, u)
    assert client.post(f"{API}/auth/logout", headers=h).status_code == 200
    assert client.get(f"{API}/auth/me", headers=h).status_code == 401


def test_web_cookie_login_requires_csrf(client):
    make_user("Sales Executive", "web@skjenergy.com")
    r = client.post(f"{API}/auth/login", json={"email": "web@skjenergy.com", "password": PASSWORD, "client": "web"})
    assert r.status_code == 200
    assert "access_token" not in r.json()  # tokens only in httpOnly cookies
    csrf = r.json()["csrf_token"]
    payload = {"name": "Cookie Customer"}
    assert client.post(f"{API}/customers", json=payload).status_code == 403  # no CSRF header
    assert client.post(f"{API}/customers", json=payload, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post(f"{API}/customers", json=payload, headers={"X-CSRF-Token": csrf}).status_code == 201


def test_password_reset_revokes_sessions(client, emails):
    u = make_user("Sales Executive", "reset@skjenergy.com")
    h = login(client, u)
    client.post(f"{API}/auth/forgot-password", json={"email": u["email"]})
    token = _token_from(emails[-1]["body"])
    r = client.post(f"{API}/auth/reset-password", json={"token": token, "password": "Brand-New-Secret-77"})
    assert r.status_code == 200
    assert client.get(f"{API}/auth/me", headers=h).status_code == 401
    r = client.post(f"{API}/auth/login", json={"email": u["email"], "password": "Brand-New-Secret-77", "client": "mobile"})
    assert r.status_code == 200
