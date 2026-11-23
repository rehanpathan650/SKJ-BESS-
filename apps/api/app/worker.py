"""Background worker: bill processing, email, push, and retention clean-up.

Run with:  python -m app.worker
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app import audit
from app.config import get_settings
from app.db import SessionLocal
from app.models import AuthSession, Bill, Job, Notification, OneTimeToken
from app.services import cache, scanning, storage
from app.services.extraction import process_bill
from app.services.notify import deliver_email, deliver_push, notify

log = logging.getLogger("skj.worker")
MAX_ATTEMPTS = 3


def handle_bill(db, bill_id: str) -> None:
    bill = db.get(Bill, bill_id)
    if bill is None:
        return
    f = bill.file
    bill.status = "scanning"
    db.commit()
    try:
        result = scanning.scan_bytes(storage.load(f))
    except scanning.ScanError:
        f.scan_status = "error"
        bill.status = "failed"
        bill.status_detail = "Malware scan unavailable. The file was not processed; try again later."
        db.commit()
        raise
    f.scan_status = result
    if result == "infected":
        bill.status = "rejected"
        bill.status_detail = "Malware detected. The file was quarantined and will not be processed."
        storage.delete(f)  # remove the payload; metadata kept for the audit trail
        db.commit()
        audit.record("security", "file.infected", target_type="bill", target_id=bill.id, outcome="denied")
        return
    bill.status = "extracting"
    db.commit()
    process_bill(db, bill)
    from app.routers.quotations import fill_customer_from_bill

    fill_customer_from_bill(db, bill)  # customers started from a bill get their name and details from it
    notify(db, [bill.uploaded_by_id], "bill_processed", "Bill ready for review",
           f"{f.original_name}: please check the extracted values.", f"/bills/{bill.id}")
    db.commit()  # commit before auditing: the audit entry uses its own connection
    if bill.security_flags and any(x.startswith(("possible_prompt", "script_like", "ai_reported", "hidden_unicode"))
                                   for x in bill.security_flags):
        audit.record("security", "bill.flagged", target_type="bill", target_id=bill.id,
                     details={"flags": bill.security_flags})


STUCK_AFTER = timedelta(minutes=15)


def requeue_stuck(db) -> int:
    """Jobs left 'running' by a worker that was stopped or crashed mid-job go back in the queue
    (or fail permanently after MAX_ATTEMPTS). The age threshold avoids touching jobs another worker is busy with."""
    cutoff = datetime.now(timezone.utc) - STUCK_AFTER
    stuck = db.execute(select(Job).where(Job.status == "running", Job.updated_at < cutoff)
                       .with_for_update(skip_locked=True)).scalars().all()
    for job in stuck:
        job.last_error = "worker stopped during job"
        job.status = "failed" if job.attempts >= MAX_ATTEMPTS else "pending"
    db.commit()
    if stuck:
        log.warning("re-queued %d job(s) left running by a stopped worker", len(stuck))
    return len(stuck)


def cleanup(db) -> None:
    s = get_settings()
    now = datetime.now(timezone.utc)
    db.execute(delete(OneTimeToken).where(OneTimeToken.expires_at < now - timedelta(days=1)))
    db.execute(delete(AuthSession).where(AuthSession.expires_at < now - timedelta(days=s.retention_sessions_days)))
    db.execute(delete(Notification).where(Notification.created_at < now - timedelta(days=s.retention_notifications_days)))
    db.execute(delete(Job).where(Job.status == "done", Job.updated_at < now - timedelta(days=7)))
    db.commit()
    # Temporary parser files older than 1 hour (normally removed immediately).
    for p in storage.temp_dir().glob("*"):
        try:
            if p.stat().st_mtime < time.time() - 3600:
                p.unlink()
        except OSError:
            pass


def run_once() -> int:
    db = SessionLocal()
    processed = 0
    try:
        jobs = db.execute(select(Job).where(Job.status == "pending", Job.run_after <= datetime.now(timezone.utc))
                          .order_by(Job.created_at).limit(10).with_for_update(skip_locked=True)).scalars().all()
        for job in jobs:
            job.status = "running"
            job.attempts += 1
        db.commit()
        for job in jobs:
            try:
                if job.kind == "process_bill":
                    handle_bill(db, job.payload["bill_id"])
                elif job.kind == "email":
                    deliver_email(job.payload["to"], job.payload["subject"], job.payload["body"])
                elif job.kind == "push":
                    deliver_push(db, job.payload["notification_id"])
                job.status = "done"
                if job.kind == "process_bill":
                    cache.bump()
            except Exception as exc:  # retry with backoff, never log payload contents
                db.rollback()
                job = db.get(Job, job.id)
                job.last_error = exc.__class__.__name__
                if job.attempts >= MAX_ATTEMPTS:
                    job.status = "failed"
                    log.error("job %s (%s) failed permanently", job.id, job.kind)
                else:
                    job.status = "pending"
                    job.run_after = datetime.now(timezone.utc) + timedelta(seconds=30 * job.attempts)
            db.commit()
            processed += 1
    finally:
        db.close()
    return processed


def main() -> None:
    from app import observability

    observability.setup_logging()
    observability.setup_error_tracking()
    log.info("worker started")  # several workers may run at once: jobs are claimed with SKIP LOCKED
    last_cleanup = last_requeue = 0.0
    while True:
        n = run_once()
        if time.time() - last_requeue > 300:
            db = SessionLocal()
            try:
                requeue_stuck(db)
            finally:
                db.close()
            last_requeue = time.time()
        if time.time() - last_cleanup > 3600:
            db = SessionLocal()
            try:
                cleanup(db)
            finally:
                db.close()
            last_cleanup = time.time()
        if n == 0:
            time.sleep(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:  # Ctrl+C: a normal stop, not an error
        log.info("worker stopped")
