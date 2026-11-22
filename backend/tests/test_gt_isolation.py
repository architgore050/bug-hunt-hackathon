"""Ground-truth isolation: the app_api runtime role must not read gt (AT-08, DAT-03).

Connects with the REAL app_api credentials (no test shortcuts) and asserts the
permission boundary enforced by PostgreSQL itself.
"""
from __future__ import annotations

import psycopg
import pytest

from conftest import participant_client


APP_DSN = "postgresql://app_api:app_api_dev@127.0.0.1:5433/bughunt_test"
GT_DSN = "postgresql://gt_admin:gt_admin_dev@127.0.0.1:5433/bughunt_test"


def test_app_role_cannot_read_gt_bugs():
    with psycopg.connect(APP_DSN) as conn, conn.cursor() as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT * FROM gt.gt_bugs")
            cur.fetchall()


def test_app_role_cannot_read_gt_flags():
    with psycopg.connect(APP_DSN) as conn, conn.cursor() as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT code_hash FROM gt.gt_flags")
            cur.fetchall()


def test_app_role_cannot_write_gt():
    with psycopg.connect(APP_DSN) as conn, conn.cursor() as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("INSERT INTO gt.gt_aliases (id, bug_id, keyword, weight) VALUES (gen_random_uuid(), gen_random_uuid(), 'x', 1)")


def test_gt_admin_role_can_read_gt(seeded_db):
    with psycopg.connect(GT_DSN) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM gt.gt_bugs")
        assert cur.fetchone()[0] >= 10


def test_platform_never_serves_answer_key(client):
    pc = participant_client(client, "p1.team1@example.com")
    r = pc.get("/v1/assignments")
    files = r.json()["assignments"][0]["files"]
    names = [f["path"] for f in files]
    assert "ORGANIZER_ANSWER_KEY.md" not in names
    assert all(not n.startswith("ORGANIZER") for n in names)
