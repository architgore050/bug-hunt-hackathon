"""Scoring ledger integrity tests (AT-07, DAT-01, DAT-05, INT-01)."""

from __future__ import annotations

import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import pytest
from conftest import APP_URL, worker_drain
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


@pytest.fixture()
def ctf_flag_scenario(seeded_db, request):
    """Queue unique flags for real teams against a dynamically selected challenge version."""
    from app.db import app_session, gt_session
    from app.jobs import enqueue
    from app.security import flag_code_hash

    config = getattr(request, "param", {})
    team_count = int(config.get("team_count", 1))
    flag_count = int(config.get("flag_count", 4))
    max_awards = int(config.get("max_awards", flag_count))

    with app_session() as s:
        event = (
            s.execute(
                text(
                    "SELECT e.id AS event_id, e.tenant_id AS tenant_id, st.id AS stage_id "
                    "FROM app.events e JOIN app.stages st ON st.event_id = e.id AND st.kind = 'main' "
                    "ORDER BY e.id, st.ordinal LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
        event_id, tenant_id, stage_id = str(event["event_id"]), str(event["tenant_id"]), str(event["stage_id"])
        members = (
            s.execute(
                text(
                    "SELECT t.id AS team_id, tm.user_id AS user_id FROM app.teams t "
                    "JOIN app.team_members tm ON tm.team_id = t.id "
                    "WHERE t.event_id = CAST(:event AS uuid) ORDER BY t.id, tm.user_id"
                ),
                {"event": event_id},
            )
            .mappings()
            .all()
        )
        submitters = []
        seen_teams = set()
        for member in members:
            team_id = str(member["team_id"])
            if team_id not in seen_teams:
                submitters.append((team_id, str(member["user_id"])))
                seen_teams.add(team_id)
                if len(submitters) == team_count:
                    break
        assert len(submitters) == team_count
        challenge_version_id = str(
            s.execute(
                text("SELECT id FROM app.challenge_versions WHERE event_id = CAST(:event AS uuid) ORDER BY id LIMIT 1"),
                {"event": event_id},
            ).scalar_one()
        )

    run_id = uuid.uuid4().hex[:12]
    flags = [(f"TEST-CAP-{run_id}-{index}", f"FLAG{{ctf_cap_{run_id}_{index}}}") for index in range(flag_count)]
    flag_unit_ids = []
    with gt_session() as gt:
        for flag_key, code in flags:
            flag_row_id = str(uuid.uuid4())
            gt.execute(
                text(
                    "INSERT INTO gt.gt_flags "
                    "(id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                    "VALUES (CAST(:id AS uuid), CAST(:challenge AS uuid), :key, :hash, 30, :max_awards)"
                ),
                {
                    "id": flag_row_id,
                    "challenge": challenge_version_id,
                    "key": flag_key,
                    "hash": flag_code_hash(code),
                    "max_awards": max_awards,
                },
            )
            flag_unit_ids.append(flag_row_id)

    submissions = []
    with app_session() as s:
        submission_index = 0
        for team_id, user_id in submitters:
            for flag_key, code in flags:
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
                        "k": f"flag-cap-{run_id}-{submission_index}",
                        "p": "{}",
                        "ph": "x",
                        "r": f"CAP-{run_id[:8]}{submission_index:02d}",
                        "flag": code,
                    },
                )
                enqueue(s, "verify_flag", {"submission_id": submission_id})
                submissions.append((flag_key, team_id, submission_id))
                submission_index += 1

    return {
        "stage_id": stage_id,
        "team_ids": [team_id for team_id, _ in submitters],
        "flag_unit_ids": flag_unit_ids,
        "submissions": submissions,
    }


def test_ctf_bonus_is_capped(ctf_flag_scenario):
    """Four distinct valid flags worth 30 each are capped at 100 points."""
    from app.db import app_session

    worker_drain()
    stage_id = ctf_flag_scenario["stage_id"]
    team_id = ctf_flag_scenario["team_ids"][0]
    with app_session() as s:
        awards = s.execute(
            text(
                "SELECT award_unit_id, points FROM app.score_ledger_entries "
                "WHERE stage_id = CAST(:stage AS uuid) AND team_id = CAST(:team AS uuid) "
                "AND component = 'ctf_bonus' ORDER BY award_unit_id"
            ),
            {"stage": stage_id, "team": team_id},
        ).all()

    assert {row.award_unit_id for row in awards} == set(ctf_flag_scenario["flag_unit_ids"])
    assert sorted(float(row.points) for row in awards) == [10.0, 30.0, 30.0, 30.0]
    assert round(sum(float(row.points) for row in awards), 2) == 100.0


def test_ctf_bonus_cap_holds_for_concurrent_verification(ctf_flag_scenario):
    """Concurrent workers must serialize the cap read and ledger write for each team."""
    from app import evaluator
    from app.db import app_session

    stage_id = ctf_flag_scenario["stage_id"]
    team_id = ctf_flag_scenario["team_ids"][0]
    submissions = ctf_flag_scenario["submissions"]

    with app_session() as blocker:
        blocker.execute(text("SELECT id FROM app.teams WHERE id = CAST(:team AS uuid) FOR UPDATE"), {"team": team_id})
        # Without the team lock every worker can read the same total before
        # any insert. Blocking inserts makes that regression deterministic.
        blocker.execute(text("LOCK TABLE app.score_ledger_entries IN SHARE MODE"))
        with ThreadPoolExecutor(max_workers=len(submissions)) as pool:
            futures = [
                pool.submit(evaluator.verify_flag, {"submission_id": submission_id})
                for _, _, submission_id in submissions
            ]
            try:
                deadline = time.monotonic() + 5
                with app_session() as observer:
                    while time.monotonic() < deadline:
                        waiters = (
                            observer.execute(
                                text(
                                    "SELECT "
                                    "count(DISTINCT l.pid) FILTER (WHERE c.relname = 'teams' AND NOT l.granted) AS team_waiters, "
                                    "count(DISTINCT l.pid) FILTER (WHERE c.relname = 'score_ledger_entries' "
                                    "AND NOT l.granted) AS ledger_waiters "
                                    "FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation "
                                    "LEFT JOIN pg_namespace n ON n.oid = c.relnamespace "
                                    "WHERE n.nspname = 'app' AND c.relname IN ('teams', 'score_ledger_entries')"
                                )
                            )
                            .mappings()
                            .one()
                        )
                        if (
                            int(waiters["team_waiters"]) > 0
                            or int(waiters["ledger_waiters"]) == len(submissions)
                            or all(f.done() for f in futures)
                        ):
                            break
                        time.sleep(0.01)
            finally:
                blocker.commit()

    for future in futures:
        future.result(timeout=10)

    with app_session() as s:
        awards = s.execute(
            text(
                "SELECT points FROM app.score_ledger_entries "
                "WHERE stage_id = CAST(:stage AS uuid) AND team_id = CAST(:team AS uuid) "
                "AND component = 'ctf_bonus'"
            ),
            {"stage": stage_id, "team": team_id},
        ).all()

    assert sorted(float(row.points) for row in awards) == [10.0, 30.0, 30.0, 30.0]
    assert round(sum(float(row.points) for row in awards), 2) == 100.0


@pytest.mark.parametrize(
    "ctf_flag_scenario",
    [{"team_count": 2, "flag_count": 1, "max_awards": 1}],
    indirect=True,
)
def test_flag_max_awards_holds_for_concurrent_teams(ctf_flag_scenario):
    """Only one team can claim the final available award for a shared flag."""
    from app import evaluator
    from app.db import app_session

    stage_id = ctf_flag_scenario["stage_id"]
    flag_unit_id = ctf_flag_scenario["flag_unit_ids"][0]
    submissions = ctf_flag_scenario["submissions"]

    with app_session() as blocker:
        blocker.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended('ctf_flag:' || :u, 0))"),
            {"u": flag_unit_id},
        )
        # Without the advisory lock both workers can read max_awards=1 before
        # either insert. This lock forces them to reach that race deterministically.
        blocker.execute(text("LOCK TABLE app.award_claims IN SHARE MODE"))
        with ThreadPoolExecutor(max_workers=len(submissions)) as pool:
            futures = [
                pool.submit(evaluator.verify_flag, {"submission_id": submission_id})
                for _, _, submission_id in submissions
            ]
            try:
                deadline = time.monotonic() + 5
                with app_session() as observer:
                    while time.monotonic() < deadline:
                        waiters = (
                            observer.execute(
                                text(
                                    "SELECT "
                                    "count(DISTINCT l.pid) FILTER (WHERE l.locktype = 'advisory' AND NOT l.granted) AS advisory_waiters, "
                                    "count(DISTINCT l.pid) FILTER (WHERE l.locktype = 'relation' AND c.relname = 'award_claims' "
                                    "AND NOT l.granted) AS claim_waiters "
                                    "FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation "
                                    "LEFT JOIN pg_namespace n ON n.oid = c.relnamespace "
                                    "WHERE l.locktype = 'advisory' OR (n.nspname = 'app' AND c.relname = 'award_claims')"
                                )
                            )
                            .mappings()
                            .one()
                        )
                        if (
                            int(waiters["advisory_waiters"]) == len(submissions)
                            or int(waiters["claim_waiters"]) == len(submissions)
                            or all(f.done() for f in futures)
                        ):
                            break
                        time.sleep(0.01)
            finally:
                blocker.commit()

    for future in futures:
        future.result(timeout=10)

    with app_session() as s:
        claim_count = s.execute(
            text("SELECT count(*) FROM app.award_claims WHERE award_unit_id = :u"),
            {"u": flag_unit_id},
        ).scalar_one()
        awards = s.execute(
            text(
                "SELECT points FROM app.score_ledger_entries "
                "WHERE stage_id = CAST(:stage AS uuid) AND component = 'ctf_bonus'"
            ),
            {"stage": stage_id},
        ).all()
        statuses = (
            s.execute(
                text("SELECT status FROM app.submissions WHERE stage_id = CAST(:stage AS uuid) AND kind = 'ctf_flag'"),
                {"stage": stage_id},
            )
            .scalars()
            .all()
        )

    assert int(claim_count) == 1
    assert [float(row.points) for row in awards] == [30.0]
    assert sorted(statuses) == ["duplicate", "matched_auto"]


def test_verify_flag_redelivery_keeps_awarded_status(seeded_db):
    """Redelivery after the scoring commit must not flip a paid flag to duplicate."""
    from app import evaluator
    from app.db import app_session, gt_session
    from app.security import flag_code_hash

    with app_session() as s:
        event = (
            s.execute(
                text(
                    "SELECT e.id AS event_id, e.tenant_id AS tenant_id, st.id AS stage_id "
                    "FROM app.events e JOIN app.stages st ON st.event_id = e.id AND st.kind = 'main' "
                    "ORDER BY e.id, st.ordinal LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
        event_id, tenant_id, stage_id = str(event["event_id"]), str(event["tenant_id"]), str(event["stage_id"])
        member = (
            s.execute(
                text(
                    "SELECT t.id AS team_id, tm.user_id AS user_id FROM app.teams t "
                    "JOIN app.team_members tm ON tm.team_id = t.id "
                    "WHERE t.event_id = CAST(:event AS uuid) ORDER BY t.id, tm.user_id LIMIT 1"
                ),
                {"event": event_id},
            )
            .mappings()
            .one()
        )
        team_id, user_id = str(member["team_id"]), str(member["user_id"])
        challenge_version_id = str(
            s.execute(
                text("SELECT id FROM app.challenge_versions WHERE event_id = CAST(:event AS uuid) ORDER BY id LIMIT 1"),
                {"event": event_id},
            ).scalar_one()
        )

    flag_key = f"TEST-RETRY-{uuid.uuid4().hex[:12]}"
    code = f"FLAG{{retry_{uuid.uuid4().hex[:8]}}}"
    flag_row_id = str(uuid.uuid4())
    with gt_session() as gt:
        gt.execute(
            text(
                "INSERT INTO gt.gt_flags "
                "(id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                "VALUES (CAST(:id AS uuid), CAST(:challenge AS uuid), :key, :hash, 30, 1)"
            ),
            {
                "id": flag_row_id,
                "challenge": challenge_version_id,
                "key": flag_key,
                "hash": flag_code_hash(code),
            },
        )

    submission_id = str(uuid.uuid4())
    with app_session() as s:
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
                "k": f"flag-retry-{submission_id[:8]}",
                "p": "{}",
                "ph": "x",
                "r": f"RETRY-{submission_id[:8].upper()}",
                "flag": code,
            },
        )

    # First delivery scores and pays the flag. A worker crash between the
    # scoring commit and jobs.complete() redelivers the same job.
    evaluator.verify_flag({"submission_id": submission_id})
    evaluator.verify_flag({"submission_id": submission_id})

    with app_session() as s:
        sub = (
            s.execute(
                text("SELECT status, matched_bug_code FROM app.submissions WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            .mappings()
            .one()
        )
        ledger_rows = s.execute(
            text(
                "SELECT count(*) FROM app.score_ledger_entries "
                "WHERE submission_id = CAST(:sid AS uuid) AND component = 'ctf_bonus'"
            ),
            {"sid": submission_id},
        ).scalar_one()
        claim_rows = s.execute(
            text("SELECT count(*) FROM app.award_claims WHERE submission_id = CAST(:sid AS uuid)"),
            {"sid": submission_id},
        ).scalar_one()

    assert sub["status"] == "matched_auto"
    assert sub["matched_bug_code"] == flag_key
    assert int(ledger_rows) == 1
    assert int(claim_rows) == 1


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
