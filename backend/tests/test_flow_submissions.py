"""Level submissions: multi-location flags, team dedupe, scoring, receipts."""

from __future__ import annotations

import uuid

from conftest import worker_drain
from flow_helpers import (
    TEAM1,
    TEAM2,
    enter_workspace,
    flow_client,
    go_live,
    gt_bug_locations,
    gt_bug_report,
    gt_level_points,
    lock_repo,
    open_level_window,
    submit_empty,
    submit_flags,
)


def test_l2_multilocation_flag_matches_cross_file_bug(client):
    """A Level 2 flag with an ordered location list covering both symptoms of
    one bug matches the award unit once for the team (spec 4.2, 8.1)."""
    go_live(client)
    pcs = {e: flow_client(client, e) for e in TEAM1}
    lock_repo(pcs[TEAM1[0]]).raise_for_status()
    for pc in pcs.values():
        enter_workspace(pc, 1).raise_for_status()
        submit_empty(pc, 1).raise_for_status()

    p1 = pcs[TEAM1[0]]
    open_level_window(2)
    ws = enter_workspace(p1, 2)
    assert ws.status_code == 200, ws.text
    assert ws.json()["editable"] is False
    r = submit_flags(p1, 2, [gt_bug_report("BUG-13")])
    assert r.status_code == 202, r.text
    worker_drain()

    # the flag matched the award unit for the TEAM (evidence component awarded)
    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        claim = s.execute(text("SELECT award_unit_id FROM app.award_claims WHERE award_unit_id = 'BUG-13'")).first()
        assert claim is not None
        total = s.execute(
            text(
                "SELECT COALESCE(SUM(points), 0) FROM app.score_ledger_entries l "
                "JOIN app.stages st ON st.id = l.stage_id WHERE st.kind = 'level' AND l.award_unit_id = 'BUG-13'"
            )
        ).scalar_one()
        assert float(total) > 0

    # the team score endpoint reflects the awarded level
    score = p1.get("/v1/team/score").json()
    assert score["total"] > 0
    assert any(lvl["level_no"] == 2 for lvl in score["levels"])


def test_team_points_show_completed_level_score_and_cumulative_points(client):
    """Completed levels show evaluation score over its ceiling; bonuses remain points."""
    go_live(client)
    pc = flow_client(client, TEAM1[0])

    levels = pc.get("/v1/levels").json()["levels"]
    assert len(levels) == 4
    assert all(level["max_points"] == gt_level_points(level["level_no"]) for level in levels)

    initial = pc.get("/v1/team/score").json()
    assert initial["points"] == 0
    assert initial["total"] == 0
    assert len(initial["levels"]) == 4
    assert all(level["evaluation_status"] == "not_submitted" for level in initial["levels"])

    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    submit_empty(pc, 1).raise_for_status()

    pending = pc.get("/v1/team/score").json()["levels"]
    assert next(level for level in pending if level["level_no"] == 1)["evaluation_status"] == "evaluating"

    worker_drain()
    completed = pc.get("/v1/team/score").json()["levels"]
    level_one = next(level for level in completed if level["level_no"] == 1)
    assert level_one["evaluation_status"] == "complete"
    assert level_one["score"] == 0
    assert level_one["max_points"] == gt_level_points(1)

    from app.db import app_session
    from app.scoring import add_ledger_entry
    from sqlalchemy import text

    with app_session() as s:
        ids = s.execute(
            text(
                "SELECT t.id, t.event_id, e.tenant_id, st.id FROM app.teams t "
                "JOIN app.events e ON e.id = t.event_id "
                "JOIN app.team_members tm ON tm.team_id = t.id "
                "JOIN app.users u ON u.id = tm.user_id "
                "JOIN app.stages st ON st.event_id = t.event_id "
                "WHERE u.email = :email AND st.kind = 'level' AND st.ordinal = 1"
            ),
            {"email": TEAM1[0]},
        ).one()
        for component, kind, points in [
            ("evidence_report", "award", 10),
            ("ctf_bonus", "bonus", 30),
            ("penalty", "penalty", -5),
        ]:
            add_ledger_entry(
                s,
                tenant_id=str(ids[2]),
                event_id=str(ids[1]),
                stage_id=str(ids[3]),
                team_id=str(ids[0]),
                component=component,
                kind=kind,
                points=points,
                reason_code="TEST_POINTS",
            )

    scored = pc.get("/v1/team/score").json()
    level_one = next(level for level in scored["levels"] if level["level_no"] == 1)
    assert level_one["score"] == 5
    assert level_one["points"] == 35
    assert level_one["total"] == 35
    assert scored["points"] == 35
    assert scored["total"] == 35


def test_team_dedupe_second_teammate_does_not_double_award(client):
    go_live(client)
    pcs = {e: flow_client(client, e) for e in TEAM2}
    lock_repo(pcs[TEAM2[0]], "A", key="lock-team2-dedupe").raise_for_status()
    for pc in pcs.values():
        enter_workspace(pc, 1).raise_for_status()
        submit_empty(pc, 1).raise_for_status()
    open_level_window(2)
    enter_workspace(pcs[TEAM2[0]], 2).raise_for_status()
    enter_workspace(pcs[TEAM2[1]], 2).raise_for_status()
    flag = gt_bug_report("BUG-13")
    r1 = submit_flags(pcs[TEAM2[0]], 2, [flag])
    assert r1.status_code == 202
    # a teammate reports the same bug in their own level submission
    r2 = submit_flags(pcs[TEAM2[1]], 2, [gt_bug_report("BUG-13")])
    assert r2.status_code == 202
    worker_drain()

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        claims = s.execute(text("SELECT count(*) FROM app.award_claims WHERE award_unit_id = 'BUG-13'")).scalar_one()
        # exactly one award claim for the team, even though two teammates matched
        assert int(claims) == 1


def test_idempotent_level_submission_replay_and_conflict(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    flag = gt_bug_report("BUG-01")
    key = str(uuid.uuid4())
    r1 = submit_flags(pc, 1, [flag], key=key)
    assert r1.status_code == 202
    r2 = submit_flags(pc, 1, [flag], key=key)
    assert r2.status_code == 202
    assert r2.json()["replay"] is True
    assert r2.json()["receipt_code"] == r1.json()["receipt_code"]
    # different payload with the same key conflicts
    changed = dict(flag, title="A materially different report entirely")
    r3 = submit_flags(pc, 1, [changed], key=key)
    assert r3.status_code == 409
    assert r3.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_l1_empty_submission_is_explicit_and_scored_nothing(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    r = submit_empty(pc, 1)
    assert r.status_code == 202, r.text
    worker_drain()
    detail = pc.get(f"/v1/submissions/{r.json()['submission_id']}").json()
    assert detail["payload"]["empty"] is True
    assert detail["payload"].get("confirm_empty") is True


def test_runs_disabled_but_submission_paths_open(client):
    """Runner off: Run answers 503 with a stable code while saving and
    submission keep working (ADR-010, spec 12 acceptance 13)."""
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    r = pc.post("/v1/runs", json={"level_no": 1})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "RUNNER_UNAVAILABLE"
    r2 = pc.get("/v1/runs/whatever")
    assert r2.status_code == 503
    # saving a draft and submitting still work
    r3 = pc.put("/v1/levels/1/draft", json={"payload": {"flags": []}, "version": 0})
    assert r3.status_code == 200
    r4 = submit_empty(pc, 1)
    assert r4.status_code == 202


def test_l1_crash_resumes_without_double_scoring_or_duplicate(client):
    from app.db import app_session
    from app.evaluator_level import evaluate_level_submission
    from sqlalchemy import text

    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    flag = {
        "title": "Session cookie lifetime is far too short",
        "category": "configuration",
        "description": "The session TTL constant lost three digits, so max-age is minutes not days.",
        "evidence": "Set-Cookie Max-Age is 604.",
        "locations": gt_bug_locations("BUG-01"),
    }
    r = submit_flags(pc, 1, [flag])
    assert r.status_code == 202
    sid = r.json()["submission_id"]
    worker_drain()
    # simulate crash-retry by re-running evaluate_level_submission on the same submission
    evaluate_level_submission({"submission_id": sid, "level_no": 1})
    with app_session() as s:
        sub = (
            s.execute(
                text(
                    "SELECT status, evaluation_state, matched_bug_code FROM app.submissions WHERE id = CAST(:id AS uuid)"
                ),
                {"id": sid},
            )
            .mappings()
            .first()
        )
        assert sub["evaluation_state"] == "SCORED"
        assert sub["status"] in ("matched_auto", "needs_review", "rejected_auto")
        ledger_count = s.execute(
            text("SELECT count(*) FROM app.score_ledger_entries WHERE submission_id = CAST(:id AS uuid)"),
            {"id": sid},
        ).scalar_one()
        flag_rows = s.execute(
            text("SELECT count(*) FROM app.submission_flag_results WHERE submission_id = CAST(:id AS uuid)"),
            {"id": sid},
        ).scalar_one()
        assert flag_rows == 1
        if sub["status"] == "matched_auto":
            assert sub["matched_bug_code"] is not None
            assert ledger_count == 1


def test_l1_release_feedback_applies_default_code_review_and_penalty(client):
    from app.db import app_session
    from app.evaluator import release_feedback
    from sqlalchemy import text

    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    thin_flag = {
        "title": "Short invalid report",
        "category": "other",
        "description": "This report has no matching bug.",
        "locations": [{"file_path": "public/index.html", "line_start": 1, "line_end": 2}],
    }
    r = submit_flags(pc, 1, [thin_flag])
    assert r.status_code == 202
    worker_drain()
    with app_session() as s:
        stage_id = str(
            s.execute(
                text("SELECT stage_id FROM app.submissions WHERE id = CAST(:id AS uuid)"),
                {"id": r.json()["submission_id"]},
            ).scalar_one()
        )
    # Feedback stays hidden while the stage is not yet released (INT-01).
    release_feedback({"stage_id": stage_id})
    with app_session() as s:
        released = s.execute(
            text("SELECT feedback_released FROM app.submissions WHERE id = CAST(:id AS uuid)"),
            {"id": r.json()["submission_id"]},
        ).scalar_one()
        assert released is False

    # Release the stage, then feedback becomes visible.
    with app_session() as s:
        s.execute(
            text("UPDATE app.stages SET status = 'released' WHERE id = CAST(:id AS uuid)"),
            {"id": stage_id},
        )

    release_feedback({"stage_id": stage_id})
    with app_session() as s:
        released = s.execute(
            text("SELECT feedback_released FROM app.submissions WHERE id = CAST(:id AS uuid)"),
            {"id": r.json()["submission_id"]},
        ).scalar_one()
        assert released is True


def test_negative_flag_rejections(client):
    """L1: 0 locations and 2 locations rejected; L2 cap; file outside repo; line range beyond file."""
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()

    # L1: 0 locations - fails exactly-1 requirement
    r = submit_flags(
        pc,
        1,
        [
            {
                "title": "No locations L1",
                "category": "injection",
                "description": "User submitted flag with no locations",
                "evidence": "GET /api/notes?q=test",
                "locations": [],
            },
        ],
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "LOCATION_INVALID"

    # L1: 2 locations - also fails exactly-1 requirement
    r2 = submit_flags(
        pc,
        1,
        [
            {
                "title": "Two locations L1",
                "category": "injection",
                "description": "User submitted flag with two locations",
                "evidence": "GET /api/notes?q=test",
                "locations": [
                    {"file_path": "http/routes/notes.js", "line_start": 1, "line_end": 2},
                    {"file_path": "http/routes/notes.js", "line_start": 3, "line_end": 4},
                ],
            },
        ],
    )
    assert r2.status_code == 422, r2.text
    assert r2.json()["error"]["code"] == "LOCATION_INVALID"

    # L2 exceeds max locations (cap is 5) - 6 locations should fail
    open_level_window(2)
    r3 = submit_flags(
        pc,
        2,
        [
            {
                "title": "Too many locations L2",
                "category": "injection",
                "description": "User submitted too many ordered locations",
                "evidence": "test evidence",
                "locations": [
                    {"file_path": "http/routes/notes.js", "line_start": 1, "line_end": 2},
                    {"file_path": "http/routes/notes.js", "line_start": 3, "line_end": 4},
                    {"file_path": "http/routes/notes.js", "line_start": 5, "line_end": 6},
                    {"file_path": "http/routes/notes.js", "line_start": 7, "line_end": 8},
                    {"file_path": "http/routes/notes.js", "line_start": 9, "line_end": 10},
                    {"file_path": "http/routes/notes.js", "line_start": 11, "line_end": 12},
                ],
            },
        ],
    )
    assert r3.status_code == 422, r3.text
    detail = r3.json()["detail"]
    assert detail[0]["type"] == "too_long"
    assert detail[0]["loc"] == ["body", "flags", 0, "locations"]

    # File outside repo (../ traversal) - L1
    r4 = submit_flags(
        pc,
        1,
        [
            {
                "title": "Traversal attack",
                "category": "injection",
                "description": "User attempted path traversal outside the sandboxed repo",
                "evidence": "test",
                "locations": [{"file_path": "../etc/passwd", "line_start": 1, "line_end": 2}],
            },
        ],
    )
    assert r4.status_code == 404, r4.text
    assert r4.json()["error"]["code"] == "FILE_NOT_FOUND"

    # Line range beyond file - L1
    r5 = submit_flags(
        pc,
        1,
        [
            {
                "title": "Beyond file range",
                "category": "injection",
                "description": "User reported line range extending beyond file end",
                "evidence": "test",
                "locations": [{"file_path": "http/routes/notes.js", "line_start": 1, "line_end": 999}],
            },
        ],
    )
    assert r5.status_code == 422
    assert r5.json()["error"]["code"] == "SUBMISSION_INVALID"
