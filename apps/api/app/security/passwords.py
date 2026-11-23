"""Password hashing (Argon2id) and password policy."""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1) or stronger.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2, hash_len=32, salt_len=16)

# A real dummy hash so failed lookups take the same time as real checks (prevents user enumeration).
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing-only")

# Small embedded list of the most common passwords; the length rule removes most others.
_COMMON = {
    "password", "password1", "password123", "123456789012", "qwertyuiop", "letmein123",
    "welcome123", "admin12345", "iloveyou123", "skjenergy123", "changeme123", "p@ssw0rd123",
    "qwerty123456", "1q2w3e4r5t6y", "abc123456789", "passw0rd1234", "solarenergy1",
}

MIN_LENGTH = 12
MAX_LENGTH = 128


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problems(password: str, email: str = "", name: str = "") -> list[str]:
    problems: list[str] = []
    if len(password) < MIN_LENGTH:
        problems.append(f"Password must be at least {MIN_LENGTH} characters.")
    if len(password) > MAX_LENGTH:
        problems.append(f"Password must be at most {MAX_LENGTH} characters.")
    lowered = password.lower()
    if lowered in _COMMON:
        problems.append("This password is too common.")
    local = email.split("@")[0].lower() if email else ""
    if local and len(local) >= 4 and local in lowered:
        problems.append("Password must not contain your email name.")
    for part in name.lower().split():
        if len(part) >= 4 and part in lowered:
            problems.append("Password must not contain your name.")
            break
    if len(set(password)) < 5:
        problems.append("Password is too repetitive.")
    return problems
