"""Evaluator handlers with synthetic ground truth and real persisted outcomes."""

from __future__ import annotations

import json
import uuid

import pytest
from app import evaluator, evaluator_level, security
from app.db import app_session, gt_session
from app.scoring import claim_award_unit
from sqlalchemy import text


@pytest.fixture()
def evaluation_case(seeded_db):
    with app_session() as session:
        case = (
            session.execute(
                text(
                    "SELECT t.id AS team_id, t.event_id, e.tenant_id, tm.user_id, st.id AS stage_id, "
                    "a.challenge_version_id FROM app.teams t JOIN app.events e ON e.id = t.event_id "
                    "JOIN app.team_members tm ON tm.team_id = t.id JOIN app.users u ON u.id = tm.user_id "
                    "JOIN app.stages st ON st.event_id = t.event_id AND st.kind = 'main' "
                    "JOIN app.assignments a ON a.stage_id = st.id "
                    "WHERE u.email = 'p1.team1@example.com' LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
        reviewer_id = session.execute(text("SELECT id FROM app.users WHERE role = 'reviewer' LIMIT 1")).scalar_one()
    return {**{key: str(value) for key, value in case.items()}, "reviewer_id": str(reviewer_id)}


def _insert_bug(case: dict, *, points: float = 100, category: str = "logic") -> str:
    code = f"TEST-BUG-{uuid.uuid4().hex[:8]}"
    bug_id = uuid.uuid4()
    with gt_session() as session:
        session.execute(
            text(
                "INSERT INTO gt.gt_bugs "
                "(id, challenge_version_id, code, title, severity, category, points, root_cause_group, explanation) "
                "VALUES (CAST(:id AS uuid), CAST(:version AS uuid), :code, :title, 'high', :category, :points, "
                ":root_cause, 'Synthetic evaluator fixture.')"
            ),
            {
                "id": str(bug_id),
                "version": case["challenge_version_id"],
                "code": code,
                "title": "Synthetic evaluator bug",
                "category": category,
                "points": points,
                "root_cause": f"root-{code}",
            },
        )
        session.execute(
            text(
                "INSERT INTO gt.gt_aliases (id, bug_id, keyword, weight) "
                "VALUES (CAST(:id AS uuid), CAST(:bug AS uuid), 'wrong row', 1.0)"
            ),
            {"id": str(uuid.uuid4()), "bug": str(bug_id)},
        )
        session.execute(
            text(
                "INSERT INTO gt.gt_locations (id, bug_id, file_path, line_start, line_end, is_primary) "
                "VALUES (CAST(:id AS uuid), CAST(:bug AS uuid), 'routes/notes.js', 10, 12, true)"
            ),
            {"id": str(uuid.uuid4()), "bug": str(bug_id)},
        )
    return code


def _insert_flag(case: dict, *, max_awards: int = 99) -> tuple[str, str]:
    flag_key = f"TEST-FLAG-{uuid.uuid4().hex[:8]}"
    code = f"FLAG{{synthetic_{uuid.uuid4().hex}}}"
    with gt_session() as session:
        session.execute(
            text(
                "INSERT INTO gt.gt_flags "
                "(id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                "VALUES (CAST(:id AS uuid), CAST(:version AS uuid), :key, :hash, 40, :max_awards)"
            ),
            {
                "id": str(uuid.uuid4()),
                "version": case["challenge_version_id"],
                "key": flag_key,
                "hash": security.flag_code_hash(code),
                "max_awards": max_awards,
            },
        )
    return flag_key, code


def _insert_submission(
    case: dict,
    kind: str,
    payload: dict,
    *,
    flag_code: str | None = None,
    team_id: str | None = None,
    user_id: str | None = None,
) -> str:
    submission_id = uuid.uuid4()
    team_id = team_id or case["team_id"]
    user_id = user_id or case["user_id"]
    with app_session() as session:
        session.execute(
            text(
                "INSERT INTO app.submissions "
                "(id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                "idempotency_key, payload, payload_hash, status, receipt_code, title, flag_code, received_at) "
                "VALUES (CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:version AS uuid), CAST(:team AS uuid), CAST(:user AS uuid), :kind, :idem, "
                "CAST(:payload AS jsonb), :payload_hash, 'received', :receipt, 'Synthetic submission', :flag, now())"
            ),
            {
                "id": str(submission_id),
                "tenant": case["tenant_id"],
                "event": case["event_id"],
                "stage": case["stage_id"],
                "version": case["challenge_version_id"],
                "team": team_id,
                "user": user_id,
                "kind": kind,
                "idem": f"synthetic-{submission_id}",
                "payload": json.dumps(payload),
                "payload_hash": security.canonical_payload_hash(payload),
                "receipt": f"T{submission_id.hex[:12]}",
                "flag": flag_code,
            },
        )
    return str(submission_id)


def _submission_row(submission_id: str) -> dict:
    with app_session() as session:
        return dict(
            session.execute(
                text(
                    "SELECT status, matched_bug_code, feedback_released FROM app.submissions WHERE id = CAST(:id AS uuid)"
                ),
                {"id": submission_id},
            )
            .mappings()
            .one()
        )


def _ledger(submission_id: str) -> list[dict]:
    with app_session() as session:
        rows = (
            session.execute(
                text(
                    "SELECT component, kind, points, reason_code, award_unit_id, note "
                    "FROM app.score_ledger_entries WHERE submission_id = CAST(:id AS uuid) ORDER BY component"
                ),
                {"id": submission_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def _jobs() -> list[dict]:
    with app_session() as session:
        rows = session.execute(text("SELECT kind, payload, status FROM app.jobs ORDER BY kind")).mappings().all()
    return [dict(row) for row in rows]


def test_invalid_flag_is_rejected_without_claim_ledger_or_job(evaluation_case):
    submission_id = _insert_submission(
        evaluation_case,
        "ctf_flag",
        {},
        flag_code=f"FLAG{{invalid_{uuid.uuid4().hex}}}",
    )

    evaluator.verify_flag({"submission_id": submission_id})

    assert _submission_row(submission_id) == {
        "status": "rejected_auto",
        "matched_bug_code": None,
        "feedback_released": False,
    }
    assert _ledger(submission_id) == []
    assert _jobs() == []
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM app.award_claims WHERE submission_id = CAST(:id AS uuid)"),
                {"id": submission_id},
            ).scalar_one()
            == 0
        )


def test_flag_max_awards_allows_one_sequential_team_and_marks_the_other_duplicate(evaluation_case):
    flag_key, code = _insert_flag(evaluation_case, max_awards=1)
    with app_session() as session:
        other = (
            session.execute(
                text(
                    "SELECT t.id AS team_id, tm.user_id FROM app.teams t "
                    "JOIN app.team_members tm ON tm.team_id = t.id JOIN app.users u ON u.id = tm.user_id "
                    "WHERE u.email = 'p1.team2@example.com'"
                )
            )
            .mappings()
            .one()
        )
    first = _insert_submission(evaluation_case, "ctf_flag", {}, flag_code=code)
    second = _insert_submission(
        evaluation_case,
        "ctf_flag",
        {},
        flag_code=code,
        team_id=str(other["team_id"]),
        user_id=str(other["user_id"]),
    )

    evaluator.verify_flag({"submission_id": first})
    evaluator.verify_flag({"submission_id": second})

    assert _submission_row(first)["status"] == "matched_auto"
    assert _submission_row(first)["matched_bug_code"] == flag_key
    assert _submission_row(second)["status"] == "duplicate"
    assert _submission_row(second)["matched_bug_code"] is None
    assert _ledger(second) == []
    assert _ledger(first)[0]["component"] == "ctf_bonus"
    assert float(_ledger(first)[0]["points"]) == 40.0
    with app_session() as session:
        claims = session.execute(
            text("SELECT submission_id FROM app.award_claims WHERE award_unit_id = :key"), {"key": flag_key}
        ).all()
    assert len(claims) == 1
    assert str(claims[0][0]) == first


def test_second_team_submission_for_same_flag_does_not_duplicate_team_award(evaluation_case):
    flag_key, code = _insert_flag(evaluation_case, max_awards=99)
    first = _insert_submission(evaluation_case, "ctf_flag", {}, flag_code=code)
    second = _insert_submission(evaluation_case, "ctf_flag", {}, flag_code=code)

    evaluator.verify_flag({"submission_id": first})
    evaluator.verify_flag({"submission_id": second})

    assert _submission_row(first)["status"] == "matched_auto"
    assert _submission_row(second)["status"] == "duplicate"
    assert len(_ledger(first)) == 1
    assert _ledger(second) == []
    with app_session() as session:
        assert (
            session.execute(
                text(
                    "SELECT count(*) FROM app.award_claims WHERE team_id = CAST(:team AS uuid) AND award_unit_id = :key"
                ),
                {"team": evaluation_case["team_id"], "key": flag_key},
            ).scalar_one()
            == 1
        )


def test_ctf_evaluation_only_enqueues_verification(evaluation_case):
    submission_id = _insert_submission(evaluation_case, "ctf_flag", {}, flag_code="FLAG{not_checked_here}")

    evaluator.evaluate_submission({"submission_id": submission_id})

    assert _submission_row(submission_id)["status"] == "received"
    assert _ledger(submission_id) == []
    jobs = _jobs()
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "verify_flag"
    assert jobs[0]["payload"] == {"submission_id": submission_id}
    assert jobs[0]["status"] == "queued"


@pytest.mark.parametrize(("decision", "expected_points"), [("accept_full", 21.0), ("accept_partial", 10.5)])
def test_review_outcome_scores_once_across_sequential_delivery(evaluation_case, decision, expected_points):
    bug_code = _insert_bug(evaluation_case)
    submission_id = _insert_submission(evaluation_case, "bug_report", {"file_path": "routes/notes.js"})
    review_id = uuid.uuid4()
    with app_session() as session:
        assert claim_award_unit(
            session,
            event_id=evaluation_case["event_id"],
            stage_id=evaluation_case["stage_id"],
            team_id=evaluation_case["team_id"],
            award_unit_id=bug_code,
            submission_id=submission_id,
        )
        session.execute(
            text(
                "INSERT INTO app.reviews (id, submission_id, reviewer_id, decision, rubric, quality) "
                "VALUES (CAST(:id AS uuid), CAST(:submission AS uuid), CAST(:reviewer AS uuid), "
                ":decision, CAST(:rubric AS jsonb), 0.70)"
            ),
            {
                "id": str(review_id),
                "submission": submission_id,
                "reviewer": evaluation_case["reviewer_id"],
                "decision": decision,
                "rubric": json.dumps({"code_quality": 1.0, "root_cause": 0.5}),
            },
        )

    payload = {"submission_id": submission_id, "review_id": str(review_id), "decision": decision}
    evaluator.apply_review_outcome(payload)
    evaluator.apply_review_outcome(payload)

    assert _submission_row(submission_id)["status"] == "decided"
    entries = _ledger(submission_id)
    assert len(entries) == 1
    assert entries[0]["component"] == "code_review"
    assert entries[0]["kind"] == "award"
    assert float(entries[0]["points"]) == expected_points
    assert entries[0]["reason_code"] == decision.upper()
    assert entries[0]["award_unit_id"] == bug_code


def test_persisted_rejection_overrides_queue_payload_and_remains_invalid(evaluation_case):
    submission_id = _insert_submission(evaluation_case, "bug_report", {})
    review_id = uuid.uuid4()
    with app_session() as session:
        session.execute(
            text(
                "INSERT INTO app.reviews (id, submission_id, reviewer_id, decision, rubric, quality) "
                "VALUES (CAST(:id AS uuid), CAST(:submission AS uuid), CAST(:reviewer AS uuid), "
                "'reject_invalid', '{}', 0)"
            ),
            {"id": str(review_id), "submission": submission_id, "reviewer": evaluation_case["reviewer_id"]},
        )

    evaluator.apply_review_outcome(
        {"submission_id": submission_id, "review_id": str(review_id), "decision": "accept_full"}
    )

    assert _submission_row(submission_id)["status"] == "rejected_auto"
    assert _ledger(submission_id) == []


def test_review_and_test_results_score_every_claimed_unit(evaluation_case):
    logic_bug = _insert_bug(evaluation_case, category="logic")
    data_bug = _insert_bug(evaluation_case, category="data_handling")
    submission_id = _insert_submission(
        evaluation_case,
        "level_report",
        {
            "level_no": 1,
            "flags": [_level_flag(category="logic"), _level_flag(category="data_handling")],
        },
    )
    evaluator_level.evaluate_level_submission({"submission_id": submission_id, "level_no": 1})
    review_id = uuid.uuid4()
    with app_session() as session:
        session.execute(
            text(
                "INSERT INTO app.reviews (id, submission_id, reviewer_id, decision, rubric, quality) "
                "VALUES (CAST(:id AS uuid), CAST(:submission AS uuid), CAST(:reviewer AS uuid), "
                "'accept_full', CAST(:rubric AS jsonb), 1.0)"
            ),
            {
                "id": str(review_id),
                "submission": submission_id,
                "reviewer": evaluation_case["reviewer_id"],
                "rubric": json.dumps({"code_quality": 1.0, "root_cause": 1.0}),
            },
        )

    evaluator.apply_review_outcome(
        {"submission_id": submission_id, "review_id": str(review_id), "decision": "accept_full"}
    )
    evaluator.apply_test_results({"submission_id": submission_id, "tests_passed": 1, "tests_total": 1})

    entries = _ledger(submission_id)
    assert {row["award_unit_id"] for row in entries if row["component"] == "evidence_report"} == {
        logic_bug,
        data_bug,
    }
    assert len([row for row in entries if row["component"] == "code_review"]) == 2
    assert len([row for row in entries if row["component"] == "functional_test"]) == 2
    assert sum(float(row["points"]) for row in entries) == 200.0


def test_functional_test_results_score_once_and_preserve_submission_verdict(evaluation_case):
    bug_code = _insert_bug(evaluation_case)
    submission_id = _insert_submission(evaluation_case, "bug_report", {})
    with app_session() as session:
        assert claim_award_unit(
            session,
            event_id=evaluation_case["event_id"],
            stage_id=evaluation_case["stage_id"],
            team_id=evaluation_case["team_id"],
            award_unit_id=bug_code,
            submission_id=submission_id,
        )

    payload = {"submission_id": submission_id, "tests_passed": 3, "tests_total": 4}
    evaluator.apply_test_results(payload)
    evaluator.apply_test_results(payload)

    assert _submission_row(submission_id)["status"] == "received"
    entries = _ledger(submission_id)
    assert len(entries) == 1
    assert entries[0]["component"] == "functional_test"
    assert float(entries[0]["points"]) == 37.5
    assert entries[0]["reason_code"] == "TEST_RESULTS"
    assert entries[0]["note"] == "passed 3/4"


def test_functional_test_results_without_claim_leave_no_partial_state(evaluation_case):
    submission_id = _insert_submission(evaluation_case, "bug_report", {})

    evaluator.apply_test_results({"submission_id": submission_id, "tests_passed": 1, "tests_total": 1})

    assert _submission_row(submission_id)["status"] == "received"
    assert _ledger(submission_id) == []


def test_review_item_creation_is_idempotent_for_sequential_jobs(evaluation_case):
    submission_id = _insert_submission(evaluation_case, "bug_report", {})

    evaluator.create_review_item({"submission_id": submission_id, "priority": 7, "reason": "first"})
    evaluator.create_review_item({"submission_id": submission_id, "priority": 2, "reason": "second"})

    with app_session() as session:
        items = (
            session.execute(
                text("SELECT priority, reason, status FROM app.review_items WHERE submission_id = CAST(:id AS uuid)"),
                {"id": submission_id},
            )
            .mappings()
            .all()
        )
    assert len(items) == 1
    assert items[0]["priority"] == 7
    assert items[0]["reason"] == "first"
    assert items[0]["status"] == "open"


def _level_flag(*, category: str = "logic", file_path: str = "routes/notes.js") -> dict:
    return {
        "title": "Synthetic level report",
        "category": category,
        "description": "The wrong row identifier is passed to the query.",
        "evidence": "The request updated a different note.",
        "locations": [{"file_path": file_path, "line_start": 10, "line_end": 12}],
    }


def test_level_full_match_persists_one_claim_evidence_entry_and_review_job(evaluation_case):
    bug_code = _insert_bug(evaluation_case)
    submission_id = _insert_submission(
        evaluation_case,
        "level_report",
        {"level_no": 1, "flags": [_level_flag()]},
    )

    evaluator_level.evaluate_level_submission({"submission_id": submission_id, "level_no": 1})

    assert _submission_row(submission_id)["status"] == "matched_auto"
    entries = _ledger(submission_id)
    assert len(entries) == 1
    assert entries[0]["component"] == "evidence_report"
    assert float(entries[0]["points"]) == 20.0
    assert entries[0]["award_unit_id"] == bug_code
    jobs = _jobs()
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "create_review_item"
    assert jobs[0]["payload"]["reason"] == "auto_accept_confirm"


def test_level_duplicate_submission_stays_duplicate_without_another_award(evaluation_case):
    bug_code = _insert_bug(evaluation_case)
    payload = {"level_no": 1, "flags": [_level_flag()]}
    first = _insert_submission(evaluation_case, "level_report", payload)
    second = _insert_submission(evaluation_case, "level_report", payload)

    evaluator_level.evaluate_level_submission({"submission_id": first, "level_no": 1})
    evaluator_level.evaluate_level_submission({"submission_id": second, "level_no": 1})

    assert _submission_row(first)["status"] == "matched_auto"
    assert _submission_row(second)["status"] == "duplicate"
    assert _ledger(second) == []
    with app_session() as session:
        claims = session.execute(
            text("SELECT count(*) FROM app.award_claims WHERE award_unit_id = :bug"), {"bug": bug_code}
        ).scalar_one()
    assert claims == 1


def test_level_partial_match_routes_to_review_without_scoring(evaluation_case):
    _insert_bug(evaluation_case, category="data_handling")
    submission_id = _insert_submission(
        evaluation_case,
        "level_report",
        {"level_no": 1, "flags": [_level_flag(category="injection")]},
    )

    evaluator_level.evaluate_level_submission({"submission_id": submission_id, "level_no": 1})

    assert _submission_row(submission_id)["status"] == "needs_review"
    assert _ledger(submission_id) == []
    jobs = _jobs()
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "create_review_item"
    assert jobs[0]["payload"]["reason"] == "level1_needs_review"


def test_level_invalid_report_is_rejected_without_review_or_score(evaluation_case):
    _insert_bug(evaluation_case)
    submission_id = _insert_submission(
        evaluation_case,
        "level_report",
        {"level_no": 1, "flags": [_level_flag(file_path="")]},
    )

    evaluator_level.evaluate_level_submission({"submission_id": submission_id, "level_no": 1})

    assert _submission_row(submission_id)["status"] == "rejected_auto"
    assert _ledger(submission_id) == []
    assert _jobs() == []


def test_level_artifact_opens_only_one_review_item_across_sequential_delivery(evaluation_case):
    submission_id = _insert_submission(
        evaluation_case,
        "level_artifact",
        {"level_no": 3, "empty": True, "auto": False},
    )

    evaluator_level.evaluate_level_submission({"submission_id": submission_id, "level_no": 3})
    evaluator_level.evaluate_level_submission({"submission_id": submission_id, "level_no": 3})

    assert _submission_row(submission_id)["status"] == "received"
    assert _ledger(submission_id) == []
    assert _jobs() == []
    with app_session() as session:
        items = (
            session.execute(
                text("SELECT priority, reason, status FROM app.review_items WHERE submission_id = CAST(:id AS uuid)"),
                {"id": submission_id},
            )
            .mappings()
            .all()
        )
    assert len(items) == 1
    assert items[0]["priority"] == 3
    assert items[0]["reason"] == "level_artifact"
    assert items[0]["status"] == "open"


@pytest.mark.parametrize("released_status", ["released", "final"])
def test_release_scores_once_keeps_feedback_hidden_until_release_and_populates_points(evaluation_case, released_status):
    _insert_bug(evaluation_case, points=100)
    accepted = _insert_submission(
        evaluation_case,
        "level_report",
        {"level_no": 1, "flags": [_level_flag()]},
    )
    evaluator_level.evaluate_level_submission({"submission_id": accepted, "level_no": 1})
    rejected = _insert_submission(evaluation_case, "bug_report", {})
    with app_session() as session:
        session.execute(
            text("UPDATE app.submissions SET status = 'rejected_auto' WHERE id = CAST(:id AS uuid)"),
            {"id": rejected},
        )
        session.execute(
            text("UPDATE app.stages SET status = 'evaluating' WHERE id = CAST(:id AS uuid)"),
            {"id": evaluation_case["stage_id"]},
        )

    evaluator.release_feedback({"stage_id": evaluation_case["stage_id"]})

    assert _submission_row(accepted)["feedback_released"] is False
    assert _submission_row(rejected)["feedback_released"] is False
    assert len([row for row in _ledger(accepted) if row["component"] == "code_review"]) == 1
    with app_session() as session:
        penalties = session.execute(
            text(
                "SELECT count(*) FROM app.score_ledger_entries WHERE stage_id = CAST(:stage AS uuid) "
                "AND reason_code = 'INVALID_REPORT_PENALTY'"
            ),
            {"stage": evaluation_case["stage_id"]},
        ).scalar_one()
        session.execute(
            text("UPDATE app.stages SET status = :status WHERE id = CAST(:id AS uuid)"),
            {"status": released_status, "id": evaluation_case["stage_id"]},
        )
    assert penalties == 1

    evaluator.release_feedback({"stage_id": evaluation_case["stage_id"]})

    assert _submission_row(accepted)["feedback_released"] is True
    assert _submission_row(rejected)["feedback_released"] is True
    assert len([row for row in _ledger(accepted) if row["component"] == "code_review"]) == 1
    with app_session() as session:
        penalties = session.execute(
            text(
                "SELECT count(*) FROM app.score_ledger_entries WHERE stage_id = CAST(:stage AS uuid) "
                "AND reason_code = 'INVALID_REPORT_PENALTY'"
            ),
            {"stage": evaluation_case["stage_id"]},
        ).scalar_one()
        points = (
            session.execute(
                text(
                    "SELECT id, points_visible FROM app.submissions WHERE id IN (CAST(:accepted AS uuid), CAST(:rejected AS uuid))"
                ),
                {"accepted": accepted, "rejected": rejected},
            )
            .mappings()
            .all()
        )
    assert penalties == 1
    assert {str(row["id"]): float(row["points_visible"]) for row in points} == {accepted: 44.0, rejected: 0.0}
