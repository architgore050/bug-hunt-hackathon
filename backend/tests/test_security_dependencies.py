"""HTTP and real-database tests for authentication dependencies and security gates."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import jwt
import pytest
from app import deps, security
from app.config import settings
from app.db import app_session
from app.errors import ApiError
from conftest import STAFF_PW
from fastapi import Request
from sqlalchemy import text

CSRF_HEADERS = {"Origin": settings.frontend_origin, "X-BHCTF-Client": "web"}


def _assert_error(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "request_id", "details"}
    assert error["code"] == code
    assert response.headers["X-Request-Id"] == error["request_id"]
    return error


def _login(client, email: str) -> dict:
    response = client.post(
        "/v1/auth/login",
        json={"email": email, "password": STAFF_PW},
        headers={"X-Request-Id": f"login-{uuid.uuid4().hex[:12]}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _principal(client, email: str) -> deps.Principal:
    token = _login(client, email)["access_token"]
    claims = security.decode_access_token(token)
    with app_session() as session:
        row = (
            session.execute(
                text(
                    "SELECT u.id, u.email, u.name, u.role, u.token_version, s.id AS session_id "
                    "FROM app.users u JOIN app.sessions s ON s.user_id = u.id "
                    "WHERE u.id = CAST(:uid AS uuid) AND s.id = CAST(:sid AS uuid)"
                ),
                {"uid": claims["sub"], "sid": claims["sid"]},
            )
            .mappings()
            .one()
        )
    return deps.Principal(row)


def _state_counts() -> dict:
    with app_session() as session:
        row = (
            session.execute(
                text(
                    "SELECT (SELECT count(*) FROM app.users) AS users, "
                    "(SELECT count(*) FROM app.sessions) AS sessions, "
                    "(SELECT count(*) FROM app.refresh_tokens) AS refresh_tokens, "
                    "(SELECT count(*) FROM audit.entries) AS audit_entries"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


def test_rate_limit_uses_frozen_monotonic_window_and_isolates_keys(_clear_rate_limits, monkeypatch):
    clock = SimpleNamespace(now=100.0)
    monkeypatch.setattr(deps.time, "monotonic", lambda: clock.now)

    deps.rate_limit("login:test-client", limit=2, window_s=10)
    deps.rate_limit("login:test-client", limit=2, window_s=10)
    with pytest.raises(ApiError) as raised:
        deps.rate_limit("login:test-client", limit=2, window_s=10)

    assert raised.value.code == "AUTH_RATE_LIMITED"
    assert raised.value.status == 429
    assert raised.value.details == {"n": 10}
    assert deps._bucket["login:test-client"] == [100.0, 100.0]

    deps.rate_limit("login:another-client", limit=2, window_s=10)
    clock.now = 109.999
    with pytest.raises(ApiError):
        deps.rate_limit("login:test-client", limit=2, window_s=10)
    assert deps._bucket["login:test-client"] == [100.0, 100.0]

    clock.now = 110.0
    deps.rate_limit("login:test-client", limit=2, window_s=10)
    assert deps._bucket["login:test-client"] == [110.0]


def test_rate_limit_http_failure_uses_error_envelope_without_creating_auth_state(client, monkeypatch):
    clock = SimpleNamespace(now=500.0)
    monkeypatch.setattr(deps.time, "monotonic", lambda: clock.now)
    before = _state_counts()
    email = "throttled-login@example.com"

    responses = [
        client.post(
            "/v1/auth/login",
            json={"email": email, "password": "Wrong-Password-For-Test-123!"},
            headers={"X-Request-Id": f"rate-limit-{index}"},
        )
        for index in range(10)
    ]
    assert all(response.status_code == 401 for response in responses)

    denied = client.post(
        "/v1/auth/login",
        json={"email": email, "password": "Wrong-Password-For-Test-123!"},
        headers={"X-Request-Id": "rate-limit-final"},
    )
    error = _assert_error(denied, 429, "AUTH_RATE_LIMITED")
    assert error["details"] == {"n": 60}
    assert "60 seconds" in error["message"]
    assert _state_counts() == before


@pytest.mark.parametrize(
    ("headers", "code"),
    [
        ({}, "AUTH_TOKEN_EXPIRED"),
        ({"Authorization": "Basic dXNlcjpwYXNz"}, "AUTH_TOKEN_EXPIRED"),
        ({"Authorization": "Bearer not-a-jwt"}, "AUTH_SESSION_REVOKED"),
    ],
)
def test_missing_or_malformed_credentials_are_rejected_without_side_effects(client, headers, code):
    before = _state_counts()

    response = client.get("/v1/me", headers=headers)

    _assert_error(response, 401, code)
    assert _state_counts() == before


def test_principal_maps_expired_and_invalid_token_failures_to_distinct_envelopes(client):
    now = datetime.now(UTC)
    base_claims = {
        "iss": "bughunt-api",
        "aud": "bughunt-participant",
        "sub": str(uuid.uuid4()),
        "sid": str(uuid.uuid4()),
        "role": "participant",
        "tv": 1,
        "iat": int((now - timedelta(minutes=2)).timestamp()),
        "nbf": int((now - timedelta(minutes=2)).timestamp()),
        "exp": int((now - timedelta(minutes=1)).timestamp()),
        "jti": "0123456789abcdef",
    }
    expired = jwt.encode(base_claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    before = _state_counts()

    _assert_error(client.get("/v1/me", headers=_auth(expired)), 401, "AUTH_TOKEN_EXPIRED")
    _assert_error(client.get("/v1/me", headers=_auth(f"{expired}tampered")), 401, "AUTH_SESSION_REVOKED")
    assert _state_counts() == before


def test_principal_rejects_unknown_session_and_stale_token_version(client):
    login = _login(client, "p1.team1@example.com")
    claims = security.decode_access_token(login["access_token"])
    unknown_session = {**claims, "sid": str(uuid.uuid4())}
    stale_version = {**claims, "tv": claims["tv"] + 1}

    for forged_claims in (unknown_session, stale_version):
        token = jwt.encode(forged_claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        _assert_error(client.get("/v1/me", headers=_auth(token)), 401, "AUTH_SESSION_REVOKED")


def test_principal_rejects_revoked_session(client):
    login = _login(client, "p1.team1@example.com")
    session_id = security.decode_access_token(login["access_token"])["sid"]
    with app_session() as session:
        session.execute(
            text("UPDATE app.sessions SET revoked_at = now() WHERE id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        )

    _assert_error(client.get("/v1/me", headers=_auth(login["access_token"])), 401, "AUTH_SESSION_REVOKED")


def test_principal_uses_session_and_role_without_account_lifecycle_status(client):
    principal = _principal(client, "p1.team1@example.com")
    assert principal.role == "participant"
    assert principal.email == "p1.team1@example.com"
    assert not hasattr(principal, "status")


def test_http_role_boundaries_cover_participant_staff_organizer_and_admin(client):
    participant = _login(client, "p1.team1@example.com")["access_token"]
    reviewer = _login(client, "reviewer1@example.com")["access_token"]
    organizer = _login(client, "organizer@example.com")["access_token"]
    admin = _login(client, "admin@example.com")["access_token"]
    with app_session() as session:
        stage_id = str(session.execute(text("SELECT id FROM app.stages WHERE kind = 'main'")).scalar_one())
    step_up = client.post("/v1/auth/step-up", headers=_auth(organizer), json={"password": STAFF_PW})
    assert step_up.status_code == 200, step_up.text
    before = _state_counts()

    _assert_error(client.get("/v1/admin/events", headers=_auth(participant)), 403, "AUTH_FORBIDDEN")
    _assert_error(client.get("/v1/review/queue", headers=_auth(participant)), 403, "AUTH_FORBIDDEN")
    assert client.get("/v1/review/queue", headers=_auth(reviewer)).status_code == 200
    _assert_error(client.get("/v1/admin/events", headers=_auth(reviewer)), 403, "AUTH_FORBIDDEN")
    assert client.get("/v1/admin/events", headers=_auth(organizer)).status_code == 200
    assert client.get("/v1/review/queue", headers=_auth(organizer)).status_code == 200
    _assert_error(
        client.post(
            "/v1/admin/adjustments",
            headers=_auth(organizer),
            json={"stage_id": stage_id, "team_id": str(uuid.uuid4()), "points": 1, "reason": "denied"},
        ),
        403,
        "AUTH_FORBIDDEN",
    )
    assert client.get("/v1/admin/events", headers=_auth(admin)).status_code == 200
    assert client.get(f"/v1/results/{stage_id}", headers=_auth(participant)).status_code == 200
    _assert_error(client.get(f"/v1/results/{stage_id}", headers=_auth(organizer)), 403, "AUTH_FORBIDDEN")
    assert _state_counts() == before


def test_signed_role_claim_cannot_elevate_the_database_principal(client):
    login = _login(client, "p1.team1@example.com")
    claims = security.decode_access_token(login["access_token"])
    forged = jwt.encode({**claims, "role": "admin"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    before = _state_counts()

    _assert_error(client.get("/v1/admin/events", headers=_auth(forged)), 403, "AUTH_FORBIDDEN")
    profile = client.get("/v1/me", headers=_auth(forged))
    assert profile.status_code == 200, profile.text
    assert profile.json()["role"] == "participant"
    assert _state_counts() == before


def test_rules_gate_requires_acceptance_for_the_current_published_version(client):
    participant = _login(client, "p1.team1@example.com")["access_token"]
    user_id = security.decode_access_token(participant)["sub"]
    with app_session() as session:
        session.execute(text("UPDATE app.events SET status = 'ready', rules_version = 2"))
        session.execute(
            text(
                "INSERT INTO app.acceptances (id, user_id, rules_version) "
                "VALUES (CAST(:id AS uuid), CAST(:uid AS uuid), 1)"
            ),
            {"id": str(uuid.uuid4()), "uid": user_id},
        )
        progress_before = session.execute(
            text("SELECT count(*) FROM app.participant_progress WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": user_id},
        ).scalar_one()
        audit_before = session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one()

    _assert_error(client.get("/v1/levels", headers=_auth(participant)), 403, "RULES_NOT_ACCEPTED")
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM app.participant_progress WHERE user_id = CAST(:uid AS uuid)"),
                {"uid": user_id},
            ).scalar_one()
            == progress_before
        )
        assert session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one() == audit_before
        session.execute(
            text(
                "INSERT INTO app.acceptances (id, user_id, rules_version) "
                "VALUES (CAST(:id AS uuid), CAST(:uid AS uuid), 2)"
            ),
            {"id": str(uuid.uuid4()), "uid": user_id},
        )

    assert client.get("/v1/levels", headers=_auth(participant)).status_code == 200
    organizer = _principal(client, "organizer@example.com")
    assert deps.require_rules_accepted(organizer) is None


def test_rules_gate_is_inactive_until_an_event_is_published(client):
    participant = _login(client, "p1.team1@example.com")["access_token"]

    response = client.get("/v1/levels", headers=_auth(participant))

    error = _assert_error(response, 409, "LEVEL_NOT_OPEN")
    assert error["message"] == "The event is not running yet."


@pytest.mark.parametrize(
    ("age_minutes", "expected_code"),
    [(None, "ADMIN_STEP_UP_REQUIRED"), (4, None), (6, "ADMIN_STEP_UP_REQUIRED")],
)
def test_step_up_gate_enforces_five_minute_freshness(client, age_minutes, expected_code):
    principal = _principal(client, "organizer@example.com")
    with app_session() as session:
        if age_minutes is None:
            session.execute(
                text("UPDATE app.sessions SET step_up_at = NULL WHERE id = CAST(:sid AS uuid)"),
                {"sid": principal.session_id},
            )
        else:
            session.execute(
                text(
                    "UPDATE app.sessions SET step_up_at = now() - MAKE_INTERVAL(mins => :age) "
                    "WHERE id = CAST(:sid AS uuid)"
                ),
                {"age": age_minutes, "sid": principal.session_id},
            )

    if expected_code is None:
        assert deps.step_up_verified(_request(), principal) is principal
    else:
        with pytest.raises(ApiError) as raised:
            deps.step_up_verified(_request(), principal)
        assert raised.value.code == expected_code
        assert raised.value.status == 403


@pytest.mark.parametrize("email", ["p1.team1@example.com", "reviewer1@example.com"])
def test_step_up_gate_rejects_roles_without_organizer_privileges(client, email):
    principal = _principal(client, email)

    with pytest.raises(ApiError) as raised:
        deps.step_up_verified(_request(), principal)

    assert raised.value.code == "AUTH_FORBIDDEN"


@pytest.mark.parametrize(
    ("headers", "message"),
    [
        ({}, "Origin not allowed."),
        ({"X-BHCTF-Client": "web"}, "Origin not allowed."),
        ({"Origin": "https://attacker.example"}, "Origin not allowed."),
        ({"Origin": settings.frontend_origin}, "Missing client header."),
        ({"Origin": settings.frontend_origin, "X-BHCTF-Client": ""}, "Missing client header."),
    ],
)
def test_refresh_csrf_denials_do_not_rotate_or_revoke_state(client, headers, message):
    login = _login(client, "p1.team1@example.com")
    session_id = security.decode_access_token(login["access_token"])["sid"]
    with app_session() as session:
        before = (
            session.execute(
                text(
                    "SELECT status, rotated_at, successor_encrypted FROM app.refresh_tokens "
                    "WHERE session_id = CAST(:sid AS uuid)"
                ),
                {"sid": session_id},
            )
            .mappings()
            .one()
        )
        revoked_at = session.execute(
            text("SELECT revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        ).scalar_one()
        audit_count = session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one()

    error = _assert_error(client.post("/v1/auth/refresh", headers=headers), 403, "AUTH_FORBIDDEN")

    assert error["message"] == message
    with app_session() as session:
        after = (
            session.execute(
                text(
                    "SELECT status, rotated_at, successor_encrypted FROM app.refresh_tokens "
                    "WHERE session_id = CAST(:sid AS uuid)"
                ),
                {"sid": session_id},
            )
            .mappings()
            .one()
        )
        assert dict(after) == dict(before)
        assert (
            session.execute(
                text("SELECT revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
                {"sid": session_id},
            ).scalar_one()
            == revoked_at
        )
        assert session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one() == audit_count


def test_refresh_without_a_cookie_is_denied_without_side_effects(client):
    before = _state_counts()

    response = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)

    _assert_error(response, 401, "AUTH_SESSION_REVOKED")
    assert _state_counts() == before


def test_request_context_reuses_the_middleware_request_id_or_generates_a_uuid():
    with_id = Request({"type": "http", "headers": [], "state": {"request_id": "request-123"}})
    without_id = Request({"type": "http", "headers": []})

    assert deps.request_context(with_id) == "request-123"
    generated = deps.request_context(without_id)
    assert str(uuid.UUID(generated)) == generated
