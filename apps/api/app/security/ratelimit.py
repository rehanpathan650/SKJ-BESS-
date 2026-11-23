"""Fixed-window rate limiter. Uses Redis when REDIS_URL is set (needed for multiple API workers),
otherwise an in-process store suitable for a single worker and for tests."""
from __future__ import annotations

import threading
import time

from app.config import get_settings


class _MemoryStore:
    def __init__(self) -> None:
        self._data: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, window: int) -> int:
        now = time.time()
        with self._lock:
            count, reset = self._data.get(key, (0, now + window))
            if now >= reset:
                count, reset = 0, now + window
            count += 1
            self._data[key] = (count, reset)
            if len(self._data) > 50_000:  # bound memory under attack
                self._data = {k: v for k, v in self._data.items() if v[1] > now}
            return count

    def reset(self) -> None:
        with self._lock:
            self._data.clear()


class _RedisStore:
    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)

    def hit(self, key: str, window: int) -> int:
        bucket = f"rl:{key}:{int(time.time() // window)}"
        pipe = self._r.pipeline()
        pipe.incr(bucket)
        pipe.expire(bucket, window + 1)
        count, _ = pipe.execute()
        return int(count)

    def reset(self) -> None:  # used only in tests
        pass


_store = None


def store():
    global _store
    if _store is None:
        url = get_settings().redis_url
        _store = _RedisStore(url) if url else _MemoryStore()
    return _store


_fallback = _MemoryStore()


def check(key: str, limit: int, window_seconds: int = 60) -> bool:
    """Return True if the request is allowed. If Redis is unreachable, limit per process instead of
    failing every request (availability) or skipping limits (security)."""
    try:
        return store().hit(key, window_seconds) <= limit
    except Exception:  # redis.ConnectionError, timeouts
        import logging

        logging.getLogger("skj.ratelimit").warning("Redis unavailable; using in-process rate limiting")
        return _fallback.hit(key, window_seconds) <= limit
