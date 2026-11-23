"""BESS calculator, saved configurations, engineering validation and comparison."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import Principal, active_user, require
from app.models import Calculation
from app.services import access
from app.services.app_settings import PUBLIC_COMMERCIAL_KEYS, get_commercial
from app.services.bess import CalcInputs, calculate
from app.services.notify import notify, users_with_permission

router = APIRouter(tags=["calculator"])


def calc_out(c: Calculation, p: Principal) -> dict:
    out = {
        "id": c.id, "project_id": c.project_id, "name": c.name, "inputs": c.inputs, "results": c.results,
        "validation_status": c.validation_status, "validation_note": c.validation_note,
        "validated_at": c.validated_at, "created_by_id": c.created_by_id, "created_at": c.created_at,
    }
    # Vendor cost and margin are only included for commercial.confidential.view.
    if p.has("commercial.confidential.view"):
        out["commercial"] = c.commercial
    return out


def _run(db: Session, p: Principal, inputs: CalcInputs) -> tuple[dict, dict]:
    try:
        return calculate(inputs, get_commercial(db))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/calculator/defaults")
def calculator_defaults(p: Principal = Depends(require("calculator.use")), db: Session = Depends(get_db)):
    c = get_commercial(db)
    out = {k: c[k] for k in PUBLIC_COMMERCIAL_KEYS}
    if p.has("commercial.confidential.view"):
        out["confidential"] = c
    return out


@router.post("/calculator/preview")
def preview(inputs: CalcInputs, p: Principal = Depends(require("calculator.use")), db: Session = Depends(get_db)):
    results, commercial = _run(db, p, inputs)
    out = {"results": results}
    if p.has("commercial.confidential.view"):
        out["commercial"] = commercial
    return out


class SaveCalcIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    inputs: CalcInputs


@router.post("/projects/{project_id}/calculations", status_code=201)
def save_calculation(project_id: str, data: SaveCalcIn, p: Principal = Depends(require("calculator.use")),
                     db: Session = Depends(get_db)):
    pr = access.get_project(db, p, project_id)
    results, commercial = _run(db, p, data.inputs)
    c = Calculation(project_id=pr.id, name=data.name, inputs=data.inputs.model_dump(), results=results,
                    commercial=commercial, created_by_id=p.id)
    if get_settings().single_user_mode:  # nobody else to validate it
        c.validation_status, c.validated_by_id = "approved", p.id
        c.validated_at = datetime.now(timezone.utc)
        c.validation_note = "Single-login mode: no separate engineer validation."
    db.add(c)
    db.flush()
    validators = [pr.engineer_id] if pr.engineer_id and pr.engineer_id != p.id else \
        [u for u in users_with_permission(db, "calculations.validate") if u != p.id]
    notify(db, validators, "technical_validation", f"Validation needed: {pr.name}",
           f"Configuration '{c.name}' ({data.inputs.battery_capacity_kwh:g} kWh) awaits technical validation.",
           f"/projects/{pr.id}")
    if pr.stage in ("lead", "site_survey"):
        pr.stage = "technical_validation"
    db.commit()
    audit.record("data", "calculation.saved", actor=p.user, target_type="calculation", target_id=c.id,
                 details={"project_id": pr.id})
    return calc_out(c, p)


@router.get("/projects/{project_id}/calculations")
def list_calculations(project_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    pr = access.get_project(db, p, project_id)
    rows = db.execute(select(Calculation).where(Calculation.project_id == pr.id)
                      .order_by(Calculation.created_at.desc())).scalars()
    return [calc_out(c, p) for c in rows]


@router.get("/calculations/{calc_id}")
def get_calc(calc_id: str, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    return calc_out(access.get_calculation(db, p, calc_id), p)


class ValidateIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=2000)


@router.post("/calculations/{calc_id}/validate")
def validate_calc(calc_id: str, data: ValidateIn, p: Principal = Depends(require("calculations.validate")),
                  db: Session = Depends(get_db)):
    c = access.get_calculation(db, p, calc_id)
    if c.created_by_id == p.id and "*" not in p.perms:
        raise HTTPException(403, "A configuration must be validated by someone other than its author.")
    # Re-run with stored inputs to make sure results were not tampered with.
    try:
        results, commercial = calculate(CalcInputs.model_validate(c.inputs), get_commercial(db))
    except (ValidationError, ValueError):
        raise HTTPException(400, "Stored inputs are no longer valid; create a new configuration.")
    c.results, c.commercial = results, commercial
    c.validation_status = data.decision
    c.validation_note = data.note
    c.validated_by_id = p.id
    c.validated_at = datetime.now(timezone.utc)
    notify(db, [c.created_by_id], "technical_validation",
           f"Configuration {data.decision}: {c.name}", data.note[:200], f"/projects/{c.project_id}")
    db.commit()
    audit.record("data", f"calculation.{data.decision}", actor=p.user, target_type="calculation", target_id=c.id)
    return calc_out(c, p)


class CompareIn(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=5)


@router.post("/calculations/compare")
def compare(data: CompareIn, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    items = []
    for cid in data.ids:
        c = access.get_calculation(db, p, cid)
        f = c.results["financial"]
        s = c.results["summary"]
        row = {"id": c.id, "name": c.name, "validation_status": c.validation_status,
               "battery_capacity_kwh": s["battery_capacity_kwh"], "battery_power_kw": s["battery_power_kw"],
               "capex_inr": f["capex_inr"], "year1_net_saving_inr": f["year1_net_saving_inr"],
               "simple_payback_years": f["simple_payback_years"], "npv_inr": f["npv_inr"], "irr_pct": f["irr_pct"],
               "lcos_inr_per_kwh": f["lcos_inr_per_kwh"]}
        if p.has("commercial.confidential.view"):
            row["gross_margin_pct"] = c.commercial.get("gross_margin_pct")
        items.append(row)
    return items
