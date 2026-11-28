"""Shared helpers for the four-level flow tests (imported by test_flow_*)."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from conftest import STAFF_PW, login
from fastapi.testclient import TestClient

TEAM1 = ["p1.team1@example.com", "p2.team1@example.com", "p3.team1@example.com", "p4.team1@example.com"]
TEAM2 = [
    "p1.team2@example.com",
    "p2.team2@example.com",
    "p3.team2@example.com",
    "p4.team2@example.com",
    "p5.team2@example.com",
]

# The generated ground truth (organizer/gt-manifest.json) is the single source
# of truth for award units, so flow tests craft reports from the manifest
# instead of hardcoding files and line ranges that drift with rebuilds.
REPO_ROOT = Path(__file__).resolve().parents[2]
_GT_MANIFEST: dict | None = None

REPAIR_SET_TICKETS = [
    "P1-01",
    "P1-04",
    "P1-06",
    "P1-08",
    "P1-12",
    "P2-01",
    "P2-02",
    "P2-04",
    "P2-07",
    "P2-09",
]


def gt_manifest() -> dict:
    global _GT_MANIFEST
    if _GT_MANIFEST is None:
        _GT_MANIFEST = json.loads((REPO_ROOT / "organizer" / "gt-manifest.json").read_text())
    return _GT_MANIFEST


def gt_bug(code: str) -> dict:
    for bug in gt_manifest()["bugs"]:
        if bug["code"] == code:
            return bug
    raise AssertionError(f"award unit {code} not found in organizer/gt-manifest.json")


def gt_bug_locations(code: str) -> list[dict]:
    """The seeded report locations for one award unit (3-line windows)."""
    return [
        {"file_path": loc["file_path"], "line_start": loc["line_start"], "line_end": loc["line_end"]}
        for loc in gt_bug(code)["locations"]
    ]


def gt_bug_report(code: str, extra: str = "") -> dict:
    """A report that auto-accepts against the manifest entry: all seeded
    locations, the entry's category, and alias-bearing description text."""
    bug = gt_bug(code)
    aliases = ", ".join(keyword for keyword, _ in bug["aliases"])
    return {
        "title": bug["title"],
        "category": bug["category"],
        "description": f"{bug['explanation']} Matching concepts: {aliases}. {extra}".strip(),
        "evidence": f"Reproduced per the manifest entry for {bug['code']}.",
        "locations": gt_bug_locations(code),
    }


def gt_level_points(level_no: int) -> int:
    """Stage ceiling: level 1 and 2 sum their own award units; levels 3 and 4
    are scored against the repair set."""
    bugs = gt_manifest()["bugs"]
    if level_no in (1, 2):
        return sum(int(b["points"]) for b in bugs if b["level"] == level_no)
    ticket_points = {b["ticket"]: int(b["points"]) for b in bugs}
    return sum(ticket_points[t] for t in REPAIR_SET_TICKETS)


def flow_client(client: TestClient, email: str) -> TestClient:
    """A signed-in participant client with rules accepted (no stage arming)."""
    token = login(client, email)["access_token"]
    pc = TestClient(client.app)
    pc.headers.update({"Authorization": f"Bearer {token}"})
    me = pc.get("/v1/me").json()
    if not me.get("rules_accepted"):
        pc.post("/v1/me/acceptances", json={}).raise_for_status()
    return pc


def go_live(client: TestClient) -> str:
    """Move the seeded event to live (idempotent). Returns the event id."""
    org = client.post("/v1/auth/login", json={"email": "organizer@example.com", "password": STAFF_PW}).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    ev = oc.get("/v1/admin/events").json()["events"][0]
    event_id = ev["id"]
    if ev["status"] == "configured":
        oc.post(f"/v1/admin/events/{event_id}/status", json={"status": "ready"}).raise_for_status()
        for item in oc.get(f"/v1/admin/events/{event_id}/readiness").json()["items"]:
            oc.post(f"/v1/admin/events/{event_id}/readiness/{item['key']}", json={"state": "checked"})
        oc.post(f"/v1/admin/events/{event_id}/status", json={"status": "live"}).raise_for_status()
    return event_id


def lock_repo(pc: TestClient, option: str = "A", key: str | None = None):
    key = key or f"lock-{uuid.uuid4()}"
    return pc.post(
        "/v1/team/repo-lock",
        json={"option": option, "confirm": True},
        headers={"Idempotency-Key": key},
    )


def levels_view(pc: TestClient) -> dict:
    return pc.get("/v1/levels").json()


def stage_id_for(pc: TestClient, level_no: int) -> str:
    for lvl in levels_view(pc)["levels"]:
        if lvl["level_no"] == level_no:
            return lvl["stage_id"]
    raise AssertionError(f"level {level_no} not configured")


def enter_workspace(pc: TestClient, level_no: int):
    return pc.get(f"/v1/levels/{level_no}/workspace")


def submit_empty(pc: TestClient, level_no: int, key: str | None = None):
    key = key or f"submit-{uuid.uuid4()}"
    return pc.post(
        f"/v1/levels/{level_no}/submit",
        json={"flags": [], "confirm_empty": True},
        headers={"Idempotency-Key": key},
    )


def submit_flags(pc: TestClient, level_no: int, flags: list[dict], key: str | None = None):
    key = key or f"submit-{uuid.uuid4()}"
    pc.headers["X-Last-Idem"] = key  # recoverable for replay assertions
    return pc.post(
        f"/v1/levels/{level_no}/submit",
        json={"flags": flags},
        headers={"Idempotency-Key": key},
    )


def open_level_window(level_no: int, minutes: int = 60) -> None:
    """Open a level's execution window (tests drive the schedule explicitly;
    the seed arms Levels 2+ in the future by design)."""
    db_exec(
        "UPDATE app.stages SET status = 'active', starts_at = now() - interval '5 minutes', "
        "ends_at = now() + make_interval(mins => :m) WHERE kind = 'level' AND ordinal = :n",
        {"m": minutes, "n": level_no},
    )


def advance_team(client: TestClient, emails: list[str], upto_level: int, lock: bool = True) -> None:
    """Take every listed member through levels 1..upto_level with explicit
    empty submissions (the team gate requires all teammates to finish)."""
    pcs = [flow_client(client, e) for e in emails]
    if lock and upto_level >= 1:
        r = lock_repo(pcs[0])
        assert r.status_code == 200, r.text
    for level_no in range(1, upto_level + 1):
        open_level_window(level_no)
        for pc in pcs:
            r = enter_workspace(pc, level_no)
            assert r.status_code == 200, f"{email_of(pc)} enter L{level_no}: {r.text}"
            r = submit_empty(pc, level_no)
            assert r.status_code == 202, f"{email_of(pc)} submit L{level_no}: {r.text}"


def email_of(pc: TestClient) -> str:
    return pc.get("/v1/me").json()["email"]


def find_line_in_file(pc: TestClient, path: str, needle: str) -> int:
    content = pc.get(f"/v1/repo/files/{path}").json()["content"]
    for i, line in enumerate(content.splitlines(), start=1):
        if needle in line:
            return i
    raise AssertionError(f"needle {needle!r} not found in {path}")


def db_exec(stmt: str, params: dict | None = None) -> None:
    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        s.execute(text(stmt), params or {})
