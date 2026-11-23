"""Short-lived JWT access tokens. Each token is bound to a server-side session so it can be revoked."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings

ALGORITHM = "HS256"
ISSUER = "skj-bess"
AUDIENCE = "skj-bess-api"


def create_access_token(user_id: str, session_id: str, token_type: str = "access", minutes: int | None = None) -> str:  # nosec B107 - token_type default, not a password
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "sid": session_id,
        "typ": token_type,
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(minutes=minutes or s.access_token_minutes),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str, expected_type: str = "access") -> dict:
    s = get_settings()
    # algorithms is pinned: rejects "none" and algorithm-confusion attacks.
    payload = jwt.decode(
        token,
        s.jwt_secret,
        algorithms=[ALGORITHM],
        audience=AUDIENCE,
        issuer=ISSUER,
        options={"require": ["exp", "iat", "sub", "sid", "typ"]},
    )
    if payload.get("typ") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload
