"""Server-side auto-submit at the deadline: browser-closed durability,
idempotence and the manual-submit race (spec 7.5, acceptance 8/14)."""

from __future__ import annotations

from conftest import worker_drain
from flow_helpers import TEAM1, TEAM2, enter_workspace, flow_client, go_live, lock_repo, submit_empty, submit_flags


def _expire_level(level_no: int, minutes_past: int = 10) -> None:
    from flow_helpers import db_exec

    db_exec(
        "UPDATE app.stages SET ends_at = now() - make_interval(mins => :m) WHERE kind = 'level' AND ordinal = :n",
        {"m": minutes_past, "n": level_no},
    )


def test_auto_submit_converts_server_draft_when_browser_closed(client):
    go_live(client)
    pcs = {e: flow_client(client, e) for e in TEAM1}
    lock_repo(pcs[TEAM1[0]]).raise_for_status()
    # the lead saved a flag draft, then the browser died before submitting
    line_a = 40
    draft = {
        "flags": [
            {
                "title": "Search never matches notes",
                "category": "input_validation",
                "description": "The LIKE comparison binds the raw term so wildcards are never applied.",
                "locations": [{"file_path": "db.js", "line_start": line_a, "line_end": line_a + 1}],
            }
        ]
    }
    r = pcs[TEAM1[0]].put("/v1/levels/1/draft", json={"payload": draft})
    assert r.status_code == 200
    for pc in pcs.values():
        enter_workspace(pc, 1)

    _expire_level(1)
    from app import auto_submit

    submitted = auto_submit.scan_and_submit()
    # Team 1 (4 members) converts their drafts; Team 2 (no lock) records misses
    assert submitted >= 4

    # the participant with the draft got their flag submitted server-side
    progress = pcs[TEAM1[0]].get("/v1/progress").json()
    assert progress["pointer"]["level_no"] == 2
    l1 = next(lvl for lvl in progress["levels"] if lvl["level_no"] == 1)
    assert l1["status"] == "auto_submitted"
    worker_drain()
    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT payload FROM app.submissions WHERE author_id = CAST(:u AS uuid) "
                    "AND kind = 'level_report' ORDER BY received_at DESC LIMIT 1"
                ),
                {"u": pcs[TEAM1[0]].get("/v1/me").json()["id"]},
            )
            .mappings()
            .first()
        )
        assert row is not None
        assert row["payload"]["auto"] is True
        assert len(row["payload"]["flags"]) == 1

    # teammates without drafts got explicit empty auto-submissions
    empty_progress = pcs[TEAM1[1]].get("/v1/progress").json()
    l1_empty = next(lvl for lvl in empty_progress["levels"] if lvl["level_no"] == 1)
    assert l1_empty["status"] == "auto_submitted"


def test_auto_submit_is_idempotent_under_repeats(client):
    go_live(client)
    pcs = [flow_client(client, e) for e in TEAM1]
    lock_repo(pcs[0]).raise_for_status()
    for pc in pcs:
        enter_workspace(pc, 1)
    _expire_level(1)
    from app import auto_submit

    first = auto_submit.scan_and_submit()
    assert first >= 4
    second = auto_submit.scan_and_submit()
    assert second == 0
    third = auto_submit.scan_and_submit()
    assert third == 0

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        n = s.execute(
            text(
                "SELECT count(*) FROM app.submissions s JOIN app.stages st ON st.id = s.stage_id "
                "WHERE st.kind = 'level' AND st.ordinal = 1"
            )
        ).scalar_one()
        assert int(n) == 4


def test_manual_submit_beats_the_scan_exactly_once(client):
    """A manual submit racing the deadline yields exactly one effective
    submission; whichever path wins, the other is a no-op (acceptance 14)."""
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    _expire_level(1, minutes_past=10)
    from app import auto_submit

    auto_submit.scan_and_submit()
    # the scan already auto-submitted this participant
    r = submit_flags(
        pc,
        1,
        [
            {
                "title": "Late manual attempt after auto-submit",
                "category": "logic",
                "description": "This manual attempt arrives after the scheduler already submitted the level.",
                "locations": [{"file_path": "db.js", "line_start": 40, "line_end": 42}],
            }
        ],
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "LEVEL_ALREADY_SUBMITTED"

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        n = s.execute(
            text(
                "SELECT count(*) FROM app.submissions s JOIN app.team_members tm ON tm.user_id = s.author_id "
                "JOIN app.users u ON u.id = s.author_id WHERE u.email = 'p1.team1@example.com' "
                "AND s.kind = 'level_report'"
            )
        ).scalar_one()
        assert int(n) == 1


def test_manual_submit_inside_grace_window_wins_over_deadline(client):
    go_live(client)
    pc = flow_client(client, TEAM2[0])
    lock_repo(pc, "A", key="lock-team2-grace").raise_for_status()
    enter_workspace(pc, 1).raise_for_status()
    # expire just past the window but WITHIN the 3 s grace seconds
    from flow_helpers import db_exec

    db_exec("UPDATE app.stages SET ends_at = now() - interval '2 seconds' WHERE kind = 'level' AND ordinal = 1")
    r = submit_empty(pc, 1)
    assert r.status_code == 202, r.text
    # now fully expire: the next participant is auto-submitted by the scheduler
    db_exec("UPDATE app.stages SET ends_at = now() - interval '30 seconds' WHERE kind = 'level' AND ordinal = 1")
    from app import auto_submit

    auto_submit.scan_and_submit()
    progress = pc.get("/v1/progress").json()
    l1 = next(lvl for lvl in progress["levels"] if lvl["level_no"] == 1)
    assert l1["status"] == "submitted"  # the manual receipt stands
    other = flow_client(client, TEAM2[1]).get("/v1/progress").json()
    l1_other = next(lvl for lvl in other["levels"] if lvl["level_no"] == 1)
    assert l1_other["status"] == "auto_submitted"


def test_no_lock_team_gets_missed_status_not_a_fabricated_submission(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    # no repo lock; the deadline passes
    _expire_level(1, minutes_past=5)
    from app import auto_submit

    auto_submit.scan_and_submit()
    progress = pc.get("/v1/progress").json()
    l1 = next(lvl for lvl in progress["levels"] if lvl["level_no"] == 1)
    assert l1["status"] == "missed"

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        n = s.execute(
            text(
                "SELECT count(*) FROM app.submissions s JOIN app.users u ON u.id = s.author_id "
                "WHERE u.email = 'p1.team1@example.com'"
            )
        ).scalar_one()
        assert int(n) == 0


def test_admin_can_trigger_auto_submit_scan(client):
    go_live(client)
    from conftest import STAFF_PW
    from fastapi.testclient import TestClient

    org = client.post("/v1/auth/login", json={"email": "organizer@example.com", "password": STAFF_PW}).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    r = oc.post("/v1/admin/jobs/auto-submit")
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
