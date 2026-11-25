"""Repo lock: lead-only, immutable, idempotent, concurrent-safe (spec 5.3)."""

from __future__ import annotations

import threading

from conftest import worker_drain  # noqa: F401  (evaluation runs in tests via drain)
from flow_helpers import TEAM1, flow_client, go_live, lock_repo


def test_non_lead_cannot_lock(client):
    go_live(client)
    pc = flow_client(client, TEAM1[1])  # second member, not the lead
    r = lock_repo(pc, "A")
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_lead_lock_replay_and_conflict(client):
    go_live(client)
    lead = flow_client(client, TEAM1[0])
    r1 = lock_repo(lead, "A", key="lock-key-aaaa")
    assert r1.status_code == 200, r1.text
    assert r1.json()["option"] == "A"
    assert r1.json()["replay"] is False

    # same key + same option: original receipt (replay)
    r2 = lock_repo(lead, "A", key="lock-key-aaaa")
    assert r2.status_code == 200
    assert r2.json()["replay"] is True

    # same key + different option: idempotency conflict
    r3 = lock_repo(lead, "B", key="lock-key-aaaa")
    assert r3.status_code == 409
    assert r3.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"

    # different key + different option: irreversible choice conflict
    r4 = lock_repo(lead, "B", key="lock-key-bbbb")
    assert r4.status_code == 409
    assert r4.json()["error"]["code"] == "REPO_ALREADY_LOCKED"
    assert r4.json()["error"]["details"]["option"] == "A"

    # the choice did not move
    team = lead.get("/v1/team").json()
    assert team["repo_option"]["option_key"] == "A"


def test_confirm_flag_required(client):
    go_live(client)
    lead = flow_client(client, TEAM1[0])
    r = lead.post(
        "/v1/team/repo-lock",
        json={"option": "A", "confirm": False},
        headers={"Idempotency-Key": "lock-key-cccc"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_concurrent_locks_create_exactly_one_choice(client):
    go_live(client)
    lead = flow_client(client, TEAM1[0])
    results: list = []

    def attempt(key: str):
        results.append(lock_repo(lead, "A", key=key))

    threads = [threading.Thread(target=attempt, args=(f"race-key-{i}0",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 4
    ok = [r for r in results if r.status_code == 200]
    conflict = [r for r in results if r.status_code == 409]
    assert len(ok) >= 1
    assert len(ok) + len(conflict) == 4
    assert {r.json()["option"] for r in ok} == {"A"}

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        n = s.execute(text("SELECT count(*) FROM app.team_repo_choices")).scalar_one()
        assert int(n) == 1
        # team-scoped assignments exist for all four level stages
        rows = s.execute(
            text(
                "SELECT count(DISTINCT stage_id) FROM app.assignments a "
                "JOIN app.stages st ON st.id = a.stage_id WHERE st.kind = 'level'"
            )
        ).scalar_one()
        assert int(rows) == 4
        # every member's Level 1 opened
        st = s.execute(
            text(
                "SELECT DISTINCT status FROM app.participant_progress WHERE level_no = 1 "
                "AND user_id IN (SELECT user_id FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                "WHERE t.name = 'Team Lambda')"
            )
        ).scalar_one()
        assert st == "available"

    # audit trail recorded the lock
    with app_session() as s:
        action = s.execute(text("SELECT count(*) FROM audit.entries WHERE action = 'repo.locked'")).scalar_one()
        assert int(action) >= 1


def test_lock_opens_repo_tree_for_members(client):
    go_live(client)
    member = flow_client(client, TEAM1[2])
    # before the lock the tree is gated
    r = member.get("/v1/repo/tree")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "REPO_NOT_LOCKED"
    assert lock_repo(flow_client(client, TEAM1[0])).status_code == 200
    r = member.get("/v1/repo/tree")
    assert r.status_code == 200, r.text
    files = r.json()["files"]
    assert any(f["path"] == "routes/notes.js" for f in files)
    # scoped to the chosen option: the workspace is reachable
    r = member.get("/v1/levels/1/workspace")
    assert r.status_code == 200
    assert r.json()["editable"] is False


def test_option_b_lock_serves_marina(client):
    go_live(client)
    lead2 = flow_client(client, "p1.team2@example.com")
    r = lock_repo(lead2, "B", key="lock-team2-b")
    assert r.status_code == 200, r.text
    r = lead2.get("/v1/repo/tree")
    assert r.status_code == 200
    paths = {f["path"] for f in r.json()["files"]}
    assert "main.py" in paths and "database.py" in paths
    # team 1 remains unlocked and unaffected (per-team gate)
    t1 = flow_client(client, TEAM1[0])
    gate = t1.get("/v1/levels/1/gate").json()
    assert gate["allowed"] is False
