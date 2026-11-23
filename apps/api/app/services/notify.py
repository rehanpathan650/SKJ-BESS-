"""In-app notifications, push notifications (Expo) and email. Delivery runs in the worker."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Notification, PushToken, User, UserStatus
from app.services.jobs import enqueue

log = logging.getLogger("skj.notify")

KINDS = {
    "project_assigned", "customer_updated", "proposal_approval", "proposal_status",
    "technical_validation", "management", "account", "bill_processed",
}


def notify(db: Session, user_ids: list[str], kind: str, title: str, body: str = "", link: str = "") -> None:
    for uid in set(filter(None, user_ids)):
        n = Notification(user_id=uid, kind=kind, title=title[:200], body=body[:1000], link=link[:300])
        db.add(n)
        db.flush()
        if get_settings().push_enabled:
            enqueue(db, "push", {"notification_id": n.id})


def users_with_permission(db: Session, perm: str) -> list[str]:
    ids = []
    for u in db.execute(select(User).where(User.status == UserStatus.ACTIVE)).scalars():
        perms = u.role.permissions if u.role else []
        if perm in perms or "*" in perms:
            ids.append(u.id)
    return ids


def queue_email(db: Session, to: str, subject: str, body: str) -> None:
    enqueue(db, "email", {"to": to, "subject": subject, "body": body})


def deliver_email(to: str, subject: str, body: str) -> None:
    s = get_settings()
    if not s.smtp_host:
        if s.is_production:
            raise RuntimeError("SMTP is not configured")
        # Development only: print so you can click verification links locally.
        print(f"\n=== DEV EMAIL to {to} ===\nSubject: {subject}\n{body}\n=== END ===\n", flush=True)
        return
    msg = EmailMessage()
    msg["From"] = s.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        if s.smtp_starttls:  # always on in production (enforced in config)
            smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


def deliver_push(db: Session, notification_id: str) -> None:
    import httpx

    n = db.get(Notification, notification_id)
    if n is None or n.pushed:
        return
    tokens = [t.token for t in db.execute(select(PushToken).where(PushToken.user_id == n.user_id)).scalars()]
    if not tokens:
        return
    # Push payload carries only a generic title; details are fetched in-app after login.
    messages = [{"to": t, "title": n.title, "body": "Open the SKJ app for details.", "data": {"link": n.link}}
                for t in tokens]
    resp = httpx.post("https://exp.host/--/api/v2/push/send", json=messages, timeout=15)
    resp.raise_for_status()
    n.pushed = True
