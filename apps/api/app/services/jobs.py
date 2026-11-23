from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import Job


def enqueue(db: Session, kind: str, payload: dict[str, Any]) -> Job:
    job = Job(kind=kind, payload=payload)
    db.add(job)
    return job
