"""Participant submission receipts, ownership, release masking, and dispute effects."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from app.db import app_session
from conftest import login, participant_client
from fastapi.testclient import TestClient
from sqlalchemy import text

MASKED_STATUSES = (
    "received",
    "matched_auto",
    "needs_review",
    "in_review",
    "decided",
    "ledgered",
    "rejected_auto",
    "duplicate",
)
LIST_BASE_KEYS = {
    "id",
    "kind",
    "title",
    "file_path",
    "line_start",
    "line_end",
    "category",
    "receipt_code",
    "received_at",
    "flag_code",
}
DETAIL_KEYS = {
    "id",
    "kind",
    "title",
    "file_path",
    "line_start",
    "line_end",
    "category",
    "receipt_code",
    "received_at",
    "payload",
    "released",
    "matched_bug_code",
    "points",
}


def _authenticated_client(client: TestClient, email: str) -> TestClient:
    token = login(client, email)["access_token"]
    authenticated = TestClient(client.app)
    authenticated.headers.update({"Authorization": f"Bearer {token}"})
    return authenticated


def _submission_context(email: str = "p1.team1@example.com") -> dict:
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT u.id AS author_id, tm.team_id, t.event_id, e.tenant_id, st.id AS stage_id, "
                    "st.rule_set_hash, cv.id AS challenge_id FROM app.users u JOIN app.team_members tm ON tm.user_id = u.id "
                    "JOIN app.teams t ON t.id = tm.team_id JOIN app.events e ON e.id = t.event_id "
                    "JOIN app.stages st ON st.event_id = e.id AND st.kind = 'main' "
                    "JOIN app.assignments a ON a.stage_id = st.id "
                    "JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                    "WHERE u.email = :email LIMIT 1"
                ),
                {"email": email},
            )
            .mappings()
            .one()
        )
    return {key: str(value) for key, value in row.items()}


def _report_body(challenge_id: str) -> dict:
    return {
        "kind": "bug_report",
        "challenge_id": challenge_id,
        "file_path": "db.js",
        "line_start": 1,
        "line_end": 3,
        "category": "logic",
        "title": "Participant response fixture",
        "description": "This report records a reproducible participant-visible failure with enough detail.",
    }


def _insert_submission(
    context: dict,
    *,
    status: str,
    feedback_released: bool,
    matched_bug_code: str | None,
    points_visible: float,
    received_at: datetime,
    kind: str = "bug_report",
    flag_code: str | None = None,
) -> dict:
    submission_id = str(uuid.uuid4())
    receipt = f"S-{submission_id[:12]}"
    title = f"Submission fixture {submission_id[:8]}"
    payload = {
        "kind": kind,
        "challenge_id": str(context["challenge_id"]),
        "description": "Participant-owned plain text payload.",
    }
    if kind == "ctf_flag":
        payload["flag_code"] = flag_code
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.submissions "
                "(id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                "idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, line_start, "
                "line_end, category, flag_code, received_at, feedback_released, matched_bug_code, points_visible) "
                "VALUES (CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:challenge AS uuid), CAST(:team AS uuid), CAST(:author AS uuid), :kind, :key, "
                "CAST(:payload AS jsonb), :hash, :status, :receipt, :title, :file_path, :line_start, :line_end, "
                ":category, :flag, :received, :released, :matched, :points)"
            ),
            {
                "id": submission_id,
                "tenant": str(context["tenant_id"]),
                "event": str(context["event_id"]),
                "stage": str(context["stage_id"]),
                "challenge": str(context["challenge_id"]),
                "team": str(context["team_id"]),
                "author": str(context["author_id"]),
                "kind": kind,
                "key": f"response-{submission_id}",
                "payload": json.dumps(payload),
                "hash": uuid.uuid4().hex,
                "status": status,
                "receipt": receipt,
                "title": title,
                "file_path": None if kind == "ctf_flag" else "db.js",
                "line_start": None if kind == "ctf_flag" else 1,
                "line_end": None if kind == "ctf_flag" else 3,
                "category": None if kind == "ctf_flag" else "logic",
                "flag": flag_code,
                "received": received_at,
                "released": feedback_released,
                "matched": matched_bug_code,
                "points": points_visible,
            },
        )
    return {
        "id": submission_id,
        "team_id": str(context["team_id"]),
        "receipt_code": receipt,
        "title": title,
        "received_at": received_at.isoformat(),
        "payload": payload,
    }


def test_create_submission_uses_server_identity_and_commits_all_response_effects(client):
    pc = participant_client(client, "p1.team1@example.com")
    assignment = pc.get("/v1/assignments").json()["assignments"][0]
    context = _submission_context()
    forged_challenge = str(uuid.uuid4())
    body = _report_body(forged_challenge)
    body.update(
        {
            "author_id": str(uuid.uuid4()),
            "team_id": str(uuid.uuid4()),
            "status": "ledgered",
            "feedback_released": True,
            "matched_bug_code": "CLIENT-VERDICT-SENTINEL",
            "points_visible": 999.0,
        }
    )
    idempotency_key = f"create-response-{uuid.uuid4()}"

    response = pc.post("/v1/submissions", json=body, headers={"Idempotency-Key": idempotency_key})
    assert response.status_code == 202, response.text
    receipt = response.json()
    assert set(receipt) == {"submission_id", "receipt_code", "received_at", "status", "replay", "team_id"}
    assert receipt["status"] == "received"
    assert receipt["replay"] is False
    assert receipt["team_id"] == context["team_id"]
    assert str(uuid.UUID(receipt["submission_id"])) == receipt["submission_id"]
    assert datetime.fromisoformat(receipt["received_at"]).tzinfo is not None
    assert "CLIENT-VERDICT-SENTINEL" not in response.text

    with app_session() as s:
        stored = (
            s.execute(
                text(
                    "SELECT tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                    "idempotency_key, payload, payload_hash, status, receipt_code, received_at, feedback_released, "
                    "matched_bug_code, points_visible FROM app.submissions WHERE id = CAST(:id AS uuid)"
                ),
                {"id": receipt["submission_id"]},
            )
            .mappings()
            .one()
        )
        jobs = s.execute(text("SELECT kind, payload, status FROM app.jobs ORDER BY created_at, kind")).mappings().all()
        outbox = (
            s.execute(text("SELECT event_type, payload FROM app.outbox_events ORDER BY created_at")).mappings().all()
        )
        audit = (
            s.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_type, entity_id, details, event_scope "
                    "FROM audit.entries WHERE action = 'submission.created' AND entity_id = :submission_id"
                ),
                {"submission_id": receipt["submission_id"]},
            )
            .mappings()
            .one()
        )
    assert str(stored["tenant_id"]) == context["tenant_id"]
    assert str(stored["event_id"]) == context["event_id"]
    assert str(stored["stage_id"]) == context["stage_id"]
    assert str(stored["challenge_version_id"]) == assignment["challenge_id"]
    assert str(stored["challenge_version_id"]) != forged_challenge
    assert str(stored["team_id"]) == context["team_id"]
    assert str(stored["author_id"]) == context["author_id"]
    assert stored["kind"] == "bug_report"
    assert stored["idempotency_key"] == idempotency_key
    assert stored["status"] == "received"
    assert stored["receipt_code"] == receipt["receipt_code"]
    assert stored["received_at"].isoformat() == receipt["received_at"]
    assert stored["feedback_released"] is False
    assert stored["matched_bug_code"] is None
    assert float(stored["points_visible"]) == 0.0
    assert stored["payload"]["challenge_id"] == assignment["challenge_id"]
    assert stored["payload"]["file_path"] == "db.js"
    assert "author_id" not in stored["payload"]
    assert "team_id" not in stored["payload"]
    assert "status" not in stored["payload"]
    assert "feedback_released" not in stored["payload"]
    assert "matched_bug_code" not in stored["payload"]
    assert "points_visible" not in stored["payload"]
    assert len(stored["payload_hash"]) == 64
    assert [(job["kind"], job["status"]) for job in jobs] == [
        ("evaluate_submission", "queued"),
        ("refresh_leaderboard", "queued"),
    ]
    assert jobs[0]["payload"] == {
        "submission_id": receipt["submission_id"],
        "rule_set_hash": context["rule_set_hash"],
    }
    assert jobs[1]["payload"] == {"stage_id": context["stage_id"]}
    assert len(outbox) == 1
    assert outbox[0]["event_type"] == "submission_update"
    assert outbox[0]["payload"] == {"submission_id": receipt["submission_id"], "status": "received"}
    assert str(audit["actor_id"]) == context["author_id"]
    assert audit["actor_role"] == "participant"
    assert audit["action"] == "submission.created"
    assert audit["entity_type"] == "submission"
    assert audit["entity_id"] == receipt["submission_id"]
    assert audit["details"] == {"kind": "bug_report", "receipt": receipt["receipt_code"]}
    assert audit["event_scope"] == f"event:{context['event_id']}"


def test_idempotent_replay_returns_original_safe_receipt_after_state_changes(client):
    pc = participant_client(client, "p1.team1@example.com")
    challenge_id = pc.get("/v1/assignments").json()["assignments"][0]["challenge_id"]
    context = _submission_context()
    body = _report_body(challenge_id)
    idempotency_key = f"replay-response-{uuid.uuid4()}"
    first = pc.post("/v1/submissions", json=body, headers={"Idempotency-Key": idempotency_key})
    assert first.status_code == 202
    original = first.json()
    with app_session() as s:
        s.execute(
            text(
                "UPDATE app.submissions SET status = 'ledgered', feedback_released = true, "
                "matched_bug_code = 'PRIVATE-REPLAY-VERDICT', points_visible = 987.65 "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": original["submission_id"]},
        )
        s.execute(
            text("UPDATE app.stages SET status = 'ended' WHERE id = CAST(:stage AS uuid)"),
            {"stage": context["stage_id"]},
        )

    replay = pc.post("/v1/submissions", json=body, headers={"Idempotency-Key": idempotency_key})
    assert replay.status_code == 202
    assert replay.json() == {**original, "replay": True}
    assert "PRIVATE-REPLAY-VERDICT" not in replay.text
    assert "987.65" not in replay.text
    conflict = pc.post(
        "/v1/submissions",
        json={**body, "title": "Different payload for the same key"},
        headers={"Idempotency-Key": idempotency_key},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    with app_session() as s:
        count = s.execute(
            text("SELECT count(*) FROM app.submissions WHERE idempotency_key = :key"),
            {"key": idempotency_key},
        ).scalar_one()
        jobs = s.execute(text("SELECT count(*) FROM app.jobs")).scalar_one()
        outbox = s.execute(text("SELECT count(*) FROM app.outbox_events")).scalar_one()
    assert count == 1
    assert jobs == 2
    assert outbox == 1


def test_submission_list_masks_currently_coarse_statuses_and_verdict_fields(client):
    pc = participant_client(client, "p1.team1@example.com")
    context = _submission_context()
    foreign_context = _submission_context("p1.team2@example.com")
    base = datetime(2026, 1, 1, tzinfo=UTC)
    fixtures = []
    for index, status in enumerate(MASKED_STATUSES):
        fixtures.append(
            _insert_submission(
                context,
                status=status,
                feedback_released=False,
                matched_bug_code="PRIVATE-LIST-VERDICT-SENTINEL",
                points_visible=987.65,
                received_at=base + timedelta(seconds=index),
            )
        )
    foreign = _insert_submission(
        foreign_context,
        status="received",
        feedback_released=False,
        matched_bug_code="PRIVATE-FOREIGN-VERDICT-SENTINEL",
        points_visible=123.45,
        received_at=base + timedelta(seconds=20),
    )

    response = pc.get("/v1/submissions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"submissions"}
    assert [item["id"] for item in body["submissions"]] == [item["id"] for item in reversed(fixtures)]
    assert foreign["id"] not in {item["id"] for item in body["submissions"]}
    for item, fixture in zip(body["submissions"], reversed(fixtures), strict=True):
        assert set(item) == LIST_BASE_KEYS | {"status"}
        assert item == {
            "id": fixture["id"],
            "kind": "bug_report",
            "title": fixture["title"],
            "file_path": "db.js",
            "line_start": 1,
            "line_end": 3,
            "category": "logic",
            "receipt_code": fixture["receipt_code"],
            "received_at": fixture["received_at"],
            "flag_code": None,
            "status": "received",
        }
    assert "PRIVATE-LIST-VERDICT-SENTINEL" not in response.text
    assert "PRIVATE-FOREIGN-VERDICT-SENTINEL" not in response.text
    assert "matched_bug_code" not in response.text
    assert "points_visible" not in response.text
    assert "987.65" not in response.text

    for fixture in fixtures:
        detail = pc.get(f"/v1/submissions/{fixture['id']}")
        assert detail.status_code == 200
        detail_body = detail.json()
        assert set(detail_body) == DETAIL_KEYS
        assert detail_body == {
            "id": fixture["id"],
            "kind": "bug_report",
            "title": fixture["title"],
            "file_path": "db.js",
            "line_start": 1,
            "line_end": 3,
            "category": "logic",
            "receipt_code": fixture["receipt_code"],
            "received_at": fixture["received_at"],
            "payload": fixture["payload"],
            "released": False,
            "matched_bug_code": None,
            "points": None,
        }
        assert "PRIVATE-LIST-VERDICT-SENTINEL" not in detail.text
        assert "987.65" not in detail.text


def test_foreign_and_unknown_submission_ids_are_indistinguishable(client):
    pc = participant_client(client, "p1.team1@example.com")
    foreign_context = _submission_context("p1.team2@example.com")
    foreign = _insert_submission(
        foreign_context,
        status="received",
        feedback_released=False,
        matched_bug_code="PRIVATE-FOREIGN-DETAIL-SENTINEL",
        points_visible=543.21,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    responses = [
        pc.get(f"/v1/submissions/{foreign['id']}", headers={"X-Request-Id": "submission-ownership-probe"}),
        pc.get(f"/v1/submissions/{uuid.uuid4()}", headers={"X-Request-Id": "submission-ownership-probe"}),
    ]
    assert all(response.status_code == 404 for response in responses)
    assert (
        responses[0].json()
        == responses[1].json()
        == {
            "error": {
                "code": "NOT_FOUND",
                "message": "Not found.",
                "request_id": "submission-ownership-probe",
                "details": {},
            }
        }
    )
    assert all("PRIVATE-FOREIGN-DETAIL-SENTINEL" not in response.text for response in responses)


def test_released_submission_list_and_detail_expose_only_released_fields(client):
    pc = participant_client(client, "p1.team1@example.com")
    context = _submission_context()
    received_at = datetime(2026, 1, 1, tzinfo=UTC)
    report = _insert_submission(
        context,
        status="matched_auto",
        feedback_released=True,
        matched_bug_code="RELEASED-VERDICT-ONE",
        points_visible=12.5,
        received_at=received_at,
    )
    flag = _insert_submission(
        context,
        status="matched_auto",
        feedback_released=True,
        matched_bug_code=None,
        points_visible=30.0,
        received_at=received_at + timedelta(seconds=1),
        kind="ctf_flag",
        flag_code="FLAG{participant-owned-submission}",
    )

    response = pc.get("/v1/submissions")
    assert response.status_code == 200
    items = response.json()["submissions"]
    assert [item["id"] for item in items] == [flag["id"], report["id"]]
    assert all(set(item) == LIST_BASE_KEYS | {"status", "matched_bug_code", "points_visible"} for item in items)
    assert items[0] == {
        "id": flag["id"],
        "kind": "ctf_flag",
        "title": flag["title"],
        "file_path": None,
        "line_start": None,
        "line_end": None,
        "category": None,
        "receipt_code": flag["receipt_code"],
        "received_at": flag["received_at"],
        "flag_code": "FLAG{participant-owned-submission}",
        "status": "matched_auto",
        "matched_bug_code": None,
        "points_visible": 30.0,
    }
    assert items[1]["status"] == "matched_auto"
    assert items[1]["matched_bug_code"] == "RELEASED-VERDICT-ONE"
    assert items[1]["points_visible"] == 12.5

    detail = pc.get(f"/v1/submissions/{report['id']}")
    assert detail.status_code == 200
    assert set(detail.json()) == DETAIL_KEYS
    assert detail.json()["released"] is True
    assert detail.json()["matched_bug_code"] == "RELEASED-VERDICT-ONE"
    assert detail.json()["points"] == 12.5
    assert "status" not in detail.json()
    assert "feedback_released" not in detail.json()


def test_staff_cannot_use_participant_submission_list_or_detail(client):
    context = _submission_context()
    fixture = _insert_submission(
        context,
        status="received",
        feedback_released=False,
        matched_bug_code=None,
        points_visible=0.0,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    reviewer = _authenticated_client(client, "reviewer1@example.com")
    for path in ("/v1/submissions", f"/v1/submissions/{fixture['id']}"):
        response = reviewer.get(path)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_dispute_requires_release_then_persists_team_scoped_effect(client):
    pc = participant_client(client, "p1.team1@example.com")
    context = _submission_context()
    fixture = _insert_submission(
        context,
        status="decided",
        feedback_released=False,
        matched_bug_code="RELEASED-DISPUTE-VERDICT",
        points_visible=20.0,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    statement = "The released decision does not match the reproduced behavior."
    blocked = pc.post(f"/v1/submissions/{fixture['id']}/dispute", json={"statement": statement})
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "VALIDATION_ERROR"
    assert blocked.json()["error"]["details"] == {"dispute": "Disputes open after results are released."}
    with app_session() as s:
        s.execute(
            text("UPDATE app.submissions SET feedback_released = true WHERE id = CAST(:id AS uuid)"),
            {"id": fixture["id"]},
        )

    request_id = f"participant-dispute-{uuid.uuid4().hex[:8]}"
    response = pc.post(
        f"/v1/submissions/{fixture['id']}/dispute",
        json={"statement": statement},
        headers={"X-Request-Id": request_id},
    )
    assert response.status_code == 201
    assert response.json() == {"ok": True}
    with app_session() as s:
        dispute = (
            s.execute(
                text(
                    "SELECT submission_id, team_id, statement, status FROM app.disputes "
                    "WHERE submission_id = CAST(:submission AS uuid)"
                ),
                {"submission": fixture["id"]},
            )
            .mappings()
            .one()
        )
        submission_status = s.execute(
            text("SELECT status FROM app.submissions WHERE id = CAST(:submission AS uuid)"),
            {"submission": fixture["id"]},
        ).scalar_one()
        audit = (
            s.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_type, entity_id, request_id "
                    "FROM audit.entries WHERE request_id = :request_id"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
    assert str(dispute["submission_id"]) == fixture["id"]
    assert str(dispute["team_id"]) == context["team_id"]
    assert dispute["statement"] == statement
    assert dispute["status"] == "open"
    assert submission_status == "disputed"
    assert str(audit["actor_id"]) == context["author_id"]
    assert audit["actor_role"] == "participant"
    assert audit["action"] == "dispute.created"
    assert audit["entity_type"] == "submission"
    assert audit["entity_id"] == fixture["id"]


def test_foreign_participant_cannot_dispute_another_authors_submission(client):
    owner = participant_client(client, "p1.team1@example.com")
    context = _submission_context()
    fixture = _insert_submission(
        context,
        status="decided",
        feedback_released=True,
        matched_bug_code=None,
        points_visible=0.0,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    foreign = _authenticated_client(client, "p1.team2@example.com")

    response = foreign.post(
        f"/v1/submissions/{fixture['id']}/dispute",
        json={"statement": "This statement must not attach to another author's submission."},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    with app_session() as s:
        count = s.execute(
            text("SELECT count(*) FROM app.disputes WHERE submission_id = CAST(:submission AS uuid)"),
            {"submission": fixture["id"]},
        ).scalar_one()
    assert count == 0
    assert owner.get(f"/v1/submissions/{fixture['id']}").status_code == 200
