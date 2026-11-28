"""Admin-only participant lifecycle integration tests."""

from __future__ import annotations

import uuid

from conftest import STAFF_PW, login
from fastapi.testclient import TestClient


def _staff(client, email: str) -> TestClient:
    signed_in = login(client, email, STAFF_PW)
    staff = TestClient(client.app)
    staff.headers.update({"Authorization": f"Bearer {signed_in['access_token']}"})
    return staff


def test_admin_only_participant_registration_move_remove_and_password_reset(client):
    admin = _staff(client, "admin@example.com")
    admin_without_step_up = _staff(client, "admin@example.com")
    event = admin.get("/v1/admin/events").json()["events"][0]
    event_id = event["id"]

    seed_team_id = admin.get(f"/v1/admin/events/{event_id}/teams").json()["teams"][0]["id"]
    no_step_up_team = admin_without_step_up.post(
        f"/v1/admin/events/{event_id}/teams",
        json={"name": f"Denied team {uuid.uuid4().hex[:8]}"},
    )
    assert no_step_up_team.status_code == 403
    assert no_step_up_team.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    no_step_up_registration = admin_without_step_up.post(
        f"/v1/admin/events/{event_id}/participants",
        json={
            "email": f"no-step-{uuid.uuid4().hex[:8]}@example.com",
            "name": "Must Step Up",
            "team_id": seed_team_id,
        },
    )
    assert no_step_up_registration.status_code == 403
    assert no_step_up_registration.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"

    admin.post("/v1/auth/step-up", json={"password": STAFF_PW}).raise_for_status()
    first_team = admin.post(
        f"/v1/admin/events/{event_id}/teams",
        json={"name": f"Admin managed A {uuid.uuid4().hex[:8]}"},
    )
    assert first_team.status_code == 201, first_team.text
    team_a = first_team.json()["team_id"]

    second_team = admin.post(
        f"/v1/admin/events/{event_id}/teams",
        json={"name": f"Admin managed B {uuid.uuid4().hex[:8]}"},
    )
    assert second_team.status_code == 201, second_team.text
    team_b = second_team.json()["team_id"]

    email = f"participant-{uuid.uuid4().hex[:10]}@example.com"
    registered = admin.post(
        f"/v1/admin/events/{event_id}/participants",
        json={"email": email, "name": "Admin Registered Participant", "team_id": team_a},
    )
    assert registered.status_code == 201, registered.text
    result = registered.json()
    participant_id = result["participant_id"]
    assert result["password_setup_required"] is True
    assert "invite_token" not in result
    assert "activation_url" not in result

    duplicate_registration = admin.post(
        f"/v1/admin/events/{event_id}/participants",
        json={"email": email, "name": "Duplicate Participant", "team_id": team_a},
    )
    assert duplicate_registration.status_code == 422

    no_step_up_move = admin_without_step_up.patch(
        f"/v1/admin/events/{event_id}/participants/{participant_id}/team",
        json={"team_id": team_b},
    )
    assert no_step_up_move.status_code == 403
    assert no_step_up_move.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    no_step_up_remove = admin_without_step_up.delete(
        f"/v1/admin/events/{event_id}/participants/{participant_id}",
    )
    assert no_step_up_remove.status_code == 403
    assert no_step_up_remove.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    no_step_up_reset = admin_without_step_up.post(
        f"/v1/admin/users/{participant_id}/password-reset",
        json={"password": "No-Step-Up-Reset-Password-123"},
    )
    assert no_step_up_reset.status_code == 403
    assert no_step_up_reset.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"

    teams = admin.get(f"/v1/admin/events/{event_id}/teams")
    assert teams.status_code == 200, teams.text
    row = next(team for team in teams.json()["teams"] if team["id"] == team_a)
    assert row["member_count"] == 1
    assert "join_code" not in row

    roster = admin.get(f"/v1/admin/events/{event_id}/participants")
    assert roster.status_code == 200, roster.text
    participant = next(item for item in roster.json()["participants"] if item["id"] == participant_id)
    assert participant["email"] == email
    assert participant["team_id"] == team_a
    assert participant["password_set"] is False
    assert "invite_token" not in participant
    assert "expires_at" not in participant

    # REM-004: first-password claim via email knowledge is removed; the admin
    # sets the participant's initial password through the password-reset flow.
    initial_password = "Participant-First-Password-123"
    reset = client.post(
        f"/v1/admin/users/{participant_id}/password-reset",
        json={"initial_password": initial_password},
    )
    assert reset.status_code in (200, 202, 204), reset.text
    first_login = client.post("/v1/auth/login", json={"email": email, "password": initial_password})
    assert first_login.status_code == 200, first_login.text
    participant_client = TestClient(client.app)
    participant_client.headers.update({"Authorization": f"Bearer {first_login.json()['access_token']}"})

    # A participant cannot mutate even their own membership after a step-up attempt.
    participant_step_up = participant_client.post("/v1/auth/step-up", json={"password": initial_password})
    assert participant_step_up.status_code == 200
    denied_move = participant_client.patch(
        f"/v1/admin/events/{event_id}/participants/{participant_id}/team",
        json={"team_id": team_b},
    )
    assert denied_move.status_code == 403

    # Organizers can inspect the roster but cannot create, move, remove or reset participants.
    organizer = _staff(client, "organizer@example.com")
    organizer.post("/v1/auth/step-up", json={"password": STAFF_PW}).raise_for_status()
    assert organizer.get(f"/v1/admin/events/{event_id}/participants").status_code == 200
    denied_team = organizer.post(
        f"/v1/admin/events/{event_id}/teams",
        json={"name": f"Organizer denied {uuid.uuid4().hex[:8]}"},
    )
    assert denied_team.status_code == 403
    denied_register = organizer.post(
        f"/v1/admin/events/{event_id}/participants",
        json={
            "email": f"not-admin-{uuid.uuid4().hex[:8]}@example.com",
            "name": "Not an Admin",
            "team_id": team_a,
        },
    )
    assert denied_register.status_code == 403
    assert denied_register.json()["error"]["code"] == "AUTH_FORBIDDEN"
    denied_move = organizer.patch(
        f"/v1/admin/events/{event_id}/participants/{participant_id}/team",
        json={"team_id": team_b},
    )
    assert denied_move.status_code == 403
    denied_reset = organizer.post(
        f"/v1/admin/users/{participant_id}/password-reset",
        json={"password": "Organizer-Reset-Password-123"},
    )
    assert denied_reset.status_code == 403

    moved = admin.patch(
        f"/v1/admin/events/{event_id}/participants/{participant_id}/team",
        json={"team_id": team_b},
    )
    assert moved.status_code == 200, moved.text
    roster = admin.get(f"/v1/admin/events/{event_id}/participants").json()["participants"]
    participant = next(item for item in roster if item["id"] == participant_id)
    assert participant["team_id"] == team_b

    from app.db import app_engine
    from sqlalchemy import text

    with app_engine.connect() as conn:
        token_version_before = conn.execute(
            text("SELECT token_version FROM app.users WHERE id = CAST(:u AS uuid)"),
            {"u": participant_id},
        ).scalar_one()

    admin_id = admin.get("/v1/me").json()["id"]
    own_reset = admin.post(
        f"/v1/admin/users/{admin_id}/password-reset",
        json={"password": "Admin-Self-Reset-Password-123"},
    )
    assert own_reset.status_code == 422
    assert own_reset.json()["error"]["code"] == "VALIDATION_ERROR"

    replacement_password = "Admin-Reset-Password-123"
    reset = admin.post(
        f"/v1/admin/users/{participant_id}/password-reset",
        json={"password": replacement_password},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["email"] == email
    with app_engine.connect() as conn:
        token_version_after = conn.execute(
            text("SELECT token_version FROM app.users WHERE id = CAST(:u AS uuid)"),
            {"u": participant_id},
        ).scalar_one()
    assert token_version_after == token_version_before + 1
    assert client.get("/v1/me", headers=participant_client.headers).status_code == 401
    assert (
        client.post(
            "/v1/auth/login",
            json={"email": email, "password": initial_password},
        ).status_code
        == 401
    )
    new_login = client.post(
        "/v1/auth/login",
        json={"email": email, "password": replacement_password},
    )
    assert new_login.status_code == 200, new_login.text

    removed = admin.delete(f"/v1/admin/events/{event_id}/participants/{participant_id}")
    assert removed.status_code == 200, removed.text
    removed_membership_login = client.post(
        "/v1/auth/login",
        json={"email": email, "password": replacement_password},
    )
    assert removed_membership_login.status_code == 401
    assert removed_membership_login.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"


def test_unregistered_participant_cannot_be_created_without_admin(client):
    from conftest import participant_client

    participant = participant_client(client, "p1.team1@example.com")
    event_id = participant.get("/v1/me").json()["team"]["event_id"]
    response = participant.post(
        f"/v1/admin/events/{event_id}/participants",
        json={
            "email": f"self-register-{uuid.uuid4().hex[:8]}@example.com",
            "name": "Self Register",
            "team_id": participant.get("/v1/me").json()["team"]["id"],
        },
    )
    assert response.status_code == 403
