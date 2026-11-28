"""Transactional deadline submission paths with persisted receipts and progress."""

from __future__ import annotations

import json
import uuid

import pytest
from app import auto_submit, security
from app.db import app_session
from sqlalchemy import text


@pytest.fixture()
def auto_case(seeded_db):
    with app_session() as session:
        member = (
            session.execute(
                text(
                    "SELECT tm.team_id, t.event_id, e.tenant_id, u.id AS user_id "
                    "FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.events e ON e.id = t.event_id JOIN app.users u ON u.id = tm.user_id "
                    "WHERE u.email = 'p1.team1@example.com'"
                )
            )
            .mappings()
            .one()
        )
    return {key: str(value) for key, value in member.items()}


def _prepare_level(case: dict, level_no: int, *, lock: bool, draft: dict | None = None) -> dict:
    with app_session() as session:
        stage = dict(
            session.execute(
                text(
                    "SELECT id, event_id, ordinal, ends_at, grace_seconds, config, status "
                    "FROM app.stages WHERE event_id = CAST(:event AS uuid) AND kind = 'level' AND ordinal = :level"
                ),
                {"event": case["event_id"], "level": level_no},
            )
            .mappings()
            .one()
        )
        session.execute(
            text("UPDATE app.events SET status = 'live' WHERE id = CAST(:event AS uuid)"), {"event": case["event_id"]}
        )
        session.execute(
            text(
                "UPDATE app.participant_pointers SET level_no = :level, node = 'explain' "
                "WHERE user_id = CAST(:user AS uuid)"
            ),
            {"level": level_no, "user": case["user_id"]},
        )
        session.execute(
            text(
                "UPDATE app.participant_progress SET status = CASE "
                "WHEN level_no = :level THEN 'in_progress' "
                "WHEN level_no < :level THEN 'submitted' ELSE 'locked' END, "
                "submission_id = NULL, submitted_at = NULL WHERE user_id = CAST(:user AS uuid)"
            ),
            {"level": level_no, "user": case["user_id"]},
        )
        if lock:
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
        if draft is not None:
            session.execute(
                text(
                    "INSERT INTO app.level_drafts (id, author_id, event_id, level_no, payload) "
                    "VALUES (CAST(:id AS uuid), CAST(:user AS uuid), CAST(:event AS uuid), :level, CAST(:payload AS jsonb))"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "user": case["user_id"],
                    "event": case["event_id"],
                    "level": level_no,
                    "payload": json.dumps(draft),
                },
            )
    return stage


def _valid_draft() -> dict:
    return {
        "flags": [
            {
                "title": "Deadline report for the wrong row",
                "category": "logic",
                "description": "The handler uses the account identifier where the note identifier is required.",
                "evidence": "The request changed a different note than the one named in the URL.",
                "locations": [{"file_path": "db.js", "line_start": 40, "line_end": 42}],
            }
        ]
    }


@pytest.mark.parametrize("level_no", [1, 2])
def test_auto_submit_persists_valid_report_and_is_idempotent(auto_case, level_no):
    stage = _prepare_level(auto_case, level_no, lock=True, draft=_valid_draft())

    submission_id = auto_submit._auto_submit_one(auto_case, auto_case["user_id"], level_no, stage)

    assert submission_id is not None
    assert submission_id != "missed"
    with app_session() as session:
        submission = (
            session.execute(text("SELECT * FROM app.submissions WHERE id = CAST(:id AS uuid)"), {"id": submission_id})
            .mappings()
            .one()
        )
        queued_jobs = (
            session.execute(
                text("SELECT kind, payload, status, attempts FROM app.jobs ORDER BY kind"),
            )
            .mappings()
            .all()
        )
        progress = (
            session.execute(
                text(
                    "SELECT level_no, status, submission_id, submitted_at FROM app.participant_progress "
                    "WHERE user_id = CAST(:user AS uuid) ORDER BY level_no"
                ),
                {"user": auto_case["user_id"]},
            )
            .mappings()
            .all()
        )
        pointer = (
            session.execute(
                text("SELECT level_no, node FROM app.participant_pointers WHERE user_id = CAST(:user AS uuid)"),
                {"user": auto_case["user_id"]},
            )
            .mappings()
            .one()
        )
        audit = (
            session.execute(
                text(
                    "SELECT action, actor_role, details FROM audit.entries "
                    "WHERE action = 'level.auto_submitted' AND entity_id = :submission"
                ),
                {"submission": submission_id},
            )
            .mappings()
            .one()
        )

    assert submission["tenant_id"] == uuid.UUID(auto_case["tenant_id"])
    assert submission["event_id"] == uuid.UUID(auto_case["event_id"])
    assert submission["stage_id"] == stage["id"]
    assert submission["team_id"] == uuid.UUID(auto_case["team_id"])
    assert submission["author_id"] == uuid.UUID(auto_case["user_id"])
    assert submission["kind"] == "level_report"
    assert submission["status"] == "received"
    assert submission["feedback_released"] is False
    assert submission["payload"]["level_no"] == level_no
    assert submission["payload"]["auto"] is True
    assert submission["payload"]["confirm_empty"] is True
    assert submission["payload"]["empty"] is False
    assert len(submission["payload"]["flags"]) == 1
    assert submission["payload_hash"] == security.canonical_payload_hash(submission["payload"])
    assert submission["received_at"] is not None
    assert [row["kind"] for row in queued_jobs] == ["evaluate_level_submission", "refresh_leaderboard"]
    assert all(row["status"] == "queued" and row["attempts"] == 0 for row in queued_jobs)
    assert {
        row["payload"]["submission_id"] if "submission_id" in row["payload"] else row["payload"]["stage_id"]
        for row in queued_jobs
    } == {
        submission_id,
        str(stage["id"]),
    }
    current_progress = next(row for row in progress if row["level_no"] == level_no)
    assert current_progress["status"] == "auto_submitted"
    assert current_progress["submission_id"] == uuid.UUID(submission_id)
    assert current_progress["submitted_at"] == submission["received_at"]
    assert pointer["level_no"] == level_no + 1
    assert pointer["node"] == "explain"
    next_progress = next(row for row in progress if row["level_no"] == level_no + 1)
    assert next_progress["status"] == "locked"
    assert audit["actor_role"] == "system"
    assert audit["details"]["level"] == level_no
    assert audit["details"]["receipt"] == submission["receipt_code"]

    assert auto_submit._auto_submit_one(auto_case, auto_case["user_id"], level_no, stage) is None
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM app.submissions WHERE id = CAST(:id AS uuid)"), {"id": submission_id}
            ).scalar_one()
            == 1
        )
        assert (
            session.execute(text("SELECT count(*) FROM app.submissions WHERE kind = 'level_report'")).scalar_one() == 1
        )
        assert session.execute(text("SELECT count(*) FROM app.jobs")).scalar_one() == 2
        assert (
            session.execute(
                text(
                    "SELECT count(*) FROM audit.entries WHERE action = 'level.auto_submitted' AND entity_id = :submission"
                ),
                {"submission": submission_id},
            ).scalar_one()
            == 1
        )


def test_auto_submit_without_repo_lock_records_miss_without_partial_submission(auto_case):
    stage = _prepare_level(auto_case, 1, lock=False)

    result = auto_submit._auto_submit_one(auto_case, auto_case["user_id"], 1, stage)

    assert result == "missed"
    with app_session() as session:
        submission_count = session.execute(
            text("SELECT count(*) FROM app.submissions WHERE author_id = CAST(:user AS uuid)"),
            {"user": auto_case["user_id"]},
        ).scalar_one()
        progress = (
            session.execute(
                text(
                    "SELECT status, submission_id, submitted_at FROM app.participant_progress "
                    "WHERE user_id = CAST(:user AS uuid) AND level_no = 1"
                ),
                {"user": auto_case["user_id"]},
            )
            .mappings()
            .one()
        )
        pointer = (
            session.execute(
                text("SELECT level_no, node FROM app.participant_pointers WHERE user_id = CAST(:user AS uuid)"),
                {"user": auto_case["user_id"]},
            )
            .mappings()
            .one()
        )
        next_status = session.execute(
            text("SELECT status FROM app.participant_progress WHERE user_id = CAST(:user AS uuid) AND level_no = 2"),
            {"user": auto_case["user_id"]},
        ).scalar_one()
        audit = (
            session.execute(
                text(
                    "SELECT action, actor_role, details FROM audit.entries "
                    "WHERE action = 'level.missed_no_lock' AND entity_id = :user"
                ),
                {"user": auto_case["user_id"]},
            )
            .mappings()
            .one()
        )
        job_count = session.execute(text("SELECT count(*) FROM app.jobs")).scalar_one()

    assert submission_count == 0
    assert progress["status"] == "missed"
    assert progress["submission_id"] is None
    assert progress["submitted_at"] is None
    assert pointer["level_no"] == 2
    assert pointer["node"] == "explain"
    assert next_status == "locked"
    assert audit["actor_role"] == "system"
    assert audit["details"] == {"level": 1}
    assert job_count == 0

    assert auto_submit._auto_submit_one(auto_case, auto_case["user_id"], 1, stage) is None
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = 'level.missed_no_lock' AND entity_id = :user"),
                {"user": auto_case["user_id"]},
            ).scalar_one()
            == 1
        )


def test_auto_submit_drops_only_invalid_draft_flags(auto_case):
    draft = _valid_draft()
    draft["flags"].append(
        {
            "title": "bad",
            "category": "not-a-category",
            "description": "short",
            "locations": [{"file_path": "missing.js", "line_start": 9999, "line_end": 10000}],
        }
    )
    stage = _prepare_level(auto_case, 1, lock=True, draft=draft)

    submission_id = auto_submit._auto_submit_one(auto_case, auto_case["user_id"], 1, stage)

    assert submission_id not in (None, "missed")
    with app_session() as session:
        payload = session.execute(
            text("SELECT payload FROM app.submissions WHERE id = CAST(:id AS uuid)"), {"id": submission_id}
        ).scalar_one()
    assert len(payload["flags"]) == 1
    assert payload["flags"][0]["title"] == "Deadline report for the wrong row"
    assert "1 draft flag(s) failed validation and were dropped" in payload["auto_note"]
