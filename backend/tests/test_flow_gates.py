"""Team gates, level windows and no-backtracking progression (spec 4.3-4.5)."""

from __future__ import annotations

import uuid

from conftest import STAFF_PW
from fastapi.testclient import TestClient
from flow_helpers import TEAM1, TEAM2, enter_workspace, flow_client, go_live, lock_repo, submit_empty, submit_flags


def test_l1_gate_blocked_before_lock(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    gate = pc.get("/v1/levels/1/gate").json()
    assert gate["allowed"] is False
    assert "team lead" in gate["reason"].lower() or "lock" in gate["reason"].lower()
    ws = enter_workspace(pc, 1)
    assert ws.status_code == 409
    assert ws.json()["error"]["code"] == "REPO_NOT_LOCKED"


def test_l1_gate_open_after_lock(client):
    go_live(client)
    lead = flow_client(client, TEAM1[0])
    lock_repo(lead).raise_for_status()
    for email in TEAM1:
        gate = flow_client(client, email).get("/v1/levels/1/gate").json()
        assert gate["allowed"] is True, (email, gate)


def test_l2_team_gate_waiting_on_and_open(client):
    go_live(client)
    pcs = {email: flow_client(client, email) for email in TEAM1}
    lock_repo(pcs[TEAM1[0]]).raise_for_status()
    # open the Level 2 window (the seed arms it 15 minutes ahead)
    from flow_helpers import db_exec

    db_exec(
        "UPDATE app.stages SET status = 'active', starts_at = now() - interval '5 minutes', "
        "ends_at = now() + interval '60 minutes' WHERE kind = 'level' AND ordinal = 2"
    )

    # every member finishes Level 1 one at a time; gate for L2 reflects who is left
    r = submit_empty(pcs[TEAM1[0]], 1)
    assert r.status_code == 202, r.text
    gate = pcs[TEAM1[0]].get("/v1/levels/2/gate").json()
    names_waiting = {w["name"] for w in gate["waiting_on"]}
    first = pcs[TEAM1[0]].get("/v1/me").json()["name"]
    assert first not in names_waiting
    assert len(names_waiting) == 3
    assert gate["allowed"] is False

    # a teammate that has NOT finished L1 is blocked from entering L2
    ws = enter_workspace(pcs[TEAM1[1]], 2)
    assert ws.status_code == 409
    assert ws.json()["error"]["code"] == "TEAM_GATE_BLOCKED"

    for email in TEAM1[1:]:
        submit_empty(pcs[email], 1).raise_for_status()
    gate = pcs[TEAM1[0]].get("/v1/levels/2/gate").json()
    assert gate["allowed"] is True, gate
    assert gate["waiting_on"] == []


def test_gate_is_per_team(client):
    go_live(client)
    # team 1 fully finishes L1; team 2 never locks
    advance_t1 = [flow_client(client, e) for e in TEAM1]
    lock_repo(advance_t1[0]).raise_for_status()
    for pc in advance_t1:
        submit_empty(pc, 1).raise_for_status()
    t2 = flow_client(client, TEAM2[0])
    gate = t2.get("/v1/levels/2/gate").json()
    assert gate["allowed"] is False
    # team 2's blocking reason is their own state, not team 1's
    gate1 = t2.get("/v1/levels/1/gate").json()
    assert gate1["allowed"] is False


def test_paused_level_blocks_entry(client):
    go_live(client)
    pcs = [flow_client(client, e) for e in TEAM1]
    lock_repo(pcs[0]).raise_for_status()
    # pause Level 1 through the audited admin control endpoint
    org = client.post("/v1/auth/login", json={"email": "organizer@example.com", "password": STAFF_PW}).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    from flow_helpers import stage_id_for

    sid = stage_id_for(pcs[0], 1)
    # start requires armed; the seed starts L1 active directly, so end->... simply pause:
    r = oc.post(f"/v1/admin/stages/{sid}/control", json={"action": "pause", "reason": "TEC-100 drill"})
    assert r.status_code == 200, r.text
    gate = pcs[0].get("/v1/levels/1/gate").json()
    assert gate["allowed"] is False
    assert "paused" in gate["reason"].lower()
    assert submit_empty(pcs[0], 1).status_code == 409


def test_submitted_level_is_immutable(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    r = submit_flags(
        pc,
        1,
        [
            {
                "title": "Delete uses author id as note id",
                "category": "data_handling",
                "description": "The delete route passes note.author_id into a query that matches by note id.",
                "locations": [{"file_path": "routes/notes.js", "line_start": 40, "line_end": 42}],
            }
        ],
    )
    assert r.status_code == 202, r.text
    receipt = r.json()

    # re-submit with a fresh key: the level is closed forever
    r2 = submit_empty(pc, 1)
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "LEVEL_ALREADY_SUBMITTED"

    # the same idempotency key replays the original receipt (recoverable retry)
    r3 = pc.post(
        "/v1/levels/1/submit",
        json={
            "flags": [
                {
                    "title": "Delete uses author id as note id",
                    "category": "data_handling",
                    "description": "The delete route passes note.author_id into a query that matches by note id.",
                    "locations": [{"file_path": "routes/notes.js", "line_start": 40, "line_end": 42}],
                }
            ]
        },
        headers={"Idempotency-Key": _last_key(pc)},
    )
    assert r3.status_code == 202
    assert r3.json()["receipt_code"] == receipt["receipt_code"]
    assert r3.json()["replay"] is True

    # drafts for the submitted level are rejected
    r4 = pc.put("/v1/levels/1/draft", json={"payload": {"flags": []}})
    assert r4.status_code == 409

    # the dashboard (progress) stays reachable and shows the submitted level
    progress = pc.get("/v1/progress").json()
    assert progress["pointer"]["level_no"] == 2
    assert progress["pointer"]["node"] == "explain"
    l1 = next(lvl for lvl in progress["levels"] if lvl["level_no"] == 1)
    assert l1["status"] == "submitted"

    # earlier level content remains readable (view-only), future levels are not
    assert pc.get("/v1/repo/tree", params={"level": 1}).status_code == 200
    r5 = pc.get("/v1/repo/tree", params={"level": 3})
    assert r5.status_code == 409
    assert r5.json()["error"]["code"] == "LEVEL_NOT_OPEN"


def test_pointer_never_moves_backwards(client):
    """The domain module rejects any backward transition (unit, spec 4.5)."""
    from app.errors import ApiError
    from app.flow import assert_forward

    assert_forward((1, "exec"), (1, "done"))  # legal forward
    for current, new in [((2, "explain"), (1, "exec")), ((2, "done"), (1, "done")), ((1, "exec"), (1, "explain"))]:
        try:
            assert_forward(current, new)
        except ApiError as e:
            assert e.code == "LEVEL_ALREADY_SUBMITTED"
        else:  # pragma: no cover
            raise AssertionError(f"backward transition {current}->{new} was allowed")


def test_level_flag_file_validation(client):
    go_live(client)
    pc = flow_client(client, TEAM2[0])
    lock_repo(pc, "B", key="lock-team2-b-val").raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    # unknown file
    r = submit_flags(
        pc,
        1,
        [
            {
                "title": "Unknown file location",
                "category": "logic",
                "description": "A description that is long enough for validation to reach the file check.",
                "locations": [{"file_path": "no/such/file.py", "line_start": 1, "line_end": 2}],
            }
        ],
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "FILE_NOT_FOUND"
    # line range beyond the file
    r2 = submit_flags(
        pc,
        1,
        [
            {
                "title": "Range beyond end of file",
                "category": "logic",
                "description": "A description that is long enough for validation to reach the range check.",
                "locations": [{"file_path": "main.py", "line_start": 99990, "line_end": 100000}],
            }
        ],
    )
    assert r2.status_code == 422
    assert r2.json()["error"]["code"] in ("LOCATION_INVALID", "SUBMISSION_INVALID")
    # zero flags without the explicit confirmation
    r3 = pc.post(
        "/v1/levels/1/submit",
        json={"flags": []},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r3.status_code == 422


def test_level1_flag_with_two_locations_rejected(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc, "A", key="lock-team1-a-val").raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    r = submit_flags(
        pc,
        1,
        [
            {
                "title": "Two locations on a level one flag",
                "category": "logic",
                "description": "Level 1 flags carry exactly one location, so this must be rejected.",
                "locations": [
                    {"file_path": "routes/notes.js", "line_start": 40, "line_end": 42},
                    {"file_path": "db.js", "line_start": 20, "line_end": 22},
                ],
            }
        ],
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "LOCATION_INVALID"


def _last_key(pc: TestClient) -> str:
    """The idempotency key recorded by the last submit_flags call."""
    return pc.headers.get("X-Last-Idem", "")
