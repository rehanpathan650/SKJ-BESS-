from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import observability
from app.config import get_settings
from app.db import engine
from app.middleware import SecurityMiddleware
from app.routers import admin, auth, bills, calculator, customers, misc, proposals, quotations, security

observability.setup_logging()
observability.setup_error_tracking()
log = logging.getLogger("skj.health")


def create_app() -> FastAPI:
    s = get_settings()
    docs = not s.is_production  # no public API docs in production
    app = FastAPI(
        title=s.app_name,
        version="1.0.0",
        docs_url="/api/v1/docs" if docs else None,
        redoc_url=None,
        openapi_url="/api/v1/openapi.json" if docs else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
        max_age=600,
    )
    app.add_middleware(SecurityMiddleware)

    for r in (auth.router, admin.router, customers.router, bills.router, calculator.router,
              proposals.router, proposals.public, misc.router, security.router, quotations.router,
              quotations.public):
        app.include_router(r, prefix="/api/v1")

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        # Return field names and messages only; never echo the submitted values back.
        errors = [{"field": ".".join(str(x) for x in e.get("loc", [])[1:]), "message": e.get("msg", "")}
                  for e in exc.errors()][:20]
        return JSONResponse({"detail": "Invalid input", "errors": errors}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.get("/api/v1/health")
    def health():
        """Liveness: the process is up. Used by load balancers; does no I/O."""
        return {"status": "ok"}

    @app.get("/api/v1/health/ready")
    def ready():
        """Readiness: database, cache and file storage are reachable. Details are logged, not returned."""
        checks = {}
        try:
            with engine.connect() as c:
                c.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception:
            log.exception("readiness: database")
            checks["database"] = "fail"
        if s.redis_url:
            try:
                import redis
                redis.Redis.from_url(s.redis_url, socket_connect_timeout=2).ping()
                checks["cache"] = "ok"
            except Exception:
                log.exception("readiness: redis")
                checks["cache"] = "fail"
        try:
            from app.services import storage
            storage.backend().ready()
            checks["storage"] = "ok"
        except Exception:
            log.exception("readiness: storage")
            checks["storage"] = "fail"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse({"status": "ok" if ok else "fail", "checks": checks}, status_code=200 if ok else 503)

    @app.get("/api/v1/metrics", include_in_schema=False)
    def metrics(request: Request):
        token = s.metrics_token
        if token:
            import hmac
            given = request.headers.get("authorization", "").removeprefix("Bearer ")
            if not hmac.compare_digest(given.encode(), token.encode()):
                return JSONResponse({"detail": "Not found"}, status_code=404)
        elif s.is_production:
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return PlainTextResponse(observability.render(), media_type="text/plain; version=0.0.4")

    return app


app = create_app()
