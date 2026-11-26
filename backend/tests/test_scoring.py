"""Scoring ledger integrity tests (AT-07, DAT-01, DAT-05, INT-01)."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import pytest
from conftest import APP_URL, participant_client, worker_drain
from sqlalchemy import text

APP_DSN = APP_URL.replace("+psycopg", "")


def test_compute_award_points_weights():
    from app.scoring import compute_award_points

    w = {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2}
    pts = compute_award_points(100, w, test_fraction=1.0, review_quality=1.0, evidence_quality=1.0)
    assert pts == {"functional_test": 50.0, "code_review": 30.0, "evidence_report": 20.0}
    pts = compute_award_points(100, w, test_fraction=0.5, review_quality=0.0, evidence_quality=0.5)
    assert pts["functional_test"] == 25.0 and pts["code_review"] == 0.0 and pts["evidence_report"] == 10.0


def test_ledger_is_database_enforced_append_only(seeded_db):
    """Ledger corrections are reversal rows; UPDATE and DELETE are rejected by PostgreSQL."""
    from app.db import app_session
    from app.scoring import add_ledger_entry

    with app_session() as s:
        team = s.execute(
            text(
                "SELECT t.id, t.event_id, st.id, e.tenant_id FROM app.teams t "
                "JOIN app.stages st ON st.event_id = t.event_id JOIN app.events e ON e.id = t.event_id LIMIT 1"
            )
        ).first()
        entry_id = add_ledger_entry(
            s,
            tenant_id=str(team[3]),
            event_id=str(team[1]),
            stage_id=str(team[2]),
            team_id=str(team[0]),
            component="adjustment",
            kind="adjustment",
            points=-5.0,
            reason_code="TEST_REVERSAL",
        )
        reversal_id = add_ledger_entry(
            s,
            tenant_id=str(team[3]),
            event_id=str(team[1]),
            stage_id=str(team[2]),
            team_id=str(team[0]),
            component="adjustment",
            kind="reversal",
            points=5.0,
            reason_code="TEST_REVERSAL",
            reverses_entry_id=entry_id,
        )
        s.flush()
        reversal = s.execute(
            text("SELECT reverses_entry_id FROM app.score_ledger_entries WHERE id = CAST(:i AS uuid)"),
            {"i": reversal_id},
        ).scalar_one()
        assert str(reversal) == entry_id

    # Exercise the application DB role, not the migration/table-owner role.
    with psycopg.connect(APP_DSN, autocommit=True) as conn:
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            conn.execute(
                "UPDATE app.score_ledger_entries SET points = 999 WHERE id = %s",
                (entry_id,),
            )
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            conn.execute("DELETE FROM app.score_ledger_entries WHERE id = %s", (entry_id,))
        stored_points = conn.execute(
            "SELECT points FROM app.score_ledger_entries WHERE id = %s",
            (entry_id,),
        ).fetchone()[0]

    assert float(stored_points) == -5.0


def test_award_claim_uniqueness_blocks_double_award(seeded_db):
    """Two independent transactions racing for one unit produce exactly one claim."""
    from app.db import app_session
    from app.scoring import claim_award_unit

    with app_session() as s:
        team = s.execute(
            text(
                "SELECT t.id, t.event_id, st.id, e.tenant_id FROM app.teams t "
                "JOIN app.stages st ON st.event_id = t.event_id JOIN app.events e ON e.id = t.event_id LIMIT 1"
            )
        ).first()
        team_id, event_id, stage_id, tenant_id = str(team[0]), str(team[1]), str(team[2]), str(team[3])
        challenge_version_id = str(s.execute(text("SELECT id FROM app.challenge_versions LIMIT 1")).scalar_one())
        user_id = str(s.execute(text("SELECT id FROM app.users WHERE role='participant' LIMIT 1")).scalar_one())
        submission_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        for submission_id in submission_ids:
            s.execute(
                text(
                    "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                    "idempotency_key, payload, payload_hash, status, receipt_code, title, received_at) VALUES "
                    "(CAST(:id AS uuid), CAST(:t AS uuid), CAST(:ev AS uuid), CAST(:st AS uuid), CAST(:cv AS uuid), CAST(:team AS uuid), "
                    "CAST(:au AS uuid), 'bug_report', :k, CAST(:p AS jsonb), 'x', 'received', :r, 'claim test', now())"
                ),
                {
                    "id": submission_id,
                    "t": tenant_id,
                    "ev": event_id,
                    "st": stage_id,
                    "cv": challenge_version_id,
                    "team": team_id,
                    "au": user_id,
                    "k": f"claim-{submission_id[:8]}",
                    "p": "{}",
                    "r": submission_id[:8].upper(),
                },
            )

    start = Barrier(2)

    def attempt_claim(submission_id: str) -> bool:
        with app_session() as session:
            start.wait(timeout=10)
            return claim_award_unit(
                session,
                event_id=event_id,
                stage_id=stage_id,
                team_id=team_id,
                award_unit_id="TEST-UNIT-CONCURRENT",
                submission_id=submission_id,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt_claim, submission_ids))

    assert sorted(results) == [False, True]
    with app_session() as s:
        claim_count = s.execute(
            text(
                "SELECT count(*) FROM app.award_claims "
                "WHERE stage_id = CAST(:stage AS uuid) AND team_id = CAST(:team AS uuid) "
                "AND award_unit_id = 'TEST-UNIT-CONCURRENT'"
            ),
            {"stage": stage_id, "team": team_id},
        ).scalar_one()
    assert int(claim_count) == 1


def test_ctf_bonus_is_capped(seeded_db):
    """Four distinct valid flags worth 30 each are capped at 100 points."""
    from app.db import app_session, gt_session
    from app.jobs import enqueue
    from app.security import flag_code_hash

    with app_session() as s:
        team = s.execute(
            text(
                "SELECT t.id, t.event_id, st.id, e.tenant_id FROM app.teams t "
                "JOIN app.stages st ON st.event_id = t.event_id JOIN app.events e ON e.id = t.event_id LIMIT 1"
            )
        ).first()
        team_id, event_id, stage_id, tenant_id = str(team[0]), str(team[1]), str(team[2]), str(team[3])
        challenge_version_id = str(s.execute(text("SELECT id FROM app.challenge_versions LIMIT 1")).scalar_one())
        user_id = str(s.execute(text("SELECT id FROM app.users WHERE role='participant' LIMIT 1")).scalar_one())

    flags = [
        ("FLAG-1", "FLAG{client_gates_1e_0nly_9f2a}"),
        ("FLAG-2", "FLAG{base64_1s_n0t_encrypt10n_44e2}"),
        ("TEST-CAP-3", "FLAG{cap_test_distinct_3_c7a1}"),
        ("TEST-CAP-4", "FLAG{cap_test_distinct_4_d8b2}"),
    ]
    with gt_session() as gt:
        for flag_key, code in flags[2:]:
            gt.execute(
                text(
                    "INSERT INTO gt.gt_flags "
                    "(id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                    "VALUES (CAST(:id AS uuid), CAST(:challenge AS uuid), :key, :hash, 30, 99)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "challenge": challenge_version_id,
                    "key": flag_key,
                    "hash": flag_code_hash(code),
                },
            )

    with app_session() as s:
        for index, (_, code) in enumerate(flags):
            submission_id = str(uuid.uuid4())
            s.execute(
                text(
                    "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                    "idempotency_key, payload, payload_hash, status, receipt_code, title, flag_code, received_at) VALUES "
                    "(CAST(:id AS uuid), CAST(:t AS uuid), CAST(:ev AS uuid), CAST(:st AS uuid), CAST(:cv AS uuid), CAST(:team AS uuid), "
                    "CAST(:au AS uuid), 'ctf_flag', :k, CAST(:p AS jsonb), :ph, 'received', :r, 'flag', :flag, now())"
                ),
                {
                    "id": submission_id,
                    "t": tenant_id,
                    "ev": event_id,
                    "st": stage_id,
                    "cv": challenge_version_id,
                    "team": team_id,
                    "au": user_id,
                    "k": f"flag-cap-{index}-{uuid.uuid4()}",
                    "p": "{}",
                    "ph": "x",
                    "r": f"CAP-{index}",
                    "flag": code,
                },
            )
            enqueue(s, "verify_flag", {"submission_id": submission_id})

    worker_drain()

    with app_session() as s:
        awards = s.execute(
            text(
                "SELECT award_unit_id, points FROM app.score_ledger_entries "
                "WHERE stage_id = CAST(:stage AS uuid) AND team_id = CAST(:team AS uuid) "
                "AND component = 'ctf_bonus' ORDER BY award_unit_id"
            ),
            {"stage": stage_id, "team": team_id},
        ).all()

    assert len(awards) == 4
    assert sorted(float(row.points) for row in awards) == [10.0, 30.0, 30.0, 30.0]
    assert round(sum(float(row.points) for row in awards), 2) == 100.0


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
        s,
        event_id=str(event),
        stage_id=str(stage),
        team_names=team_names,
        invalid_counts={str(teams[0][0]): 0, str(teams[1][0]): 2},
        last_accepted_at={},
    )
    assert board["rows"][0]["team_id"] == str(teams[0][0])
    assert board["rows"][0]["invalid_reports"] == 0
