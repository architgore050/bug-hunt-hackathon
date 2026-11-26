"""Level submissions: multi-location flags, team dedupe, scoring, receipts."""

from __future__ import annotations

import uuid

from conftest import worker_drain
from flow_helpers import (
    TEAM1,
    TEAM2,
    enter_workspace,
    find_line_in_file,
    flow_client,
    go_live,
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
    primary_line = find_line_in_file(p1, "routes/notes.js", "db.q.deleteNote.run(note.author_id)")
    secondary_line = find_line_in_file(p1, "db.js", "deleteNote: db.prepare")
    r = submit_flags(
        p1,
        2,
        [
            {
                "title": "Deleting a note removes a different note",
                "category": "data_handling",
                "description": "The delete route passes the author id where the query matches the note id, and the query itself lives in db.js.",
                "evidence": "DELETE /api/notes/2 removed note 1 for user id 1.",
                "locations": [
                    {"file_path": "routes/notes.js", "line_start": primary_line - 1, "line_end": primary_line + 1},
                    {"file_path": "db.js", "line_start": secondary_line - 1, "line_end": secondary_line + 1},
                ],
            }
        ],
    )
    assert r.status_code == 202, r.text
    worker_drain()

    # the flag matched the award unit for the TEAM (evidence component awarded)
    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        claim = s.execute(text("SELECT award_unit_id FROM app.award_claims WHERE award_unit_id = 'BUG-05'")).first()
        assert claim is not None
        total = s.execute(
            text(
                "SELECT COALESCE(SUM(points), 0) FROM app.score_ledger_entries l "
                "JOIN app.stages st ON st.id = l.stage_id WHERE st.kind = 'level' AND l.award_unit_id = 'BUG-05'"
            )
        ).scalar_one()
        assert float(total) > 0

    # the team score endpoint reflects the awarded level
    score = p1.get("/v1/team/score").json()
    assert score["total"] > 0
    assert any(lvl["level_no"] == 2 for lvl in score["levels"])


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
    line = find_line_in_file(pcs[TEAM2[0]], "routes/notes.js", "db.q.deleteNote.run(note.author_id)")
    flag = {
        "title": "Delete targets the wrong row",
        "category": "data_handling",
        "description": "The delete route passes note.author_id where the query expects the note id.",
        "locations": [{"file_path": "routes/notes.js", "line_start": line - 1, "line_end": line + 1}],
    }
    r1 = submit_flags(pcs[TEAM2[0]], 2, [flag])
    assert r1.status_code == 202
    # a teammate reports the same bug in their own level submission
    line2 = find_line_in_file(pcs[TEAM2[1]], "routes/notes.js", "db.q.deleteNote.run(note.author_id)")
    flag2 = dict(flag)
    flag2["locations"] = [{"file_path": "routes/notes.js", "line_start": line2 - 1, "line_end": line2 + 1}]
    r2 = submit_flags(pcs[TEAM2[1]], 2, [flag2])
    assert r2.status_code == 202
    worker_drain()

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        claims = s.execute(text("SELECT count(*) FROM app.award_claims WHERE award_unit_id = 'BUG-05'")).scalar_one()
        # exactly one award claim for the team, even though two teammates matched
        assert int(claims) == 1


def test_idempotent_level_submission_replay_and_conflict(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    line = find_line_in_file(pc, "routes/notes.js", "db.q.deleteNote.run(note.author_id)")
    flag = {
        "title": "Delete uses author id as note id",
        "category": "data_handling",
        "description": "The delete route passes note.author_id into a query that matches by note id.",
        "locations": [{"file_path": "routes/notes.js", "line_start": line - 1, "line_end": line + 1}],
    }
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
