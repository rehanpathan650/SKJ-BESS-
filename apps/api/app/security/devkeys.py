"""Development-only key bootstrap.

In development and test, if JWT_SECRET / DATA_ENCRYPTION_KEY are not set, generate them once and
keep them in a local git-ignored file so restarts don't invalidate sessions or make stored files
unreadable. Production configuration refuses to start without real keys (see config.py).
"""
from __future__ import annotations

import json
import os
import secrets

from cryptography.fernet import Fernet


def ensure_dev_keys(settings) -> None:
    if settings.jwt_secret and settings.data_encryption_key:
        return
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    path = settings.storage_dir / ".devkeys.json"
    data: dict[str, str] = {}
    if path.exists():
        data = json.loads(path.read_text("utf-8"))
    changed = False
    if "jwt_secret" not in data:
        data["jwt_secret"] = secrets.token_urlsafe(48)
        changed = True
    if "data_encryption_key" not in data:
        data["data_encryption_key"] = Fernet.generate_key().decode()
        changed = True
    if changed:
        path.write_text(json.dumps(data), "utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    if not settings.jwt_secret:
        settings.jwt_secret = data["jwt_secret"]
    if not settings.data_encryption_key:
        settings.data_encryption_key = data["data_encryption_key"]
