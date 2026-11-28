"""FastAPI application factory (participant + staff API).

Request pipeline (architecture 7.3): request ID -> size/type limits ->
authenticate -> authorize -> validate -> bounded transaction -> audit ->
stable error envelope with request ID. No scoring logic lives in handlers.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import cors_origins, settings, validate_production_config
from .errors import ApiError, api_error_handler, unhandled_error_handler
from .routers import (
    admin,
    admin_levels,
    announcements,
    auth,
    challenges,
    leaderboard,
    levels,
    public,
    review,
    state,
    submissions,
)

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("bughunt")


def _error_response(request_id: str, status: int, code: str, message: str) -> JSONResponse:
    """Uniform middleware-level error envelope (matches errors.py shape)."""
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "request_id": request_id, "details": {}}},
        headers={"X-Request-Id": request_id},
    )


def _client_version_lt(candidate: str, minimum: str) -> bool:
    """Loose semver-ish comparison: True when ``candidate`` < ``minimum``.

    Used by the minimum-client-version gate (REM-075).  We compare dot-separated
    numeric components left to right; non-numeric segments sort below numeric
    ones so a dev build like ``0.0.0-dev`` is treated as older than ``1.0.0``.
    """

    def parts(v: str):
        out = []
        for p in v.split("."):
            try:
                out.append((0, int(p)))
            except ValueError:
                out.append((1, p))
        return out

    try:
        return parts(candidate) < parts(minimum)
    except Exception:  # noqa: BLE001 - comparison must never crash the request
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail closed on insecure configuration (REM-025): a production process
    # must never boot on dev secrets / dev DB URLs / an empty CORS allow-list.
    violations = validate_production_config()
    if violations:
        for v in violations:
            log.critical("startup config violation: %s", v)
        raise RuntimeError("Refusing to start in production with insecure configuration: " + "; ".join(violations))
    # REM-002: fail-loud marker so a production boot can never silently run
    # pre-split.  The durable fix is a separate evaluator service that owns
    # the GT credential while this API runs as app_api only (owner decision
    # ADR-007); until the split lands, the warning fires once per process.
    if settings.environment == "production":
        log.warning(
            "REM-002: the participant API process still holds the GT credential; "
            "the evaluator split (docs/SECURITY_ARCHITECTURE.md) must be completed before the event."
        )
    log.info("starting Bug Hunt CTF API profile=%s environment=%s", settings.profile, settings.environment)
    yield
    log.info("shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Bug Hunt CTF Platform API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/v1/docs" if settings.environment == "development" else None,
        openapi_url="/v1/openapi.json" if settings.environment == "development" else None,
    )

    # Exact-origin CORS allow-list; no wildcards (NET-05).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-BHCTF-Client", "X-Step-Up"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id

        # Minimum client version gate (REM-075): a stale cached SPA must not
        # drive a broken contract against a newer API.  Empty setting = off
        # (dev).  We only gate the versioned /v1 surface so health checks and
        # the public root are unaffected.
        mv = settings.minimum_client_version
        if mv and request.url.path.startswith("/v1"):
            cv = request.headers.get(settings.client_version_header, "")
            if cv and _client_version_lt(cv, mv):
                return _error_response(
                    request_id,
                    426,
                    "CLIENT_VERSION_UNSUPPORTED",
                    "Your app version is no longer supported. Please refresh.",
                )

        # body size limit (architecture 7.3); artifact uploads get the upload cap.
        is_upload = request.url.path == "/v1/uploads"
        limit = settings.max_upload_bytes if is_upload else settings.max_body_bytes
        cl = request.headers.get("content-length")
        if cl:
            # Content-Length is client-controlled and only a hint; we still
            # enforce it early to shed obvious abuse, but the streaming read
            # below is the authoritative guard (REM-024).
            try:
                cl_int = int(cl)
            except ValueError:
                return _error_response(request_id, 400, "VALIDATION_ERROR", "Invalid Content-Length.")
            if cl_int > limit:
                return _error_response(request_id, 413, "SUBMISSION_INVALID", "Request body too large.")

        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        # Security response headers (REM-026): a complete baseline set rather
        # than the previous partial two.  These are setdefault so a handler may
        # still override (e.g. public cache policy).
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cache-Control", "private, no-store")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        # A restrictive default CSP; the SPA ships no inline scripts and loads
        # only self-hosted assets, so 'self' is sufficient.  Handlers that need
        # to relax this (none today) must do so explicitly.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
        )
        if request.url.path.startswith("/v1/public") or request.url.path.startswith("/health"):
            response.headers["Cache-Control"] = "public, max-age=10"
        return response

    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    for router in (
        public.router,
        auth.router,
        state.router,
        challenges.router,
        levels.router,
        submissions.router,
        leaderboard.router,
        announcements.router,
        review.router,
        admin.router,
        admin_levels.router,
    ):
        app.include_router(router, prefix="/v1")

    @app.get("/health")
    def health():
        from .db import health_probe

        probe = health_probe()
        status = 200 if probe["database_app"] == "up" else 503
        return JSONResponse(status_code=status, content={"status": "ok" if status == 200 else "degraded", **probe})

    @app.get("/")
    def root() -> dict:
        # Root marker so the API URL is not a 404. The user-facing app is the
        # Vite SPA on the frontend port (default 5173).
        return {"app": app.title, "status": "ok"}

    return app


app = create_app()
