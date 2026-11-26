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
    admin.post("/v1/auth/step-up", json={"password": STAFF_PW}).raise_for_status()
    event = admin.get("/v1/admin/events").json()["events"][0]
    event_id = event["id"]

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

    initial_password = "Participant-First-Password-123"
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

    replacement_password = "Admin-Reset-Password-123"
    reset = admin.post(
        f"/v1/admin/users/{participant_id}/password-reset",
        json={"password": replacement_password},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["email"] == email
    assert client.get("/v1/me", headers=participant_client.headers).status_code == 401
    assert client.post(
        "/v1/auth/login",
        json={"email": email, "password": initial_password},
    ).status_code == 401
    new_login = client.post(
        "/v1/auth/login",
        json={"email": email, "password": replacement_password},
    )
    assert new_login.status_code == 200, new_login.text

    removed = admin.delete(f"/v1/admin/events/{event_id}/participants/{participant_id}")
    assert removed.status_code == 200, removed.text
    disabled_login = client.post(
        "/v1/auth/login",
        json={"email": email, "password": replacement_password},
    )
    assert disabled_login.status_code == 403
    assert disabled_login.json()["error"]["code"] == "AUTH_NOT_ACTIVATED"


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
