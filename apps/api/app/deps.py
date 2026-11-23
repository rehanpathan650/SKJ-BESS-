"""Authentication and authorisation dependencies used by every protected endpoint."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import audit
from app.db import get_db
from app.models import AuthSession, User, UserStatus
from app.security import permissions as P
from app.security.crypto import constant_time_equals
from app.security.tokens import decode_token

ACCESS_COOKIE = "skj_access"
REFRESH_COOKIE = "skj_refresh"
CSRF_COOKIE = "skj_csrf"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class Principal:
    user: User
    session: AuthSession
    perms: set[str] = field(default_factory=set)
    via_cookie: bool = False

    @property
    def id(self) -> str:
        return self.user.id

    def has(self, perm: str) -> bool:
        return "*" in self.perms or perm in self.perms

    def has_any(self, *perms: str) -> bool:
        return any(self.has(p) for p in perms)


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _authenticate(request: Request, db: Session) -> Principal:
    token = None
    via_cookie = False
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    elif request.cookies.get(ACCESS_COOKIE):
        token = request.cookies[ACCESS_COOKIE]
        via_cookie = True
    if not token:
        raise _unauthorized()

    try:
        payload = decode_token(token, "access")
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.PyJWTError:
        audit.record("security", "token.invalid", outcome="denied", details={"path": request.url.path})
        raise _unauthorized("Invalid token")

    # CSRF: cookie-authenticated, state-changing requests must echo the CSRF cookie in a header.
    if via_cookie and request.method not in SAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        cookie = request.cookies.get(CSRF_COOKIE, "")
        if not header or not cookie or not constant_time_equals(header, cookie):
            audit.record("security", "csrf.rejected", outcome="denied", actor_id=payload.get("sub"),
                         details={"path": request.url.path})
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="CSRF check failed")

    sess = db.get(AuthSession, payload["sid"])
    if (
        sess is None
        or sess.user_id != payload["sub"]
        or sess.revoked_at is not None
        or _as_aware(sess.expires_at) < datetime.now(timezone.utc)
    ):
        raise _unauthorized("Session ended")
    user = db.get(User, payload["sub"])
    if user is None or user.status in (UserStatus.DISABLED, UserStatus.REJECTED):
        raise _unauthorized("Account unavailable")
    request.state.user_id = user.id
    perms = P.expand(user.role.permissions if (user.role and user.status == UserStatus.ACTIVE) else [])
    return Principal(user=user, session=sess, perms=perms, via_cookie=via_cookie)


def any_user(request: Request, db: Session = Depends(get_db)) -> Principal:
    """Logged in, any status (pending users may call /auth/me and log out)."""
    return _authenticate(request, db)


def active_user(request: Request, db: Session = Depends(get_db)) -> Principal:
    """Logged in, approved, and MFA enrolled if the role demands it."""
    principal = _authenticate(request, db)
    if principal.user.status != UserStatus.ACTIVE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Account awaiting approval")
    role_perms = principal.user.role.permissions if principal.user.role else []
    if P.requires_mfa(role_perms) and not principal.user.mfa_enabled:
        path = request.url.path
        if not path.startswith("/api/v1/auth/"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="mfa_setup_required")
    return principal


def require(*perms: str, any_of: bool = False):
    """Dependency factory: require all (default) or any of the given permissions."""

    def checker(request: Request, principal: Principal = Depends(active_user)) -> Principal:
        ok = principal.has_any(*perms) if any_of else all(principal.has(p) for p in perms)
        if not ok:
            audit.record(
                "security", "permission.denied", actor=principal.user, outcome="denied",
                details={"path": request.url.path, "required": list(perms)},
            )
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You do not have permission for this action")
        return principal

    return checker


def not_found() -> HTTPException:
    # Same response for "doesn't exist" and "not allowed" so IDs can't be probed (IDOR).
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
