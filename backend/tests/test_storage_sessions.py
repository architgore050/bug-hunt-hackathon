"""Database session atomicity, clock, identifiers, and real readiness probes."""

from __future__ import annotations

import uuid

import pytest
from app.db import app_session, db_now, gt_session, health_probe, short_code, uuid7
from app.jobs import enqueue
from sqlalchemy import text


def test_app_session_rolls_back_all_writes_when_body_raises(seeded_db):
    job_id = uuid.uuid4()
    outbox_id = uuid.uuid4()
    with pytest.raises(RuntimeError, match="rollback app probe"):
        with app_session() as session:
            session.execute(
                text(
                    "INSERT INTO app.jobs (id, kind, payload, status, max_attempts) "
                    "VALUES (CAST(:id AS uuid), 'rollback-probe', '{}', 'queued', 1)"
                ),
                {"id": str(job_id)},
            )
            session.execute(
                text(
                    "INSERT INTO app.outbox_events (id, event_type, payload) "
                    "VALUES (CAST(:id AS uuid), 'rollback.probe', '{}')"
                ),
                {"id": str(outbox_id)},
            )
            raise RuntimeError("rollback app probe")

    with app_session() as session:
        job_count = session.execute(
            text("SELECT count(*) FROM app.jobs WHERE id = CAST(:id AS uuid)"), {"id": str(job_id)}
        ).scalar_one()
        outbox_count = session.execute(
            text("SELECT count(*) FROM app.outbox_events WHERE id = CAST(:id AS uuid)"), {"id": str(outbox_id)}
        ).scalar_one()
    assert job_count == 0
    assert outbox_count == 0


def test_gt_session_rolls_back_synthetic_ground_truth_write(seeded_db):
    flag_id = uuid.uuid4()
    with pytest.raises(RuntimeError, match="rollback gt probe"):
        with gt_session() as session:
            version = session.execute(text("SELECT challenge_version_id FROM gt.gt_flags LIMIT 1")).scalar_one()
            session.execute(
                text(
                    "INSERT INTO gt.gt_flags "
                    "(id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                    "VALUES (CAST(:id AS uuid), CAST(:version AS uuid), :key, :hash, 10, 1)"
                ),
                {
                    "id": str(flag_id),
                    "version": str(version),
                    "key": "ROLLBACK-PROBE",
                    "hash": uuid.uuid4().hex,
                },
            )
            raise RuntimeError("rollback gt probe")

    with gt_session() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM gt.gt_flags WHERE id = CAST(:id AS uuid)"), {"id": str(flag_id)}
            ).scalar_one()
            == 0
        )


def test_app_session_commits_a_complete_job(seeded_db):
    with app_session() as session:
        job_id = enqueue(session, "commit-probe", {"durable": True}, max_attempts=2)

    with app_session() as session:
        row = (
            session.execute(
                text("SELECT kind, payload, status, attempts, max_attempts FROM app.jobs WHERE id = CAST(:id AS uuid)"),
                {"id": job_id},
            )
            .mappings()
            .one()
        )
    assert row["kind"] == "commit-probe"
    assert row["payload"] == {"durable": True}
    assert row["status"] == "queued"
    assert row["attempts"] == 0
    assert row["max_attempts"] == 2


def test_database_clock_and_identifier_helpers_are_well_formed(seeded_db):
    with app_session() as session:
        first = db_now(session)
        second = session.execute(text("SELECT clock_timestamp()")).scalar_one()
    assert first.tzinfo is not None
    assert second.tzinfo is not None
    assert second >= first

    identifiers = [uuid7() for _ in range(100)]
    assert len(set(identifiers)) == 100
    assert all(identifier.version == 7 for identifier in identifiers)
    assert all(identifier.variant == uuid.RFC_4122 for identifier in identifiers)
    codes = [short_code(12) for _ in range(20)]
    assert all(len(code) == 12 for code in codes)
    assert set("".join(codes)) <= set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")


def test_health_probe_reports_both_real_database_connections(seeded_db):
    probe = health_probe()
    assert probe["database_app"] == "up"
    assert probe["database_gt"] == "up"
    assert probe["clock"] is not None
    assert "database_app_error" not in probe
    assert "database_gt_error" not in probe
