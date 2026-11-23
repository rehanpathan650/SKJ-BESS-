"""Small TTL cache for expensive read-only results (e.g. dashboards).

Uses Redis when REDIS_URL is set, so all API processes share it; otherwise a per-process memory cache.
Values must be JSON-serialisable. Never cache anything that crosses users: keys always include the user ID.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Callable

from app.config import get_settings

_mem: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()
_redis = None


def _r():
    global _redis
    if _redis is None and get_settings().redis_url:
        import redis

        _redis = redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)
    return _redis


def get_or_set(key: str, ttl: int, fn: Callable[[], Any]) -> Any:
    key = f"skj:cache:{key}"
    r = _r()
    if r is not None:
        try:
            hit = r.get(key)
            if hit is not None:
                return json.loads(hit)
            value = fn()
            r.setex(key, ttl, json.dumps(value, default=str))
            return value
        except Exception:
            return fn()  # Redis down: compute directly
    now = time.time()
    with _lock:
        hit = _mem.get(key)
        if hit and hit[0] > now:
            return json.loads(hit[1])
    value = fn()
    with _lock:
        _mem[key] = (now + ttl, json.dumps(value, default=str))
        if len(_mem) > 5000:
            for k in [k for k, (exp, _) in _mem.items() if exp <= now]:
                _mem.pop(k, None)
    return json.loads(json.dumps(value, default=str))


_version = 0


def version() -> int:
    """Data version: bumped after every successful change, so cached results never outlive an edit."""
    r = _r()
    if r is not None:
        try:
            return int(r.get("skj:cache:version") or 0)
        except Exception:
            return -1
    return _version


def bump() -> None:
    global _version
    r = _r()
    if r is not None:
        try:
            r.incr("skj:cache:version")
            return
        except Exception:  # Redis unavailable: fall back to the in-process version below
            logging.getLogger("skj.cache").warning("cache version bump failed; using in-process version")
    with _lock:
        _version += 1


def clear() -> None:
    with _lock:
        _mem.clear()
