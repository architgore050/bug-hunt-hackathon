"""Public allowlists, authoritative time, round adjustments, and participant config."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from app.db import app_session
from conftest import login, participant_client
from fastapi.testclient import TestClient
from sqlalchemy import text

PUBLIC_EVENT_KEYS = {
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
PUBLIC_RULES_KEYS = {"version", "body_markdown", "frozen_at", "event_name"}
ROUND_KEYS = {
    "id",
    "name",
    "kind",
    "status",
    "event_status",
    "starts_at",
    "ends_at_effective",
    "grace_seconds",
    "paused",
}


def _authenticated_client(client: TestClient, email: str) -> TestClient:
    token = login(client, email)["access_token"]
    authenticated = TestClient(client.app)
    authenticated.headers.update({"Authorization": f"Bearer {token}"})
    return authenticated


def _main_stage() -> dict:
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT st.id, st.event_id, st.config, st.grace_seconds, e.config AS event_config, e.rules_version "
                    "FROM app.stages st JOIN app.events e ON e.id = st.event_id WHERE st.kind = 'main' LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def test_public_event_exposes_only_allowlisted_fields_and_is_cacheable(client):
    starts_at = datetime(2030, 1, 2, 3, 4, tzinfo=UTC)
    ends_at = starts_at + timedelta(minutes=180)
    public_summary = {"mode": "offline", "team_size": "4-5 participants", "duration_minutes": 180}
    with app_session() as s:
        event = s.execute(text("SELECT id, config FROM app.events ORDER BY created_at DESC LIMIT 1")).mappings().one()
        config = event["config"]
        config["public_summary"] = public_summary
        config["capacity_note"] = "PRIVATE-CAPACITY-SENTINEL"
        config["features"]["internal_endpoint"] = "PRIVATE-ENDPOINT-SENTINEL"
        s.execute(
            text(
                "UPDATE app.events SET starts_at = :starts, ends_at = :ends, config = CAST(:config AS jsonb) "
                "WHERE id = CAST(:event AS uuid)"
            ),
            {
                "starts": starts_at,
                "ends": ends_at,
                "config": json.dumps(config),
                "event": str(event["id"]),
            },
        )

    response = client.get("/v1/public/event")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "public, max-age=10"
    body = response.json()
    assert set(body) == {"event"}
    event_body = body["event"]
    assert set(event_body) == PUBLIC_EVENT_KEYS
    assert event_body == {
        "slug": "fall-back-2026",
        "name": "Fall Back - Full-Stack Software Debugging Challenge",
        "status": "configured",
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "timezone": "Asia/Kolkata",
        "duration_minutes": 180,
        "max_participants": 50,
        "max_teams": 10,
        "rules_version": 1,
        "format": public_summary,
    }
    assert "PRIVATE-CAPACITY-SENTINEL" not in response.text
    assert "PRIVATE-ENDPOINT-SENTINEL" not in response.text


def test_public_rules_returns_latest_version_with_exact_safe_keys(client):
    frozen_at = datetime(2030, 2, 3, 4, 5, tzinfo=UTC)
    with app_session() as s:
        event_id = s.execute(text("SELECT id FROM app.events ORDER BY created_at DESC LIMIT 1")).scalar_one()
        s.execute(
            text(
                "INSERT INTO app.rules_documents (id, event_id, version, body_md, content_hash, frozen_at) VALUES "
                "(CAST(:id AS uuid), CAST(:event AS uuid), 2, :body, :hash, :frozen)"
            ),
            {
                "id": str(uuid.uuid4()),
                "event": str(event_id),
                "body": "# Published rules\n\nUse only the assigned application.",
                "hash": "a" * 64,
                "frozen": frozen_at,
            },
        )

    response = client.get("/v1/public/rules")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "public, max-age=10"
    assert response.json() == {
        "rules": {
            "version": 2,
            "body_markdown": "# Published rules\n\nUse only the assigned application.",
            "frozen_at": frozen_at.isoformat(),
            "event_name": "Fall Back - Full-Stack Software Debugging Challenge",
        }
    }
    assert set(response.json()["rules"]) == PUBLIC_RULES_KEYS


def test_public_endpoints_return_null_when_no_publishable_rows_exist(client):
    with app_session() as s:
        s.execute(text("UPDATE app.events SET status = 'draft'"))
        s.execute(text("DELETE FROM app.rules_documents"))

    event = client.get("/v1/public/event")
    assert event.status_code == 200
    assert event.json() == {"event": None}
    assert event.headers["Cache-Control"] == "public, max-age=10"
    rules = client.get("/v1/public/rules")
    assert rules.status_code == 200
    assert rules.json() == {"rules": None}
    assert rules.headers["Cache-Control"] == "public, max-age=10"


def test_server_time_uses_the_database_clock_and_matching_milliseconds(client):
    with app_session() as s:
        before = s.execute(text("SELECT clock_timestamp()")).scalar_one()
    response = client.get("/v1/time")
    with app_session() as s:
        after = s.execute(text("SELECT clock_timestamp()")).scalar_one()

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"server_time_ms", "server_time"}
    reported = datetime.fromisoformat(body["server_time"])
    assert reported.tzinfo is not None
    assert before <= reported <= after
    assert body["server_time_ms"] == int(reported.timestamp() * 1000)


def test_round_state_applies_global_and_only_the_callers_time_adjustments(client):
    pc = participant_client(client, "p1.team1@example.com")
    teammate = _authenticated_client(client, "p2.team1@example.com")
    stage = _main_stage()
    starts_at = datetime(2029, 1, 1, tzinfo=UTC)
    base_end = datetime(2030, 1, 1, tzinfo=UTC)
    with app_session() as s:
        users = (
            s.execute(
                text(
                    "SELECT id FROM app.users WHERE email IN ('p1.team1@example.com', 'p2.team1@example.com') ORDER BY email"
                )
            )
            .scalars()
            .all()
        )
        organizer_id = s.execute(text("SELECT id FROM app.users WHERE email = 'organizer@example.com'")).scalar_one()
        s.execute(
            text(
                "UPDATE app.stages SET status = 'active', starts_at = :starts, ends_at = :ends, grace_seconds = 17 "
                "WHERE id = CAST(:stage AS uuid)"
            ),
            {"starts": starts_at, "ends": base_end, "stage": str(stage["id"])},
        )
        for user_id, delta in ((None, 120), (str(users[0]), 30), (str(users[1]), -60)):
            s.execute(
                text(
                    "INSERT INTO app.time_adjustments (id, stage_id, user_id, delta_seconds, reason_code, created_by) "
                    "VALUES (CAST(:id AS uuid), CAST(:stage AS uuid), CAST(:user AS uuid), :delta, :reason, CAST(:actor AS uuid))"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "stage": str(stage["id"]),
                    "user": user_id,
                    "delta": delta,
                    "reason": "PARTICIPANT_STATE_TEST",
                    "actor": str(organizer_id),
                },
            )

    response = pc.get("/v1/state")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "server_time",
        "round",
        "rules_version",
        "announcements_version",
        "leaderboard_version",
        "leaderboard_visibility",
    }
    assert set(body["round"]) == ROUND_KEYS
    assert body["round"] == {
        "id": str(stage["id"]),
        "name": "Fall Back Main Challenge",
        "kind": "main",
        "status": "active",
        "event_status": "live",
        "starts_at": starts_at.isoformat(),
        "ends_at_effective": (base_end + timedelta(seconds=150)).isoformat(),
        "grace_seconds": 17,
        "paused": False,
    }
    assert body["rules_version"] == 1
    assert body["announcements_version"] == 1
    assert body["leaderboard_version"] == 0
    assert body["leaderboard_visibility"] == "hidden"
    datetime.fromisoformat(body["server_time"])

    teammate_body = teammate.get("/v1/state").json()
    assert teammate_body["round"]["ends_at_effective"] == (base_end + timedelta(seconds=60)).isoformat()

    with app_session() as s:
        s.execute(
            text("UPDATE app.stages SET status = 'paused' WHERE id = CAST(:stage AS uuid)"),
            {"stage": str(stage["id"])},
        )
    paused = pc.get("/v1/state").json()["round"]
    assert paused["status"] == "paused"
    assert paused["paused"] is True
    assert paused["ends_at_effective"] == (base_end + timedelta(seconds=150)).isoformat()


def test_participant_config_returns_only_operational_allowlists(client):
    pc = participant_client(client, "p1.team1@example.com")
    stage = _main_stage()
    safe_limits = {
        "feedback_mode": "released",
        "leaderboard_mode": "frozen",
        "max_span": 31,
        "max_reports_per_file": 7,
        "max_reports_per_round": 44,
        "file_cooldown_s": 0,
        "location_tolerance_lines": 3,
        "ctf_bonus_cap_points": 91,
        "penalty": {"fp_factor": 0.1, "cap_fraction": 0.2, "applies": "at_release_only"},
        "schedule": [{"phase": "Participant briefing", "duration_minutes": 10}],
    }
    stage_config = {
        **safe_limits,
        "internal_rule_set_hash": "PRIVATE-RULE-SENTINEL",
        "organizer_notes": "PRIVATE-NOTE-SENTINEL",
    }
    weights = {"functional_test": 0.6, "code_review": 0.25, "evidence_report": 0.15}
    schedule = [{"phase": "Main challenge", "duration_minutes": 180}]
    event_config = stage["event_config"]
    event_config["features"] = {
        "runner_enabled": True,
        "ai_assessment_enabled": True,
        "telemetry_enabled": True,
        "private_feature": "PRIVATE-FEATURE-SENTINEL",
    }
    event_config["scoring"] = {
        "weights": weights,
        "ctf_bonus_cap_points": 175,
        "private_scoring": "PRIVATE-SCORING-SENTINEL",
    }
    event_config["schedule"] = schedule
    event_config["private_event_config"] = "PRIVATE-EVENT-SENTINEL"
    with app_session() as s:
        s.execute(
            text(
                "UPDATE app.stages SET grace_seconds = 17, config = CAST(:config AS jsonb) "
                "WHERE id = CAST(:stage AS uuid)"
            ),
            {"config": json.dumps(stage_config), "stage": str(stage["id"])},
        )
        s.execute(
            text("UPDATE app.events SET config = CAST(:config AS jsonb) WHERE id = CAST(:event AS uuid)"),
            {"config": json.dumps(event_config), "event": str(stage["event_id"])},
        )

    response = pc.get("/v1/config")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "stage_id": str(stage["id"]),
        "grace_seconds": 17,
        "runner_enabled": True,
        "ai_assessment_enabled": True,
        "scoring_weights": weights,
        "ctf_bonus_cap_points": 175,
        "limits": safe_limits,
        "schedule": schedule,
    }
    assert set(body) == {
        "stage_id",
        "grace_seconds",
        "runner_enabled",
        "ai_assessment_enabled",
        "scoring_weights",
        "ctf_bonus_cap_points",
        "limits",
        "schedule",
    }
    for sentinel in (
        "PRIVATE-RULE-SENTINEL",
        "PRIVATE-NOTE-SENTINEL",
        "PRIVATE-FEATURE-SENTINEL",
        "PRIVATE-SCORING-SENTINEL",
        "PRIVATE-EVENT-SENTINEL",
    ):
        assert sentinel not in response.text


def test_state_without_a_publishable_event_has_no_round_and_config_is_not_found(client):
    pc = participant_client(client, "p1.team1@example.com")
    with app_session() as s:
        s.execute(text("UPDATE app.events SET status = 'configured'"))

    response = pc.get("/v1/state")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"server_time", "round"}
    assert body["round"] is None
    datetime.fromisoformat(body["server_time"])
    config = pc.get("/v1/config")
    assert config.status_code == 404
    assert config.json()["error"]["code"] == "NOT_FOUND"


def test_state_and_config_require_authentication(client):
    for path in ("/v1/state", "/v1/config"):
        response = client.get(path)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_TOKEN_EXPIRED"
