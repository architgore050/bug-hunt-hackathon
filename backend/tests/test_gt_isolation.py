"""Ground-truth isolation: the app_api runtime role must not read gt (AT-08, DAT-03).

Connects with the REAL app_api credentials (no test shortcuts) and asserts the
permission boundary enforced by PostgreSQL itself.
"""

from __future__ import annotations

import psycopg
import pytest
from conftest import APP_URL, GT_URL, participant_client

# Same DSNs as conftest (PGPORT-aware), in plain libpq form for psycopg.
APP_DSN = APP_URL.replace("+psycopg", "")
GT_DSN = GT_URL.replace("+psycopg", "")


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
            cur.execute(
                "INSERT INTO gt.gt_aliases (id, bug_id, keyword, weight) VALUES (gen_random_uuid(), gen_random_uuid(), 'x', 1)"
            )


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


def test_prerelease_submission_status_masked(client):
    pc = participant_client(client, "p1.team1@example.com")
    st = pc.get("/v1/state").json()
    stage_id = st["stage"]["id"]
    cv_id = pc.get("/v1/assignments").json()["assignments"][0]["challenge_version_id"]
    with psycopg.connect(GT_DSN) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, "
            "author_id, kind, idempotency_key, payload, payload_hash, status, receipt_code, feedback_released) "
            "SELECT gen_random_uuid(), tenant_id, event_id, CAST(%s AS uuid), CAST(%s AS uuid), team_id, "
            "id, 'bug_report', 'mask-test-1', '{}'::jsonb, 'h1', 'rejected_auto', 'RCPT-1', false "
            "FROM app.users WHERE email = 'p1.team1@example.com'",
            (stage_id, cv_id),
        )
        cur.execute(
            "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, "
            "author_id, kind, idempotency_key, payload, payload_hash, status, receipt_code, feedback_released) "
            "SELECT gen_random_uuid(), tenant_id, event_id, CAST(%s AS uuid), CAST(%s AS uuid), team_id, "
            "id, 'bug_report', 'mask-test-2', '{}'::jsonb, 'h2', 'duplicate', 'RCPT-2', false "
            "FROM app.users WHERE email = 'p1.team1@example.com'",
            (stage_id, cv_id),
        )
        conn.commit()
    subs = pc.get("/v1/submissions").json()["submissions"]
    by_receipt = {s["receipt_code"]: s for s in subs}
    assert by_receipt["RCPT-1"]["status"] == "received"
    assert by_receipt["RCPT-2"]["status"] == "received"
