"""Regression tests for the Section 5.1 P0 finding F-C-01 (admin.py).

F-C-01: organizer pause/resume was broken end to end. The pause transition
recorded to_status='pause' while resume looked up to_status='paused', so
resume raised NoResultFound (500), the stage stayed paused forever, and the
pause-time deadline compensation never applied.

These tests assert the actual stage rows, transition rows and deadline
values in the database, not only HTTP status codes.
"""

from __future__ import annotations

import threading

from app.db import app_engine
from conftest import STAFF_PW, participant_client
from fastapi.testclient import TestClient
from sqlalchemy import text

ORG_EMAIL = "organizer@example.com"


# --- helpers -------------------------------------------------------------------


def _organizer_client(client: TestClient) -> TestClient:
    org = client.post("/v1/auth/login", json={"email": ORG_EMAIL, "password": STAFF_PW}).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    oc._token = org["access_token"]  # type: ignore[attr-defined]
    return oc


def _active_main_stage(client: TestClient) -> tuple[str, str, TestClient]:
    """Idempotently move the seeded main stage to active; returns (event_id, stage_id, oc)."""
    oc = _organizer_client(client)
    ev = oc.get("/v1/admin/events").json()["events"][0]
    stage = oc.get(f"/v1/admin/events/{ev['id']}/live").json()["stages"][0]
    stage_id = stage["id"]
    for action in ("seal", "arm", "start"):
        if stage["status"] == "active":
            break
        r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": action, "reason": "test setup"})
        # a later stage in the lifecycle (or an already-performed step) is fine
        if r.status_code == 200:
            stage["status"] = {"seal": "sealed", "arm": "armed", "start": "active"}[action]
    assert _stage_row(stage_id)["status"] == "active"
    return ev["id"], stage_id, oc


def _stage_row(stage_id: str) -> dict:
    with app_engine.connect() as conn:
        row = (
            conn.execute(
                text("SELECT id, status, starts_at, ends_at, started_at FROM app.stages WHERE id = CAST(:s AS uuid)"),
                {"s": stage_id},
            )
            .mappings()
            .one()
        )
    return dict(row)


def _transitions(stage_id: str) -> list[dict]:
    with app_engine.connect() as conn:
        rows = (
            conn.execute(
                text(
                    "SELECT from_status, to_status, created_at FROM app.stage_transitions "
                    "WHERE stage_id = CAST(:s AS uuid) ORDER BY created_at, id"
                ),
                {"s": stage_id},
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def _db_now() -> object:
    with app_engine.connect() as conn:
        return conn.execute(text("SELECT now()")).scalar_one()


def _backdate_latest_pause(stage_id: str, seconds: int) -> None:
    with app_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE app.stage_transitions SET created_at = clock_timestamp() - make_interval(secs => :seconds) "
                "WHERE id = ("
                "SELECT id FROM app.stage_transitions WHERE stage_id = CAST(:s AS uuid) "
                "AND from_status = 'active' AND to_status IN ('paused', 'pause') "
                "ORDER BY created_at DESC, id DESC LIMIT 1)"
            ),
            {"s": stage_id, "seconds": seconds},
        )


# --- 1. active -> paused --------------------------------------------------------


def test_pause_active_stage_persists_paused_state(client):
    _, stage_id, oc = _active_main_stage(client)
    before = _stage_row(stage_id)
    assert before["status"] == "active"

    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "F-C-01 drill"})

    assert r.status_code == 200, r.text
    after = _stage_row(stage_id)
    assert after["status"] == "paused"
    # the transition row must record the normalized status 'paused', not 'pause'
    paused_rows = [t for t in _transitions(stage_id) if t["to_status"] == "paused"]
    assert len(paused_rows) == 1
    assert paused_rows[0]["from_status"] == "active"


# --- 2. paused -> active --------------------------------------------------------


def test_resume_paused_stage_restores_active_state(client):
    _, stage_id, oc = _active_main_stage(client)
    oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "setup"})
    assert _stage_row(stage_id)["status"] == "paused"

    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "F-C-01 drill"})

    assert r.status_code == 200, r.text  # previously a guaranteed 500
    assert _stage_row(stage_id)["status"] == "active"
    resumed_rows = [t for t in _transitions(stage_id) if t["from_status"] == "paused" and t["to_status"] == "active"]
    assert len(resumed_rows) == 1


# --- 3. correct pause timestamp --------------------------------------------------


def test_pause_records_timestamp_close_to_db_clock(client):
    _, stage_id, oc = _active_main_stage(client)
    t_before = _db_now()
    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "F-C-01 drill"})
    assert r.status_code == 200, r.text
    t_after = _db_now()

    paused_at = _transitions(stage_id)[-1]["created_at"]
    assert t_before <= paused_at <= t_after, (t_before, paused_at, t_after)


# --- 4. effective-deadline compensation ------------------------------------------


def test_resume_extends_deadline_by_paused_duration(client):
    _, stage_id, oc = _active_main_stage(client)
    ends_before_pause = _stage_row(stage_id)["ends_at"]
    assert ends_before_pause is not None

    oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "F-C-01 drill"})
    _backdate_latest_pause(stage_id, 120)
    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "F-C-01 drill"})
    assert r.status_code == 200, r.text

    ends_after = _stage_row(stage_id)["ends_at"]
    gained = (ends_after - ends_before_pause).total_seconds()
    assert gained == 120, gained


def test_resume_uses_pause_window_even_after_extend(client):
    _, stage_id, oc = _active_main_stage(client)
    ends_before = _stage_row(stage_id)["ends_at"]
    oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "setup"})
    _backdate_latest_pause(stage_id, 120)
    extended = oc.post(
        f"/v1/admin/stages/{stage_id}/control",
        json={"action": "extend", "seconds": 30, "reason": "paused extension"},
    )
    assert extended.status_code == 200, extended.text
    resumed = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "resume"})
    assert resumed.status_code == 200, resumed.text
    assert (_stage_row(stage_id)["ends_at"] - ends_before).total_seconds() == 150


def test_resume_compensates_legacy_pause_status(client):
    _, stage_id, oc = _active_main_stage(client)
    ends_before = _stage_row(stage_id)["ends_at"]
    with app_engine.begin() as conn:
        conn.execute(text("UPDATE app.stages SET status='paused' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
        conn.execute(
            text(
                "INSERT INTO app.stage_transitions (id, stage_id, from_status, to_status, actor_id, reason_code, created_at) "
                "VALUES (CAST(:id AS uuid), CAST(:s AS uuid), 'active', 'pause', NULL, 'legacy', "
                "clock_timestamp() - make_interval(secs => 90))"
            ),
            {"id": "00000000-0000-0000-0000-000000000001", "s": stage_id},
        )
    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "legacy"})
    assert r.status_code == 200, r.text
    assert (_stage_row(stage_id)["ends_at"] - ends_before).total_seconds() == 90


def test_resume_without_pause_record_falls_back_cleanly(client):
    """A stage paused before the fix (no 'paused' transition row) must resume, not 500."""
    _, stage_id, oc = _active_main_stage(client)
    with app_engine.begin() as conn:
        conn.execute(text("UPDATE app.stages SET status='paused' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
    ends_before = _stage_row(stage_id)["ends_at"]

    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "legacy recovery"})

    assert r.status_code == 200, r.text
    row = _stage_row(stage_id)
    assert row["status"] == "active"
    assert row["ends_at"] == ends_before  # nothing to compensate: no pause row


# --- 5. repeated pause/resume cycles ----------------------------------------------


def test_repeated_pause_resume_cycles_compensate_each_window(client):
    _, stage_id, oc = _active_main_stage(client)
    ends_original = _stage_row(stage_id)["ends_at"]

    for cycle in range(3):
        r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": f"cycle {cycle}"})
        assert r.status_code == 200, r.text
        assert _stage_row(stage_id)["status"] == "paused"
        _backdate_latest_pause(stage_id, 120 - cycle * 30)
        r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": f"cycle {cycle}"})
        assert r.status_code == 200, r.text
        assert _stage_row(stage_id)["status"] == "active"

    ends_final = _stage_row(stage_id)["ends_at"]
    gained = (ends_final - ends_original).total_seconds()
    assert gained == 120 + 90 + 60, gained
    assert len([t for t in _transitions(stage_id) if t["to_status"] == "paused"]) == 3


# --- 6. repeated resume requests ---------------------------------------------------


def test_second_resume_is_rejected_without_double_compensation(client):
    _, stage_id, oc = _active_main_stage(client)
    oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "setup"})
    r1 = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "first"})
    assert r1.status_code == 200, r1.text
    ends_after_first = _stage_row(stage_id)["ends_at"]

    r2 = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "second"})
    assert r2.status_code == 422
    assert r2.json()["error"]["code"] == "VALIDATION_ERROR"
    assert _stage_row(stage_id)["ends_at"] == ends_after_first  # no second compensation


# --- 7./8. unauthorized pause and resume --------------------------------------------


def test_participant_cannot_pause_or_resume(client):
    _, stage_id, _ = _active_main_stage(client)
    pc = participant_client(client, "p1.team1@example.com")

    r = pc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "takeover"})
    assert r.status_code == 403
    assert _stage_row(stage_id)["status"] == "active"

    oc = _organizer_client(client)
    oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "setup"})
    assert _stage_row(stage_id)["status"] == "paused"

    r = pc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "takeover"})
    assert r.status_code == 403
    assert _stage_row(stage_id)["status"] == "paused"


def test_anonymous_cannot_pause_or_resume(client):
    _, stage_id, _ = _active_main_stage(client)
    anon = TestClient(client.app)
    for action in ("pause", "resume"):
        r = anon.post(f"/v1/admin/stages/{stage_id}/control", json={"action": action, "reason": "anon"})
        assert r.status_code in (401, 403)


# --- 9. invalid transitions ----------------------------------------------------------


def test_invalid_pause_resume_transitions_are_rejected(client):
    _, stage_id, oc = _active_main_stage(client)

    # pause on a draft stage: create a second stage that is still draft
    ev = oc.get("/v1/admin/events").json()["events"][0]
    new_stage = oc.post(
        f"/v1/admin/events/{ev['id']}/stages", json={"name": "F-C-01 draft stage", "kind": "main"}
    ).json()
    draft_id = new_stage["stage_id"]
    assert _stage_row(draft_id)["status"] == "draft"

    r = oc.post(f"/v1/admin/stages/{draft_id}/control", json={"action": "pause", "reason": "x"})
    assert r.status_code == 422
    r = oc.post(f"/v1/admin/stages/{draft_id}/control", json={"action": "resume", "reason": "x"})
    assert r.status_code == 422

    # active stage cannot resume; after pausing it cannot pause again
    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "x"})
    assert r.status_code == 422
    oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "x"})
    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "x"})
    assert r.status_code == 422
    assert _stage_row(stage_id)["status"] == "paused"


# --- 10. concurrent pause/resume ------------------------------------------------------


def test_concurrent_pause_requests_apply_exactly_once(client):
    _, stage_id, oc = _active_main_stage(client)
    token = oc._token  # type: ignore[attr-defined]

    def worker(results: list, action: str):
        c = TestClient(client.app)
        c.headers.update({"Authorization": f"Bearer {token}"})
        r = c.post(f"/v1/admin/stages/{stage_id}/control", json={"action": action, "reason": "concurrent"})
        results.append(r.status_code)

    results: list[int] = []
    threads = [threading.Thread(target=worker, args=(results, "pause")) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert len(results) == 4
    assert 500 not in results
    assert results.count(200) == 1, results
    assert results.count(422) == 3, results
    assert _stage_row(stage_id)["status"] == "paused"
    assert len([t for t in _transitions(stage_id) if t["to_status"] == "paused"]) == 1


def test_concurrent_mixed_pause_and_resume_never_500s(client):
    _, stage_id, oc = _active_main_stage(client)
    token = oc._token  # type: ignore[attr-defined]

    def worker(results: list, action: str):
        c = TestClient(client.app)
        c.headers.update({"Authorization": f"Bearer {token}"})
        r = c.post(f"/v1/admin/stages/{stage_id}/control", json={"action": action, "reason": "concurrent"})
        results.append((action, r.status_code))

    results: list[tuple[str, int]] = []
    threads = [
        threading.Thread(target=worker, args=(results, a))
        for a in ("pause", "pause", "resume", "resume", "pause", "resume")
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert len(results) == 6
    assert all(code in (200, 422) for _, code in results), results  # never a 500
    final = _stage_row(stage_id)
    assert final["status"] in ("active", "paused")
    # every successful action has exactly one transition row with the normalized status
    tos = [t["to_status"] for t in _transitions(stage_id)]
    assert all(s in ("sealed", "armed", "active", "paused", "ended") for s in tos), tos


# --- pause actually stops submissions (state machine contract) ------------------------


def test_paused_stage_rejects_submissions_and_resume_reaccepts(client):
    pc = participant_client(client, "p1.team1@example.com")  # arms + starts the main stage
    oc = _organizer_client(client)
    ev = oc.get("/v1/admin/events").json()["events"][0]
    stage = oc.get(f"/v1/admin/events/{ev['id']}/live").json()["stages"][0]
    stage_id = stage["id"]
    assert _stage_row(stage_id)["status"] == "active"

    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "pause", "reason": "F-C-01 drill"})
    assert r.status_code == 200, r.text

    import uuid as uuid_lib

    r = pc.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": pc.get("/v1/assignments").json()["assignments"][0]["challenge_id"],
            "file_path": "db.js",
            "line_start": 57,
            "line_end": 60,
            "category": "data_handling",
            "title": "Paused-stage probe",
            "description": "deleteNote prepares DELETE FROM notes WHERE id = ? and the route feeds it the author id.",
        },
        headers={"Idempotency-Key": str(uuid_lib.uuid4())},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "ROUND_PAUSED"

    r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": "resume", "reason": "F-C-01 drill"})
    assert r.status_code == 200, r.text
    assert _stage_row(stage_id)["status"] == "active"

    r = pc.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": pc.get("/v1/assignments").json()["assignments"][0]["challenge_id"],
            "file_path": "db.js",
            "line_start": 57,
            "line_end": 60,
            "category": "data_handling",
            "title": "Paused-stage probe after resume",
            "description": "deleteNote prepares DELETE FROM notes WHERE id = ? and the route feeds it the author id.",
        },
        headers={"Idempotency-Key": str(uuid_lib.uuid4())},
    )
    assert r.status_code == 202, r.text
