"""Four-level flow domain: node state machine, monotonic pointer, gates.

The server owns progression (baseline section 4). This module is the single
place where legal node transitions are defined; routers call the helpers
inside their transactions so illegal state changes are rejected atomically.
Pure functions live next to the DB helpers and carry no I/O, so the state
machine is unit-testable without a database.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from .errors import ApiError

LEVEL_COUNT = 4
# node ordering index: explain < exec < done
NODE_ORDER = {"explain": 0, "exec": 1, "done": 2}
# MANUAL-REVALIDATION (REM-062): terminal-state semantics (RELEASED→FINAL,
# DISPUTED→RESOLVED) must be reconciled with the DB transition constraints.
LEVEL_STATUSES = ("locked", "available", "in_progress", "submitted", "auto_submitted", "missed")
DONE_STATUSES = ("submitted", "auto_submitted")


class FlowError(ApiError):
    """Raised for illegal progression attempts; uses the shared error envelope."""


def node_key(level_no: int, node: str) -> tuple[int, int]:
    return (int(level_no), NODE_ORDER[node])


def assert_forward(current: tuple[int, str], new: tuple[int, str]) -> None:
    """Monotonic pointer rule: a transition may never move backwards (spec 4.5)."""
    if node_key(*new) < node_key(*current):
        raise FlowError(
            "LEVEL_ALREADY_SUBMITTED",
            message="This level is already submitted and cannot be reopened.",
        )


def next_position(level_no: int, node: str) -> tuple[int, str] | None:
    """The position that follows (level_no, node); None when the flow is done."""
    if node == "explain":
        return (int(level_no), "exec")
    if node == "exec":
        if int(level_no) >= LEVEL_COUNT:
            return (LEVEL_COUNT, "done")
        return (int(level_no) + 1, "explain")
    return None


# --- DB helpers (call inside an app_session transaction) ----------------------


def get_pointer(session: Session, user_id: str) -> dict | None:
    row = (
        session.execute(
            text(
                "SELECT user_id, event_id, level_no, node, updated_at FROM app.participant_pointers "
                "WHERE user_id = CAST(:u AS uuid)"
            ),
            {"u": user_id},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def get_pointer_for_update(session: Session, user_id: str) -> dict | None:
    # Confirmed (REM-057): SELECT ... FOR UPDATE locks the pointer row so the
    # monotonicity check + update serialize against concurrent advances.
    row = (
        session.execute(
            text(
                "SELECT user_id, event_id, level_no, node, updated_at FROM app.participant_pointers "
                "WHERE user_id = CAST(:u AS uuid) FOR UPDATE"
            ),
            {"u": user_id},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def init_participant_flow(session: Session, event_id: str, user_id: str) -> dict:
    """Create pointer + progress rows on first touch: start at L1 explain.

    Level 1 stays `locked` until the team lead locks the repo; L2+ start
    `locked` behind the team gate. Idempotent.
    """
    ptr = get_pointer(session, user_id)
    if ptr is not None:
        return ptr
    session.execute(
        text(
            "INSERT INTO app.participant_pointers (id, user_id, event_id, level_no, node) "
            "VALUES (CAST(:id AS uuid), CAST(:u AS uuid), CAST(:e AS uuid), 1, 'explain')"
        ),
        {"id": __import__("uuid").uuid4().__str__(), "u": user_id, "e": event_id},
    )
    session.execute(
        text(
            "INSERT INTO app.participant_progress (id, user_id, event_id, level_no, status) "
            "VALUES (CAST(:id AS uuid), CAST(:u AS uuid), CAST(:e AS uuid), 1, 'locked')"
        ),
        {"id": __import__("uuid").uuid4().__str__(), "u": user_id, "e": event_id},
    )
    for n in range(2, LEVEL_COUNT + 1):
        session.execute(
            text(
                "INSERT INTO app.participant_progress (id, user_id, event_id, level_no, status) "
                "VALUES (CAST(:id AS uuid), CAST(:u AS uuid), CAST(:e AS uuid), :n, 'locked')"
            ),
            {"id": __import__("uuid").uuid4().__str__(), "u": user_id, "e": event_id, "n": n},
        )
    ptr = get_pointer(session, user_id)
    assert ptr is not None
    return ptr


def advance_pointer(session: Session, user_id: str, new_level: int, new_node: str) -> dict:
    """Move the pointer forward only. Locks the row, validates monotonicity."""
    ptr = get_pointer_for_update(session, user_id)
    if ptr is None:
        raise FlowError("NOT_FOUND", message="No progress record for this participant.")
    assert_forward((int(ptr["level_no"]), str(ptr["node"])), (int(new_level), str(new_node)))
    session.execute(
        text(
            "UPDATE app.participant_pointers SET level_no = :l, node = :n, updated_at = now() "
            "WHERE user_id = CAST(:u AS uuid)"
        ),
        {"l": int(new_level), "n": new_node, "u": user_id},
    )
    return {"level_no": int(new_level), "node": new_node}


def set_level_status(
    session: Session,
    user_id: str,
    level_no: int,
    status: str,
    *,
    submission_id: str | None = None,
    submitted_at=None,
) -> None:
    if status not in LEVEL_STATUSES:
        raise FlowError("VALIDATION_ERROR", details={"status": "Unknown level status."})
    updated = session.execute(
        text(
            "UPDATE app.participant_progress SET status = :s, "
            "submission_id = COALESCE(CAST(:sid AS uuid), submission_id), "
            "submitted_at = COALESCE(:at, submitted_at), updated_at = now() "
            "WHERE user_id = CAST(:u AS uuid) AND level_no = :l"
        ),
        {"s": status, "sid": submission_id, "at": submitted_at, "u": user_id, "l": int(level_no)},
    )
    if updated.rowcount == 0:
        # the row should exist from init; create defensively so an organizer
        # change never dead-ends a participant
        session.execute(
            text(
                "INSERT INTO app.participant_progress (id, user_id, event_id, level_no, status, submission_id, submitted_at) "
                "SELECT CAST(:id AS uuid), CAST(:u AS uuid), e.id, :l, :s, CAST(:sid AS uuid), :at "
                "FROM app.events e WHERE e.id = (SELECT event_id FROM app.participant_pointers WHERE user_id = CAST(:u AS uuid))"
            ),
            {
                "id": __import__("uuid").uuid4().__str__(),
                "u": user_id,
                "l": int(level_no),
                "s": status,
                "sid": submission_id,
                "at": submitted_at,
            },
        )


def get_level_status(session: Session, user_id: str, level_no: int) -> str | None:
    row = session.execute(
        text("SELECT status FROM app.participant_progress WHERE user_id = CAST(:u AS uuid) AND level_no = :l"),
        {"u": user_id, "l": int(level_no)},
    ).first()
    return str(row[0]) if row else None


def get_all_progress(session: Session, user_id: str) -> list[dict]:
    rows = (
        session.execute(
            text(
                "SELECT level_no, status, submission_id, submitted_at FROM app.participant_progress "
                "WHERE user_id = CAST(:u AS uuid) ORDER BY level_no"
            ),
            {"u": user_id},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


# --- gates --------------------------------------------------------------------


def level_stage(session: Session, event_id: str, level_no: int) -> dict | None:
    """The level's stage row (kind='level', ordinal = level_no)."""
    row = (
        session.execute(
            text(
                "SELECT id, name, kind, ordinal, status, starts_at, ends_at, grace_seconds, config "
                "FROM app.stages WHERE event_id = CAST(:e AS uuid) AND kind = 'level' AND ordinal = :n"
            ),
            {"e": event_id, "n": int(level_no)},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def _effective_end(session: Session, stage: dict, user_id: str):
    base = stage.get("ends_at")
    if base is None:
        return None
    adj = session.execute(
        text(
            "SELECT COALESCE(SUM(delta_seconds), 0) FROM app.time_adjustments "
            "WHERE stage_id = CAST(:s AS uuid) AND (user_id IS NULL OR user_id = CAST(:u AS uuid))"
        ),
        {"s": str(stage["id"]), "u": user_id},
    ).scalar_one()
    return base + timedelta(seconds=int(adj or 0))


def compute_gate(session: Session, event_id: str, user_id: str, team_id: str | None, level_no: int, now) -> dict:
    """Authoritative gate decision for entering level `level_no` (spec 4.3).

    Returns {allowed, reason, waiting_on, stage_status}. Never cached; callers
    use it at request time inside their own transaction.
    """
    # MANUAL-REVALIDATION (REM-062): window cutoffs use the caller's clock here;
    # leaderboard/release cutoffs must use DB time.
    stage = level_stage(session, event_id, level_no)
    if stage is None:
        return {"allowed": False, "reason": "Level not configured yet.", "waiting_on": [], "stage_status": None}

    # 1. schedule: the level window must be open for entry
    if stage["status"] == "paused":
        return {
            "allowed": False,
            "reason": "The level is paused. Your timer is stopped.",
            "waiting_on": [],
            "stage_status": stage["status"],
        }
    if stage["status"] not in ("armed", "active"):
        return {
            "allowed": False,
            "reason": "The level is not open yet."
            if stage["status"] in ("draft", "sealed")
            else "The level window has closed.",
            "waiting_on": [],
            "stage_status": stage["status"],
        }
    if stage["status"] == "armed" and stage["starts_at"] is not None and now < stage["starts_at"]:
        return {
            "allowed": False,
            "reason": f"The level opens at {stage['starts_at'].isoformat()}.",
            "waiting_on": [],
            "stage_status": stage["status"],
        }
    eff_end = _effective_end(session, stage, user_id)
    grace = int(stage["grace_seconds"] or 0)
    if eff_end is not None and now > eff_end + timedelta(seconds=grace):
        return {
            "allowed": False,
            "reason": "The level window has closed.",
            "waiting_on": [],
            "stage_status": stage["status"],
        }

    # 2. level 1 requires the team repo lock
    if level_no == 1:
        if team_id is None:
            return {
                "allowed": False,
                "reason": "You are not assigned to a team yet.",
                "waiting_on": [],
                "stage_status": stage["status"],
            }
        choice = session.execute(
            text("SELECT option_key FROM app.team_repo_choices WHERE team_id = CAST(:t AS uuid)"),
            {"t": str(team_id)},
        ).first()
        if choice is None:
            return {
                "allowed": False,
                "reason": "Waiting for your team lead to lock the repository.",
                "waiting_on": [],
                "stage_status": stage["status"],
            }
        return {"allowed": True, "reason": "ok", "waiting_on": [], "stage_status": stage["status"]}

    # 3. levels 2+: the team gate - every teammate done with the previous level
    if team_id is None:
        return {
            "allowed": False,
            "reason": "You are not assigned to a team yet.",
            "waiting_on": [],
            "stage_status": stage["status"],
        }
    waiting = (
        session.execute(
            text(
                "SELECT u.name, u.email, COALESCE(pp.status, 'locked') AS status "
                "FROM app.team_members tm JOIN app.users u ON u.id = tm.user_id "
                "LEFT JOIN app.participant_progress pp ON pp.user_id = tm.user_id AND pp.level_no = :prev "
                "WHERE tm.team_id = CAST(:t AS uuid) "
                "AND (pp.status IS NULL OR pp.status NOT IN ('submitted', 'auto_submitted'))"
            ),
            {"t": str(team_id), "prev": int(level_no) - 1},
        )
        .mappings()
        .all()
    )
    if waiting:
        return {
            "allowed": False,
            "reason": f"Waiting for {len(waiting)} teammate(s) to finish level {level_no - 1}.",
            "waiting_on": [{"name": w["name"], "status": w["status"]} for w in waiting],
            "stage_status": stage["status"],
        }
    return {"allowed": True, "reason": "ok", "waiting_on": [], "stage_status": stage["status"]}


def require_gate(session: Session, event_id: str, user_id: str, team_id: str | None, level_no: int, now) -> dict:
    gate = compute_gate(session, event_id, user_id, team_id, level_no, now)
    if not gate["allowed"]:
        code = (
            "REPO_NOT_LOCKED"
            if "repo" in gate["reason"].lower() or "team lead" in gate["reason"].lower()
            else ("TEAM_GATE_BLOCKED" if gate["waiting_on"] else "LEVEL_NOT_OPEN")
        )
        raise FlowError(code, message=gate["reason"], details={"waiting_on": gate["waiting_on"]})
    return gate


def teammate_view(session: Session, team_id: str) -> list[dict]:
    """Team roster with per-level statuses for dashboard/gate displays."""
    rows = (
        session.execute(
            text(
                "SELECT u.id, u.name, u.email, "
                "COALESCE(pp_level1.status, 'locked') AS l1, COALESCE(pp_level2.status, 'locked') AS l2, "
                "COALESCE(pp_level3.status, 'locked') AS l3, COALESCE(pp_level4.status, 'locked') AS l4, "
                "ptr.level_no AS pointer_level, ptr.node AS pointer_node "
                "FROM app.team_members tm "
                "JOIN app.users u ON u.id = tm.user_id "
                "LEFT JOIN app.participant_progress pp_level1 ON pp_level1.user_id = tm.user_id AND pp_level1.level_no = 1 "
                "LEFT JOIN app.participant_progress pp_level2 ON pp_level2.user_id = tm.user_id AND pp_level2.level_no = 2 "
                "LEFT JOIN app.participant_progress pp_level3 ON pp_level3.user_id = tm.user_id AND pp_level3.level_no = 3 "
                "LEFT JOIN app.participant_progress pp_level4 ON pp_level4.user_id = tm.user_id AND pp_level4.level_no = 4 "
                "LEFT JOIN app.participant_pointers ptr ON ptr.user_id = tm.user_id "
                "WHERE tm.team_id = CAST(:t AS uuid) ORDER BY u.name"
            ),
            {"t": str(team_id)},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


def is_team_lead(session: Session, team_id: str, user_id: str) -> bool:
    """The explicit is_lead flag decides. Teams created before the flag
    existed fall back to the deterministic lowest joined_at member."""
    row = session.execute(
        text("SELECT user_id FROM app.team_members WHERE team_id = CAST(:t AS uuid) AND is_lead LIMIT 1"),
        {"t": str(team_id)},
    ).first()
    if row is None:
        row = session.execute(
            text(
                "SELECT tm.user_id FROM app.team_members tm WHERE tm.team_id = CAST(:t AS uuid) "
                "ORDER BY tm.joined_at ASC, tm.id ASC LIMIT 1"
            ),
            {"t": str(team_id)},
        ).first()
    return bool(row) and str(row[0]) == str(user_id)
