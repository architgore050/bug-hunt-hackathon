"""Admin repository locking, level progress, scheduling, and bootstrap coverage."""

from __future__ import annotations

import uuid

from conftest import STAFF_PW, login, participant_client, worker_drain
from fastapi.testclient import TestClient
from flow_helpers import go_live
from sqlalchemy import text


def _staff(client: TestClient, email: str = "organizer@example.com", *, step_up: bool = False) -> TestClient:
    token = login(client, email)["access_token"]
    staff = TestClient(client.app)
    staff.headers.update({"Authorization": f"Bearer {token}"})
    if step_up:
        response = staff.post("/v1/auth/step-up", json={"password": STAFF_PW})
        assert response.status_code == 200, response.text
    return staff


def _create_event(organizer: TestClient) -> str:
    response = organizer.post(
        "/v1/admin/events",
        json={
            "name": "Level Coverage Event",
            "slug": f"level-coverage-{uuid.uuid4().hex[:12]}",
            "duration_minutes": 120,
            "max_teams": 4,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["event_id"]


def _team_context() -> dict:
    from app.db import app_session

    with app_session() as session:
        row = (
            session.execute(
                text(
                    "SELECT t.id AS team_id, t.event_id, t.name AS team_name, u.id AS user_id, u.name AS user_name "
                    "FROM app.users u JOIN app.team_members tm ON tm.user_id = u.id "
                    "JOIN app.teams t ON t.id = tm.team_id WHERE lower(u.email) = 'p1.team1@example.com'"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def _option_challenge(event_id: str, option_key: str) -> str:
    from app.db import app_session

    with app_session() as session:
        return str(
            session.execute(
                text(
                    "SELECT challenge_version_id FROM app.repo_options "
                    "WHERE event_id = CAST(:event AS uuid) AND option_key = :key"
                ),
                {"event": event_id, "key": option_key},
            ).scalar_one()
        )


def _lock_team(organizer: TestClient, team_id: str, option_key: str = "A") -> None:
    response = organizer.post(
        f"/v1/admin/teams/{team_id}/repo-lock",
        json={"option_key": option_key, "reason": "ADM-COVERAGE repository assignment"},
    )
    assert response.status_code == 200, response.text


def test_first_time_admin_repo_lock_assigns_all_levels_and_opens_level_one(client):
    organizer = _staff(client)
    context = _team_context()
    team_id = str(context["team_id"])
    event_id = str(context["event_id"])
    challenge_id = _option_challenge(event_id, "A")
    body = {"option_key": "A", "reason": "ADM-COVERAGE repository assignment"}

    from app.db import app_session

    with app_session() as session:
        choices_before = int(session.execute(text("SELECT count(*) FROM app.team_repo_choices")).scalar_one())
        assignments_before = int(
            session.execute(
                text(
                    "SELECT count(*) FROM app.assignments a JOIN app.stages st ON st.id = a.stage_id "
                    "WHERE st.event_id = CAST(:event AS uuid) AND st.kind = 'level' AND a.team_id = CAST(:team AS uuid)"
                ),
                {"event": event_id, "team": team_id},
            ).scalar_one()
        )
        audit_before = int(
            session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = 'repo.admin_override'")
            ).scalar_one()
        )
    response = organizer.post(f"/v1/admin/teams/{team_id}/repo-lock", json=body)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    reviewer = _staff(client, "reviewer1@example.com")
    response = reviewer.post(f"/v1/admin/teams/{team_id}/repo-lock", json=body)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"

    response = organizer.post("/v1/auth/step-up", json={"password": STAFF_PW})
    assert response.status_code == 200, response.text
    response = organizer.post(
        f"/v1/admin/teams/{team_id}/repo-lock",
        json={"option_key": "Z", "reason": "Unknown option must not persist"},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == {"option_key": "Unknown repository option for this event."}
    with app_session() as session:
        assert int(session.execute(text("SELECT count(*) FROM app.team_repo_choices")).scalar_one()) == choices_before
        assert (
            int(
                session.execute(
                    text(
                        "SELECT count(*) FROM app.assignments a JOIN app.stages st ON st.id = a.stage_id "
                        "WHERE st.event_id = CAST(:event AS uuid) AND st.kind = 'level' AND a.team_id = CAST(:team AS uuid)"
                    ),
                    {"event": event_id, "team": team_id},
                ).scalar_one()
            )
            == assignments_before
        )
        assert (
            int(
                session.execute(
                    text("SELECT count(*) FROM audit.entries WHERE action = 'repo.admin_override'")
                ).scalar_one()
            )
            == audit_before
        )

    response = organizer.post(f"/v1/admin/teams/{team_id}/repo-lock", json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "team_id": team_id, "option": "A"}
    organizer_id = organizer.get("/v1/me").json()["id"]
    with app_session() as session:
        choice = (
            session.execute(
                text(
                    "SELECT event_id, option_key, challenge_version_id, locked_by, lock_source, audit_reason "
                    "FROM app.team_repo_choices WHERE team_id = CAST(:team AS uuid)"
                ),
                {"team": team_id},
            )
            .mappings()
            .one()
        )
        assignments = (
            session.execute(
                text(
                    "SELECT st.ordinal, a.event_id, a.challenge_version_id, a.team_id FROM app.assignments a "
                    "JOIN app.stages st ON st.id = a.stage_id WHERE a.team_id = CAST(:team AS uuid) "
                    "AND st.kind = 'level' ORDER BY st.ordinal"
                ),
                {"team": team_id},
            )
            .mappings()
            .all()
        )
        progress = (
            session.execute(
                text(
                    "SELECT status FROM app.participant_progress pp JOIN app.team_members tm ON tm.user_id = pp.user_id "
                    "WHERE tm.team_id = CAST(:team AS uuid) AND pp.level_no = 1"
                ),
                {"team": team_id},
            )
            .scalars()
            .all()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, details, event_scope FROM audit.entries "
                    "WHERE action = 'repo.admin_override' AND entity_id = :team"
                ),
                {"team": team_id},
            )
            .mappings()
            .one()
        )
    assert str(choice["event_id"]) == event_id
    assert choice["option_key"] == "A"
    assert str(choice["challenge_version_id"]) == challenge_id
    assert str(choice["locked_by"]) == organizer_id
    assert choice["lock_source"] == "admin_override"
    assert choice["audit_reason"] == body["reason"]
    assert [row["ordinal"] for row in assignments] == [1, 2, 3, 4]
    assert {str(row["event_id"]) for row in assignments} == {event_id}
    assert {str(row["challenge_version_id"]) for row in assignments} == {challenge_id}
    assert {str(row["team_id"]) for row in assignments} == {team_id}
    assert set(progress) == {"available"}
    assert str(audit["actor_id"]) == organizer_id and audit["actor_role"] == "organizer"
    assert audit["details"] == {"option": "A", "previous": None, "reason": body["reason"]}
    assert audit["event_scope"] == f"event:{event_id}"


def test_repo_option_upsert_preserves_identity_and_rejects_foreign_challenges(client):
    organizer = _staff(client, step_up=True)
    context = _team_context()
    event_id = str(context["event_id"])

    from app.db import app_session

    with app_session() as session:
        challenges = (
            session.execute(
                text(
                    "SELECT id, slug FROM app.challenge_versions WHERE event_id = CAST(:event AS uuid) ORDER BY slug LIMIT 2"
                ),
                {"event": event_id},
            )
            .mappings()
            .all()
        )
    assert len(challenges) == 2
    first_challenge = str(challenges[0]["id"])
    second_challenge = str(challenges[1]["id"])
    option_key = f"C{uuid.uuid4().hex[:6]}"
    body = {
        "option_key": option_key,
        "label": "Coverage Option",
        "description": "Initial repository option description",
        "challenge_version_id": first_challenge,
    }
    response = organizer.post(f"/v1/admin/events/{event_id}/repo-options", json=body)
    assert response.status_code == 200, response.text
    with app_session() as session:
        created = (
            session.execute(
                text(
                    "SELECT id, label, description, challenge_version_id FROM app.repo_options "
                    "WHERE event_id = CAST(:event AS uuid) AND option_key = :key"
                ),
                {"event": event_id, "key": option_key},
            )
            .mappings()
            .one()
        )
    option_id = str(created["id"])
    assert created["label"] == body["label"]
    assert created["description"] == body["description"]
    assert str(created["challenge_version_id"]) == first_challenge

    updated_body = {
        **body,
        "label": "Updated Coverage Option",
        "description": "Updated repository option description",
        "challenge_version_id": second_challenge,
    }
    response = organizer.post(f"/v1/admin/events/{event_id}/repo-options", json=updated_body)
    assert response.status_code == 200, response.text
    with app_session() as session:
        updated = (
            session.execute(
                text(
                    "SELECT id, label, description, challenge_version_id FROM app.repo_options "
                    "WHERE event_id = CAST(:event AS uuid) AND option_key = :key"
                ),
                {"event": event_id, "key": option_key},
            )
            .mappings()
            .one()
        )
        option_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM app.repo_options WHERE event_id = CAST(:event AS uuid) AND option_key = :key"
                ),
                {"event": event_id, "key": option_key},
            ).scalar_one()
        )
        audits = (
            session.execute(
                text(
                    "SELECT details FROM audit.entries WHERE action = 'repo_option.configured' "
                    "AND entity_id = :event ORDER BY seq"
                ),
                {"event": event_id},
            )
            .mappings()
            .all()
        )
    assert str(updated["id"]) == option_id
    assert updated["label"] == updated_body["label"]
    assert updated["description"] == updated_body["description"]
    assert str(updated["challenge_version_id"]) == second_challenge
    assert option_count == 1
    assert [row["details"]["challenge_version_id"] for row in audits] == [first_challenge, second_challenge]

    foreign_event_id = _create_event(organizer)
    response = organizer.post(
        f"/v1/admin/events/{foreign_event_id}/challenges",
        json={"slug": "foreign-option-challenge", "title": "Foreign Option Challenge"},
    )
    assert response.status_code == 201, response.text
    foreign_challenge_id = response.json()["challenge_id"]
    response = organizer.post(
        f"/v1/admin/events/{event_id}/repo-options",
        json={**updated_body, "challenge_version_id": foreign_challenge_id},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == {"challenge_version_id": "Unknown challenge version for this event."}
    with app_session() as session:
        unchanged = (
            session.execute(
                text(
                    "SELECT label, description, challenge_version_id FROM app.repo_options "
                    "WHERE event_id = CAST(:event AS uuid) AND option_key = :key"
                ),
                {"event": event_id, "key": option_key},
            )
            .mappings()
            .one()
        )
        audit_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM audit.entries WHERE action = 'repo_option.configured' AND entity_id = :event"
                ),
                {"event": event_id},
            ).scalar_one()
        )
    assert unchanged["label"] == updated_body["label"]
    assert unchanged["description"] == updated_body["description"]
    assert str(unchanged["challenge_version_id"]) == second_challenge
    assert audit_count == 2

    unknown_event_id = str(uuid.uuid4())
    response = organizer.post(f"/v1/admin/events/{unknown_event_id}/repo-options", json=updated_body)
    assert response.status_code == 404, response.text


def test_progress_view_combines_repo_choice_roster_and_server_owned_progress(client):
    organizer = _staff(client, step_up=True)
    context = _team_context()
    team_id = str(context["team_id"])
    event_id = str(context["event_id"])
    _lock_team(organizer, team_id)
    participant = participant_client(client, "p1.team1@example.com")
    me = participant.get("/v1/me").json()

    response = organizer.get(f"/v1/admin/events/{event_id}/progress")
    assert response.status_code == 200, response.text
    progress = response.json()
    assert progress["event_id"] == event_id and progress["level_count"] == 4
    assert len(progress["teams"]) == 2
    team = next(row for row in progress["teams"] if row["team_id"] == team_id)
    assert team["team_name"] == context["team_name"]
    assert team["repo_option"] == "A" and team["lock_source"] == "admin_override"
    assert len(team["members"]) == 4
    for member in team["members"]:
        assert member["pointer"] == {"level_no": 1, "node": "explain"}
        assert member["levels"] == {"1": "available", "2": "locked", "3": "locked", "4": "locked"}
    other_team = next(row for row in progress["teams"] if row["team_id"] != team_id)
    assert other_team["repo_option"] is None and other_team["lock_source"] is None
    assert all(member["levels"]["1"] == "locked" for member in other_team["members"])

    workspace = participant.get("/v1/levels/1/workspace")
    assert workspace.status_code == 200, workspace.text
    submitted = participant.post(
        "/v1/levels/1/submit",
        json={"flags": [], "confirm_empty": True},
        headers={"Idempotency-Key": f"progress-{uuid.uuid4()}"},
    )
    assert submitted.status_code == 202, submitted.text

    response = organizer.get(f"/v1/admin/events/{event_id}/progress")
    assert response.status_code == 200, response.text
    team = next(row for row in response.json()["teams"] if row["team_id"] == team_id)
    member = next(row for row in team["members"] if row["name"] == me["name"])
    assert member["pointer"] == {"level_no": 2, "node": "explain"}
    assert member["levels"] == {"1": "submitted", "2": "locked", "3": "locked", "4": "locked"}
    assert all(row["levels"]["1"] == "available" for row in team["members"] if row["name"] != me["name"])


def test_manual_auto_submit_trigger_enqueues_and_worker_applies_server_side(client):
    event_id = go_live(client)
    organizer = _staff(client, step_up=True)
    context = _team_context()
    team_id = str(context["team_id"])
    _lock_team(organizer, team_id)

    from app.db import app_session

    with app_session() as session:
        level_one = str(
            session.execute(
                text(
                    "SELECT id FROM app.stages WHERE event_id = CAST(:event AS uuid) AND kind = 'level' AND ordinal = 1"
                ),
                {"event": event_id},
            ).scalar_one()
        )
        session.execute(
            text(
                "UPDATE app.stages SET ends_at = clock_timestamp() - interval '10 minutes' "
                "WHERE id = CAST(:stage AS uuid)"
            ),
            {"stage": level_one},
        )
        other_team_id = str(
            session.execute(
                text(
                    "SELECT id FROM app.teams WHERE event_id = CAST(:event AS uuid) AND id <> CAST(:team AS uuid) LIMIT 1"
                ),
                {"event": event_id, "team": team_id},
            ).scalar_one()
        )
    response = organizer.post("/v1/admin/jobs/auto-submit")
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]
    with app_session() as session:
        queued = (
            session.execute(
                text("SELECT kind, payload, status FROM app.jobs WHERE id = CAST(:job AS uuid)"), {"job": job_id}
            )
            .mappings()
            .one()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, entity_type, entity_id FROM audit.entries "
                    "WHERE action = 'auto_submit.triggered' AND entity_id = :job"
                ),
                {"job": job_id},
            )
            .mappings()
            .one()
        )
    assert queued["kind"] == "auto_submit_levels"
    assert queued["payload"] == {"trigger": "manual"} and queued["status"] == "queued"
    assert audit["entity_type"] == "job" and audit["entity_id"] == job_id
    assert str(audit["actor_id"]) == organizer.get("/v1/me").json()["id"]

    worker_drain()
    with app_session() as session:
        completed = (
            session.execute(
                text("SELECT status, attempts FROM app.jobs WHERE id = CAST(:job AS uuid)"), {"job": job_id}
            )
            .mappings()
            .one()
        )
        locked_team_statuses = (
            session.execute(
                text(
                    "SELECT status FROM app.participant_progress pp JOIN app.team_members tm ON tm.user_id = pp.user_id "
                    "WHERE tm.team_id = CAST(:team AS uuid) AND pp.level_no = 1"
                ),
                {"team": team_id},
            )
            .scalars()
            .all()
        )
        unlocked_team_statuses = (
            session.execute(
                text(
                    "SELECT status FROM app.participant_progress pp JOIN app.team_members tm ON tm.user_id = pp.user_id "
                    "WHERE tm.team_id = CAST(:team AS uuid) AND pp.level_no = 1"
                ),
                {"team": other_team_id},
            )
            .scalars()
            .all()
        )
        submissions = (
            session.execute(
                text(
                    "SELECT id, payload FROM app.submissions WHERE stage_id = CAST(:stage AS uuid) AND team_id = CAST(:team AS uuid)"
                ),
                {"stage": level_one, "team": team_id},
            )
            .mappings()
            .all()
        )
        other_submissions = int(
            session.execute(
                text(
                    "SELECT count(*) FROM app.submissions WHERE stage_id = CAST(:stage AS uuid) AND team_id = CAST(:team AS uuid)"
                ),
                {"stage": level_one, "team": other_team_id},
            ).scalar_one()
        )
    assert completed["status"] == "done" and completed["attempts"] == 1
    assert len(locked_team_statuses) == 4 and set(locked_team_statuses) == {"auto_submitted"}
    assert len(unlocked_team_statuses) == 5 and set(unlocked_team_statuses) == {"missed"}
    assert len(submissions) == 4
    assert all(row["payload"]["auto"] is True for row in submissions)
    assert other_submissions == 0


def test_level_bootstrap_creates_four_draft_stages_once_and_rejects_unknown_event(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    response = organizer.post(f"/v1/admin/events/{event_id}/levels/bootstrap")
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "created": 4}

    from app.db import app_session

    with app_session() as session:
        stages = (
            session.execute(
                text(
                    "SELECT id, name, kind, ordinal, status, grace_seconds, config, starts_at, ends_at "
                    "FROM app.stages WHERE event_id = CAST(:event AS uuid) ORDER BY ordinal"
                ),
                {"event": event_id},
            )
            .mappings()
            .all()
        )
        audit = (
            session.execute(
                text(
                    "SELECT details, event_scope FROM audit.entries WHERE action = 'levels.bootstrapped' "
                    "AND entity_id = :event"
                ),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
    assert [row["ordinal"] for row in stages] == [1, 2, 3, 4]
    assert [row["name"] for row in stages] == [
        "Level 1: Find the Bugs",
        "Level 2: Trace the Cross-File Defect",
        "Level 3: Repair and Side Quest",
        "Level 4: Tests and Documentation",
    ]
    assert {row["kind"] for row in stages} == {"level"}
    assert {row["status"] for row in stages} == {"draft"}
    assert {row["grace_seconds"] for row in stages} == {3}
    assert all(row["config"] == {} for row in stages)
    assert all(row["starts_at"] is None and row["ends_at"] is None for row in stages)
    assert audit["details"] == {"created": 4}
    assert audit["event_scope"] == f"event:{event_id}"
    stage_ids = [str(row["id"]) for row in stages]

    response = organizer.post(f"/v1/admin/events/{event_id}/levels/bootstrap")
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "created": 0}
    with app_session() as session:
        repeated_ids = [
            str(row[0])
            for row in session.execute(
                text("SELECT id FROM app.stages WHERE event_id = CAST(:event AS uuid) ORDER BY ordinal"),
                {"event": event_id},
            ).all()
        ]
        audits = (
            session.execute(
                text(
                    "SELECT details FROM audit.entries WHERE action = 'levels.bootstrapped' AND entity_id = :event ORDER BY seq"
                ),
                {"event": event_id},
            )
            .scalars()
            .all()
        )
    assert repeated_ids == stage_ids
    assert [row["created"] for row in audits] == [4, 0]

    unknown_event_id = str(uuid.uuid4())
    response = organizer.post(f"/v1/admin/events/{unknown_event_id}/levels/bootstrap")
    assert response.status_code == 404, response.text
    with app_session() as session:
        assert (
            int(
                session.execute(
                    text(
                        "SELECT count(*) FROM audit.entries WHERE action = 'levels.bootstrapped' AND entity_id = :event"
                    ),
                    {"event": event_id},
                ).scalar_one()
            )
            == 2
        )
