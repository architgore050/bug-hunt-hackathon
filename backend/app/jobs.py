"""Durable PostgreSQL-backed job queue (architecture 8.2, ADR-003).

- Claiming uses SELECT ... FOR UPDATE SKIP LOCKED with a lease; the claim is
  committed before work starts; long work never holds a row lock.
- Delivery is at-least-once; every handler is idempotent (unique constraints
  and claim tables enforce exactly-once business outcomes).
- Bounded retries with backoff; after max attempts the job goes to dead state
  and is surfaced in the admin health view.
"""
from __future__ import annotations

import traceback
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import app_session, uuid7

RETRY_BACKOFF_S = [10, 60, 300, 900]


def enqueue(session: Session, kind: str, payload: dict, *, max_attempts: int = 5) -> str:
    job_id = str(uuid7())
    session.execute(
        text(
            "INSERT INTO app.jobs (id, kind, payload, status, max_attempts) "
            "VALUES (:id, :kind, CAST(:payload AS jsonb), 'queued', :max_attempts)"
        ),
        {"id": job_id, "kind": kind, "payload": __import__("json").dumps(payload, default=str), "max_attempts": max_attempts},
    )
    return job_id


def claim_next(session: Session, *, lease_s: int = 120, kinds: list[str] | None = None) -> dict | None:
    now = datetime.now(timezone.utc)
    kind_filter = ""
    params: dict = {"now": now, "lease": lease_s}
    if kinds:
        kind_filter = "AND kind = ANY(:kinds)"
        params["kinds"] = kinds
    row = session.execute(
        text(
            "UPDATE app.jobs SET status='running', lease_until = :lease, attempts = attempts + 1, updated_at = :now "
            "WHERE id = (SELECT id FROM app.jobs WHERE status='queued' AND run_after <= :now "
            "AND (lease_until IS NULL OR lease_until < :now) "
            + kind_filter.replace("AND", "AND", 1)
            + " ORDER BY run_after, created_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING id, kind, payload, attempts, max_attempts"
        ),
        {**params, "lease": now + timedelta(seconds=lease_s)},
    ).mappings().first()
    return dict(row) if row else None


def complete(session: Session, job_id: str) -> None:
    session.execute(
        text("UPDATE app.jobs SET status='done', lease_until=NULL, updated_at=:now WHERE id=:id"),
        {"now": datetime.now(timezone.utc), "id": job_id},
    )


def fail(session: Session, job_id: str, error: str) -> None:
    row = session.execute(
        text("SELECT attempts, max_attempts, payload, kind FROM app.jobs WHERE id=:id FOR UPDATE"),
        {"id": job_id},
    ).first()
    if not row:
        return
    attempts, max_attempts = int(row.attempts), int(row.max_attempts)
    if attempts >= max_attempts:
        session.execute(
            text("UPDATE app.jobs SET status='dead', last_error=:e, lease_until=NULL, updated_at=:now WHERE id=:id"),
            {"e": error[:2000], "now": datetime.now(timezone.utc), "id": job_id},
        )
    else:
        backoff = RETRY_BACKOFF_S[min(attempts - 1, len(RETRY_BACKOFF_S) - 1)]
        session.execute(
            text(
                "UPDATE app.jobs SET status='queued', last_error=:e, run_after=:ra, lease_until=NULL, updated_at=:now WHERE id=:id"
            ),
            {"e": error[:2000], "ra": datetime.now(timezone.utc) + timedelta(seconds=backoff), "now": datetime.now(timezone.utc), "id": job_id},
        )


def requeue_expired_leases(session: Session) -> int:
    """Worker crash recovery: jobs whose lease expired go back to queued."""
    res = session.execute(
        text(
            "UPDATE app.jobs SET status='queued', lease_until=NULL, updated_at=:now "
            "WHERE status='running' AND lease_until < :now"
        ),
        {"now": datetime.now(timezone.utc)},
    )
    return res.rowcount or 0


# --- handler registry ---------------------------------------------------------


HANDLERS: dict[str, callable] = {}


def handler(kind: str):
    def deco(fn):
        HANDLERS[kind] = fn
        return fn

    return deco


def run_one_job() -> bool:
    """Claim and run exactly one job. Returns True when a job was processed."""
    with app_session() as session:
        job = claim_next(session)
        if not job:
            return False
        job_id = str(job["id"])
        kind = job["kind"]
        fn = HANDLERS.get(kind)
        if fn is None:
            fail(session, job_id, f"no handler for kind {kind}")
            return True
    # work happens OUTSIDE the claim transaction (architecture 8.2)
    try:
        fn(job["payload"])
        with app_session() as session:
            complete(session, job_id)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        with app_session() as session:
            fail(session, job_id, f"{e.__class__.__name__}: {e}")
    return True


def drain(max_jobs: int = 1000) -> int:
    n = 0
    for _ in range(max_jobs):
        if not run_one_job():
            break
        n += 1
    return n
