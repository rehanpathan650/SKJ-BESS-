import base64
import json

from tests.conftest import login, make_user

API = "/api/v1"


def _customer(client, h, name="Acme Foods"):
    r = client.post(f"{API}/customers", json={"name": name}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_idor_other_sales_cannot_see_customer(client, team):
    cid = _customer(client, team["sales"]["h"])
    # Another sales executive: not found (same as non-existent), and not in list
    assert client.get(f"{API}/customers/{cid}", headers=team["sales2"]["h"]).status_code == 404
    assert client.get(f"{API}/customers/does-not-exist", headers=team["sales2"]["h"]).status_code == 404
    assert client.get(f"{API}/customers", headers=team["sales2"]["h"]).json()["total"] == 0
    assert client.patch(f"{API}/customers/{cid}", json={"name": "Hacked"}, headers=team["sales2"]["h"]).status_code == 404
    assert client.get(f"{API}/customers/{cid}/bills", headers=team["sales2"]["h"]).status_code == 404
    # Management (view_all) can see it
    assert client.get(f"{API}/customers/{cid}", headers=team["mgmt"]["h"]).status_code == 200


def test_it_admin_has_no_customer_data(client, team):
    cid = _customer(client, team["sales"]["h"])
    assert client.get(f"{API}/customers/{cid}", headers=team["it"]["h"]).status_code == 404
    assert client.get(f"{API}/customers", headers=team["it"]["h"]).json()["total"] == 0


def test_read_only_cannot_write(client, team):
    assert client.post(f"{API}/customers", json={"name": "X Co"}, headers=team["readonly"]["h"]).status_code == 403
    assert client.post(f"{API}/calculator/preview", json={}, headers=team["readonly"]["h"]).status_code == 403


def test_assignment_grants_access(client, team):
    cid = _customer(client, team["sales"]["h"])
    ro = team["readonly"]
    assert client.get(f"{API}/customers/{cid}", headers=ro["h"]).status_code == 404
    r = client.post(f"{API}/customers/{cid}/assignments", json={"user_id": ro["id"]}, headers=team["mgmt"]["h"])
    assert r.status_code == 201
    assert client.get(f"{API}/customers/{cid}", headers=ro["h"]).status_code == 200


def test_sales_cannot_change_owner(client, team):
    cid = _customer(client, team["sales"]["h"])
    r = client.patch(f"{API}/customers/{cid}", json={"owner_id": team["sales2"]["id"]}, headers=team["sales"]["h"])
    assert r.status_code == 403


def test_privilege_escalation_blocked(client, team):
    roles = {x["name"]: x["id"] for x in client.get(f"{API}/roles", headers=team["it"]["h"]).json()}
    # IT admin cannot create a role with permissions it lacks, or "*"
    r = client.post(f"{API}/roles", json={"name": "Sneaky", "permissions": ["commercial.confidential.view"]},
                    headers=team["it"]["h"])
    assert r.status_code == 403
    r = client.post(f"{API}/roles", json={"name": "Sneaky2", "permissions": ["*"]}, headers=team["it"]["h"])
    assert r.status_code == 400  # "*" is not a grantable catalogue permission
    # IT admin cannot give someone the Super Administrator or Finance role
    target = team["readonly"]["id"]
    for role in ("Super Administrator", "Finance/Commercial Team"):
        r = client.patch(f"{API}/users/{target}", json={"role_id": roles[role]}, headers=team["it"]["h"])
        assert r.status_code == 403, role
    # IT admin cannot disable the Super Administrator, nor change itself
    assert client.post(f"{API}/users/{team['admin']['id']}/disable", headers=team["it"]["h"]).status_code == 403
    assert client.patch(f"{API}/users/{team['it']['id']}", json={"role_id": roles["Management"]},
                        headers=team["it"]["h"]).status_code == 400
    # Sales cannot list users at all
    assert client.get(f"{API}/users", headers=team["sales"]["h"]).status_code == 403


def test_custom_role(client, team):
    r = client.post(f"{API}/roles", json={"name": "Site Surveyor", "permissions": ["customers.view", "bills.upload"]},
                    headers=team["admin"]["h"])
    assert r.status_code == 201
    rid = r.json()["id"]
    r = client.patch(f"{API}/users/{team['readonly']['id']}", json={"role_id": rid}, headers=team["admin"]["h"])
    assert r.status_code == 200
    h = login(client, team["readonly"])  # role change revoked old sessions
    assert client.get(f"{API}/auth/me", headers=team["readonly"]["h"]).status_code == 401
    assert "bills.upload" in client.get(f"{API}/auth/me", headers=h).json()["permissions"]


def test_disabled_user_loses_access(client, team):
    h = team["sales"]["h"]
    assert client.post(f"{API}/users/{team['sales']['id']}/disable", headers=team["admin"]["h"]).status_code == 200
    assert client.get(f"{API}/customers", headers=h).status_code == 401


def _b64(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


def test_token_tampering_rejected(client, team):
    token = team["sales"]["h"]["Authorization"].split()[1]
    header, payload, sig = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
    # alg=none
    none_token = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{payload}."
    assert client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {none_token}"}).status_code == 401
    # change the subject but keep the signature
    claims["sub"] = team["admin"]["id"]
    forged = f"{header}.{_b64(claims)}.{sig}"
    assert client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get(f"{API}/customers").status_code == 401


def test_confidential_pricing_hidden_from_sales(client, team):
    payload = {"monthly_consumption_kwh": 100000, "peak_tariff_inr": 9.5, "offpeak_tariff_inr": 7,
               "battery_capacity_kwh": 500, "battery_power_kw": 250, "recorded_max_demand_kva": 800,
               "contract_demand_kva": 900, "demand_charge_inr_per_kva": 400}
    sales = client.post(f"{API}/calculator/preview", json=payload, headers=team["sales"]["h"]).json()
    assert "commercial" not in sales
    assert "margin" not in json.dumps(sales).lower()
    assert "vendor" not in json.dumps(sales).lower()
    fin = client.post(f"{API}/calculator/preview", json=payload, headers=team["finance"]["h"]).json()
    assert fin["commercial"]["gross_margin_inr"] > 0
    assert client.get(f"{API}/settings/commercial", headers=team["sales"]["h"]).status_code == 403
    assert "confidential" not in client.get(f"{API}/calculator/defaults", headers=team["sales"]["h"]).json()
    # Sales cannot change pricing
    assert client.put(f"{API}/settings/commercial", json={"margin_pct": 1},
                      headers=team["sales"]["h"]).status_code == 403


def test_input_validation(client, team):
    h = team["sales"]["h"]
    r = client.post(f"{API}/customers", json={"name": "A" * 500}, headers=h)
    assert r.status_code == 422 and "A" * 50 not in r.text  # values not echoed back
    r = client.post(f"{API}/customers", json={"name": "Ok Co", "phone": "<script>"}, headers=h)
    assert r.status_code == 422
    r = client.get(f"{API}/customers?q=' OR 1=1 --", headers=h)
    assert r.status_code == 200 and r.json()["total"] == 0


def test_security_headers(client, team):
    r = client.get(f"{API}/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"


def test_cors_only_allows_configured_origin(client):
    r = client.options(f"{API}/auth/login", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") is None
    r = client.options(f"{API}/auth/login", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_admin_session_revocation(client, team):
    sessions = client.get(f"{API}/admin/sessions", headers=team["it"]["h"]).json()
    target = next(s for s in sessions if s["user"]["email"] == "sales@skjenergy.com")
    assert client.delete(f"{API}/admin/sessions/{target['id']}", headers=team["it"]["h"]).status_code == 200
    assert client.get(f"{API}/auth/me", headers=team["sales"]["h"]).status_code == 401


def test_rate_limit_on_login(client, monkeypatch):
    from app.config import get_settings

    make_user("Sales Executive", "rl@skjenergy.com")
    monkeypatch.setattr(get_settings(), "login_rate_limit_per_minute", 3)
    codes = [client.post(f"{API}/auth/login", json={"email": "rl@skjenergy.com", "password": "x" * 12,
                                                     "client": "mobile"}).status_code for _ in range(5)]
    assert 429 in codes
