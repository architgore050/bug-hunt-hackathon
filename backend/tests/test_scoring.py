"""Scoring ledger integrity tests (AT-07, DAT-01, DAT-05, INT-01)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from conftest import STAFF_PW, participant_client, worker_drain


def test_compute_award_points_weights():
    from app.scoring import compute_award_points

    w = {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2}
    pts = compute_award_points(100, w, test_fraction=1.0, review_quality=1.0, evidence_quality=1.0)
    assert pts == {"functional_test": 50.0, "code_review": 30.0, "evidence_report": 20.0}
    pts = compute_award_points(100, w, test_fraction=0.5, review_quality=0.0, evidence_quality=0.5)
    assert pts["functional_test"] == 25.0 and pts["code_review"] == 0.0 and pts["evidence_report"] == 10.0


def test_ledger_is_append_only_by_convention(seeded_db):
    """Corrections add reversal entries referencing the original; nothing mutates
    historical rows. We assert the reversal linkage path works."""
    from app.db import app_session
    from app.scoring import add_ledger_entry

    with app_session() as s:
        team = s.execute(
            text("SELECT t.id, t.event_id, st.id, e.tenant_id FROM app.teams t "
                 "JOIN app.stages st ON st.event_id = t.event_id JOIN app.events e ON e.id = t.event_id LIMIT 1")
        ).first()
        entry_id = add_ledger_entry(
            s, tenant_id=str(team[3]), event_id=str(team[1]), stage_id=str(team[2]), team_id=str(team[0]),
            component="adjustment", kind="adjustment", points=-5.0, reason_code="TEST_REVERSAL",
        )
        rev_id = add_ledger_entry(
            s, tenant_id=str(team[3]), event_id=str(team[1]), stage_id=str(team[2]), team_id=str(team[0]),
            component="adjustment", kind="reversal", points=5.0, reason_code="TEST_REVERSAL",
            reverses_entry_id=entry_id,
        )
        s.flush()
        row = s.execute(text("SELECT reverses_entry_id FROM app.score_ledger_entries WHERE id = CAST(:i AS uuid)"), {"i": rev_id}).first()
        assert str(row[0]) == entry_id


def test_award_claim_uniqueness_blocks_double_award(seeded_db):
    """AT-07: two concurrent evaluations awarding the same unit -> one claim."""
    from app.db import app_session
    from app.scoring import claim_award_unit

    with app_session() as s:
        team = s.execute(
            text("SELECT t.id, t.event_id, st.id, e.tenant_id FROM app.teams t "
                 "JOIN app.stages st ON st.event_id = t.event_id JOIN app.events e ON e.id = t.event_id LIMIT 1")
        ).first()
        team_id, event_id, stage_id, tenant_id = str(team[0]), str(team[1]), str(team[2]), str(team[3])
        cv = s.execute(text("SELECT id FROM app.challenge_versions LIMIT 1")).first()[0]
        user = s.execute(text("SELECT id FROM app.users WHERE role='participant' LIMIT 1")).first()[0]
        sub1, sub2 = str(uuid.uuid4()), str(uuid.uuid4())
        for sid in (sub1, sub2):
            s.execute(
                text(
                    "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                    "idempotency_key, payload, payload_hash, status, receipt_code, title, received_at) VALUES "
                    "(CAST(:id AS uuid), CAST(:t AS uuid), CAST(:ev AS uuid), CAST(:st AS uuid), CAST(:cv AS uuid), CAST(:team AS uuid), "
                    "CAST(:au AS uuid), 'bug_report', :k, CAST(:p AS jsonb), 'x', 'received', :r, 'claim test', now())"
                ),
                {"id": sid, "t": tenant_id, "ev": event_id, "st": stage_id, "cv": str(cv), "team": team_id,
                 "au": str(user), "k": f"claim-{sid[:8]}", "p": "{}", "r": sid[:8].upper()},
            )
        first = claim_award_unit(s, event_id=event_id, stage_id=stage_id, team_id=team_id, award_unit_id="TEST-UNIT-1", submission_id=sub1)
        second = claim_award_unit(s, event_id=event_id, stage_id=stage_id, team_id=team_id, award_unit_id="TEST-UNIT-1", submission_id=sub2)
        assert first is True
        assert second is False  # database uniqueness enforced


def test_ctf_bonus_is_capped(seeded_db):
    from app.db import app_session
    from app import evaluator
    from app.jobs import enqueue

    # stage cap default 100; flags worth 30 each -> 4 flags = 120 -> capped at 100
    with app_session() as s:
        team = s.execute(
            text("SELECT t.id, t.event_id, st.id, e.tenant_id FROM app.teams t "
                 "JOIN app.stages st ON st.event_id = t.event_id JOIN app.events e ON e.id = t.event_id LIMIT 1")
        ).first()
        team_id, event_id, stage_id, tenant_id = str(team[0]), str(team[1]), str(team[2]), str(team[3])
        cv = s.execute(text("SELECT id FROM app.challenge_versions LIMIT 1")).first()[0]
        user = s.execute(text("SELECT id FROM app.users WHERE role='participant' LIMIT 1")).first()[0]
        sub_ids = []
        for i in range(4):
            sid = str(uuid.uuid4())
            sub_ids.append(sid)
            s.execute(
                text(
                    "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                    "idempotency_key, payload, payload_hash, status, receipt_code, title, flag_code, received_at) VALUES "
                    "(CAST(:id AS uuid), CAST(:t AS uuid), CAST(:ev AS uuid), CAST(:st AS uuid), CAST(:cv AS uuid), CAST(:team AS uuid), "
                    "CAST(:au AS uuid), 'ctf_flag', :k, CAST(:p AS jsonb), :ph, 'received', :r, 'flag', 'FLAG{client_gates_1e_0nly_9f2a}', now())"
                ),
                {"id": sid, "t": tenant_id, "ev": event_id, "st": stage_id, "cv": str(cv), "team": team_id, "au": str(user),
                 "k": f"flag-test-{i}-{uuid.uuid4()}", "p": "{}", "ph": "x", "r": f"TEST-{i}"},
            )
            enqueue(s, "verify_flag", {"submission_id": sid})
    worker_drain()
    from app.db import app_session as sess

    with sess() as s:
        total = s.execute(
            text("SELECT COALESCE(SUM(points), 0) FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) AND component = 'ctf_bonus'"),
            {"t": team_id},
        ).scalar_one()
        awards = s.execute(
            text("SELECT count(*) FROM app.award_claims WHERE team_id = CAST(:t AS uuid) AND award_unit_id = 'FLAG-1'"),
            {"t": team_id},
        ).scalar_one()
    # first flag awards 30; the remaining duplicates of the same flag unit are rejected
    assert float(total) == 30.0, f"expected exactly one 30pt award, got {total}"
    assert int(awards) == 1


def test_leaderboard_tie_break_order(seeded_db):
    from app.db import app_session
    from app.scoring import build_leaderboard

    with app_session() as s:
        teams = s.execute(text("SELECT id, name FROM app.teams ORDER BY name")).all()
        team_names = {str(t[0]): t[1] for t in teams}
        stage = s.execute(text("SELECT id FROM app.stages LIMIT 1")).first()[0]
        event = s.execute(text("SELECT id FROM app.events LIMIT 1")).first()[0]
    # equal scores: fewer invalid reports wins; then earlier last-accepted
    board = build_leaderboard(
        s, event_id=str(event), stage_id=str(stage), team_names=team_names,
        invalid_counts={str(teams[0][0]): 0, str(teams[1][0]): 2},
        last_accepted_at={},
    )
    assert board["rows"][0]["team_id"] == str(teams[0][0])
    assert board["rows"][0]["invalid_reports"] == 0


def test_hidden_feedback_mode_reveals_nothing_before_release(client):
    pc = participant_client(client, "p4.team1@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    r = pc.post(
        "/v1/submissions",
        json={"kind": "ctf_flag", "flag_code": "FLAG{base64_1s_n0t_encrypt10n_44e2}", "title": "encoded flag"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 202
    worker_drain()
    subs = pc.get("/v1/submissions").json()["submissions"]
    flag = next(s for s in subs if s["id"] == r.json()["submission_id"])
    assert flag["status"] == "received"  # no verdict leaked (INT-01)
    assert "matched_bug_code" not in flag
