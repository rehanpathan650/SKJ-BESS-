"""TOTP multi-factor authentication (authenticator apps)."""
from __future__ import annotations

import pyotp

from app.security.crypto import decrypt_str, encrypt_str


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="SKJ BESS")


def verify_code(secret_enc: str | None, code: str) -> bool:
    if not secret_enc or not code or not code.isdigit() or len(code) != 6:
        return False
    secret = decrypt_str(secret_enc)
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def encrypt_secret(secret: str) -> str:
    return encrypt_str(secret)
