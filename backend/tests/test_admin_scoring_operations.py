"""Admin ledger adjustments, dispute resolution, and CSV export coverage."""

from __future__ import annotations

import csv
import hashlib
import io
import uuid

from conftest import login, participant_client
from fastapi.testclient import TestClient
from sqlalchemy import text


def _staff(client: TestClient, email: str = "organizer@example.com") -> TestClient:
    token = login(client, email)["access_token"]
    staff = TestClient(client.app)
    staff.headers.update({"Authorization": f"Bearer {token}"})
    return staff


def _context() -> dict:
    from app.db import app_session

    with app_session() as session:
        row = (
            session.execute(
                text(
                    "SELECT e.id AS event_id, e.tenant_id, st.id AS stage_id, t.id AS team_id, "
                    "tm.user_id, cv.id AS challenge_id FROM app.events e "
                    "JOIN app.stages st ON st.event_id = e.id AND st.kind = 'main' "
                    "JOIN app.teams t ON t.event_id = e.id "
                    "JOIN app.team_members tm ON tm.team_id = t.id "
                    "JOIN app.assignments a ON a.stage_id = st.id "
                    "JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                    "ORDER BY e.created_at, t.name, tm.joined_at, tm.user_id LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def _insert_submission(session, context: dict, title: str) -> str:
    from app.db import uuid7

    submission_id = str(uuid7())
    session.execute(
        text(
            "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, author_id, "
            "kind, idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, line_start, line_end, "
            "feedback_released, received_at) VALUES (CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), "
            "CAST(:stage AS uuid), CAST(:challenge AS uuid), CAST(:team AS uuid), CAST(:user AS uuid), 'bug_report', "
            ":key, '{}', :hash, 'decided', :receipt, :title, 'db.js', 1, 2, true, clock_timestamp())"
        ),
        {
            "id": submission_id,
            "tenant": str(context["tenant_id"]),
            "event": str(context["event_id"]),
            "stage": str(context["stage_id"]),
            "challenge": str(context["challenge_id"]),
            "team": str(context["team_id"]),
            "user": str(context["user_id"]),
            "key": f"admin-dispute-{submission_id}",
            "hash": hashlib.sha256(b"{}").hexdigest(),
            "receipt": f"ADM-{submission_id[:8]}",
            "title": title,
        },
    )
    return submission_id


def _insert_dispute(session, context: dict, submission_id: str, statement: str) -> str:
    dispute_id = str(uuid.uuid4())
    session.execute(
        text(
            "INSERT INTO app.disputes (id, submission_id, team_id, statement) "
            "VALUES (CAST(:id AS uuid), CAST(:submission AS uuid), CAST(:team AS uuid), :statement)"
        ),
        {"id": dispute_id, "submission": submission_id, "team": str(context["team_id"]), "statement": statement},
    )
    return dispute_id


def test_manual_adjustments_are_admin_only_audited_and_append_only(client):
    organizer = _staff(client)
    admin = _staff(client, "admin@example.com")
    context = _context()
    body = {
        "stage_id": str(context["stage_id"]),
        "team_id": str(context["team_id"]),
        "points": 12.5,
        "reason": "Approved organizer correction",
    }

    from app.db import app_session

    with app_session() as session:
        ledger_before = int(session.execute(text("SELECT count(*) FROM app.score_ledger_entries")).scalar_one())
        audit_before = int(
            session.execute(
                text(
                    "SELECT count(*) FROM audit.entries WHERE action = 'scoring.manual_adjustment' "
                    "AND entity_id = :team"
                ),
                {"team": str(context["team_id"])},
            ).scalar_one()
        )
    response = organizer.post("/v1/admin/adjustments", json=body)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
    for invalid in (
        {**body, "points": 0},
        {**body, "reason": ""},
        {key: value for key, value in body.items() if key != "stage_id"},
    ):
        response = admin.post("/v1/admin/adjustments", json=invalid)
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    with app_session() as session:
        assert int(session.execute(text("SELECT count(*) FROM app.score_ledger_entries")).scalar_one()) == ledger_before
        assert (
            int(
                session.execute(
                    text(
                        "SELECT count(*) FROM audit.entries WHERE action = 'scoring.manual_adjustment' "
                        "AND entity_id = :team"
                    ),
                    {"team": str(context["team_id"])},
                ).scalar_one()
            )
            == audit_before
        )

    response = admin.post("/v1/admin/adjustments", json=body)
    assert response.status_code == 200, response.text
    with app_session() as session:
        first = (
            session.execute(
                text(
                    "SELECT id, component, kind, points, reason_code, actor_id, note FROM app.score_ledger_entries "
                    "WHERE reason_code = 'MANUAL'"
                )
            )
            .mappings()
            .one()
        )
    first_id = str(first["id"])
    assert first["component"] == "adjustment" and first["kind"] == "adjustment"
    assert float(first["points"]) == 12.5 and first["reason_code"] == "MANUAL"
    assert str(first["actor_id"]) == admin.get("/v1/me").json()["id"]
    assert first["note"] == "Approved organizer correction"

    response = admin.post(
        "/v1/admin/adjustments",
        json={**body, "points": -2.25, "reason": "Approved downward correction"},
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        entries = (
            session.execute(
                text(
                    "SELECT id, points, note FROM app.score_ledger_entries WHERE reason_code = 'MANUAL' ORDER BY created_at, id"
                )
            )
            .mappings()
            .all()
        )
        audits = (
            session.execute(
                text(
                    "SELECT actor_id, entity_id, details FROM audit.entries WHERE action = 'scoring.manual_adjustment' "
                    "AND entity_id = :team ORDER BY seq"
                ),
                {"team": str(context["team_id"])},
            )
            .mappings()
            .all()
        )
    assert len(entries) == 2
    stored_first = next(row for row in entries if str(row["id"]) == first_id)
    assert float(stored_first["points"]) == 12.5
    assert stored_first["note"] == "Approved organizer correction"
    assert sorted(float(row["points"]) for row in entries) == [-2.25, 12.5]
    assert sum(float(row["points"]) for row in entries) == 10.25
    assert len(audits) == 2
    assert {row["entity_id"] for row in audits} == {str(context["team_id"])}
    assert {row["details"]["reason"] for row in audits} == {
        "Approved organizer correction",
        "Approved downward correction",
    }


def test_disputes_list_and_upheld_resolution_append_one_linked_adjustment(client):
    organizer = _staff(client)
    context = _context()

    from app.db import app_session

    with app_session() as session:
        submission_id = _insert_submission(session, context, "Disputed coverage report")
        dispute_id = _insert_dispute(
            session,
            context,
            submission_id,
            "The accepted report was scored against the wrong functional test result.",
        )
    listed = organizer.get("/v1/admin/disputes")
    assert listed.status_code == 200, listed.text
    dispute = next(row for row in listed.json()["disputes"] if row["id"] == dispute_id)
    assert dispute["submission_id"] == submission_id
    assert dispute["status"] == "open"
    assert dispute["title"] == "Disputed coverage report"
    assert dispute["statement"].startswith("The accepted report")
    assert dispute["receipt_code"]

    response = organizer.post(f"/v1/admin/disputes/{dispute_id}/resolve", json={"outcome": "maybe"})
    assert response.status_code == 422, response.text
    with app_session() as session:
        assert (
            session.execute(
                text("SELECT status FROM app.disputes WHERE id = CAST(:dispute AS uuid)"), {"dispute": dispute_id}
            ).scalar_one()
            == "open"
        )
        assert (
            int(
                session.execute(
                    text("SELECT count(*) FROM app.score_ledger_entries WHERE reason_code = 'DISPUTE_UPHELD'")
                ).scalar_one()
            )
            == 0
        )

    response = organizer.post(
        f"/v1/admin/disputes/{dispute_id}/resolve",
        json={
            "outcome": "upheld",
            "resolution": "Functional test evidence supports an additional award.",
            "adjust_points": 7.5,
        },
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        resolved = (
            session.execute(
                text(
                    "SELECT status, resolution, resolved_by, resolved_at FROM app.disputes WHERE id = CAST(:dispute AS uuid)"
                ),
                {"dispute": dispute_id},
            )
            .mappings()
            .one()
        )
        entries = (
            session.execute(
                text(
                    "SELECT event_id, stage_id, team_id, submission_id, component, kind, points, reason_code, actor_id, note "
                    "FROM app.score_ledger_entries WHERE reason_code = 'DISPUTE_UPHELD'"
                ),
            )
            .mappings()
            .all()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, entity_id, details FROM audit.entries WHERE action = 'dispute.resolved' "
                    "AND entity_id = :dispute"
                ),
                {"dispute": dispute_id},
            )
            .mappings()
            .one()
        )
    assert resolved["status"] == "upheld"
    assert resolved["resolution"] == "Functional test evidence supports an additional award."
    assert str(resolved["resolved_by"]) == organizer.get("/v1/me").json()["id"]
    assert resolved["resolved_at"] is not None
    assert len(entries) == 1
    entry = entries[0]
    assert str(entry["event_id"]) == str(context["event_id"])
    assert str(entry["stage_id"]) == str(context["stage_id"])
    assert str(entry["team_id"]) == str(context["team_id"])
    assert str(entry["submission_id"]) == submission_id
    assert entry["component"] == "adjustment" and entry["kind"] == "adjustment"
    assert float(entry["points"]) == 7.5 and entry["reason_code"] == "DISPUTE_UPHELD"
    assert str(entry["actor_id"]) == str(resolved["resolved_by"])
    assert entry["note"].startswith(f"Dispute {dispute_id[:8]} upheld:")
    assert str(audit["actor_id"]) == str(resolved["resolved_by"])
    assert audit["entity_id"] == dispute_id
    assert audit["details"] == {"outcome": "upheld"}

    response = organizer.post(
        f"/v1/admin/disputes/{dispute_id}/resolve",
        json={"outcome": "rejected", "resolution": "Replayed resolution", "adjust_points": 99},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == {"dispute": "Already resolved."}
    with app_session() as session:
        unchanged = (
            session.execute(
                text("SELECT status, resolved_at FROM app.disputes WHERE id = CAST(:dispute AS uuid)"),
                {"dispute": dispute_id},
            )
            .mappings()
            .one()
        )
        entry_count = int(
            session.execute(
                text("SELECT count(*) FROM app.score_ledger_entries WHERE reason_code = 'DISPUTE_UPHELD'")
            ).scalar_one()
        )
        audit_count = int(
            session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = 'dispute.resolved' AND entity_id = :dispute"),
                {"dispute": dispute_id},
            ).scalar_one()
        )
    assert unchanged["status"] == "upheld" and unchanged["resolved_at"] == resolved["resolved_at"]
    assert entry_count == 1 and audit_count == 1


def test_rejected_dispute_records_resolution_without_a_score_adjustment(client):
    organizer = _staff(client)
    context = _context()

    from app.db import app_session

    with app_session() as session:
        submission_id = _insert_submission(session, context, "Rejected dispute report")
        dispute_id = _insert_dispute(session, context, submission_id, "Please review the reported line range.")
        ledger_before = int(session.execute(text("SELECT count(*) FROM app.score_ledger_entries")).scalar_one())
    response = organizer.post(
        f"/v1/admin/disputes/{dispute_id}/resolve",
        json={"outcome": "rejected", "resolution": "Original result confirmed.", "adjust_points": 50},
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        dispute = (
            session.execute(
                text(
                    "SELECT status, resolution, resolved_by, resolved_at FROM app.disputes WHERE id = CAST(:dispute AS uuid)"
                ),
                {"dispute": dispute_id},
            )
            .mappings()
            .one()
        )
        ledger_after = int(session.execute(text("SELECT count(*) FROM app.score_ledger_entries")).scalar_one())
        audit_count = int(
            session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = 'dispute.resolved' AND entity_id = :dispute"),
                {"dispute": dispute_id},
            ).scalar_one()
        )
    assert dispute["status"] == "rejected"
    assert dispute["resolution"] == "Original result confirmed."
    assert str(dispute["resolved_by"]) == organizer.get("/v1/me").json()["id"]
    assert dispute["resolved_at"] is not None
    assert ledger_after == ledger_before
    assert audit_count == 1


def test_csv_exports_return_and_persist_exact_event_scoped_content(client):
    participant = participant_client(client, "p1.team1@example.com")
    admin = _staff(client, "admin@example.com")
    assignments = participant.get("/v1/assignments")
    assert assignments.status_code == 200, assignments.text
    assignment = assignments.json()["assignments"][0]
    target_file = assignment["files"][0]["path"]
    response = participant.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": assignment["challenge_id"],
            "file_path": target_file,
            "line_start": 1,
            "line_end": 2,
            "category": "logic",
            "title": "CSV export coverage report",
            "description": "This report verifies that administrator CSV exports contain the persisted submission fields.",
        },
        headers={"Idempotency-Key": f"csv-export-{uuid.uuid4()}"},
    )
    assert response.status_code == 202, response.text
    submission_id = response.json()["submission_id"]

    from app.db import app_session

    with app_session() as session:
        submission = (
            session.execute(
                text(
                    "SELECT event_id, stage_id, team_id, receipt_code, status, title FROM app.submissions "
                    "WHERE id = CAST(:submission AS uuid)"
                ),
                {"submission": submission_id},
            )
            .mappings()
            .one()
        )
    response = admin.post(
        "/v1/admin/adjustments",
        json={
            "stage_id": str(submission["stage_id"]),
            "team_id": str(submission["team_id"]),
            "points": 12.5,
            "reason": "CSV export ledger probe",
        },
    )
    assert response.status_code == 200, response.text
    event_id = str(submission["event_id"])
    team_id = str(submission["team_id"])
    with app_session() as session:
        ledger_entry = (
            session.execute(
                text(
                    "SELECT id, component, kind, points, reason_code FROM app.score_ledger_entries "
                    "WHERE reason_code = 'MANUAL'"
                )
            )
            .mappings()
            .one()
        )
        team_name = session.execute(
            text("SELECT name FROM app.teams WHERE id = CAST(:team AS uuid)"), {"team": team_id}
        ).scalar_one()

    exported = {}
    for kind in ("results", "submissions", "ledger"):
        response = admin.get(f"/v1/admin/events/{event_id}/export/{kind}")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["filename"] == f"{kind}_{event_id[:8]}.csv"
        exported[kind] = body["content"]
        rows = list(csv.DictReader(io.StringIO(body["content"])))
        assert rows

        with app_session() as session:
            stored = (
                session.execute(
                    text(
                        "SELECT kind, content, content_hash, created_by FROM app.exports "
                        "WHERE event_id = CAST(:event AS uuid) AND kind = :kind"
                    ),
                    {"event": event_id, "kind": f"{kind}_csv"},
                )
                .mappings()
                .one()
            )
        assert stored["content"] == body["content"]
        assert stored["content_hash"] == hashlib.sha256(body["content"].encode()).hexdigest()
        assert str(stored["created_by"]) == admin.get("/v1/me").json()["id"]

    result_rows = list(csv.DictReader(io.StringIO(exported["results"])))
    assert set(result_rows[0]) == {"team_id", "team_name", "score"}
    team_result = next(row for row in result_rows if row["team_id"] == team_id)
    assert team_result["team_name"] == team_name
    assert float(team_result["score"]) == 12.5
    assert any(float(row["score"]) == 0 for row in result_rows if row["team_id"] != team_id)

    submission_rows = list(csv.DictReader(io.StringIO(exported["submissions"])))
    assert set(submission_rows[0]) == {
        "submission_id",
        "kind",
        "title",
        "status",
        "receipt_code",
        "received_at",
        "file_path",
        "line_start",
        "line_end",
    }
    submission_row = next(row for row in submission_rows if row["submission_id"] == submission_id)
    assert submission_row["kind"] == "bug_report"
    assert submission_row["title"] == "CSV export coverage report"
    assert submission_row["status"] == submission["status"]
    assert submission_row["receipt_code"] == submission["receipt_code"]
    assert submission_row["received_at"]
    assert submission_row["file_path"] == target_file
    assert submission_row["line_start"] == "1" and submission_row["line_end"] == "2"

    ledger_rows = list(csv.DictReader(io.StringIO(exported["ledger"])))
    assert set(ledger_rows[0]) == {
        "entry_id",
        "stage_id",
        "team_id",
        "component",
        "kind",
        "points",
        "reason_code",
        "submission_id",
        "created_at",
    }
    ledger_row = next(row for row in ledger_rows if row["entry_id"] == str(ledger_entry["id"]))
    assert ledger_row["stage_id"] == str(submission["stage_id"])
    assert ledger_row["team_id"] == team_id
    assert ledger_row["component"] == ledger_entry["component"] == "adjustment"
    assert ledger_row["kind"] == ledger_entry["kind"] == "adjustment"
    assert float(ledger_row["points"]) == 12.5
    assert ledger_row["reason_code"] == "MANUAL"
    assert ledger_row["submission_id"] == ""
    assert ledger_row["created_at"]

    with app_session() as session:
        exports_before = int(
            session.execute(
                text("SELECT count(*) FROM app.exports WHERE event_id = CAST(:event AS uuid)"), {"event": event_id}
            ).scalar_one()
        )
    response = admin.get(f"/v1/admin/events/{event_id}/export/participants")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == {"kind": "results|submissions|ledger"}
    participant_denied = _staff(client, "p1.team1@example.com")
    response = participant_denied.get(f"/v1/admin/events/{event_id}/export/results")
    assert response.status_code == 403, response.text
    with app_session() as session:
        exports_after = int(
            session.execute(
                text("SELECT count(*) FROM app.exports WHERE event_id = CAST(:event AS uuid)"), {"event": event_id}
            ).scalar_one()
        )
    assert exports_after == exports_before == 3
