"""Server-owned level progression and gate boundaries."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app import flow
from app.db import app_session
from app.errors import ApiError
from sqlalchemy import text


@pytest.fixture()
def flow_case(seeded_db):
    with app_session() as session:
        row = (
            session.execute(
                text(
                    "SELECT u.id AS user_id, u.tenant_id, t.id AS team_id, t.event_id "
                    "FROM app.users u JOIN app.team_members tm ON tm.user_id = u.id "
                    "JOIN app.teams t ON t.id = tm.team_id WHERE u.email = 'p1.team1@example.com'"
                )
            )
            .mappings()
            .one()
        )
    return {key: str(value) for key, value in row.items()}


def _lock_repo(session, case: dict) -> None:
    session.execute(
        text(
            "INSERT INTO app.team_repo_choices "
            "(id, event_id, team_id, option_key, challenge_version_id, locked_by, lock_source) "
            "SELECT CAST(:id AS uuid), CAST(:event AS uuid), CAST(:team AS uuid), 'A', cv.id, "
            "CAST(:user AS uuid), 'admin_override' FROM app.challenge_versions cv "
            "WHERE cv.event_id = CAST(:event AS uuid) AND cv.slug = 'papyrus'"
        ),
        {"id": str(uuid.uuid4()), "event": case["event_id"], "team": case["team_id"], "user": case["user_id"]},
    )


def test_node_order_and_next_position_cover_the_flow_boundaries():
    assert flow.node_key(1, "explain") < flow.node_key(1, "exec") < flow.node_key(1, "done")
    assert flow.node_key(1, "done") < flow.node_key(2, "explain")
    assert flow.next_position(1, "explain") == (1, "exec")
    assert flow.next_position(1, "exec") == (2, "explain")
    assert flow.next_position(4, "exec") == (4, "done")
    assert flow.next_position(4, "done") is None
    flow.assert_forward((1, "explain"), (1, "explain"))
    flow.assert_forward((1, "explain"), (4, "done"))
    with pytest.raises(ApiError) as raised:
        flow.assert_forward((2, "explain"), (1, "done"))
    assert raised.value.code == "LEVEL_ALREADY_SUBMITTED"
    assert raised.value.status == 409


def test_init_participant_flow_is_idempotent_and_creates_locked_levels(flow_case):
    with app_session() as session:
        session.execute(
            text("DELETE FROM app.participant_progress WHERE user_id = CAST(:user AS uuid)"),
            {"user": flow_case["user_id"]},
        )
        session.execute(
            text("DELETE FROM app.participant_pointers WHERE user_id = CAST(:user AS uuid)"),
            {"user": flow_case["user_id"]},
        )

    with app_session() as session:
        first = flow.init_participant_flow(session, flow_case["event_id"], flow_case["user_id"])
    with app_session() as session:
        second = flow.init_participant_flow(session, flow_case["event_id"], flow_case["user_id"])
        progress = flow.get_all_progress(session, flow_case["user_id"])

    assert first == second
    assert first["level_no"] == 1
    assert first["node"] == "explain"
    assert [row["level_no"] for row in progress] == [1, 2, 3, 4]
    assert all(row["status"] == "locked" for row in progress)


def test_backwards_pointer_move_rolls_back_the_entire_transaction(flow_case):
    with pytest.raises(ApiError) as raised:
        with app_session() as session:
            original = flow.get_pointer(session, flow_case["user_id"])
            assert original is not None
            flow.advance_pointer(session, flow_case["user_id"], 1, "exec")
            flow.advance_pointer(session, flow_case["user_id"], 1, "explain")
    assert raised.value.code == "LEVEL_ALREADY_SUBMITTED"

    with app_session() as session:
        persisted = flow.get_pointer(session, flow_case["user_id"])
    assert persisted is not None
    assert persisted["level_no"] == original["level_no"] == 1
    assert persisted["node"] == original["node"] == "explain"
    assert persisted["updated_at"] == original["updated_at"]

    with app_session() as session:
        moved = flow.advance_pointer(session, flow_case["user_id"], 1, "exec")
        same_position = flow.advance_pointer(session, flow_case["user_id"], 1, "exec")
    assert moved == same_position == {"level_no": 1, "node": "exec"}


def test_level_status_rejects_unknown_values_and_recreates_missing_progress(flow_case):
    with app_session() as session:
        before = flow.get_all_progress(session, flow_case["user_id"])
        with pytest.raises(ApiError) as raised:
            flow.set_level_status(session, flow_case["user_id"], 1, "invented")
    assert raised.value.code == "VALIDATION_ERROR"
    assert raised.value.details == {"status": "Unknown level status."}
    with app_session() as session:
        assert flow.get_all_progress(session, flow_case["user_id"]) == before
        session.execute(
            text("DELETE FROM app.participant_progress WHERE user_id = CAST(:user AS uuid) AND level_no = 3"),
            {"user": flow_case["user_id"]},
        )

    submitted_at = datetime(2026, 11, 28, 12, 0, tzinfo=UTC)
    with app_session() as session:
        flow.set_level_status(
            session,
            flow_case["user_id"],
            3,
            "in_progress",
            submitted_at=submitted_at,
        )

    with app_session() as session:
        rows = flow.get_all_progress(session, flow_case["user_id"])
    recreated = next(row for row in rows if row["level_no"] == 3)
    assert recreated["status"] == "in_progress"
    assert recreated["submission_id"] is None
    assert recreated["submitted_at"] == submitted_at


def test_gate_combines_global_and_user_adjustments_at_the_exact_boundary(flow_case):
    now = datetime(2026, 11, 28, 12, 0, tzinfo=UTC)
    with app_session() as session:
        stage_id = session.execute(
            text("SELECT id FROM app.stages WHERE event_id = CAST(:event AS uuid) AND kind = 'level' AND ordinal = 1"),
            {"event": flow_case["event_id"]},
        ).scalar_one()
        organizer_id = session.execute(text("SELECT id FROM app.users WHERE role = 'organizer' LIMIT 1")).scalar_one()
        session.execute(
            text(
                "UPDATE app.stages SET status = 'active', starts_at = :start, ends_at = :end, grace_seconds = 0 "
                "WHERE id = CAST(:stage AS uuid)"
            ),
            {"stage": stage_id, "start": now - timedelta(hours=1), "end": now},
        )
        _lock_repo(session, flow_case)
        for user_id, delta in [(None, 60), (flow_case["user_id"], 30)]:
            session.execute(
                text(
                    "INSERT INTO app.time_adjustments "
                    "(id, stage_id, user_id, delta_seconds, reason_code, created_by) "
                    "VALUES (CAST(:id AS uuid), CAST(:stage AS uuid), CAST(:user AS uuid), :delta, 'TEST_TIME', CAST(:actor AS uuid))"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "stage": stage_id,
                    "user": user_id,
                    "delta": delta,
                    "actor": organizer_id,
                },
            )

    with app_session() as session:
        before = flow.compute_gate(
            session, flow_case["event_id"], flow_case["user_id"], flow_case["team_id"], 1, now + timedelta(seconds=89)
        )
        exact = flow.compute_gate(
            session, flow_case["event_id"], flow_case["user_id"], flow_case["team_id"], 1, now + timedelta(seconds=90)
        )
        after = flow.compute_gate(
            session,
            flow_case["event_id"],
            flow_case["user_id"],
            flow_case["team_id"],
            1,
            now + timedelta(seconds=90, microseconds=1),
        )

    assert before["allowed"] is True
    assert exact["allowed"] is True
    assert after["allowed"] is False
    assert after["reason"] == "The level window has closed."
    assert after["stage_status"] == "active"


def test_team_gate_waits_for_every_teammate_and_does_not_treat_missed_as_done(flow_case):
    now = datetime(2026, 11, 28, 12, 0, tzinfo=UTC)
    with app_session() as session:
        members = (
            session.execute(
                text(
                    "SELECT tm.user_id, u.name FROM app.team_members tm JOIN app.users u ON u.id = tm.user_id "
                    "WHERE tm.team_id = CAST(:team AS uuid) ORDER BY u.name"
                ),
                {"team": flow_case["team_id"]},
            )
            .mappings()
            .all()
        )
        session.execute(
            text(
                "UPDATE app.stages SET status = 'active', starts_at = :start, ends_at = :end "
                "WHERE event_id = CAST(:event AS uuid) AND kind = 'level' AND ordinal = 2"
            ),
            {"event": flow_case["event_id"], "start": now - timedelta(hours=1), "end": now + timedelta(hours=1)},
        )
        for index, member in enumerate(members):
            status = "submitted" if index % 2 == 0 else "auto_submitted"
            if index == len(members) - 1:
                status = "in_progress"
            session.execute(
                text(
                    "UPDATE app.participant_progress SET status = :status "
                    "WHERE user_id = CAST(:user AS uuid) AND level_no = 1"
                ),
                {"status": status, "user": member["user_id"]},
            )

    with app_session() as session:
        blocked = flow.compute_gate(session, flow_case["event_id"], flow_case["user_id"], flow_case["team_id"], 2, now)
    assert blocked["allowed"] is False
    assert blocked["waiting_on"] == [{"name": members[-1]["name"], "status": "in_progress"}]

    with app_session() as session:
        session.execute(
            text(
                "UPDATE app.participant_progress SET status = 'submitted' "
                "WHERE user_id = CAST(:user AS uuid) AND level_no = 1"
            ),
            {"user": members[-1]["user_id"]},
        )
    with app_session() as session:
        complete = flow.compute_gate(session, flow_case["event_id"], flow_case["user_id"], flow_case["team_id"], 2, now)
    assert complete["allowed"] is True

    with app_session() as session:
        session.execute(
            text(
                "UPDATE app.participant_progress SET status = 'missed' "
                "WHERE user_id = CAST(:user AS uuid) AND level_no = 1"
            ),
            {"user": members[-1]["user_id"]},
        )
    with app_session() as session:
        missed = flow.compute_gate(session, flow_case["event_id"], flow_case["user_id"], flow_case["team_id"], 2, now)
    assert missed["allowed"] is False
    assert missed["waiting_on"] == [{"name": members[-1]["name"], "status": "missed"}]


def test_teammate_view_and_lead_check_use_persisted_flow_state(flow_case):
    with app_session() as session:
        flow.set_level_status(session, flow_case["user_id"], 1, "auto_submitted")
        flow.advance_pointer(session, flow_case["user_id"], 2, "explain")
        roster = flow.teammate_view(session, flow_case["team_id"])
        lead = flow.is_team_lead(session, flow_case["team_id"], flow_case["user_id"])

    assert lead is True
    assert len(roster) == 4
    assert [row["name"] for row in roster] == sorted(row["name"] for row in roster)
    current = next(row for row in roster if row["id"] == uuid.UUID(flow_case["user_id"]))
    assert current["l1"] == "auto_submitted"
    assert current["pointer_level"] == 2
    assert current["pointer_node"] == "explain"
