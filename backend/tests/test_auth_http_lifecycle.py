"""HTTP lifecycle coverage for login, registration, refresh, activation, reset, and sessions."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie

import pytest
from app import security
from app.config import settings
from app.db import app_session
from app.routers import auth as auth_router
from conftest import STAFF_PW
from sqlalchemy import text

REFRESH_COOKIE = "bhctf_refresh"
CSRF_HEADERS = {"Origin": settings.frontend_origin, "X-BHCTF-Client": "web"}
NEW_PASSWORD = "New-Password-For-Coverage-123!"


class _FrozenDateTime(datetime):
    current: datetime

    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return cls.current.replace(tzinfo=None)
        return cls.current.astimezone(tz)


def _assert_error(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "request_id", "details"}
    assert error["code"] == code
    assert response.headers["X-Request-Id"] == error["request_id"]
    return error


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(
    client,
    email: str,
    *,
    password: str = STAFF_PW,
    user_agent: str | None = None,
    request_id: str | None = None,
):
    headers = {"X-Request-Id": request_id or f"login-{uuid.uuid4().hex[:12]}"}
    if user_agent is not None:
        headers["User-Agent"] = user_agent
    response = client.post("/v1/auth/login", json={"email": email, "password": password}, headers=headers)
    assert response.status_code == 200, response.text
    return response


def _refresh_cookie(response) -> SimpleCookie:
    parsed = SimpleCookie()
    parsed.load(response.headers["set-cookie"])
    return parsed[REFRESH_COOKIE]


def _assert_refresh_cookie(response, raw_token: str) -> None:
    cookie = _refresh_cookie(response)
    assert cookie.value == raw_token
    assert cookie["path"] == "/v1/auth/refresh"
    assert cookie["httponly"]
    assert cookie["samesite"].lower() == "strict"
    assert not cookie["secure"]
    assert cookie["domain"] == ""
    assert int(cookie["max-age"]) == settings.refresh_token_ttl_s


def _state_counts() -> dict:
    with app_session() as session:
        row = (
            session.execute(
                text(
                    "SELECT (SELECT count(*) FROM app.users) AS users, "
                    "(SELECT count(*) FROM app.sessions) AS sessions, "
                    "(SELECT count(*) FROM app.refresh_tokens) AS refresh_tokens, "
                    "(SELECT count(*) FROM app.invites) AS invites, "
                    "(SELECT count(*) FROM app.acceptances) AS acceptances, "
                    "(SELECT count(*) FROM app.team_members) AS team_members, "
                    "(SELECT count(*) FROM app.password_resets) AS password_resets, "
                    "(SELECT count(*) FROM audit.entries) AS audit_entries"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def _event_and_team() -> tuple[str, str]:
    with app_session() as session:
        event_id = str(session.execute(text("SELECT id FROM app.events ORDER BY created_at LIMIT 1")).scalar_one())
        team_id = str(session.execute(text("SELECT id FROM app.teams ORDER BY created_at LIMIT 1")).scalar_one())
    return event_id, team_id


def _insert_invite(
    *,
    email: str,
    expires_at: datetime | None = None,
    used_at: datetime | None = None,
    team_id: str | None = None,
) -> tuple[str, str]:
    event_id, default_team_id = _event_and_team()
    raw = security.new_refresh_token()
    invite_id = str(uuid.uuid4())
    with app_session() as session:
        session.execute(
            text(
                "INSERT INTO app.invites "
                "(id, event_id, email, token_hash, team_id, role, used_at, expires_at) VALUES "
                "(CAST(:id AS uuid), CAST(:event AS uuid), :email, :token_hash, CAST(:team AS uuid), "
                "'participant', :used_at, :expires_at)"
            ),
            {
                "id": invite_id,
                "event": event_id,
                "email": email.lower(),
                "token_hash": security.token_hash(raw),
                "team": team_id or default_team_id,
                "used_at": used_at,
                "expires_at": expires_at or datetime.now(UTC) + timedelta(hours=1),
            },
        )
    return invite_id, raw


def _insert_reset(email: str, *, expires_at: datetime | None = None) -> tuple[str, str]:
    raw = security.new_refresh_token()
    reset_id = str(uuid.uuid4())
    with app_session() as session:
        session.execute(
            text(
                "INSERT INTO app.password_resets (id, user_id, token_hash, expires_at) "
                "SELECT CAST(:id AS uuid), id, :token_hash, :expires_at FROM app.users WHERE email = :email"
            ),
            {
                "id": reset_id,
                "token_hash": security.token_hash(raw),
                "expires_at": expires_at or datetime.now(UTC) + timedelta(minutes=30),
                "email": email.lower(),
            },
        )
    return reset_id, raw


def _refresh_rows(session_id: str) -> list[dict]:
    with app_session() as session:
        rows = (
            session.execute(
                text(
                    "SELECT id, user_id, token_hash, status, successor_encrypted, rotated_at, replaces_id, expires_at "
                    "FROM app.refresh_tokens WHERE session_id = CAST(:sid AS uuid) ORDER BY created_at"
                ),
                {"sid": session_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def test_login_success_persists_hashed_refresh_state_and_a_scoped_cookie(client):
    request_id = f"login-success-{uuid.uuid4().hex[:8]}"
    response = _login(
        client,
        "P1.Team1@Example.com",
        user_agent="Coverage test browser",
        request_id=request_id,
    )

    body = response.json()
    assert body["user"]["email"] == "p1.team1@example.com"
    assert body["user"]["role"] == "participant"
    assert body["user"]["status"] == "active"
    claims = security.decode_access_token(body["access_token"])
    assert claims["sub"] == body["user"]["id"]
    assert claims["role"] == "participant"
    assert claims["tv"] == 1
    assert datetime.fromisoformat(body["expires_at"]).tzinfo is UTC
    assert datetime.fromisoformat(body["server_time"]).tzinfo is UTC

    raw_refresh = _refresh_cookie(response).value
    _assert_refresh_cookie(response, raw_refresh)
    assert raw_refresh not in response.text
    with app_session() as session:
        session_row = (
            session.execute(
                text("SELECT user_id, ip_hash, user_agent, revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
                {"sid": claims["sid"]},
            )
            .mappings()
            .one()
        )
        refresh_row = (
            session.execute(
                text(
                    "SELECT user_id, token_hash, status, expires_at FROM app.refresh_tokens "
                    "WHERE token_hash = :token_hash"
                ),
                {"token_hash": security.token_hash(raw_refresh)},
            )
            .mappings()
            .one()
        )
        audit_row = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_type, entity_id, request_id "
                    "FROM audit.entries WHERE action = 'auth.login' AND request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert str(session_row["user_id"]) == body["user"]["id"]
    assert re.fullmatch(r"[0-9a-f]{32}", session_row["ip_hash"])
    assert session_row["user_agent"] == "Coverage test browser"
    assert session_row["revoked_at"] is None
    assert str(refresh_row["user_id"]) == body["user"]["id"]
    assert refresh_row["token_hash"] == security.token_hash(raw_refresh)
    assert refresh_row["token_hash"] != raw_refresh
    assert refresh_row["status"] == "active"
    assert refresh_row["expires_at"] > datetime.now(UTC)
    assert str(audit_row["actor_id"]) == body["user"]["id"]
    assert audit_row["actor_role"] == "participant"
    assert audit_row["entity_type"] == "user"
    assert audit_row["entity_id"] == body["user"]["id"]
    assert audit_row["request_id"] == request_id


def test_login_failures_are_generic_and_have_no_persistent_side_effects(client):
    before = _state_counts()
    headers = {"X-Request-Id": "same-login-denial-request"}

    existing = client.post(
        "/v1/auth/login",
        json={"email": "p1.team1@example.com", "password": "wrong-password"},
        headers=headers,
    )
    unknown = client.post(
        "/v1/auth/login",
        json={"email": "nobody@example.com", "password": "wrong-password"},
        headers=headers,
    )

    error = _assert_error(existing, 401, "AUTH_INVALID_CREDENTIALS")
    assert error["message"] == "Email or password is incorrect."
    assert error["details"] == {}
    assert unknown.json() == existing.json()
    assert _state_counts() == before


@pytest.mark.parametrize("role", ["participant", "reviewer", "organizer", "admin"])
def test_admin_registration_creates_active_accounts_for_each_valid_role(client, role):
    admin = _login(client, "admin@example.com").json()["access_token"]
    email = f"New.{role}.{uuid.uuid4().hex[:8]}@Example.com"
    password = "Registered-Password-123!"

    response = client.post(
        "/v1/auth/register",
        headers=_auth(admin),
        json={"email": email, "name": f"New {role.title()}", "password": password, "role": role},
    )

    assert response.status_code == 201, response.text
    assert response.json() == {
        "ok": True,
        "email": email.lower(),
        "message": "Account created. The user can now sign in.",
    }
    with app_session() as session:
        user = (
            session.execute(
                text(
                    "SELECT id, email, name, role, status, password_hash, token_version FROM app.users "
                    "WHERE lower(email) = :email"
                ),
                {"email": email.lower()},
            )
            .mappings()
            .one()
        )
        session_count = session.execute(
            text("SELECT count(*) FROM app.sessions WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": str(user["id"])},
        ).scalar_one()
        refresh_count = session.execute(
            text("SELECT count(*) FROM app.refresh_tokens WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": str(user["id"])},
        ).scalar_one()
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, details FROM audit.entries "
                    "WHERE action = 'auth.registered' AND details ->> 'email' = :email"
                ),
                {"email": email.lower()},
            )
            .mappings()
            .one()
        )
    assert user["email"] == email.lower()
    assert user["name"] == f"New {role.title()}"
    assert user["role"] == role
    assert user["status"] == "active"
    assert user["token_version"] == 1
    assert security.verify_password(password, user["password_hash"])
    assert session_count == 0
    assert refresh_count == 0
    assert audit["actor_role"] == "admin"
    assert audit["details"] == {"email": email.lower(), "role": role}
    assert _login(client, email.lower(), password=password).json()["user"]["role"] == role


@pytest.mark.parametrize("email", ["p1.team1@example.com", "reviewer1@example.com", "organizer@example.com"])
def test_non_admin_registration_is_denied_without_creating_an_account(client, email):
    token = _login(client, email).json()["access_token"]
    target = f"blocked-{uuid.uuid4().hex[:8]}@example.com"
    before = _state_counts()

    response = client.post(
        "/v1/auth/register",
        headers=_auth(token),
        json={
            "email": target,
            "name": "Blocked Registration",
            "password": "Registered-Password-123!",
            "role": "participant",
        },
    )

    _assert_error(response, 403, "AUTH_FORBIDDEN")
    assert _state_counts() == before
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM app.users WHERE lower(email) = :email"),
                {"email": target},
            ).scalar_one()
            == 0
        )


def test_duplicate_registration_is_generic_and_does_not_change_the_existing_account(client):
    admin = _login(client, "admin@example.com").json()["access_token"]
    with app_session() as session:
        password_hash_before = session.execute(
            text("SELECT password_hash FROM app.users WHERE email = 'admin@example.com'")
        ).scalar_one()
    before = _state_counts()

    response = client.post(
        "/v1/auth/register",
        headers=_auth(admin),
        json={
            "email": "ADMIN@example.com",
            "name": "Duplicate Admin",
            "password": "Replacement-Password-123!",
            "role": "participant",
        },
    )

    error = _assert_error(response, 422, "VALIDATION_ERROR")
    assert error["details"] == {"email": "Registration failed. Try again."}
    assert _state_counts() == before
    with app_session() as session:
        assert (
            session.execute(text("SELECT password_hash FROM app.users WHERE email = 'admin@example.com'")).scalar_one()
            == password_hash_before
        )


def test_refresh_normal_rotation_persists_the_successor_family(client):
    login = _login(client, "p1.team1@example.com")
    old_access = login.json()["access_token"]
    old_claims = security.decode_access_token(old_access)
    old_raw = _refresh_cookie(login).value
    with app_session() as session:
        last_seen_before = session.execute(
            text("SELECT last_seen_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": old_claims["sid"]},
        ).scalar_one()

    response = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)

    assert response.status_code == 200, response.text
    new_raw = _refresh_cookie(response).value
    assert new_raw != old_raw
    _assert_refresh_cookie(response, new_raw)
    new_claims = security.decode_access_token(response.json()["access_token"])
    assert new_claims["sub"] == old_claims["sub"]
    assert new_claims["sid"] == old_claims["sid"]
    assert new_claims["role"] == old_claims["role"]
    assert new_claims["tv"] == old_claims["tv"]
    assert new_claims["jti"] != old_claims["jti"]
    assert int(datetime.fromisoformat(response.json()["expires_at"]).timestamp()) == new_claims["exp"]

    rows = _refresh_rows(old_claims["sid"])
    assert len(rows) == 2
    old_row = next(row for row in rows if row["token_hash"] == security.token_hash(old_raw))
    new_row = next(row for row in rows if row["token_hash"] == security.token_hash(new_raw))
    assert old_row["status"] == "rotated"
    assert old_row["rotated_at"] is not None
    assert security.decrypt_successor(old_row["successor_encrypted"]) == new_raw
    assert new_row["status"] == "active"
    assert new_row["successor_encrypted"] is None
    assert new_row["rotated_at"] is None
    assert str(new_row["replaces_id"]) == str(old_row["id"])
    assert str(new_row["user_id"]) == old_claims["sub"]
    with app_session() as session:
        last_seen_after = session.execute(
            text("SELECT last_seen_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": old_claims["sid"]},
        ).scalar_one()
        revoked_at = session.execute(
            text("SELECT revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": old_claims["sid"]},
        ).scalar_one()
    assert last_seen_after >= last_seen_before
    assert revoked_at is None
    assert client.get("/v1/me", headers=_auth(response.json()["access_token"])).status_code == 200


@pytest.mark.parametrize("seconds_after_rotation", [settings.refresh_reuse_grace_s - 1, settings.refresh_reuse_grace_s])
def test_refresh_retry_inside_grace_returns_the_same_successor_without_a_new_row(
    client, monkeypatch, seconds_after_rotation
):
    login = _login(client, "p1.team1@example.com")
    old_raw = _refresh_cookie(login).value
    session_id = security.decode_access_token(login.json()["access_token"])["sid"]
    first_rotation = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)
    assert first_rotation.status_code == 200, first_rotation.text
    successor_raw = _refresh_cookie(first_rotation).value
    rows_before = _refresh_rows(session_id)
    old_row = next(row for row in rows_before if row["token_hash"] == security.token_hash(old_raw))
    _FrozenDateTime.current = old_row["rotated_at"] + timedelta(seconds=seconds_after_rotation)
    monkeypatch.setattr(auth_router, "datetime", _FrozenDateTime)
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, old_raw)

    retry = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)

    assert retry.status_code == 200, retry.text
    assert _refresh_cookie(retry).value == successor_raw
    assert _refresh_rows(session_id) == rows_before
    assert client.get("/v1/me", headers=_auth(retry.json()["access_token"])).status_code == 200


def test_refresh_reuse_outside_grace_revokes_the_whole_family(client, monkeypatch):
    login = _login(client, "p1.team1@example.com")
    old_access = login.json()["access_token"]
    old_raw = _refresh_cookie(login).value
    session_id = security.decode_access_token(old_access)["sid"]
    rotation = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)
    assert rotation.status_code == 200, rotation.text
    successor_raw = _refresh_cookie(rotation).value
    successor_access = rotation.json()["access_token"]
    old_row = next(row for row in _refresh_rows(session_id) if row["token_hash"] == security.token_hash(old_raw))
    assert any(row["token_hash"] == security.token_hash(successor_raw) for row in _refresh_rows(session_id))
    _FrozenDateTime.current = old_row["rotated_at"] + timedelta(seconds=settings.refresh_reuse_grace_s + 1)
    monkeypatch.setattr(auth_router, "datetime", _FrozenDateTime)
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, old_raw)

    reuse = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)

    _assert_error(reuse, 401, "AUTH_SESSION_REVOKED")
    assert {row["status"] for row in _refresh_rows(session_id)} == {"revoked"}
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
                {"sid": session_id},
            ).scalar_one()
            is not None
        )
    _assert_error(client.get("/v1/me", headers=_auth(old_access)), 401, "AUTH_SESSION_REVOKED")
    _assert_error(client.get("/v1/me", headers=_auth(successor_access)), 401, "AUTH_SESSION_REVOKED")


def test_expired_refresh_token_is_denied_without_revoking_the_live_session(client):
    login = _login(client, "p1.team1@example.com")
    access = login.json()["access_token"]
    session_id = security.decode_access_token(access)["sid"]
    raw = _refresh_cookie(login).value
    with app_session() as session:
        session.execute(
            text(
                "UPDATE app.refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = :token_hash"
            ),
            {"token_hash": security.token_hash(raw)},
        )
    before = _state_counts()

    response = client.post("/v1/auth/refresh", headers=CSRF_HEADERS)

    _assert_error(response, 401, "AUTH_SESSION_REVOKED")
    assert _state_counts() == before
    assert [row["status"] for row in _refresh_rows(session_id)] == ["active"]
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
                {"sid": session_id},
            ).scalar_one()
            is None
        )
    assert client.get("/v1/me", headers=_auth(access)).status_code == 200


def test_logout_revokes_only_the_current_session_and_clears_the_cookie(client):
    email = "p2.team1@example.com"
    first = _login(client, email)
    second = _login(client, email)
    other = _login(client, "p1.team2@example.com")
    first_claims = security.decode_access_token(first.json()["access_token"])
    second_claims = security.decode_access_token(second.json()["access_token"])
    other_claims = security.decode_access_token(other.json()["access_token"])
    second_raw = _refresh_cookie(second).value
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, second_raw)

    request_id = f"logout-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/v1/auth/logout",
        headers={**_auth(second.json()["access_token"]), "X-Request-Id": request_id},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    cleared = _refresh_cookie(response)
    assert cleared.value == ""
    assert cleared["path"] == "/v1/auth/refresh"
    assert int(cleared["max-age"]) == 0
    assert [row["status"] for row in _refresh_rows(second_claims["sid"])] == ["revoked"]
    assert [row["status"] for row in _refresh_rows(first_claims["sid"])] == ["active"]
    assert [row["status"] for row in _refresh_rows(other_claims["sid"])] == ["active"]
    with app_session() as session:
        revoked = {
            str(row[0]): row[1]
            for row in session.execute(
                text(
                    "SELECT id, revoked_at FROM app.sessions WHERE id IN "
                    "(CAST(:first AS uuid), CAST(:second AS uuid), CAST(:other AS uuid))"
                ),
                {"first": first_claims["sid"], "second": second_claims["sid"], "other": other_claims["sid"]},
            ).all()
        }
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_id FROM audit.entries "
                    "WHERE action = 'auth.logout' AND request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert revoked[second_claims["sid"]] is not None
    assert revoked[first_claims["sid"]] is None
    assert revoked[other_claims["sid"]] is None
    assert str(audit["actor_id"]) == second_claims["sub"]
    assert audit["actor_role"] == "participant"
    assert audit["entity_id"] == second_claims["sub"]
    _assert_error(client.get("/v1/me", headers=_auth(second.json()["access_token"])), 401, "AUTH_SESSION_REVOKED")
    assert client.get("/v1/me", headers=_auth(first.json()["access_token"])).status_code == 200
    assert client.get("/v1/me", headers=_auth(other.json()["access_token"])).status_code == 200
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, second_raw)
    _assert_error(client.post("/v1/auth/refresh", headers=CSRF_HEADERS), 401, "AUTH_SESSION_REVOKED")


def test_logout_without_authentication_has_no_side_effects(client):
    login = _login(client, "p1.team1@example.com")
    before = _state_counts()

    response = client.post("/v1/auth/logout")

    _assert_error(response, 401, "AUTH_TOKEN_EXPIRED")
    assert "set-cookie" not in response.headers
    assert _state_counts() == before
    assert client.get("/v1/me", headers=_auth(login.json()["access_token"])).status_code == 200


@pytest.mark.parametrize("invite_state", ["unknown", "expired", "used"])
def test_activation_rejects_unknown_expired_and_used_invites_without_side_effects(client, invite_state):
    email = f"activation-{invite_state}@example.com"
    raw = security.new_refresh_token()
    if invite_state == "expired":
        _, raw = _insert_invite(email=email, expires_at=datetime.now(UTC) - timedelta(minutes=1))
    elif invite_state == "used":
        _, raw = _insert_invite(email=email, used_at=datetime.now(UTC) - timedelta(minutes=1))
    before = _state_counts()

    response = client.post(
        "/v1/auth/activate",
        json={"invite_token": raw, "password": NEW_PASSWORD, "accept_rules": True},
    )

    error = _assert_error(response, 404, "NOT_FOUND")
    assert error["message"] == "This invite is invalid or expired. Request a new invite from the organizers."
    assert _state_counts() == before
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM app.users WHERE lower(email) = :email"),
                {"email": email},
            ).scalar_one()
            == 0
        )
        if invite_state != "unknown":
            invite = (
                session.execute(
                    text("SELECT used_at, expires_at FROM app.invites WHERE lower(email) = :email"),
                    {"email": email},
                )
                .mappings()
                .one()
            )
            if invite_state == "used":
                assert invite["used_at"] is not None
            else:
                assert invite["used_at"] is None
                assert invite["expires_at"] < datetime.now(UTC)


def test_activation_requires_rules_consent_before_consuming_the_invite(client):
    email = "activation-consent@example.com"
    invite_id, raw = _insert_invite(email=email)
    before = _state_counts()

    response = client.post(
        "/v1/auth/activate",
        json={"invite_token": raw, "password": NEW_PASSWORD, "accept_rules": False},
    )

    _assert_error(response, 403, "RULES_NOT_ACCEPTED")
    assert _state_counts() == before
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT used_at FROM app.invites WHERE id = CAST(:id AS uuid)"),
                {"id": invite_id},
            ).scalar_one()
            is None
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM app.users WHERE lower(email) = :email"),
                {"email": email},
            ).scalar_one()
            == 0
        )


def test_activation_creates_a_new_participant_and_consents_to_current_rules_once(client):
    event_id, team_id = _event_and_team()
    email = "new.participant@example.com"
    with app_session() as session:
        session.execute(
            text("UPDATE app.events SET status = 'ready' WHERE id = CAST(:event AS uuid)"), {"event": event_id}
        )
        rules_version = session.execute(
            text("SELECT rules_version FROM app.events WHERE id = CAST(:event AS uuid)"),
            {"event": event_id},
        ).scalar_one()
    invite_id, raw = _insert_invite(email=email, team_id=team_id)

    request_id = f"activation-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/v1/auth/activate",
        headers={"X-Request-Id": request_id},
        json={"invite_token": raw, "password": NEW_PASSWORD, "accept_rules": True},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "email": email}
    with app_session() as session:
        user = (
            session.execute(
                text(
                    "SELECT id, email, name, role, status, password_hash, registration_id FROM app.users "
                    "WHERE lower(email) = :email"
                ),
                {"email": email},
            )
            .mappings()
            .one()
        )
        invite = (
            session.execute(
                text("SELECT used_at FROM app.invites WHERE id = CAST(:id AS uuid)"),
                {"id": invite_id},
            )
            .mappings()
            .one()
        )
        membership = session.execute(
            text("SELECT team_id FROM app.team_members WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": str(user["id"])},
        ).scalar_one()
        acceptance = (
            session.execute(
                text(
                    "SELECT rules_version, ip_hash FROM app.acceptances "
                    "WHERE user_id = CAST(:uid AS uuid) AND rules_version = :version"
                ),
                {"uid": str(user["id"]), "version": rules_version},
            )
            .mappings()
            .one()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_id FROM audit.entries "
                    "WHERE action = 'auth.activated' AND request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert user["name"] == "new.participant"
    assert user["role"] == "participant"
    assert user["status"] == "active"
    assert user["registration_id"]
    assert security.verify_password(NEW_PASSWORD, user["password_hash"])
    assert invite["used_at"] is not None
    assert str(membership) == team_id
    assert acceptance["rules_version"] == rules_version
    assert acceptance["ip_hash"] is None
    assert str(audit["actor_id"]) == str(user["id"])
    assert audit["actor_role"] == "participant"
    assert audit["entity_id"] == str(user["id"])

    login = _login(client, email, password=NEW_PASSWORD)
    profile = client.get("/v1/me", headers=_auth(login.json()["access_token"]))
    assert profile.status_code == 200, profile.text
    assert profile.json()["rules_accepted"] is True
    assert profile.json()["rules_version"] == rules_version
    assert profile.json()["team"]["id"] == team_id

    before_replay = _state_counts()
    password_hash_before = user["password_hash"]
    replay = client.post(
        "/v1/auth/activate",
        json={"invite_token": raw, "password": "Another-Password-123!", "accept_rules": True},
    )
    _assert_error(replay, 404, "NOT_FOUND")
    assert _state_counts() == before_replay
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT password_hash FROM app.users WHERE id = CAST(:uid AS uuid)"),
                {"uid": str(user["id"])},
            ).scalar_one()
            == password_hash_before
        )


def test_activation_cannot_overwrite_an_existing_account(client):
    email = "admin@example.com"
    invite_id, raw = _insert_invite(email=email)
    with app_session() as session:
        before = (
            session.execute(
                text("SELECT id, password_hash, status, role, token_version FROM app.users WHERE email = :email"),
                {"email": email},
            )
            .mappings()
            .one()
        )

    response = client.post(
        "/v1/auth/activate",
        json={"invite_token": raw, "password": NEW_PASSWORD, "accept_rules": True},
    )

    _assert_error(response, 404, "NOT_FOUND")
    with app_session() as session:
        after = (
            session.execute(
                text("SELECT id, password_hash, status, role, token_version FROM app.users WHERE email = :email"),
                {"email": email},
            )
            .mappings()
            .one()
        )
        used_at = session.execute(
            text("SELECT used_at FROM app.invites WHERE id = CAST(:id AS uuid)"), {"id": invite_id}
        ).scalar_one()
    assert after == before
    assert used_at is None


def test_step_up_wrong_password_is_generic_and_records_no_success(client):
    login = _login(client, "organizer@example.com")
    session_id = security.decode_access_token(login.json()["access_token"])["sid"]
    before = _state_counts()

    response = client.post(
        "/v1/auth/step-up",
        headers=_auth(login.json()["access_token"]),
        json={"password": "wrong-password"},
    )

    error = _assert_error(response, 401, "AUTH_INVALID_CREDENTIALS")
    assert error["message"] == "Email or password is incorrect."
    assert _state_counts() == before
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT step_up_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
                {"sid": session_id},
            ).scalar_one()
            is None
        )


def test_step_up_success_updates_the_session_audit_and_unlocks_a_sensitive_route(client):
    login = _login(client, "organizer@example.com")
    token = login.json()["access_token"]
    session_id = security.decode_access_token(token)["sid"]
    event_id, _ = _event_and_team()
    before = datetime.now(UTC)

    request_id = f"step-up-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/v1/auth/step-up",
        headers={**_auth(token), "X-Request-Id": request_id},
        json={"password": STAFF_PW},
    )

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    valid_until = datetime.fromisoformat(response.json()["valid_until"])
    assert valid_until.tzinfo is UTC
    assert before + timedelta(minutes=4) <= valid_until <= datetime.now(UTC) + timedelta(minutes=6)
    with app_session() as session:
        step_up_at = session.execute(
            text("SELECT step_up_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        ).scalar_one()
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_id FROM audit.entries "
                    "WHERE action = 'auth.step_up' AND request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert step_up_at is not None
    assert before <= step_up_at <= datetime.now(UTC)
    assert str(audit["actor_id"]) == security.decode_access_token(token)["sub"]
    assert audit["actor_role"] == "organizer"
    assert audit["entity_id"] == security.decode_access_token(token)["sub"]

    created = client.post(
        f"/v1/admin/events/{event_id}/challenges",
        headers=_auth(token),
        json={"slug": "step-up-coverage", "title": "Step-up coverage challenge"},
    )
    assert created.status_code == 201, created.text
    challenge_id = created.json()["challenge_id"]
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT title FROM app.challenge_versions WHERE id = CAST(:id AS uuid)"),
                {"id": challenge_id},
            ).scalar_one()
            == "Step-up coverage challenge"
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = 'challenge.created' AND entity_id = :id"),
                {"id": challenge_id},
            ).scalar_one()
            == 1
        )


def test_reset_request_is_generic_and_only_creates_a_hashed_token_for_an_existing_account(client):
    request_id = "generic-reset-request"
    before = _state_counts()

    existing = client.post(
        "/v1/auth/password/reset-request",
        json={"email": "P1.Team1@Example.com"},
        headers={"X-Request-Id": request_id},
    )
    unknown = client.post(
        "/v1/auth/password/reset-request",
        json={"email": "unknown-reset@example.com"},
        headers={"X-Request-Id": request_id},
    )

    assert existing.status_code == 200, existing.text
    assert unknown.status_code == 200, unknown.text
    assert (
        existing.json()
        == unknown.json()
        == {
            "ok": True,
            "message": "If the address is registered, a reset link has been created.",
        }
    )
    with app_session() as session:
        reset = (
            session.execute(
                text(
                    "SELECT r.user_id, r.token_hash, r.used_at, r.expires_at, u.email "
                    "FROM app.password_resets r JOIN app.users u ON u.id = r.user_id"
                ),
            )
            .mappings()
            .one()
        )
        audit_count = session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one()
    assert reset["email"] == "p1.team1@example.com"
    assert re.fullmatch(r"[0-9a-f]{64}", reset["token_hash"])
    assert reset["used_at"] is None
    assert datetime.now(UTC) < reset["expires_at"] <= datetime.now(UTC) + timedelta(minutes=31)
    assert reset["token_hash"] not in existing.text
    assert _state_counts()["password_resets"] == before["password_resets"] + 1
    assert _state_counts()["audit_entries"] == audit_count == before["audit_entries"]


def test_unknown_reset_token_is_denied_without_changing_password_or_sessions(client):
    login = _login(client, "p1.team1@example.com")
    before = _state_counts()
    with app_session() as session:
        password_hash_before = session.execute(
            text("SELECT password_hash FROM app.users WHERE email = 'p1.team1@example.com'")
        ).scalar_one()

    response = client.post(
        "/v1/auth/password/reset",
        json={"token": security.new_refresh_token(), "password": NEW_PASSWORD},
    )

    error = _assert_error(response, 404, "NOT_FOUND")
    assert error["message"] == "This reset link is invalid or expired."
    assert _state_counts() == before
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT password_hash FROM app.users WHERE email = 'p1.team1@example.com'")
            ).scalar_one()
            == password_hash_before
        )
    assert client.get("/v1/me", headers=_auth(login.json()["access_token"])).status_code == 200


def test_successful_password_reset_rotates_password_revokes_all_sessions_and_consumes_token(client):
    email = "p2.team1@example.com"
    first = _login(client, email)
    second = _login(client, email)
    first_raw = _refresh_cookie(first).value
    first_claims = security.decode_access_token(first.json()["access_token"])
    reset_id, raw_reset = _insert_reset(email)
    with app_session() as session:
        version_before = session.execute(
            text("SELECT token_version FROM app.users WHERE email = :email"),
            {"email": email},
        ).scalar_one()
        old_password_hash = session.execute(
            text("SELECT password_hash FROM app.users WHERE email = :email"),
            {"email": email},
        ).scalar_one()

    request_id = f"password-reset-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/v1/auth/password/reset",
        headers={"X-Request-Id": request_id},
        json={"token": raw_reset, "password": NEW_PASSWORD},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    with app_session() as session:
        user = (
            session.execute(
                text("SELECT password_hash, token_version FROM app.users WHERE email = :email"),
                {"email": email},
            )
            .mappings()
            .one()
        )
        reset = session.execute(
            text("SELECT used_at FROM app.password_resets WHERE id = CAST(:id AS uuid)"),
            {"id": reset_id},
        ).scalar_one()
        revoked_sessions = session.execute(
            text("SELECT count(*) FROM app.sessions WHERE user_id = CAST(:uid AS uuid) AND revoked_at IS NULL"),
            {"uid": first_claims["sub"]},
        ).scalar_one()
        active_refresh = session.execute(
            text("SELECT count(*) FROM app.refresh_tokens WHERE user_id = CAST(:uid AS uuid) AND status <> 'revoked'"),
            {"uid": first_claims["sub"]},
        ).scalar_one()
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_id FROM audit.entries "
                    "WHERE action = 'auth.password_reset' AND request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert user["password_hash"] != old_password_hash
    assert not security.verify_password(STAFF_PW, user["password_hash"])
    assert security.verify_password(NEW_PASSWORD, user["password_hash"])
    assert user["token_version"] == version_before + 1
    assert reset is not None
    assert revoked_sessions == 0
    assert active_refresh == 0
    assert str(audit["actor_id"]) == first_claims["sub"]
    assert audit["actor_role"] == "user"
    assert audit["entity_id"] == first_claims["sub"]
    _assert_error(client.get("/v1/me", headers=_auth(first.json()["access_token"])), 401, "AUTH_SESSION_REVOKED")
    _assert_error(client.get("/v1/me", headers=_auth(second.json()["access_token"])), 401, "AUTH_SESSION_REVOKED")
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, first_raw)
    _assert_error(client.post("/v1/auth/refresh", headers=CSRF_HEADERS), 401, "AUTH_SESSION_REVOKED")

    before_replay = _state_counts()
    replay = client.post("/v1/auth/password/reset", json={"token": raw_reset, "password": "Another-Password-123!"})
    _assert_error(replay, 404, "NOT_FOUND")
    assert _state_counts() == before_replay
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT token_version FROM app.users WHERE email = :email"),
                {"email": email},
            ).scalar_one()
            == version_before + 1
        )
    old_login = client.post("/v1/auth/login", json={"email": email, "password": STAFF_PW})
    _assert_error(old_login, 401, "AUTH_INVALID_CREDENTIALS")
    assert _login(client, email, password=NEW_PASSWORD).json()["user"]["status"] == "active"


def test_profile_and_session_listing_are_scoped_to_the_token_owner(client):
    email = "p3.team1@example.com"
    first = _login(client, email, user_agent="Primary coverage device")
    second = _login(client, email, user_agent="Secondary coverage device")
    other = _login(client, "p1.team2@example.com", user_agent="Other participant device")
    token = second.json()["access_token"]
    claims = security.decode_access_token(token)
    first_session = security.decode_access_token(first.json()["access_token"])["sid"]
    other_session = security.decode_access_token(other.json()["access_token"])["sid"]

    profile = client.get("/v1/me", headers=_auth(token))
    sessions = client.get("/v1/me/sessions", headers=_auth(token))

    assert profile.status_code == 200, profile.text
    assert sessions.status_code == 200, sessions.text
    body = profile.json()
    assert body["id"] == claims["sub"]
    assert body["email"] == email
    assert body["role"] == "participant"
    assert body["status"] == "active"
    assert body["team"] is not None
    listed = sessions.json()
    assert {item["id"] for item in listed} == {first_session, claims["sid"]}
    assert other_session not in {item["id"] for item in listed}
    devices = {item["id"]: item["device"] for item in listed}
    assert devices[first_session] == "Primary coverage device"
    assert devices[claims["sid"]] == "Secondary coverage device"
    assert all(datetime.fromisoformat(item["created_at"]).tzinfo is UTC for item in listed)
    assert all(datetime.fromisoformat(item["last_seen_at"]).tzinfo is UTC for item in listed)


def test_owned_session_revocation_revokes_only_the_target_refresh_family(client):
    email = "p4.team1@example.com"
    first = _login(client, email)
    second = _login(client, email)
    other = _login(client, "p1.team2@example.com")
    first_claims = security.decode_access_token(first.json()["access_token"])
    second_claims = security.decode_access_token(second.json()["access_token"])
    other_claims = security.decode_access_token(other.json()["access_token"])

    response = client.delete(f"/v1/me/sessions/{first_claims['sid']}", headers=_auth(second.json()["access_token"]))

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    assert [row["status"] for row in _refresh_rows(first_claims["sid"])] == ["revoked"]
    assert [row["status"] for row in _refresh_rows(second_claims["sid"])] == ["active"]
    assert [row["status"] for row in _refresh_rows(other_claims["sid"])] == ["active"]
    with app_session() as session:
        revoked = {
            str(row[0]): row[1]
            for row in session.execute(
                text(
                    "SELECT id, revoked_at FROM app.sessions WHERE id IN "
                    "(CAST(:first AS uuid), CAST(:second AS uuid), CAST(:other AS uuid))"
                ),
                {"first": first_claims["sid"], "second": second_claims["sid"], "other": other_claims["sid"]},
            ).all()
        }
    assert revoked[first_claims["sid"]] is not None
    assert revoked[second_claims["sid"]] is None
    assert revoked[other_claims["sid"]] is None
    listed = client.get("/v1/me/sessions", headers=_auth(second.json()["access_token"]))
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()] == [second_claims["sid"]]
    _assert_error(client.get("/v1/me", headers=_auth(first.json()["access_token"])), 401, "AUTH_SESSION_REVOKED")
    assert client.get("/v1/me", headers=_auth(second.json()["access_token"])).status_code == 200
    assert client.get("/v1/me", headers=_auth(other.json()["access_token"])).status_code == 200


@pytest.mark.parametrize("body", [{}, {"version": 2}])
def test_acceptance_records_the_current_version_once_and_opens_the_rules_gate(client, body):
    with app_session() as session:
        session.execute(text("UPDATE app.events SET status = 'ready', rules_version = 2"))
    login = _login(client, "p1.team1@example.com")
    token = login.json()["access_token"]
    user_id = security.decode_access_token(token)["sub"]
    request_id = f"current-rules-{uuid.uuid4().hex[:8]}"

    response = client.post(
        "/v1/me/acceptances",
        headers={**_auth(token), "X-Request-Id": request_id},
        json=body,
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "rules_version": 2}
    with app_session() as session:
        acceptance = (
            session.execute(
                text(
                    "SELECT rules_version, accepted_at, ip_hash FROM app.acceptances WHERE user_id = CAST(:uid AS uuid)"
                ),
                {"uid": user_id},
            )
            .mappings()
            .one()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_type, request_id, details FROM audit.entries "
                    "WHERE action = 'rules.accepted' AND request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert acceptance["rules_version"] == 2
    assert acceptance["accepted_at"].tzinfo is UTC
    assert re.fullmatch(r"[0-9a-f]{32}", acceptance["ip_hash"])
    assert str(audit["actor_id"]) == user_id
    assert audit["actor_role"] == "participant"
    assert audit["entity_type"] == "event"
    assert audit["request_id"] == request_id
    assert audit["details"] == {"version": 2}
    profile = client.get("/v1/me", headers=_auth(token))
    assert profile.status_code == 200, profile.text
    assert profile.json()["rules_accepted"] is True
    assert profile.json()["rules_version"] == 2
    assert client.get("/v1/levels", headers=_auth(token)).status_code == 200

    repeated = client.post("/v1/me/acceptances", headers=_auth(token), json=body)
    assert repeated.status_code == 200, repeated.text
    with app_session() as session:
        rows = (
            session.execute(
                text("SELECT rules_version, accepted_at FROM app.acceptances WHERE user_id = CAST(:uid AS uuid)"),
                {"uid": user_id},
            )
            .mappings()
            .all()
        )
    assert len(rows) == 1
    assert rows[0]["rules_version"] == 2
    assert rows[0]["accepted_at"] == acceptance["accepted_at"]
