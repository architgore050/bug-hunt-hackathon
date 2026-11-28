"""Participant challenge delivery contracts and assignment boundaries."""

from __future__ import annotations

import hashlib
import uuid

import pytest
from app.db import app_session
from conftest import participant_client
from sqlalchemy import text

RESTRICTED_FILENAME = "ORGANIZER_ANSWER_KEY.md"
ASSIGNMENT_KEYS = {
    "challenge_id",
    "slug",
    "title",
    "version",
    "instructions_markdown",
    "repo_url",
    "codespace_url",
    "stage_id",
    "stage_status",
    "files",
}
FILE_SUMMARY_KEYS = {"path", "lang", "size_bytes", "line_count"}
FILE_CONTENT_KEYS = {"path", "lang", "content", "line_count", "sha256"}


def _main_stage() -> dict:
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT st.id, st.event_id, e.tenant_id FROM app.stages st "
                    "JOIN app.events e ON e.id = st.event_id WHERE st.kind = 'main' LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def _insert_search_file(challenge_id: str, path: str, lines: list[str]) -> None:
    content = "\n".join(lines) + "\n"
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.challenge_files "
                "(id, challenge_version_id, path, lang, content, sha256, size_bytes, line_count) VALUES "
                "(CAST(:id AS uuid), CAST(:challenge AS uuid), :path, :lang, :content, :sha, :size, :line_count)"
            ),
            {
                "id": str(uuid.uuid4()),
                "challenge": challenge_id,
                "path": path,
                "lang": "text",
                "content": content,
                "sha": hashlib.sha256(content.encode()).hexdigest(),
                "size": len(content.encode()),
                "line_count": len(lines),
            },
        )
        for line_number, line_text in enumerate(lines, start=1):
            s.execute(
                text(
                    "INSERT INTO app.challenge_file_lines "
                    "(id, challenge_version_id, path, line_number, line_text) VALUES "
                    "(CAST(:id AS uuid), CAST(:challenge AS uuid), :path, :line_number, :line_text)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "challenge": challenge_id,
                    "path": path,
                    "line_number": line_number,
                    "line_text": line_text,
                },
            )


def test_assignment_and_content_expose_exact_participant_fields(client):
    pc = participant_client(client, "p1.team1@example.com")

    response = pc.get("/v1/assignments")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"assignments"}
    assert len(body["assignments"]) == 1
    assignment = body["assignments"][0]
    assert set(assignment) == ASSIGNMENT_KEYS
    assert assignment["stage_status"] == "active"
    assert assignment["repo_url"] is None
    assert assignment["codespace_url"] is None
    paths = [item["path"] for item in assignment["files"]]
    assert paths == sorted(paths, key=str.casefold)
    assert all(set(item) == FILE_SUMMARY_KEYS for item in assignment["files"])
    assert RESTRICTED_FILENAME not in {item["path"] for item in assignment["files"]}

    with app_session() as s:
        stored = (
            s.execute(
                text(
                    "SELECT path, lang, content, line_count, sha256, size_bytes FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:challenge AS uuid) AND path = 'db.js'"
                ),
                {"challenge": assignment["challenge_id"]},
            )
            .mappings()
            .one()
        )
    summary = next(item for item in assignment["files"] if item["path"] == "config/env.js")
    assert summary == {
        "path": stored["path"],
        "lang": stored["lang"],
        "size_bytes": stored["size_bytes"],
        "line_count": stored["line_count"],
    }
    assert stored["sha256"] == hashlib.sha256(stored["content"].encode()).hexdigest()

    content_response = pc.get(
        f"/v1/challenges/{assignment['challenge_id']}/files/content",
        params={"path": "./routes/../db.js"},
    )
    assert content_response.status_code == 200, content_response.text
    assert content_response.json() == {
        "path": stored["path"],
        "lang": stored["lang"],
        "content": stored["content"],
        "line_count": stored["line_count"],
        "sha256": stored["sha256"],
    }
    assert set(content_response.json()) == FILE_CONTENT_KEYS

    missing = pc.get(
        f"/v1/challenges/{assignment['challenge_id']}/files/content",
        params={"path": "fixtures/not-published.txt"},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "FILE_NOT_FOUND"


def test_search_is_case_insensitive_bounded_and_returns_safe_fields(client):
    pc = participant_client(client, "p1.team1@example.com")
    challenge_id = pc.get("/v1/assignments").json()["assignments"][0]["challenge_id"]
    path = "fixtures/participant-search.txt"
    long_match = "search-token-73 " + "x" * 250
    _insert_search_file(
        challenge_id,
        path,
        ["first SEARCH-TOKEN-73 match", "unrelated line", long_match],
    )

    response = pc.get(f"/v1/challenges/{challenge_id}/search", params={"q": "SeArCh-ToKeN-73"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"results"}
    assert sorted(body["results"], key=lambda item: item["line_number"]) == [
        {"path": path, "line_number": 1, "text": "first SEARCH-TOKEN-73 match"},
        {"path": path, "line_number": 3, "text": long_match[:200]},
    ]
    assert all(set(item) == {"path", "line_number", "text"} for item in body["results"])
    assert all(len(item["text"]) <= 200 for item in body["results"])

    no_match = pc.get(f"/v1/challenges/{challenge_id}/search", params={"q": "absent-token-73"})
    assert no_match.status_code == 200
    assert no_match.json() == {"results": []}

    bounded_path = "fixtures/bounded-search.txt"
    _insert_search_file(challenge_id, bounded_path, [f"bounded-token line {index}" for index in range(55)])
    bounded = pc.get(f"/v1/challenges/{challenge_id}/search", params={"q": "bounded-token"})
    assert bounded.status_code == 200
    assert len(bounded.json()["results"]) == 50
    assert all(item["path"] == bounded_path for item in bounded.json()["results"])
    assert all(set(item) == {"path", "line_number", "text"} for item in bounded.json()["results"])

    too_short = pc.get(f"/v1/challenges/{challenge_id}/search", params={"q": "x"})
    assert too_short.status_code == 422


def test_team_assignments_are_isolated_for_listing_content_and_search(client):
    stage = _main_stage()
    with app_session() as s:
        teams = s.execute(
            text(
                "SELECT t.id, tm.user_id FROM app.teams t JOIN app.team_members tm ON tm.team_id = t.id "
                "WHERE t.event_id = CAST(:event AS uuid) AND tm.is_lead = true ORDER BY t.name"
            ),
            {"event": str(stage["event_id"])},
        ).all()
        challenges = s.execute(
            text(
                "SELECT id, slug FROM app.challenge_versions "
                "WHERE event_id = CAST(:event AS uuid) AND slug IN ('papyrus', 'marina') ORDER BY slug"
            ),
            {"event": str(stage["event_id"])},
        ).all()
        challenge_ids = {row.slug: str(row.id) for row in challenges}
        team_ids = {str(row.user_id): str(row.id) for row in teams}
        s.execute(
            text("DELETE FROM app.assignments WHERE stage_id = CAST(:stage AS uuid)"), {"stage": str(stage["id"])}
        )
        for email, slug in (
            ("p1.team1@example.com", "marina"),
            ("p1.team2@example.com", "papyrus"),
        ):
            user_id = s.execute(
                text("SELECT id FROM app.users WHERE email = :email"),
                {"email": email},
            ).scalar_one()
            s.execute(
                text(
                    "INSERT INTO app.assignments (id, event_id, stage_id, challenge_version_id, team_id) VALUES "
                    "(CAST(:id AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), CAST(:challenge AS uuid), CAST(:team AS uuid))"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "event": str(stage["event_id"]),
                    "stage": str(stage["id"]),
                    "challenge": challenge_ids[slug],
                    "team": team_ids[str(user_id)],
                },
            )

    team_one = participant_client(client, "p1.team1@example.com")
    team_two = participant_client(client, "p1.team2@example.com")
    one_assignment = team_one.get("/v1/assignments").json()["assignments"]
    two_assignment = team_two.get("/v1/assignments").json()["assignments"]
    assert [item["challenge_id"] for item in one_assignment] == [challenge_ids["marina"]]
    assert [item["challenge_id"] for item in two_assignment] == [challenge_ids["papyrus"]]

    probes = []
    for pc, foreign_challenge, foreign_path in (
        (team_one, challenge_ids["papyrus"], "config/env.js"),
        (team_two, challenge_ids["marina"], "main.py"),
    ):
        for suffix, params in (
            ("files/content", {"path": foreign_path}),
            ("search", {"q": "foreign-search-token"}),
        ):
            response = pc.get(
                f"/v1/challenges/{foreign_challenge}/{suffix}",
                params=params,
                headers={"X-Request-Id": "assignment-ownership-probe"},
            )
            assert response.status_code == 404
            probes.append(response.json())
    unknown = team_one.get(
        f"/v1/challenges/{uuid.uuid4()}/files/content",
        params={"path": "main.py"},
        headers={"X-Request-Id": "assignment-ownership-probe"},
    )
    assert unknown.status_code == 404
    probes.append(unknown.json())
    assert all(body == probes[0] for body in probes)
    assert probes[0] == {
        "error": {
            "code": "FILE_NOT_FOUND",
            "message": "File not found.",
            "request_id": "assignment-ownership-probe",
            "details": {},
        }
    }


def test_rules_acceptance_gates_content_and_search_but_not_listing(client):
    pc = participant_client(client, "p1.team1@example.com")
    assignment = pc.get("/v1/assignments").json()["assignments"][0]
    with app_session() as s:
        user_id = s.execute(text("SELECT id FROM app.users WHERE email = 'p1.team1@example.com'")).scalar_one()
        s.execute(text("DELETE FROM app.acceptances WHERE user_id = CAST(:user AS uuid)"), {"user": str(user_id)})

    listing = pc.get("/v1/assignments")
    assert listing.status_code == 200
    for suffix, params in (
        ("files/content", {"path": "config/env.js"}),
        ("search", {"q": "search"}),
    ):
        response = pc.get(f"/v1/challenges/{assignment['challenge_id']}/{suffix}", params=params)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "RULES_NOT_ACCEPTED"


def test_unreleased_stage_blocks_all_challenge_material(client):
    pc = participant_client(client, "p1.team1@example.com")
    assignment = pc.get("/v1/assignments").json()["assignments"][0]
    stage = _main_stage()
    with app_session() as s:
        s.execute(
            text("UPDATE app.stages SET status = 'sealed' WHERE id = CAST(:stage AS uuid)"),
            {"stage": str(stage["id"])},
        )

    listing = pc.get("/v1/assignments")
    assert listing.status_code == 409
    assert listing.json()["error"]["code"] == "ROUND_NOT_ACTIVE"
    for suffix, params in (
        ("files/content", {"path": "config/env.js"}),
        ("search", {"q": "search"}),
    ):
        response = pc.get(f"/v1/challenges/{assignment['challenge_id']}/{suffix}", params=params)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ROUND_NOT_ACTIVE"


def test_unpublished_assignment_is_not_disclosed(client):
    pc = participant_client(client, "p1.team1@example.com")
    assignment = pc.get("/v1/assignments").json()["assignments"][0]
    with app_session() as s:
        s.execute(
            text("UPDATE app.challenge_versions SET status = 'draft' WHERE id = CAST(:challenge AS uuid)"),
            {"challenge": assignment["challenge_id"]},
        )

    assert pc.get("/v1/assignments").json() == {
        "assignments": [],
        "message": "No challenge assigned yet.",
    }
    for suffix, params in (
        ("files/content", {"path": "config/env.js"}),
        ("search", {"q": "search"}),
    ):
        response = pc.get(f"/v1/challenges/{assignment['challenge_id']}/{suffix}", params=params)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "FILE_NOT_FOUND"


@pytest.mark.parametrize("path", ["../../etc/passwd", "/etc/passwd", "routes/../../secrets.txt", "notes.js\x00.txt"])
def test_content_rejects_traversal_without_disclosing_files(client, path):
    pc = participant_client(client, "p1.team1@example.com")
    challenge_id = pc.get("/v1/assignments").json()["assignments"][0]["challenge_id"]

    response = pc.get(
        f"/v1/challenges/{challenge_id}/files/content",
        params={"path": path},
        headers={"X-Request-Id": "path-rejection-probe"},
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "PATH_INVALID",
            "message": "Invalid path.",
            "request_id": "path-rejection-probe",
            "details": {},
        }
    }


def test_restricted_filename_is_absent_from_listing_content_and_search(client):
    pc = participant_client(client, "p1.team1@example.com")
    assignment = pc.get("/v1/assignments").json()["assignments"][0]
    challenge_id = assignment["challenge_id"]
    assert all(item["path"] != RESTRICTED_FILENAME for item in assignment["files"])

    content = pc.get(f"/v1/challenges/{challenge_id}/files/content", params={"path": RESTRICTED_FILENAME})
    assert content.status_code == 404
    assert content.json()["error"]["code"] == "FILE_NOT_FOUND"
    assert RESTRICTED_FILENAME not in content.text

    search = pc.get(f"/v1/challenges/{challenge_id}/search", params={"q": "ORGANIZER_ANSWER_KEY"})
    assert search.status_code == 200
    assert all(item["path"] != RESTRICTED_FILENAME for item in search.json()["results"])


def test_oversized_database_file_is_not_served(client):
    pc = participant_client(client, "p1.team1@example.com")
    challenge_id = pc.get("/v1/assignments").json()["assignments"][0]["challenge_id"]
    path = "fixtures/oversized.txt"
    content = "x" * (512 * 1024 + 1)
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.challenge_files "
                "(id, challenge_version_id, path, lang, content, sha256, size_bytes, line_count) VALUES "
                "(CAST(:id AS uuid), CAST(:challenge AS uuid), :path, 'text', :content, :sha, :size, 1)"
            ),
            {
                "id": str(uuid.uuid4()),
                "challenge": challenge_id,
                "path": path,
                "content": content,
                "sha": hashlib.sha256(content.encode()).hexdigest(),
                "size": len(content.encode()),
            },
        )

    response = pc.get(f"/v1/challenges/{challenge_id}/files/content", params={"path": path})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "FILE_NOT_FOUND"
    assert content not in response.text
