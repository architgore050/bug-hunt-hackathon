"""Reviewer queue, claim, detail, decision effects, and announcement response limits."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.db import app_session
from conftest import login
from fastapi.testclient import TestClient
from sqlalchemy import text

QUEUE_ITEM_KEYS = {
    "review_item_id",
    "submission_id",
    "kind",
    "title",
    "file_path",
    "line_range",
    "category",
    "received_at",
    "priority",
    "status",
    "claimed_by_me",
}
DECISION_CASES = [
    ("accept_full", "decided", 1.0),
    ("accept_partial", "decided", 0.5),
    ("duplicate", "duplicate", 0.0),
    ("reject_invalid", "rejected_auto", 0.0),
    ("unplanned_valid", "needs_review", 0.0),
    ("needs_second_review", "in_review", 0.0),
]


def _authenticated_client(client: TestClient, email: str) -> TestClient:
    token = login(client, email)["access_token"]
    authenticated = TestClient(client.app)
    authenticated.headers.update({"Authorization": f"Bearer {token}"})
    return authenticated


def _review_context() -> dict:
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT e.id AS event_id, e.tenant_id, st.id AS stage_id, cv.id AS challenge_id, "
                    "t.id AS team_id, u.id AS author_id, reviewer.id AS reviewer_id "
                    "FROM app.events e JOIN app.stages st ON st.event_id = e.id AND st.kind = 'main' "
                    "JOIN app.assignments a ON a.stage_id = st.id "
                    "JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                    "JOIN app.teams t ON t.event_id = e.id JOIN app.team_members tm ON tm.team_id = t.id "
                    "JOIN app.users u ON u.id = tm.user_id "
                    "JOIN app.users reviewer ON reviewer.email = 'reviewer1@example.com' "
                    "WHERE u.email = 'p1.team1@example.com' LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    return {key: str(value) for key, value in row.items()}


def _insert_review_item(
    context: dict,
    *,
    priority: int = 5,
    status: str = "open",
    claimed_by: str | None = None,
    claimed_at: datetime | None = None,
    kind: str = "bug_report",
    flag_code: str | None = None,
    created_at: datetime | None = None,
) -> dict:
    submission_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    receipt = f"V-{submission_id[:12]}"
    title = f"Review fixture {submission_id[:8]}"
    received_at = created_at or datetime(2026, 1, 1, tzinfo=UTC)
    payload = {
        "description": "Participant text <script>alert('inert')</script> remains plain data.",
        "challenge_id": str(context["challenge_id"]),
    }
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.submissions "
                "(id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, kind, "
                "idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, line_start, "
                "line_end, category, flag_code, received_at) VALUES "
                "(CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:challenge AS uuid), CAST(:team AS uuid), CAST(:author AS uuid), :kind, :key, "
                "CAST(:payload AS jsonb), :hash, :status, :receipt, :title, 'db.js', 10, 12, 'logic', :flag, :received)"
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
                "key": f"review-{submission_id}",
                "payload": json.dumps(payload),
                "hash": uuid.uuid4().hex,
                "status": "in_review" if status == "claimed" else "needs_review",
                "receipt": receipt,
                "title": title,
                "flag": flag_code,
                "received": received_at,
            },
        )
        s.execute(
            text(
                "INSERT INTO app.review_items "
                "(id, submission_id, status, claimed_by, claimed_at, priority, reason, created_at) VALUES "
                "(CAST(:id AS uuid), CAST(:submission AS uuid), :status, CAST(:claimed_by AS uuid), :claimed_at, "
                ":priority, :reason, :created_at)"
            ),
            {
                "id": item_id,
                "submission": submission_id,
                "status": status,
                "claimed_by": claimed_by,
                "claimed_at": claimed_at,
                "priority": priority,
                "reason": "PLAUSIBLE_UNMATCHED",
                "created_at": received_at,
            },
        )
    return {
        "item_id": item_id,
        "submission_id": submission_id,
        "receipt_code": receipt,
        "title": title,
        "payload": payload,
        "received_at": received_at.isoformat(),
    }


def test_review_queue_is_ordered_and_excludes_internal_fields(client):
    context = _review_context()
    with app_session() as s:
        reviewer_two = s.execute(text("SELECT id FROM app.users WHERE email = 'reviewer2@example.com'")).scalar_one()
    base = datetime(2026, 1, 1, tzinfo=UTC)
    claimed = _insert_review_item(
        context,
        priority=1,
        status="claimed",
        claimed_by=str(reviewer_two),
        claimed_at=base,
        created_at=base + timedelta(seconds=1),
    )
    mine = _insert_review_item(
        context,
        priority=3,
        status="claimed",
        claimed_by=str(context["reviewer_id"]),
        claimed_at=base,
        created_at=base + timedelta(seconds=2),
    )
    opened = _insert_review_item(context, priority=2, created_at=base + timedelta(seconds=3))
    _insert_review_item(context, priority=0, status="decided", created_at=base + timedelta(seconds=4))
    reviewer = _authenticated_client(client, "reviewer1@example.com")

    response = reviewer.get("/v1/review/queue")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"queue"}
    assert [item["review_item_id"] for item in body["queue"]] == [
        claimed["item_id"],
        opened["item_id"],
        mine["item_id"],
    ]
    expected = [
        (claimed, "claimed", False, 1),
        (opened, "open", False, 2),
        (mine, "claimed", True, 3),
    ]
    for item, (fixture, status, claimed_by_me, priority) in zip(body["queue"], expected, strict=True):
        assert set(item) == QUEUE_ITEM_KEYS
        assert item == {
            "review_item_id": fixture["item_id"],
            "submission_id": fixture["submission_id"],
            "kind": "bug_report",
            "title": fixture["title"],
            "file_path": "db.js",
            "line_range": [10, 12],
            "category": "logic",
            "received_at": fixture["received_at"],
            "priority": priority,
            "status": status,
            "claimed_by_me": claimed_by_me,
        }
        assert "payload" not in item
        assert "flag_code" not in item
        assert "has_flag" not in item
        assert "team_id" not in item


def test_claim_persists_ownership_and_blocks_another_active_reviewer(client):
    context = _review_context()
    fixture = _insert_review_item(context)
    reviewer_one = _authenticated_client(client, "reviewer1@example.com")
    reviewer_two = _authenticated_client(client, "reviewer2@example.com")

    claimed = reviewer_one.post(f"/v1/review/items/{fixture['item_id']}/claim")
    assert claimed.status_code == 200
    assert claimed.json() == {"ok": True}
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT ri.status, ri.claimed_by, ri.claimed_at, s.status AS submission_status "
                    "FROM app.review_items ri JOIN app.submissions s ON s.id = ri.submission_id "
                    "WHERE ri.id = CAST(:item AS uuid)"
                ),
                {"item": fixture["item_id"]},
            )
            .mappings()
            .one()
        )
    assert row["status"] == "claimed"
    assert str(row["claimed_by"]) == str(context["reviewer_id"])
    assert row["claimed_at"] is not None
    assert row["submission_status"] == "in_review"

    replay = reviewer_one.post(f"/v1/review/items/{fixture['item_id']}/claim")
    assert replay.status_code == 200
    assert replay.json() == {"ok": True}
    blocked = reviewer_two.post(f"/v1/review/items/{fixture['item_id']}/claim")
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "VALIDATION_ERROR"
    assert blocked.json()["error"]["details"] == {"claim": "Claimed by another reviewer."}
    with app_session() as s:
        persisted = (
            s.execute(
                text(
                    "SELECT ri.status, ri.claimed_by, s.status AS submission_status "
                    "FROM app.review_items ri JOIN app.submissions s ON s.id = ri.submission_id "
                    "WHERE ri.id = CAST(:item AS uuid)"
                ),
                {"item": fixture["item_id"]},
            )
            .mappings()
            .one()
        )
    assert persisted["status"] == "claimed"
    assert str(persisted["claimed_by"]) == str(context["reviewer_id"])
    assert persisted["submission_status"] == "in_review"


def test_expired_claim_can_be_taken_over_without_sleeps(client):
    context = _review_context()
    with app_session() as s:
        reviewer_two = s.execute(text("SELECT id FROM app.users WHERE email = 'reviewer2@example.com'")).scalar_one()
    fixture = _insert_review_item(
        context,
        status="claimed",
        claimed_by=str(context["reviewer_id"]),
        claimed_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    reviewer_two_client = _authenticated_client(client, "reviewer2@example.com")

    response = reviewer_two_client.post(f"/v1/review/items/{fixture['item_id']}/claim")
    assert response.status_code == 200
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT ri.status, ri.claimed_by, s.status AS submission_status "
                    "FROM app.review_items ri JOIN app.submissions s ON s.id = ri.submission_id "
                    "WHERE ri.id = CAST(:item AS uuid)"
                ),
                {"item": fixture["item_id"]},
            )
            .mappings()
            .one()
        )
    assert row["status"] == "claimed"
    assert str(row["claimed_by"]) == str(reviewer_two)
    assert row["submission_status"] == "in_review"


def test_claim_rejects_an_already_decided_item(client):
    context = _review_context()
    fixture = _insert_review_item(context, status="decided")
    reviewer = _authenticated_client(client, "reviewer1@example.com")

    response = reviewer.post(f"/v1/review/items/{fixture['item_id']}/claim")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"] == {"claim": "Item already decided."}


def test_review_detail_returns_plain_payload_file_context_and_team_history(client):
    context = _review_context()
    fixture = _insert_review_item(context, status="claimed", claimed_by=str(context["reviewer_id"]))
    _insert_review_item(context, kind="ctf_flag", flag_code="FLAG{staff-only-review-fixture}")
    reviewer = _authenticated_client(client, "reviewer1@example.com")
    with app_session() as s:
        stored_file = (
            s.execute(
                text(
                    "SELECT content, lang, line_count FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:challenge AS uuid) AND path = 'db.js'"
                ),
                {"challenge": str(context["challenge_id"])},
            )
            .mappings()
            .one()
        )

    response = reviewer.get(f"/v1/review/items/{fixture['item_id']}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"review_item_id", "status", "submission", "file", "team_total_reports"}
    assert body == {
        "review_item_id": fixture["item_id"],
        "status": "claimed",
        "submission": {
            "id": fixture["submission_id"],
            "kind": "bug_report",
            "title": fixture["title"],
            "payload": fixture["payload"],
            "file_path": "db.js",
            "line_start": 10,
            "line_end": 12,
            "category": "logic",
            "received_at": fixture["received_at"],
            "receipt_code": fixture["receipt_code"],
            "flag_code": None,
            "status": "in_review",
        },
        "file": {
            "content": stored_file["content"],
            "lang": stored_file["lang"],
            "line_count": stored_file["line_count"],
        },
        "team_total_reports": 1,
    }
    assert body["submission"]["payload"]["description"] == fixture["payload"]["description"]


def test_open_item_cannot_be_decided_before_it_is_claimed(client):
    context = _review_context()
    fixture = _insert_review_item(context)
    reviewer = _authenticated_client(client, "reviewer1@example.com")

    response = reviewer.post(
        f"/v1/review/items/{fixture['item_id']}/decision",
        json={
            "decision": "accept_full",
            "rubric": {
                "functionality": 1.0,
                "root_cause": 1.0,
                "code_quality": 1.0,
                "testing": 1.0,
                "evidence": 1.0,
            },
            "notes": "Decision without a claim must be rejected.",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT status FROM app.review_items WHERE id = CAST(:id AS uuid)"), {"id": fixture["item_id"]}
            ).scalar_one()
            == "open"
        )
        assert session.execute(text("SELECT count(*) FROM app.reviews")).scalar_one() == 0
        assert (
            session.execute(text("SELECT count(*) FROM app.jobs WHERE kind = 'apply_review_outcome'")).scalar_one() == 0
        )


@pytest.mark.parametrize(("decision", "submission_status", "quality"), DECISION_CASES)
def test_claimed_decision_persists_mapping_review_job_and_audit(
    client,
    decision,
    submission_status,
    quality,
):
    context = _review_context()
    fixture = _insert_review_item(context)
    reviewer = _authenticated_client(client, "reviewer1@example.com")
    claim = reviewer.post(f"/v1/review/items/{fixture['item_id']}/claim")
    assert claim.status_code == 200
    rubric = {
        "functionality": 0.9,
        "root_cause": 0.8,
        "code_quality": 0.7,
        "testing": 0.6,
        "evidence": 0.5,
    }
    notes = f"Decision fixture for {decision}"

    request_id = f"decision-{decision}-{uuid.uuid4().hex[:8]}"
    response = reviewer.post(
        f"/v1/review/items/{fixture['item_id']}/decision",
        json={"decision": decision, "rubric": rubric, "notes": notes},
        headers={"X-Request-Id": request_id},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "decision": decision}
    with app_session() as s:
        review = (
            s.execute(
                text(
                    "SELECT id, submission_id, reviewer_id, decision, rubric, quality, notes "
                    "FROM app.reviews WHERE submission_id = CAST(:submission AS uuid)"
                ),
                {"submission": fixture["submission_id"]},
            )
            .mappings()
            .one()
        )
        item = s.execute(
            text("SELECT status FROM app.review_items WHERE id = CAST(:item AS uuid)"),
            {"item": fixture["item_id"]},
        ).scalar_one()
        submission = s.execute(
            text("SELECT status FROM app.submissions WHERE id = CAST(:submission AS uuid)"),
            {"submission": fixture["submission_id"]},
        ).scalar_one()
        jobs = (
            s.execute(
                text(
                    "SELECT kind, payload, status FROM app.jobs "
                    "WHERE kind = 'apply_review_outcome' AND payload ->> 'submission_id' = :submission"
                ),
                {"submission": fixture["submission_id"]},
            )
            .mappings()
            .all()
        )
        audit = (
            s.execute(
                text(
                    "SELECT actor_id, actor_role, action, entity_type, entity_id, request_id, details, event_scope "
                    "FROM audit.entries WHERE request_id = :request_id AND action = 'review.decided'"
                ),
                {"request_id": request_id},
            )
            .mappings()
            .one()
        )
        ledger_count = s.execute(
            text("SELECT count(*) FROM app.score_ledger_entries WHERE submission_id = CAST(:submission AS uuid)"),
            {"submission": fixture["submission_id"]},
        ).scalar_one()
    assert str(review["submission_id"]) == fixture["submission_id"]
    assert str(review["reviewer_id"]) == str(context["reviewer_id"])
    assert review["decision"] == decision
    assert review["rubric"] == rubric
    assert float(review["quality"]) == quality
    assert review["notes"] == notes
    assert item == "decided"
    assert submission == submission_status
    assert len(jobs) == 1
    assert jobs[0]["status"] == "queued"
    assert jobs[0]["payload"] == {
        "submission_id": fixture["submission_id"],
        "review_id": str(review["id"]),
        "decision": decision,
    }
    assert str(uuid.UUID(jobs[0]["payload"]["review_id"])) == str(review["id"])
    assert str(audit["actor_id"]) == str(context["reviewer_id"])
    assert audit["actor_role"] == "reviewer"
    assert audit["action"] == "review.decided"
    assert audit["entity_type"] == "submission"
    assert audit["entity_id"] == fixture["submission_id"]
    assert audit["request_id"] == request_id
    assert audit["details"] == {"decision": decision}
    assert audit["event_scope"] == "review"
    assert ledger_count == 0


def test_claimed_item_cannot_be_decided_by_another_reviewer(client):
    context = _review_context()
    fixture = _insert_review_item(context, status="claimed", claimed_by=str(context["reviewer_id"]))
    reviewer_two = _authenticated_client(client, "reviewer2@example.com")
    body = {
        "decision": "accept_full",
        "rubric": {
            "functionality": 1.0,
            "root_cause": 1.0,
            "code_quality": 1.0,
            "testing": 1.0,
            "evidence": 1.0,
        },
    }

    response = reviewer_two.post(
        f"/v1/review/items/{fixture['item_id']}/decision",
        json=body,
        headers={"X-Request-Id": "foreign-review-decision"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
    with app_session() as s:
        assert (
            s.execute(
                text("SELECT count(*) FROM app.reviews WHERE submission_id = CAST(:submission AS uuid)"),
                {"submission": fixture["submission_id"]},
            ).scalar_one()
            == 0
        )
        assert (
            s.execute(
                text(
                    "SELECT count(*) FROM app.jobs WHERE kind = 'apply_review_outcome' "
                    "AND payload ->> 'submission_id' = :submission"
                ),
                {"submission": fixture["submission_id"]},
            ).scalar_one()
            == 0
        )
        assert (
            s.execute(
                text("SELECT count(*) FROM audit.entries WHERE request_id = 'foreign-review-decision'")
            ).scalar_one()
            == 0
        )


def test_decided_item_rejects_a_second_decision_without_duplicate_effects(client):
    context = _review_context()
    fixture = _insert_review_item(context, status="decided")
    reviewer = _authenticated_client(client, "reviewer1@example.com")
    body = {"decision": "accept_full", "rubric": {}}

    response = reviewer.post(
        f"/v1/review/items/{fixture['item_id']}/decision",
        json=body,
        headers={"X-Request-Id": "repeat-review-decision"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"] == {"decision": "Already decided."}
    with app_session() as s:
        assert (
            s.execute(
                text("SELECT count(*) FROM app.reviews WHERE submission_id = CAST(:submission AS uuid)"),
                {"submission": fixture["submission_id"]},
            ).scalar_one()
            == 0
        )
        assert (
            s.execute(
                text("SELECT count(*) FROM audit.entries WHERE request_id = 'repeat-review-decision'")
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize(
    "body",
    [
        {"decision": "not-a-decision", "rubric": {}},
        {"decision": "accept_full", "rubric": {"functionality": 1.1}},
    ],
)
def test_claimed_decision_validates_enum_and_rubric_before_persisting(client, body):
    context = _review_context()
    fixture = _insert_review_item(context, status="claimed", claimed_by=str(context["reviewer_id"]))
    reviewer = _authenticated_client(client, "reviewer1@example.com")

    response = reviewer.post(f"/v1/review/items/{fixture['item_id']}/decision", json=body)
    assert response.status_code == 422
    with app_session() as s:
        assert (
            s.execute(
                text("SELECT count(*) FROM app.reviews WHERE submission_id = CAST(:submission AS uuid)"),
                {"submission": fixture["submission_id"]},
            ).scalar_one()
            == 0
        )
        assert (
            s.execute(
                text("SELECT status FROM app.review_items WHERE id = CAST(:item AS uuid)"), {"item": fixture["item_id"]}
            ).scalar_one()
            == "claimed"
        )


def test_participant_cannot_access_review_routes(client):
    context = _review_context()
    fixture = _insert_review_item(context)
    participant = _authenticated_client(client, "p1.team1@example.com")
    requests = [
        ("GET", "/v1/review/queue", None),
        ("GET", f"/v1/review/items/{fixture['item_id']}", None),
        ("POST", f"/v1/review/items/{fixture['item_id']}/claim", None),
        ("POST", f"/v1/review/items/{fixture['item_id']}/decision", {"decision": "accept_full", "rubric": {}}),
    ]
    for method, path, body in requests:
        response = participant.request(method, path, json=body)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_announcements_require_authentication(client):
    response = client.get("/v1/announcements")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_TOKEN_EXPIRED"


def test_announcements_are_newest_first_with_default_explicit_and_capped_limits(client):
    participant = _authenticated_client(client, "p1.team1@example.com")
    base = datetime(2026, 1, 1, tzinfo=UTC)
    with app_session() as s:
        organizer_id = s.execute(text("SELECT id FROM app.users WHERE email = 'organizer@example.com'")).scalar_one()
        event_id = s.execute(text("SELECT id FROM app.events ORDER BY created_at DESC LIMIT 1")).scalar_one()
        s.execute(text("DELETE FROM app.announcements"))
        for index in range(105):
            s.execute(
                text(
                    "INSERT INTO app.announcements "
                    "(id, event_id, severity, audience, body, created_by, created_at) VALUES "
                    "(CAST(:id AS uuid), CAST(:event AS uuid), :severity, :audience, :body, CAST(:author AS uuid), :created)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "event": str(event_id),
                    "severity": "warning" if index % 2 else "info",
                    "audience": "staff" if index % 3 == 0 else "all",
                    "body": f"Announcement fixture {index}",
                    "author": str(organizer_id),
                    "created": base + timedelta(minutes=index),
                },
            )

    for query, expected_count in (
        (None, 50),
        ("?limit=2", 2),
        ("?limit=100", 100),
        ("?limit=500", 100),
        ("?limit=0", 0),
    ):
        response = participant.get(f"/v1/announcements{query or ''}")
        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) == {"announcements"}
        assert len(body["announcements"]) == expected_count
        expected_indices = list(range(104, 104 - expected_count, -1))
        assert [item["body"] for item in body["announcements"]] == [
            f"Announcement fixture {index}" for index in expected_indices
        ]
        for item, index in zip(body["announcements"], expected_indices, strict=True):
            assert set(item) == {"id", "severity", "audience", "body", "author", "created_at"}
            assert item["severity"] == ("warning" if index % 2 else "info")
            assert item["audience"] == ("staff" if index % 3 == 0 else "all")
            assert item["author"] == "Kalpesh Parashar"
            assert item["created_at"] == (base + timedelta(minutes=index)).isoformat()
            assert str(uuid.UUID(item["id"])) == item["id"]
