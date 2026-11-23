"""Submission idempotency and durability tests (AT-03/AT-04, architecture 8.1)."""

from __future__ import annotations

import uuid

from conftest import STAFF_PW, participant_client, worker_drain


def _report(challenge_id: str, **over):
    body = {
        "kind": "bug_report",
        "challenge_id": challenge_id,
        "file_path": "routes/notes.js",
        "line_start": 44,
        "line_end": 46,
        "category": "data_handling",
        "title": "Delete uses author id as note id",
        "description": "The delete route passes note.author_id into a query that matches by note id, so the wrong note disappears.",
        "evidence": "DELETE /api/notes/2 removed note 1 for user id 1.",
    }
    body.update(over)
    return body


def test_same_key_five_times_returns_one_receipt(client):
    pc = participant_client(client, "p1.team1@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    key = str(uuid.uuid4())
    receipts = []
    for _ in range(5):
        r = pc.post("/v1/submissions", json=_report(asg["challenge_id"]), headers={"Idempotency-Key": key})
        assert r.status_code == 202, r.text
        receipts.append(r.json())
    assert len({r["submission_id"] for r in receipts}) == 1
    assert len({r["receipt_code"] for r in receipts}) == 1


def test_same_key_different_payload_conflicts(client):
    pc = participant_client(client, "p1.team1@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    key = str(uuid.uuid4())
    r1 = pc.post("/v1/submissions", json=_report(asg["challenge_id"]), headers={"Idempotency-Key": key})
    assert r1.status_code == 202
    r2 = pc.post(
        "/v1/submissions",
        json=_report(asg["challenge_id"], title="A different report entirely"),
        headers={"Idempotency-Key": key},
    )
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_committed_key_replays_original_receipt_after_deadline(client):
    """A retry with the same key after the round ended returns the ORIGINAL
    receipt (never a ROUND_ENDED error) - architecture 8.1 step 2."""
    pc = participant_client(client, "p1.team1@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    key = str(uuid.uuid4())
    r1 = pc.post("/v1/submissions", json=_report(asg["challenge_id"]), headers={"Idempotency-Key": key})
    receipt = r1.json()
    worker_drain()

    stage_id = pc._stage_id
    # end the stage through the admin flow
    org = client.post("/v1/auth/login", json={"email": "organizer@example.com", "password": STAFF_PW}).json()
    from fastapi.testclient import TestClient

    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    oc.post(
        f"/v1/admin/stages/{stage_id}/control", json={"action": "end", "reason": "deadline test"}
    ).raise_for_status()

    # a NEW submission must now be rejected
    r_new = pc.post(
        "/v1/submissions",
        json=_report(asg["challenge_id"], file_path="db.js", line_start=55, line_end=58, title="Late new report"),
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r_new.status_code == 409
    assert r_new.json()["error"]["code"] == "ROUND_ENDED"

    # the committed key replay returns the original receipt
    r_replay = pc.post("/v1/submissions", json=_report(asg["challenge_id"]), headers={"Idempotency-Key": key})
    assert r_replay.status_code == 202
    assert r_replay.json()["submission_id"] == receipt["submission_id"]
    assert r_replay.json()["receipt_code"] == receipt["receipt_code"]


def test_per_file_cooldown_races_are_rejected(client):
    pc = participant_client(client, "p2.team2@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    r1 = pc.post("/v1/submissions", json=_report(asg["challenge_id"]), headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r1.status_code == 202
    r2 = pc.post(
        "/v1/submissions",
        json=_report(asg["challenge_id"], line_start=30, line_end=34, title="Second immediate report"),
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r2.status_code == 429
    assert r2.json()["error"]["code"] == "SUBMISSION_COOLDOWN"
