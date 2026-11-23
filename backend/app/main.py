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

from .config import cors_origins, settings
from .errors import ApiError, api_error_handler, unhandled_error_handler
from .routers import admin, announcements, auth, challenges, leaderboard, public, review, state, submissions

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("bughunt")


@asynccontextmanager
async def lifespan(app: FastAPI):
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
        # body size limit (architecture 7.3)
        cl = request.headers.get("content-length")
        if cl and int(cl) > settings.max_body_bytes:
            return JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code": "SUBMISSION_INVALID",
                        "message": "Request body too large.",
                        "request_id": request_id,
                        "details": {},
                    }
                },
                headers={"X-Request-Id": request_id},
            )
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cache-Control", "private, no-store")
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
        submissions.router,
        leaderboard.router,
        announcements.router,
        review.router,
        admin.router,
    ):
        app.include_router(router, prefix="/v1")

    @app.get("/health")
    def health():
        from .db import health_probe

        probe = health_probe()
        status = 200 if probe["database_app"] == "up" else 503
        return JSONResponse(status_code=status, content={"status": "ok" if status == 200 else "degraded", **probe})

    return app


app = create_app()
