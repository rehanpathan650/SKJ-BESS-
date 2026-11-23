"""Database models. IDs are random UUIDs so records cannot be enumerated by guessing numbers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


TS = DateTime(timezone=True)


class UserStatus:
    PENDING_VERIFICATION = "pending_verification"
    PENDING_APPROVAL = "pending_approval"
    ACTIVE = "active"
    REJECTED = "rejected"
    DISABLED = "disabled"


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default=UserStatus.PENDING_VERIFICATION, index=True)
    role_id: Mapped[str | None] = mapped_column(ForeignKey("roles.id"), nullable=True, index=True)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    requested_department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    mfa_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    lockout_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    approved_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    password_changed_at: Mapped[datetime] = mapped_column(TS, default=now)
    last_login_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)

    role: Mapped[Role | None] = relationship(foreign_keys=[role_id], lazy="joined")
    department: Mapped[Department | None] = relationship(foreign_keys=[department_id], lazy="joined")
    requested_department: Mapped[Department | None] = relationship(foreign_keys=[requested_department_id])


class AuthSession(Base):
    """A login session. Refresh tokens are stored only as SHA-256 hashes."""

    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refresh_hash: Mapped[str] = mapped_column(String(64), index=True)
    client_type: Mapped[str] = mapped_column(String(20), default="web")  # web | mobile
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    last_used_at: Mapped[datetime] = mapped_column(TS, default=now)
    expires_at: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)

    user: Mapped[User] = relationship()


class OneTimeToken(Base):
    """Email verification and password reset tokens (hash only)."""

    __tablename__ = "one_time_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))  # verify_email | reset_password | mfa_ticket
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200), index=True)
    company: Mapped[str] = mapped_column(String(200), default="")
    industry: Mapped[str] = mapped_column(String(100), default="")
    contact_name: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(100), default="")
    gstin: Mapped[str] = mapped_column(String(20), default="")
    discom: Mapped[str] = mapped_column(String(150), default="")
    consumer_number: Mapped[str] = mapped_column(String(60), default="")
    tariff_category: Mapped[str] = mapped_column(String(100), default="")
    department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"), nullable=True, index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now, index=True)

    owner: Mapped[User | None] = relationship(foreign_keys=[owner_id])
    assignments: Mapped[list[CustomerAssignment]] = relationship(cascade="all, delete-orphan")


class CustomerAssignment(Base):
    __tablename__ = "customer_assignments"
    __table_args__ = (UniqueConstraint("customer_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)

    user: Mapped[User] = relationship()


class CustomerNote(Base):
    __tablename__ = "customer_notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)

    author: Mapped[User] = relationship()


class ProjectStage:
    ALL = [
        "lead",
        "site_survey",
        "technical_validation",
        "proposal",
        "negotiation",
        "won",
        "installation",
        "commissioned",
        "lost",
    ]


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    site_address: Mapped[str] = mapped_column(Text, default="")
    stage: Mapped[str] = mapped_column(String(40), default="lead", index=True)
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    estimated_value_inr: Mapped[float] = mapped_column(Float, default=0.0)
    target_capacity_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    engineer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now, index=True)

    customer: Mapped[Customer] = relationship()
    engineer: Mapped[User | None] = relationship(foreign_keys=[engineer_id])
    owner: Mapped[User | None] = relationship(foreign_keys=[owner_id])


class StoredFile(Base):
    """Every uploaded or generated file. Stored encrypted under a random name."""

    __tablename__ = "stored_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    stored_name: Mapped[str] = mapped_column(String(64), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    scan_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|clean|infected|skipped|error
    uploaded_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Bill(Base):
    __tablename__ = "bills"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("stored_files.id"))
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    # queued | scanning | extracting | needs_review | reviewed | failed | rejected
    status_detail: Mapped[str] = mapped_column(String(500), default="")
    extraction_method: Mapped[str] = mapped_column(String(30), default="")  # ai | text | manual
    extracted: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reviewed: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    security_flags: Mapped[list[str]] = mapped_column(JSON, default=list)
    reviewed_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    uploaded_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)

    file: Mapped[StoredFile] = relationship()
    customer: Mapped[Customer] = relationship()


class Calculation(Base):
    __tablename__ = "calculations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    inputs: Mapped[dict[str, Any]] = mapped_column(JSON)
    results: Mapped[dict[str, Any]] = mapped_column(JSON)
    # Confidential cost side (vendor cost, margin). Only returned to commercial.confidential.view.
    commercial: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    validation_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|approved|rejected
    validation_note: Mapped[str] = mapped_column(Text, default="")
    validated_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    validated_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)

    project: Mapped[Project] = relationship()


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    calculation_id: Mapped[str] = mapped_column(ForeignKey("calculations.id"))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    # draft | pending_approval | approved | rejected | sent | accepted | declined | superseded
    status_note: Mapped[str] = mapped_column(Text, default="")
    file_id: Mapped[str | None] = mapped_column(ForeignKey("stored_files.id"), nullable=True)
    # Full techno-commercial quotation (BOQ, payment schedule, financing, savings, wording); null for older proposals.
    quotation: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now, index=True)

    project: Mapped[Project] = relationship()
    calculation: Mapped[Calculation] = relationship()


class ShareLink(Base):
    __tablename__ = "share_links"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    recipient_note: Mapped[str] = mapped_column(String(200), default="")
    expires_at: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, default=0)
    max_downloads: Mapped[int] = mapped_column(Integer, default=10)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(1000), default="")
    link: Mapped[str] = mapped_column(String(300), default="")
    read_at: Mapped[datetime | None] = mapped_column(TS, nullable=True, index=True)
    pushed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class PushToken(Base):
    __tablename__ = "push_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Job(Base):
    """Background job queue (bill processing, proposal rendering, emails, push)."""

    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(50), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|running|done|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(String(500), default="")
    run_after: Mapped[datetime] = mapped_column(TS, default=now)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now)


class LLMUsage(Base):
    __tablename__ = "llm_usage"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    bill_id: Mapped[str | None] = mapped_column(ForeignKey("bills.id", ondelete="SET NULL"), nullable=True)
    model: Mapped[str] = mapped_column(String(100))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    outcome: Mapped[str] = mapped_column(String(40))  # ok | refusal | invalid_output | error | blocked
    created_at: Mapped[datetime] = mapped_column(TS, default=now, index=True)


class AppSetting(Base):
    """Key/value settings. The 'commercial' key holds confidential pricing assumptions."""

    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now)


class AuditLog(Base):
    """Append-only, hash-chained audit trail. The app DB role has no UPDATE/DELETE on this table."""

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(TS, default=now, index=True)
    category: Mapped[str] = mapped_column(String(30), index=True)  # auth|user|role|data|file|proposal|security|api|admin
    action: Mapped[str] = mapped_column(String(80), index=True)
    outcome: Mapped[str] = mapped_column(String(20), default="success")  # success|failure|denied
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_email: Mapped[str] = mapped_column(String(254), default="")
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    request_id: Mapped[str] = mapped_column(String(40), default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
