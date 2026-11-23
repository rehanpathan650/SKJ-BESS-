"""Quotation flow: bill -> confirmed values -> techno-commercial quotation (numbers, PDF, single-login mode)."""
import os
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.config import get_settings
from app.db import SessionLocal
from app.models import Bill
from app.services import quotation
from app.services.extraction import msedcl_extract, validate_output

# Values as printed on a real MSEDCL HT bill (synthetic customer details).
BILL = {
    "document_is_electricity_bill": True, "consumer_name": "M/S. TEST DAL MILLS", "consumer_number": "333000000001",
    "discom": "MSEDCL", "tariff_category": "HT-I A", "bill_month": "2026-09", "contract_demand_kva": 600,
    "recorded_max_demand_kva": 288, "billed_demand_kva": 450, "units_kwh": 67486, "units_kvah": 69004,
    "tod_peak_kwh": 22284, "tod_normal_kwh": 10868, "tod_offpeak_kwh": 35853, "energy_rate_inr_per_unit": 8.44,
    "demand_rate_inr_per_kva": 650, "tod_peak_surcharge_inr_per_unit": 2.11, "tod_peak_charge_inr": 47019.24,
    "demand_charge_inr": 292500, "total_amount_inr": 1129730, "solar_capacity_kw": 600, "solar_generation_kwh": 25505,
    "tod_peak_window_hours": 7, "tod_offpeak_rebate_inr_per_unit": 0, "activity": "DAL MILLS",
    "consumer_address": "Shelgaon, Barshi - 413401", "confidence": 1, "embedded_instructions_detected": False,
}


@pytest.fixture
def single_user(monkeypatch):
    monkeypatch.setattr(get_settings(), "single_user_mode", True)


def _start(client, h, values=BILL, status="reviewed"):
    r = client.post("/api/v1/quotations/start", headers=h, files={"files": ("bill.csv", b"a,b\n1,2\n", "text/csv")})
    assert r.status_code == 201, r.text
    body = r.json()
    db = SessionLocal()
    try:  # simulate the worker reading the bill and a person confirming it
        b = db.get(Bill, body["bills"][0]["id"])
        clean, _ = validate_output(values)
        b.extracted = clean
        b.status = status
        if status == "reviewed":
            b.reviewed = clean
        from app.routers.quotations import fill_customer_from_bill
        fill_customer_from_bill(db, b)
        db.commit()
    finally:
        db.close()
    return body


def test_emi_and_schedule_match_the_bank_formula():
    s = quotation.loan_schedule(15_400_000, 10.5, 5)
    assert s["emi"] == 331006  # same EMI as a bank calculator for 1.54 Cr @ 10.5% over 60 months
    assert sum(y["principal"] for y in s["yearly"]) == pytest.approx(15_400_000, abs=5)
    assert s["yearly"][-1]["closing_balance"] == 0
    assert quotation.inr(12345678) == "₹1,23,45,678"


def test_milestones_must_add_to_100():
    with pytest.raises(ValueError):
        quotation.QuoteOptions(milestones=[{"label": "Advance", "pct": 50}])


def test_single_login_bill_to_quotation(client, team, single_user):
    h = team["admin"]["h"]
    started = _start(client, h)
    # The customer is named from the bill.
    cust = client.get(f"/api/v1/customers/{started['customer_id']}", headers=h).json()
    assert cust["name"] == "M/S. TEST DAL MILLS" and cust["discom"] == "MSEDCL"
    assert cust["projects"][0]["name"] == "TEST BESS"  # "M/S." prefix dropped, name itself untouched

    pid = started["project_id"]
    prev = client.post(f"/api/v1/projects/{pid}/quotation/preview", headers=h, json={}).json()
    q = prev["content"]
    assert prev["inputs"]["peak_window_hours"] == 7 and prev["inputs"]["offpeak_tariff_inr"] == 8.44
    assert sum(x["amount"] for x in q["boq"]["lines"]) == q["boq"]["subtotal"]
    assert q["boq"]["total"] == q["boq"]["subtotal"] + q["boq"]["gst"]
    assert sum(m["amount"] for m in q["payment_schedule"]) == q["boq"]["subtotal"]
    assert q["financing"]["loan"] == q["boq"]["total"] - q["financing"]["down_payment"]
    assert any("minimum billing" in o for o in q["observations"])  # billed 450 vs recorded 288 is explained

    # Contract-demand revision is shown separately and not counted by default.
    opts = {"inputs": {**prev["inputs"], "proposed_contract_demand_kva": 400}}
    q2 = client.post(f"/api/v1/projects/{pid}/quotation/preview", headers=h, json=opts).json()["content"]
    assert q2["savings"]["cd_revision_yearly"] > 0 and q2["savings"]["cd_revision_counted"] is False
    assert q2["savings"]["net_year1"] == q["savings"]["net_year1"]

    r = client.post(f"/api/v1/projects/{pid}/quotation", headers=h, json={"options": {"tenure_years": 7}})
    assert r.status_code == 201, r.text
    pr = r.json()
    assert pr["status"] == "approved" and pr["has_quotation"] and pr["quotation_number"].startswith("SKJ/BESS/")
    full = client.get(f"/api/v1/proposals/{pr['id']}", headers=h).json()
    assert full["quotation"]["financing"]["tenure_years"] == 7
    assert "commercial" not in full["quotation"] and "gross_margin" not in str(full["quotation"])
    pdf = client.get(f"/api/v1/proposals/{pr['id']}/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    import io
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    for words in ("Bill of quantities", "payment schedule", "Financing proposal", "Installation layout",
                  "Energy savings and payback", "M/S. TEST DAL MILLS", "₹"):
        assert words in text, words


def test_signup_is_off_in_single_login_mode(client, single_user):
    r = client.post("/api/v1/auth/signup", json={"full_name": "X Y", "email": "x@skjenergy.com",
                                                 "password": "Some long password 2026"})
    assert r.status_code == 403
    assert client.get("/api/v1/app-config").json() == {"single_user_mode": True}


def test_multi_user_mode_still_requires_validation(client, team):
    h = team["sales"]["h"]
    pid = _start(client, h)["project_id"]
    r = client.post(f"/api/v1/projects/{pid}/quotation", headers=h, json={})
    assert r.status_code == 400 and "validated" in r.json()["detail"]


def test_quotation_needs_a_confirmed_bill(client, team, single_user):
    h = team["admin"]["h"]
    pid = _start(client, h, status="needs_review")["project_id"]
    r = client.post(f"/api/v1/projects/{pid}/quotation/preview", headers=h, json={})
    assert r.status_code == 400 and "Confirm" in r.json()["detail"]


def test_ai_wording_cannot_invent_amounts():
    allowed = {"₹2,20,00,000", "₹2.20 crore"}
    assert quotation._amounts_ok("Project value ₹2,20,00,000 plus GST.", allowed)
    assert not quotation._amounts_ok("You will save Rs 50,00,000 a year.", allowed)


# Real bills contain customer data, so they are never stored in the repository. To test with real MSEDCL bills,
# point SKJ_SAMPLE_BILLS at a local folder of bill PDFs:  set SKJ_SAMPLE_BILLS=C:\path\to\bills
_DIR = os.environ.get("SKJ_SAMPLE_BILLS")
REAL = sorted(p for p in Path(_DIR).glob("*") if p.suffix.lower() == ".pdf") if _DIR and Path(_DIR).is_dir() else []


@pytest.mark.parametrize("path", REAL or [None], ids=lambda p: "sample-bill" if p else "no-samples")
def test_real_msedcl_bills_if_present(path):
    """Runs only when SKJ_SAMPLE_BILLS points at real bills on this machine."""
    if path is None:
        pytest.skip("set SKJ_SAMPLE_BILLS to a folder of real MSEDCL bill PDFs to run this test")
    text = "\n".join(p.extract_text() or "" for p in PdfReader(str(path)).pages)
    clean, flags = validate_output(msedcl_extract(text))
    assert not flags
    for key in ("consumer_name", "contract_demand_kva", "recorded_max_demand_kva", "billed_demand_kva", "units_kwh",
                "tod_peak_kwh", "tod_peak_surcharge_inr_per_unit", "demand_rate_inr_per_kva", "total_amount_inr"):
        assert clean[key] not in (None, ""), key
    assert clean["contract_demand_kva"] in (600, 1150) and clean["demand_rate_inr_per_kva"] == 650
