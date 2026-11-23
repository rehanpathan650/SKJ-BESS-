from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AppSetting
from app.services.bess import DEFAULT_COMMERCIAL


def get_commercial(db: Session) -> dict:
    row = db.get(AppSetting, "commercial")
    return {**DEFAULT_COMMERCIAL, **(row.value if row else {})}


def set_commercial(db: Session, values: dict, user_id: str) -> dict:
    row = db.get(AppSetting, "commercial")
    merged = {**get_commercial(db), **values}
    if row is None:
        db.add(AppSetting(key="commercial", value=merged, updated_by_id=user_id))
    else:
        row.value = merged
        row.updated_by_id = user_id
    return merged


PUBLIC_COMMERCIAL_KEYS = ("gst_pct", "om_pct_of_capex", "discount_rate_pct", "tariff_escalation_pct",
                          "degradation_pct_per_year", "project_life_years", "max_sales_discount_pct")
