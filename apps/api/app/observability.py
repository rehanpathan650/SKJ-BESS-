"""Logging, error tracking and request metrics.

* LOG_FORMAT=json -> one JSON object per line for log collectors (Loki, CloudWatch, ELK...).
* SENTRY_DSN      -> optional error tracking. Bodies, cookies, query strings and auth headers are stripped.
* /api/v1/metrics -> Prometheus text format, protected by METRICS_TOKEN (disabled in production without it).
Metrics are labelled by route template (/customers/{customer_id}), never by real IDs, to keep cardinality low.
"""
from __future__ import annotations

import json
import logging
import sys
import threading
import time
from collections import defaultdict

from app.config import get_settings

BUCKETS = (0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
_lock = threading.Lock()
_count: dict[tuple, int] = defaultdict(int)
_hist: dict[tuple, list] = {}
_sum: dict[tuple, float] = defaultdict(float)
_started = time.time()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"), "level": record.levelname, "logger": record.name,
               "msg": record.getMessage()}
        for k in ("rid", "method", "route", "status", "ms", "user", "ip"):
            if hasattr(record, k):
                out[k] = getattr(record, k)
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def setup_logging() -> None:
    s = get_settings()
    root = logging.getLogger()
    root.handlers.clear()
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter() if s.log_format == "json"
                   else logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(h)
    root.setLevel(logging.INFO)


def _scrub(event, _hint):
    req = event.get("request") or {}
    for k in ("data", "cookies", "query_string", "env"):
        req.pop(k, None)
    headers = req.get("headers") or {}
    for k in list(headers):
        if k.lower() in ("authorization", "cookie", "x-csrf-token", "set-cookie"):
            headers[k] = "[removed]"
    event.pop("user", None)
    return event


def setup_error_tracking() -> None:
    s = get_settings()
    if not s.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(dsn=s.sentry_dsn, environment=s.environment, send_default_pii=False,
                    traces_sample_rate=0.05, before_send=_scrub, max_request_body_size="never")


def observe(method: str, route: str, status: int, seconds: float) -> None:
    key = (method, route, str(status // 100) + "xx")
    with _lock:
        _count[key] += 1
        _sum[(method, route)] += seconds
        h = _hist.setdefault((method, route), [0] * (len(BUCKETS) + 1))
        for i, b in enumerate(BUCKETS):
            if seconds <= b:
                h[i] += 1
        h[-1] += 1


def render() -> str:
    lines = ["# TYPE skj_http_requests_total counter"]
    with _lock:
        for (m, r, st), n in sorted(_count.items()):
            lines.append(f'skj_http_requests_total{{method="{m}",route="{r}",status="{st}"}} {n}')
        lines.append("# TYPE skj_http_request_duration_seconds histogram")
        for (m, r), h in sorted(_hist.items()):
            for i, b in enumerate(BUCKETS):
                lines.append(f'skj_http_request_duration_seconds_bucket{{method="{m}",route="{r}",le="{b}"}} {h[i]}')
            lines.append(f'skj_http_request_duration_seconds_bucket{{method="{m}",route="{r}",le="+Inf"}} {h[-1]}')
            lines.append(f'skj_http_request_duration_seconds_sum{{method="{m}",route="{r}"}} {_sum[(m, r)]:.4f}')
            lines.append(f'skj_http_request_duration_seconds_count{{method="{m}",route="{r}"}} {h[-1]}')
    lines.append("# TYPE skj_process_uptime_seconds gauge")
    lines.append(f"skj_process_uptime_seconds {time.time() - _started:.0f}")
    return "\n".join(lines) + "\n"
