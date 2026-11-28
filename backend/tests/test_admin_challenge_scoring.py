"""Admin challenge authoring, ground-truth input, and test-result coverage."""

from __future__ import annotations

import hashlib
import uuid

import pytest
from conftest import STAFF_PW, login, participant_client, worker_drain
from fastapi.testclient import TestClient
from sqlalchemy import text


def _staff(client: TestClient, email: str = "organizer@example.com", *, step_up: bool = False) -> TestClient:
    token = login(client, email)["access_token"]
    staff = TestClient(client.app)
    staff.headers.update({"Authorization": f"Bearer {token}"})
    if step_up:
        response = staff.post("/v1/auth/step-up", json={"password": STAFF_PW})
        assert response.status_code == 200, response.text
    return staff


def _create_event(organizer: TestClient) -> str:
    response = organizer.post(
        "/v1/admin/events",
        json={
            "name": "Challenge Coverage Event",
            "slug": f"challenge-coverage-{uuid.uuid4().hex[:12]}",
            "duration_minutes": 60,
            "max_teams": 3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["event_id"]


def _create_stage(organizer: TestClient, event_id: str) -> str:
    response = organizer.post(
        f"/v1/admin/events/{event_id}/stages", json={"name": "Challenge Coverage Stage", "kind": "main"}
    )
    assert response.status_code == 201, response.text
    return response.json()["stage_id"]


def _create_challenge(organizer: TestClient, event_id: str, slug: str = "coverage-challenge") -> str:
    response = organizer.post(
        f"/v1/admin/events/{event_id}/challenges",
        json={
            "slug": slug,
            "title": "Coverage Challenge",
            "instructions_markdown": "<script>alert('inert instructions')</script>",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["challenge_id"]


def _start_stage(organizer: TestClient, stage_id: str) -> None:
    for action in ("seal", "arm", "start"):
        response = organizer.post(
            f"/v1/admin/stages/{stage_id}/control", json={"action": action, "reason": "ADM-COVERAGE"}
        )
        assert response.status_code == 200, response.text


def _upload(organizer: TestClient, challenge_id: str, filename: str, content: bytes):
    return organizer.post(f"/v1/admin/challenges/{challenge_id}/files", files={"file": (filename, content)})


def test_challenge_create_upload_freeze_publish_persists_content_and_assignment(client):
    organizer = _staff(client, step_up=True)
    event_id = _create_event(organizer)
    stage_id = _create_stage(organizer, event_id)
    challenge_id = _create_challenge(organizer, event_id)
    uuid.UUID(challenge_id)

    from app.db import app_session

    with app_session() as session:
        created = (
            session.execute(
                text(
                    "SELECT event_id, slug, title, version, status, instructions_md FROM app.challenge_versions "
                    "WHERE id = CAST(:challenge AS uuid)"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, actor_role, event_scope, details FROM audit.entries "
                    "WHERE action = 'challenge.created' AND entity_id = :challenge"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
    assert str(created["event_id"]) == event_id
    assert created["slug"] == "coverage-challenge" and created["title"] == "Coverage Challenge"
    assert created["version"] == 1 and created["status"] == "draft"
    assert created["instructions_md"] == "<script>alert('inert instructions')</script>"
    assert audit["actor_role"] == "organizer"
    assert audit["event_scope"] == f"event:{event_id}"
    assert audit["details"] == {}

    content = b"def target():\n    return 'wrong'"
    response = _upload(organizer, challenge_id, "src//logic.py", content)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "path": "src/logic.py", "line_count": 2}
    file_hash = hashlib.sha256(content).hexdigest()
    with app_session() as session:
        stored_file = (
            session.execute(
                text(
                    "SELECT path, lang, content, sha256, size_bytes, line_count FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:challenge AS uuid)"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
        lines = (
            session.execute(
                text(
                    "SELECT line_number, line_text FROM app.challenge_file_lines "
                    "WHERE challenge_version_id = CAST(:challenge AS uuid) ORDER BY line_number"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .all()
        )
    assert stored_file["path"] == "src/logic.py"
    assert stored_file["lang"] == "python"
    assert stored_file["content"] == content.decode()
    assert stored_file["sha256"] == file_hash
    assert stored_file["size_bytes"] == len(content)
    assert stored_file["line_count"] == 2
    assert [(row["line_number"], row["line_text"]) for row in lines] == [
        (1, "def target():"),
        (2, "    return 'wrong'"),
    ]

    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/freeze")
    assert response.status_code == 200, response.text
    expected_hash = "sha256:" + hashlib.sha256(file_hash.encode()).hexdigest()
    assert response.json() == {"ok": True, "content_hash": expected_hash}
    with app_session() as session:
        frozen = (
            session.execute(
                text(
                    "SELECT status, content_hash, frozen_at, published_at FROM app.challenge_versions "
                    "WHERE id = CAST(:challenge AS uuid)"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
    assert frozen["status"] == "sealed"
    assert frozen["content_hash"] == expected_hash
    assert frozen["frozen_at"] is not None and frozen["published_at"] is None

    response = _upload(organizer, challenge_id, "src/late.py", b"late = True\n")
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "GROUND_TRUTH_LOCKED"
    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/freeze")
    assert response.status_code == 409, response.text
    with app_session() as session:
        file_count = int(
            session.execute(
                text("SELECT count(*) FROM app.challenge_files WHERE challenge_version_id = CAST(:challenge AS uuid)"),
                {"challenge": challenge_id},
            ).scalar_one()
        )
        audit_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM audit.entries WHERE action IN ('challenge.file_uploaded', 'challenge.frozen') "
                    "AND entity_id = :challenge"
                ),
                {"challenge": challenge_id},
            ).scalar_one()
        )
    assert file_count == 1
    assert audit_count == 2

    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/publish", json={})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == {"stage_id": "Required."}
    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/publish", json={"stage_id": stage_id})
    assert response.status_code == 200, response.text
    with app_session() as session:
        published = (
            session.execute(
                text("SELECT status, published_at FROM app.challenge_versions WHERE id = CAST(:challenge AS uuid)"),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
        assignments = (
            session.execute(
                text(
                    "SELECT event_id, stage_id, challenge_version_id, team_id FROM app.assignments "
                    "WHERE challenge_version_id = CAST(:challenge AS uuid)"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .all()
        )
        publish_audit = (
            session.execute(
                text(
                    "SELECT details, event_scope FROM audit.entries WHERE action = 'challenge.published' "
                    "AND entity_id = :challenge"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
    assert published["status"] == "published" and published["published_at"] is not None
    assert len(assignments) == 1
    assert str(assignments[0]["event_id"]) == event_id
    assert str(assignments[0]["stage_id"]) == stage_id
    assert str(assignments[0]["challenge_version_id"]) == challenge_id
    assert assignments[0]["team_id"] is None
    assert publish_audit["details"] == {"stage_id": stage_id}
    assert publish_audit["event_scope"] == "challenge"

    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/publish", json={"stage_id": stage_id})
    assert response.status_code == 409, response.text
    with app_session() as session:
        assignment_count = int(
            session.execute(
                text("SELECT count(*) FROM app.assignments WHERE challenge_version_id = CAST(:challenge AS uuid)"),
                {"challenge": challenge_id},
            ).scalar_one()
        )
        audit_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM audit.entries WHERE action = 'challenge.published' AND entity_id = :challenge"
                ),
                {"challenge": challenge_id},
            ).scalar_one()
        )
    assert assignment_count == 1
    assert audit_count == 1


def test_ground_truth_bug_and_flag_paths_persist_relations_hashes_and_audit(client):
    organizer = _staff(client, step_up=True)
    event_id = _create_event(organizer)
    challenge_id = _create_challenge(organizer, event_id)
    response = _upload(organizer, challenge_id, "src/logic.py", b"def target():\n    return user_id\n")
    assert response.status_code == 200, response.text

    from app.db import app_session, gt_session

    bug_body = {
        "code": "ADMIN-BUG",
        "title": "Wrong target identifier",
        "severity": "high",
        "category": "data_handling",
        "points": 80,
        "root_cause_group": "wrong-target",
        "explanation": "The handler passes the user identifier where the note identifier is required.",
        "fix_guidance": "Pass the requested note identifier to the delete operation.",
        "locations": [{"file_path": "src/logic.py", "line_start": 2, "line_end": 2, "is_primary": True}],
        "aliases": [{"keyword": "wrong target", "weight": 1.0}, {"keyword": "identifier mismatch", "weight": 0.6}],
    }
    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/ground-truth/bugs", json=bug_body)
    assert response.status_code == 201, response.text
    bug_id = response.json()["bug_id"]
    uuid.UUID(bug_id)

    flag_body = {"flag_key": "ADMIN-FLAG", "code": "FLAG{admin_coverage_valid}", "points": 25, "max_awards": 2}
    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/ground-truth/flags", json=flag_body)
    assert response.status_code == 201, response.text
    flag_id = response.json()["flag_id"]
    assert response.json()["ok"] is True
    uuid.UUID(flag_id)

    from app.security import flag_code_hash

    with gt_session() as ground_truth:
        bug = (
            ground_truth.execute(
                text(
                    "SELECT challenge_version_id, code, title, severity, category, points, root_cause_group, explanation, "
                    "fix_guidance FROM gt.gt_bugs WHERE id = CAST(:bug AS uuid)"
                ),
                {"bug": bug_id},
            )
            .mappings()
            .one()
        )
        locations = (
            ground_truth.execute(
                text(
                    "SELECT file_path, line_start, line_end, is_primary FROM gt.gt_locations WHERE bug_id = CAST(:bug AS uuid)"
                ),
                {"bug": bug_id},
            )
            .mappings()
            .all()
        )
        aliases = (
            ground_truth.execute(
                text("SELECT keyword, weight FROM gt.gt_aliases WHERE bug_id = CAST(:bug AS uuid) ORDER BY keyword"),
                {"bug": bug_id},
            )
            .mappings()
            .all()
        )
        flag = (
            ground_truth.execute(
                text(
                    "SELECT challenge_version_id, flag_key, code_hash, points, max_awards FROM gt.gt_flags "
                    "WHERE challenge_version_id = CAST(:challenge AS uuid)"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
        audits = (
            ground_truth.execute(
                text(
                    "SELECT action, entity_id, actor_id, actor_role, event_scope, details FROM audit.entries "
                    "WHERE action IN ('gt.bug_added', 'gt.flag_added') AND event_scope = :scope ORDER BY seq"
                ),
                {"scope": f"challenge:{challenge_id}"},
            )
            .mappings()
            .all()
        )
    assert str(bug["challenge_version_id"]) == challenge_id
    assert bug["code"] == bug_body["code"] and bug["title"] == bug_body["title"]
    assert bug["severity"] == "high" and bug["category"] == "data_handling"
    assert float(bug["points"]) == 80
    assert bug["root_cause_group"] == "wrong-target"
    assert bug["explanation"] == bug_body["explanation"]
    assert bug["fix_guidance"] == bug_body["fix_guidance"]
    assert [(row["file_path"], row["line_start"], row["line_end"], row["is_primary"]) for row in locations] == [
        ("src/logic.py", 2, 2, True)
    ]
    assert {row["keyword"]: float(row["weight"]) for row in aliases} == {
        "wrong target": 1.0,
        "identifier mismatch": 0.6,
    }
    assert str(flag["challenge_version_id"]) == challenge_id
    assert flag["flag_key"] == "ADMIN-FLAG"
    assert flag["code_hash"] == flag_code_hash(flag_body["code"])
    assert flag["code_hash"] != flag_body["code"]
    assert float(flag["points"]) == 25 and flag["max_awards"] == 2
    assert [row["action"] for row in audits] == ["gt.bug_added", "gt.flag_added"]
    assert audits[0]["entity_id"] == bug_id
    assert audits[0]["details"] == {"code": "ADMIN-BUG"}
    assert audits[0]["event_scope"] == f"challenge:{challenge_id}"
    assert audits[1]["entity_id"] == flag_id
    assert audits[1]["event_scope"] == f"challenge:{challenge_id}"
    assert {row["actor_role"] for row in audits} == {"organizer"}

    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/freeze")
    assert response.status_code == 200, response.text
    denied_body = {**bug_body, "code": "ADMIN-BUG-LATE"}
    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/ground-truth/bugs", json=denied_body)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "GROUND_TRUTH_LOCKED"
    with gt_session() as ground_truth:
        bug_count = int(
            ground_truth.execute(
                text("SELECT count(*) FROM gt.gt_bugs WHERE challenge_version_id = CAST(:challenge AS uuid)"),
                {"challenge": challenge_id},
            ).scalar_one()
        )
        audit_count = int(
            ground_truth.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = 'gt.bug_added' AND event_scope = :scope"),
                {"scope": f"challenge:{challenge_id}"},
            ).scalar_one()
        )
    with app_session() as session:
        status = session.execute(
            text("SELECT status FROM app.challenge_versions WHERE id = CAST(:challenge AS uuid)"),
            {"challenge": challenge_id},
        ).scalar_one()
    assert bug_count == 1 and audit_count == 1
    assert status == "sealed"


def test_challenge_authoring_requires_step_up_and_an_organizer_role(client):
    organizer = _staff(client)
    event_id = _create_event(organizer)
    body = {"slug": "denied-challenge", "title": "Denied Challenge"}

    from app.db import app_session

    with app_session() as session:
        audit_before = int(
            session.execute(text("SELECT count(*) FROM audit.entries WHERE action = 'challenge.created'")).scalar_one()
        )
    response = organizer.post(f"/v1/admin/events/{event_id}/challenges", json=body)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "ADMIN_STEP_UP_REQUIRED"
    for email in ("reviewer1@example.com", "p1.team1@example.com"):
        denied = _staff(client, email)
        response = denied.post(f"/v1/admin/events/{event_id}/challenges", json=body)
        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
    with app_session() as session:
        challenge_count = int(
            session.execute(
                text("SELECT count(*) FROM app.challenge_versions WHERE event_id = CAST(:event AS uuid)"),
                {"event": event_id},
            ).scalar_one()
        )
        audit_count = int(
            session.execute(text("SELECT count(*) FROM audit.entries WHERE action = 'challenge.created'")).scalar_one()
        )
    assert challenge_count == 0 and audit_count == audit_before


def test_upload_path_validation_and_freeze_requirements_have_no_side_effects(client):
    organizer = _staff(client, step_up=True)
    event_id = _create_event(organizer)
    challenge_id = _create_challenge(organizer, event_id)

    from app.db import app_session

    response = organizer.post(f"/v1/admin/challenges/{challenge_id}/freeze")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == {"files": "Upload at least one file before freezing."}
    for filename in ("../escape.py", "/etc/passwd"):
        response = _upload(organizer, challenge_id, filename, b"unsafe = True\n")
        assert response.status_code == 400, response.text
        assert response.json()["error"]["code"] == "PATH_INVALID"
    with app_session() as session:
        status = (
            session.execute(
                text("SELECT status, frozen_at FROM app.challenge_versions WHERE id = CAST(:challenge AS uuid)"),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )
        file_count = int(
            session.execute(
                text("SELECT count(*) FROM app.challenge_files WHERE challenge_version_id = CAST(:challenge AS uuid)"),
                {"challenge": challenge_id},
            ).scalar_one()
        )
        line_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM app.challenge_file_lines WHERE challenge_version_id = CAST(:challenge AS uuid)"
                ),
                {"challenge": challenge_id},
            ).scalar_one()
        )
    assert status["status"] == "draft" and status["frozen_at"] is None
    assert file_count == 0 and line_count == 0
    assert _challenge_audit_count("challenge.file_uploaded", challenge_id) == 0
    assert _challenge_audit_count("challenge.frozen", challenge_id) == 0


def _challenge_audit_count(action: str, entity_id: str) -> int:
    from app.db import app_session

    with app_session() as session:
        return int(
            session.execute(
                text("SELECT count(*) FROM audit.entries WHERE action = :action AND entity_id = :entity"),
                {"action": action, "entity": entity_id},
            ).scalar_one()
        )


def test_test_results_enqueue_and_apply_once_for_a_matched_submission(client):
    participant = participant_client(client, "p1.team1@example.com")
    organizer = _staff(client, step_up=True)

    from app.db import app_session, gt_session

    with app_session() as session:
        context = (
            session.execute(
                text(
                    "SELECT tm.team_id, s.id AS stage_id, a.challenge_version_id, "
                    "(SELECT id FROM app.events WHERE id = s.event_id) AS event_id "
                    "FROM app.team_members tm JOIN app.users u ON u.id = tm.user_id "
                    "JOIN app.stages s ON s.event_id = (SELECT t.event_id FROM app.teams t WHERE t.id = tm.team_id) "
                    "AND s.kind = 'main' JOIN app.assignments a ON a.stage_id = s.id "
                    "AND (a.team_id IS NULL OR a.team_id = tm.team_id) "
                    "WHERE lower(u.email) = 'p1.team1@example.com' ORDER BY s.ordinal LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    challenge_id = str(context["challenge_version_id"])
    with gt_session() as ground_truth:
        candidate = (
            ground_truth.execute(
                text(
                    "SELECT b.code, b.points, b.category, loc.file_path, loc.line_start, loc.line_end, alias.keyword "
                    "FROM gt.gt_bugs b JOIN gt.gt_locations loc ON loc.bug_id = b.id "
                    "JOIN gt.gt_aliases alias ON alias.bug_id = b.id "
                    "WHERE b.challenge_version_id = CAST(:challenge AS uuid) "
                    "ORDER BY b.id, loc.line_start, alias.keyword LIMIT 1"
                ),
                {"challenge": challenge_id},
            )
            .mappings()
            .one()
        )

    response = participant.post(
        "/v1/submissions",
        json={
            "kind": "bug_report",
            "challenge_id": challenge_id,
            "file_path": candidate["file_path"],
            "line_start": candidate["line_start"],
            "line_end": candidate["line_end"],
            "category": candidate["category"],
            "title": "Coverage test result report",
            "description": (
                f"The implementation has a {candidate['keyword']} defect and uses the wrong identifier, "
                "which causes an observable failure."
            ),
            "evidence": f"Reproduced the {candidate['keyword']} behavior against the assigned challenge.",
        },
        headers={"Idempotency-Key": f"test-result-{uuid.uuid4()}"},
    )
    assert response.status_code == 202, response.text
    submission_id = response.json()["submission_id"]
    worker_drain()
    with app_session() as session:
        evaluated = (
            session.execute(
                text("SELECT status, matched_bug_code FROM app.submissions WHERE id = CAST(:submission AS uuid)"),
                {"submission": submission_id},
            )
            .mappings()
            .one()
        )
        claim = session.execute(
            text("SELECT award_unit_id FROM app.award_claims WHERE submission_id = CAST(:submission AS uuid)"),
            {"submission": submission_id},
        ).scalar_one()
        functional_weight = float(
            session.execute(
                text(
                    "SELECT (config->'scoring'->'weights'->>'functional_test')::numeric FROM app.events "
                    "WHERE id = CAST(:event AS uuid)"
                ),
                {"event": str(context["event_id"])},
            ).scalar_one()
        )
    assert evaluated["status"] == "matched_auto"
    assert evaluated["matched_bug_code"] == candidate["code"]
    assert claim == candidate["code"]

    for invalid in (
        {},
        {"submission_id": submission_id, "tests_passed": 0, "tests_total": 0},
        {"submission_id": submission_id, "tests_passed": 4, "tests_total": 3},
        {"submission_id": submission_id, "tests_passed": -1, "tests_total": 3},
    ):
        response = organizer.post(f"/v1/admin/challenges/{challenge_id}/ground-truth/test-results", json=invalid)
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    with app_session() as session:
        assert (
            int(session.execute(text("SELECT count(*) FROM app.jobs WHERE kind = 'apply_test_results'")).scalar_one())
            == 0
        )
        assert (
            int(
                session.execute(
                    text(
                        "SELECT count(*) FROM audit.entries WHERE action = 'scoring.test_results_recorded' "
                        "AND entity_id = :submission"
                    ),
                    {"submission": submission_id},
                ).scalar_one()
            )
            == 0
        )

    actor_id = organizer.get("/v1/me").json()["id"]
    response = organizer.post(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/test-results",
        json={"submission_id": submission_id, "tests_passed": 3, "tests_total": 4},
    )
    assert response.status_code == 200, response.text
    with app_session() as session:
        job = (
            session.execute(text("SELECT id, kind, payload, status FROM app.jobs WHERE kind = 'apply_test_results'"))
            .mappings()
            .one()
        )
        audit = (
            session.execute(
                text(
                    "SELECT actor_id, entity_id, details, event_scope FROM audit.entries "
                    "WHERE action = 'scoring.test_results_recorded' AND entity_id = :submission"
                ),
                {"submission": submission_id},
            )
            .mappings()
            .one()
        )
    assert job["status"] == "queued"
    assert job["payload"] == {
        "submission_id": submission_id,
        "tests_passed": 3,
        "tests_total": 4,
        "actor_id": actor_id,
    }
    assert str(audit["actor_id"]) == actor_id
    assert audit["entity_id"] == submission_id
    assert audit["details"] == {"passed": 3, "total": 4}
    assert audit["event_scope"] == "scoring"

    worker_drain()
    expected_points = round(float(candidate["points"]) * functional_weight * 0.75, 2)
    with app_session() as session:
        completed = (
            session.execute(
                text("SELECT status, attempts FROM app.jobs WHERE id = CAST(:job AS uuid)"), {"job": str(job["id"])}
            )
            .mappings()
            .one()
        )
        entries = (
            session.execute(
                text(
                    "SELECT component, kind, points, reason_code, note, award_unit_id FROM app.score_ledger_entries "
                    "WHERE submission_id = CAST(:submission AS uuid) AND component = 'functional_test'"
                ),
                {"submission": submission_id},
            )
            .mappings()
            .all()
        )
    assert completed["status"] == "done" and completed["attempts"] == 1
    assert len(entries) == 1
    assert entries[0]["component"] == "functional_test" and entries[0]["kind"] == "award"
    assert float(entries[0]["points"]) == expected_points
    assert entries[0]["reason_code"] == "TEST_RESULTS"
    assert entries[0]["note"] == "passed 3/4"
    assert entries[0]["award_unit_id"] == candidate["code"]

    response = organizer.post(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/test-results",
        json={"submission_id": submission_id, "tests_passed": 3, "tests_total": 4},
    )
    assert response.status_code == 200, response.text
    worker_drain()
    with app_session() as session:
        entry_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM app.score_ledger_entries WHERE submission_id = CAST(:submission AS uuid) "
                    "AND component = 'functional_test'"
                ),
                {"submission": submission_id},
            ).scalar_one()
        )
        audit_count = int(
            session.execute(
                text(
                    "SELECT count(*) FROM audit.entries WHERE action = 'scoring.test_results_recorded' "
                    "AND entity_id = :submission"
                ),
                {"submission": submission_id},
            ).scalar_one()
        )
    assert entry_count == 1
    assert audit_count == 2


@pytest.mark.parametrize("email", ["reviewer1@example.com", "p1.team1@example.com"])
def test_non_organizers_cannot_record_test_results(client, email):
    denied = _staff(client, email)
    challenge_id = str(uuid.uuid4())
    submission_id = str(uuid.uuid4())

    from app.db import app_session

    with app_session() as session:
        jobs_before = int(session.execute(text("SELECT count(*) FROM app.jobs")).scalar_one())
        audit_before = int(session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one())
    response = denied.post(
        f"/v1/admin/challenges/{challenge_id}/ground-truth/test-results",
        json={"submission_id": submission_id, "tests_passed": 1, "tests_total": 1},
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
    with app_session() as session:
        assert int(session.execute(text("SELECT count(*) FROM app.jobs")).scalar_one()) == jobs_before
        assert int(session.execute(text("SELECT count(*) FROM audit.entries")).scalar_one()) == audit_before
