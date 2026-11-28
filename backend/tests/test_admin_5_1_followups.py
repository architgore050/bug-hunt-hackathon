"""Regression tests for the Section 5.1 admin.py follow-up findings.

Covers F-C-05, F-C-06, F-C-07, F-C-12, F-C-13, F-C-15, F-C-16, F-C-18 and
the admin-side F-C-23, as identified in
docs/audit/sha-f96eb5ca/audit/Bug_Hunt_CTF_Audit.md, Table 4.
"""

from __future__ import annotations

import threading
import time
import uuid as uuid_lib
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from app.db import app_engine
from conftest import GT_URL, PGPORT, STAFF_PW, participant_client
from fastapi.testclient import TestClient
from sqlalchemy import text

ORG_EMAIL = "organizer@example.com"
ADMIN_EMAIL = "admin@example.com"
GT_DSN = GT_URL.replace("+psycopg", "")
PGADMIN_DSN = f"host=127.0.0.1 port={PGPORT} dbname=bughunt_test user=pgadmin"


# --- helpers -------------------------------------------------------------------


def _login(client: TestClient, email: str) -> TestClient:
    token = client.post("/v1/auth/login", json={"email": email, "password": STAFF_PW}).json()["access_token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def _organizer(client: TestClient) -> TestClient:
    return _login(client, ORG_EMAIL)


def _admin(client: TestClient) -> TestClient:
    return _login(client, ADMIN_EMAIL)


def _stepped_up(client: TestClient, email: str = ORG_EMAIL) -> TestClient:
    c = _login(client, email)
    r = c.post("/v1/auth/step-up", json={"password": STAFF_PW})
    assert r.status_code == 200, r.text
    return c


def _q(sql: str, params: dict | None = None, one: bool = False):
    with app_engine.connect() as conn:
        res = conn.execute(text(sql), params or {})
        if one:
            return dict(res.mappings().one())
        return [dict(r) for r in res.mappings().all()]


def _exec(sql: str, params: dict | None = None) -> None:
    with app_engine.begin() as conn:
        conn.execute(text(sql), params or {})


def _seed_ids() -> dict:
    return _q(
        "SELECT (SELECT id FROM app.events ORDER BY created_at LIMIT 1) AS event_id, "
        "(SELECT id FROM app.stages WHERE kind='main' ORDER BY ordinal LIMIT 1) AS stage_id, "
        "(SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1) AS challenge_id, "
        "(SELECT tenant_id FROM app.events ORDER BY created_at LIMIT 1) AS tenant_id",
        one=True,
    )


def _make_submission(
    *,
    kind: str = "bug_report",
    status: str = "accepted",
    team: str | None = None,
    event_id: str | None = None,
    stage_id: str | None = None,
    challenge_id: str | None = None,
) -> str:
    """Insert a submission row directly (test fixture, like tests/test_scoring.py)."""
    ids = _seed_ids()
    author = _q("SELECT id FROM app.users WHERE role='participant' ORDER BY created_at LIMIT 1", one=True)["id"]
    team = team or _q("SELECT id FROM app.teams ORDER BY created_at LIMIT 1", one=True)["id"]
    sub_id = str(uuid_lib.uuid4())
    _exec(
        "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, "
        "kind, idempotency_key, payload, payload_hash, status, receipt_code, title, received_at) VALUES "
        "(CAST(:id AS uuid), CAST(:t AS uuid), CAST(:e AS uuid), CAST(:s AS uuid), CAST(:c AS uuid), "
        "CAST(:team AS uuid), CAST(:a AS uuid), :kind, :idem, CAST(:payload AS jsonb), :ph, :status, :rc, :title, now())",
        {
            "id": sub_id,
            "t": str(ids["tenant_id"]),
            "e": str(event_id or ids["event_id"]),
            "s": str(stage_id or ids["stage_id"]),
            "c": str(challenge_id or ids["challenge_id"]),
            "team": str(team),
            "a": str(author),
            "kind": kind,
            "idem": f"fixture-{sub_id}",
            "payload": "{}",
            "ph": "x" * 64,
            "status": status,
            "rc": f"RC{sub_id[:6]}".upper(),
            "title": f"fixture {kind}",
        },
    )
    return sub_id


def _make_dispute(submission_id: str, team_id: str, statement: str = "fixture dispute") -> str:
    dispute_id = str(uuid_lib.uuid4())
    _exec(
        "INSERT INTO app.disputes (id, submission_id, team_id, statement) VALUES "
        "(CAST(:id AS uuid), CAST(:s AS uuid), CAST(:t AS uuid), :st)",
        {"id": dispute_id, "s": submission_id, "t": team_id, "st": statement},
    )
    return dispute_id


def _post_raw_json(c: TestClient, url: str, raw_body: str):
    """POST a raw JSON body. httpx refuses to serialize NaN/Infinity floats
    (allow_nan=False), so the wire-level non-finite payloads are sent literally,
    exactly as Python's json.loads accepts them."""
    return c.post(url, content=raw_body, headers={"Content-Type": "application/json"})


def _team_total(team_id: str) -> float:
    return float(
        _q(
            "SELECT COALESCE(SUM(points), 0) AS total FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid)",
            {"t": team_id},
            one=True,
        )["total"]
    )


# =============================================================================
# F-C-05: organizer invitation role escalation
# =============================================================================


class TestF_C_05_InviteRoles:
    def test_organizer_can_invite_every_permitted_non_admin_role(self, client):
        oc = _organizer(client)
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        for role in ("participant", "reviewer"):
            r = oc.post(f"/v1/admin/events/{ev}/invites", json={"email": f"{role}-invite@example.com", "role": role})
            assert r.status_code == 201, (role, r.text)
            stored = _q("SELECT role FROM app.invites WHERE email = :e", {"e": f"{role}-invite@example.com"}, one=True)
            assert stored["role"] == role

    def test_organizer_cannot_mint_admin_or_organizer_invites(self, client):
        oc = _organizer(client)
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        for role in ("admin", "organizer"):
            r = oc.post(f"/v1/admin/events/{ev}/invites", json={"email": f"escalate-{role}@example.com", "role": role})
            assert r.status_code == 403, (role, r.text)
            assert r.json()["error"]["code"] == "AUTH_FORBIDDEN"
            assert not _q("SELECT 1 FROM app.invites WHERE email = :e", {"e": f"escalate-{role}@example.com"})

    def test_admin_can_invite_organizer_and_admin(self, client):
        ac = _admin(client)
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        for role in ("organizer", "admin"):
            r = ac.post(
                f"/v1/admin/events/{ev}/invites", json={"email": f"admin-invited-{role}@example.com", "role": role}
            )
            assert r.status_code == 201, (role, r.text)

    def test_unknown_misspelled_and_miscapitalized_roles_are_rejected(self, client):
        oc = _organizer(client)
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        for role in ("superuser", "particpant", "Admin", "ADMIN", "null", ""):
            r = oc.post(f"/v1/admin/events/{ev}/invites", json={"email": "bad-role@example.com", "role": role})
            assert r.status_code == 422, (role, r.text)
        assert not _q("SELECT 1 FROM app.invites WHERE email = 'bad-role@example.com'")

    def test_missing_role_defaults_to_participant(self, client):
        oc = _organizer(client)
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        r = oc.post(f"/v1/admin/events/{ev}/invites", json={"email": "default-role@example.com"})
        assert r.status_code == 201, r.text
        assert (
            _q("SELECT role FROM app.invites WHERE email = 'default-role@example.com'", one=True)["role"]
            == "participant"
        )

    def test_non_organizers_cannot_invite(self, client):
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        pc = participant_client(client, "p1.team1@example.com")
        r = pc.post(f"/v1/admin/events/{ev}/invites", json={"email": "x@example.com", "role": "participant"})
        assert r.status_code == 403
        anon = TestClient(client.app)
        r = anon.post(f"/v1/admin/events/{ev}/invites", json={"email": "x@example.com", "role": "participant"})
        assert r.status_code in (401, 403)

    def test_invited_account_activates_with_the_intended_role(self, client):
        oc = _organizer(client)
        ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
        r = oc.post(f"/v1/admin/events/{ev}/invites", json={"email": "activate-me@example.com", "role": "reviewer"})
        assert r.status_code == 201, r.text
        token = r.json()["invite_token"]

        rc = TestClient(client.app)
        act = rc.post(
            "/v1/auth/activate",
            json={"invite_token": token, "password": "Activation-Passw0rd!", "accept_rules": True},
        )
        assert act.status_code == 200, act.text
        row = _q("SELECT role, status FROM app.users WHERE email = 'activate-me@example.com'", one=True)
        assert row["role"] == "reviewer"  # the invite role is honored, no escalation
        assert row["status"] == "active"


# =============================================================================
# F-C-06: manual/dispute adjustments accept NaN and unbounded values
# =============================================================================


def _adjustment_body(points, *, reason="F-C-06 fixture"):
    ids = _seed_ids()
    team = _q("SELECT id FROM app.teams ORDER BY created_at LIMIT 1", one=True)["id"]
    return {"stage_id": str(ids["stage_id"]), "team_id": str(team), "points": points, "reason": reason}, str(team)


class TestF_C_06_ManualAdjustmentValidation:
    def test_valid_positive_and_negative_adjustments(self, client):
        ac = _admin(client)
        body, team = _adjustment_body(10.5)
        r = ac.post("/v1/admin/adjustments", json=body)
        assert r.status_code == 200, r.text
        body_neg, _ = _adjustment_body(-4.25)
        r = ac.post("/v1/admin/adjustments", json=body_neg)
        assert r.status_code == 200, r.text
        rows = _q(
            "SELECT points, reason_code, kind FROM app.score_ledger_entries "
            "WHERE team_id = CAST(:t AS uuid) AND reason_code = 'MANUAL' ORDER BY created_at",
            {"t": team},
        )
        assert [float(x["points"]) for x in rows] == [10.5, -4.25]
        assert all(x["kind"] == "adjustment" for x in rows)

    def test_zero_and_missing_points_are_rejected(self, client):
        ac = _admin(client)
        for points in (0, None):
            body, team = _adjustment_body(points)
            r = ac.post("/v1/admin/adjustments", json=body)
            assert r.status_code == 422, (points, r.text)
            assert not _q(
                "SELECT 1 FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) AND reason_code = 'MANUAL'",
                {"t": team},
            )

    def test_nan_and_infinities_are_rejected_without_touching_the_ledger(self, client):
        ac = _admin(client)
        stage = _seed_ids()["stage_id"]
        team = _q("SELECT id FROM app.teams ORDER BY created_at LIMIT 1", one=True)["id"]
        for literal in ("NaN", "Infinity", "-Infinity"):
            before = _team_total(str(team))
            r = _post_raw_json(
                ac,
                "/v1/admin/adjustments",
                f'{{"stage_id": "{stage}", "team_id": "{team}", "points": {literal}, "reason": "poison attempt"}}',
            )
            assert r.status_code == 422, (literal, r.text)
            assert r.json()["error"]["code"] == "VALIDATION_ERROR"
            assert _team_total(str(team)) == before  # totals are not poisoned
            assert not _q(
                "SELECT 1 FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) AND reason_code = 'MANUAL'",
                {"t": str(team)},
            )
        for bad in ("NaN", "Infinity", "-Infinity"):
            body, team = _adjustment_body(bad)  # string forms through the normal JSON path
            r = ac.post("/v1/admin/adjustments", json=body)
            assert r.status_code == 422, (bad, r.text)

    def test_extreme_values_beyond_numeric_column_are_rejected(self, client):
        ac = _admin(client)
        for bad in (1e9, -1e9, "123456789012345", 99999999.999):
            body, _ = _adjustment_body(bad)
            r = ac.post("/v1/admin/adjustments", json=body)
            assert r.status_code == 422, (bad, r.text)

    def test_malformed_numeric_representation_is_rejected_cleanly(self, client):
        ac = _admin(client)
        for bad in ("abc", [1], {"v": 1}, True):
            body, _ = _adjustment_body(bad)
            r = ac.post("/v1/admin/adjustments", json=body)
            assert r.status_code == 422, (bad, r.text)

    def test_non_admin_cannot_adjust(self, client):
        oc = _organizer(client)
        body, _ = _adjustment_body(5)
        r = oc.post("/v1/admin/adjustments", json=body)
        assert r.status_code == 403

    def test_ledger_reconciliation_stays_consistent(self, client):
        ac = _admin(client)
        body, team = _adjustment_body(10)
        assert ac.post("/v1/admin/adjustments", json=body).status_code == 200
        body2, _ = _adjustment_body(-4)
        assert ac.post("/v1/admin/adjustments", json=body2).status_code == 200
        entries = _q(
            "SELECT points FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) AND reason_code = 'MANUAL'",
            {"t": team},
        )
        assert len(entries) == 2  # append-only: two rows, never an update
        assert sum(float(e["points"]) for e in entries) == 6.0


class TestF_C_06_DisputeAdjustmentValidation:
    def _dispute(self):
        sub = _make_submission()
        team = _q("SELECT team_id FROM app.submissions WHERE id = CAST(:s AS uuid)", {"s": sub}, one=True)["team_id"]
        return _make_dispute(sub, str(team)), str(team)

    def test_upheld_dispute_with_valid_points_appends_entry(self, client):
        oc = _organizer(client)
        dispute_id, team = self._dispute()
        r = oc.post(
            f"/v1/admin/disputes/{dispute_id}/resolve",
            json={"outcome": "upheld", "resolution": "correct ruling", "adjust_points": 7.5},
        )
        assert r.status_code == 200, r.text
        row = _q(
            "SELECT points, reason_code FROM app.score_ledger_entries "
            "WHERE team_id = CAST(:t AS uuid) AND reason_code = 'DISPUTE_UPHELD'",
            {"t": team},
            one=True,
        )
        assert float(row["points"]) == 7.5

    def test_nan_adjust_points_is_rejected_and_dispute_stays_open(self, client):
        oc = _organizer(client)
        dispute_id, team = self._dispute()
        before = _team_total(team)
        r = _post_raw_json(
            oc,
            f"/v1/admin/disputes/{dispute_id}/resolve",
            '{"outcome": "upheld", "resolution": "poison attempt", "adjust_points": NaN}',
        )
        assert r.status_code == 422, r.text
        assert _team_total(team) == before
        assert (
            _q("SELECT status FROM app.disputes WHERE id = CAST(:d AS uuid)", {"d": dispute_id}, one=True)["status"]
            == "open"
        )
        assert not _q(
            "SELECT 1 FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) AND reason_code = 'DISPUTE_UPHELD'",
            {"t": team},
        )

    def test_infinite_and_oversized_dispute_adjustments_are_rejected(self, client):
        oc = _organizer(client)
        for bad in ("Infinity", "-Infinity", 1e9, "abc", True):
            dispute_id, team = self._dispute()
            r = oc.post(
                f"/v1/admin/disputes/{dispute_id}/resolve",
                json={"outcome": "upheld", "resolution": "poison attempt", "adjust_points": bad},
            )
            assert r.status_code == 422, (bad, r.text)
            assert not _q(
                "SELECT 1 FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) "
                "AND reason_code = 'DISPUTE_UPHELD'",
                {"t": team},
            )

    def test_zero_dispute_adjustment_keeps_existing_no_op_semantics(self, client):
        oc = _organizer(client)
        dispute_id, team = self._dispute()
        r = oc.post(
            f"/v1/admin/disputes/{dispute_id}/resolve",
            json={"outcome": "upheld", "resolution": "no points change"},
        )
        assert r.status_code == 200, r.text
        assert not _q(
            "SELECT 1 FROM app.score_ledger_entries WHERE team_id = CAST(:t AS uuid) AND reason_code = 'DISPUTE_UPHELD'",
            {"t": team},
        )


# =============================================================================
# F-C-07: add_flag must enforce challenge-status locking
# =============================================================================


def _draft_challenge(oc: TestClient) -> str:
    ev = _q("SELECT id FROM app.events ORDER BY created_at LIMIT 1", one=True)["id"]
    r = oc.post(
        f"/v1/admin/events/{ev}/challenges",
        json={"slug": f"c-{uuid_lib.uuid4().hex[:10]}", "title": "F-C-07 fixture challenge"},
    )
    assert r.status_code == 201, r.text
    return r.json()["challenge_id"]


class TestF_C_07_FlagStatusLock:
    def test_flag_creation_while_challenge_is_editable(self, client):
        oc = _stepped_up(client)
        cid = _draft_challenge(oc)
        r = oc.post(
            f"/v1/admin/challenges/{cid}/ground-truth/flags",
            json={"flag_key": "FLAG-A", "code": "FLAG{editable}", "points": 10, "max_awards": 3},
        )
        assert r.status_code == 201, r.text
        with psycopg.connect(GT_DSN) as conn:
            row = conn.execute(
                "SELECT flag_key, points, max_awards FROM gt.gt_flags WHERE challenge_version_id = %s",
                (cid,),
            ).fetchall()
        assert len(row) == 1 and row[0][0] == "FLAG-A"

    def test_flag_mutation_after_sealing_is_rejected_and_rolls_back(self, client):
        oc = _stepped_up(client)
        cid = _draft_challenge(oc)
        # upload one file then freeze -> sealed
        up = oc.post(f"/v1/admin/challenges/{cid}/files", files={"file": ("a.js", b"console.log('ok')\n")})
        assert up.status_code == 200, up.text
        fr = oc.post(f"/v1/admin/challenges/{cid}/freeze")
        assert fr.status_code == 200, fr.text

        r = oc.post(
            f"/v1/admin/challenges/{cid}/ground-truth/flags",
            json={"flag_key": "FLAG-SEALED", "code": "FLAG{too_late}", "points": 10},
        )
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "GROUND_TRUTH_LOCKED"
        with psycopg.connect(GT_DSN) as conn:
            assert (
                conn.execute("SELECT count(*) FROM gt.gt_flags WHERE challenge_version_id = %s", (cid,)).fetchone()[0]
                == 0
            )
        # the audit row lives in the same gt transaction and rolled back too
        assert not _q("SELECT 1 FROM audit.entries WHERE action = 'gt.flag_added' AND entity_id = 'FLAG-SEALED'")

    def test_flag_mutation_after_publication_is_rejected(self, client):
        oc = _stepped_up(client)
        published = _q("SELECT id FROM app.challenge_versions WHERE status = 'published' LIMIT 1", one=True)["id"]
        r = oc.post(
            f"/v1/admin/challenges/{published}/ground-truth/flags",
            json={"flag_key": "FLAG-PUB", "code": "FLAG{too_late}", "points": 10},
        )
        assert r.status_code == 409, r.text
        with psycopg.connect(GT_DSN) as conn:
            assert (
                conn.execute(
                    "SELECT count(*) FROM gt.gt_flags WHERE challenge_version_id = %s AND flag_key = 'FLAG-PUB'",
                    (str(published),),
                ).fetchone()[0]
                == 0
            )

    def test_concurrent_publication_cannot_be_bypassed_by_flag_mutation(self, client):
        """A publish/freeze transaction holding the challenge row lock serializes
        against add_flag: the flag write must see the committed status, not a
        stale read (TOCTOU)."""
        oc = _stepped_up(client)
        cid = _draft_challenge(oc)
        outcome: dict = {}

        def try_add_flag():
            c = TestClient(client.app)
            c.headers.update({"Authorization": oc.headers["Authorization"]})
            # step-up is session-scoped; reuse the stepped-up session token
            rr = c.post(
                f"/v1/admin/challenges/{cid}/ground-truth/flags",
                json={"flag_key": "FLAG-RACE", "code": "FLAG{race}", "points": 10},
            )
            outcome["status"] = rr.status_code

        with psycopg.connect(PGADMIN_DSN) as conn:
            with conn.transaction():
                conn.execute("SELECT status FROM app.challenge_versions WHERE id = %s FOR UPDATE", (cid,)).fetchone()
                t = threading.Thread(target=try_add_flag)
                t.start()
                time.sleep(1.0)  # add_flag blocks on the row lock
                assert "status" not in outcome, "add_flag did not serialize against the publisher"
                # publisher seals the challenge and commits
                conn.execute("UPDATE app.challenge_versions SET status='sealed' WHERE id = %s", (cid,))
            t.join(timeout=20)
        assert outcome.get("status") == 409, outcome
        with psycopg.connect(GT_DSN) as gtconn:
            assert (
                gtconn.execute("SELECT count(*) FROM gt.gt_flags WHERE challenge_version_id = %s", (cid,)).fetchone()[0]
                == 0
            )

    def test_step_up_still_required_and_participants_forbidden(self, client):
        oc = _organizer(client)  # no step-up
        cid = _draft_challenge(_stepped_up(client))
        r = oc.post(
            f"/v1/admin/challenges/{cid}/ground-truth/flags",
            json={"flag_key": "FLAG-NOUP", "code": "FLAG{no_step_up}", "points": 10},
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
        pc = participant_client(client, "p1.team1@example.com")
        r = pc.post(
            f"/v1/admin/challenges/{cid}/ground-truth/flags",
            json={"flag_key": "FLAG-NOUP", "code": "FLAG{no_step_up}", "points": 10},
        )
        assert r.status_code in (401, 403)

    def test_duplicate_flag_code_stays_idempotent(self, client):
        oc = _stepped_up(client)
        cid = _draft_challenge(oc)
        body = {"flag_key": "FLAG-DUP", "code": "FLAG{same_code}", "points": 10}
        assert oc.post(f"/v1/admin/challenges/{cid}/ground-truth/flags", json=body).status_code == 201
        r = oc.post(f"/v1/admin/challenges/{cid}/ground-truth/flags", json=body)
        assert r.status_code == 201, r.text
        with psycopg.connect(GT_DSN) as conn:
            assert (
                conn.execute("SELECT count(*) FROM gt.gt_flags WHERE challenge_version_id = %s", (cid,)).fetchone()[0]
                == 1
            )


# =============================================================================
# F-C-12: record_test_results accepts arbitrary submission ids
# =============================================================================


class TestF_C_12_TestResultsReferences:
    def _valid_submission_with_claim(self) -> str:
        ids = _seed_ids()
        sub = _make_submission()
        _exec(
            "INSERT INTO app.award_claims (id, event_id, stage_id, team_id, award_unit_id, submission_id) VALUES "
            "(CAST(:id AS uuid), CAST(:e AS uuid), CAST(:s AS uuid), "
            "(SELECT team_id FROM app.submissions WHERE id = CAST(:sub AS uuid)), 'BUG-01', CAST(:sub AS uuid)) "
            "ON CONFLICT DO NOTHING",
            {"id": str(uuid_lib.uuid4()), "e": str(ids["event_id"]), "s": str(ids["stage_id"]), "sub": sub},
        )
        return sub

    def test_valid_submission_enqueues_and_pays_exactly_once(self, client):
        from conftest import worker_drain

        oc = _stepped_up(client)
        challenge = _q("SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1", one=True)["id"]
        sub = self._valid_submission_with_claim()
        team_before = _team_total(
            _q("SELECT team_id FROM app.submissions WHERE id = CAST(:s AS uuid)", {"s": sub}, one=True)["team_id"]
        )
        r = oc.post(
            f"/v1/admin/challenges/{challenge}/ground-truth/test-results",
            json={"submission_id": sub, "tests_passed": 3, "tests_total": 4},
        )
        assert r.status_code == 200, r.text
        assert _q("SELECT count(*) AS n FROM app.jobs WHERE kind = 'apply_test_results'", one=True)["n"] >= 1

        worker_drain()

        entries = _q(
            "SELECT points, note FROM app.score_ledger_entries WHERE submission_id = CAST(:s AS uuid) "
            "AND component = 'functional_test'",
            {"s": sub},
        )
        assert len(entries) == 1, entries
        # BUG-01 is worth 25 points; frozen weights functional_test = 0.5; 3/4 passed
        assert abs(float(entries[0]["points"]) - 25 * 0.5 * 0.75) < 0.01
        assert entries[0]["note"] == "passed 3/4"

        # duplicate request: at-least-once delivery stays harmless (idempotent handler)
        r = oc.post(
            f"/v1/admin/challenges/{challenge}/ground-truth/test-results",
            json={"submission_id": sub, "tests_passed": 4, "tests_total": 4},
        )
        assert r.status_code == 200, r.text
        worker_drain()
        entries = _q(
            "SELECT points FROM app.score_ledger_entries WHERE submission_id = CAST(:s AS uuid) "
            "AND component = 'functional_test'",
            {"s": sub},
        )
        assert len(entries) == 1
        team_after = _team_total(
            _q("SELECT team_id FROM app.submissions WHERE id = CAST(:s AS uuid)", {"s": sub}, one=True)["team_id"]
        )
        assert team_after - team_before == 9.38

    def test_nonexistent_submission_id_returns_404_and_enqueues_nothing(self, client):
        oc = _stepped_up(client)
        challenge = _q("SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1", one=True)["id"]
        before = _q("SELECT count(*) AS n FROM app.jobs", one=True)["n"]
        r = oc.post(
            f"/v1/admin/challenges/{challenge}/ground-truth/test-results",
            json={"submission_id": str(uuid_lib.uuid4()), "tests_passed": 1, "tests_total": 2},
        )
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "NOT_FOUND"
        assert _q("SELECT count(*) AS n FROM app.jobs", one=True)["n"] == before

    def test_malformed_submission_id_is_rejected_cleanly(self, client):
        oc = _stepped_up(client)
        challenge = _q("SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1", one=True)["id"]
        for bad_id in ("not-a-uuid", "../../etc/passwd", 12345, {"x": 1}):
            r = oc.post(
                f"/v1/admin/challenges/{challenge}/ground-truth/test-results",
                json={"submission_id": bad_id, "tests_passed": 1, "tests_total": 2},
            )
            assert r.status_code == 422, (bad_id, r.text)
        assert not _q("SELECT 1 FROM app.jobs WHERE kind = 'apply_test_results'")

    def test_submission_of_a_different_challenge_or_event_is_rejected(self, client):
        oc = _stepped_up(client)
        seed = _seed_ids()
        # a second challenge in the same event, and a second event with its own challenge
        other_challenge = _draft_challenge(oc)
        sub = _make_submission()  # bound to the seeded challenge
        for challenge_id in (other_challenge,):
            r = oc.post(
                f"/v1/admin/challenges/{challenge_id}/ground-truth/test-results",
                json={"submission_id": sub, "tests_passed": 1, "tests_total": 2},
            )
            assert r.status_code == 422, r.text
            assert "does not belong" in r.json()["error"]["details"]["submission_id"]

        # cross-event: a submission row forged into another event (worst case)
        ev2 = (
            _organizer(client)
            .post("/v1/admin/events", json={"name": "Other Event", "slug": f"other-{uuid_lib.uuid4().hex[:6]}"})
            .json()["event_id"]
        )
        oc2 = _stepped_up(client)
        ch2 = _draft_challenge(oc2)
        forged = _make_submission(event_id=ev2, challenge_id=ch2)
        r = oc2.post(
            f"/v1/admin/challenges/{seed['challenge_id']!s}/ground-truth/test-results",
            json={"submission_id": forged, "tests_passed": 1, "tests_total": 2},
        )
        assert r.status_code == 422, r.text

    def test_unsupported_submission_kind_is_rejected(self, client):
        oc = _stepped_up(client)
        challenge = _q("SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1", one=True)["id"]
        for kind in ("ctf_flag", "level_artifact"):
            sub = _make_submission(kind=kind)
            r = oc.post(
                f"/v1/admin/challenges/{challenge}/ground-truth/test-results",
                json={"submission_id": sub, "tests_passed": 1, "tests_total": 2},
            )
            assert r.status_code == 422, (kind, r.text)
        assert not _q("SELECT 1 FROM app.jobs WHERE kind = 'apply_test_results'")

    def test_level_report_kind_is_supported(self, client):
        oc = _stepped_up(client)
        challenge = _q("SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1", one=True)["id"]
        sub = _make_submission(kind="level_report", status="received")
        r = oc.post(
            f"/v1/admin/challenges/{challenge}/ground-truth/test-results",
            json={"submission_id": sub, "tests_passed": 2, "tests_total": 2},
        )
        assert r.status_code == 200, r.text
        assert _q(
            "SELECT 1 FROM app.jobs WHERE kind = 'apply_test_results' AND payload ->> 'submission_id' = :s",
            {"s": sub},
        )

    def test_malformed_tests_counts_are_rejected_cleanly(self, client):
        oc = _stepped_up(client)
        challenge = _q("SELECT id FROM app.challenge_versions ORDER BY created_at LIMIT 1", one=True)["id"]
        sub = _make_submission()
        for body in (
            {"submission_id": sub, "tests_passed": "many", "tests_total": 4},
            {"submission_id": sub, "tests_passed": 2, "tests_total": "four"},
            {"submission_id": sub, "tests_passed": 5, "tests_total": 4},
            {"submission_id": sub, "tests_passed": -1, "tests_total": 4},
            {"submission_id": sub, "tests_passed": 1, "tests_total": 0},
        ):
            r = oc.post(f"/v1/admin/challenges/{challenge}/ground-truth/test-results", json=body)
            assert r.status_code == 422, (body, r.text)
        assert not _q("SELECT 1 FROM app.jobs WHERE kind = 'apply_test_results'")


# =============================================================================
# F-C-13: configuration freeze timestamp and weight parsing
# =============================================================================


def _config(weights=None, **extra) -> dict:
    scoring = {
        "weights": weights
        if weights is not None
        else {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2}
    }
    scoring.update(extra)
    return {"scoring": scoring}


class TestF_C_13_ConfigFreeze:
    def test_valid_freeze_stores_real_timestamp_and_snapshot(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        before = _q(
            "SELECT config_version, config FROM app.events WHERE id = CAST(:e AS uuid)", {"e": str(ev)}, one=True
        )
        t0 = datetime.now(UTC)
        r = oc.post(
            f"/v1/admin/events/{ev}/config",
            json={"config": _config(), "reason": "F-C-13 valid freeze", "freeze": True},
        )
        assert r.status_code == 200, r.text
        rev = _q(
            "SELECT version, frozen_at, config FROM app.event_config_revisions "
            "WHERE event_id = CAST(:e AS uuid) ORDER BY version DESC LIMIT 1",
            {"e": str(ev)},
            one=True,
        )
        assert isinstance(rev["frozen_at"], datetime)  # a real timestamp, never the string 'now()'
        assert t0 - timedelta(seconds=5) <= rev["frozen_at"]
        after = _q(
            "SELECT config_version, config FROM app.events WHERE id = CAST(:e AS uuid)", {"e": str(ev)}, one=True
        )
        assert after["config_version"] == before["config_version"] + 1
        assert after["config"]["scoring"]["weights"]["code_review"] == 0.3  # snapshot reflects committed config

    def test_invalid_weight_sums_are_rejected(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        for weights in (
            {"functional_test": 0.4, "code_review": 0.3, "evidence_report": 0.2},
            {"functional_test": 0.9, "code_review": 0.3, "evidence_report": 0.2},
        ):
            r = oc.post(
                f"/v1/admin/events/{ev}/config",
                json={"config": _config(weights), "reason": "bad sum", "freeze": True},
            )
            assert r.status_code == 422, r.text

    def test_malformed_weight_is_a_clean_422_not_a_500(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        r = oc.post(
            f"/v1/admin/events/{ev}/config",
            json={
                "config": _config({"functional_test": "abc", "code_review": 0.3, "evidence_report": 0.2}),
                "reason": "malformed weight",
                "freeze": True,
            },
        )
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_nan_and_infinite_weights_are_rejected(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        for literal in ("NaN", "Infinity", "-Infinity"):
            raw = (
                '{"config": {"scoring": {"weights": {"functional_test": '
                + literal
                + ', "code_review": 0.3, "evidence_report": 0.2}}}, '
                + '"reason": "non-finite weight", "freeze": true}'
            )
            r = _post_raw_json(oc, f"/v1/admin/events/{ev}/config", raw)
            assert r.status_code == 422, (literal, r.text)
        for bad in ("NaN", "Infinity", "-Infinity"):  # string forms through the normal JSON path
            r = oc.post(
                f"/v1/admin/events/{ev}/config",
                json={
                    "config": _config({"functional_test": bad, "code_review": 0.3, "evidence_report": 0.2}),
                    "reason": "non-finite weight",
                    "freeze": True,
                },
            )
            assert r.status_code == 422, (bad, r.text)

    def test_negative_weight_is_rejected(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        r = oc.post(
            f"/v1/admin/events/{ev}/config",
            json={
                "config": _config({"functional_test": -0.5, "code_review": 0.8, "evidence_report": 0.7}),
                "reason": "negative weight",
                "freeze": True,
            },
        )
        assert r.status_code == 422, r.text

    def test_freeze_without_weights_or_missing_component_is_rejected(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        r = oc.post(
            f"/v1/admin/events/{ev}/config",
            json={"config": {"scoring": {}}, "reason": "no weights at all", "freeze": True},
        )
        assert r.status_code == 422, r.text
        r = oc.post(
            f"/v1/admin/events/{ev}/config",
            json={
                "config": _config({"functional_test": 0.5, "code_review": 0.5}),
                "reason": "missing component",
                "freeze": True,
            },
        )
        assert r.status_code == 422, r.text

    def test_non_freeze_revision_tolerates_missing_weights(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        r = oc.post(
            f"/v1/admin/events/{ev}/config",
            json={"config": {"public_summary": {"note": "draft"}}, "reason": "draft revision"},
        )
        assert r.status_code == 200, r.text

    def test_non_finite_ctf_cap_is_rejected(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        raw = (
            '{"config": {"scoring": {"weights": {"functional_test": 0.5, "code_review": 0.3, '
            '"evidence_report": 0.2}, "ctf_bonus_cap_points": NaN}}, '
            '"reason": "bad cap", "freeze": true}'
        )
        r = _post_raw_json(oc, f"/v1/admin/events/{ev}/config", raw)
        assert r.status_code == 422, r.text

    def test_freeze_on_nonexistent_event_leaves_no_partial_changes(self, client):
        oc = _organizer(client)
        fake = str(uuid_lib.uuid4())
        r = oc.post(
            f"/v1/admin/events/{fake}/config",
            json={"config": _config(), "reason": "ghost freeze", "freeze": True},
        )
        assert r.status_code == 404, r.text
        assert not _q("SELECT 1 FROM app.event_config_revisions WHERE event_id = CAST(:e AS uuid)", {"e": fake})

    def test_repeated_freeze_attempts_create_new_frozen_revisions(self, client):
        """Existing semantics: each freeze is a new immutable revision; the event
        snapshot and config_version follow the latest freeze."""
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        first = oc.post(
            f"/v1/admin/events/{ev}/config", json={"config": _config(), "reason": "first freeze", "freeze": True}
        )
        assert first.status_code == 200
        second = oc.post(
            f"/v1/admin/events/{ev}/config", json={"config": _config(), "reason": "second freeze", "freeze": True}
        )
        assert second.status_code == 200
        rows = _q(
            "SELECT version, frozen_at FROM app.event_config_revisions WHERE event_id = CAST(:e AS uuid) "
            "AND frozen_at IS NOT NULL ORDER BY version",
            {"e": str(ev)},
        )
        assert len(rows) == 2
        assert rows[1]["frozen_at"] >= rows[0]["frozen_at"]


# =============================================================================
# F-C-15: unknown release actions return success
# =============================================================================


def _ended_stage_id(client: TestClient) -> str:
    oc = _organizer(client)
    stage = _q("SELECT id FROM app.stages WHERE kind='main' ORDER BY ordinal LIMIT 1", one=True)["id"]
    for action in ("seal", "arm", "start", "end"):
        oc.post(f"/v1/admin/stages/{stage}/control", json={"action": action, "reason": "F-C-15 setup"})
    assert _q("SELECT status FROM app.stages WHERE id = CAST(:s AS uuid)", {"s": stage}, one=True)["status"] == "ended"
    return str(stage)


class TestF_C_15_ReleaseActions:
    def test_evaluate_and_release_are_supported(self, client):
        oc = _organizer(client)
        stage = _ended_stage_id(client)
        r = oc.post(f"/v1/admin/stages/{stage}/release", json={"action": "evaluate", "reason": "e2e"})
        assert r.status_code == 200, r.text
        assert (
            _q("SELECT status FROM app.stages WHERE id = CAST(:s AS uuid)", {"s": stage}, one=True)["status"]
            == "evaluating"
        )
        assert _q("SELECT 1 FROM app.jobs WHERE kind = 'release_feedback'", one=True)
        r = oc.post(f"/v1/admin/stages/{stage}/release", json={"action": "release", "reason": "e2e"})
        assert r.status_code == 200, r.text
        assert (
            _q("SELECT status FROM app.stages WHERE id = CAST(:s AS uuid)", {"s": stage}, one=True)["status"]
            == "released"
        )

    def test_unknown_action_is_rejected_without_side_effects(self, client):
        oc = _organizer(client)
        stage = _ended_stage_id(client)
        jobs_before = _q("SELECT count(*) AS n FROM app.jobs", one=True)["n"]
        for bad in ("relese", "publish", "Release", "RELEASE", 12345, None, ""):
            r = oc.post(f"/v1/admin/stages/{stage}/release", json={"action": bad, "reason": "typo"})
            assert r.status_code == 422, (bad, r.text)
            assert r.json()["error"]["code"] == "VALIDATION_ERROR"
        assert _q("SELECT count(*) AS n FROM app.jobs", one=True)["n"] == jobs_before
        assert (
            _q("SELECT status FROM app.stages WHERE id = CAST(:s AS uuid)", {"s": stage}, one=True)["status"] == "ended"
        )
        # no bogus audit entries: every audited stage action must be a real one
        bogus = _q("SELECT action FROM audit.entries WHERE action LIKE 'stage.%'")
        assert all(
            a["action"].split(".", 1)[1]
            in (
                "seal",
                "arm",
                "start",
                "pause",
                "resume",
                "extend",
                "end",
                "evaluate",
                "release",
                "time_adjustment",
                "created",
            )
            for a in bogus
        ), [a["action"] for a in bogus]

    def test_missing_action_is_rejected(self, client):
        oc = _organizer(client)
        stage = _ended_stage_id(client)
        r = oc.post(f"/v1/admin/stages/{stage}/release", json={"reason": "no action"})
        assert r.status_code == 422, r.text

    def test_unauthorized_actor_cannot_release(self, client):
        stage = _ended_stage_id(client)
        pc = participant_client(client, "p2.team1@example.com")
        r = pc.post(f"/v1/admin/stages/{stage}/release", json={"action": "release", "reason": "hijack"})
        assert r.status_code == 403

    def test_valid_action_from_wrong_state_is_still_guarded(self, client):
        oc = _organizer(client)
        stage = _q("SELECT id FROM app.stages WHERE kind='main' ORDER BY ordinal LIMIT 1", one=True)["id"]
        r = oc.post(f"/v1/admin/stages/{stage}/release", json={"action": "evaluate", "reason": "too early"})
        assert r.status_code == 422, r.text  # draft -> evaluate is not a legal transition


# =============================================================================
# F-C-16: readiness semantics + stage ordinal integrity
# =============================================================================


class TestF_C_16_Readiness:
    def test_existing_item_updates(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        key = _q("SELECT key FROM app.readiness_items LIMIT 1", one=True)["key"]
        r = oc.post(f"/v1/admin/events/{ev}/readiness/{key}", json={"state": "checked"})
        assert r.status_code == 200, r.text
        row = _q("SELECT state, checked_at FROM app.readiness_items WHERE key = :k", {"k": key}, one=True)
        assert row["state"] == "checked" and row["checked_at"] is not None

    def test_unknown_key_returns_404_without_audit_row(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        r = oc.post(f"/v1/admin/events/{ev}/readiness/does-not-exist", json={"state": "checked"})
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "NOT_FOUND"
        assert not _q(
            "SELECT 1 FROM audit.entries WHERE action = 'readiness.updated' AND details ->> 'key' = 'does-not-exist'"
        )

    def test_wrong_event_returns_404(self, client):
        oc = _organizer(client)
        key = _q("SELECT key FROM app.readiness_items LIMIT 1", one=True)["key"]
        other_ev = str(uuid_lib.uuid4())
        r = oc.post(f"/v1/admin/events/{other_ev}/readiness/{key}", json={"state": "checked"})
        assert r.status_code == 404, r.text

    def test_invalid_state_is_rejected(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        key = _q("SELECT key FROM app.readiness_items LIMIT 1", one=True)["key"]
        r = oc.post(f"/v1/admin/events/{ev}/readiness/{key}", json={"state": "maybe"})
        assert r.status_code == 422, r.text

    def test_unauthorized_actor_is_rejected(self, client):
        ev = _seed_ids()["event_id"]
        key = _q("SELECT key FROM app.readiness_items LIMIT 1", one=True)["key"]
        pc = participant_client(client, "p3.team1@example.com")
        r = pc.post(f"/v1/admin/events/{ev}/readiness/{key}", json={"state": "checked"})
        assert r.status_code == 403

    def test_concurrent_updates_are_safe(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        key = _q("SELECT key FROM app.readiness_items LIMIT 1", one=True)["key"]
        token = oc.headers["Authorization"]
        results: list[int] = []

        def worker():
            c = TestClient(client.app)
            c.headers.update({"Authorization": token})
            results.append(c.post(f"/v1/admin/events/{ev}/readiness/{key}", json={"state": "checked"}).status_code)

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert results == [200, 200, 200, 200]
        row = _q("SELECT state, checked_at FROM app.readiness_items WHERE key = :k", {"k": key}, one=True)
        assert row["state"] == "checked" and row["checked_at"] is not None


class TestF_C_16_StageOrdinals:
    def test_database_enforces_uniqueness(self):
        ids = _seed_ids()
        with psycopg.connect(PGADMIN_DSN) as conn:
            conn.execute(
                "INSERT INTO app.stages (id, event_id, name, kind, ordinal) "
                "VALUES (%s, %s, 'dup', 'uniqueness-probe', 1)",
                (str(uuid_lib.uuid4()), str(ids["event_id"])),
            )
            with pytest.raises(psycopg.errors.UniqueViolation):
                conn.execute(
                    "INSERT INTO app.stages (id, event_id, name, kind, ordinal) "
                    "VALUES (%s, %s, 'dup2', 'uniqueness-probe', 1)",
                    (str(uuid_lib.uuid4()), str(ids["event_id"])),
                )
            conn.rollback()

    def test_migration_refuses_to_run_over_duplicates(self):
        """The 0004 guard must fail loudly when duplicates already exist,
        instead of silently reordering or deleting stages."""
        from pathlib import Path

        ids = _seed_ids()
        sql = (Path(__file__).resolve().parent.parent / "migrations" / "0004_stage_ordinal_unique.sql").read_text()
        with psycopg.connect(PGADMIN_DSN) as conn:
            with pytest.raises(psycopg.errors.RaiseException):
                with conn.transaction():
                    # simulate the pre-migration state: duplicates exist, no constraint yet
                    conn.execute("ALTER TABLE app.stages DROP CONSTRAINT ux_stages_event_kind_ordinal")
                    conn.execute(
                        "INSERT INTO app.stages (id, event_id, name, kind, ordinal) VALUES (%s, %s, 'g1', 'guard', 9)",
                        (str(uuid_lib.uuid4()), str(ids["event_id"])),
                    )
                    conn.execute(
                        "INSERT INTO app.stages (id, event_id, name, kind, ordinal) VALUES (%s, %s, 'g2', 'guard', 9)",
                        (str(uuid_lib.uuid4()), str(ids["event_id"])),
                    )
                    conn.execute(sql)
            # the whole transaction rolled back: no guard rows, constraint restored
            assert not _q("SELECT 1 FROM app.stages WHERE kind = 'guard'")
            cur = conn.execute("SELECT conname FROM pg_constraint WHERE conname = 'ux_stages_event_kind_ordinal'")
            assert cur.fetchone()[0] == "ux_stages_event_kind_ordinal"

    def test_concurrent_stage_creation_yields_distinct_ordinals(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        token = oc.headers["Authorization"]
        results: list = []
        lock = threading.Lock()

        def worker():
            c = TestClient(client.app)
            c.headers.update({"Authorization": token})
            r = c.post(f"/v1/admin/events/{ev}/stages", json={"name": "Race stage", "kind": "main"})
            with lock:
                results.append((r.status_code, r.json().get("stage_id")))

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert all(code == 201 for code, _ in results), results
        # The seeded event also has four level stages (ordinals 1..4), and the
        # base MAX+1 reads ordinals across all kinds, so the new stages allocate
        # 5..9. The invariant under test: 6 main stages, every ordinal distinct.
        ordinals = _q(
            "SELECT ordinal FROM app.stages WHERE event_id = CAST(:e AS uuid) AND kind = 'main' ORDER BY ordinal",
            {"e": str(ev)},
        )
        assert len(ordinals) == 6  # seed main stage + 5 created
        assert sorted(o["ordinal"] for o in ordinals) == [1, 5, 6, 7, 8, 9]
        # the unique constraint is the real guarantee: no duplicate (event, kind, ordinal) group exists
        dupes = _q(
            "SELECT count(*) AS n FROM app.stages WHERE event_id = CAST(:e AS uuid) "
            "GROUP BY event_id, kind, ordinal HAVING count(*) > 1",
            {"e": str(ev)},
        )
        assert dupes == []

    def test_concurrent_level_bootstrap_stays_idempotent(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        token = oc.headers["Authorization"]
        results: list[int] = []

        def worker():
            c = TestClient(client.app)
            c.headers.update({"Authorization": token})
            results.append(c.post(f"/v1/admin/events/{ev}/levels/bootstrap").status_code)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert results == [200, 200], results
        levels = _q(
            "SELECT ordinal FROM app.stages WHERE event_id = CAST(:e AS uuid) AND kind = 'level' ORDER BY ordinal",
            {"e": str(ev)},
        )
        assert [o["ordinal"] for o in levels] == [1, 2, 3, 4]


# =============================================================================
# F-C-18: administrator input validation gaps
# =============================================================================


class TestF_C_18_InputValidation:
    def test_negative_and_zero_event_durations_are_rejected(self, client):
        oc = _organizer(client)
        for bad in (-30, 0):
            r = oc.post(
                "/v1/admin/events",
                json={"name": "Bad Event", "slug": f"bad-{bad}", "duration_minutes": bad},
            )
            assert r.status_code == 422, (bad, r.text)
        r = oc.post("/v1/admin/events", json={"name": "Good Event", "slug": "good-dur", "duration_minutes": 240})
        assert r.status_code == 201, r.text

    def test_title_length_must_fit_varchar_200(self, client):
        oc = _stepped_up(client)
        ev = _seed_ids()["event_id"]
        r = oc.post(f"/v1/admin/events/{ev}/challenges", json={"slug": "long-title", "title": "x" * 201})
        assert r.status_code == 422, r.text
        r = oc.post(f"/v1/admin/events/{ev}/challenges", json={"slug": "exact-title", "title": "x" * 200})
        assert r.status_code == 201, r.text

    def test_bug_locations_are_type_checked(self, client):
        oc = _stepped_up(client)
        cid = _draft_challenge(oc)
        base = {
            "code": "BUG-LOC",
            "title": "Location fixture",
            "severity": "medium",
            "category": "logic",
            "points": 25,
            "root_cause_group": "fixture",
            "explanation": "fixture",
        }
        for bad_loc in (
            {"file_path": "a.js", "line_start": 0, "line_end": 3},  # line_start < 1
            {"file_path": "a.js", "line_start": 5, "line_end": 3},  # end < start
            {"file_path": "", "line_start": 1, "line_end": 3},  # empty path
            {"file_path": "a.js", "line_start": "one", "line_end": 3},  # non-integer
            {"file_path": "a.js", "line_start": 1},  # missing line_end
            {"file_path": "x" * 501, "line_start": 1, "line_end": 3},  # exceeds VARCHAR(500)
        ):
            r = oc.post(
                f"/v1/admin/challenges/{cid}/ground-truth/bugs",
                json={**base, "locations": [bad_loc]},
            )
            assert r.status_code == 422, (bad_loc, r.text)
        # valid location round-trips into gt
        r = oc.post(
            f"/v1/admin/challenges/{cid}/ground-truth/bugs",
            json={**base, "locations": [{"file_path": "a.js", "line_start": 2, "line_end": 4, "is_primary": False}]},
        )
        assert r.status_code == 201, r.text
        with psycopg.connect(GT_DSN) as conn:
            row = conn.execute(
                "SELECT file_path, line_start, line_end, is_primary FROM gt.gt_locations "
                "WHERE bug_id = (SELECT id FROM gt.gt_bugs WHERE code = 'BUG-LOC' "
                "AND challenge_version_id = %s)",
                (cid,),
            ).fetchall()
        assert len(row) == 1 and row[0] == ("a.js", 2, 4, False)

    def test_bug_aliases_are_type_checked(self, client):
        oc = _stepped_up(client)
        cid = _draft_challenge(oc)
        base = {
            "code": "BUG-ALIAS",
            "title": "Alias fixture",
            "severity": "low",
            "category": "logic",
            "points": 10,
            "root_cause_group": "fixture",
            "explanation": "fixture",
        }
        for bad_alias in (
            {"keyword": "db", "weight": 10.0},  # exceeds NUMERIC(3,2)
            {"keyword": "db", "weight": -0.5},  # negative weight
            {"keyword": "", "weight": 1.0},  # empty keyword
            {"keyword": "db", "weight": "heavy"},  # non-numeric weight
            {"keyword": "x" * 121, "weight": 1.0},  # exceeds VARCHAR(120)
        ):
            r = oc.post(f"/v1/admin/challenges/{cid}/ground-truth/bugs", json={**base, "aliases": [bad_alias]})
            assert r.status_code == 422, (bad_alias, r.text)
        r = oc.post(
            f"/v1/admin/challenges/{cid}/ground-truth/bugs",
            json={**base, "aliases": [{"keyword": "database", "weight": 1.5}]},
        )
        assert r.status_code == 201, r.text

    def test_time_adjustment_delta_bounds(self, client):
        oc = _organizer(client)
        ev = _seed_ids()["event_id"]
        stage = _q("SELECT id FROM app.stages WHERE kind='main' LIMIT 1", one=True)["id"]
        url = f"/v1/admin/events/{ev}/time-adjustment"
        good = {"stage_id": str(stage), "reason_code": "ACCOMMODATION"}
        rows_before = _q("SELECT count(*) AS n FROM app.time_adjustments", one=True)["n"]

        for bad in (
            1_000_000_000,
            -1_000_000_000,
            3601,
            -3601,
            "abc",
            1.5,
            True,
        ):
            r = oc.post(url, json={**good, "delta_seconds": bad})
            assert r.status_code == 422, (bad, r.text)
        for literal in ("NaN", "Infinity", "-Infinity"):  # non-finite literals at the wire level
            r = _post_raw_json(
                oc,
                url,
                f'{{"stage_id": "{stage}", "reason_code": "ACCOMMODATION", "delta_seconds": {literal}}}',
            )
            assert r.status_code == 422, (literal, r.text)
        for bad in (None, 0):
            r = oc.post(url, json={**good, "delta_seconds": bad})
            assert r.status_code == 422, (bad, r.text)
        assert _q("SELECT count(*) AS n FROM app.time_adjustments", one=True)["n"] == rows_before

        for good_delta in (60, -60, 3600, -3600, "90"):
            r = oc.post(url, json={**good, "delta_seconds": good_delta})
            assert r.status_code == 200, (good_delta, r.text)
        stored = _q(
            "SELECT delta_seconds FROM app.time_adjustments WHERE stage_id = CAST(:s AS uuid) ORDER BY created_at",
            {"s": str(stage)},
        )
        assert [int(x["delta_seconds"]) for x in stored] == [60, -60, 3600, -3600, 90]


# =============================================================================
# F-C-23: admin-side disputes listing (pagination)
# =============================================================================


def _seed_disputes(n: int = 5) -> tuple[list[str], str]:
    ids = []
    team = _q("SELECT id FROM app.teams ORDER BY created_at LIMIT 1", one=True)["id"]
    for i in range(n):
        sub = _make_submission()
        ids.append(_make_dispute(sub, str(team), statement=f"dispute {i}"))
    return ids, str(team)


class TestF_C_23_DisputesPagination:
    def test_first_and_subsequent_pages_cover_all_rows_exactly_once(self, client):
        oc = _organizer(client)
        ids, _ = _seed_disputes(5)
        seen: list[str] = []
        offset = 0
        while True:
            r = oc.get("/v1/admin/disputes", params={"limit": 2, "offset": offset})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["total"] == 5
            assert body["limit"] == 2 and body["offset"] == offset
            seen.extend(d["id"] for d in body["disputes"])
            offset += len(body["disputes"])
            if not body["disputes"]:
                break
        assert sorted(seen) == sorted(ids)
        assert len(set(seen)) == len(seen)  # no row appears twice

    def test_empty_result_set(self, client):
        oc = _organizer(client)
        r = oc.get("/v1/admin/disputes", params={"limit": 10, "offset": 0})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["disputes"] == [] and body["total"] == 0

    def test_limit_is_bounded_and_negative_values_rejected(self, client):
        oc = _organizer(client)
        for bad in (101, 1000, 0, -1):
            r = oc.get("/v1/admin/disputes", params={"limit": bad})
            assert r.status_code == 422, (bad, r.text)
        r = oc.get("/v1/admin/disputes", params={"limit": -5, "offset": -5})
        assert r.status_code == 422, r.text
        r = oc.get("/v1/admin/disputes", params={"limit": 100})
        assert r.status_code == 200, r.text

    def test_ordering_is_deterministic(self, client):
        oc = _organizer(client)
        _ids, _ = _seed_disputes(6)
        expected = [str(r["id"]) for r in _q("SELECT d.id FROM app.disputes d ORDER BY d.created_at DESC, d.id DESC")]
        page = oc.get("/v1/admin/disputes", params={"limit": 100, "offset": 0}).json()
        assert [d["id"] for d in page["disputes"]] == expected

    def test_projection_stays_bounded(self, client):
        oc = _organizer(client)
        _seed_disputes(1)
        row = oc.get("/v1/admin/disputes").json()["disputes"][0]
        assert set(row.keys()) == {
            "id",
            "status",
            "statement",
            "created_at",
            "title",
            "receipt_code",
            "submission_id",
        }

    def test_event_isolation_filter(self, client):
        oc = _organizer(client)
        ids, _ = _seed_disputes(3)
        # a second event with its own stage/team/submission/dispute
        ev2 = oc.post(
            "/v1/admin/events", json={"name": "Other Event", "slug": f"disputes-{uuid_lib.uuid4().hex[:6]}"}
        ).json()["event_id"]
        stage2 = oc.post(f"/v1/admin/events/{ev2}/stages", json={"name": "S2", "kind": "main"}).json()["stage_id"]
        team2 = str(uuid_lib.uuid4())
        _exec(
            "INSERT INTO app.teams (id, event_id, name, join_code) VALUES (CAST(:id AS uuid), CAST(:e AS uuid), 'T2', 'JOINXX1')",
            {"id": team2, "e": ev2},
        )
        sub2 = _make_submission(event_id=ev2, stage_id=stage2, team=team2)
        dispute2 = _make_dispute(sub2, team2, statement="other event dispute")

        r = oc.get("/v1/admin/disputes", params={"event_id": ev2})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 1
        assert [d["id"] for d in body["disputes"]] == [dispute2]

        r = oc.get("/v1/admin/disputes", params={"event_id": str(_seed_ids()["event_id"])})
        assert r.status_code == 200
        listed = [d["id"] for d in r.json()["disputes"]]
        assert dispute2 not in listed
        assert set(ids).issubset(set(listed))

        r = oc.get("/v1/admin/disputes", params={"event_id": "not-a-uuid"})
        assert r.status_code == 422, r.text

    def test_unauthorized_access_is_rejected(self, client):
        pc = participant_client(client, "p4.team1@example.com")
        assert pc.get("/v1/admin/disputes").status_code == 403
        anon = TestClient(client.app)
        assert anon.get("/v1/admin/disputes").status_code in (401, 403)
