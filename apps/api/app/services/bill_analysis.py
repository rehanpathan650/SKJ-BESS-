"""Analysis of human-reviewed bills for a customer/project, and calculator pre-fill."""
from __future__ import annotations

from statistics import mean

from app.models import Bill
from app.services.bess import CalcInputs, calculate, suggest_size


def analyse(bills: list[Bill], *, include_unreviewed: bool = False) -> dict:
    """Statistics and calculator pre-fill. Uses person-confirmed values; with include_unreviewed, falls back to the
    extracted (not yet confirmed) values when no bill has been confirmed, and says so in `basis`."""
    rows = [b.reviewed for b in bills if b.status == "reviewed" and b.reviewed]
    basis = "reviewed"
    if not rows and include_unreviewed:
        # A saved draft correction (b.reviewed while still needs_review) wins over the raw extracted values.
        rows = [b.reviewed or b.extracted for b in bills if b.status == "needs_review" and (b.reviewed or b.extracted)]
        basis = "unreviewed"
    if not rows:
        return {"bill_count": 0, "basis": basis,
                "message": "No reviewed bills yet. Review extracted bills to see the analysis."}

    def vals(key):
        return [r[key] for r in rows if isinstance(r.get(key), (int, float))]

    kwh = vals("units_kwh")
    md = vals("recorded_max_demand_kva")
    cd = vals("contract_demand_kva")
    totals = vals("total_amount_inr")
    # Peak share of the units the TOD zones are billed on (kVAh where printed, else kWh).
    peak = [r["tod_peak_kwh"] / (r.get("units_kvah") or r["units_kwh"]) for r in rows
            if isinstance(r.get("tod_peak_kwh"), (int, float)) and (r.get("units_kvah") or r.get("units_kwh"))]
    rebate = vals("tod_offpeak_rebate_inr_per_unit")
    window = vals("tod_peak_window_hours")
    demand_charges = vals("demand_charge_inr")
    energy_rate = vals("energy_rate_inr_per_unit")
    surcharge = vals("tod_peak_surcharge_inr_per_unit")
    demand_rate = vals("demand_rate_inr_per_kva")

    avg_kwh = mean(kwh) if kwh else None
    peak_share = mean(peak) * 100 if peak else 25.0
    avg_total = mean(totals) if totals else None
    monthly = sorted(
        ({"month": r.get("bill_month"), "units_kwh": r.get("units_kwh"), "max_demand_kva": r.get("recorded_max_demand_kva"),
          "total_inr": r.get("total_amount_inr")} for r in rows),
        key=lambda x: x["month"] or "",
    )
    out = {
        "bill_count": len(rows),
        "basis": basis,
        "avg_monthly_kwh": round(avg_kwh, 1) if avg_kwh else None,
        "max_recorded_demand_kva": max(md) if md else None,
        "contract_demand_kva": max(cd) if cd else None,
        "avg_monthly_bill_inr": round(avg_total) if avg_total else None,
        "effective_rate_inr_per_kwh": round(avg_total / avg_kwh, 2) if avg_total and avg_kwh else None,
        "peak_share_pct": round(peak_share, 1),
        "demand_charge_share_pct": (round(mean(demand_charges) / avg_total * 100, 1)
                                    if demand_charges and avg_total else None),
        "monthly": monthly,
        "insights": [],
    }
    if md and cd and max(md) > max(cd):
        out["insights"].append("Recorded demand exceeds contract demand; penalties are likely. Peak shaving helps.")
    if out["demand_charge_share_pct"] and out["demand_charge_share_pct"] > 20:
        out["insights"].append("Demand charges are a large share of the bill: strong case for peak shaving.")
    if peak_share > 30:
        out["insights"].append("High peak-hour consumption: ToD arbitrage potential is good.")

    base_rate = mean(energy_rate) if energy_rate else (round(avg_total / avg_kwh * 0.75, 2) if avg_total and avg_kwh else 8.0)
    # Off-peak (charging) rate: the bill's own night rebate when printed (MSEDCL: none), else a typical 15% rebate.
    offpeak = base_rate - mean(rebate) if rebate else base_rate * 0.85
    peak_window = mean(window) if window else 4
    prefill = {
        "monthly_consumption_kwh": round(avg_kwh, 1) if avg_kwh else None,
        "peak_share_pct": round(peak_share, 1),
        "peak_window_hours": round(peak_window, 1),
        "peak_tariff_inr": round(base_rate + (mean(surcharge) if surcharge else 1.5), 2),
        "offpeak_tariff_inr": round(offpeak, 2),
        "contract_demand_kva": max(cd) if cd else 0,
        "recorded_max_demand_kva": max(md) if md else 0,
        "demand_charge_inr_per_kva": round(mean(demand_rate), 2) if demand_rate else 0,
    }
    if avg_kwh:
        prefill.update(suggest_size(avg_kwh, peak_share, peak_window_hours=peak_window))
        if prefill["battery_power_kw"] / prefill["battery_capacity_kwh"] < 0.1:  # keep within the C-rate limit
            prefill["battery_power_kw"] = max(25.0, -(-prefill["battery_capacity_kwh"] * 0.1 // 25) * 25)
    out["calculator_prefill"] = prefill
    return out


def estimate(analysis: dict, commercial: dict) -> dict:
    """Automatic BESS estimate from bill values: suggested size and the full savings/payback calculation.

    It is an indication for sales conversations, never a quote: proposals still need a saved configuration that an
    engineer has validated. `basis` tells the reader whether the values were confirmed by a person.
    """
    prefill = analysis.get("calculator_prefill") or {}
    base = {"available": False, "basis": analysis.get("basis", "reviewed"), "bill_count": analysis.get("bill_count", 0)}
    if not prefill.get("monthly_consumption_kwh"):
        return {**base, "reason": "Units consumed (kWh) is needed for an estimate. Enter it on the bill."}
    values = {k: v for k, v in prefill.items() if k in CalcInputs.model_fields and v is not None}
    try:
        inputs = CalcInputs(**values)
        results, comm = calculate(inputs, commercial)
    except ValueError as exc:  # includes pydantic validation errors
        return {**base, "reason": f"Not enough valid bill data for an estimate ({str(exc).splitlines()[0][:120]})."}
    return {**base, "available": True, "inputs": inputs.model_dump(exclude_none=True), "results": results,
            "commercial": comm}
