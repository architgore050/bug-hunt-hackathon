"""Authentication flow tests (ATH-01..05)."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_login_rejects_wrong_password_generically(client):
    # Existing user, wrong password → 401 (no enumeration)
    r = client.post("/v1/auth/login", json={"email": "p1.team1@example.com", "password": "wrong-password"})
    assert r.status_code == 401
    body = r.json()["error"]
    assert body["code"] == "AUTH_INVALID_CREDENTIALS"
    # Unregistered email → same generic 401 (no account enumeration)
    r2 = client.post("/v1/auth/login", json={"email": "nobody@example.com", "password": "New-User-Pass-123!"})
    assert r2.status_code == 401
    assert r2.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"
    assert r2.json()["error"]["message"] == body["message"]


def test_password_reset_revokes_sessions_and_bumps_token_version(client):
    login1 = client.post(
        "/v1/auth/login", json={"email": "p2.team1@example.com", "password": "Dev-only!Passw0rd!"}
    ).json()
    headers = {"Authorization": f"Bearer {login1['access_token']}"}
    # request reset
    r = client.post("/v1/auth/password/reset-request", json={"email": "p2.team1@example.com"})
    assert r.status_code == 200
    # fetch the reset token from the dev mail sink (documented dev-only behavior)
    from app.db import app_engine
    from sqlalchemy import text

    with app_engine.connect() as conn:
        token_version_before = conn.execute(
            text("SELECT token_version FROM app.users WHERE email = :e"), {"e": "p2.team1@example.com"}
        ).scalar_one()
    # the dev mail sink printed the raw token; we cannot recover it from the hash.
    # Instead verify the FLOW through step-up: rotate the password via reset using a
    # directly-inserted known token.
    import hashlib

    raw = "known-reset-token-for-tests-0123456789abcdef"
    th = hashlib.sha256(raw.encode()).hexdigest()
    with app_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO app.password_resets (id, user_id, token_hash, expires_at) "
                "SELECT gen_random_uuid(), id, :th, now() + interval '30 minutes' FROM app.users WHERE email = :e"
            ),
            {"th": th, "e": "p2.team1@example.com"},
        )
    r = client.post("/v1/auth/password/reset", json={"token": raw, "password": "New-Password-For-Tests-1"})
    assert r.status_code == 200
    # old access token must now be rejected (token_version bumped + sessions revoked)
    r = client.get("/v1/me", headers=headers)
    assert r.status_code == 401
    with app_engine.connect() as conn:
        token_version_after = conn.execute(
            text("SELECT token_version FROM app.users WHERE email = :e"), {"e": "p2.team1@example.com"}
        ).scalar_one()
    assert token_version_after == token_version_before + 1


def test_step_up_required_for_sensitive_admin_routes(client):
    org = client.post(
        "/v1/auth/login", json={"email": "organizer@example.com", "password": "Dev-only!Passw0rd!"}
    ).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    # ground truth authoring requires step-up: fresh session has none
    r = oc.post(
        f"/v1/admin/challenges/{_any_challenge_id(oc)}/ground-truth/flags",
        json={"flag_key": "FLAG-TEST", "code": "FLAG{step_up}", "points": 5},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    # after step-up it succeeds
    oc.post("/v1/auth/step-up", json={"password": "Dev-only!Passw0rd!"}).raise_for_status()
    r = oc.post(
        f"/v1/admin/challenges/{_any_challenge_id(oc)}/ground-truth/flags",
        json={"flag_key": "FLAG-TEST", "code": "FLAG{step_up}", "points": 5},
    )
    assert r.status_code == 201, r.text


def _any_challenge_id(oc):
    from app.db import app_engine
    from sqlalchemy import text

    with app_engine.connect() as conn:
        return str(conn.execute(text("SELECT id FROM app.challenge_versions LIMIT 1")).scalar_one())


def test_refresh_rotation_and_reuse_detection(client):
    """AUTH-04: grace-period retries reuse the successor; late reuse revokes the family."""
    from app import security
    from app.db import app_session
    from sqlalchemy import text

    login = client.post("/v1/auth/login", json={"email": "p3.team2@example.com", "password": "Dev-only!Passw0rd!"})
    access_token = login.json()["access_token"]
    session_id = security.decode_access_token(access_token)["sid"]
    old_cookie = login.cookies.get("bhctf_refresh")
    assert old_cookie

    headers = {"Origin": "http://localhost:5173", "X-BHCTF-Client": "web"}
    r1 = client.post("/v1/auth/refresh", headers=headers)
    assert r1.status_code == 200
    successor_cookie = r1.cookies.get("bhctf_refresh")
    assert successor_cookie

    # A retry with the rotated token inside the grace window gets the same successor.
    client.cookies.clear()
    client.cookies.set("bhctf_refresh", old_cookie)
    r2 = client.post("/v1/auth/refresh", headers=headers)
    assert r2.status_code == 200
    assert r2.cookies.get("bhctf_refresh") == successor_cookie

    # Move the original token outside the grace window without sleeping in the test.
    old_hash = security.token_hash(old_cookie)
    with app_session() as s:
        s.execute(
            text("UPDATE app.refresh_tokens SET rotated_at = now() - interval '1 hour' WHERE token_hash = :h"),
            {"h": old_hash},
        )

    client.cookies.clear()
    client.cookies.set("bhctf_refresh", old_cookie)
    r3 = client.post("/v1/auth/refresh", headers=headers)
    assert r3.status_code == 401
    assert r3.json()["error"]["code"] == "AUTH_SESSION_REVOKED"

    # Both the old and successor refresh tokens are revoked, and the access
    # token issued for this session is no longer accepted.
    with app_session() as s:
        statuses = (
            s.execute(
                text("SELECT status FROM app.refresh_tokens WHERE session_id = CAST(:sid AS uuid)"),
                {"sid": session_id},
            )
            .scalars()
            .all()
        )
        revoked_at = s.execute(
            text("SELECT revoked_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        ).scalar_one()
    assert statuses
    assert set(statuses) == {"revoked"}
    assert revoked_at is not None
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {access_token}"}).status_code == 401


def _login(client, email):
    r = client.post("/v1/auth/login", json={"email": email, "password": "Dev-only!Passw0rd!"})
    r.raise_for_status()
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_evicts_oldest_session_instead_of_lockout(client):
    """AUTH-10 (hardened): the cap bounds live sessions but must never lock a
    legitimate user out. A third sign-in evicts the oldest live session."""
    email = "p3.team1@example.com"
    t1 = _login(client, email)
    t2 = _login(client, email)
    t3 = _login(client, email)  # must succeed: eviction, not 403 lockout

    sessions = client.get("/v1/me/sessions", headers=_auth(t3)).json()
    assert len(sessions) == 2  # cap invariant: at most max live sessions

    # the evicted (oldest) session's access token is rejected server-side
    r = client.get("/v1/me", headers=_auth(t1))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "AUTH_SESSION_REVOKED"
    # the two live sessions still work
    assert client.get("/v1/me", headers=_auth(t2)).status_code == 200
    assert client.get("/v1/me", headers=_auth(t3)).status_code == 200

    # eviction is audited
    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        n = s.execute(text("SELECT count(*) FROM audit.entries WHERE action = 'auth.session_evicted'")).scalar_one()
    assert n >= 1


def test_zombie_sessions_do_not_hold_slots(client):
    """A session whose refresh tokens are all expired can never refresh again;
    it must be reclaimed at next login instead of holding a slot forever."""
    email = "p4.team1@example.com"
    t1 = _login(client, email)
    sid1 = client.get("/v1/me/sessions", headers=_auth(t1)).json()[0]["id"]

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        s.execute(
            text(
                "UPDATE app.refresh_tokens SET expires_at = now() - interval '1 hour' WHERE session_id = CAST(:sid AS uuid)"
            ),
            {"sid": sid1},
        )

    # two further logins must both succeed: the zombie is reclaimed, no eviction needed
    t2 = _login(client, email)
    t3 = _login(client, email)
    live_ids = {s["id"] for s in client.get("/v1/me/sessions", headers=_auth(t3)).json()}
    assert sid1 not in live_ids
    assert client.get("/v1/me", headers=_auth(t2)).status_code == 200
