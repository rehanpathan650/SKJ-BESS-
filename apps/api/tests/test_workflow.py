import io

from reportlab.pdfgen import canvas

from app import audit
from app.db import SessionLocal
from app.models import AuditLog
from app.worker import run_once

API = "/api/v1"


def make_pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for line in lines:
        c.drawString(50, y, line)
        y -= 20
    c.save()
    return buf.getvalue()


BILL_LINES = [
    "MAHARASHTRA STATE ELECTRICITY DISTRIBUTION CO LTD",
    "Consumer No: 123456789  Tariff: HT-I Industrial",
    "Contract Demand (kVA): 900",
    "Recorded Max Demand (kVA): 820",
    "Total Units kWh Consumed: 145,000",
    "Power Factor: 0.97",
    "Energy Charges Rs: 11,02,000",
    "Total Amount Payable Rs: 14,85,000",
]


def _setup_project(client, team):
    cid = client.post(f"{API}/customers", json={"name": "Shree Textiles", "state": "Maharashtra"},
                      headers=team["sales"]["h"]).json()["id"]
    pid = client.post(f"{API}/projects", json={"customer_id": cid, "name": "Shree BESS",
                                               "engineer_id": team["engineer"]["id"], "estimated_value_inr": 2.5e7},
                      headers=team["sales"]["h"]).json()["id"]
    return cid, pid


def test_full_bess_workflow(client, team):
    cid, pid = _setup_project(client, team)
    # Engineer was notified about the assignment and can see the project
    notes = client.get(f"{API}/notifications", headers=team["engineer"]["h"]).json()
    assert any(n["kind"] == "project_assigned" for n in notes["items"])
    assert client.get(f"{API}/projects/{pid}", headers=team["engineer"]["h"]).status_code == 200

    # Upload two bills
    files = [("files", ("bill-jan.pdf", make_pdf(BILL_LINES), "application/pdf")),
             ("files", ("bill-feb.pdf", make_pdf(BILL_LINES), "application/pdf"))]
    r = client.post(f"{API}/customers/{cid}/bills", files=files, data={"project_id": pid}, headers=team["sales"]["h"])
    assert r.status_code == 201, r.text
    bill_ids = [b["id"] for b in r.json()]
    assert run_once() >= 2
    bill = client.get(f"{API}/bills/{bill_ids[0]}", headers=team["sales"]["h"]).json()
    assert bill["status"] == "needs_review"
    assert bill["extraction_method"] == "text"
    assert bill["extracted"]["units_kwh"] == 145000
    assert bill["scan_status"] == "skipped"

    # Review and correct
    for i, bid in enumerate(bill_ids):
        r = client.put(f"{API}/bills/{bid}/review", json={"values": {
            "bill_month": f"2026-0{i + 1}", "units_kwh": 145000, "tod_peak_kwh": 40000,
            "energy_rate_inr_per_unit": 7.6, "demand_rate_inr_per_kva": 410,
            "contract_demand_kva": 900, "recorded_max_demand_kva": 820, "total_amount_inr": 1485000}},
            headers=team["sales"]["h"])
        assert r.status_code == 200, r.text
    # Out of range correction is refused
    r = client.put(f"{API}/bills/{bill_ids[0]}/review", json={"values": {"power_factor": 7}}, headers=team["sales"]["h"])
    assert r.status_code == 400

    analysis = client.get(f"{API}/projects/{pid}/bill-analysis", headers=team["sales"]["h"]).json()
    assert analysis["bill_count"] == 2
    pre = analysis["calculator_prefill"]
    assert pre["monthly_consumption_kwh"] == 145000 and pre["battery_capacity_kwh"] > 0

    # Calculator: two configurations
    base = {k: pre[k] for k in ("monthly_consumption_kwh", "peak_share_pct", "peak_tariff_inr", "offpeak_tariff_inr",
                                 "contract_demand_kva", "recorded_max_demand_kva", "demand_charge_inr_per_kva")}
    ids = []
    for cap, pw in ((pre["battery_capacity_kwh"], pre["battery_power_kw"]), (1000, 500)):
        r = client.post(f"{API}/projects/{pid}/calculations",
                        json={"name": f"{cap} kWh", "inputs": {**base, "battery_capacity_kwh": cap, "battery_power_kw": pw}},
                        headers=team["sales"]["h"])
        assert r.status_code == 201, r.text
        assert "commercial" not in r.json()
        ids.append(r.json()["id"])
    cmp = client.post(f"{API}/calculations/compare", json={"ids": ids}, headers=team["sales"]["h"]).json()
    assert len(cmp) == 2 and "gross_margin_pct" not in cmp[0]

    # Proposal needs technical validation first
    r = client.post(f"{API}/projects/{pid}/proposals", json={"calculation_id": ids[0]}, headers=team["sales"]["h"])
    assert r.status_code == 400
    # Sales cannot validate; engineer can
    assert client.post(f"{API}/calculations/{ids[0]}/validate", json={"decision": "approved"},
                       headers=team["sales"]["h"]).status_code == 403
    r = client.post(f"{API}/calculations/{ids[0]}/validate", json={"decision": "approved", "note": "OK for site"},
                    headers=team["engineer"]["h"])
    assert r.status_code == 200 and r.json()["validation_status"] == "approved"

    # Generate, submit, approve
    r = client.post(f"{API}/projects/{pid}/proposals", json={"calculation_id": ids[0]}, headers=team["sales"]["h"])
    assert r.status_code == 201, r.text
    prop = r.json()
    assert prop["revision"] == 1 and prop["status"] == "draft"
    pdf = client.get(f"{API}/proposals/{prop['id']}/pdf", headers=team["sales"]["h"])
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    # Sharing a draft is refused
    assert client.post(f"{API}/proposals/{prop['id']}/share", json={}, headers=team["sales"]["h"]).status_code == 400
    assert client.post(f"{API}/proposals/{prop['id']}/submit", headers=team["sales"]["h"]).status_code == 200
    # Sales cannot approve; finance can
    assert client.post(f"{API}/proposals/{prop['id']}/approve", json={}, headers=team["sales"]["h"]).status_code == 403
    r = client.post(f"{API}/proposals/{prop['id']}/approve", json={"note": "Approved"}, headers=team["finance"]["h"])
    assert r.status_code == 200 and r.json()["status"] == "approved"

    # Share link works externally, then is revoked
    r = client.post(f"{API}/proposals/{prop['id']}/share", json={"recipient_note": "CFO", "days": 3},
                    headers=team["sales"]["h"])
    assert r.status_code == 201
    url = r.json()["url"]
    path = url[url.index("/api/v1"):]
    ext = client.get(path)
    assert ext.status_code == 200 and ext.content.startswith(b"%PDF")
    assert b"vendor" not in ext.content.lower()
    share_id = client.get(f"{API}/proposals/{prop['id']}/shares", headers=team["sales"]["h"]).json()[0]["id"]
    client.delete(f"{API}/proposals/{prop['id']}/shares/{share_id}", headers=team["sales"]["h"])
    assert client.get(path).status_code == 404

    # Revision 2 supersedes open drafts
    client.post(f"{API}/calculations/{ids[1]}/validate", json={"decision": "approved"}, headers=team["engineer"]["h"])
    r2 = client.post(f"{API}/projects/{pid}/proposals", json={"calculation_id": ids[1]}, headers=team["sales"]["h"]).json()
    assert r2["revision"] == 2

    # Accepting marks the project won; dashboard reflects it
    client.post(f"{API}/proposals/{prop['id']}/status", json={"status": "accepted"}, headers=team["sales"]["h"])
    dash = client.get(f"{API}/dashboard", headers=team["mgmt"]["h"]).json()
    assert dash["kpis"]["won_projects"] == 1
    assert "gross_margin_in_open_proposals_inr" in dash["kpis"]
    sales_dash = client.get(f"{API}/dashboard", headers=team["sales"]["h"]).json()
    assert "gross_margin_in_open_proposals_inr" not in sales_dash["kpis"]

    # Audit trail recorded and intact
    v = client.get(f"{API}/security/audit/verify", headers=team["admin"]["h"]).json()
    assert v["valid"] and v["checked"] > 20


def test_engineer_cannot_validate_own_configuration(client, team):
    cid = client.post(f"{API}/customers", json={"name": "Eng Co"}, headers=team["sales"]["h"]).json()["id"]
    pid = client.post(f"{API}/projects", json={"customer_id": cid, "name": "Eng Project", "engineer_id": team["engineer"]["id"]},
                      headers=team["sales"]["h"]).json()["id"]
    calc = client.post(f"{API}/projects/{pid}/calculations", json={"name": "own", "inputs": {
        "monthly_consumption_kwh": 50000, "peak_tariff_inr": 9, "offpeak_tariff_inr": 6.5,
        "battery_capacity_kwh": 200, "battery_power_kw": 100}}, headers=team["engineer"]["h"]).json()
    r = client.post(f"{API}/calculations/{calc['id']}/validate", json={"decision": "approved"},
                    headers=team["engineer"]["h"])
    assert r.status_code == 403


def test_audit_chain_detects_tampering(client, team):
    assert audit.verify_chain()["valid"]
    db = SessionLocal()
    e = db.query(AuditLog).order_by(AuditLog.id).offset(2).first()
    e.actor_email = "someone-else@skjenergy.com"
    db.commit()
    db.close()
    result = audit.verify_chain()
    assert result["valid"] is False and result["broken_at_id"] == e.id


def test_security_dashboard_permissions(client, team):
    assert client.get(f"{API}/security/overview", headers=team["it"]["h"]).status_code == 200
    assert client.get(f"{API}/security/overview", headers=team["sales"]["h"]).status_code == 403
    assert client.get(f"{API}/security/audit", headers=team["mgmt"]["h"]).status_code == 200
    assert client.get(f"{API}/security/audit", headers=team["engineer"]["h"]).status_code == 403
