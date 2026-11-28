"""Leaderboard visibility contracts and penalty-free participant result aggregates."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.db import app_session
from conftest import login, participant_client
from fastapi.testclient import TestClient
from sqlalchemy import text

RESULT_ENTRY_KEYS = {
    "component",
    "kind",
    "points",
    "reason_code",
    "title",
    "receipt_code",
    "matched_bug_code",
    "received_at",
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
                    "SELECT st.id, st.event_id, st.status, st.config, e.tenant_id "
                    "FROM app.stages st JOIN app.events e ON e.id = st.event_id WHERE st.kind = 'main' LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def _set_stage(stage_id: str, *, status: str, config: dict) -> None:
    with app_session() as s:
        s.execute(
            text(
                "UPDATE app.stages SET status = :status, config = CAST(:config AS jsonb) WHERE id = CAST(:stage AS uuid)"
            ),
            {"status": status, "config": json.dumps(config), "stage": stage_id},
        )


def _insert_snapshot(
    stage: dict,
    version: int,
    payload: dict,
    *,
    visibility: str,
    created_at: datetime,
) -> None:
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.leaderboard_snapshots "
                "(id, event_id, stage_id, version, payload, visibility, created_at) VALUES "
                "(CAST(:id AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), :version, CAST(:payload AS jsonb), "
                ":visibility, :created_at)"
            ),
            {
                "id": str(uuid.uuid4()),
                "event": str(stage["event_id"]),
                "stage": str(stage["id"]),
                "version": version,
                "payload": json.dumps(payload),
                "visibility": visibility,
                "created_at": created_at,
            },
        )


def _insert_submission(
    stage: dict,
    email: str,
    *,
    status: str,
    feedback_released: bool,
    matched_bug_code: str | None,
    points_visible: float,
    received_at: datetime,
) -> dict:
    with app_session() as s:
        context = (
            s.execute(
                text(
                    "SELECT u.id AS user_id, tm.team_id, t.event_id, e.tenant_id, cv.id AS challenge_id "
                    "FROM app.users u JOIN app.team_members tm ON tm.user_id = u.id "
                    "JOIN app.teams t ON t.id = tm.team_id JOIN app.events e ON e.id = t.event_id "
                    "JOIN app.assignments a ON a.stage_id = CAST(:stage AS uuid) "
                    "JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                    "WHERE u.email = :email LIMIT 1"
                ),
                {"stage": str(stage["id"]), "email": email},
            )
            .mappings()
            .one()
        )
        submission_id = str(uuid.uuid4())
        receipt = f"R-{submission_id[:12]}"
        title = f"Result fixture {submission_id[:8]}"
        payload = {"description": "Synthetic released result fixture."}
        s.execute(
            text(
                "INSERT INTO app.submissions "
                "(id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                "idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, line_start, "
                "line_end, category, received_at, feedback_released, matched_bug_code, points_visible) VALUES "
                "(CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:challenge AS uuid), CAST(:team AS uuid), CAST(:author AS uuid), 'bug_report', :key, "
                "CAST(:payload AS jsonb), :hash, :status, :receipt, :title, 'db.js', 1, 3, 'logic', :received, "
                ":released, :matched, :points)"
            ),
            {
                "id": submission_id,
                "tenant": str(context["tenant_id"]),
                "event": str(context["event_id"]),
                "stage": str(stage["id"]),
                "challenge": str(context["challenge_id"]),
                "team": str(context["team_id"]),
                "author": str(context["user_id"]),
                "key": f"result-{submission_id}",
                "payload": json.dumps(payload),
                "hash": uuid.uuid4().hex,
                "status": status,
                "receipt": receipt,
                "title": title,
                "received": received_at,
                "released": feedback_released,
                "matched": matched_bug_code,
                "points": points_visible,
            },
        )
    return {
        "id": submission_id,
        "team_id": str(context["team_id"]),
        "receipt_code": receipt,
        "title": title,
        "received_at": received_at.isoformat(),
        "matched_bug_code": matched_bug_code,
        "payload": payload,
    }


def _insert_ledger(
    stage: dict,
    team_id: str,
    submission_id: str | None,
    *,
    component: str,
    kind: str,
    points: float,
    reason_code: str,
    created_at: datetime,
    stage_id: str | None = None,
) -> None:
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.score_ledger_entries "
                "(id, tenant_id, event_id, stage_id, team_id, submission_id, component, kind, points, "
                "reason_code, created_at) VALUES "
                "(CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:team AS uuid), CAST(:submission AS uuid), :component, :kind, :points, :reason, :created)"
            ),
            {
                "id": str(uuid.uuid4()),
                "tenant": str(stage["tenant_id"]),
                "event": str(stage["event_id"]),
                "stage": stage_id or str(stage["id"]),
                "team": team_id,
                "submission": submission_id,
                "component": component,
                "kind": kind,
                "points": points,
                "reason": reason_code,
                "created": created_at,
            },
        )


def test_hidden_leaderboard_denies_participants_but_allows_staff(client):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="active", config={"leaderboard_mode": "hidden"})
    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    payload = {"rows": [{"team_id": "team-lambda", "total": 100.0}], "stage_id": str(stage["id"])}
    _insert_snapshot(stage, 1, payload, visibility="hidden", created_at=created_at)
    participant = participant_client(client, "p1.team1@example.com")
    reviewer = _authenticated_client(client, "reviewer1@example.com")

    denied = participant.get(f"/v1/leaderboard/{stage['id']}")
    assert denied.status_code == 200
    assert denied.json() == {"visible": False, "message": "The leaderboard is hidden for this round."}
    assert "snapshot" not in denied.json()

    staff = reviewer.get(f"/v1/leaderboard/{stage['id']}")
    assert staff.status_code == 200
    assert staff.json() == {
        "visible": True,
        "version": 1,
        "snapshot": payload,
        "generated_at": created_at.isoformat(),
    }


def test_released_round_publishes_hidden_mode_snapshot_to_participant(client):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="released", config={"leaderboard_mode": "hidden"})
    created_at = datetime(2026, 1, 2, tzinfo=UTC)
    payload = {"rows": [{"team_id": "team-lambda", "total": 115.0}], "visibility": "public"}
    _insert_snapshot(stage, 7, payload, visibility="public", created_at=created_at)
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/leaderboard/{stage['id']}")
    assert response.status_code == 200
    assert response.json() == {
        "visible": True,
        "version": 7,
        "snapshot": payload,
        "generated_at": created_at.isoformat(),
    }


def test_frozen_leaderboard_uses_latest_snapshot_older_than_delay(client):
    stage = _main_stage()
    _set_stage(
        str(stage["id"]),
        status="active",
        config={"leaderboard_mode": "frozen", "leaderboard_delay_s": 3600},
    )
    now = datetime.now(UTC)
    snapshots = {
        1: (now - timedelta(hours=3), {"rows": [{"version": 1}]}),
        2: (now - timedelta(hours=2), {"rows": [{"version": 2}]}),
        3: (now - timedelta(minutes=30), {"rows": [{"version": 3}]}),
    }
    for version, (created_at, payload) in snapshots.items():
        _insert_snapshot(stage, version, payload, visibility="public", created_at=created_at)
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/leaderboard/{stage['id']}")
    assert response.status_code == 200
    assert response.json() == {
        "visible": True,
        "version": 2,
        "snapshot": snapshots[2][1],
        "generated_at": snapshots[2][0].isoformat(),
    }


def test_live_leaderboard_uses_latest_snapshot_regardless_of_age(client):
    stage = _main_stage()
    _set_stage(
        str(stage["id"]),
        status="active",
        config={"leaderboard_mode": "live", "leaderboard_delay_s": 3600},
    )
    old = datetime(2026, 1, 1, tzinfo=UTC)
    recent = datetime(2026, 1, 2, tzinfo=UTC)
    _insert_snapshot(stage, 1, {"rows": [{"version": 1}]}, visibility="public", created_at=old)
    _insert_snapshot(stage, 2, {"rows": [{"version": 2}]}, visibility="public", created_at=recent)
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/leaderboard/{stage['id']}")
    assert response.status_code == 200
    assert response.json() == {
        "visible": True,
        "version": 2,
        "snapshot": {"rows": [{"version": 2}]},
        "generated_at": recent.isoformat(),
    }


def test_visible_leaderboard_without_snapshot_has_explicit_empty_state(client):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="active", config={"leaderboard_mode": "live"})
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/leaderboard/{stage['id']}")
    assert response.status_code == 200
    assert response.json() == {"visible": True, "snapshot": None, "message": "No results published yet."}


def test_unknown_leaderboard_stage_returns_generic_not_found(client):
    participant = participant_client(client, "p1.team1@example.com")
    response = participant.get(f"/v1/leaderboard/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_results_are_hidden_before_feedback_release(client):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="active", config={"leaderboard_mode": "hidden"})
    _insert_submission(
        stage,
        "p1.team1@example.com",
        status="matched_auto",
        feedback_released=False,
        matched_bug_code="PRIVATE-VERDICT-SENTINEL",
        points_visible=987.65,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/results/{stage['id']}")
    assert response.status_code == 200
    assert response.json() == {"released": False, "message": "Results are not released yet."}
    assert "PRIVATE-VERDICT-SENTINEL" not in response.text
    assert "987.65" not in response.text


def test_results_aggregate_only_the_callers_team_and_stage_without_penalties(client):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="released", config={"leaderboard_mode": "live"})
    received = datetime(2026, 1, 1, tzinfo=UTC)
    first = _insert_submission(
        stage,
        "p1.team1@example.com",
        status="decided",
        feedback_released=True,
        matched_bug_code="RELEASED-BUG-ONE",
        points_visible=50.0,
        received_at=received,
    )
    teammate = _insert_submission(
        stage,
        "p2.team1@example.com",
        status="matched_auto",
        feedback_released=True,
        matched_bug_code="RELEASED-BUG-TWO",
        points_visible=40.0,
        received_at=received + timedelta(seconds=1),
    )
    foreign = _insert_submission(
        stage,
        "p1.team2@example.com",
        status="decided",
        feedback_released=True,
        matched_bug_code="RELEASED-FOREIGN-BUG",
        points_visible=999.0,
        received_at=received + timedelta(seconds=2),
    )
    entries = [
        (first, "functional_test", "award", 50.0, "FUNCTIONAL_ACCEPTED"),
        (teammate, "code_review", "award", 30.0, "REVIEW_ACCEPTED"),
        (first, "evidence_report", "award", 20.0, "EVIDENCE_ACCEPTED"),
        (teammate, "ctf_bonus", "bonus", 10.0, "CTF_BONUS"),
        (first, "adjustment", "adjustment", 5.0, "MANUAL_ADJUSTMENT"),
    ]
    ledger_time = datetime(2026, 1, 2, tzinfo=UTC)
    for index, (submission, component, kind, points, reason) in enumerate(entries):
        _insert_ledger(
            stage,
            submission["team_id"],
            submission["id"],
            component=component,
            kind=kind,
            points=points,
            reason_code=reason,
            created_at=ledger_time + timedelta(seconds=index),
        )
    _insert_ledger(
        stage,
        foreign["team_id"],
        foreign["id"],
        component="functional_test",
        kind="award",
        points=999.0,
        reason_code="FOREIGN_TEAM_AWARD",
        created_at=ledger_time,
    )
    with app_session() as s:
        other_stage_id = s.execute(
            text("SELECT id FROM app.stages WHERE kind = 'level' ORDER BY ordinal LIMIT 1")
        ).scalar_one()
    _insert_ledger(
        stage,
        first["team_id"],
        None,
        component="functional_test",
        kind="award",
        points=1000.0,
        reason_code="OTHER_STAGE_AWARD",
        created_at=ledger_time,
        stage_id=str(other_stage_id),
    )
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/results/{stage['id']}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"released", "total", "by_component", "penalties", "entries"}
    assert body["released"] is True
    assert body["total"] == 115.0
    assert body["penalties"] == 0.0
    assert body["by_component"] == {
        "functional_test": 50.0,
        "code_review": 30.0,
        "evidence_report": 20.0,
        "ctf_bonus": 10.0,
        "adjustment": 5.0,
    }
    expected_entries = []
    for submission, component, kind, points, reason in entries:
        expected_entries.append(
            {
                "component": component,
                "kind": kind,
                "points": points,
                "reason_code": reason,
                "title": submission["title"],
                "receipt_code": submission["receipt_code"],
                "matched_bug_code": submission["matched_bug_code"],
                "received_at": submission["received_at"],
            }
        )
    assert body["entries"] == expected_entries
    assert all(set(item) == RESULT_ENTRY_KEYS for item in body["entries"])
    assert "RELEASED-FOREIGN-BUG" not in response.text
    assert "OTHER_STAGE_AWARD" not in response.text


def test_results_count_each_penalty_exactly_once(client):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="released", config={"leaderboard_mode": "hidden"})
    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    fixture = _insert_submission(
        stage,
        "p1.team1@example.com",
        status="rejected_auto",
        feedback_released=True,
        matched_bug_code=None,
        points_visible=0,
        received_at=created_at,
    )
    _insert_ledger(
        stage,
        fixture["team_id"],
        fixture["id"],
        component="ctf_bonus",
        kind="bonus",
        points=60,
        reason_code="FLAG_VERIFIED",
        created_at=created_at,
    )
    _insert_ledger(
        stage,
        fixture["team_id"],
        fixture["id"],
        component="penalty",
        kind="penalty",
        points=-20,
        reason_code="INVALID_REPORT_PENALTY",
        created_at=created_at,
    )
    participant = participant_client(client, "p1.team1@example.com")

    response = participant.get(f"/v1/results/{stage['id']}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 40.0
    assert body["penalties"] == -20.0
    assert body["by_component"] == {"ctf_bonus": 60.0, "penalty": -20.0}
    assert sum(entry["points"] for entry in body["entries"]) == body["total"]


def test_results_reject_staff_role(client):
    stage = _main_stage()
    reviewer = _authenticated_client(client, "reviewer1@example.com")
    response = reviewer.get(f"/v1/results/{stage['id']}")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


@pytest.mark.parametrize("email", ["p1.team1@example.com", "p1.team2@example.com"])
def test_results_use_ledger_rows_not_submission_point_metadata(client, email):
    stage = _main_stage()
    _set_stage(str(stage["id"]), status="released", config={"leaderboard_mode": "live"})
    _insert_submission(
        stage,
        email,
        status="decided",
        feedback_released=True,
        matched_bug_code=f"RELEASED-{email}",
        points_visible=1.0,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    participant = participant_client(client, email)
    response = participant.get(f"/v1/results/{stage['id']}")
    assert response.status_code == 200
    assert response.json() == {
        "released": True,
        "total": 0.0,
        "by_component": {},
        "penalties": 0.0,
        "entries": [],
    }
