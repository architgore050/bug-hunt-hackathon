"""Organizer event, lifecycle, live-ops, readiness, and audit API coverage."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta

import pytest
from conftest import STAFF_PW, login
from fastapi.testclient import TestClient
from sqlalchemy import text


def _staff(client: TestClient, email: str = "organizer@example.com", *, step_up: bool = False) -> TestClient:
    token = login(client, email)["access_token"]
    staff = TestClient(client.app)
    staff.headers.update({"Authorization": f"Bearer {token}"})
    if step_up:
        response = staff.post("/v1/auth/step-up", json={"password": STAFF_PW})
        assert response.status_code == 200, response.text
    return staff


def _create_event(organizer: TestClient, **overrides) -> str:
    body = {
        "name": "Administrator Coverage Event",
        "slug": f"admin-coverage-{uuid.uuid4().hex[:12]}",
        "duration_minutes": 90,
        "max_participants": 8,
        "max_teams": 2,
        **overrides,
    }
    response = organizer.post("/v1/admin/events", json=body)
    assert response.status_code == 201, response.text
    return response.json()["event_id"]


def _create_stage(organizer: TestClient, event_id: str, name: str = "Coverage Main Stage", **overrides) -> str:
    response = organizer.post(
        f"/v1/admin/events/{event_id}/stages",
        json={"name": name, "kind": "main", "grace_seconds": 7, **overrides},
    )
    assert response.status_code == 201, response.text
    return response.json()["stage_id"]


def _control(organizer: TestClient, stage_id: str, action: str, **overrides) -> None:
    response = organizer.post(
        f"/v1/admin/stages/{stage_id}/control",
        json={"action": action, "reason": "ADM-COVERAGE", **overrides},
    )
    assert response.status_code == 200, response.text


def _user_id(email: str) -> str:
    from app.db import app_session

    with app_session() as session:
        return str(
            session.execute(text("SELECT id FROM app.users WHERE email = :email"), {"email": email}).scalar_one()
        )


def _audit_count(action: str, entity_id: str | None = None) -> int:
    from app.db import app_session

    with app_session() as session:
        if entity_id is None:
            row = session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = :action"), {"action": action}
            ).first()
        else:
            row = session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = :action AND entity_id = :entity"),
                {"action": action, "entity": entity_id},
            ).first()
    return int(row[0])


def _canonical_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def test_event_creation_and_listing_persist_caps_and_default_config(client):
    organizer = _staff(client)
    request_id = f"event-create-{uuid.uuid4().hex[:8]}"
    response = organizer.post(
        "/v1/admin/events",
        json={
            "name": "Coverage Workshop",
            "slug": f"coverage-workshop-{uuid.uuid4().hex[:8]}",
            "duration_minutes": 75,
            "max_participants": 24,
            "max_teams": 6,
        },
        headers={"X-Request-Id": request_id},
    )
    assert response.status_code == 201, response.text
    assert response.headers["X-Request-Id"] == request_id
    event_id = response.json()["event_id"]
    uuid.UUID(event_id)

    listed = organizer.get("/v1/admin/events")
    assert listed.status_code == 200, listed.text
    event = next(item for item in listed.json()["events"] if item["id"] == event_id)
    assert event["name"] == "Coverage Workshop"
    assert event["status"] == "draft"
    assert event["starts_at"] is None and event["ends_at"] is None
    assert event["timezone"] == "Asia/Kolkata"
    assert event["duration_minutes"] == 75
    assert event["max_participants"] == 24 and event["max_teams"] == 6
    assert event["rules_version"] == 1 and event["config_version"] == 1

    from app.config import settings
    from app.db import app_session

    with app_session() as session:
        stored = (
            session.execute(
                text(
                    "SELECT e.tenant_id, e.config, a.actor_id, a.actor_role, a.request_id "
                    "FROM app.events e JOIN audit.entries a ON a.entity_id = CAST(e.id AS varchar) "
                    "AND a.action = 'event.created' "
                    "WHERE e.id = CAST(:event AS uuid)"
                ),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert stored["tenant_id"] is not None
    assert stored["config"]["features"] == {
        "runner_enabled": settings.runner_enabled,
        "ai_assessment_enabled": settings.ai_assessment_enabled,
    }
    assert stored["config"]["scoring"]["weights"] == {
        "functional_test": 0.5,
        "code_review": 0.3,
        "evidence_report": 0.2,
    }
    assert stored["config"]["scoring"]["ctf_bonus_cap_points"] == 100
    assert "Provisional" in stored["config"]["capacity_note"]
    assert str(stored["actor_id"]) == _user_id("organizer@example.com")
    assert stored["actor_role"] == "organizer"
    assert stored["request_id"] == request_id


def test_config_revisions_hash_freeze_and_reject_invalid_weights_atomically(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    draft_config = {
        "scoring": {"weights": {"functional_test": 0.6, "code_review": 0.4}},
        "public_summary": {"mode": "offline"},
    }

    from app.db import app_session

    with app_session() as session:
        original = (
            session.execute(
                text("SELECT config, config_version, rules_version FROM app.events WHERE id = CAST(:event AS uuid)"),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    response = organizer.post(
        f"/v1/admin/events/{event_id}/config",
        json={"config": draft_config, "reason": "Draft scoring revision", "freeze": False},
    )
    assert response.status_code == 200, response.text
    canonical = json_canonical(draft_config)
    assert response.json()["rule_set_hash"] == f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}"

    with app_session() as session:
        revision = (
            session.execute(
                text(
                    "SELECT version, config, rule_set_hash, reason, created_by, frozen_at "
                    "FROM app.event_config_revisions WHERE event_id = CAST(:event AS uuid)"
                ),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
        unchanged = (
            session.execute(
                text("SELECT config, config_version, rules_version FROM app.events WHERE id = CAST(:event AS uuid)"),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert revision["version"] == 1
    assert revision["config"] == draft_config
    assert revision["rule_set_hash"] == response.json()["rule_set_hash"]
    assert revision["reason"] == "Draft scoring revision"
    assert str(revision["created_by"]) == _user_id("organizer@example.com")
    assert revision["frozen_at"] is None
    assert unchanged["config"] == original["config"]
    assert unchanged["config_version"] == original["config_version"]
    assert unchanged["rules_version"] == original["rules_version"]

    response = organizer.post(
        f"/v1/admin/events/{event_id}/config",
        json={
            "config": {"scoring": {"weights": {"functional_test": 0.6, "code_review": 0.3, "evidence_report": 0.2}}},
            "reason": "Invalid weights must not persist",
            "freeze": True,
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"]["weights"] == "Scoring weights must sum to 1.0."
    assert _audit_count("event.config_revised", event_id) == 1

    frozen_config = {
        "scoring": {"weights": {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2}},
        "public_summary": {"mode": "offline", "team_size": "4-5"},
    }
    response = organizer.post(
        f"/v1/admin/events/{event_id}/config",
        json={"config": frozen_config, "reason": "Approved frozen scoring rules", "freeze": True},
    )
    assert response.status_code == 200, response.text
    canonical = json_canonical(frozen_config)
    expected_hash = f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}"
    assert response.json()["rule_set_hash"] == expected_hash

    with app_session() as session:
        revisions = (
            session.execute(
                text(
                    "SELECT version, config, rule_set_hash, frozen_at FROM app.event_config_revisions "
                    "WHERE event_id = CAST(:event AS uuid) ORDER BY version"
                ),
                {"event": event_id},
            )
            .mappings()
            .all()
        )
        current = (
            session.execute(
                text("SELECT config, config_version, rules_version FROM app.events WHERE id = CAST(:event AS uuid)"),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert [row["version"] for row in revisions] == [1, 2]
    assert revisions[1]["config"] == frozen_config
    assert revisions[1]["rule_set_hash"] == expected_hash
    assert revisions[1]["frozen_at"] is not None
    assert current["config"] == frozen_config
    assert current["config_version"] == 2
    assert current["rules_version"] == original["rules_version"]
    assert _audit_count("event.config_revised", event_id) == 2


def json_canonical(value: dict) -> str:
    import json

    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def test_event_status_transitions_enforce_readiness_and_persist_schedule(client):
    organizer = _staff(client)
    event_id = _create_event(organizer, duration_minutes=45)

    from app.db import app_session

    response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": "live"})
    assert response.status_code == 422, response.text
    with app_session() as session:
        session.execute(
            text(
                "INSERT INTO app.readiness_items (id, event_id, key, label, owner) "
                "VALUES (CAST(:id AS uuid), CAST(:event AS uuid), 'venue_network', 'Venue network verified', 'ops')"
            ),
            {"id": str(uuid.uuid4()), "event": event_id},
        )

    response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": "configured"})
    assert response.status_code == 200, response.text
    response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": "closed"})
    assert response.status_code == 422, response.text
    response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": "ready"})
    assert response.status_code == 200, response.text
    response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": "live"})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"]["readiness"] == "1 readiness items are unchecked."

    with app_session() as session:
        blocked = (
            session.execute(
                text("SELECT status, starts_at, ends_at FROM app.events WHERE id = CAST(:event AS uuid)"),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert blocked["status"] == "ready"
    assert blocked["starts_at"] is None and blocked["ends_at"] is None
    assert _audit_count("event.status_changed", event_id) == 2

    response = organizer.post(f"/v1/admin/events/{event_id}/readiness/venue_network", json={"state": "na"})
    assert response.status_code == 200, response.text
    response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": "live"})
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "status": "live"}

    with app_session() as session:
        live = (
            session.execute(
                text("SELECT status, starts_at, ends_at FROM app.events WHERE id = CAST(:event AS uuid)"),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert live["status"] == "live"
    assert live["starts_at"] is not None and live["ends_at"] is not None
    assert live["ends_at"] - live["starts_at"] == timedelta(minutes=45)

    for target in ("closed", "finalized", "archived"):
        response = organizer.post(f"/v1/admin/events/{event_id}/status", json={"status": target})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == target
    with app_session() as session:
        transitions = (
            session.execute(
                text(
                    "SELECT details FROM audit.entries WHERE action = 'event.status_changed' AND entity_id = :event "
                    "ORDER BY seq",
                ),
                {"event": event_id},
            )
            .scalars()
            .all()
        )
    assert [row["to"] for row in transitions] == ["configured", "ready", "live", "closed", "finalized", "archived"]


def test_stage_lifecycle_controls_persist_state_transitions_and_extensions(client):
    organizer = _staff(client)
    event_id = _create_event(organizer, duration_minutes=50)
    response = organizer.post(
        f"/v1/admin/events/{event_id}/stages",
        json={"name": "Lifecycle Stage", "kind": "main", "grace_seconds": 7, "config": {"max_span": 10}},
    )
    assert response.status_code == 201, response.text
    stage_id = response.json()["stage_id"]

    from app.db import app_session

    with app_session() as session:
        created = (
            session.execute(
                text(
                    "SELECT status, ordinal, grace_seconds, config, rule_set_hash FROM app.stages WHERE id = CAST(:stage AS uuid)"
                ),
                {"stage": stage_id},
            )
            .mappings()
            .one()
        )
    assert created["status"] == "draft" and created["ordinal"] == 1
    assert created["grace_seconds"] == 7
    assert created["config"]["max_span"] == 10
    assert created["config"]["feedback_mode"] == "hidden"
    assert created["config"]["penalty"]["applies"] == "at_release_only"
    assert response.json()["rule_set_hash"] == (
        "sha256:" + hashlib.sha256(json_canonical(created["config"]).encode()).hexdigest()
    )

    response = organizer.post(
        f"/v1/admin/stages/{stage_id}/control", json={"action": "start", "reason": "ADM-COVERAGE"}
    )
    assert response.status_code == 422, response.text
    response = organizer.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "arm"})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"]["reason"] == "A reason code is required for stage control."

    for action in ("seal", "arm", "start"):
        _control(organizer, stage_id, action)
    with app_session() as session:
        active = (
            session.execute(
                text("SELECT status, started_at, ends_at FROM app.stages WHERE id = CAST(:stage AS uuid)"),
                {"stage": stage_id},
            )
            .mappings()
            .one()
        )
    assert active["status"] == "active"
    assert active["started_at"] is not None and active["ends_at"] is not None
    assert active["ends_at"] - active["started_at"] == timedelta(minutes=50)

    _control(organizer, stage_id, "extend", seconds=60)
    with app_session() as session:
        extended = (
            session.execute(
                text("SELECT status, ends_at FROM app.stages WHERE id = CAST(:stage AS uuid)"), {"stage": stage_id}
            )
            .mappings()
            .one()
        )
    assert extended["status"] == "active"
    assert extended["ends_at"] - active["ends_at"] == timedelta(seconds=60)

    for seconds in (0, 3601):
        response = organizer.post(
            f"/v1/admin/stages/{stage_id}/control",
            json={"action": "extend", "seconds": seconds, "reason": "ADM-COVERAGE"},
        )
        assert response.status_code == 422, response.text
    _control(organizer, stage_id, "end")
    with app_session() as session:
        ended = (
            session.execute(
                text("SELECT status, ended_at, ends_at FROM app.stages WHERE id = CAST(:stage AS uuid)"),
                {"stage": stage_id},
            )
            .mappings()
            .one()
        )
        transitions = (
            session.execute(
                text(
                    "SELECT from_status, reason_code, actor_id FROM app.stage_transitions "
                    "WHERE stage_id = CAST(:stage AS uuid) ORDER BY created_at, id"
                ),
                {"stage": stage_id},
            )
            .mappings()
            .all()
        )
    assert ended["status"] == "ended"
    assert ended["ended_at"] is not None
    assert ended["ends_at"] == extended["ends_at"]
    assert [row["from_status"] for row in transitions] == ["draft", "sealed", "armed", "active", "active"]
    assert {row["reason_code"] for row in transitions} == {"ADM-COVERAGE"}
    assert {str(row["actor_id"]) for row in transitions} == {_user_id("organizer@example.com")}
    assert _audit_count("stage.end", stage_id) == 1

    response = organizer.post(
        f"/v1/admin/stages/{stage_id}/control", json={"action": "launch", "reason": "ADM-COVERAGE"}
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"]["action"] == "Unknown action."
    assert _audit_count("stage.end", stage_id) == 1


def test_evaluate_moves_an_ended_stage_to_evaluating_and_audits(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    stage_id = _create_stage(organizer, event_id)
    for action in ("seal", "arm", "start", "end"):
        _control(organizer, stage_id, action)

    from app.db import app_session

    response = organizer.post(
        f"/v1/admin/stages/{stage_id}/release", json={"action": "evaluate", "reason": "Evaluation started"}
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        status = session.execute(
            text("SELECT status FROM app.stages WHERE id = CAST(:stage AS uuid)"), {"stage": stage_id}
        ).scalar_one()
    assert status == "evaluating"
    assert _audit_count("stage.evaluate", stage_id) == 1


def test_release_from_ended_enqueues_feedback_and_public_leaderboard_jobs(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    stage_id = _create_stage(organizer, event_id)
    for action in ("seal", "arm", "start", "end"):
        _control(organizer, stage_id, action)

    from app.db import app_session

    response = organizer.post(
        f"/v1/admin/stages/{stage_id}/release", json={"action": "release", "reason": "Results approved"}
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        status = session.execute(
            text("SELECT status FROM app.stages WHERE id = CAST(:stage AS uuid)"), {"stage": stage_id}
        ).scalar_one()
        jobs = (
            session.execute(text("SELECT kind, payload, status FROM app.jobs ORDER BY created_at, id")).mappings().all()
        )
    assert status == "released"
    jobs_by_kind = {job["kind"]: job for job in jobs}
    assert set(jobs_by_kind) == {"release_feedback", "refresh_leaderboard"}
    assert {job["status"] for job in jobs} == {"queued"}
    assert jobs_by_kind["release_feedback"]["payload"] == {"stage_id": stage_id}
    assert jobs_by_kind["refresh_leaderboard"]["payload"] == {"stage_id": stage_id, "visibility": "public"}
    assert _audit_count("stage.release", stage_id) == 1

    response = organizer.post(f"/v1/admin/stages/{stage_id}/release", json={"action": "release"})
    assert response.status_code == 422, response.text
    with app_session() as session:
        job_count = session.execute(text("SELECT count(*) FROM app.jobs")).scalar_one()
    assert int(job_count) == 2
    assert _audit_count("stage.release", stage_id) == 1


def test_release_rejects_unended_stage_without_jobs_or_audit(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    stage_id = _create_stage(organizer, event_id)

    from app.db import app_session

    for action in ("evaluate", "release"):
        response = organizer.post(f"/v1/admin/stages/{stage_id}/release", json={"action": action})
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    with app_session() as session:
        status = session.execute(
            text("SELECT status FROM app.stages WHERE id = CAST(:stage AS uuid)"), {"stage": stage_id}
        ).scalar_one()
        job_count = session.execute(text("SELECT count(*) FROM app.jobs")).scalar_one()
    assert status == "draft"
    assert int(job_count) == 0
    assert _audit_count("stage.evaluate", stage_id) == 0
    assert _audit_count("stage.release", stage_id) == 0


def test_team_creation_enforces_event_cap_and_audits_only_created_teams(client):
    organizer = _staff(client, "admin@example.com", step_up=True)
    event_id = _create_event(organizer, max_teams=2)
    created = []
    for name in ("Cap Team One", "Cap Team Two"):
        response = organizer.post(f"/v1/admin/events/{event_id}/teams", json={"name": name})
        assert response.status_code == 201, response.text
        body = response.json()
        assert len(body["join_code"]) == 8
        assert body["join_code"] == body["join_code"].upper()
        int(body["join_code"], 16)
        created.append(body)

    from app.db import app_session

    response = organizer.post(f"/v1/admin/events/{event_id}/teams", json={"name": "Over Cap Team"})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"]["capacity"] == "Team cap (2) reached."
    with app_session() as session:
        teams = (
            session.execute(
                text("SELECT id, name, join_code FROM app.teams WHERE event_id = CAST(:event AS uuid) ORDER BY name"),
                {"event": event_id},
            )
            .mappings()
            .all()
        )
    assert {row["name"] for row in teams} == {"Cap Team One", "Cap Team Two"}
    assert {row["join_code"] for row in teams} == {body["join_code"] for body in created}
    assert all(_audit_count("team.created", body["team_id"]) == 1 for body in created)


def test_admin_managed_participant_registration_replaces_invites(client):
    from app.db import app_session

    admin = _staff(client, "admin@example.com", step_up=True)
    event_id = _create_event(admin)
    team_response = admin.post(f"/v1/admin/events/{event_id}/teams", json={"name": "Registered Team"})
    assert team_response.status_code == 201, team_response.text
    team_id = team_response.json()["team_id"]
    email = f"registered.{uuid.uuid4().hex[:8]}@example.com"

    registration = admin.post(
        f"/v1/admin/events/{event_id}/participants",
        json={"email": email, "name": "Registered Participant", "team_id": team_id},
    )
    assert registration.status_code == 201, registration.text
    assert registration.json()["password_setup_required"] is True

    legacy_invite = admin.post(
        f"/v1/admin/events/{event_id}/invites",
        json={"email": email, "team_id": team_id, "role": "participant"},
    )
    assert legacy_invite.status_code == 404

    with app_session() as session:
        user = (
            session.execute(
                text("SELECT id, role, password_hash FROM app.users WHERE lower(email) = :email"),
                {"email": email},
            )
            .mappings()
            .one()
        )
        membership = session.execute(
            text("SELECT team_id FROM app.team_members WHERE user_id = CAST(:user AS uuid)"),
            {"user": str(user["id"])},
        ).scalar_one()
    assert user["role"] == "participant"
    assert user["password_hash"] is None
    assert str(membership) == team_id

    password = "First-Claim-Password-123!"
    first_login = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert first_login.status_code == 200, first_login.text
    profile = client.get(
        "/v1/me",
        headers={"Authorization": f"Bearer {first_login.json()['access_token']}"},
    )
    assert profile.status_code == 200, profile.text
    assert profile.json()["team"]["id"] == team_id


def test_organizer_cannot_register_an_admin_without_side_effects(client):
    from app.db import app_session

    organizer = _staff(client, step_up=True)
    email = f"privilege-escalation-{uuid.uuid4().hex[:8]}@example.com"

    response = organizer.post(
        "/v1/auth/register",
        json={"email": email, "name": "Unauthorized Admin", "role": "admin", "password": "Assigned-Password-123!"},
    )

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM app.users WHERE lower(email) = :email"),
                {"email": email},
            ).scalar_one()
            == 0
        )


def test_announcement_creation_persists_plain_text_and_rejects_invalid_severity(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    body = "<script>alert('plain text')</script> Venue briefing starts at 10:00."

    from app.db import app_session

    response = organizer.post(f"/v1/admin/events/{event_id}/announcements", json={"severity": "urgent", "body": body})
    assert response.status_code == 422, response.text
    with app_session() as session:
        assert (
            int(
                session.execute(
                    text("SELECT count(*) FROM app.announcements WHERE event_id = CAST(:event AS uuid)"),
                    {"event": event_id},
                ).scalar_one()
            )
            == 0
        )
    assert _audit_count("announcement.created", event_id) == 0

    response = organizer.post(f"/v1/admin/events/{event_id}/announcements", json={"severity": "critical", "body": body})
    assert response.status_code == 201, response.text
    with app_session() as session:
        announcement = (
            session.execute(
                text(
                    "SELECT severity, audience, body, created_by FROM app.announcements "
                    "WHERE event_id = CAST(:event AS uuid)"
                ),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert announcement["severity"] == "critical"
    assert announcement["audience"] == "all"
    assert announcement["body"] == body
    assert str(announcement["created_by"]) == _user_id("organizer@example.com")
    assert _audit_count("announcement.created", event_id) == 1

    participant = _staff(client, "p1.team1@example.com")
    visible = participant.get("/v1/announcements")
    assert visible.status_code == 200, visible.text
    notice = next(item for item in visible.json()["announcements"] if item["body"] == body)
    assert notice["severity"] == "critical"
    assert notice["audience"] == "all"


def test_time_adjustment_persists_scoped_delta_and_rejects_invalid_requests(client):
    organizer = _staff(client)
    participant_id = _user_id("p1.team1@example.com")

    from app.db import app_session

    with app_session() as session:
        stage_id = str(
            session.execute(text("SELECT id FROM app.stages WHERE kind = 'main' ORDER BY ordinal LIMIT 1")).scalar_one()
        )
        event_id = str(
            session.execute(
                text("SELECT event_id FROM app.stages WHERE id = CAST(:stage AS uuid)"), {"stage": stage_id}
            ).scalar_one()
        )
    for body in (
        {"stage_id": stage_id, "delta_seconds": 0, "reason_code": "OUTAGE"},
        {"stage_id": stage_id, "delta_seconds": 60, "reason_code": "UNKNOWN"},
    ):
        response = organizer.post(f"/v1/admin/events/{event_id}/time-adjustment", json=body)
        assert response.status_code == 422, response.text
    with app_session() as session:
        assert int(session.execute(text("SELECT count(*) FROM app.time_adjustments")).scalar_one()) == 0

    response = organizer.post(
        f"/v1/admin/events/{event_id}/time-adjustment",
        json={
            "stage_id": stage_id,
            "user_id": participant_id,
            "delta_seconds": 120,
            "reason_code": "OUTAGE",
        },
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        adjustment = (
            session.execute(
                text("SELECT stage_id, user_id, delta_seconds, reason_code, created_by FROM app.time_adjustments")
            )
            .mappings()
            .one()
        )
    assert str(adjustment["stage_id"]) == stage_id
    assert str(adjustment["user_id"]) == participant_id
    assert adjustment["delta_seconds"] == 120
    assert adjustment["reason_code"] == "OUTAGE"
    assert str(adjustment["created_by"]) == _user_id("organizer@example.com")
    assert _audit_count("stage.time_adjustment", stage_id) == 1


def test_live_ops_reports_persisted_counts_stage_order_and_real_health(client):
    organizer = _staff(client)

    from app.config import settings
    from app.db import app_session, uuid7
    from app.jobs import enqueue

    with app_session() as session:
        context = (
            session.execute(
                text(
                    "SELECT e.id AS event_id, e.tenant_id, st.id AS stage_id, t.id AS team_id, "
                    "cv.id AS challenge_id, u.id AS user_id "
                    "FROM app.events e JOIN app.stages st ON st.event_id = e.id AND st.kind = 'main' "
                    "JOIN app.teams t ON t.event_id = e.id "
                    "JOIN app.team_members tm ON tm.team_id = t.id "
                    "JOIN app.users u ON u.id = tm.user_id "
                    "JOIN app.assignments a ON a.stage_id = st.id "
                    "JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                    "ORDER BY t.name, u.name LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
        submission_id = str(uuid7())
        session.execute(
            text(
                "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, "
                "kind, idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, line_start, line_end, "
                "received_at) VALUES (CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:challenge AS uuid), CAST(:team AS uuid), CAST(:user AS uuid), 'bug_report', :key, '{}', :hash, "
                "'received', :receipt, 'Live ops probe', 'db.js', 1, 2, clock_timestamp())"
            ),
            {
                "id": submission_id,
                "tenant": str(context["tenant_id"]),
                "event": str(context["event_id"]),
                "stage": str(context["stage_id"]),
                "challenge": str(context["challenge_id"]),
                "team": str(context["team_id"]),
                "user": str(context["user_id"]),
                "key": f"live-{submission_id}",
                "hash": hashlib.sha256(b"{}").hexdigest(),
                "receipt": f"LIVE-{submission_id[:8]}",
            },
        )
        session.execute(
            text(
                "INSERT INTO app.review_items (id, submission_id, status, priority, reason) "
                "VALUES (CAST(:id AS uuid), CAST(:submission AS uuid), 'open', 5, 'live ops probe')"
            ),
            {"id": str(uuid7()), "submission": submission_id},
        )
        enqueue(session, "coverage_probe", {"event_id": str(context["event_id"])})
        session.execute(
            text(
                "INSERT INTO app.jobs (id, kind, payload, status, max_attempts, last_error) "
                "VALUES (CAST(:id AS uuid), 'coverage_dead', '{}', 'dead', 1, 'deterministic probe')"
            ),
            {"id": str(uuid7())},
        )
        expected_teams = int(
            session.execute(
                text("SELECT count(*) FROM app.teams WHERE event_id = CAST(:event AS uuid)"),
                {"event": str(context["event_id"])},
            ).scalar_one()
        )
        expected_participants = int(
            session.execute(
                text(
                    "SELECT count(DISTINCT tm.user_id) FROM app.team_members tm "
                    "JOIN app.teams t ON t.id = tm.team_id WHERE t.event_id = CAST(:event AS uuid)"
                ),
                {"event": str(context["event_id"])},
            ).scalar_one()
        )
        event_id = str(context["event_id"])
        main_stage_id = str(context["stage_id"])

    response = organizer.get(f"/v1/admin/events/{event_id}/live")
    assert response.status_code == 200, response.text
    live = response.json()
    assert live["teams"] == expected_teams
    assert live["participants_online_estimate"] == expected_participants
    assert live["submission_counts"] == {"received": 1}
    assert live["job_queue"]["dead_letters"] == 1
    assert live["job_queue"]["oldest_queued_age_s"] >= 0
    assert live["review_backlog"] == 1
    assert live["health"]["database_app"] == "up"
    assert live["health"]["database_gt"] == "up"
    assert live["kill_switches"] == {
        "runner_enabled": settings.runner_enabled,
        "ai_assessment_enabled": settings.ai_assessment_enabled,
        "telemetry_enabled": settings.telemetry_enabled,
    }
    assert live["stages"][0]["id"] == main_stage_id
    assert [stage["ordinal"] for stage in live["stages"][1:]] == [1, 2, 3, 4]
    assert {stage["kind"] for stage in live["stages"][1:]} == {"level"}


def test_readiness_known_key_updates_state_timestamp_and_audit(client):
    organizer = _staff(client)

    from app.db import app_session

    with app_session() as session:
        event_id = str(session.execute(text("SELECT id FROM app.events ORDER BY created_at LIMIT 1")).scalar_one())
        item = (
            session.execute(
                text(
                    "SELECT key, label, owner FROM app.readiness_items WHERE event_id = CAST(:event AS uuid) "
                    "ORDER BY key LIMIT 1"
                ),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    key = item["key"]
    response = organizer.post(f"/v1/admin/events/{event_id}/readiness/{key}", json={"state": "done"})
    assert response.status_code == 422, response.text
    assert _audit_count("readiness.updated", event_id) == 0

    for state in ("checked", "unchecked", "na"):
        response = organizer.post(f"/v1/admin/events/{event_id}/readiness/{key}", json={"state": state})
        assert response.status_code == 200, response.text
        current = organizer.get(f"/v1/admin/events/{event_id}/readiness")
        assert current.status_code == 200, current.text
        updated = next(row for row in current.json()["items"] if row["key"] == key)
        assert updated["state"] == state
        assert updated["label"] == item["label"] and updated["owner"] == item["owner"]
        assert (updated["checked_at"] is not None) is (state == "checked")
    assert _audit_count("readiness.updated", event_id) == 3
    with app_session() as session:
        details = (
            session.execute(
                text(
                    "SELECT details FROM audit.entries WHERE action = 'readiness.updated' AND entity_id = :event "
                    "ORDER BY seq"
                ),
                {"event": event_id},
            )
            .scalars()
            .all()
        )
    assert [row["state"] for row in details] == ["checked", "unchecked", "na"]
    assert {row["key"] for row in details} == {key}


def test_audit_list_filters_and_verify_reports_an_intact_chain(client):
    organizer = _staff(client)
    request_id = f"audit-create-{uuid.uuid4().hex[:8]}"
    response = organizer.post(
        "/v1/admin/events",
        json={"name": "Audit Coverage Event", "slug": f"audit-coverage-{uuid.uuid4().hex[:8]}"},
        headers={"X-Request-Id": request_id},
    )
    assert response.status_code == 201, response.text
    event_id = response.json()["event_id"]
    response = organizer.post(
        f"/v1/admin/events/{event_id}/announcements", json={"body": "Audit chain coverage notice"}
    )
    assert response.status_code == 201, response.text

    filtered = organizer.get("/v1/admin/audit", params={"action": "event.created", "limit": 1})
    assert filtered.status_code == 200, filtered.text
    entries = filtered.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["action"] == "event.created"
    assert entries[0]["entity_id"] == event_id
    assert entries[0]["request_id"] == request_id
    assert entries[0]["actor_role"] == "organizer"

    recent = organizer.get("/v1/admin/audit", params={"limit": 2})
    assert recent.status_code == 200, recent.text
    assert [entry["action"] for entry in recent.json()["entries"]] == ["announcement.created", "event.created"]
    assert recent.json()["entries"][0]["seq"] > recent.json()["entries"][1]["seq"]

    verified = organizer.get("/v1/admin/audit/verify")
    assert verified.status_code == 200, verified.text
    assert verified.json()["scope"] == "global"
    assert verified.json()["intact"] is True
    assert verified.json()["broken_at"] is None
    assert verified.json()["entries"] == verified.json()["verified"]

    from app.db import app_session

    with app_session() as session:
        expected = int(
            session.execute(text("SELECT count(*) FROM audit.entries WHERE event_scope = 'global'")).scalar_one()
        )
    assert verified.json()["entries"] == min(expected, 5000)


def test_system_health_reports_real_database_and_queue_state(client):
    organizer = _staff(client)
    response = organizer.post("/v1/admin/jobs/auto-submit")
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]

    from app.config import settings
    from app.db import app_session

    with app_session() as session:
        expected_jobs = {
            row[0]: int(row[1])
            for row in session.execute(text("SELECT status, count(*) FROM app.jobs GROUP BY status")).all()
        }
        job = (
            session.execute(
                text("SELECT kind, payload, status FROM app.jobs WHERE id = CAST(:job AS uuid)"), {"job": job_id}
            )
            .mappings()
            .one()
        )
    assert job["kind"] == "auto_submit_levels"
    assert job["payload"] == {"trigger": "manual"}
    assert job["status"] == "queued"

    response = organizer.get("/v1/admin/system/health")
    assert response.status_code == 200, response.text
    health = response.json()
    assert health["databases"] == {"app": "up", "gt": "up"}
    assert health["jobs"] == expected_jobs
    assert health["jobs"]["queued"] == 1
    assert health["oldest_queued_job_age_s"] >= 0
    assert health["profile"] == settings.profile
    assert health["environment"] == settings.environment
    assert health["runner_enabled"] is settings.runner_enabled
    assert health["ai_assessment_enabled"] is settings.ai_assessment_enabled


@pytest.mark.parametrize("email", ["reviewer1@example.com", "p1.team1@example.com"])
def test_non_organizers_cannot_read_or_mutate_admin_event_operations(client, email):
    denied = _staff(client, email)

    from app.db import app_session

    with app_session() as session:
        event_id = str(session.execute(text("SELECT id FROM app.events ORDER BY created_at LIMIT 1")).scalar_one())
        stage_id = str(
            session.execute(
                text("SELECT id FROM app.stages WHERE event_id = CAST(:event AS uuid) ORDER BY ordinal LIMIT 1"),
                {"event": event_id},
            ).scalar_one()
        )
        counts = {
            table: int(session.execute(text(f"SELECT count(*) FROM app.{table}")).scalar_one())
            for table in ("events", "stages", "teams", "announcements", "jobs")
        }
        audit_count = int(session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one())

    requests = (
        ("GET", "/v1/admin/events", None),
        ("GET", f"/v1/admin/events/{event_id}/live", None),
        ("GET", "/v1/admin/audit", None),
        ("GET", "/v1/admin/system/health", None),
        ("POST", "/v1/admin/events", {"name": "Denied Event", "slug": f"denied-{uuid.uuid4().hex[:8]}"}),
        ("POST", f"/v1/admin/events/{event_id}/announcements", {"body": "Denied announcement"}),
        ("POST", f"/v1/admin/events/{event_id}/levels/bootstrap", None),
        ("POST", "/v1/admin/jobs/auto-submit", None),
        (
            "POST",
            f"/v1/admin/stages/{stage_id}/control",
            {"action": "seal", "reason": "ADM-DENIED"},
        ),
    )
    for method, path, body in requests:
        response = denied.request(method, path, json=body)
        assert response.status_code == 403, f"{method} {path}: {response.status_code} {response.text}"
        assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"

    with app_session() as session:
        after = {
            table: int(session.execute(text(f"SELECT count(*) FROM app.{table}")).scalar_one()) for table in counts
        }
        assert int(session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one()) == audit_count
    assert after == counts
