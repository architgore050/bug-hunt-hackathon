"""Tests for event setup, configuration history and step-up scoring controls."""

from __future__ import annotations

import uuid

from conftest import STAFF_PW, login
from fastapi.testclient import TestClient


def _staff(client, email: str) -> TestClient:
    signed_in = login(client, email, STAFF_PW)
    staff = TestClient(client.app)
    staff.headers.update({"Authorization": f"Bearer {signed_in['access_token']}"})
    return staff


def test_config_revision_history_and_freeze(client):
    organizer = _staff(client, "organizer@example.com")
    event = organizer.get("/v1/admin/events").json()["events"][0]
    event_id = event["id"]

    current = organizer.get(f"/v1/admin/events/{event_id}/config/revisions")
    assert current.status_code == 200, current.text
    original_version = current.json()["config_version"]
    original_config = current.json()["current_config"]

    updated_config = {**original_config, "public_summary": {"title": "Setup revision test"}}
    save = organizer.post(
        f"/v1/admin/events/{event_id}/config",
        json={
            "config": updated_config,
            "reason": "Verify configuration revision history",
            "freeze": True,
        },
    )
    assert save.status_code == 200, save.text

    history = organizer.get(f"/v1/admin/events/{event_id}/config/revisions")
    assert history.status_code == 200, history.text
    payload = history.json()
    assert payload["config_version"] == original_version + 1
    assert payload["current_config"]["public_summary"]["title"] == "Setup revision test"
    revision = payload["revisions"][0]
    assert revision["version"] == max(row["version"] for row in payload["revisions"])
    assert revision["reason"] == "Verify configuration revision history"
    assert revision["frozen_at"] is not None
    assert revision["rule_set_hash"].startswith("sha256:")


def test_time_adjustment_is_event_scoped(client):
    organizer = _staff(client, "organizer@example.com")
    event = organizer.get("/v1/admin/events").json()["events"][0]
    event_id = event["id"]
    stage_id = organizer.get(f"/v1/admin/events/{event_id}/live").json()["stages"][0]["id"]

    valid = organizer.post(
        f"/v1/admin/events/{event_id}/time-adjustment",
        json={
            "stage_id": stage_id,
            "delta_seconds": 90,
            "reason_code": "OUTAGE",
            "user_id": None,
        },
    )
    assert valid.status_code == 200, valid.text

    wrong_stage = organizer.post(
        f"/v1/admin/events/{uuid.uuid4()}/time-adjustment",
        json={
            "stage_id": stage_id,
            "delta_seconds": 90,
            "reason_code": "OUTAGE",
            "user_id": None,
        },
    )
    assert wrong_stage.status_code == 404
    assert wrong_stage.json()["error"]["code"] == "NOT_FOUND"

    too_large = organizer.post(
        f"/v1/admin/events/{event_id}/time-adjustment",
        json={
            "stage_id": stage_id,
            "delta_seconds": 86401,
            "reason_code": "OUTAGE",
            "user_id": None,
        },
    )
    assert too_large.status_code == 422
    assert too_large.json()["error"]["code"] == "VALIDATION_ERROR"


def test_manual_score_adjustment_requires_admin_step_up(client):
    organizer = _staff(client, "organizer@example.com")
    event = organizer.get("/v1/admin/events").json()["events"][0]
    event_id = event["id"]
    stage_id = organizer.get(f"/v1/admin/events/{event_id}/live").json()["stages"][0]["id"]
    team_id = organizer.get(f"/v1/admin/events/{event_id}/teams").json()["teams"][0]["id"]
    payload = {
        "stage_id": stage_id,
        "team_id": team_id,
        "points": 2.5,
        "reason": "Test manual ledger adjustment",
    }

    organizer_no_step_up = organizer.post("/v1/admin/adjustments", json=payload)
    assert organizer_no_step_up.status_code == 403
    assert organizer_no_step_up.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"

    organizer.post("/v1/auth/step-up", json={"password": STAFF_PW}).raise_for_status()
    organizer_forbidden = organizer.post("/v1/admin/adjustments", json=payload)
    assert organizer_forbidden.status_code == 403
    assert organizer_forbidden.json()["error"]["code"] == "AUTH_FORBIDDEN"

    admin = _staff(client, "admin@example.com")
    no_step_up = admin.post("/v1/admin/adjustments", json=payload)
    assert no_step_up.status_code == 403
    assert no_step_up.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"

    admin.post("/v1/auth/step-up", json={"password": STAFF_PW}).raise_for_status()
    accepted = admin.post("/v1/admin/adjustments", json=payload)
    assert accepted.status_code == 200, accepted.text
