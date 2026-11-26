"""Authorization and IDOR tests (AT-09, SEC-01/SEC-02)."""

from __future__ import annotations

import uuid

from conftest import STAFF_PW, participant_client


def test_participant_cannot_read_other_teams_submission(client):
    pc1 = participant_client(client, "p1.team1@example.com")
    asg = pc1.get("/v1/assignments").json()["assignments"][0]
    r = pc1.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": asg["challenge_id"],
            "file_path": "db.js",
            "line_start": 57,
            "line_end": 60,
            "category": "data_handling",
            "title": "Cross team probe report",
            "description": "deleteNote prepares DELETE FROM notes WHERE id = ? and the route feeds it the author id.",
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 202
    sub_id = r.json()["submission_id"]

    pc2 = participant_client(client, "p1.team2@example.com")
    r = pc2.get(f"/v1/submissions/{sub_id}")
    assert r.status_code == 404  # not 403: existence is not disclosed


def test_participant_cannot_use_admin_endpoints(client):
    pc = participant_client(client, "p2.team1@example.com")
    r = pc.get("/v1/admin/events")
    assert r.status_code == 403
    r = pc.get("/v1/admin/audit")
    assert r.status_code == 403
    r = pc.get("/v1/review/queue")
    assert r.status_code == 403


def test_reviewer_cannot_use_admin_event_creation(client):
    from fastapi.testclient import TestClient

    token = client.post("/v1/auth/login", json={"email": "reviewer1@example.com", "password": STAFF_PW}).json()[
        "access_token"
    ]
    rc = TestClient(client.app)
    rc.headers.update({"Authorization": f"Bearer {token}"})
    r = rc.post("/v1/admin/events", json={"name": "Sneaky Event", "slug": "sneaky-event"})
    assert r.status_code == 403
    r = rc.post("/v1/admin/adjustments", json={"stage_id": "x", "team_id": "y", "points": 5, "reason": "nope"})
    assert r.status_code == 403


def test_forged_challenge_id_is_ignored_by_server(client):
    """The persisted challenge version must come from the participant's assignment."""
    from app.db import app_engine
    from sqlalchemy import text

    pc = participant_client(client, "p2.team2@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    fake_challenge = str(uuid.uuid4())
    r = pc.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": fake_challenge,
            "file_path": "db.js",
            "line_start": 1,
            "line_end": 3,
            "category": "logic",
            "title": "Forged challenge report",
            "description": "This submission references a challenge id that is not assigned to this team.",
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 202
    submission_id = r.json()["submission_id"]
    detail = pc.get(f"/v1/submissions/{submission_id}").json()

    with app_engine.connect() as conn:
        stored_challenge_id = conn.execute(
            text("SELECT challenge_version_id FROM app.submissions WHERE id = CAST(:sid AS uuid)"),
            {"sid": submission_id},
        ).scalar_one()

    assert str(stored_challenge_id) == asg["challenge_id"]
    assert detail["payload"]["challenge_id"] == asg["challenge_id"]
    assert detail["payload"]["challenge_id"] != fake_challenge
    assert detail["file_path"] in {file["path"] for file in asg["files"]}


def test_unauthenticated_requests_rejected(client):
    r = client.get("/v1/submissions")
    assert r.status_code in (401, 403)
    r = client.get("/v1/admin/audit")
    assert r.status_code in (401, 403)
    r = client.get("/v1/state")
    assert r.status_code in (401, 403)


def test_path_traversal_rejected(client):
    pc = participant_client(client, "p3.team1@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    for evil in ("../../etc/passwd", "/etc/passwd", "routes/../../secrets.txt", "notes.js\x00.txt"):
        r = pc.get("/v1/challenges/{}/files/content".format(asg["challenge_id"]), params={"path": evil})
        assert r.status_code == 400, f"{evil}: {r.status_code} {r.text}"
        assert r.json()["error"]["code"] == "PATH_INVALID", f"{evil}: {r.text}"


def test_report_payload_preserves_untrusted_text_for_frontend_rendering(client):
    """The API preserves report text; the frontend renderer is tested separately."""
    pc = participant_client(client, "p3.team1@example.com")
    asg = pc.get("/v1/assignments").json()["assignments"][0]
    nasty = "<script>alert('xss')</script> '; DELETE FROM users; --"
    r = pc.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": asg["challenge_id"],
            "file_path": "public/app.js",
            "line_start": 80,
            "line_end": 84,
            "category": "injection",
            "title": "Comments execute injected markup",
            "description": f"The comment renderer interpolates raw HTML like {nasty} into innerHTML for every reader.",
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 202
    sub_id = r.json()["submission_id"]
    detail = pc.get(f"/v1/submissions/{sub_id}").json()
    assert nasty in detail["payload"]["description"]  # stored verbatim
    assert client.get("/v1/submissions").status_code in (401, 403)
