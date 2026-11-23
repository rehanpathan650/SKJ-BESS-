"""Tamper-evident audit logging.

Each entry stores the hash of the previous entry, so any edit or deletion breaks the chain and is
detected by verify_chain(). Entries are written in their own transaction so that denied or failed
actions are recorded even when the request itself is rolled back. In production the application
database role has INSERT/SELECT only on audit_log (see infra/postgres/init/01-roles.sql).
"""
from __future__ import annotations

import contextvars
import hashlib
from contextvars import ContextVar, Token
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text

from app.db import SessionLocal
from app.models import AuditLog

log = logging.getLogger("skj.audit")

request_ip: contextvars.ContextVar[str] = contextvars.ContextVar("request_ip", default="")
request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")

GENESIS = "0" * 64
_SENSITIVE_KEYS = {"password", "token", "secret", "code", "refresh_token", "access_token", "mfa_code"}


def _norm_ts(ts: datetime) -> str:
    if ts.tzinfo is not None:
        ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
    return ts.isoformat(timespec="microseconds")


def _scrub(details: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for k, v in details.items():
        if k.lower() in _SENSITIVE_KEYS:
            clean[k] = "[redacted]"
        elif isinstance(v, dict):
            clean[k] = _scrub(v)
        elif isinstance(v, str) and len(v) > 500:
            clean[k] = v[:500] + "..."
        else:
            clean[k] = v
    return clean


def compute_hash(entry: AuditLog) -> str:
    body = {
        "ts": _norm_ts(entry.ts),
        "category": entry.category,
        "action": entry.action,
        "outcome": entry.outcome,
        "actor_id": entry.actor_id or "",
        "actor_email": entry.actor_email or "",
        "target_type": entry.target_type or "",
        "target_id": entry.target_id or "",
        "ip": entry.ip or "",
        "request_id": entry.request_id or "",
        "details": entry.details or {},
    }
    payload = entry.prev_hash + json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


# During an HTTP request, entries are collected here and written by the middleware once the endpoint has finished
# (still before the response is sent). Writing them mid-request on a second connection could wait on the request's
# own uncommitted transaction; on SQLite that wait timed out and the entry was lost.
_pending: ContextVar[list[dict[str, Any]] | None] = ContextVar("audit_pending", default=None)


def begin_request() -> Token:
    return _pending.set([])


def end_request(token: Token) -> list[dict[str, Any]]:
    """Stop collecting (call in the same context as begin_request) and return what was collected."""
    items = _pending.get() or []
    _pending.reset(token)
    return items


def write_all(items: list[dict[str, Any]]) -> None:
    for item in items:
        _write(**item)


def record(
    category: str,
    action: str,
    *,
    actor=None,
    actor_id: str | None = None,
    actor_email: str = "",
    target_type: str = "",
    target_id: str = "",
    outcome: str = "success",
    details: dict[str, Any] | None = None,
) -> None:
    if actor is not None:
        actor_id = actor.id
        actor_email = actor.email
    item = dict(category=category, action=action, actor_id=actor_id, actor_email=actor_email, target_type=target_type,
                target_id=target_id, outcome=outcome, details=details, ts=datetime.now(timezone.utc),
                ip=request_ip.get(), rid=request_id.get())
    pending = _pending.get()
    if pending is not None:
        pending.append(item)
    else:
        _write(**item)


def _write(*, category: str, action: str, actor_id: str | None, actor_email: str, target_type: str, target_id: str,
           outcome: str, details: dict[str, Any] | None, ts: datetime, ip: str, rid: str) -> None:
    db = SessionLocal()
    try:
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(727274)"))  # serialise chain appends
        last = db.execute(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1)).scalar()
        entry = AuditLog(
            ts=ts,
            category=category,
            action=action,
            outcome=outcome,
            actor_id=actor_id,
            actor_email=actor_email or "",
            target_type=target_type,
            target_id=str(target_id or ""),
            ip=ip,
            request_id=rid,
            details=_scrub(details or {}),
            prev_hash=last or GENESIS,
        )
        entry.hash = compute_hash(entry)
        db.add(entry)
        db.commit()
    except Exception:  # audit failure must never leak data; log and continue
        db.rollback()
        log.exception("audit write failed for action=%s", action)
    finally:
        db.close()


def verify_chain(limit: int | None = None) -> dict[str, Any]:
    db = SessionLocal()
    try:
        q = select(AuditLog).order_by(AuditLog.id.asc())
        prev = GENESIS
        checked = 0
        for entry in db.execute(q).scalars():
            if entry.prev_hash != prev or compute_hash(entry) != entry.hash:
                return {"valid": False, "checked": checked, "broken_at_id": entry.id}
            prev = entry.hash
            checked += 1
            if limit and checked >= limit:
                break
        return {"valid": True, "checked": checked, "broken_at_id": None}
    finally:
        db.close()
