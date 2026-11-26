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


def test_admin_registration_and_passwordless_first_sign_in(client):
    from app.db import app_engine
    from sqlalchemy import text

    admin_login = client.post(
        "/v1/auth/login",
        json={"email": "admin@example.com", "password": "Dev-only!Passw0rd!"},
    )
    assert admin_login.status_code == 200, admin_login.text
    admin = TestClient(client.app)
    admin.headers.update({"Authorization": f"Bearer {admin_login.json()['access_token']}"})

    email = f"first-claim-{__import__('uuid').uuid4().hex[:8]}@example.com"
    registration = admin.post(
        "/v1/auth/register",
        json={"email": email, "name": "First Claim User", "role": "reviewer"},
    )
    assert registration.status_code == 201, registration.text
    assert registration.json()["password_setup_required"] is True

    with app_engine.connect() as conn:
        before = conn.execute(
            text("SELECT password_hash, status FROM app.users WHERE lower(email) = :e"),
            {"e": email},
        ).mappings().one()
    assert before["password_hash"] is None
    assert before["status"] == "active"

    initial_password = "First-Password-Claim-123"
    first_login = client.post("/v1/auth/login", json={"email": email, "password": initial_password})
    assert first_login.status_code == 200, first_login.text

    with app_engine.connect() as conn:
        after = conn.execute(
            text("SELECT password_hash, status FROM app.users WHERE lower(email) = :e"),
            {"e": email},
        ).mappings().one()
    assert after["password_hash"] is not None
    assert after["status"] == "active"

    wrong = client.post("/v1/auth/login", json={"email": email, "password": "Wrong-First-Password-123"})
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"

    unknown = client.post(
        "/v1/auth/login",
        json={"email": "not-registered-anywhere@example.com", "password": initial_password},
    )
    assert unknown.status_code == 401
    assert unknown.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]

    # Activation and public self-service password reset are not registered.
    assert client.post(
        "/v1/auth/activate",
        json={"invite_token": "x" * 32, "password": initial_password, "accept_rules": True},
    ).status_code == 404
    assert client.post("/v1/auth/password/reset-request", json={"email": email}).status_code == 404
    assert client.post(
        "/v1/auth/password/reset",
        json={"token": "x" * 32, "password": "Another-Password-123"},
    ).status_code == 404

    # A normal organizer cannot create staff or participant accounts via the global registration endpoint.
    organizer_login = client.post(
        "/v1/auth/login",
        json={"email": "organizer@example.com", "password": "Dev-only!Passw0rd!"},
    ).json()
    organizer = TestClient(client.app)
    organizer.headers.update({"Authorization": f"Bearer {organizer_login['access_token']}"})
    forbidden = organizer.post(
        "/v1/auth/register",
        json={"email": f"unauthorized-{__import__('uuid').uuid4().hex[:8]}@example.com", "name": "Unauthorized", "role": "reviewer"},
    )
    assert forbidden.status_code == 403


def test_pending_password_account_activates_only_after_successful_verification(client):
    from app import security
    from app.db import app_engine
    from sqlalchemy import text

    email = f"pending-{__import__('uuid').uuid4().hex[:8]}@example.com"
    password = "Pending-Account-Password-123"
    with app_engine.begin() as conn:
        tenant_id = conn.execute(
            text("SELECT tenant_id FROM app.events ORDER BY created_at DESC LIMIT 1")
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO app.users (id, tenant_id, email, name, role, password_hash, status) "
                "VALUES (gen_random_uuid(), :tenant, :email, 'Pending Account', 'participant', :pw, 'pending')"
            ),
            {"tenant": tenant_id, "email": email, "pw": security.hash_password(password)},
        )

    wrong = client.post("/v1/auth/login", json={"email": email, "password": "Wrong-Pending-Password-123"})
    assert wrong.status_code == 401
    with app_engine.connect() as conn:
        status = conn.execute(text("SELECT status FROM app.users WHERE lower(email) = :e"), {"e": email}).scalar_one()
    assert status == "pending"

    correct = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert correct.status_code == 200, correct.text
    with app_engine.connect() as conn:
        status = conn.execute(text("SELECT status FROM app.users WHERE lower(email) = :e"), {"e": email}).scalar_one()
    assert status == "active"


def test_step_up_required_for_sensitive_admin_routes_and_safe_flag_crud(client):
    org = client.post(
        "/v1/auth/login", json={"email": "organizer@example.com", "password": "Dev-only!Passw0rd!"}
    ).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    seeded_challenge_id = _any_challenge_id(oc)

    denied = oc.post(
        f"/v1/admin/challenges/{seeded_challenge_id}/ground-truth/flags",
        json={"flag_key": "FLAG-TEST", "code": "FLAG{step_up}", "points": 5},
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    assert oc.get(f"/v1/admin/challenges/{seeded_challenge_id}/ground-truth/flags").status_code == 403

    oc.post("/v1/auth/step-up", json={"password": "Dev-only!Passw0rd!"}).raise_for_status()
    event_id = oc.get("/v1/admin/events").json()["events"][0]["id"]
    challenge_response = oc.post(
        f"/v1/admin/events/{event_id}/challenges",
        json={"slug": f"gt-flag-crud-{__import__('uuid').uuid4().hex[:8]}", "title": "Ground truth flag CRUD test"},
    )
    assert challenge_response.status_code == 201, challenge_response.text
    challenge_id = challenge_response.json()["challenge_id"]

    created = oc.post(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/flags",
        json={"flag_key": "FLAG-TEST", "code": "FLAG{step_up}", "points": 5, "max_awards": 3},
    )
    assert created.status_code == 201, created.text
    flag_id = created.json()["flag_id"]

    listed = oc.get(f"/v1/admin/challenges/{challenge_id}/ground-truth/flags")
    assert listed.status_code == 200, listed.text
    flag = next(row for row in listed.json()["flags"] if row["id"] == flag_id)
    assert flag["flag_key"] == "FLAG-TEST"
    assert float(flag["points"]) == 5
    assert flag["max_awards"] == 3
    assert "code" not in flag
    assert "code_hash" not in flag

    updated = oc.patch(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/flags/{flag_id}",
        json={"flag_key": "FLAG-TEST-EDITED", "points": 7.5, "max_awards": 9},
    )
    assert updated.status_code == 200, updated.text
    listed = oc.get(f"/v1/admin/challenges/{challenge_id}/ground-truth/flags").json()["flags"]
    flag = next(row for row in listed if row["id"] == flag_id)
    assert flag["flag_key"] == "FLAG-TEST-EDITED"
    assert float(flag["points"]) == 7.5
    assert flag["max_awards"] == 9

    replaced_code = oc.patch(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/flags/{flag_id}",
        json={"code": "FLAG{replacement_secret}", "points": 8},
    )
    assert replaced_code.status_code == 200, replaced_code.text
    listed = oc.get(f"/v1/admin/challenges/{challenge_id}/ground-truth/flags").json()["flags"]
    flag = next(row for row in listed if row["id"] == flag_id)
    assert float(flag["points"]) == 8
    assert "code" not in flag and "code_hash" not in flag

    duplicate_key = oc.post(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/flags",
        json={"flag_key": "FLAG-TEST-EDITED", "code": "FLAG{different_secret}", "points": 2},
    )
    assert duplicate_key.status_code == 422


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
