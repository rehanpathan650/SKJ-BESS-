"""Sign-up, email verification, login (with MFA), token refresh, logout, password reset, own sessions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import (
    ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, Principal, active_user, any_user,
)
from app.models import AuthSession, Department, OneTimeToken, User, UserStatus
from app.security import mfa, ratelimit
from app.security import permissions as P
from app.security.crypto import constant_time_equals, new_token, sha256_hex
from app.security.passwords import hash_password, needs_rehash, password_problems, verify_password
from app.security.tokens import create_access_token, decode_token
from app.services.notify import notify, queue_email, users_with_permission

router = APIRouter(prefix="/auth", tags=["auth"])

GENERIC_LOGIN_ERROR = "Invalid email or password, or the account is temporarily locked."


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------- schemas ----------

class SignupIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    department_id: str | None = Field(default=None, max_length=36)


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class EmailIn(BaseModel):
    email: EmailStr


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    client: Literal["web", "mobile"] = "web"


class MfaLoginIn(BaseModel):
    mfa_ticket: str = Field(min_length=10, max_length=2000)
    code: str = Field(min_length=6, max_length=6)
    client: Literal["web", "mobile"] = "web"


class RefreshIn(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=300)


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class DisableMfaIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=6)


# ---------- helpers ----------

def _domain_allowed(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].lower()
    return domain in get_settings().allowed_domains


def _issue_one_time(db: Session, user: User, purpose: str, hours: float) -> str:
    raw = new_token()
    db.add(OneTimeToken(user_id=user.id, purpose=purpose, token_hash=sha256_hex(raw),
                        expires_at=utcnow() + timedelta(hours=hours)))
    return raw


def _consume_one_time(db: Session, raw: str, purpose: str) -> User | None:
    t = db.execute(select(OneTimeToken).where(OneTimeToken.token_hash == sha256_hex(raw))).scalar_one_or_none()
    if t is None or t.purpose != purpose or t.used_at is not None or aware(t.expires_at) < utcnow():
        return None
    t.used_at = utcnow()
    return db.get(User, t.user_id)


def _send_verification(db: Session, user: User) -> None:
    raw = _issue_one_time(db, user, "verify_email", 24)
    link = f"{get_settings().public_base_url}/verify-email?token={raw}"
    queue_email(db, user.email, "Verify your SKJ account",
                f"Hello {user.full_name},\n\nConfirm your email address to continue:\n{link}\n\n"
                "This link expires in 24 hours. If you did not sign up, ignore this email.")


def _new_session(db: Session, user: User, request: Request, client: str) -> tuple[AuthSession, str]:
    s = get_settings()
    secret = new_token()
    sess = AuthSession(
        user_id=user.id,
        refresh_hash=sha256_hex(secret),
        client_type=client,
        ip=getattr(request.state, "client_ip", ""),
        user_agent=request.headers.get("user-agent", "")[:300],
        expires_at=utcnow() + timedelta(hours=s.refresh_token_idle_hours),
    )
    db.add(sess)
    db.flush()
    return sess, f"{sess.id}.{secret}"


def _token_response(response: Response, user: User, sess: AuthSession, refresh: str, client: str) -> dict:
    s = get_settings()
    access = create_access_token(user.id, sess.id)
    body: dict = {"status": user.status, "expires_in": s.access_token_minutes * 60}
    if client == "mobile":
        body.update(access_token=access, refresh_token=refresh, token_type="bearer")  # nosec B106 - 'bearer' is the OAuth token_type, not a password
    else:
        csrf = new_token(24)
        common = {"secure": s.cookie_secure, "samesite": "strict"}
        response.set_cookie(ACCESS_COOKIE, access, httponly=True, path="/api",
                            max_age=s.access_token_minutes * 60, **common)
        response.set_cookie(REFRESH_COOKIE, refresh, httponly=True, path="/api/v1/auth",
                            max_age=s.refresh_token_idle_hours * 3600, **common)
        response.set_cookie(CSRF_COOKIE, csrf, httponly=False, path="/",
                            max_age=s.refresh_token_idle_hours * 3600, **common)
        body["csrf_token"] = csrf
    return body


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/api")
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _complete_login(db: Session, user: User, request: Request, response: Response, client: str) -> dict:
    user.failed_logins = 0
    user.lockout_count = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    sess, refresh = _new_session(db, user, request, client)
    db.commit()
    audit.record("auth", "login.success", actor=user, target_type="session", target_id=sess.id,
                 details={"client": client})
    return _token_response(response, user, sess, refresh, client)


def _register_failure(db: Session, user: User | None, email: str, reason: str) -> None:
    s = get_settings()
    if user is not None:
        user.failed_logins += 1
        if user.failed_logins >= s.max_failed_logins:
            minutes = s.lockout_base_minutes * (2 ** min(user.lockout_count, 6))  # progressive delay
            user.locked_until = utcnow() + timedelta(minutes=minutes)
            user.lockout_count += 1
            user.failed_logins = 0
            audit.record("security", "account.locked", actor=user, outcome="denied",
                         details={"minutes": minutes})
        db.commit()
    audit.record("auth", "login.failed", actor_id=user.id if user else None, actor_email=email,
                 outcome="failure", details={"reason": reason})


# ---------- sign-up & verification ----------

@router.get("/departments")
def list_departments(db: Session = Depends(get_db)):
    return [{"id": d.id, "name": d.name} for d in db.execute(select(Department).order_by(Department.name)).scalars()]


@router.post("/signup", status_code=202)
def signup(data: SignupIn, request: Request, db: Session = Depends(get_db)):
    if get_settings().single_user_mode:
        raise HTTPException(403, "Sign-up is turned off: this installation uses a single login.")
    ip = getattr(request.state, "client_ip", "")
    if not ratelimit.check(f"signup:{ip}", 5, 3600):
        raise HTTPException(429, "Too many sign-up attempts. Try again later.")
    email = data.email.lower().strip()
    generic = {"detail": "If this email is eligible, a verification link has been sent. "
                         "After verifying, an administrator will review your account."}
    if not _domain_allowed(email):
        # Telling outsiders which domain is allowed is acceptable here; it is the company domain.
        raise HTTPException(400, "Please sign up with your SKJ company email address.")
    problems = password_problems(data.password, email, data.full_name)
    if problems:
        raise HTTPException(400, " ".join(problems))
    if data.department_id and db.get(Department, data.department_id) is None:
        raise HTTPException(400, "Unknown department")

    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        # Do not reveal that the account exists; re-send verification if still pending.
        if existing.status == UserStatus.PENDING_VERIFICATION:
            _send_verification(db, existing)
            db.commit()
        audit.record("auth", "signup.duplicate", actor_email=email, outcome="failure")
        return generic

    s = get_settings()
    user = User(
        email=email,
        full_name=data.full_name.strip(),
        password_hash=hash_password(data.password),
        requested_department_id=data.department_id,
        status=UserStatus.PENDING_VERIFICATION if s.require_email_verification else UserStatus.PENDING_APPROVAL,
    )
    db.add(user)
    db.flush()
    if s.require_email_verification:
        _send_verification(db, user)
    else:
        _notify_admins_of_pending(db, user)
    db.commit()
    audit.record("user", "signup", actor=user, target_type="user", target_id=user.id)
    return generic


def _notify_admins_of_pending(db: Session, user: User) -> None:
    admins = users_with_permission(db, "users.manage")
    notify(db, admins, "account", "New account awaiting approval",
           f"{user.full_name} ({user.email}) signed up and needs a role.", "/admin/users?status=pending_approval")


@router.post("/verify-email")
def verify_email(data: TokenIn, db: Session = Depends(get_db)):
    user = _consume_one_time(db, data.token, "verify_email")
    if user is None:
        raise HTTPException(400, "This link is invalid or has expired.")
    if user.status == UserStatus.PENDING_VERIFICATION:
        user.status = UserStatus.PENDING_APPROVAL
        user.email_verified_at = utcnow()
        _notify_admins_of_pending(db, user)
    db.commit()
    audit.record("user", "email.verified", actor=user, target_type="user", target_id=user.id)
    return {"detail": "Email verified. An administrator will review your account."}


@router.post("/resend-verification", status_code=202)
def resend_verification(data: EmailIn, request: Request, db: Session = Depends(get_db)):
    if not ratelimit.check(f"resend:{request.state.client_ip}", 5, 3600):
        raise HTTPException(429, "Too many requests")
    user = db.execute(select(User).where(User.email == data.email.lower())).scalar_one_or_none()
    if user and user.status == UserStatus.PENDING_VERIFICATION:
        _send_verification(db, user)
        db.commit()
    return {"detail": "If the account needs verification, a new link has been sent."}


# ---------- login ----------

@router.post("/login")
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    s = get_settings()
    email = data.email.lower().strip()
    ip = getattr(request.state, "client_ip", "")
    if not ratelimit.check(f"login:ip:{ip}", s.login_rate_limit_per_minute) or not ratelimit.check(
        f"login:email:{email}", s.login_rate_limit_per_minute
    ):
        audit.record("security", "login.rate_limited", actor_email=email, outcome="denied")
        raise HTTPException(429, "Too many login attempts. Wait a minute and try again.")

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    password_ok = verify_password(data.password, user.password_hash if user else None)

    if user is None:
        _register_failure(db, None, email, "unknown_email")
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    if user.locked_until and aware(user.locked_until) > utcnow():
        _register_failure(db, None, email, "locked")
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    if not password_ok:
        _register_failure(db, user, email, "bad_password")
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    if user.status in (UserStatus.DISABLED, UserStatus.REJECTED):
        _register_failure(db, None, email, user.status)
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    if user.status == UserStatus.PENDING_VERIFICATION:
        raise HTTPException(403, "Please verify your email address first. Check your inbox for the link.")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)

    if user.mfa_enabled:
        ticket = create_access_token(user.id, "mfa", token_type="mfa", minutes=s.mfa_ticket_minutes)  # nosec B106 - token_type label, not a password
        db.commit()
        return {"mfa_required": True, "mfa_ticket": ticket}
    return _complete_login(db, user, request, response, data.client)


@router.post("/mfa/login")
def mfa_login(data: MfaLoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        payload = decode_token(data.mfa_ticket, "mfa")
    except Exception:
        raise HTTPException(401, "MFA session expired. Please log in again.")
    if not ratelimit.check(f"mfa:{payload['sub']}", 5):
        raise HTTPException(429, "Too many attempts")
    user = db.get(User, payload["sub"])
    if user is None or user.status in (UserStatus.DISABLED, UserStatus.REJECTED):
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    if not mfa.verify_code(user.mfa_secret_enc, data.code):
        _register_failure(db, user, user.email, "bad_mfa_code")
        raise HTTPException(401, "Invalid code")
    return _complete_login(db, user, request, response, data.client)


@router.post("/refresh")
def refresh(request: Request, response: Response, data: RefreshIn | None = None, db: Session = Depends(get_db)):
    s = get_settings()
    raw = (data.refresh_token if data else None) or request.cookies.get(REFRESH_COOKIE)
    client = "mobile" if data and data.refresh_token else "web"
    if not raw or "." not in raw:
        raise HTTPException(401, "Not authenticated")
    sid, secret = raw.split(".", 1)
    sess = db.get(AuthSession, sid)
    if sess is None or sess.revoked_at is not None or aware(sess.expires_at) < utcnow():
        _clear_cookies(response)
        raise HTTPException(401, "Session ended")
    if not constant_time_equals(sess.refresh_hash, sha256_hex(secret)):
        # A rotated (old) refresh token was replayed: treat as theft and kill the session.
        sess.revoked_at = utcnow()
        sess.revoked_reason = "refresh_token_reuse"
        db.commit()
        audit.record("security", "refresh.reuse_detected", actor_id=sess.user_id, outcome="denied",
                     target_type="session", target_id=sess.id)
        raise HTTPException(401, "Session ended")
    created = aware(sess.created_at)
    absolute_end = created + timedelta(days=s.refresh_token_absolute_days)
    if absolute_end < utcnow():
        sess.revoked_at = utcnow()
        sess.revoked_reason = "absolute_timeout"
        db.commit()
        raise HTTPException(401, "Session ended")
    user = db.get(User, sess.user_id)
    if user is None or user.status in (UserStatus.DISABLED, UserStatus.REJECTED):
        raise HTTPException(401, "Session ended")
    new_secret = new_token()
    sess.refresh_hash = sha256_hex(new_secret)
    sess.last_used_at = utcnow()
    sess.expires_at = min(absolute_end, utcnow() + timedelta(hours=s.refresh_token_idle_hours))
    db.commit()
    return _token_response(response, user, sess, f"{sess.id}.{new_secret}", client)


@router.post("/logout")
def logout(response: Response, p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    sess = db.get(AuthSession, p.session.id)
    if sess and sess.revoked_at is None:
        sess.revoked_at = utcnow()
        sess.revoked_reason = "logout"
        db.commit()
    _clear_cookies(response)
    audit.record("auth", "logout", actor=p.user, target_type="session", target_id=p.session.id)
    return {"detail": "Logged out"}


@router.get("/me")
def me(p: Principal = Depends(any_user)):
    u = p.user
    role_perms = u.role.permissions if u.role else []
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "status": u.status,
        "role": {"id": u.role.id, "name": u.role.name} if u.role and u.status == UserStatus.ACTIVE else None,
        "department": {"id": u.department.id, "name": u.department.name} if u.department else None,
        "permissions": sorted(p.perms),
        "mfa_enabled": u.mfa_enabled,
        "mfa_required": P.requires_mfa(role_perms) and u.status == UserStatus.ACTIVE,
        "single_user_mode": get_settings().single_user_mode,
        "session_id": p.session.id,
    }


# ---------- MFA enrolment ----------

@router.post("/mfa/setup")
def mfa_setup(p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    user = db.get(User, p.id)
    if user.mfa_enabled:
        raise HTTPException(400, "MFA is already enabled")
    secret = mfa.new_secret()
    user.mfa_secret_enc = mfa.encrypt_secret(secret)
    db.commit()
    return {"secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, user.email)}


@router.post("/mfa/enable")
def mfa_enable(data: CodeIn, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    user = db.get(User, p.id)
    if not mfa.verify_code(user.mfa_secret_enc, data.code):
        raise HTTPException(400, "Invalid code. Check your authenticator app's time and try again.")
    user.mfa_enabled = True
    db.commit()
    audit.record("security", "mfa.enabled", actor=user, target_type="user", target_id=user.id)
    return {"detail": "MFA enabled"}


@router.post("/mfa/disable")
def mfa_disable(data: DisableMfaIn, p: Principal = Depends(active_user), db: Session = Depends(get_db)):
    user = db.get(User, p.id)
    if P.requires_mfa(user.role.permissions if user.role else []):
        raise HTTPException(400, "Your role requires MFA; it cannot be turned off.")
    if not verify_password(data.password, user.password_hash) or not mfa.verify_code(user.mfa_secret_enc, data.code):
        raise HTTPException(400, "Password or code is incorrect")
    user.mfa_enabled = False
    user.mfa_secret_enc = None
    db.commit()
    audit.record("security", "mfa.disabled", actor=user, target_type="user", target_id=user.id)
    return {"detail": "MFA disabled"}


# ---------- passwords ----------

@router.post("/forgot-password", status_code=202)
def forgot_password(data: EmailIn, request: Request, db: Session = Depends(get_db)):
    if not ratelimit.check(f"forgot:{request.state.client_ip}", 5, 3600):
        raise HTTPException(429, "Too many requests")
    user = db.execute(select(User).where(User.email == data.email.lower())).scalar_one_or_none()
    if user and user.status not in (UserStatus.DISABLED, UserStatus.REJECTED):
        raw = _issue_one_time(db, user, "reset_password", 1)
        link = f"{get_settings().public_base_url}/reset-password?token={raw}"
        queue_email(db, user.email, "Reset your SKJ password",
                    f"A password reset was requested for your account.\n\n{link}\n\n"
                    "This link expires in 1 hour. If you did not request it, ignore this email.")
        db.commit()
        audit.record("auth", "password.reset_requested", actor=user)
    return {"detail": "If an account exists for this email, a reset link has been sent."}


def _revoke_all_sessions(db: Session, user_id: str, reason: str, except_id: str | None = None) -> int:
    q = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if except_id:
        q = q.where(AuthSession.id != except_id)
    res = db.execute(q.values(revoked_at=utcnow(), revoked_reason=reason))
    return res.rowcount or 0


@router.post("/reset-password")
def reset_password(data: ResetIn, db: Session = Depends(get_db)):
    user = _consume_one_time(db, data.token, "reset_password")
    if user is None:
        raise HTTPException(400, "This link is invalid or has expired.")
    problems = password_problems(data.password, user.email, user.full_name)
    if problems:
        db.rollback()
        raise HTTPException(400, " ".join(problems))
    user.password_hash = hash_password(data.password)
    user.password_changed_at = utcnow()
    user.failed_logins = 0
    user.locked_until = None
    _revoke_all_sessions(db, user.id, "password_reset")
    db.commit()
    audit.record("auth", "password.reset", actor=user, target_type="user", target_id=user.id)
    return {"detail": "Password updated. Please log in."}


@router.post("/change-password")
def change_password(data: ChangePasswordIn, p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    user = db.get(User, p.id)
    if not verify_password(data.current_password, user.password_hash):
        audit.record("auth", "password.change_failed", actor=user, outcome="failure")
        raise HTTPException(400, "Current password is incorrect")
    problems = password_problems(data.new_password, user.email, user.full_name)
    if problems:
        raise HTTPException(400, " ".join(problems))
    user.password_hash = hash_password(data.new_password)
    user.password_changed_at = utcnow()
    n = _revoke_all_sessions(db, user.id, "password_changed", except_id=p.session.id)
    db.commit()
    audit.record("auth", "password.changed", actor=user, details={"other_sessions_revoked": n})
    return {"detail": "Password changed. Other devices have been signed out."}


# ---------- own sessions ----------

@router.get("/sessions")
def my_sessions(p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(AuthSession).where(AuthSession.user_id == p.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_used_at.desc())
    ).scalars()
    return [
        {"id": s.id, "client_type": s.client_type, "ip": s.ip, "user_agent": s.user_agent,
         "created_at": s.created_at, "last_used_at": s.last_used_at, "current": s.id == p.session.id}
        for s in rows if aware(s.expires_at) > utcnow()
    ]


@router.delete("/sessions/{session_id}")
def revoke_my_session(session_id: str, p: Principal = Depends(any_user), db: Session = Depends(get_db)):
    sess = db.get(AuthSession, session_id)
    if sess is None or sess.user_id != p.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    sess.revoked_at = utcnow()
    sess.revoked_reason = "user_revoked"
    db.commit()
    audit.record("auth", "session.revoked", actor=p.user, target_type="session", target_id=session_id)
    return {"detail": "Session revoked"}
