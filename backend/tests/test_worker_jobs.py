"""Durable queue behavior against the real application database."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from app import jobs
from app.db import AppSession, app_session
from sqlalchemy import text


@pytest.fixture()
def frozen_job_clock(monkeypatch):
    fixed = datetime(2026, 11, 28, 12, 0, tzinfo=UTC)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed.replace(tzinfo=None)
            return fixed.astimezone(tz)

    monkeypatch.setattr(jobs, "datetime", FrozenDateTime)
    return fixed


def _job(job_id: str) -> dict:
    with app_session() as session:
        row = (
            session.execute(text("SELECT * FROM app.jobs WHERE id = CAST(:id AS uuid)"), {"id": job_id})
            .mappings()
            .one()
        )
    return dict(row)


def test_claim_filters_kind_and_due_unleased_jobs_then_persists_lease(seeded_db, frozen_job_clock):
    with app_session() as session:
        other = jobs.enqueue(session, "other", {"source": "wrong kind"})
        eligible = jobs.enqueue(session, "wanted", {"source": "eligible"}, max_attempts=3)
        future = jobs.enqueue(session, "wanted", {"source": "future"})
        leased = jobs.enqueue(session, "wanted", {"source": "leased"})
        session.execute(
            text("UPDATE app.jobs SET run_after = :time WHERE id = CAST(:id AS uuid)"),
            {"id": other, "time": frozen_job_clock - timedelta(hours=2)},
        )
        session.execute(
            text("UPDATE app.jobs SET run_after = :time WHERE id = CAST(:id AS uuid)"),
            {"id": eligible, "time": frozen_job_clock - timedelta(hours=1)},
        )
        session.execute(
            text("UPDATE app.jobs SET run_after = :time WHERE id = CAST(:id AS uuid)"),
            {"id": future, "time": frozen_job_clock + timedelta(hours=1)},
        )
        session.execute(
            text("UPDATE app.jobs SET run_after = :time, lease_until = :lease WHERE id = CAST(:id AS uuid)"),
            {
                "id": leased,
                "time": frozen_job_clock - timedelta(hours=1),
                "lease": frozen_job_clock + timedelta(hours=1),
            },
        )

    with app_session() as session:
        claimed = jobs.claim_next(session, lease_s=45, kinds=["wanted"])

    assert claimed is not None
    assert claimed["id"] == uuid.UUID(eligible)
    assert claimed["kind"] == "wanted"
    assert claimed["payload"] == {"source": "eligible"}
    assert claimed["attempts"] == 1
    assert claimed["max_attempts"] == 3

    stored = _job(eligible)
    assert stored["status"] == "running"
    assert stored["attempts"] == 1
    assert stored["lease_until"] == frozen_job_clock + timedelta(seconds=45)
    assert stored["updated_at"] == frozen_job_clock
    assert _job(other)["status"] == "queued"
    assert _job(other)["attempts"] == 0
    assert _job(future)["status"] == "queued"
    assert _job(leased)["status"] == "queued"
    assert _job(leased)["attempts"] == 0


def test_claim_accepts_an_expired_lease_on_a_queued_job(seeded_db, frozen_job_clock):
    with app_session() as session:
        recoverable = jobs.enqueue(session, "recover", {"attempt": "old"})
        blocked = jobs.enqueue(session, "recover", {"attempt": "blocked"})
        session.execute(
            text(
                "UPDATE app.jobs SET run_after = :time, "
                "lease_until = CASE WHEN id = CAST(:recoverable AS uuid) THEN :expired ELSE :future END, "
                "attempts = CASE WHEN id = CAST(:recoverable AS uuid) THEN 2 ELSE 0 END "
                "WHERE id IN (CAST(:recoverable AS uuid), CAST(:blocked AS uuid))"
            ),
            {
                "time": frozen_job_clock - timedelta(minutes=1),
                "recoverable": recoverable,
                "blocked": blocked,
                "expired": frozen_job_clock - timedelta(seconds=1),
                "future": frozen_job_clock + timedelta(seconds=30),
            },
        )

    with app_session() as session:
        claimed = jobs.claim_next(session, kinds=["recover"])

    assert claimed is not None
    assert claimed["id"] == uuid.UUID(recoverable)
    assert claimed["attempts"] == 3
    assert _job(recoverable)["status"] == "running"
    assert _job(blocked)["status"] == "queued"
    assert _job(blocked)["attempts"] == 0


def test_concurrent_claim_skips_an_uncommitted_locked_job(seeded_db):
    with app_session() as session:
        first_id = jobs.enqueue(session, "concurrent", {"sequence": 1})
        second_id = jobs.enqueue(session, "concurrent", {"sequence": 2})

    def claim_in_new_transaction():
        with app_session() as session:
            return jobs.claim_next(session, kinds=["concurrent"])

    holder = AppSession()
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        first = jobs.claim_next(holder, kinds=["concurrent"])
        assert first is not None
        second = pool.submit(claim_in_new_transaction).result(timeout=10)
        holder.commit()
    finally:
        # Always release the first row lock before waiting for the worker. A
        # regression without SKIP LOCKED then fails by timeout, not deadlock.
        holder.rollback()
        pool.shutdown(wait=True)
        holder.close()

    assert second is not None
    assert first["id"] != second["id"]
    assert {str(first["id"]), str(second["id"])} == {first_id, second_id}
    assert first["attempts"] == second["attempts"] == 1
    assert _job(first_id)["status"] == "running"
    assert _job(second_id)["status"] == "running"
    assert _job(first_id)["lease_until"] is not None
    assert _job(second_id)["lease_until"] is not None


def test_retry_backoff_saturates_and_dead_letters_at_max_attempts(seeded_db, frozen_job_clock):
    error = "failure detail " + "x" * 2100
    expected_backoffs = [10, 60, 300, 900, 900, 900]
    with app_session() as session:
        job_id = jobs.enqueue(session, "retry", {}, max_attempts=7)
        session.execute(
            text("UPDATE app.jobs SET run_after = :time WHERE id = CAST(:id AS uuid)"),
            {"id": job_id, "time": frozen_job_clock - timedelta(seconds=1)},
        )

    for attempt, backoff in enumerate(expected_backoffs, start=1):
        with app_session() as session:
            claimed = jobs.claim_next(session, kinds=["retry"])
            assert claimed is not None
            assert claimed["attempts"] == attempt
            jobs.fail(session, job_id, error)

        stored = _job(job_id)
        assert stored["status"] == "queued"
        assert stored["attempts"] == attempt
        assert stored["run_after"] == frozen_job_clock + timedelta(seconds=backoff)
        assert stored["lease_until"] is None
        assert stored["last_error"] == error[:2000]
        with app_session() as session:
            session.execute(
                text("UPDATE app.jobs SET run_after = :time WHERE id = CAST(:id AS uuid)"),
                {"id": job_id, "time": frozen_job_clock - timedelta(seconds=1)},
            )

    with app_session() as session:
        final_claim = jobs.claim_next(session, kinds=["retry"])
        assert final_claim is not None
        assert final_claim["attempts"] == 7
        jobs.fail(session, job_id, error)

    dead = _job(job_id)
    assert dead["status"] == "dead"
    assert dead["attempts"] == 7
    assert dead["lease_until"] is None
    assert dead["last_error"] == error[:2000]
    with app_session() as session:
        assert jobs.claim_next(session, kinds=["retry"]) is None


def test_requeue_expired_leases_preserves_attempts_and_other_states(seeded_db, frozen_job_clock):
    with app_session() as session:
        expired = jobs.enqueue(session, "lease", {})
        active = jobs.enqueue(session, "lease", {})
        queued = jobs.enqueue(session, "lease", {})
        session.execute(
            text(
                "UPDATE app.jobs SET status = 'running', attempts = 2, lease_until = :expired "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": expired, "expired": frozen_job_clock - timedelta(seconds=1)},
        )
        session.execute(
            text(
                "UPDATE app.jobs SET status = 'running', attempts = 1, lease_until = :future "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": active, "future": frozen_job_clock + timedelta(seconds=30)},
        )

    with app_session() as session:
        assert jobs.requeue_expired_leases(session) == 1

    assert _job(expired)["status"] == "queued"
    assert _job(expired)["attempts"] == 2
    assert _job(expired)["lease_until"] is None
    assert _job(active)["status"] == "running"
    assert _job(active)["attempts"] == 1
    assert _job(queued)["status"] == "queued"


def test_unknown_handler_dead_letters_without_inventing_an_outcome(seeded_db, monkeypatch):
    kind = f"missing-{uuid.uuid4().hex}"
    monkeypatch.delitem(jobs.HANDLERS, kind, raising=False)
    with app_session() as session:
        job_id = jobs.enqueue(session, kind, {"untrusted": True}, max_attempts=1)

    assert jobs.run_one_job() is True
    stored = _job(job_id)
    assert stored["status"] == "dead"
    assert stored["attempts"] == 1
    assert stored["last_error"] == f"no handler for kind {kind}"
    assert jobs.run_one_job() is False


def test_drain_stops_at_its_bound_and_leaves_remaining_jobs_queued(seeded_db, monkeypatch):
    kind = f"bounded-{uuid.uuid4().hex}"
    handled: list[int] = []
    monkeypatch.setitem(jobs.HANDLERS, kind, lambda payload: handled.append(payload["sequence"]))
    with app_session() as session:
        job_ids = [jobs.enqueue(session, kind, {"sequence": number}, max_attempts=1) for number in range(1, 5)]

    assert jobs.drain(max_jobs=2) == 2
    assert sorted(handled) == [1, 2]
    assert sum(_job(job_id)["status"] == "done" for job_id in job_ids) == 2
    assert sum(_job(job_id)["status"] == "queued" for job_id in job_ids) == 2

    assert jobs.drain(max_jobs=10) == 2
    assert sorted(handled) == [1, 2, 3, 4]
    assert all(_job(job_id)["status"] == "done" for job_id in job_ids)
    assert all(_job(job_id)["lease_until"] is None for job_id in job_ids)
    assert jobs.drain(max_jobs=0) == 0
    assert sorted(handled) == [1, 2, 3, 4]
