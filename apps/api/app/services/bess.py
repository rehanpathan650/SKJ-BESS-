"""BESS techno-commercial model for Indian C&I customers.

Value streams modelled:
1. Time-of-day (ToD) arbitrage: charge in off-peak/normal hours, discharge during peak hours.
2. Demand-charge reduction: peak shaving lowers billed demand (kVA), subject to the minimum billing
   demand (typically a % of contract demand).

All assumptions are explicit inputs or admin-managed defaults (see DEFAULT_COMMERCIAL). These are
industry-standard simplifications, not SKJ's final engineering method; outputs are estimates and every
configuration must be technically validated by a BESS engineer before a proposal can be generated.
"""
from __future__ import annotations

import math

from pydantic import BaseModel, Field, model_validator

DEFAULT_COMMERCIAL = {
    # Confidential: vendor costs and margin. Only visible to commercial.confidential.view.
    # Placeholder figures: Finance must replace them with SKJ's real vendor quotes.
    "vendor_battery_inr_per_kwh": 9000.0,
    "vendor_pcs_inr_per_kw": 4000.0,
    "installation_pct": 8.0,
    "margin_pct": 18.0,
    # Customer-facing defaults
    "gst_pct": 18.0,
    "om_pct_of_capex": 1.0,
    "discount_rate_pct": 10.0,
    "tariff_escalation_pct": 3.0,
    "degradation_pct_per_year": 2.5,
    "project_life_years": 10,
    "max_sales_discount_pct": 5.0,
}


class CalcInputs(BaseModel):
    # Load & tariff
    monthly_consumption_kwh: float = Field(gt=0, le=50_000_000)
    peak_share_pct: float = Field(default=25, ge=0, le=100, description="Share of consumption in peak ToD hours")
    peak_window_hours: float = Field(default=4, gt=0, le=12)
    peak_tariff_inr: float = Field(gt=0, le=100, description="Energy rate during peak hours incl. ToD surcharge")
    offpeak_tariff_inr: float = Field(gt=0, le=100, description="Energy rate when the battery charges")
    contract_demand_kva: float = Field(default=0, ge=0, le=500_000)
    recorded_max_demand_kva: float = Field(default=0, ge=0, le=500_000)
    demand_charge_inr_per_kva: float = Field(default=0, ge=0, le=5_000)
    min_billing_demand_pct: float = Field(default=75, ge=0, le=100)
    power_factor: float = Field(default=0.95, gt=0.5, le=1)
    peak_shaving_kva: float | None = Field(default=None, ge=0, le=500_000,
                                           description="Target kVA reduction; blank = automatic")
    # Battery configuration
    battery_capacity_kwh: float = Field(gt=0, le=1_000_000)
    battery_power_kw: float = Field(gt=0, le=1_000_000)
    depth_of_discharge_pct: float = Field(default=90, gt=10, le=100)
    round_trip_efficiency_pct: float = Field(default=88, gt=50, le=100)
    cycles_per_day: float = Field(default=1, gt=0, le=3)
    operating_days_per_year: int = Field(default=300, ge=1, le=366)
    # Financial (optional overrides of admin defaults)
    degradation_pct_per_year: float | None = Field(default=None, ge=0, le=20)
    project_life_years: int | None = Field(default=None, ge=1, le=25)
    tariff_escalation_pct: float | None = Field(default=None, ge=-10, le=20)
    discount_rate_pct: float | None = Field(default=None, ge=0, le=30)
    om_pct_of_capex: float | None = Field(default=None, ge=0, le=10)
    sales_discount_pct: float = Field(default=0, ge=0, le=50)
    # Quotation options
    project_value_ex_gst_inr: float | None = Field(default=None, gt=0, le=5e10,
                                                   description="Fixed project price excl. GST; blank = cost + margin")
    proposed_contract_demand_kva: float | None = Field(default=None, gt=0, le=500_000,
                                                       description="Scenario: contract demand after revision")
    count_cd_revision_in_savings: bool = Field(default=False, description="Include the contract-demand revision "
                                               "saving in payback (it does not need the battery)")

    @model_validator(mode="after")
    def _c_rate(self):
        c_rate = self.battery_power_kw / self.battery_capacity_kwh
        if c_rate > 2 or c_rate < 0.1:
            raise ValueError("Battery power/capacity ratio (C-rate) must be between 0.1 and 2")
        return self


def irr(cashflows: list[float]) -> float | None:
    def npv_at(r: float) -> float:
        return sum(cf / (1 + r) ** i for i, cf in enumerate(cashflows))

    lo, hi = -0.99, 5.0
    f_lo, f_hi = npv_at(lo), npv_at(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv_at(mid)
        if abs(f_mid) < 1e-6:
            break
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def _r(x: float, nd: int = 0) -> float:
    return round(x, nd) if nd else float(round(x))


def calculate(inp: CalcInputs, commercial: dict) -> tuple[dict, dict]:
    """Return (customer_results, confidential_commercial)."""
    c = {**DEFAULT_COMMERCIAL, **(commercial or {})}
    life = inp.project_life_years or int(c["project_life_years"])
    degr = (inp.degradation_pct_per_year if inp.degradation_pct_per_year is not None
            else c["degradation_pct_per_year"]) / 100
    esc = (inp.tariff_escalation_pct if inp.tariff_escalation_pct is not None else c["tariff_escalation_pct"]) / 100
    disc = (inp.discount_rate_pct if inp.discount_rate_pct is not None else c["discount_rate_pct"]) / 100
    om_pct = (inp.om_pct_of_capex if inp.om_pct_of_capex is not None else c["om_pct_of_capex"]) / 100
    gst = c["gst_pct"] / 100

    if inp.sales_discount_pct > c["max_sales_discount_pct"]:
        raise ValueError(f"Sales discount above the approved limit of {c['max_sales_discount_pct']}%")

    # --- Pricing (confidential cost side -> customer price) ---
    battery_cost = inp.battery_capacity_kwh * c["vendor_battery_inr_per_kwh"]
    pcs_cost = inp.battery_power_kw * c["vendor_pcs_inr_per_kw"]
    install_cost = (battery_cost + pcs_cost) * c["installation_pct"] / 100
    total_cost = battery_cost + pcs_cost + install_cost
    list_price = inp.project_value_ex_gst_inr or total_cost * (1 + c["margin_pct"] / 100)
    price_ex_gst = list_price * (1 - inp.sales_discount_pct / 100)
    gst_amount = price_ex_gst * gst
    capex = price_ex_gst + gst_amount

    # --- Energy ---
    usable_kwh = inp.battery_capacity_kwh * inp.depth_of_discharge_pct / 100
    rte = inp.round_trip_efficiency_pct / 100
    annual_kwh = inp.monthly_consumption_kwh * 12
    peak_daily_kwh = annual_kwh * inp.peak_share_pct / 100 / inp.operating_days_per_year
    power_limited = inp.battery_power_kw * inp.peak_window_hours
    year1_daily_discharge = min(usable_kwh * inp.cycles_per_day, peak_daily_kwh, power_limited * inp.cycles_per_day)
    spread = inp.peak_tariff_inr - inp.offpeak_tariff_inr / rte

    # --- Demand ---
    if inp.recorded_max_demand_kva and inp.demand_charge_inr_per_kva:
        shave = inp.peak_shaving_kva
        if shave is None:
            shave = min(inp.battery_power_kw / inp.power_factor, 0.3 * inp.recorded_max_demand_kva)
        shave = min(shave, inp.battery_power_kw / inp.power_factor, inp.recorded_max_demand_kva)
        floor = inp.contract_demand_kva * inp.min_billing_demand_pct / 100
        cd_new = inp.proposed_contract_demand_kva or inp.contract_demand_kva
        floor_new = cd_new * inp.min_billing_demand_pct / 100
        billed_before = max(inp.recorded_max_demand_kva, floor)
        billed_cd_only = max(inp.recorded_max_demand_kva, floor_new)       # revision without a battery
        billed_after = max(inp.recorded_max_demand_kva - shave, floor_new)
        rate12 = inp.demand_charge_inr_per_kva * 12
        cd_saving_y1 = max(0.0, billed_before - billed_cd_only) * rate12
        battery_demand_y1 = max(0.0, billed_cd_only - billed_after) * rate12
        demand_saving_y1 = battery_demand_y1 + (cd_saving_y1 if inp.count_cd_revision_in_savings else 0.0)
    else:
        shave, billed_before, billed_after, demand_saving_y1 = 0.0, 0.0, 0.0, 0.0
        cd_saving_y1 = battery_demand_y1 = 0.0

    # --- Cash flows ---
    years = []
    cashflows = [-capex]
    cumulative = -capex
    pv_om = 0.0
    pv_energy = 0.0
    payback = None
    disc_payback = None
    cum_disc = -capex
    for y in range(1, life + 1):
        health = (1 - degr) ** (y - 1)
        tariff_f = (1 + esc) ** (y - 1)
        discharge = year1_daily_discharge * health * inp.operating_days_per_year
        arbitrage = discharge * spread * tariff_f
        demand = demand_saving_y1 * tariff_f
        om = price_ex_gst * om_pct * (1 + esc) ** (y - 1)
        net = arbitrage + demand - om
        df = (1 + disc) ** y
        cumulative += net
        cum_disc += net / df
        if payback is None and cumulative >= 0:
            prev = cumulative - net
            payback = (y - 1) + (-prev / net if net > 0 else 0)
        if disc_payback is None and cum_disc >= 0:
            prev = cum_disc - net / df
            disc_payback = (y - 1) + (-prev / (net / df) if net > 0 else 0)
        pv_om += om / df
        pv_energy += discharge / df
        cashflows.append(net)
        years.append({
            "year": y, "battery_health_pct": _r(health * 100, 1), "energy_shifted_kwh": _r(discharge),
            "arbitrage_saving_inr": _r(arbitrage), "demand_saving_inr": _r(demand), "om_cost_inr": _r(om),
            "net_saving_inr": _r(net), "cumulative_inr": _r(cumulative),
        })
    npv = sum(cf / (1 + disc) ** i for i, cf in enumerate(cashflows))
    rate = irr(cashflows)
    total_net = sum(cashflows[1:])
    y1 = years[0] if years else {}
    warnings = []
    if spread <= 0:
        warnings.append("Peak tariff does not exceed charging cost after losses: arbitrage gives no saving.")
    if year1_daily_discharge < usable_kwh * inp.cycles_per_day * 0.6:
        warnings.append("Battery is oversized for the peak-hour load; consider a smaller capacity.")
    if payback is None:
        warnings.append("The investment does not pay back within the project life.")
    cd_eff = inp.proposed_contract_demand_kva or inp.contract_demand_kva
    if cd_eff and inp.recorded_max_demand_kva and billed_after <= cd_eff * inp.min_billing_demand_pct / 100 + 1e-6:
        warnings.append("The minimum billing demand (a share of contract demand) limits the demand-charge saving; "
                        "a contract-demand revision with the DISCOM would unlock more.")
    if inp.proposed_contract_demand_kva and inp.recorded_max_demand_kva and \
            inp.proposed_contract_demand_kva < inp.recorded_max_demand_kva - shave:
        warnings.append("The proposed contract demand is below the expected peak after the battery: excess-demand "
                        "penalties are likely.")
    if inp.proposed_contract_demand_kva and cd_saving_y1 and not inp.count_cd_revision_in_savings:
        warnings.append("The contract-demand revision saving is shown separately and is not counted in the payback, "
                        "because it does not need the battery.")

    results = {
        "summary": {
            "battery_capacity_kwh": inp.battery_capacity_kwh,
            "battery_power_kw": inp.battery_power_kw,
            "usable_capacity_kwh": _r(usable_kwh, 1),
            "c_rate": round(inp.battery_power_kw / inp.battery_capacity_kwh, 2),
            "duration_hours": round(inp.battery_capacity_kwh / inp.battery_power_kw, 2),
            "daily_energy_shifted_kwh": _r(year1_daily_discharge, 1),
            "peak_daily_load_kwh": _r(peak_daily_kwh, 1),
            "peak_shaving_kva": _r(shave, 1),
            "billed_demand_before_kva": _r(billed_before, 1),
            "billed_demand_after_kva": _r(billed_after, 1),
        },
        "financial": {
            "price_ex_gst_inr": _r(price_ex_gst),
            "gst_inr": _r(gst_amount),
            "capex_inr": _r(capex),
            "year1_arbitrage_saving_inr": y1.get("arbitrage_saving_inr", 0),
            "year1_demand_saving_inr": y1.get("demand_saving_inr", 0),
            "year1_battery_peak_shaving_inr": _r(battery_demand_y1),
            "year1_cd_revision_saving_inr": _r(cd_saving_y1),
            "cd_revision_counted": bool(inp.count_cd_revision_in_savings and cd_saving_y1),
            "year1_om_cost_inr": y1.get("om_cost_inr", 0),
            "year1_net_saving_inr": y1.get("net_saving_inr", 0),
            "monthly_saving_inr": _r(y1.get("net_saving_inr", 0) / 12),
            "lifetime_net_saving_inr": _r(total_net),
            "simple_payback_years": round(payback, 2) if payback is not None else None,
            "discounted_payback_years": round(disc_payback, 2) if disc_payback is not None else None,
            "npv_inr": _r(npv),
            "irr_pct": round(rate * 100, 2) if rate is not None else None,
            "roi_pct": round(total_net / capex * 100, 1) if capex else None,
            "lcos_inr_per_kwh": round((capex + pv_om) / pv_energy, 2) if pv_energy else None,
            "project_life_years": life,
            "discount_rate_pct": round(disc * 100, 2),
            "tariff_escalation_pct": round(esc * 100, 2),
        },
        "yearly": years,
        "warnings": warnings,
        "assumptions_note": "Estimates based on the inputs and standard assumptions. Subject to technical "
                            "validation, site survey and the DISCOM's current tariff order.",
    }
    confidential = {
        "vendor_battery_cost_inr": _r(battery_cost),
        "vendor_pcs_cost_inr": _r(pcs_cost),
        "installation_cost_inr": _r(install_cost),
        "total_cost_inr": _r(total_cost),
        "list_price_ex_gst_inr": _r(list_price),
        "sales_discount_pct": inp.sales_discount_pct,
        "gross_margin_inr": _r(price_ex_gst - total_cost),
        "gross_margin_pct": round((price_ex_gst - total_cost) / price_ex_gst * 100, 2) if price_ex_gst else 0,
        "assumptions": {k: c[k] for k in ("vendor_battery_inr_per_kwh", "vendor_pcs_inr_per_kw",
                                          "installation_pct", "margin_pct")},
    }
    return results, confidential


def suggest_size(monthly_kwh: float, peak_share_pct: float, peak_window_hours: float = 4,
                 operating_days: int = 300, dod_pct: float = 90) -> dict:
    peak_daily = monthly_kwh * 12 * peak_share_pct / 100 / operating_days
    capacity = max(50.0, math.ceil(peak_daily / (dod_pct / 100) / 50) * 50)
    power = max(25.0, math.ceil(capacity / peak_window_hours / 25) * 25)
    return {"battery_capacity_kwh": capacity, "battery_power_kw": power, "peak_daily_kwh": round(peak_daily, 1)}
