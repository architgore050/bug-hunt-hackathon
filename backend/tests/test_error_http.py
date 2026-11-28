"""Public HTTP headers, readiness responses, and interpolated API errors."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from app import db
from app.config import settings
from app.db import app_session
from app.errors import ApiError, api_error_handler
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import text
from starlette.requests import Request


def _request(request_id: str) -> Request:
    return Request({"type": "http", "state": {"request_id": request_id}})


def test_api_error_handler_interpolates_catalog_details_and_header():
    response = asyncio.run(
        api_error_handler(
            _request("request-rate-limit"),
            ApiError("AUTH_RATE_LIMITED", details={"n": 7}),
        )
    )

    assert response.status_code == 429
    assert response.headers["X-Request-Id"] == "request-rate-limit"
    assert json.loads(response.body) == {
        "error": {
            "code": "AUTH_RATE_LIMITED",
            "message": "Too many attempts. Try again in 7 seconds.",
            "request_id": "request-rate-limit",
            "details": {"n": 7},
        }
    }


def test_api_error_handler_interpolates_internal_reference_without_leaking_exception():
    response = asyncio.run(api_error_handler(_request("request-internal"), ApiError("INTERNAL_ERROR")))

    assert response.status_code == 500
    assert json.loads(response.body) == {
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong. Reference: request-internal.",
            "request_id": "request-internal",
            "details": {},
        }
    }
    assert response.headers["X-Request-Id"] == "request-internal"
    assert b"Traceback" not in response.body


def test_registered_api_error_uses_middleware_request_id_and_private_cache_policy():
    app = create_app()

    @app.get("/_test/api-error")
    def fail_with_catalog_error():
        raise ApiError("SUBMISSION_COOLDOWN", details={"n": 12})

    with TestClient(app) as client:
        response = client.get("/_test/api-error", headers={"X-Request-Id": "cooldown-request"})

    assert response.status_code == 429
    assert response.headers["X-Request-Id"] == "cooldown-request"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "private, no-store"
    assert response.json() == {
        "error": {
            "code": "SUBMISSION_COOLDOWN",
            "message": "Please wait 12 seconds before another report on this file.",
            "request_id": "cooldown-request",
            "details": {"n": 12},
        }
    }


def test_health_reports_real_readiness_and_public_security_headers(client):
    response = client.get("/health", headers={"X-Request-Id": "health-request"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database_app"] == "up"
    assert body["database_gt"] == "up"
    assert datetime.fromisoformat(body["clock"]).tzinfo is not None
    assert response.headers["X-Request-Id"] == "health-request"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "public, max-age=10"


def test_health_returns_503_when_application_database_is_down(client, monkeypatch):
    monkeypatch.setattr(
        db,
        "health_probe",
        lambda: {"database_app": "down", "database_gt": "up", "clock": None},
    )

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database_app": "down", "database_gt": "up", "clock": None}
    assert response.headers["X-Request-Id"]
    assert response.headers["Cache-Control"] == "public, max-age=10"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_public_event_returns_only_public_fields_with_public_cache_policy(client):
    with app_session() as session:
        session.execute(text("UPDATE app.events SET status = 'ready' WHERE slug = 'fall-back-2026'"))

    response = client.get("/v1/public/event", headers={"X-Request-Id": "public-event"})

    assert response.status_code == 200
    event = response.json()["event"]
    assert set(event) == {
        "slug",
        "name",
        "status",
        "starts_at",
        "ends_at",
        "timezone",
        "duration_minutes",
        "max_participants",
        "max_teams",
        "rules_version",
        "format",
    }
    assert event["slug"] == "fall-back-2026"
    assert event["status"] == "ready"
    assert "tenant_id" not in event
    assert "config" not in event
    assert response.headers["X-Request-Id"] == "public-event"
    assert response.headers["Cache-Control"] == "public, max-age=10"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"


def test_non_public_response_generates_request_id_and_is_not_publicly_cached(client):
    response = client.get("/")

    assert response.status_code == 200
    request_id = response.headers["X-Request-Id"]
    assert len(request_id) == 16
    assert response.headers["Cache-Control"] == "private, no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"


def test_cors_preflight_allows_only_the_configured_exact_origin(client):
    response = client.options(
        "/v1/public/event",
        headers={
            "Origin": settings.frontend_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == settings.frontend_origin
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
    assert response.headers["Access-Control-Max-Age"] == "600"
    assert "Content-Type" in response.headers["Access-Control-Allow-Headers"]
