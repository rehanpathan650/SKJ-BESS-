"""HTTP middleware: request IDs, client IP, security headers, global rate limit, body size cap, access log."""
from __future__ import annotations

import logging
import time
import uuid

from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app import audit, observability
from app.config import get_settings
from app.security import ratelimit
from app.services import cache

access_log = logging.getLogger("skj.access")


def client_ip(request: Request) -> str:
    """Only trust X-Forwarded-For when we know how many proxies sit in front (prevents IP spoofing)."""
    hops = get_settings().trusted_proxy_count
    if hops > 0:
        xff = request.headers.get("x-forwarded-for", "")
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.client.host if request.client else ""


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Cache-Control": "no-store",
}


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        settings = get_settings()
        rid = uuid.uuid4().hex[:16]
        ip = client_ip(request)
        audit.request_id.set(rid)
        audit.request_ip.set(ip)
        request.state.request_id = rid
        request.state.client_ip = ip
        start = time.perf_counter()
        token = audit.begin_request()
        try:
            return await self._dispatch(request, call_next, settings, rid, ip, start)
        finally:
            # Write this request's audit entries now that its own transaction is finished (off the event loop).
            items = audit.end_request(token)
            if items:
                await run_in_threadpool(audit.write_all, items)

    async def _dispatch(self, request: Request, call_next, settings, rid: str, ip: str, start: float) -> Response:

        # Body size cap (uploads are capped again while streaming).
        max_bytes = (settings.max_upload_mb + 1) * 1024 * 1024
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > max_bytes:
            return self._finish(request, JSONResponse({"detail": "Request too large"}, status_code=413), rid, start)

        if not ratelimit.check(f"ip:{ip}", settings.rate_limit_per_minute):
            audit.record("api", "rate_limited", outcome="denied", details={"path": request.url.path})
            resp = JSONResponse({"detail": "Too many requests"}, status_code=429, headers={"Retry-After": "60"})
            return self._finish(request, resp, rid, start)

        try:
            response = await call_next(request)
        except Exception:
            access_log.exception("unhandled error rid=%s", rid)
            response = JSONResponse({"detail": "Internal server error", "request_id": rid}, status_code=500)
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
            cache.bump()  # invalidate cached dashboards after any change
        return self._finish(request, response, rid, start)

    def _finish(self, request: Request, response: Response, rid: str, start: float) -> Response:
        settings = get_settings()
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["X-Request-ID"] = rid
        elapsed = time.perf_counter() - start
        route = getattr(request.scope.get("route"), "path", None) or "unmatched"
        observability.observe(request.method, route, response.status_code, elapsed)
        # Access log: route template only — no query strings or bodies (they may contain personal data).
        access_log.info(
            "rid=%s ip=%s user=%s %s %s -> %s %.0fms",
            rid, getattr(request.state, "client_ip", ""), getattr(request.state, "user_id", "-"),
            request.method, route, response.status_code, elapsed * 1000,
            extra={"rid": rid, "ip": getattr(request.state, "client_ip", ""), "user": getattr(request.state, "user_id", "-"),
                   "method": request.method, "route": route, "status": response.status_code, "ms": round(elapsed * 1000)},
        )
        return response
