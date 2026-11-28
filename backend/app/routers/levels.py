"""Four-level participant surface: levels, gates, repo lock, workspace,
drafts, submissions, uploads and the runner-disabled run endpoint.

Every handler enforces the platform invariants: identity from the token,
server-owned time and state inside one transaction, idempotent submissions
with the same durable path as the v1 flow, and no ground-truth access
(this module never touches the gt schema; evaluation runs in the worker).

Route guards on the client are UX only. Immutability of submitted levels is
enforced here, on the server, for every write path.
"""

# REM-059 (OWNER-DECISION): rehearsal evidence for fixture parity and release
# completeness. This module serves challenge content and accepts submissions,
# but A/B fixture equivalence, planted flag/bug coverage vs the authoritative GT
# manifest, the versioned rules PDF generated at publish time, and a blind-pilot
# difficulty/score distribution are content/operations acceptance items that
# cannot be closed in code. They require an owner-approved rehearsal: two
# independent reviewers certify A/B equivalence, every flag/bug/test maps to a
# GT record, the published rules/content hash matches the deployed version, and
# event READY is blocked until those artifacts are frozen. No code change here;
# flag for the orchestrator/owner. (F-CKLA-16.)

from __future__ import annotations

import json as jsonlib
import math
import os
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Header, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .. import flow, security, storage
from ..audit import audit_write
from ..db import app_session, db_now, uuid7
from ..deps import Principal, get_principal, rate_limit, require_rules_accepted
from ..errors import ApiError
from ..jobs import enqueue
from ..tenancy import require_event_in_tenant, require_team_in_tenant

router = APIRouter(tags=["levels"])

CATEGORIES = {
    "logic",
    "input_validation",
    "authentication_authorization",
    "injection",
    "cryptography",
    "resource_handling",
    "concurrency",
    "error_handling",
    "configuration",
    "integration_api_contract",
    "data_handling",
    "other",
}

MAX_LOCATIONS = 5  # Level 2 ordered location list cap (spec 6.4)


def _member(s, p: Principal) -> dict:
    # REM-001: tenant scope. The team/event lookup is constrained by the
    # server-derived principal tenant_id so a participant in tenant A can never
    # resolve or read another tenant's team/event. require_team_in_tenant /
    # require_event_in_tenant are the canonical helpers; here the join already
    # carries tenant_id on app.events, so we add the predicate directly and the
    # dedicated endpoints below additionally re-verify via the helpers.
    row = (
        s.execute(
            text(
                "SELECT tm.team_id, t.name AS team_name, t.event_id, t.status AS team_status, "
                "e.tenant_id, e.status AS event_status, e.config AS event_config "
                "FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                "JOIN app.events e ON e.id = t.event_id "
                "WHERE tm.user_id = CAST(:u AS uuid) AND e.tenant_id = CAST(:tid AS uuid) LIMIT 1"
            ),
            {"u": p.id, "tid": p.tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise ApiError("AUTH_FORBIDDEN", message="You are not assigned to a team for this event.")
    return dict(row)


def _configured_max_points(config: dict | None) -> float | None:
    value = (config or {}).get("max_points")
    if value is None:
        return None
    try:
        points = float(value)
    except (TypeError, ValueError):
        return None
    return points if math.isfinite(points) and points >= 0 else None


def _require_live_event(member: dict) -> None:
    if member["event_status"] not in ("ready", "live", "closed", "finalized"):
        raise ApiError("LEVEL_NOT_OPEN", message="The event is not running yet.")


def _require_released_stage_content(s, member: dict, p: Principal, level_no: int | None = None) -> None:
    """REM-014: content gate for repo tree/file/content routes.

    Challenge bytes must NOT be served while a stage is merely *armed* but its
    start time has not passed. The gate requires ``stage.status == 'active'``
    AND ``db_now(s) >= stage.starts_at``. An armed-but-not-started stage returns
    ``KEY_NOT_AVAILABLE`` (425) so clients can retry-after. A NULL starts_at is
    a closed gate, never an open one. The clock is read from PostgreSQL in the
    same transaction (TIM-01/02).
    """
    event_id = str(member["event_id"])
    if level_no is None:
        ptr = flow.get_pointer(s, p.id)
        level_no = int(ptr["level_no"]) if ptr else 1
    stage = flow.level_stage(s, event_id, int(level_no))
    if stage is None:
        raise ApiError("NOT_FOUND", message="This level is not configured.")
    if stage["status"] != "active":
        # armed/draft/sealed/paused/ended/...: no content bytes before the
        # round is actually active. Armed-but-future-start is the 425 case.
        if stage["status"] == "armed":
            raise ApiError("KEY_NOT_AVAILABLE", message="The round has not started.")
        raise ApiError("KEY_NOT_AVAILABLE", message="Challenge content is not available yet.")
    if stage["starts_at"] is None:
        raise ApiError("KEY_NOT_AVAILABLE", message="The round start time is not set.")
    if db_now(s) < stage["starts_at"]:
        raise ApiError("KEY_NOT_AVAILABLE", message="The round has not started.")


def _safe_repo_path(path: str | None) -> str:
    """REM-024: reject unsafe repo file paths.

    A frozen repo path is an opaque key into ``app.challenge_files``; it must
    never escape the frozen repo root. We reject:
      * None / empty / non-str
      * any ``..`` segment (parent traversal)
      * a leading ``/`` (absolute path)
      * an embedded NUL byte
      * any segment containing ``\\`` or a C0 control character
    The DB read is parameterized already; this is the input boundary that keeps
    a malformed request from becoming a 500 (F-SEC-09 / F-ARA-07).
    """
    if not isinstance(path, str) or path == "":
        raise ApiError("PATH_INVALID")
    if "\x00" in path:
        raise ApiError("PATH_INVALID")
    if path.startswith("/"):
        raise ApiError("PATH_INVALID")
    segments = path.split("/")
    for seg in segments:
        if seg == "..":
            raise ApiError("PATH_INVALID")
        if seg == "":
            # empty segment from a leading/double slash — treat as invalid
            raise ApiError("PATH_INVALID")
        if "\\" in seg:
            raise ApiError("PATH_INVALID")
        if any(ord(ch) < 0x20 for ch in seg):
            raise ApiError("PATH_INVALID")
    return path


def _team_choice(s, team_id: str) -> dict | None:
    row = (
        s.execute(
            text(
                "SELECT c.option_key, c.challenge_version_id, c.locked_at, c.lock_source, c.idempotency_key, "
                "u.name AS locked_by_name, cv.title, cv.slug FROM app.team_repo_choices c "
                "LEFT JOIN app.users u ON u.id = c.locked_by "
                "JOIN app.challenge_versions cv ON cv.id = c.challenge_version_id "
                "WHERE c.team_id = CAST(:t AS uuid)"
            ),
            {"t": str(team_id)},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def _level_stage_for_event(s, event_id: str, level_no: int) -> dict:
    stage = flow.level_stage(s, event_id, level_no)
    if stage is None:
        raise ApiError("NOT_FOUND", message="This level is not configured.")
    return stage


def _challenge_of_choice(s, choice: dict) -> str:
    return str(choice["challenge_version_id"])


def _file_exists(s, challenge_version_id: str, path: str, max_line: int | None = None) -> int | None:
    """Return the file's line count when it exists in the frozen repo, else None."""
    row = s.execute(
        text("SELECT line_count FROM app.challenge_files WHERE challenge_version_id = CAST(:c AS uuid) AND path = :p"),
        {"c": challenge_version_id, "p": path},
    ).first()
    if row is None:
        return None
    return int(row[0])


def _validate_flag(s, flag: FlagIn, level_no: int, challenge_version_id: str, cfg: dict) -> dict:
    """Validate one flag against the frozen repo version. Returns canonical dict."""
    if not flag.title or len(flag.title.strip()) < 5:
        raise ApiError("SUBMISSION_INVALID", details={"title": "Required, 5-120 characters."})
    if len(flag.title) > 120:
        raise ApiError("SUBMISSION_INVALID", details={"title": "Required, 5-120 characters."})
    if not flag.description or len(flag.description.strip()) < 20:
        raise ApiError("SUBMISSION_INVALID", details={"description": "Required, at least 20 characters."})
    if flag.category not in CATEGORIES:
        raise ApiError("SUBMISSION_INVALID", details={"category": "Category must come from the taxonomy."})
    max_span = int(cfg.get("max_span", 25))
    if level_no == 1 and len(flag.locations) != 1:
        raise ApiError("LOCATION_INVALID", details={"locations": "Level 1 flags carry exactly one location."})
    if level_no == 2 and not (1 <= len(flag.locations) <= MAX_LOCATIONS):
        raise ApiError(
            "LOCATION_INVALID", details={"locations": f"Level 2 flags carry 1 to {MAX_LOCATIONS} ordered locations."}
        )
    if level_no >= 3:
        raise ApiError("SUBMISSION_INVALID", details={"flags": "Levels 3 and 4 submit artifacts, not flags."})
    canon_locations = []
    for loc in flag.locations:
        line_count = _file_exists(s, challenge_version_id, loc.file_path)
        if line_count is None:
            raise ApiError("FILE_NOT_FOUND", details={"file_path": loc.file_path})
        if loc.line_start > loc.line_end:
            raise ApiError("LOCATION_INVALID", details={"line_range": f"{loc.file_path}: start after end."})
        if loc.line_end - loc.line_start + 1 > max_span:
            raise ApiError("SUBMISSION_INVALID", details={"line_range": f"Span exceeds {max_span} lines."})
        if loc.line_end > max(line_count, 1) + int(cfg.get("location_tolerance_lines", 2)):
            raise ApiError("LOCATION_INVALID", details={"line_range": f"{loc.file_path}: range beyond end of file."})
        canon_locations.append({"file_path": loc.file_path, "line_start": loc.line_start, "line_end": loc.line_end})
    return {
        "title": flag.title.strip(),
        "category": flag.category,
        "claimed_severity": flag.claimed_severity,
        "description": flag.description,
        "evidence": flag.evidence,
        "locations": canon_locations,
        "file_path": canon_locations[0]["file_path"],
        "line_start": canon_locations[0]["line_start"],
        "line_end": canon_locations[0]["line_end"],
    }


# --- payload models -----------------------------------------------------------


class FlagLocation(BaseModel):
    file_path: str = Field(max_length=500)
    line_start: int = Field(ge=1, le=100000)
    line_end: int = Field(ge=1, le=100000)


class FlagIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    category: str
    description: str = Field(min_length=1, max_length=2000)
    evidence: str | None = Field(default=None, max_length=2000)
    claimed_severity: str | None = Field(default=None, pattern="^(low|medium|high|critical)$")
    locations: list[FlagLocation] = Field(default_factory=list, max_length=MAX_LOCATIONS)


class LevelSubmitIn(BaseModel):
    flags: list[FlagIn] = Field(default_factory=list, max_length=24)
    confirm_empty: bool = False
    artifact_id: str | None = None
    compute_diff: bool = False


class RepoLockIn(BaseModel):
    option: str = Field(min_length=1, max_length=10)
    confirm: bool


class DraftIn(BaseModel):
    payload: dict
    version: int | None = None


# --- level catalog, gate, content ---------------------------------------------


@router.get("/levels")
def list_levels(p: Principal = Depends(get_principal)):
    require_rules_accepted(p)
    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        flow.init_participant_flow(s, str(member["event_id"]), p.id)
        rows = (
            s.execute(
                text(
                    "SELECT id, ordinal, name, status, starts_at, ends_at, grace_seconds, config FROM app.stages "
                    "WHERE event_id = CAST(:e AS uuid) AND kind = 'level' ORDER BY ordinal"
                ),
                {"e": str(member["event_id"])},
            )
            .mappings()
            .all()
        )
        ptr = flow.get_pointer(s, p.id)
        progress = {r["level_no"]: r["status"] for r in flow.get_all_progress(s, p.id)}
        now = db_now(s)
        levels = []
        for r in rows:
            gate = flow.compute_gate(s, str(member["event_id"]), p.id, str(member["team_id"]), int(r["ordinal"]), now)
            levels.append(
                {
                    "level_no": int(r["ordinal"]),
                    "name": r["name"],
                    "stage_id": str(r["id"]),
                    "status": r["status"],
                    "starts_at": r["starts_at"].isoformat() if r["starts_at"] else None,
                    "ends_at": r["ends_at"].isoformat() if r["ends_at"] else None,
                    "grace_seconds": r["grace_seconds"],
                    "max_points": _configured_max_points(r["config"]),
                    "gate_allowed": gate["allowed"],
                    "gate_reason": gate["reason"],
                    "participant_status": progress.get(int(r["ordinal"]), "locked"),
                }
            )
    return {
        "levels": levels,
        "pointer": {"level_no": ptr["level_no"], "node": ptr["node"]} if ptr else None,
    }


@router.get("/levels/{level_no}/gate")
def level_gate(level_no: int, p: Principal = Depends(get_principal)):
    require_rules_accepted(p)
    if not 1 <= level_no <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        flow.init_participant_flow(s, str(member["event_id"]), p.id)
        now = db_now(s)
        gate = flow.compute_gate(s, str(member["event_id"]), p.id, str(member["team_id"]), level_no, now)
    return gate


@router.get("/levels/{level_no}/content")
def level_content(level_no: int, p: Principal = Depends(get_principal)):
    """Explanation-node content. Reading is allowed while the event runs;
    entering the execution workspace is what enforces the gate."""
    require_rules_accepted(p)
    rate_limit(f"level_content:{p.id}", limit=60, window_s=60)
    if not 1 <= level_no <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        flow.init_participant_flow(s, str(member["event_id"]), p.id)
        stage = _level_stage_for_event(s, str(member["event_id"]), level_no)
        cfg = stage["config"] or {}
        now = db_now(s)
        gate = flow.compute_gate(s, str(member["event_id"]), p.id, str(member["team_id"]), level_no, now)
        choice = _team_choice(s, str(member["team_id"]))
        challenge_id = _challenge_of_choice(s, choice) if choice else None
        instructions = None
        if challenge_id:
            row = s.execute(
                text("SELECT instructions_md, title FROM app.challenge_versions WHERE id = CAST(:c AS uuid)"),
                {"c": challenge_id},
            ).first()
            instructions = row[0] if row else None
        eff_end = flow._effective_end(s, stage, p.id)
        content_md = cfg.get("explain_md") or ""
        ptr = flow.get_pointer(s, p.id)
        return {
            "level_no": level_no,
            "stage_id": str(stage["id"]),
            "stage_status": stage["status"],
            "gate": gate,
            "explain_markdown": content_md,
            "instructions_markdown": instructions,
            "title": cfg.get("explain_title") or stage["name"],
            "starts_at": stage["starts_at"].isoformat() if stage["starts_at"] else None,
            "ends_at_effective": eff_end.isoformat() if eff_end else None,
            "grace_seconds": stage["grace_seconds"],
            "repo_option": {"option_key": choice["option_key"], "title": choice["title"]} if choice else None,
            "pointer": {"level_no": ptr["level_no"], "node": ptr["node"]} if ptr else None,
            "is_lead": flow.is_team_lead(s, str(member["team_id"]), p.id),
            "repo_options": _public_repo_options(s, str(member["event_id"])),
        }


def _public_repo_options(s, event_id: str) -> list[dict]:
    rows = (
        s.execute(
            text(
                "SELECT option_key, label, description FROM app.repo_options WHERE event_id = CAST(:e AS uuid) ORDER BY option_key"
            ),
            {"e": event_id},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


# --- workspace entry (exec node) ----------------------------------------------


@router.get("/levels/{level_no}/workspace")
def level_workspace(level_no: int, p: Principal = Depends(get_principal)):
    """Enter the execution node. Enforces the gate server-side and advances
    the pointer explain -> exec (forward only)."""
    require_rules_accepted(p)
    rate_limit(f"level_ws:{p.id}", limit=60, window_s=60)
    if not 1 <= level_no <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        flow.init_participant_flow(s, str(member["event_id"]), p.id)
        now = db_now(s)
        flow.require_gate(s, str(member["event_id"]), p.id, str(member["team_id"]), level_no, now)
        stage = _level_stage_for_event(s, str(member["event_id"]), level_no)
        ptr = flow.get_pointer_for_update(s, p.id)
        assert ptr is not None
        if int(ptr["level_no"]) != level_no:
            raise ApiError(
                "LEVEL_ALREADY_SUBMITTED" if int(ptr["level_no"]) > level_no else "LEVEL_NOT_OPEN",
                message="Your current node is another level.",
            )
        if str(ptr["node"]) == "explain":
            flow.advance_pointer(s, p.id, level_no, "exec")
            flow.set_level_status(s, p.id, level_no, "in_progress")
        elif str(ptr["node"]) == "done":
            raise ApiError("LEVEL_ALREADY_SUBMITTED")
        choice = _team_choice(s, str(member["team_id"]))
        if choice is None:
            raise ApiError("REPO_NOT_LOCKED")
        challenge_id = _challenge_of_choice(s, choice)
        files = (
            s.execute(
                text(
                    "SELECT path, lang, size_bytes, line_count FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:c AS uuid) ORDER BY path"
                ),
                {"c": challenge_id},
            )
            .mappings()
            .all()
        )
        draft = (
            s.execute(
                text(
                    "SELECT payload, version, updated_at FROM app.level_drafts "
                    "WHERE author_id = CAST(:u AS uuid) AND level_no = :l"
                ),
                {"u": p.id, "l": level_no},
            )
            .mappings()
            .first()
        )
        eff_end = flow._effective_end(s, stage, p.id)
        cfg = stage["config"] or {}
    return {
        "level_no": level_no,
        "stage_id": str(stage["id"]),
        "editable": level_no >= 3,
        "repo_option": {"option_key": choice["option_key"], "title": choice["title"]},
        "challenge_id": challenge_id,
        "files": [dict(f) for f in files],
        "draft": {
            "payload": draft["payload"],
            "version": draft["version"],
            "updated_at": draft["updated_at"].isoformat(),
        }
        if draft
        else {"payload": {}, "version": 0, "updated_at": None},
        "ends_at_effective": eff_end.isoformat() if eff_end else None,
        "grace_seconds": stage["grace_seconds"],
        "limits": {
            "max_span": cfg.get("max_span", 25),
            "max_flags": cfg.get("max_flags_per_level", 12),
            "max_locations": MAX_LOCATIONS if level_no == 2 else 1,
        },
    }


# --- drafts --------------------------------------------------------------------


@router.get("/levels/{level_no}/draft")
def get_level_draft(level_no: int, p: Principal = Depends(get_principal)):
    require_rules_accepted(p)
    if not 1 <= level_no <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    with app_session() as s:
        _member(s, p)  # membership gate: drafts never exist without a team
        row = (
            s.execute(
                text(
                    "SELECT payload, version, updated_at FROM app.level_drafts "
                    "WHERE author_id = CAST(:u AS uuid) AND level_no = :l"
                ),
                {"u": p.id, "l": level_no},
            )
            .mappings()
            .first()
        )
    if row is None:
        return {"payload": {}, "version": 0, "updated_at": None}
    return {"payload": row["payload"], "version": row["version"], "updated_at": row["updated_at"].isoformat()}


@router.put("/levels/{level_no}/draft")
def put_level_draft(level_no: int, body: DraftIn, p: Principal = Depends(get_principal)):
    require_rules_accepted(p)
    if not 1 <= level_no <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    with app_session() as s:
        member = _member(s, p)
        ptr = flow.get_pointer(s, p.id)
        if ptr is None or int(ptr["level_no"]) != level_no:
            raise ApiError(
                "LEVEL_ALREADY_SUBMITTED" if ptr is not None and int(ptr["level_no"]) > level_no else "LEVEL_NOT_OPEN",
                message="Drafts are only accepted for your current level.",
            )
        row = s.execute(
            text(
                "SELECT version FROM app.level_drafts WHERE author_id = CAST(:u AS uuid) AND level_no = :l FOR UPDATE"
            ),
            {"u": p.id, "l": level_no},
        ).first()
        payload = jsonlib.dumps(body.payload, default=str)
        if row is None:
            s.execute(
                text(
                    "INSERT INTO app.level_drafts (id, author_id, event_id, level_no, payload, version) "
                    "VALUES (CAST(:id AS uuid), CAST(:u AS uuid), CAST(:e AS uuid), :l, CAST(:p AS jsonb), 1)"
                ),
                {"id": str(uuid7()), "u": p.id, "e": str(member["event_id"]), "l": level_no, "p": payload},
            )
            return {"version": 1}
        if body.version is not None and int(body.version) != int(row[0]):
            raise ApiError("DRAFT_VERSION_CONFLICT")
        s.execute(
            text(
                "UPDATE app.level_drafts SET payload = CAST(:p AS jsonb), version = version + 1, updated_at = now() "
                "WHERE author_id = CAST(:u AS uuid) AND level_no = :l"
            ),
            {"p": payload, "u": p.id, "l": level_no},
        )
        return {"version": int(row[0]) + 1}


# --- repo lock -----------------------------------------------------------------


@router.post("/team/repo-lock")
def repo_lock(
    body: RepoLockIn,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=80),
    p: Principal = Depends(get_principal),
):
    require_rules_accepted(p)
    if body.confirm is not True:
        raise ApiError("VALIDATION_ERROR", details={"confirm": "The irreversible-lock acknowledgement is required."})
    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        event_id = str(member["event_id"])
        team_id = str(member["team_id"])
        if not flow.is_team_lead(s, team_id, p.id):
            raise ApiError("AUTH_FORBIDDEN", message="Only the team lead can lock the repository option.")
        # idempotent replay: same key returns the existing choice
        existing = s.execute(
            text("SELECT id FROM app.team_repo_choices WHERE team_id = CAST(:t AS uuid)"),
            {"t": team_id},
        ).first()
        if existing is not None:
            choice = _team_choice(s, team_id)
            assert choice is not None
            if str(choice.get("idempotency_key") or "") == idempotency_key:
                if str(choice["option_key"]) != body.option:
                    # same key, different payload: idempotency conflict (spec 7.1)
                    raise ApiError("IDEMPOTENCY_CONFLICT")
                return _choice_response(s, team_id, replay=True)
            raise ApiError("REPO_ALREADY_LOCKED", details={"option": choice["option_key"]})
        option = (
            s.execute(
                text(
                    "SELECT challenge_version_id, label FROM app.repo_options "
                    "WHERE event_id = CAST(:e AS uuid) AND option_key = :k"
                ),
                {"e": event_id, "k": body.option},
            )
            .mappings()
            .first()
        )
        if option is None:
            raise ApiError("VALIDATION_ERROR", details={"option": "Unknown repository option."})
        try:
            s.execute(
                text(
                    "INSERT INTO app.team_repo_choices (id, event_id, team_id, option_key, challenge_version_id, "
                    "locked_by, idempotency_key, lock_source) "
                    "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), CAST(:t AS uuid), :k, CAST(:cv AS uuid), "
                    "CAST(:u AS uuid), :idem, 'lead')"
                ),
                {
                    "id": str(uuid7()),
                    "e": event_id,
                    "t": team_id,
                    "k": body.option,
                    "cv": str(option["challenge_version_id"]),
                    "u": p.id,
                    "idem": idempotency_key,
                },
            )
        except IntegrityError:
            # concurrent lock: exactly one choice wins through UNIQUE(team_id)
            s.rollback()
            choice = _team_choice(s, team_id)
            if choice is not None and str(choice.get("option_key")) == body.option:
                return _choice_response(s, team_id, replay=True)
            raise ApiError(
                "REPO_ALREADY_LOCKED", details={"option": choice["option_key"] if choice else None}
            ) from None
        # team-scoped assignments for every level stage
        s.execute(
            text(
                "INSERT INTO app.assignments (id, event_id, stage_id, challenge_version_id, team_id) "
                "SELECT gen_random_uuid(), e.id, st.id, CAST(:cv AS uuid), CAST(:t AS uuid) "
                "FROM app.stages st JOIN app.events e ON e.id = st.event_id "
                "WHERE st.event_id = CAST(:e AS uuid) AND st.kind = 'level' "
                "AND NOT EXISTS (SELECT 1 FROM app.assignments a WHERE a.stage_id = st.id AND a.team_id = CAST(:t AS uuid))"
            ),
            {"e": event_id, "cv": str(option["challenge_version_id"]), "t": team_id},
        )
        # open Level 1 for every member
        s.execute(
            text(
                "UPDATE app.participant_progress SET status = 'available', updated_at = now() "
                "WHERE level_no = 1 AND status = 'locked' AND user_id IN "
                "(SELECT user_id FROM app.team_members WHERE team_id = CAST(:t AS uuid))"
            ),
            {"t": team_id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="repo.locked",
            entity_type="team",
            entity_id=team_id,
            request_id=request.state.request_id,
            details={"option": body.option, "challenge_version_id": str(option["challenge_version_id"])},
            event_scope=f"event:{event_id}",
        )
        response = _choice_response(s, team_id, replay=False)
    return response


def _choice_response(s, team_id: str, *, replay: bool) -> dict:
    choice = _team_choice(s, team_id)
    if choice is None:
        raise ApiError("NOT_FOUND")
    return {
        "option": choice["option_key"],
        "title": choice["title"],
        "locked_at": choice["locked_at"].isoformat() if choice["locked_at"] else None,
        "locked_by": choice["locked_by_name"],
        "replay": replay,
    }


@router.get("/team")
def my_team(p: Principal = Depends(get_principal)):
    with app_session() as s:
        member = _member(s, p)
        # REM-001: re-verify team/event belong to the caller's tenant (defense in depth).
        require_team_in_tenant(s, str(member["team_id"]), p.tenant_id)
        require_event_in_tenant(s, str(member["event_id"]), p.tenant_id)
        team_id = str(member["team_id"])
        members = flow.teammate_view(s, team_id)
        choice = _team_choice(s, team_id)
        lead_id_row = s.execute(
            text("SELECT user_id FROM app.team_members WHERE team_id = CAST(:t AS uuid) AND is_lead LIMIT 1"),
            {"t": team_id},
        ).first()
        lead_id = str(lead_id_row[0]) if lead_id_row else None
        is_lead = (p.id == lead_id) if lead_id else flow.is_team_lead(s, team_id, p.id)
    return {
        "team_id": team_id,
        "team_name": member["team_name"],
        "event_id": str(member["event_id"]),
        "is_lead": is_lead,
        "repo_option": choice,
        "members": [
            {
                "id": m["id"],
                "name": m["name"],
                "is_lead": str(m["id"]) == lead_id,
                "levels": {"1": m["l1"], "2": m["l2"], "3": m["l3"], "4": m["l4"]},
                "pointer": {"level_no": m["pointer_level"], "node": m["pointer_node"]} if m["pointer_level"] else None,
            }
            for m in members
        ],
    }


@router.get("/team/score")
def team_score(p: Principal = Depends(get_principal)):
    with app_session() as s:
        member = _member(s, p)
        # REM-001: re-verify team/event belong to the caller's tenant (defense in depth).
        require_team_in_tenant(s, str(member["team_id"]), p.tenant_id)
        require_event_in_tenant(s, str(member["event_id"]), p.tenant_id)
        team_id = str(member["team_id"])
        event_id = str(member["event_id"])
        stages = (
            s.execute(
                text(
                    "SELECT id, ordinal, name, config FROM app.stages "
                    "WHERE event_id = CAST(:e AS uuid) AND kind = 'level' ORDER BY ordinal"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
        # REM-009: feedback release is authoritative per stage (the
        # release_feedback worker flips app.submissions.feedback_released for
        # every submission of the stage). Only stages whose feedback has been
        # released may expose points/components below; unreleased stages are
        # redacted to status metadata so this endpoint cannot act as a
        # verdict oracle while evaluation is still running (F-BSP-01).
        released_by_stage = {
            str(r["stage_id"]): bool(r["released"])
            for r in s.execute(
                text(
                    "SELECT s.stage_id, COALESCE(BOOL_OR(s.feedback_released), false) AS released FROM app.submissions s "
                    "JOIN app.stages st ON st.id = s.stage_id "
                    "WHERE s.team_id = CAST(:t AS uuid) AND st.event_id = CAST(:e AS uuid) AND st.kind = 'level' "
                    "GROUP BY s.stage_id"
                ),
                {"t": team_id, "e": event_id},
            )
            .mappings()
            .all()
        }
        rows = (
            s.execute(
                text(
                    "SELECT st.id AS stage_id, st.ordinal AS level_no, st.name, l.component, SUM(l.points) AS points "
                    "FROM app.score_ledger_entries l JOIN app.stages st ON st.id = l.stage_id "
                    "WHERE l.team_id = CAST(:t AS uuid) AND st.event_id = CAST(:e AS uuid) AND st.kind = 'level' "
                    "GROUP BY st.id, st.ordinal, st.name, l.component ORDER BY st.ordinal"
                ),
                {"t": team_id, "e": event_id},
            )
            .mappings()
            .all()
        )
        evaluations = {
            r["stage_id"]: r
            for r in s.execute(
                text(
                    "SELECT st.id AS stage_id, COUNT(s.id) AS submission_count, "
                    "COALESCE(BOOL_OR("
                    "EXISTS (SELECT 1 FROM app.jobs j WHERE j.payload ->> 'submission_id' = s.id::text "
                    "AND j.status IN ('queued', 'running', 'dead')) OR "
                    "EXISTS (SELECT 1 FROM app.review_items r WHERE r.submission_id = s.id AND r.status <> 'decided') OR "
                    "s.status IN ('needs_review', 'in_review')"
                    "), false) AS evaluating "
                    "FROM app.stages st LEFT JOIN app.submissions s "
                    "ON s.stage_id = st.id AND s.team_id = CAST(:t AS uuid) "
                    "WHERE st.event_id = CAST(:e AS uuid) AND st.kind = 'level' GROUP BY st.id"
                ),
                {"t": team_id, "e": event_id},
            )
            .mappings()
            .all()
        }
    by_level: dict[int, dict] = {}
    total = 0.0
    for stage in stages:
        level_no = int(stage["ordinal"])
        evaluation = evaluations.get(stage["id"], {})
        submission_count = int(evaluation.get("submission_count") or 0)
        evaluation_status = "not_submitted"
        if submission_count:
            evaluation_status = "evaluating" if evaluation.get("evaluating") else "complete"
        released = bool(released_by_stage.get(str(stage["id"]), False))
        by_level[level_no] = {
            "level_no": level_no,
            "name": stage["name"],
            "components": {},
            "total": 0.0 if released else None,
            "points": 0.0 if released else None,
            "score": 0.0 if released else None,
            "max_points": _configured_max_points(stage["config"]),
            "evaluation_status": evaluation_status,
            "released": released,
        }
    for r in rows:
        lvl = by_level[int(r["level_no"])]
        if not lvl["released"]:
            continue  # REM-009: no point-bearing fields before that stage's release
        points = float(r["points"])
        lvl["components"][r["component"]] = points
        lvl["total"] += points
    for lvl in by_level.values():
        if not lvl["released"]:
            continue
        lvl["points"] = lvl["total"]
        lvl["score"] = sum(points for component, points in lvl["components"].items() if component != "ctf_bonus")
        total += lvl["total"]
    event_released = member["event_status"] in ("closed", "finalized")
    released_any = any(lvl["released"] for lvl in by_level.values())
    return {
        "team_id": team_id,
        "levels": list(by_level.values()),
        "total": total if released_any else None,
        "points": total if released_any else None,
        "released": event_released,
        "released_total": total if event_released else None,
    }


# --- progress ------------------------------------------------------------------


@router.get("/progress")
def my_progress(p: Principal = Depends(get_principal)):
    require_rules_accepted(p)
    with app_session() as s:
        member = _member(s, p)
        # REM-001: re-verify team/event belong to the caller's tenant (defense in depth).
        require_team_in_tenant(s, str(member["team_id"]), p.tenant_id)
        require_event_in_tenant(s, str(member["event_id"]), p.tenant_id)
        _require_live_event(member)
        flow.init_participant_flow(s, str(member["event_id"]), p.id)
        ptr = flow.get_pointer(s, p.id)
        progress = flow.get_all_progress(s, p.id)
        teammates = flow.teammate_view(s, str(member["team_id"]))
        choice = _team_choice(s, str(member["team_id"]))
        now = db_now(s)
        gates = {
            n: flow.compute_gate(s, str(member["event_id"]), p.id, str(member["team_id"]), n, now)
            for n in range(1, flow.LEVEL_COUNT + 1)
        }
    return {
        "pointer": {"level_no": ptr["level_no"], "node": ptr["node"]} if ptr else None,
        "levels": [
            {
                "level_no": r["level_no"],
                "status": r["status"],
                "gate": gates[int(r["level_no"])],
            }
            for r in progress
        ],
        "teammates": [
            {
                "name": t["name"],
                "levels": {"1": t["l1"], "2": t["l2"], "3": t["l3"], "4": t["l4"]},
            }
            for t in teammates
        ],
        "repo_option": {"option_key": choice["option_key"], "title": choice["title"]} if choice else None,
    }


# --- repo file delivery (read-only, team-scoped) --------------------------------

# REM-015 (DEFERRED): per-team encrypted pre-delivery, timed key release and
# content watermarking are a v2 fairness feature, NOT implemented here. Repo
# files are served as ordinary plaintext bytes behind the starts_at/content
# gate (REM-014) and team assignment. A future version will: (1) build a per-
# team bundle manifest (file hashes, ordered paths, nonce/AAD, watermark
# marker) bound to event/team/challenge/version; (2) AEAD-encrypt each bundle
# (AES-256-GCM, unique nonce) and store ciphertext separately from the key;
# (3) expose a no-store key-release endpoint that checks stage.starts_at via DB
# time, team membership, rate limit, replay/expiry and audit before releasing
# the key (pre-T0 must return KEY_NOT_AVAILABLE / 425); (4) add per-team file
# ordering randomization and watermark attribution tooling. Do NOT implement
# crypto in this file without that design. (F-BSP-06 / F-B02B-06 / F-ARB-13.)


def _readable_level(s, p: Principal, member: dict, requested: int | None) -> int:
    ptr = flow.get_pointer(s, p.id)
    if ptr is None:
        flow.init_participant_flow(s, str(member["event_id"]), p.id)
        ptr = flow.get_pointer(s, p.id)
    assert ptr is not None
    level = int(ptr["level_no"]) if requested is None else int(requested)
    if not 1 <= level <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    if level > int(ptr["level_no"]):
        raise ApiError("LEVEL_NOT_OPEN", message="That level has not opened for your team yet.")
    return level


@router.get("/repo/tree")
def repo_tree(
    level: int | None = Query(default=None, ge=1, le=flow.LEVEL_COUNT), p: Principal = Depends(get_principal)
):
    require_rules_accepted(p)
    rate_limit(f"repo_tree:{p.id}", limit=60, window_s=60)
    with app_session() as s:
        member = _member(s, p)
        # REM-001: re-verify team/event belong to the caller's tenant (defense in depth).
        require_team_in_tenant(s, str(member["team_id"]), p.tenant_id)
        require_event_in_tenant(s, str(member["event_id"]), p.tenant_id)
        _require_live_event(member)
        _require_released_stage_content(s, member, p)  # REM-014: stage start-time gate on content routes
        lvl = _readable_level(s, p, member, level)
        choice = _team_choice(s, str(member["team_id"]))
        if choice is None:
            raise ApiError("REPO_NOT_LOCKED")
        files = (
            s.execute(
                text(
                    "SELECT path, lang, size_bytes, line_count FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:c AS uuid) ORDER BY path"
                ),
                {"c": str(choice["challenge_version_id"])},
            )
            .mappings()
            .all()
        )
    return {"level_no": lvl, "repo_option": choice["option_key"], "files": [dict(f) for f in files]}


@router.get("/repo/files/{path:path}")
def repo_file(
    path: str,
    level: int | None = Query(default=None, ge=1, le=flow.LEVEL_COUNT),
    p: Principal = Depends(get_principal),
):
    require_rules_accepted(p)
    rate_limit(f"repo_file:{p.id}", limit=120, window_s=60)
    # REM-024: enforce path safety before any DB read. os.path.normpath is no
    # longer trusted as the sole guard; the explicit segment checks reject
    # traversal, absolute, NUL, backslash and control characters.
    norm = _safe_repo_path(path)
    with app_session() as s:
        member = _member(s, p)
        # REM-001: re-verify team/event belong to the caller's tenant (defense in depth).
        require_team_in_tenant(s, str(member["team_id"]), p.tenant_id)
        require_event_in_tenant(s, str(member["event_id"]), p.tenant_id)
        _require_live_event(member)
        lvl = _readable_level(s, p, member, level)
        _require_released_stage_content(s, member, p, lvl)  # REM-014: stage start-time gate
        choice = _team_choice(s, str(member["team_id"]))
        if choice is None:
            raise ApiError("REPO_NOT_LOCKED")
        f = (
            s.execute(
                text(
                    "SELECT path, lang, content, line_count, sha256 FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:c AS uuid) AND path = :p"
                ),
                {"c": str(choice["challenge_version_id"]), "p": norm},
            )
            .mappings()
            .first()
        )
    if f is None:
        raise ApiError("FILE_NOT_FOUND")
    return {
        "path": f["path"],
        "lang": f["lang"],
        "content": f["content"],
        "line_count": f["line_count"],
        "sha256": f["sha256"],
        "level_no": lvl,
        "editable": lvl >= 3,
    }


# --- uploads (Levels 3-4 artifacts) ---------------------------------------------
#
# REM-045 (upload lifecycle + DEFERRED object storage):
# Artifact storage today is the local-filesystem adapter in app.storage; this is
# a D0 limitation. The intended lifecycle is staged -> used (bound to a
# submission) -> abandoned, where:
#   * staged    = uploaded, validated, not yet bound to a submission (the only
#                 state in which a participant may delete/replace it);
#   * used      = bound to a submission (status='submitted' in the current
#                 schema; metadata is retained immutably after submit);
#   * abandoned = staged but never submitted past the level window — must be
#                 reaped by a cleanup job and the storage object deleted.
# NOTE: the submission_artifacts.status CHECK constraint in migration 0003 only
# allows ('staged','submitted'); adding 'abandoned'/'used' requires a migration
# the orchestrator must own. Until then, abandoned staging is tracked via the
# staged row + created_at and the cleanup job (also orchestrator-owned); the
# code-side lifecycle is documented here. A staged-artifact GET/status/delete
# endpoint surface and a per-participant/team quota check are likewise
# orchestrator-owned follow-ups.
# DEFERRED: migrate to S3-compatible private object storage with server-side
# encryption, lifecycle cleanup and content-hash verification; keep object keys
# non-public. This is a v2 migration, not implemented here. (F-ARA-05 /
# F-B02B-08 / F-B02A-20 / F-AG07-09 / F-BSP-16.)


@router.post("/uploads")
def upload_artifact(
    level: int = Query(..., ge=1, le=flow.LEVEL_COUNT),
    file: UploadFile = File(...),
    p: Principal = Depends(get_principal),
):
    require_rules_accepted(p)
    rate_limit(f"upload:{p.id}", limit=20, window_s=60)
    # REM-061 (MANUAL-REVALIDATION): the artifact upload contract (allowed
    # kinds, max_upload_bytes, entry_count/uncompressed_bytes limits, zip
    # expansion ratio, filename/path constraints) needs boundary contract tests
    # at min/max and one above/below, mapped to docs/API_REFERENCE.md and the
    # four-level model. Not added here; require manual revalidation.
    from ..config import settings

    filename = os.path.basename(file.filename or "artifact")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("zip", "diff", "patch"):
        raise ApiError("ARTIFACT_INVALID", details={"filename": "Only .zip, .diff and .patch are accepted."})
    # REM-024: cap the upload via the streaming read, not only Content-Length.
    # Reading max_upload_bytes + 1 and rejecting when the cap is exceeded covers
    # chunked / missing Content-Length bodies identically (F-SEC-09 / F-ARA-07).
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) == 0:
        raise ApiError("ARTIFACT_INVALID", details={"file": "Empty upload."})
    if len(data) > settings.max_upload_bytes:
        raise ApiError("ARTIFACT_INVALID", details={"file": "Upload exceeds the size limit."})
    kind = ext
    meta = {"entry_count": 0, "uncompressed_bytes": 0}
    if kind == "zip":
        meta = storage.inspect_zip(data)
    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        ptr = flow.get_pointer_for_update(s, p.id)
        if ptr is None or int(ptr["level_no"]) != level:
            raise ApiError(
                "LEVEL_ALREADY_SUBMITTED" if ptr is not None and int(ptr["level_no"]) > level else "LEVEL_NOT_OPEN"
            )
        # a submitted level cannot accept new artifacts (immutability, spec 4.5)
        st = flow.get_level_status(s, p.id, level)
        if st in flow.DONE_STATUSES:
            raise ApiError("LEVEL_ALREADY_SUBMITTED")
        saved = storage.save(p.id, level, kind, filename, data)
        artifact_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.submission_artifacts (id, owner_id, event_id, level_no, kind, filename, sha256, "
                "size_bytes, entry_count, uncompressed_bytes, storage_key, status) "
                "VALUES (CAST(:id AS uuid), CAST(:o AS uuid), CAST(:e AS uuid), :l, :k, :fn, :sha, :sz, :ec, :ub, :sk, 'staged')"
            ),
            {
                "id": artifact_id,
                "o": p.id,
                "e": str(member["event_id"]),
                "l": level,
                "k": kind,
                "fn": saved["filename"],
                "sha": saved["sha256"],
                "sz": saved["size_bytes"],
                "ec": meta["entry_count"],
                "ub": meta["uncompressed_bytes"],
                "sk": saved["storage_key"],
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="artifact.staged",
            entity_type="artifact",
            entity_id=artifact_id,
            request_id="-",
            details={"level": level, "kind": kind, "sha256": saved["sha256"][:16]},
            event_scope=f"event:{member['event_id']}",
        )
    return {
        "artifact_id": artifact_id,
        "kind": kind,
        "filename": saved["filename"],
        "sha256": saved["sha256"],
        "size_bytes": saved["size_bytes"],
        "entry_count": meta["entry_count"],
        "level_no": level,
        "status": "staged",
    }


# --- level submission (the durable, idempotent final act) ------------------------


@router.post("/levels/{level_no}/submit", status_code=202)
def submit_level(
    level_no: int,
    body: LevelSubmitIn,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=80),
    p: Principal = Depends(get_principal),
):
    require_rules_accepted(p)
    rate_limit(f"level_submit:{p.id}", limit=10, window_s=60)
    if not 1 <= level_no <= flow.LEVEL_COUNT:
        raise ApiError("NOT_FOUND")
    payload_hash = security.canonical_payload_hash(body.model_dump())

    with app_session() as s:
        member = _member(s, p)
        _require_live_event(member)
        if member["team_status"] != "active":
            raise ApiError("AUTH_FORBIDDEN", message="This team cannot submit.")
        event_id = str(member["event_id"])
        team_id = str(member["team_id"])
        flow.init_participant_flow(s, event_id, p.id)

        # --- idempotency reservation (same contract as the v1 flow) ----------
        existing = (
            s.execute(
                text(
                    "SELECT id, receipt_code, received_at, status, payload_hash FROM app.submissions "
                    "WHERE author_id = CAST(:u AS uuid) AND idempotency_key = :k"
                ),
                {"u": p.id, "k": idempotency_key},
            )
            .mappings()
            .first()
        )
        if existing is not None:
            if existing["payload_hash"] != payload_hash:
                raise ApiError("IDEMPOTENCY_CONFLICT")
            return {
                "submission_id": str(existing["id"]),
                "receipt_code": existing["receipt_code"],
                "received_at": existing["received_at"].isoformat(),
                "status": "received",
                "replay": True,
                "level_no": level_no,
            }

        # --- lock the pointer, then the stage row, then read the clock once ---
        # REM-057: defense-in-depth. The progress pointer is the serialization
        # point for submit; it is read with FOR UPDATE via
        # flow.get_pointer_for_update (SELECT ... FOR UPDATE on
        # app.participant_pointers) so concurrent submissions for the same
        # author block at the row lock and converge. The stage row is then
        # locked FOR UPDATE before the acceptance clock is read once. The repo
        # file path read in /repo/files uses parameterized bind params (:p), so
        # it is not injectable. (F-B02A-22 / F-CKLA-31.)
        ptr = flow.get_pointer_for_update(s, p.id)
        assert ptr is not None
        if int(ptr["level_no"]) > level_no or (int(ptr["level_no"]) == level_no and str(ptr["node"]) == "done"):
            raise ApiError("LEVEL_ALREADY_SUBMITTED")
        if int(ptr["level_no"]) < level_no:
            raise ApiError("LEVEL_NOT_OPEN", message="Your current node is an earlier level.")
        stage = _level_stage_for_event(s, event_id, level_no)
        s.execute(text("SELECT id FROM app.stages WHERE id = CAST(:s AS uuid) FOR UPDATE"), {"s": str(stage["id"])})
        now = s.execute(text("SELECT clock_timestamp()")).scalar_one()  # the ONLY acceptance clock
        cfg = stage["config"] or {}

        # --- ordered state validation ----------------------------------------
        if stage["status"] == "paused":
            raise ApiError("ROUND_PAUSED")
        if stage["status"] not in ("armed", "active"):
            raise ApiError(
                "ROUND_ENDED" if stage["status"] in ("ended", "evaluating", "released", "final") else "LEVEL_NOT_OPEN"
            )
        eff_end = flow._effective_end(s, stage, p.id)
        grace = int(stage["grace_seconds"] or 0)
        if eff_end is not None and now > eff_end + timedelta(seconds=grace):
            raise ApiError("ROUND_ENDED")
        # authoritative gate re-check (teammates may still be working)
        if flow.get_level_status(s, p.id, level_no) not in ("in_progress", "available"):
            raise ApiError("LEVEL_ALREADY_SUBMITTED")

        choice = _team_choice(s, team_id)
        if choice is None:
            raise ApiError("REPO_NOT_LOCKED")
        challenge_version_id = str(choice["challenge_version_id"])

        # --- payload validation per level --------------------------------------
        canon_flags: list[dict] = []
        primary_file = primary_ls = primary_le = None
        artifact_meta: dict | None = None
        kind = "level_report" if level_no <= 2 else "level_artifact"
        if level_no <= 2:
            max_flags = int(cfg.get("max_flags_per_level", 12))
            if len(body.flags) > max_flags:
                raise ApiError("SUBMISSION_CAP_REACHED", details={"limit": max_flags})
            if len(body.flags) == 0 and body.confirm_empty is not True:
                raise ApiError(
                    "SUBMISSION_INVALID",
                    details={"flags": "Submitting zero flags needs the explicit empty-submission confirmation."},
                )
            for flag in body.flags:
                canon = _validate_flag(s, flag, level_no, challenge_version_id, cfg)
                canon_flags.append(canon)
            if canon_flags:
                primary_file = canon_flags[0]["file_path"]
                primary_ls = canon_flags[0]["line_start"]
                primary_le = canon_flags[0]["line_end"]
        else:
            if body.artifact_id:
                art = (
                    s.execute(
                        text(
                            "SELECT id, kind, filename, sha256, size_bytes, storage_key, status FROM app.submission_artifacts "
                            "WHERE id = CAST(:a AS uuid) AND owner_id = CAST(:u AS uuid) AND level_no = :l FOR UPDATE"
                        ),
                        {"a": body.artifact_id, "u": p.id, "l": level_no},
                    )
                    .mappings()
                    .first()
                )
                if art is None:
                    raise ApiError(
                        "ARTIFACT_INVALID", details={"artifact_id": "No such staged artifact for this level."}
                    )
                if art["status"] != "staged":
                    raise ApiError(
                        "ARTIFACT_INVALID", details={"artifact_id": "Artifact already bound to a submission."}
                    )
                artifact_meta = dict(art)
            elif body.compute_diff:
                diff = _compute_diff_from_draft(s, p.id, level_no, challenge_version_id)
                artifact_meta = _stage_computed_diff(s, member, p.id, level_no, diff)
            else:
                raise ApiError(
                    "ARTIFACT_REQUIRED",
                    details={"artifact": "Upload a .zip/.diff/.patch artifact or submit the computed draft diff."},
                )

        # --- insert submission, bind artifact, jobs, audit: ONE transaction ---
        submission_id = str(uuid7())
        receipt = security.receipt_code(submission_id, now)
        payload = {
            "level_no": level_no,
            "kind": kind,
            "flags": canon_flags,
            "confirm_empty": body.confirm_empty,
            "empty": len(canon_flags) == 0 if level_no <= 2 else (artifact_meta is None),
        }
        if artifact_meta is not None:
            payload["artifact"] = {
                "id": str(artifact_meta["id"]),
                "kind": artifact_meta["kind"],
                "filename": artifact_meta["filename"],
                "sha256": artifact_meta["sha256"],
                "size_bytes": int(artifact_meta["size_bytes"]),
                "storage_key": artifact_meta["storage_key"],
            }
        # REM-053: the pre-check SELECT above can race a concurrent same-key
        # insert. Wrap the INSERT in a savepoint and, on the (author_id,
        # idempotency_key) unique violation, replay the stored receipt instead
        # of surfacing a 500. Other IntegrityErrors are re-raised.
        # REM-061 (MANUAL-REVALIDATION): the field/shape contract for this
        # submit body (flags, locations, artifact metadata, span/size limits)
        # and the artifact upload below must be covered by boundary contract
        # tests at min/max and one above/below; these were not added here and
        # require manual revalidation against docs/API_REFERENCE.md and the
        # four-level model (F-CKLA-10 / F-S03B-13 / F-B02B-33).
        try:
            with s.begin_nested():
                s.execute(
                    text(
                        "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, "
                        "author_id, kind, idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, "
                        "line_start, line_end, received_at) "
                        "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:ev AS uuid), CAST(:st AS uuid), CAST(:cv AS uuid), "
                        "CAST(:team AS uuid), CAST(:au AS uuid), :kind, :idem, CAST(:payload AS jsonb), :ph, 'received', "
                        ":receipt, :title, :fp, :ls, :le, :received_at)"
                    ),
                    {
                        "id": submission_id,
                        "t": str(member["tenant_id"]),
                        "ev": event_id,
                        "st": str(stage["id"]),
                        "cv": challenge_version_id,
                        "team": team_id,
                        "au": p.id,
                        "kind": kind,
                        "idem": idempotency_key,
                        "payload": jsonlib.dumps(payload, default=str),
                        "ph": payload_hash,
                        "receipt": receipt,
                        "title": f"Level {level_no} submission",
                        "fp": primary_file,
                        "ls": primary_ls,
                        "le": primary_le,
                        "received_at": now,
                    },
                )
        except IntegrityError:
            # Savepoint was rolled back; the outer transaction is still usable.
            # Re-read by (author_id, idempotency_key) and replay. The unique
            # index is on (author_id, idempotency_key) (see migrations).
            raced = (
                s.execute(
                    text(
                        "SELECT id, receipt_code, received_at, payload_hash FROM app.submissions "
                        "WHERE author_id = CAST(:u AS uuid) AND idempotency_key = :k"
                    ),
                    {"u": p.id, "k": idempotency_key},
                )
                .mappings()
                .first()
            )
            if raced is None:
                # A different IntegrityError (not the idempotency unique
                # violation); re-raise so it surfaces as the canonical error.
                raise
            if raced["payload_hash"] != payload_hash:
                raise ApiError("IDEMPOTENCY_CONFLICT") from None
            return {
                "submission_id": str(raced["id"]),
                "receipt_code": raced["receipt_code"],
                "received_at": raced["received_at"].isoformat(),
                "status": "received",
                "replay": True,
                "level_no": level_no,
            }
        if artifact_meta is not None:
            s.execute(
                text(
                    "UPDATE app.submission_artifacts SET status = 'submitted', submission_id = CAST(:sid AS uuid) "
                    "WHERE id = CAST(:a AS uuid)"
                ),
                {"sid": submission_id, "a": str(artifact_meta["id"])},
            )
        enqueue(s, "evaluate_level_submission", {"submission_id": submission_id, "level_no": level_no})
        # MANUAL-REVALIDATION (REM-062): terminal-state/time semantics need contract tests.
        enqueue(s, "refresh_leaderboard", {"stage_id": str(stage["id"])})
        # REM-016: do NOT set delivered_at on insert; leave NULL. A row is marked
        # delivered only after a real consumer acknowledges delivery. The
        # dispatch_outbox in evaluator.py (owned by another agent) is the only
        # place that may set delivered_at, and only on successful publish.
        s.execute(
            text(
                "INSERT INTO app.outbox_events (id, event_type, payload) VALUES (CAST(:id AS uuid), 'level_submission', "
                "CAST(:p AS jsonb))"
            ),
            {"id": str(uuid7()), "p": jsonlib.dumps({"submission_id": submission_id, "level_no": level_no})},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="level.submitted",
            entity_type="submission",
            entity_id=submission_id,
            request_id=request.state.request_id,
            details={"level": level_no, "receipt": receipt, "kind": kind},
            event_scope=f"event:{event_id}",
        )

        # --- advance the pointer (monotonic, same transaction) ---------------
        nxt = flow.next_position(level_no, "exec")
        assert nxt is not None
        flow.set_level_status(s, p.id, level_no, "submitted", submission_id=submission_id, submitted_at=now)
        flow.advance_pointer(s, p.id, nxt[0], nxt[1])
        if nxt[1] == "explain" and nxt[0] <= flow.LEVEL_COUNT:
            flow.set_level_status(s, p.id, nxt[0], "locked")

    return {
        "submission_id": submission_id,
        "receipt_code": receipt,
        "received_at": now.isoformat(),
        "status": "received",
        "replay": False,
        "level_no": level_no,
    }


def _compute_diff_from_draft(s, user_id: str, level_no: int, challenge_version_id: str) -> str:
    """Unified diff between the frozen base repo and the participant's server
    draft for this level. Computed on the server from authoritative copies."""
    import difflib

    draft_row = (
        s.execute(
            text("SELECT payload FROM app.level_drafts WHERE author_id = CAST(:u AS uuid) AND level_no = :l"),
            {"u": user_id, "l": level_no},
        )
        .mappings()
        .first()
    )
    files = (draft_row["payload"] or {}).get("files", {}) if draft_row else {}
    base_rows = (
        s.execute(
            text(
                "SELECT path, content FROM app.challenge_files WHERE challenge_version_id = CAST(:c AS uuid) ORDER BY path"
            ),
            {"c": challenge_version_id},
        )
        .mappings()
        .all()
    )
    base = {r["path"]: r["content"] for r in base_rows}
    out: list[str] = []
    touched = sorted(set(base.keys()) | set(files.keys()))
    for path in touched:
        before = (base.get(path) or "").splitlines(keepends=True)
        after = str(files.get(path) or "").splitlines(keepends=True)
        if before == after:
            continue
        out.extend(difflib.unified_diff(before, after, fromfile=f"a/{path}", tofile=f"b/{path}"))
    return "".join(out)


def _stage_computed_diff(s, member: dict, user_id: str, level_no: int, diff_text: str) -> dict:
    saved = storage.save(user_id, level_no, "diff", f"level{level_no}-draft.diff", diff_text.encode())
    artifact_id = str(uuid7())
    s.execute(
        text(
            "INSERT INTO app.submission_artifacts (id, owner_id, event_id, level_no, kind, filename, sha256, "
            "size_bytes, entry_count, uncompressed_bytes, storage_key, status) "
            "VALUES (CAST(:id AS uuid), CAST(:o AS uuid), CAST(:e AS uuid), :l, 'diff', :fn, :sha, :sz, 0, :ub, :sk, 'staged')"
        ),
        {
            "id": artifact_id,
            "o": user_id,
            "e": str(member["event_id"]),
            "l": level_no,
            "fn": saved["filename"],
            "sha": saved["sha256"],
            "sz": saved["size_bytes"],
            "ub": len(diff_text.encode()),
            "sk": saved["storage_key"],
        },
    )
    return {
        "id": artifact_id,
        "kind": "diff",
        "filename": saved["filename"],
        "sha256": saved["sha256"],
        "size_bytes": saved["size_bytes"],
        "storage_key": saved["storage_key"],
    }


# --- runs (runner disabled; contract stable for a future adapter) ----------------


@router.post("/runs")
def create_run(p: Principal = Depends(get_principal)):
    # REM-043 (OWNER-DECISION): POST /runs returns RUNNER_UNAVAILABLE while
    # settings.runner_enabled is False. Enabling the runner is NOT a config
    # flip: per ADR-010 the runner must execute participant-supplied artifacts
    # inside an isolated VM (per-run ephemeral snapshot, no shared filesystem,
    # network egress allow-list, CPU/memory/wall-clock caps, no GT schema
    # access). Until that isolated runner exists as a separate project, hidden
    # functional tests stay on the manual two-person recording protocol (see
    # admin record_test_results). Do not set runner_enabled=true in production
    # without the isolation boundary in place.
    from ..config import settings

    rate_limit(f"run:{p.id}", limit=10, window_s=60)
    if not settings.runner_enabled:
        raise ApiError(
            "RUNNER_UNAVAILABLE",
            message="Running code is disabled for this event. Your drafts are saved and you can submit your work.",
        )
    raise ApiError("RUNNER_UNAVAILABLE")


@router.get("/runs/{run_id}")
def get_run(run_id: str, p: Principal = Depends(get_principal)):
    from ..config import settings

    if not settings.runner_enabled:
        raise ApiError("RUNNER_UNAVAILABLE")
    raise ApiError("NOT_FOUND")
