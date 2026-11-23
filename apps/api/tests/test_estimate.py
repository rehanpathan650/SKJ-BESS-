"""Automatic BESS estimate from uploaded bills (web and Android show it on the bill and customer/project pages)."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Bill


def _customer(client, h, name="Estimate Co"):
    return client.post("/api/v1/customers", json={"name": name}, headers=h).json()


def _bill_with_values(client, h, cid, values: dict, status="needs_review"):
    r = client.post(f"/api/v1/customers/{cid}/bills", headers=h, files={"files": ("bill.csv", b"a,b\n1,2\n", "text/csv")})
    bid = r.json()[0]["id"]
    db = SessionLocal()  # simulate the worker having scanned and read the bill
    try:
        b = db.get(Bill, bid)
        b.status = status
        b.extracted = values
        if status == "reviewed":
            b.reviewed = values
        db.commit()
    finally:
        db.close()
    return bid


GOOD = {"units_kwh": 150000, "recorded_max_demand_kva": 950, "contract_demand_kva": 1000, "tod_peak_kwh": 45000,
        "energy_rate_inr_per_unit": 8.0, "demand_rate_inr_per_kva": 450, "total_amount_inr": 1_650_000}


def test_estimate_available_as_soon_as_values_are_extracted(client, team):
    h = team["sales"]["h"]
    cid = _customer(client, h)["id"]
    bid = _bill_with_values(client, h, cid, GOOD)
    e = client.get(f"/api/v1/bills/{bid}/estimate", headers=h).json()
    assert e["available"] is True and e["basis"] == "unreviewed"
    assert e["inputs"]["battery_capacity_kwh"] >= 50 and e["inputs"]["monthly_consumption_kwh"] == 150000
    assert e["results"]["financial"]["year1_net_saving_inr"] > 0
    assert "commercial" not in e  # sales never sees vendor cost / margin

    # The customer page shows the same estimate (from unconfirmed values until a person confirms one).
    a = client.get(f"/api/v1/customers/{cid}/bill-analysis", headers=h).json()
    assert a["bill_count"] == 0 and a["estimate"]["available"] and a["estimate"]["basis"] == "unreviewed"


def test_estimate_uses_confirmed_values_once_reviewed(client, team):
    h = team["sales"]["h"]
    cid = _customer(client, h)["id"]
    _bill_with_values(client, h, cid, {**GOOD, "units_kwh": 1}, status="needs_review")  # wrong, unconfirmed
    _bill_with_values(client, h, cid, GOOD, status="reviewed")
    a = client.get(f"/api/v1/customers/{cid}/bill-analysis", headers=h).json()
    assert a["estimate"]["basis"] == "reviewed" and a["estimate"]["inputs"]["monthly_consumption_kwh"] == 150000


def test_estimate_explains_missing_data_and_respects_permissions(client, team):
    h = team["sales"]["h"]
    cid = _customer(client, h)["id"]
    bid = _bill_with_values(client, h, cid, {"units_kwh": None})
    e = client.get(f"/api/v1/bills/{bid}/estimate", headers=h).json()
    assert e["available"] is False and "Units consumed" in e["reason"]
    # Read-only users (no calculator.use) get no estimate at all.
    assert client.get(f"/api/v1/bills/{bid}/estimate", headers=team["readonly"]["h"]).status_code in (403, 404)


def test_confidential_margin_only_for_permitted_roles(client, team):
    h = team["sales"]["h"]
    cid = _customer(client, h)["id"]
    _bill_with_values(client, h, cid, GOOD, status="reviewed")
    db = SessionLocal()
    try:
        assert db.execute(select(Bill)).scalars().first() is not None
    finally:
        db.close()
    # Management can see every customer and has confidential access.
    a = client.get(f"/api/v1/customers/{cid}/bill-analysis", headers=team["mgmt"]["h"]).json()
    assert "commercial" in a["estimate"] and a["estimate"]["commercial"]["gross_margin_inr"] is not None
