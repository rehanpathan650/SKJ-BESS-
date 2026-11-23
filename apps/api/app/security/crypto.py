"""Encryption at rest for files and secrets, plus token hashing helpers."""
from __future__ import annotations

import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def _fernet() -> Fernet:
    return Fernet(get_settings().data_encryption_key.encode())


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    return _fernet().decrypt(token)


def encrypt_str(value: str) -> str:
    return encrypt_bytes(value.encode()).decode()


def decrypt_str(value: str) -> str:
    try:
        return decrypt_bytes(value.encode()).decode()
    except InvalidToken as exc:  # key mismatch or tampering
        raise ValueError("Unable to decrypt value") from exc


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
