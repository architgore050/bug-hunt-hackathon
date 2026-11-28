"""Organizer/admin endpoints.

Sections implemented (spec ADM-*): events + lifecycle, config freeze,
stages (arm/start/pause/resume/extend/end), teams and participants,
challenges (upload files, freeze, seal, publish), ground truth (gt_admin
session, step-up required), announcements, kill switches, exports, audit
viewer, readiness, system health, scoring test results, rescoring/adjustments,
dispute resolution, result release.

Every mutation writes an audit entry. Sensitive ground-truth operations require
step-up (deps.step_up_verified) and use the gt_engine session.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .. import security
from ..audit import audit_verify, audit_write
from ..config import settings
from ..db import app_engine, app_session, gt_session, health_probe, uuid7
from ..deps import Principal, require_organizer, step_up_verified
from ..errors import ApiError
from ..jobs import enqueue
from ..scoring import add_ledger_entry
from ..tenancy import (
    require_challenge_in_tenant,
    require_dispute_in_tenant,
    require_event_in_tenant,
    require_stage_in_tenant,
    require_submission_in_tenant,
    require_team_in_tenant,
    require_tenant,
)

router = APIRouter(tags=["admin"])


# Owner sign-off notes that are NOT closed by code alone. They are surfaced
# here so the readiness/health endpoints and reviewers see the open item.
# OWNER-DECISION (REM-046): the published team-size cap (4-5) and per-event
# override need owner sign-off before a live event. Default to 4 until that
# decision lands; teams larger than the cap are rejected at create/register time.
DEFAULT_MAX_TEAM_SIZE = 4


def _require_reason(reason: str | None) -> str:
    """Non-empty reason helper for lifecycle mutations (REM-005).

    A blank reason is rejected with ``REASON_REQUIRED``. Length is bounded so a
    reason is meaningful but not a free-form essay.
    """
    if reason is None or not reason.strip():
        raise ApiError("REASON_REQUIRED")
    reason = reason.strip()
    if len(reason) < 3 or len(reason) > 500:
        raise ApiError("REASON_REQUIRED", details={"reason": "Reason must be 3..500 characters."})
    return reason


def _max_team_size_for_event(event_config: dict | None) -> int:
    """Resolve the per-event max team size from config, defaulting to the
    published provisional cap (REM-046)."""
    try:
        cap = int(((event_config or {}).get("features") or {}).get("max_team_size", DEFAULT_MAX_TEAM_SIZE))
    except (TypeError, ValueError):
        cap = DEFAULT_MAX_TEAM_SIZE
    return cap if cap > 0 else DEFAULT_MAX_TEAM_SIZE


def _finalize_preflight(session, event_id: str) -> tuple[bool, list[str]]:
    """Compute blocking conditions for event finalization (REM-006).

    Returns ``(ok, blockers)``. Blockers are human-readable reason strings used
    in the ``FINALIZE_BLOCKED`` / ``RELEASE_BLOCKED`` error details. The caller
    must rerun this inside the finalization transaction; a preview is not a
    substitute because a blocker can appear between preview and commit.
    """
    blockers: list[str] = []
    open_reviews = session.execute(
        text(
            "SELECT count(*) FROM app.review_items ri "
            "JOIN app.submissions s ON s.id = ri.submission_id "
            "WHERE s.event_id = CAST(:e AS uuid) AND ri.status IN ('open','in_review')"
        ),
        {"e": event_id},
    ).scalar_one()
    if int(open_reviews) > 0:
        blockers.append(f"{int(open_reviews)} open review items")
    open_disputes = session.execute(
        text(
            "SELECT count(*) FROM app.disputes d "
            "JOIN app.submissions s ON s.id = d.submission_id "
            "WHERE s.event_id = CAST(:e AS uuid) AND d.status = 'open'"
        ),
        {"e": event_id},
    ).scalar_one()
    if int(open_disputes) > 0:
        blockers.append(f"{int(open_disputes)} open disputes")
    verify = audit_verify(session)
    if not verify.get("intact", True):
        blockers.append("audit chain verification failed")
    return (len(blockers) == 0, blockers)


# --- events -------------------------------------------------------------------


class EventIn(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    slug: str = Field(min_length=3, max_length=80, pattern="^[a-z0-9-]+$")
    starts_at: str | None = None
    duration_minutes: int = 180
    max_participants: int = 50
    max_teams: int = 12
    timezone: str = "Asia/Kolkata"


@router.post("/admin/events", status_code=201)
def create_event(body: EventIn, request: Request, p: Principal = Depends(require_organizer)):
    with app_session() as s:
        # Tenant identity is server-derived from the principal (REM-001); never
        # accept it from the request body and never fall back to "first tenant".
        tenant_id = require_tenant(s, p.tenant_id)
        ev_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.events (id, tenant_id, slug, name, duration_minutes, max_participants, max_teams, config) "
                "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), :slug, :name, :dur, :mp, :mt, CAST(:cfg AS jsonb))"
            ),
            {
                "id": ev_id,
                "t": tenant_id,
                "slug": body.slug,
                "name": body.name,
                "dur": body.duration_minutes,
                "mp": body.max_participants,
                "mt": body.max_teams,
                "cfg": json.dumps(
                    {
                        "features": {
                            "runner_enabled": settings.runner_enabled,
                            "ai_assessment_enabled": settings.ai_assessment_enabled,
                            # OWNER-DECISION (REM-046): published team-size cap
                            # (4-5) requires owner sign-off; default 4 until then.
                            "max_team_size": DEFAULT_MAX_TEAM_SIZE,
                        },
                        "scoring": {
                            "weights": {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2},
                            "ctf_bonus_cap_points": 100,
                        },
                        "public_summary": {},
                        "capacity_note": "Provisional caps: 50 participants / 12 teams. Must be load-tested before the event (ADR-011).",
                    }
                ),
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="event.created",
            entity_type="event",
            entity_id=ev_id,
            request_id=request.state.request_id,
            event_scope=f"event:{ev_id}",
        )
    return {"event_id": ev_id}


EVENT_TRANSITIONS = {
    "draft": {"configured"},
    "configured": {"ready", "draft"},
    "ready": {"live"},
    "live": {"closed"},
    "closed": {"finalized"},
    "finalized": {"archived"},
}


class EventStatusIn(BaseModel):
    status: str
    reason: str = Field(min_length=3, max_length=500)


@router.post("/admin/events/{event_id}/status")
def set_event_status(
    event_id: str,
    body: EventStatusIn,
    request: Request,
    p: Principal = Depends(step_up_verified),
):
    # TWO-PERSON (REM-005): a second independent approver for irreversible
    # transitions (close/finalize/archive) is deferred to v1; step-up + a
    # mandatory audited reason is enforced here.
    reason = _require_reason(body.reason)
    target = body.status
    with app_session() as s:
        ev = require_event_in_tenant(s, event_id, p.tenant_id)
        cur = ev["status"]
        # Re-lock the event row inside this transaction for the transition.
        cur_locked = s.execute(
            text("SELECT status FROM app.events WHERE id = CAST(:e AS uuid) FOR UPDATE"), {"e": event_id}
        ).first()
        if cur_locked is not None:
            cur = cur_locked[0]
        if target not in EVENT_TRANSITIONS.get(cur, set()):
            raise ApiError("VALIDATION_ERROR", details={"transition": f"Cannot move from {cur} to {target}."})
        if target == "live":
            # readiness gate: required items must be checked (ADM-EV-05)
            pending = s.execute(
                text(
                    "SELECT count(*) FROM app.readiness_items WHERE event_id = CAST(:e AS uuid) AND state = 'unchecked'"
                ),
                {"e": event_id},
            ).scalar_one()
            if int(pending) > 0:
                raise ApiError("VALIDATION_ERROR", details={"readiness": f"{pending} readiness items are unchecked."})
            s.execute(
                text(
                    "UPDATE app.events SET starts_at = COALESCE(starts_at, now()), ends_at = now() + make_interval(mins => duration_minutes) WHERE id = CAST(:e AS uuid)"
                ),
                {"e": event_id},
            )
        # REM-006: finalization readiness gate. Block the transition while any
        # review item is open, a dispute is open, or the audit chain is broken.
        if target == "finalized":
            ok, blockers = _finalize_preflight(s, event_id)
            if not ok:
                raise ApiError("FINALIZE_BLOCKED", details={"reason": "; ".join(blockers), "blockers": blockers})
        s.execute(text("UPDATE app.events SET status=:st WHERE id = CAST(:e AS uuid)"), {"st": target, "e": event_id})
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="event.status_changed",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"from": cur, "to": target, "reason": reason},
        )
    return {"ok": True, "status": target}


class ConfigIn(BaseModel):
    config: dict
    reason: str = Field(min_length=5, max_length=500)
    freeze: bool = False


@router.post("/admin/events/{event_id}/config")
def revise_config(event_id: str, body: ConfigIn, request: Request, p: Principal = Depends(step_up_verified)):
    """New config revision with reason; publication freezes the snapshot (DAT-04)."""
    w = body.config.get("scoring", {}).get("weights", {})
    if w and abs(sum(float(v) for v in w.values()) - 1.0) > 0.001:
        raise ApiError("VALIDATION_ERROR", details={"weights": "Scoring weights must sum to 1.0."})
    canonical = json.dumps(body.config, sort_keys=True, separators=(",", ":"))
    rule_set_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        ver = s.execute(
            text("SELECT COALESCE(MAX(version), 0) FROM app.event_config_revisions WHERE event_id = CAST(:e AS uuid)"),
            {"e": event_id},
        ).scalar_one()
        s.execute(
            text(
                "INSERT INTO app.event_config_revisions (id, event_id, version, config, rule_set_hash, reason, created_by, frozen_at) "
                "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :v, CAST(:cfg AS jsonb), :h, :reason, CAST(:u AS uuid), "
                "CASE WHEN :freeze THEN now() ELSE NULL END)"
            ),
            {
                "id": str(uuid7()),
                "e": event_id,
                "v": int(ver) + 1,
                "cfg": json.dumps(body.config, default=str),
                "h": rule_set_hash,
                "reason": body.reason,
                "u": p.id,
                "freeze": body.freeze,
            },
        )
        if body.freeze:
            s.execute(
                text(
                    "UPDATE app.events SET config = CAST(:cfg AS jsonb), config_version = config_version + 1, rules_version = rules_version + 0 WHERE id = CAST(:e AS uuid)"
                ),
                {"cfg": json.dumps(body.config, default=str), "e": event_id},
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="event.config_revised",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"version": int(ver) + 1, "frozen": body.freeze, "reason": body.reason},
        )
    return {"ok": True, "rule_set_hash": rule_set_hash}


@router.get("/admin/events/{event_id}/config/revisions")
def list_config_revisions(event_id: str, p: Principal = Depends(require_organizer)):
    """Return current event config and the bounded immutable revision history."""
    with app_session() as s:
        event = require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        rows = (
            s.execute(
                text(
                    "SELECT version, config, rule_set_hash, reason, created_at, frozen_at "
                    "FROM app.event_config_revisions WHERE event_id = CAST(:e AS uuid) "
                    "ORDER BY version DESC LIMIT 100"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
    return {
        "config_version": int(event["config_version"]),
        "current_config": event["config"] or {},
        "revisions": [dict(row) for row in rows],
    }


@router.get("/admin/events")
def list_events(
    p: Principal = Depends(require_organizer),
    status: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
):
    """List events scoped to the caller's tenant (REM-001) with cursor pagination (REM-028)."""
    with app_session() as s:
        tid = require_tenant(s, p.tenant_id)
        clauses = ["e.tenant_id = CAST(:tid AS uuid)"]
        binds: dict = {"tid": tid, "n": limit}
        if status:
            clauses.append("e.status = :status")
            binds["status"] = status
        if cursor:
            # cursor is "<created_at_iso> <uuid>"; older rows only.
            try:
                cur_ts, cur_id = cursor.split(" ", 1)
            except ValueError as err:
                raise ApiError("VALIDATION_ERROR", details={"cursor": "Invalid cursor."}) from err
            clauses.append("(e.created_at, e.id) < (CAST(:cts AS timestamptz), CAST(:cid AS uuid))")
            binds["cts"] = cur_ts
            binds["cid"] = cur_id
        rows = (
            s.execute(
                text(
                    "SELECT e.id, e.slug, e.name, e.status, e.starts_at, e.ends_at, e.timezone, "
                    "e.max_participants, e.max_teams, e.rules_version, e.config_version, "
                    "e.created_at, e.id AS _cursor_id "
                    "FROM app.events e WHERE "
                    + " AND ".join(clauses)
                    + " ORDER BY e.created_at DESC, e.id DESC LIMIT :n"
                ),
                binds,
            )
            .mappings()
            .all()
        )
        total = s.execute(
            text("SELECT count(*) FROM app.events e WHERE e.tenant_id = CAST(:tid AS uuid)"), {"tid": tid}
        ).scalar_one()
    items = [dict(r) for r in rows]
    next_cursor = None
    if len(items) >= limit:
        last = items[-1]
        next_cursor = f"{last['created_at'].isoformat()} {last['_cursor_id']}"
    for it in items:
        it.pop("_cursor_id", None)
    return {"events": items, "next_cursor": next_cursor, "total": int(total)}


# --- stages -------------------------------------------------------------------


class StageIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: str = "main"
    grace_seconds: int = 3
    config: dict = Field(default_factory=dict)


DEFAULT_STAGE_CONFIG = {
    "feedback_mode": "hidden",
    "leaderboard_mode": "hidden",
    "leaderboard_delay_s": 600,
    "max_span": 25,
    "max_reports_per_file": 12,
    "max_reports_per_round": 80,
    "file_cooldown_s": 20,
    "location_tolerance_lines": 2,
    "ctf_bonus_cap_points": 100,
    "penalty": {"fp_factor": 0.25, "cap_fraction": 0.2, "applies": "at_release_only"},
}


@router.post("/admin/events/{event_id}/stages", status_code=201)
def create_stage(event_id: str, body: StageIn, request: Request, p: Principal = Depends(require_organizer)):
    cfg = {**DEFAULT_STAGE_CONFIG, **body.config}
    canonical = json.dumps(cfg, sort_keys=True, separators=(",", ":"))
    rsh = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        ordinal = s.execute(
            text("SELECT COALESCE(MAX(ordinal), 0) FROM app.stages WHERE event_id = CAST(:e AS uuid)"), {"e": event_id}
        ).scalar_one()
        st_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.stages (id, event_id, name, kind, ordinal, config, rule_set_hash) "
                "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :name, :kind, :ord, CAST(:cfg AS jsonb), :rsh)"
            ),
            {
                "id": st_id,
                "e": event_id,
                "name": body.name,
                "kind": body.kind,
                "ord": int(ordinal) + 1,
                "cfg": json.dumps(cfg),
                "rsh": rsh,
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="stage.created",
            entity_type="stage",
            entity_id=st_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"rule_set_hash": rsh},
        )
    return {"stage_id": st_id, "rule_set_hash": rsh}


STAGE_TRANSITIONS = {
    "draft": {"sealed"},
    "sealed": {"armed", "draft"},
    "armed": {"active"},
    "active": {"paused", "ended"},
    "paused": {"active", "ended"},
    "ended": {"evaluating"},
    "evaluating": {"released"},
    "released": {"final"},
}


class StageControlIn(BaseModel):
    action: str
    reason: str = Field(min_length=3, max_length=500)
    seconds: int | None = None


@router.post("/admin/stages/{stage_id}/control")
def control_stage(
    stage_id: str,
    body: StageControlIn,
    request: Request,
    p: Principal = Depends(step_up_verified),
):
    """arm / start / pause / resume / extend / end - reason code required (ADM-LV-02)."""
    # TWO-PERSON (REM-005): a second independent approver for stage end / extend
    # is deferred to v1; step-up + a mandatory audited reason is enforced here.
    reason = _require_reason(body.reason)
    action = body.action
    mapping = {
        "seal": ("draft", "sealed"),
        "arm": ("sealed", "armed"),
        "start": ("armed", "active"),
        "resume": ("paused", "active"),
        "pause": ("active", "paused"),
        "end": ("active", "ended"),
    }
    with app_session() as s:
        # REM-001 tenant scope: load the stage through its event's tenant.
        st_row = require_stage_in_tenant(s, stage_id, p.tenant_id)
        st = (
            s.execute(
                text("SELECT id, status, ends_at, starts_at FROM app.stages WHERE id = CAST(:s AS uuid) FOR UPDATE"),
                {"s": stage_id},
            )
            .mappings()
            .first()
        )
        if st is None:
            raise ApiError("NOT_FOUND")
        now = s.execute(text("SELECT clock_timestamp()")).scalar_one()
        if action in ("arm", "seal"):
            _from, _to = mapping[action]
            if st["status"] != _from:
                raise ApiError("VALIDATION_ERROR", details={"transition": f"Cannot {action} from {st['status']}."})
            s.execute(text("UPDATE app.stages SET status=:to WHERE id = CAST(:s AS uuid)"), {"to": _to, "s": stage_id})
        elif action == "start":
            if st["status"] != "armed":
                raise ApiError(
                    "VALIDATION_ERROR", details={"transition": f"Arm the stage first (status is {st['status']})."}
                )
            s.execute(
                text(
                    "UPDATE app.stages SET status='active', started_at=:now, ends_at=:now + make_interval(mins => e.duration_minutes) FROM app.events e WHERE app.stages.id = CAST(:s AS uuid) AND e.id = app.stages.event_id"
                ),
                {"now": now, "s": stage_id},
            )
        elif action == "pause":
            if st["status"] != "active":
                raise ApiError("VALIDATION_ERROR", details={"transition": "Only an active stage can pause."})
            s.execute(text("UPDATE app.stages SET status='paused' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
        elif action == "resume":
            if st["status"] != "paused":
                raise ApiError("VALIDATION_ERROR", details={"transition": "Only a paused stage can resume."})
            # TIM-05: shift ends_at by the pause duration measured from the pause
            # transition (not stage start), so the promised working time is kept.
            paused_at = s.execute(
                text(
                    "SELECT created_at FROM app.stage_transitions WHERE stage_id = CAST(:s AS uuid) AND to_status = 'paused' ORDER BY created_at DESC LIMIT 1"
                ),
                {"s": stage_id},
            ).scalar_one()
            if paused_at is not None:
                s.execute(
                    text(
                        "UPDATE app.stages SET status='active', ends_at = ends_at + make_interval(secs => LEAST(7200, GREATEST(0, EXTRACT(epoch FROM (clock_timestamp() - CAST(:p AS timestamptz)))::int))) WHERE id = CAST(:s AS uuid)"
                    ),
                    {"s": stage_id, "p": paused_at},
                )
            else:
                s.execute(text("UPDATE app.stages SET status='active' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
        elif action == "extend":
            seconds = int(body.seconds or 0)
            if seconds <= 0 or seconds > 3600:
                raise ApiError("VALIDATION_ERROR", details={"seconds": "1..3600"})
            s.execute(
                text(
                    "UPDATE app.stages SET ends_at = ends_at + make_interval(secs => :sec) WHERE id = CAST(:s AS uuid)"
                ),
                {"sec": seconds, "s": stage_id},
            )
        elif action == "end":
            if st["status"] not in ("active", "paused"):
                raise ApiError("VALIDATION_ERROR", details={"transition": "Only an active or paused stage can end."})
            s.execute(
                text("UPDATE app.stages SET status='ended', ended_at=:now WHERE id = CAST(:s AS uuid)"),
                {"now": now, "s": stage_id},
            )
        else:
            raise ApiError("VALIDATION_ERROR", details={"action": "Unknown action."})
        s.execute(
            text(
                "INSERT INTO app.stage_transitions (id, stage_id, from_status, to_status, actor_id, reason_code) "
                "VALUES (CAST(:id AS uuid), CAST(:s AS uuid), :f, :t, CAST(:u AS uuid), :r)"
            ),
            {"id": str(uuid7()), "s": stage_id, "f": st["status"], "t": action, "u": p.id, "r": reason},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action=f"stage.{action}",
            entity_type="stage",
            entity_id=stage_id,
            request_id=request.state.request_id,
            event_scope=f"event:{st_row['event_id']}",
            details={"reason": reason},
        )
    return {"ok": True, "action": action}


class StageReleaseIn(BaseModel):
    action: str = "release"
    reason: str = Field(min_length=3, max_length=500)


@router.post("/admin/stages/{stage_id}/release")
def release_results(
    stage_id: str,
    body: StageReleaseIn,
    request: Request,
    p: Principal = Depends(step_up_verified),
):
    """ENDED -> EVALUATING -> RELEASED: publishes verdicts and leaderboard (ADM-RS-04)."""
    # TWO-PERSON (REM-005): a second approver for result release is deferred to
    # v1; step-up + a mandatory audited reason is enforced here.
    reason = _require_reason(body.reason)
    action = body.action
    with app_session() as s:
        st_row = require_stage_in_tenant(s, stage_id, p.tenant_id)  # REM-001 tenant scope
        st = s.execute(
            text("SELECT status FROM app.stages WHERE id = CAST(:s AS uuid) FOR UPDATE"), {"s": stage_id}
        ).first()
        if st is None:
            raise ApiError("NOT_FOUND")
        if action == "evaluate" and st[0] != "ended":
            raise ApiError("VALIDATION_ERROR", details={"transition": "Stage must be ended first."})
        if action == "release":
            if st[0] not in ("ended", "evaluating"):
                raise ApiError("VALIDATION_ERROR", details={"transition": f"Cannot release from {st[0]}."})
            # REM-006: release readiness gate. Block while any review item is
            # open, a dispute is open, or the audit chain is broken.
            ok, blockers = _finalize_preflight(s, str(st_row["event_id"]))
            if not ok:
                raise ApiError("RELEASE_BLOCKED", details={"reason": "; ".join(blockers), "blockers": blockers})
        if action == "evaluate":
            s.execute(text("UPDATE app.stages SET status='evaluating' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
            enqueue(s, "release_feedback", {"stage_id": stage_id})
        elif action == "release":
            s.execute(text("UPDATE app.stages SET status='released' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
            enqueue(s, "release_feedback", {"stage_id": stage_id})
            enqueue(s, "refresh_leaderboard", {"stage_id": stage_id, "visibility": "public"})
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action=f"stage.{action}",
            entity_type="stage",
            entity_id=stage_id,
            request_id=request.state.request_id,
            event_scope=f"event:{st_row['event_id']}",
            details={"reason": reason},
        )
    return {"ok": True}


# --- teams and admin-managed participants -------------------------------------


def admin_step_up_verified(p: Principal = Depends(step_up_verified)) -> Principal:
    """Restrict sensitive participant operations to admins with a recent password check."""
    if p.role != "admin":
        raise ApiError("AUTH_FORBIDDEN")
    return p


class TeamIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)


@router.post("/admin/events/{event_id}/teams", status_code=201)
def create_team(event_id: str, body: TeamIn, request: Request, p: Principal = Depends(admin_step_up_verified)):
    import secrets

    with app_session() as s:
        ev = require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        # Re-read the row under FOR UPDATE for the capacity check.
        ev_locked = s.execute(
            text("SELECT max_teams, config FROM app.events WHERE id = CAST(:e AS uuid) FOR UPDATE"),
            {"e": event_id},
        ).first()
        if ev_locked is None:
            raise ApiError("NOT_FOUND")
        max_teams = int(ev_locked[0] or ev["max_teams"])
        count = s.execute(
            text("SELECT count(*) FROM app.teams WHERE event_id = CAST(:e AS uuid)"),
            {"e": event_id},
        ).scalar_one()
        if int(count) >= max_teams:
            raise ApiError("VALIDATION_ERROR", details={"capacity": f"Team cap ({max_teams}) reached."})
        team_id = str(uuid7())
        join_code = secrets.token_hex(4).upper()
        s.execute(
            text(
                "INSERT INTO app.teams (id, event_id, name, join_code) VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :name, :jc)"
            ),
            {"id": team_id, "e": event_id, "name": body.name, "jc": join_code},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="team.created",
            entity_type="team",
            entity_id=team_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
        )
    return {"team_id": team_id, "join_code": join_code}


@router.get("/admin/events/{event_id}/teams")
def list_teams(event_id: str, p: Principal = Depends(require_organizer)):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        rows = (
            s.execute(
                text(
                    "SELECT t.id, t.name, t.status, count(DISTINCT tm.user_id) AS member_count "
                    "FROM app.teams t LEFT JOIN app.team_members tm ON tm.team_id = t.id "
                    "WHERE t.event_id = CAST(:e AS uuid) "
                    "GROUP BY t.id, t.name, t.status ORDER BY t.name"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
    return {"teams": [dict(row) for row in rows]}


class ParticipantCreateIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=160)
    team_id: str


class ParticipantTeamIn(BaseModel):
    team_id: str


class AdminPasswordResetIn(BaseModel):
    password: str = Field(min_length=12, max_length=200)


@router.post("/admin/events/{event_id}/participants", status_code=201)
def register_event_participant(
    event_id: str,
    body: ParticipantCreateIn,
    request: Request,
    p: Principal = Depends(admin_step_up_verified),
):
    """Create a passwordless participant and attach them directly to an event team."""
    user_id = None
    password_setup_required = True
    try:
        with app_session() as s:
            require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
            # Re-read under FOR UPDATE for capacity checks.
            event_locked = (
                s.execute(
                    text(
                        "SELECT tenant_id, max_participants, config FROM app.events WHERE id = CAST(:e AS uuid) FOR UPDATE"
                    ),
                    {"e": event_id},
                )
                .mappings()
                .first()
            )
            if event_locked is None:
                raise ApiError("NOT_FOUND")

            team = require_team_in_tenant(s, body.team_id, p.tenant_id)  # REM-001 tenant scope
            if str(team["event_id"]) != event_id:
                raise ApiError("VALIDATION_ERROR", details={"team_id": "Choose a team from this event."})
            # Re-lock the team row for the membership insert.
            s.execute(text("SELECT 1 FROM app.teams WHERE id = CAST(:t AS uuid) FOR UPDATE"), {"t": body.team_id})

            # REM-046 team-size enforcement. The published cap (4-5) needs owner
            # sign-off; default to 4 until that decision lands. Rejecting here
            # keeps the roster fair regardless of the UI.
            max_team_size = _max_team_size_for_event(event_locked["config"])
            team_member_count = s.execute(
                text("SELECT count(*) FROM app.team_members WHERE team_id = CAST(:t AS uuid)"),
                {"t": body.team_id},
            ).scalar_one()
            if int(team_member_count) >= max_team_size:
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"team_id": f"Team size cap ({max_team_size}) reached."},
                )

            member_count = s.execute(
                text(
                    "SELECT count(DISTINCT tm.user_id) FROM app.team_members tm "
                    "JOIN app.teams t ON t.id = tm.team_id WHERE t.event_id = CAST(:e AS uuid)"
                ),
                {"e": event_id},
            ).scalar_one()
            if int(member_count) >= int(event_locked["max_participants"]):
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"capacity": f"Participant cap ({event_locked['max_participants']}) reached."},
                )

            existing = (
                s.execute(
                    text(
                        "SELECT id, tenant_id, role, password_hash FROM app.users "
                        "WHERE lower(email) = :email FOR UPDATE"
                    ),
                    {"email": body.email.lower()},
                )
                .mappings()
                .first()
            )
            if existing is None:
                user_id = str(uuid7())
                s.execute(
                    text(
                        "INSERT INTO app.users "
                        "(id, tenant_id, email, name, role, password_hash, registration_id) "
                        "VALUES (CAST(:id AS uuid), CAST(:tenant AS uuid), :email, :name, "
                        "'participant', NULL, :registration_id)"
                    ),
                    {
                        "id": user_id,
                        "tenant": str(event_locked["tenant_id"]),
                        "email": body.email.lower(),
                        "name": body.name,
                        "registration_id": str(uuid7())[:8],
                    },
                )
            else:
                user_id = str(existing["id"])
                if str(existing["tenant_id"]) != str(event_locked["tenant_id"]) or existing["role"] != "participant":
                    raise ApiError(
                        "VALIDATION_ERROR",
                        details={"email": "This email is already registered for a different account role or tenant."},
                    )
                membership = s.execute(
                    text(
                        "SELECT t.id FROM app.team_members tm "
                        "JOIN app.teams t ON t.id = tm.team_id "
                        "WHERE tm.user_id = CAST(:u AS uuid) AND t.event_id = CAST(:e AS uuid)"
                    ),
                    {"u": user_id, "e": event_id},
                ).first()
                if membership is not None:
                    raise ApiError(
                        "VALIDATION_ERROR",
                        details={
                            "email": "This participant already belongs to a team in this event. Use team reassignment."
                        },
                    )
                password_setup_required = existing["password_hash"] is None

            s.execute(
                text(
                    "INSERT INTO app.team_members (id, team_id, user_id) "
                    "VALUES (CAST(:id AS uuid), CAST(:team AS uuid), CAST(:user AS uuid))"
                ),
                {"id": str(uuid7()), "team": body.team_id, "user": user_id},
            )
            audit_write(
                s,
                actor_id=p.id,
                actor_role=p.role,
                action="participant.registered",
                entity_type="user",
                entity_id=user_id,
                request_id=request.state.request_id,
                event_scope=f"event:{event_id}",
                details={
                    "email": body.email.lower(),
                    "team_id": body.team_id,
                    "password_setup_required": password_setup_required,
                },
            )
    except IntegrityError:
        raise ApiError(
            "VALIDATION_ERROR",
            details={"email": "This email or team membership already exists. Refresh the roster and retry."},
        ) from None

    return {
        "participant_id": user_id,
        "email": body.email.lower(),
        "team_id": body.team_id,
        "password_setup_required": password_setup_required,
    }


@router.patch("/admin/events/{event_id}/participants/{user_id}/team")
def reassign_event_participant(
    event_id: str,
    user_id: str,
    body: ParticipantTeamIn,
    request: Request,
    p: Principal = Depends(admin_step_up_verified),
):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        team = require_team_in_tenant(s, body.team_id, p.tenant_id)  # REM-001 tenant scope
        if str(team["event_id"]) != event_id:
            raise ApiError("VALIDATION_ERROR", details={"team_id": "Choose a team from this event."})
        # Re-lock the target team row for the membership insert.
        s.execute(text("SELECT 1 FROM app.teams WHERE id = CAST(:t AS uuid) FOR UPDATE"), {"t": body.team_id})
        current = s.execute(
            text(
                "SELECT tm.team_id FROM app.team_members tm "
                "JOIN app.teams t ON t.id = tm.team_id "
                "JOIN app.users u ON u.id = tm.user_id "
                "WHERE tm.user_id = CAST(:u AS uuid) AND t.event_id = CAST(:e AS uuid) "
                "AND u.role = 'participant' FOR UPDATE"
            ),
            {"u": user_id, "e": event_id},
        ).first()
        if current is None:
            raise ApiError("NOT_FOUND")
        if str(current[0]) != body.team_id:
            # REM-046: enforce team-size cap on the destination team too.
            ev = s.execute(text("SELECT config FROM app.events WHERE id = CAST(:e AS uuid)"), {"e": event_id}).first()
            max_team_size = _max_team_size_for_event(ev[0] if ev else None)
            dest_count = s.execute(
                text("SELECT count(*) FROM app.team_members WHERE team_id = CAST(:t AS uuid)"),
                {"t": body.team_id},
            ).scalar_one()
            if int(dest_count) >= max_team_size:
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"team_id": f"Team size cap ({max_team_size}) reached."},
                )
            s.execute(
                text("DELETE FROM app.team_members WHERE user_id = CAST(:u AS uuid) AND team_id = CAST(:t AS uuid)"),
                {"u": user_id, "t": str(current[0])},
            )
            s.execute(
                text(
                    "INSERT INTO app.team_members (id, team_id, user_id) "
                    "VALUES (CAST(:id AS uuid), CAST(:team AS uuid), CAST(:user AS uuid))"
                ),
                {"id": str(uuid7()), "team": body.team_id, "user": user_id},
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="participant.team_reassigned",
            entity_type="user",
            entity_id=user_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"from_team_id": str(current[0]), "to_team_id": body.team_id},
        )
    return {"ok": True, "team_id": body.team_id}


@router.delete("/admin/events/{event_id}/participants/{user_id}")
def remove_event_participant(
    event_id: str,
    user_id: str,
    request: Request,
    p: Principal = Depends(admin_step_up_verified),
):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        row = s.execute(
            text(
                "SELECT tm.team_id FROM app.team_members tm "
                "JOIN app.teams t ON t.id = tm.team_id "
                "JOIN app.users u ON u.id = tm.user_id "
                "WHERE tm.user_id = CAST(:u AS uuid) AND t.event_id = CAST(:e AS uuid) "
                "AND u.role = 'participant' FOR UPDATE"
            ),
            {"u": user_id, "e": event_id},
        ).first()
        if row is None:
            raise ApiError("NOT_FOUND")
        s.execute(
            text("DELETE FROM app.team_members WHERE user_id = CAST(:u AS uuid) AND team_id = CAST(:t AS uuid)"),
            {"u": user_id, "t": str(row[0])},
        )
        remaining_memberships = s.execute(
            text("SELECT count(*) FROM app.team_members WHERE user_id = CAST(:u AS uuid)"),
            {"u": user_id},
        ).scalar_one()
        if int(remaining_memberships) == 0:
            s.execute(
                text("UPDATE app.users SET token_version = token_version + 1 WHERE id = CAST(:u AS uuid)"),
                {"u": user_id},
            )
            s.execute(
                text(
                    "UPDATE app.sessions SET revoked_at = now() WHERE user_id = CAST(:u AS uuid) AND revoked_at IS NULL"
                ),
                {"u": user_id},
            )
            s.execute(
                text("UPDATE app.refresh_tokens SET status = 'revoked' WHERE user_id = CAST(:u AS uuid)"),
                {"u": user_id},
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="participant.removed_from_event",
            entity_type="user",
            entity_id=user_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"remaining_team_memberships": int(remaining_memberships)},
        )
    return {"ok": True}


@router.post("/admin/users/{user_id}/password-reset")
def admin_reset_user_password(
    user_id: str,
    body: AdminPasswordResetIn,
    request: Request,
    p: Principal = Depends(admin_step_up_verified),
):
    if user_id == p.id:
        raise ApiError("VALIDATION_ERROR", details={"user_id": "Use another admin account to reset your own password."})
    with app_session() as s:
        # REM-001 tenant scope: only reset users in the caller's tenant.
        tid = require_tenant(s, p.tenant_id)
        user = (
            s.execute(
                text(
                    "SELECT email FROM app.users WHERE id = CAST(:u AS uuid) AND tenant_id = CAST(:t AS uuid) FOR UPDATE"
                ),
                {"u": user_id, "t": tid},
            )
            .mappings()
            .first()
        )
        if user is None:
            raise ApiError("NOT_FOUND")
        s.execute(
            text(
                "UPDATE app.users SET password_hash = :pw, token_version = token_version + 1 "
                "WHERE id = CAST(:u AS uuid)"
            ),
            {"pw": security.hash_password(body.password), "u": user_id},
        )
        s.execute(
            text("UPDATE app.sessions SET revoked_at = now() WHERE user_id = CAST(:u AS uuid) AND revoked_at IS NULL"),
            {"u": user_id},
        )
        s.execute(
            text("UPDATE app.refresh_tokens SET status = 'revoked' WHERE user_id = CAST(:u AS uuid)"),
            {"u": user_id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="auth.password_reset_by_admin",
            entity_type="user",
            entity_id=user_id,
            request_id=request.state.request_id,
            details={"target_email": user["email"]},
        )
    return {"ok": True, "email": user["email"]}


@router.get("/admin/events/{event_id}/participants")
def list_participants(
    event_id: str,
    p: Principal = Depends(require_organizer),
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    email: str | None = None,
    team_id: str | None = None,
):
    """Tenant-scoped participant roster (REM-001) with cursor pagination (REM-028)."""
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        clauses = ["t.event_id = CAST(:e AS uuid)", "u.role = 'participant'"]
        binds: dict = {"e": event_id, "n": limit}
        if email:
            clauses.append("lower(u.email) LIKE :email")
            binds["email"] = f"%{email.lower()}%"
        if team_id:
            clauses.append("t.id = CAST(:team_id AS uuid)")
            binds["team_id"] = team_id
        if cursor:
            try:
                cur_email, cur_id = cursor.split("\t", 1)
            except ValueError as err:
                raise ApiError("VALIDATION_ERROR", details={"cursor": "Invalid cursor."}) from err
            clauses.append("(u.email, u.id) > (:cemail, CAST(:cid AS uuid))")
            binds["cemail"] = cur_email
            binds["cid"] = cur_id
        rows = (
            s.execute(
                text(
                    "SELECT u.id, u.email, u.name, u.role, t.id AS team_id, t.name AS team_name, "
                    "(u.password_hash IS NOT NULL) AS password_set, u.created_at "
                    "FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.users u ON u.id = tm.user_id "
                    "WHERE " + " AND ".join(clauses) + " ORDER BY u.email, u.id LIMIT :n"
                ),
                binds,
            )
            .mappings()
            .all()
        )
    items = [dict(r) for r in rows]
    next_cursor = None
    if len(items) >= limit:
        last = items[-1]
        next_cursor = f"{last['email']}\t{last['id']}"
    # Total is the count of all rows matching the non-cursor filters only.
    total_clauses = [c for c in clauses if c != "(u.email, u.id) > (:cemail, CAST(:cid AS uuid))"]
    total_binds = {k: v for k, v in binds.items() if k in {"e", "email", "team_id"}}
    with app_session() as s:
        total = s.execute(
            text(
                "SELECT count(*) FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                "JOIN app.users u ON u.id = tm.user_id WHERE " + " AND ".join(total_clauses)
            ),
            total_binds,
        ).scalar_one()
    return {"participants": items, "next_cursor": next_cursor, "total": int(total)}


# --- challenges ----------------------------------------------------------------


class ChallengeIn(BaseModel):
    slug: str = Field(pattern="^[a-z0-9-]+$")
    title: str
    instructions_markdown: str | None = None


@router.get("/admin/events/{event_id}/challenges")
def list_challenge_versions(event_id: str, p: Principal = Depends(require_organizer)):
    """List safe challenge metadata without participant content or ground-truth secrets."""
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        rows = (
            s.execute(
                text(
                    "SELECT id, slug, title, version, status, content_hash, frozen_at, published_at, created_at "
                    "FROM app.challenge_versions WHERE event_id = CAST(:e AS uuid) "
                    "ORDER BY created_at DESC LIMIT 200"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
    return {"challenges": [dict(row) for row in rows]}


@router.post("/admin/events/{event_id}/challenges", status_code=201)
def create_challenge(event_id: str, body: ChallengeIn, request: Request, p: Principal = Depends(step_up_verified)):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        cid = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.challenge_versions (id, event_id, slug, title, version, instructions_md) "
                "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :slug, :title, 1, :inst)"
            ),
            {"id": cid, "e": event_id, "slug": body.slug, "title": body.title, "inst": body.instructions_markdown},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="challenge.created",
            entity_type="challenge",
            entity_id=cid,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
        )
    return {"challenge_id": cid}


@router.post("/admin/challenges/{challenge_id}/files")
async def upload_files(
    challenge_id: str, request: Request, file: UploadFile = File(...), p: Principal = Depends(step_up_verified)
):
    """Multipart upload of one source file (path passed as filename). Content is
    stored inertly as text; never executed (SEC-03). Size and count limits apply."""
    content = await file.read()
    if len(content) > 512 * 1024:
        raise ApiError("VALIDATION_ERROR", details={"file": "Max 512 KiB per file."})
    path = file.filename or ""
    import os

    norm = os.path.normpath(path)
    if norm.startswith("..") or os.path.isabs(norm) or "\x00" in norm:
        raise ApiError("PATH_INVALID")
    text_content = content.decode("utf-8", errors="replace")
    line_count = text_content.count("\n") + 1
    with app_session() as s:
        cv = require_challenge_in_tenant(s, challenge_id, p.tenant_id)  # REM-001 tenant scope
        if cv["status"] not in ("draft", "reviewed"):
            raise ApiError("GROUND_TRUTH_LOCKED")
        s.execute(
            text(
                "INSERT INTO app.challenge_files (id, challenge_version_id, path, lang, content, sha256, size_bytes, line_count) "
                "VALUES (CAST(:id AS uuid), CAST(:c AS uuid), :p, :lang, :content, :sha, :size, :lines) "
                "ON CONFLICT (challenge_version_id, path) DO UPDATE SET content = EXCLUDED.content, sha256 = EXCLUDED.sha256, "
                "size_bytes = EXCLUDED.size_bytes, line_count = EXCLUDED.line_count"
            ),
            {
                "id": str(uuid7()),
                "c": challenge_id,
                "p": norm,
                "lang": _lang_for(norm),
                "content": text_content,
                "sha": hashlib.sha256(content).hexdigest(),
                "size": len(content),
                "lines": line_count,
            },
        )
        # rebuild the search line index for this file (sealed index, FE-04)
        s.execute(
            text("DELETE FROM app.challenge_file_lines WHERE challenge_version_id = CAST(:c AS uuid) AND path = :p"),
            {"c": challenge_id, "p": norm},
        )
        for i, line in enumerate(text_content.splitlines()[:5000], start=1):
            s.execute(
                text(
                    "INSERT INTO app.challenge_file_lines (id, challenge_version_id, path, line_number, line_text) "
                    "VALUES (CAST(:id AS uuid), CAST(:c AS uuid), :p, :ln, :lt)"
                ),
                {"id": str(uuid7()), "c": challenge_id, "p": norm, "ln": i, "lt": line[:500]},
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="challenge.file_uploaded",
            entity_type="challenge",
            entity_id=challenge_id,
            request_id=request.state.request_id,
            details={"path": norm},
            event_scope=f"event:{cv['event_id']}",
        )
    return {"ok": True, "path": norm, "line_count": line_count}


def _lang_for(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else "text"
    return {
        "py": "python",
        "js": "javascript",
        "ts": "typescript",
        "html": "html",
        "css": "css",
        "json": "json",
        "md": "markdown",
        "sql": "sql",
    }.get(ext, "text")


@router.post("/admin/challenges/{challenge_id}/freeze")
def freeze_challenge(challenge_id: str, request: Request, p: Principal = Depends(step_up_verified)):
    with app_session() as s:
        cv = require_challenge_in_tenant(s, challenge_id, p.tenant_id)  # REM-001 tenant scope
        cv_locked = s.execute(
            text("SELECT status FROM app.challenge_versions WHERE id = CAST(:c AS uuid) FOR UPDATE"),
            {"c": challenge_id},
        ).first()
        if cv_locked is None:
            raise ApiError("NOT_FOUND")
        if cv_locked[0] not in ("draft", "reviewed"):
            raise ApiError("GROUND_TRUTH_LOCKED")
        files = s.execute(
            text("SELECT sha256 FROM app.challenge_files WHERE challenge_version_id = CAST(:c AS uuid) ORDER BY path"),
            {"c": challenge_id},
        ).all()
        if not files:
            raise ApiError("VALIDATION_ERROR", details={"files": "Upload at least one file before freezing."})
        content_hash = "sha256:" + hashlib.sha256("".join(f[0] for f in files).encode()).hexdigest()
        s.execute(
            text(
                "UPDATE app.challenge_versions SET status='sealed', content_hash=:h, frozen_at=now() WHERE id = CAST(:c AS uuid)"
            ),
            {"h": content_hash, "c": challenge_id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="challenge.frozen",
            entity_type="challenge",
            entity_id=challenge_id,
            request_id=request.state.request_id,
            details={"content_hash": content_hash},
            event_scope=f"event:{cv['event_id']}",
        )
    return {"ok": True, "content_hash": content_hash}


class ChallengePublishIn(BaseModel):
    stage_id: str


@router.post("/admin/challenges/{challenge_id}/publish")
def publish_challenge(
    challenge_id: str, body: ChallengePublishIn, request: Request, p: Principal = Depends(step_up_verified)
):
    stage_id = body.stage_id
    if not stage_id:
        raise ApiError("VALIDATION_ERROR", details={"stage_id": "Required."})
    with app_session() as s:
        cv = require_challenge_in_tenant(s, challenge_id, p.tenant_id)  # REM-001 tenant scope
        cv_locked = (
            s.execute(
                text("SELECT status FROM app.challenge_versions WHERE id = CAST(:c AS uuid) FOR UPDATE"),
                {"c": challenge_id},
            )
            .mappings()
            .first()
        )
        if cv_locked is None:
            raise ApiError("NOT_FOUND")
        if cv_locked["status"] not in ("sealed",):
            raise ApiError("GROUND_TRUTH_LOCKED")
        # REM-001: the stage must belong to the same event (and tenant).
        stage = require_stage_in_tenant(s, stage_id, p.tenant_id)
        if str(stage["event_id"]) != str(cv["event_id"]):
            raise ApiError("VALIDATION_ERROR", details={"stage_id": "Stage must belong to the challenge's event."})
        s.execute(
            text(
                "UPDATE app.challenge_versions SET status='published', published_at=now() WHERE id = CAST(:c AS uuid)"
            ),
            {"c": challenge_id},
        )
        s.execute(
            text(
                "INSERT INTO app.assignments (id, event_id, stage_id, challenge_version_id) VALUES (CAST(:id AS uuid), CAST(:e AS uuid), CAST(:s AS uuid), CAST(:c AS uuid))"
            ),
            {"id": str(uuid7()), "e": str(cv["event_id"]), "s": stage_id, "c": challenge_id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="challenge.published",
            entity_type="challenge",
            entity_id=challenge_id,
            request_id=request.state.request_id,
            details={"stage_id": stage_id},
            event_scope=f"event:{cv['event_id']}",
        )
    return {"ok": True}


# --- ground truth (gt_admin session; step-up required) -------------------------


class GtLocationIn(BaseModel):
    file_path: str = Field(min_length=1, max_length=500)
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    is_primary: bool = True


class GtAliasIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=120)
    weight: float = Field(default=1.0, gt=0, le=10.0)


class BugIn(BaseModel):
    code: str = Field(max_length=40)
    title: str
    severity: str = Field(pattern="^(low|medium|high|critical)$")
    category: str
    points: float = Field(gt=0, le=1000)
    root_cause_group: str
    explanation: str
    fix_guidance: str | None = None
    locations: list[GtLocationIn] = Field(default_factory=list, max_length=8)
    aliases: list[GtAliasIn] = Field(default_factory=list, max_length=12)


def _compute_anchor_hash(file_path: str, line_start: int, line_end: int) -> str:
    """Stable canonical anchor for a GT location (REM-008).

    The anchor is sha256 of ``file_path|line_start|line_end`` so a frozen bug
    can be re-validated against the same canonical coordinates after a
    challenge revision. The full source-context hash (surrounding lines) is a
    future refinement tracked in REM-008 step 3.
    """
    material = f"{file_path}|{int(line_start)}|{int(line_end)}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


@router.post("/admin/challenges/{challenge_id}/ground-truth/bugs", status_code=201)
def add_bug(challenge_id: str, body: BugIn, request: Request, p: Principal = Depends(step_up_verified)):
    """Writes ground truth via the gt_admin role only (DAT-03)."""
    # REM-008: validate every location against the challenge's uploaded files.
    # The file must exist in app.challenge_files and the line range must fit
    # inside its line_count. We compute a canonical anchor_hash for each
    # location so a revision can re-verify the bug is still anchored.
    with app_session() as s:
        require_challenge_in_tenant(s, challenge_id, p.tenant_id)  # REM-001 tenant scope
        file_rows = (
            s.execute(
                text("SELECT path, line_count FROM app.challenge_files WHERE challenge_version_id = CAST(:c AS uuid)"),
                {"c": challenge_id},
            )
            .mappings()
            .all()
        )
    file_index: dict[str, int] = {str(r["path"]): int(r["line_count"]) for r in file_rows}
    for loc in body.locations:
        if loc.line_end < loc.line_start:
            raise ApiError("VALIDATION_ERROR", details={"locations": "line_end must be >= line_start."})
        line_count = file_index.get(loc.file_path)
        if line_count is None:
            raise ApiError(
                "VALIDATION_ERROR",
                details={"locations": f"file_path '{loc.file_path}' is not part of this challenge."},
            )
        if loc.line_start < 1 or loc.line_end > line_count:
            raise ApiError(
                "VALIDATION_ERROR",
                details={
                    "locations": (
                        f"line range {loc.line_start}-{loc.line_end} is out of bounds for "
                        f"'{loc.file_path}' (file has {line_count} lines)."
                    )
                },
            )
    with _editable_challenge_lock(challenge_id, p.tenant_id), gt_session() as gts:
        bug_id = str(uuid7())
        gts.execute(
            text(
                "INSERT INTO gt.gt_bugs (id, challenge_version_id, code, title, severity, category, points, root_cause_group, explanation, fix_guidance) "
                "VALUES (CAST(:id AS uuid), CAST(:c AS uuid), :code, :title, :sev, :cat, :pts, :rcg, :expl, :fix)"
            ),
            {
                "id": bug_id,
                "c": challenge_id,
                "code": body.code,
                "title": body.title,
                "sev": body.severity,
                "cat": body.category,
                "pts": body.points,
                "rcg": body.root_cause_group,
                "expl": body.explanation,
                "fix": body.fix_guidance,
            },
        )
        for loc in body.locations:
            anchor = _compute_anchor_hash(loc.file_path, loc.line_start, loc.line_end)
            gts.execute(
                text(
                    "INSERT INTO gt.gt_locations (id, bug_id, file_path, line_start, line_end, is_primary, anchor_hash) "
                    "VALUES (CAST(:id AS uuid), CAST(:b AS uuid), :fp, :ls, :le, :prim, :ah)"
                ),
                {
                    "id": str(uuid7()),
                    "b": bug_id,
                    "fp": loc.file_path,
                    "ls": loc.line_start,
                    "le": loc.line_end,
                    "prim": loc.is_primary,
                    "ah": anchor,
                },
            )
        for al in body.aliases:
            gts.execute(
                text(
                    "INSERT INTO gt.gt_aliases (id, bug_id, keyword, weight) VALUES (CAST(:id AS uuid), CAST(:b AS uuid), :kw, :w)"
                ),
                {"id": str(uuid7()), "b": bug_id, "kw": al.keyword, "w": al.weight},
            )
        audit_write(
            gts,
            actor_id=p.id,
            actor_role=p.role,
            action="gt.bug_added",
            entity_type="gt_bug",
            entity_id=bug_id,
            request_id=request.state.request_id,
            details={"code": body.code},
            event_scope=f"challenge:{challenge_id}",
        )

    return {"bug_id": bug_id}


class FlagIn(BaseModel):
    flag_key: str = Field(min_length=1, max_length=40)
    code: str = Field(min_length=4, max_length=200)
    points: float = Field(gt=0, le=500)
    max_awards: int = Field(default=99, ge=1)


class FlagPatchIn(BaseModel):
    flag_key: str | None = Field(default=None, min_length=1, max_length=40)
    code: str | None = Field(default=None, min_length=4, max_length=200)
    points: float | None = Field(default=None, gt=0, le=500)
    max_awards: int | None = Field(default=None, ge=1)


@router.get("/admin/challenges/{challenge_id}/ground-truth/flags")
def list_ground_truth_flags(challenge_id: str, p: Principal = Depends(step_up_verified)):
    """Return editable flag metadata only; neither plaintext codes nor hashes are exposed."""
    with app_session() as s:
        require_challenge_in_tenant(s, challenge_id, p.tenant_id)  # REM-001 tenant scope
    with gt_session() as gts:
        rows = (
            gts.execute(
                text(
                    "SELECT id, flag_key, points, max_awards, position_label, created_at "
                    "FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) "
                    "ORDER BY created_at, flag_key"
                ),
                {"c": challenge_id},
            )
            .mappings()
            .all()
        )
    return {"flags": [dict(row) for row in rows]}


@contextmanager
def _editable_challenge_lock(challenge_id: str, tenant_id: str | None):
    """Hold the challenge row lock until the isolated ground-truth write completes.

    Tenant-scoped (REM-001): the challenge must belong to the caller's tenant
    or this raises a non-enumerating 404 before any GT write.
    """
    with app_session() as s:
        require_challenge_in_tenant(s, challenge_id, tenant_id)  # REM-001 tenant scope
        challenge = s.execute(
            text("SELECT status FROM app.challenge_versions WHERE id = CAST(:c AS uuid) FOR UPDATE"),
            {"c": challenge_id},
        ).first()
        if challenge is None:
            raise ApiError("NOT_FOUND")
        if challenge[0] not in ("draft", "reviewed"):
            raise ApiError("GROUND_TRUTH_LOCKED")
        yield


@router.post("/admin/challenges/{challenge_id}/ground-truth/flags", status_code=201)
def add_flag(challenge_id: str, body: FlagIn, request: Request, p: Principal = Depends(step_up_verified)):
    from ..security import flag_code_hash

    with _editable_challenge_lock(challenge_id, p.tenant_id):
        try:
            with gt_session() as gts:
                duplicate_key = gts.execute(
                    text("SELECT 1 FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) AND flag_key = :k"),
                    {"c": challenge_id, "k": body.flag_key},
                ).first()
                if duplicate_key:
                    raise ApiError("VALIDATION_ERROR", details={"flag_key": "This flag key already exists."})
                flag_id = gts.execute(
                    text(
                        "INSERT INTO gt.gt_flags (id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                        "VALUES (CAST(:id AS uuid), CAST(:c AS uuid), :k, :h, :pts, :ma) "
                        "ON CONFLICT (challenge_version_id, code_hash) DO NOTHING RETURNING id"
                    ),
                    {
                        "id": str(uuid7()),
                        "c": challenge_id,
                        "k": body.flag_key,
                        "h": flag_code_hash(body.code),
                        "pts": body.points,
                        "ma": body.max_awards,
                    },
                ).scalar_one_or_none()
                if flag_id is None:
                    raise ApiError(
                        "VALIDATION_ERROR", details={"code": "This flag code already exists for this challenge."}
                    )
                audit_write(
                    gts,
                    actor_id=p.id,
                    actor_role=p.role,
                    action="gt.flag_added",
                    entity_type="gt_flag",
                    entity_id=str(flag_id),
                    request_id=request.state.request_id,
                    details={"flag_key": body.flag_key},
                    event_scope=f"challenge:{challenge_id}",
                )
        except IntegrityError:
            raise ApiError("VALIDATION_ERROR", details={"flag": "This flag key or code already exists."}) from None
        return {"flag_id": str(flag_id), "ok": True}


@router.patch("/admin/challenges/{challenge_id}/ground-truth/flags/{flag_id}")
def update_ground_truth_flag(
    challenge_id: str,
    flag_id: str,
    body: FlagPatchIn,
    request: Request,
    p: Principal = Depends(step_up_verified),
):
    from ..security import flag_code_hash

    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ApiError("VALIDATION_ERROR", details={"body": "Provide at least one field to update."})
    if any(value is None for value in changes.values()):
        raise ApiError("VALIDATION_ERROR", details={"body": "Fields may be omitted, but cannot be null."})
    with _editable_challenge_lock(challenge_id, p.tenant_id):
        try:
            with gt_session() as gts:
                current = (
                    gts.execute(
                        text(
                            "SELECT id, flag_key, code_hash, points, max_awards "
                            "FROM gt.gt_flags WHERE id = CAST(:id AS uuid) "
                            "AND challenge_version_id = CAST(:c AS uuid) FOR UPDATE"
                        ),
                        {"id": flag_id, "c": challenge_id},
                    )
                    .mappings()
                    .first()
                )
                if current is None:
                    raise ApiError("NOT_FOUND")

                flag_key = changes.get("flag_key", current["flag_key"])
                code_hash = flag_code_hash(changes["code"]) if "code" in changes else current["code_hash"]
                points = changes.get("points", current["points"])
                max_awards = changes.get("max_awards", current["max_awards"])

                duplicate_key = gts.execute(
                    text(
                        "SELECT 1 FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) "
                        "AND flag_key = :k AND id <> CAST(:id AS uuid)"
                    ),
                    {"c": challenge_id, "k": flag_key, "id": flag_id},
                ).first()
                if duplicate_key:
                    raise ApiError("VALIDATION_ERROR", details={"flag_key": "This flag key already exists."})
                duplicate_code = gts.execute(
                    text(
                        "SELECT 1 FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) "
                        "AND code_hash = :h AND id <> CAST(:id AS uuid)"
                    ),
                    {"c": challenge_id, "h": code_hash, "id": flag_id},
                ).first()
                if duplicate_code:
                    raise ApiError("VALIDATION_ERROR", details={"code": "This flag code already exists."})

                gts.execute(
                    text(
                        "UPDATE gt.gt_flags SET flag_key = :k, code_hash = :h, points = :pts, max_awards = :ma "
                        "WHERE id = CAST(:id AS uuid) AND challenge_version_id = CAST(:c AS uuid)"
                    ),
                    {"k": flag_key, "h": code_hash, "pts": points, "ma": max_awards, "id": flag_id, "c": challenge_id},
                )
                audit_write(
                    gts,
                    actor_id=p.id,
                    actor_role=p.role,
                    action="gt.flag_updated",
                    entity_type="gt_flag",
                    entity_id=flag_id,
                    request_id=request.state.request_id,
                    event_scope=f"challenge:{challenge_id}",
                    details={"flag_key": flag_key, "code_changed": "code" in changes},
                )
        except IntegrityError:
            raise ApiError("VALIDATION_ERROR", details={"flag": "This flag key or code already exists."}) from None
        return {"ok": True, "flag_id": flag_id}


class TestResultsIn(BaseModel):
    submission_id: str
    tests_passed: int = Field(ge=0)
    tests_total: int = Field(gt=0)


@router.post("/admin/challenges/{challenge_id}/ground-truth/test-results")
def record_test_results(
    challenge_id: str, body: TestResultsIn, request: Request, p: Principal = Depends(step_up_verified)
):
    """Organizer records offline functional-test results per submission (ADR-019):
    {submission_id, tests_passed, tests_total} -> enqueues ledger application."""
    if body.tests_passed > body.tests_total:
        raise ApiError("VALIDATION_ERROR", details={"tests": "tests_passed cannot exceed tests_total."})
    with app_session() as s:
        cv = require_challenge_in_tenant(s, challenge_id, p.tenant_id)  # REM-001 tenant scope
        # REM-001: the submission must belong to this challenge and tenant.
        sub = require_submission_in_tenant(s, body.submission_id, p.tenant_id)
        if str(sub["challenge_version_id"]) != challenge_id:
            raise ApiError("VALIDATION_ERROR", details={"submission_id": "Submission is not for this challenge."})
        enqueue(
            s,
            "apply_test_results",
            {
                "submission_id": body.submission_id,
                "tests_passed": body.tests_passed,
                "tests_total": body.tests_total,
                "actor_id": p.id,
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="scoring.test_results_recorded",
            entity_type="submission",
            entity_id=body.submission_id,
            request_id=request.state.request_id,
            details={"passed": body.tests_passed, "total": body.tests_total},
            event_scope=f"event:{cv['event_id']}",
        )
    return {"ok": True}


# Submissions that are past the live evaluation pipeline and may be re-run by
# an admin rescore operation (REM-007). Anything still pending review or in a
# non-terminal auto state must be finished first.
SUBMISSION_TERMINAL_STATES = frozenset(
    {"matched_auto", "duplicate", "rejected_auto", "decided", "ledgered", "disputed"}
)


class RescoreIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


# ANSWER-PACK (REM-007): a full immutable answer-pack data model
# (gt.answer_packs / gt.answer_pack_entries / one-active-pack index /
# two-approver activation / correction_id rescore job) is deferred. The rescore
# path below re-runs the existing evaluator against the current gt_revisions of
# the challenge, which is the deterministic replay the answer-pack pipeline
# would invoke; the per-pack versioning/audit surface is the remaining gap.
@router.post("/admin/submissions/{submission_id}/rescore", status_code=202)
def rescore_submission(submission_id: str, body: RescoreIn, request: Request, p: Principal = Depends(step_up_verified)):
    """Re-run evaluation for a terminal submission and record an audit entry (REM-007).

    The submission must be in a terminal state (matched_auto / duplicate /
    rejected_auto / decided / ledgered / disputed). Non-terminal submissions
    are still being processed by the live pipeline and are rejected with
    ``RESCORE_NOT_AVAILABLE`` so an admin cannot race the evaluator.
    """
    reason = _require_reason(body.reason)
    with app_session() as s:
        sub = require_submission_in_tenant(s, submission_id, p.tenant_id)  # REM-001 tenant scope
        if sub["status"] not in SUBMISSION_TERMINAL_STATES:
            raise ApiError(
                "RESCORE_NOT_AVAILABLE",
                details={"status": sub["status"]},
            )
        # Reset the submission to a re-evaluatable state and re-enqueue the
        # deterministic evaluator. The evaluator is idempotent for already-awarded
        # units (claim_award_unit deduplicates on award_unit_id), so a re-run is
        # safe; ledger history stays append-only.
        s.execute(
            text("UPDATE app.submissions SET status='received', matched_bug_code=NULL WHERE id = CAST(:s AS uuid)"),
            {"s": submission_id},
        )
        enqueue(s, "evaluate_submission", {"submission_id": submission_id})
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="scoring.rescore_requested",
            entity_type="submission",
            entity_id=submission_id,
            request_id=request.state.request_id,
            event_scope=f"event:{sub['event_id']}",
            details={"reason": reason, "prior_status": sub["status"]},
        )
    return {"ok": True, "submission_id": submission_id}


# --- live ops -------------------------------------------------------------------


class AnnouncementIn(BaseModel):
    severity: str = Field(default="info", pattern="^(info|warning|critical)$")
    body: str = Field(min_length=3, max_length=1000)


@router.post("/admin/events/{event_id}/announcements", status_code=201)
def create_announcement(
    event_id: str, body: AnnouncementIn, request: Request, p: Principal = Depends(require_organizer)
):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        s.execute(
            text(
                "INSERT INTO app.announcements (id, event_id, severity, body, created_by) VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :sev, :b, CAST(:u AS uuid))"
            ),
            {"id": str(uuid7()), "e": event_id, "sev": body.severity, "b": body.body, "u": p.id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="announcement.created",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"severity": body.severity},
        )
    return {"ok": True}


class TimeAdjustmentIn(BaseModel):
    stage_id: str
    delta_seconds: int
    reason_code: str = Field(default="OTHER", pattern="^(ACCOMMODATION|OUTAGE|DEVICE_FAILURE|OTHER)$")
    reason: str = Field(min_length=3, max_length=500)
    user_id: str | None = None


@router.post("/admin/events/{event_id}/time-adjustment")
def time_adjustment(
    event_id: str,
    body: TimeAdjustmentIn,
    request: Request,
    p: Principal = Depends(step_up_verified),
):
    # TWO-PERSON (REM-005): a second approver for large time extensions is
    # deferred to v1; step-up + a mandatory audited reason is enforced here.
    reason = _require_reason(body.reason)
    if body.delta_seconds == 0:
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "nonzero delta_seconds required."})
    if abs(body.delta_seconds) > 86400:
        raise ApiError(
            "VALIDATION_ERROR",
            details={"delta_seconds": "Time adjustments must be within +/- 86400 seconds."},
        )
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        stage = require_stage_in_tenant(s, body.stage_id, p.tenant_id)  # REM-001 tenant scope
        if str(stage["event_id"]) != event_id:
            raise ApiError("VALIDATION_ERROR", details={"stage_id": "Stage must belong to the selected event."})
        if body.user_id:
            participant = s.execute(
                text(
                    "SELECT 1 FROM app.team_members tm "
                    "JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.users u ON u.id = tm.user_id "
                    "WHERE tm.user_id = CAST(:u AS uuid) AND t.event_id = CAST(:e AS uuid) "
                    "AND u.role = 'participant'"
                ),
                {"u": body.user_id, "e": event_id},
            ).first()
            if participant is None:
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"user_id": "Participant must have an active team membership in the selected event."},
                )
        s.execute(
            text(
                "INSERT INTO app.time_adjustments (id, stage_id, user_id, delta_seconds, reason_code, created_by) VALUES (CAST(:id AS uuid), CAST(:s AS uuid), CAST(:u AS uuid), :d, :r, CAST(:by AS uuid))"
            ),
            {
                "id": str(uuid7()),
                "s": body.stage_id,
                "u": body.user_id,
                "d": body.delta_seconds,
                "r": body.reason_code,
                "by": p.id,
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="stage.time_adjustment",
            entity_type="stage",
            entity_id=body.stage_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={
                "delta_seconds": body.delta_seconds,
                "reason_code": body.reason_code,
                "reason": reason,
                "user_id": body.user_id,
            },
        )
    return {"ok": True}


@router.get("/admin/events/{event_id}/live")
def live_ops(event_id: str, p: Principal = Depends(require_organizer)):
    """Control-room view with REAL state (ADM-LV-01); no fabricated indicators."""
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        counts = s.execute(
            text("SELECT status, count(*) FROM app.submissions WHERE event_id = CAST(:e AS uuid) GROUP BY status"),
            {"e": event_id},
        ).all()
        teams = s.execute(
            text("SELECT count(*) FROM app.teams WHERE event_id = CAST(:e AS uuid)"), {"e": event_id}
        ).scalar_one()
        participants = s.execute(
            text(
                "SELECT count(DISTINCT tm.user_id) FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id WHERE t.event_id = CAST(:e AS uuid)"
            ),
            {"e": event_id},
        ).scalar_one()
        queue_age = s.execute(
            text(
                "SELECT COALESCE(MIN(EXTRACT(epoch FROM (now() - created_at))), 0) FROM app.jobs WHERE status='queued'"
            ),
        ).scalar_one()
        dead = s.execute(text("SELECT count(*) FROM app.jobs WHERE status='dead'")).scalar_one()
        stages = (
            s.execute(
                text(
                    "SELECT id, name, kind, status, starts_at, ends_at, config FROM app.stages WHERE event_id = CAST(:e AS uuid) "
                    "ORDER BY (kind = 'level') ASC, ordinal ASC"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
        rev_backlog = s.execute(text("SELECT count(*) FROM app.review_items WHERE status='open'")).scalar_one()
        probes = health_probe()
    return {
        "teams": int(teams),
        "participants_online_estimate": int(
            participants
        ),  # participants with accounts; live presence needs polling stats
        "submission_counts": {r[0]: int(r[1]) for r in counts},
        "job_queue": {"oldest_queued_age_s": int(queue_age), "dead_letters": int(dead)},
        "review_backlog": int(rev_backlog),
        "stages": [dict(r) for r in stages],
        "health": probes,
        "kill_switches": {
            "runner_enabled": settings.runner_enabled,
            "ai_assessment_enabled": settings.ai_assessment_enabled,
            "telemetry_enabled": settings.telemetry_enabled,
        },
    }


# --- readiness, audit, exports -------------------------------------------------


@router.get("/admin/events/{event_id}/readiness")
def readiness(event_id: str, p: Principal = Depends(require_organizer)):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        rows = (
            s.execute(
                text(
                    "SELECT key, label, state, owner, checked_at FROM app.readiness_items WHERE event_id = CAST(:e AS uuid) ORDER BY key"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
    return {"items": [dict(r) for r in rows]}


class ReadinessIn(BaseModel):
    state: str = Field(default="checked", pattern="^(checked|unchecked|na)$")


@router.post("/admin/events/{event_id}/readiness/{key}")
def set_readiness(
    event_id: str, key: str, body: ReadinessIn, request: Request, p: Principal = Depends(require_organizer)
):
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        s.execute(
            text(
                "UPDATE app.readiness_items SET state=CAST(:st AS varchar), checked_at=CASE WHEN CAST(:st AS varchar)='checked' THEN now() ELSE NULL END WHERE event_id = CAST(:e AS uuid) AND key = :k"
            ),
            {"st": body.state, "e": event_id, "k": key},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="readiness.updated",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"key": key, "state": body.state},
        )
    return {"ok": True}


@router.get("/admin/audit/verify")
def audit_chain_verify(p: Principal = Depends(require_organizer)):
    # REM-017: audit_verify now walks ALL scopes by default (the audit.py core
    # is fixed); the admin endpoint just surfaces the combined result.
    with app_session() as s:
        result = audit_verify(s)
    return result


@router.get("/admin/audit")
def audit_log(
    p: Principal = Depends(require_organizer),
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    action: str | None = None,
    actor_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
):
    """Cursor-paginated audit log (REM-028) with filters (REM-028).

    The audit chain is global; tenant isolation of audit reads is enforced by
    requiring the organizer role, which is itself tenant-bound. A per-tenant
    audit filter is a future refinement.
    """
    clauses: list[str] = []
    binds: dict = {"n": limit}
    total_clauses: list[str] = []
    total_binds: dict = {}
    if action:
        clauses.append("action = :action")
        binds["action"] = action
        total_clauses.append("action = :action")
        total_binds["action"] = action
    if actor_id:
        clauses.append("actor_id = CAST(:actor_id AS uuid)")
        binds["actor_id"] = actor_id
        total_clauses.append("actor_id = CAST(:actor_id AS uuid)")
        total_binds["actor_id"] = actor_id
    if entity_type:
        clauses.append("entity_type = :entity_type")
        binds["entity_type"] = entity_type
        total_clauses.append("entity_type = :entity_type")
        total_binds["entity_type"] = entity_type
    if entity_id:
        clauses.append("entity_id = CAST(:entity_id AS uuid)")
        binds["entity_id"] = entity_id
        total_clauses.append("entity_id = CAST(:entity_id AS uuid)")
        total_binds["entity_id"] = entity_id
    if cursor:
        try:
            cur_seq = int(cursor)
        except ValueError as err:
            raise ApiError("VALIDATION_ERROR", details={"cursor": "Invalid cursor."}) from err
        clauses.append("seq < :cur_seq")
        binds["cur_seq"] = cur_seq
    where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    total_where_sql = ("WHERE " + " AND ".join(total_clauses)) if total_clauses else ""
    with app_session() as s:
        rows = (
            s.execute(
                text(
                    "SELECT seq, ts, actor_role, action, entity_type, entity_id, request_id, details "
                    f"FROM audit.entries {where_sql} ORDER BY seq DESC LIMIT :n"
                ),
                binds,
            )
            .mappings()
            .all()
        )
        total = s.execute(text(f"SELECT count(*) FROM audit.entries {total_where_sql}"), total_binds).scalar_one()
    items = [dict(r) for r in rows]
    next_cursor = str(items[-1]["seq"]) if items and len(items) >= limit else None
    return {"entries": items, "next_cursor": next_cursor, "total": int(total)}


@router.get("/admin/events/{event_id}/export/{kind}")
def export_csv(event_id: str, kind: str, request: Request, p: Principal = Depends(require_organizer)):
    if kind not in ("results", "submissions", "ledger"):
        raise ApiError("VALIDATION_ERROR", details={"kind": "results|submissions|ledger"})
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    created_by = p.id
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        if kind == "results":
            writer.writerow(["team_id", "team_name", "score"])
            rows = s.execute(
                text(
                    "SELECT t.id, t.name, COALESCE(SUM(l.points), 0) AS total FROM app.teams t "
                    "LEFT JOIN app.score_ledger_entries l ON l.team_id = t.id "
                    "WHERE t.event_id = CAST(:e AS uuid) GROUP BY t.id, t.name ORDER BY total DESC"
                ),
                {"e": event_id},
            ).all()
            for r in rows:
                writer.writerow([str(r[0]), r[1], float(r[2] or 0)])
        elif kind == "submissions":
            writer.writerow(
                [
                    "submission_id",
                    "kind",
                    "title",
                    "status",
                    "receipt_code",
                    "received_at",
                    "file_path",
                    "line_start",
                    "line_end",
                ]
            )
            rows = s.execute(
                text(
                    "SELECT id, kind, title, status, receipt_code, received_at, file_path, line_start, line_end FROM app.submissions WHERE event_id = CAST(:e AS uuid) ORDER BY received_at"
                ),
                {"e": event_id},
            ).all()
            for r in rows:
                writer.writerow([str(r[0]), r[1], r[2], r[3], r[4], r[5].isoformat(), r[6], r[7], r[8]])
        else:  # ledger
            writer.writerow(
                [
                    "entry_id",
                    "stage_id",
                    "team_id",
                    "component",
                    "kind",
                    "points",
                    "reason_code",
                    "submission_id",
                    "created_at",
                ]
            )
            rows = s.execute(
                text(
                    "SELECT id, stage_id, team_id, component, kind, points, reason_code, submission_id, created_at FROM app.score_ledger_entries WHERE event_id = CAST(:e AS uuid) ORDER BY created_at"
                ),
                {"e": event_id},
            ).all()
            for r in rows:
                writer.writerow(
                    [
                        str(r[0]),
                        str(r[1]),
                        str(r[2]),
                        r[3],
                        r[4],
                        float(r[5]),
                        r[6],
                        str(r[7]) if r[7] else "",
                        r[8].isoformat(),
                    ]
                )
    content = buf.getvalue()
    content_hash = hashlib.sha256(content.encode()).hexdigest()
    with app_session() as s:
        s.execute(
            text(
                "INSERT INTO app.exports (id, event_id, kind, content, content_hash, created_by) VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :k, :c, :h, CAST(:u AS uuid))"
            ),
            {
                "id": str(uuid7()),
                "e": event_id,
                "k": f"{kind}_csv",
                "c": content,
                "h": content_hash,
                "u": created_by,
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="event.exported",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            event_scope=f"event:{event_id}",
            details={"kind": kind, "content_hash": content_hash},
        )
    return {"filename": f"{kind}_{event_id[:8]}.csv", "content": content}


# --- disputes -------------------------------------------------------------------


@router.get("/admin/disputes")
def list_disputes(
    p: Principal = Depends(require_organizer),
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    status: str | None = None,
    event_id: str | None = None,
    team_id: str | None = None,
):
    """Tenant-scoped dispute list (REM-001) with cursor pagination (REM-028)."""
    with app_session() as s:
        tid = require_tenant(s, p.tenant_id)
        clauses = ["sub.tenant_id = CAST(:tid AS uuid)"]
        binds: dict = {"tid": tid, "n": limit}
        if status:
            clauses.append("d.status = :status")
            binds["status"] = status
        if event_id:
            clauses.append("sub.event_id = CAST(:event_id AS uuid)")
            binds["event_id"] = event_id
        if team_id:
            clauses.append("d.team_id = CAST(:team_id AS uuid)")
            binds["team_id"] = team_id
        if cursor:
            try:
                cur_ts, cur_id = cursor.split(" ", 1)
            except ValueError as err:
                raise ApiError("VALIDATION_ERROR", details={"cursor": "Invalid cursor."}) from err
            clauses.append("(d.created_at, d.id) < (CAST(:cts AS timestamptz), CAST(:cid AS uuid))")
            binds["cts"] = cur_ts
            binds["cid"] = cur_id
        rows = (
            s.execute(
                text(
                    "SELECT d.id, d.status, d.statement, d.created_at, d.resolved_at, d.resolved_by, "
                    "s.title, s.receipt_code, d.submission_id, d.id AS _cursor_id "
                    "FROM app.disputes d JOIN app.submissions s ON s.id = d.submission_id "
                    "WHERE " + " AND ".join(clauses) + " ORDER BY d.created_at DESC, d.id DESC LIMIT :n"
                ),
                binds,
            )
            .mappings()
            .all()
        )
        total_clauses = [c for c in clauses if not c.startswith("(d.created_at, d.id)")]
        total_binds = {k: v for k, v in binds.items() if k in {"tid", "status", "event_id", "team_id"}}
        total = s.execute(
            text(
                "SELECT count(*) FROM app.disputes d JOIN app.submissions s ON s.id = d.submission_id WHERE "
                + " AND ".join(total_clauses)
            ),
            total_binds,
        ).scalar_one()
    items = [dict(r) for r in rows]
    next_cursor = None
    if len(items) >= limit:
        last = items[-1]
        next_cursor = f"{last['created_at'].isoformat()} {last['_cursor_id']}"
    for it in items:
        it.pop("_cursor_id", None)
    return {"disputes": items, "next_cursor": next_cursor, "total": int(total)}


class DisputeResolveIn(BaseModel):
    outcome: str = Field(pattern="^(upheld|rejected)$")
    resolution: str = Field(min_length=3, max_length=2000)
    adjust_points: float | None = None


@router.post("/admin/disputes/{dispute_id}/resolve")
def resolve_dispute(
    dispute_id: str,
    body: DisputeResolveIn,
    request: Request,
    p: Principal = Depends(step_up_verified),
):
    # TWO-PERSON (REM-048): a second independent approver for material point
    # changes is deferred to v1; step-up + a mandatory audited reason is
    # enforced here. Re-resolution is rejected as idempotent.
    with app_session() as s:
        d = require_dispute_in_tenant(s, dispute_id, p.tenant_id)  # REM-001 tenant scope
        # Re-lock the dispute row inside this transaction.
        d_locked = (
            s.execute(
                text(
                    "SELECT di.id, di.submission_id, di.team_id, di.status, di.resolved_by, di.resolved_at, "
                    "s.stage_id, s.event_id "
                    "FROM app.disputes di JOIN app.submissions s ON s.id = di.submission_id "
                    "WHERE di.id = CAST(:id AS uuid) FOR UPDATE"
                ),
                {"id": dispute_id},
            )
            .mappings()
            .first()
        )
        if d_locked is None:
            raise ApiError("NOT_FOUND")
        if d_locked["status"] in ("upheld", "rejected"):
            # REM-048 idempotency: a second resolve on the same dispute is a
            # conflict, not a silent no-op, so the operator sees the prior
            # resolution instead of believing a new one was applied.
            raise ApiError(
                "IDEMPOTENCY_CONFLICT",
                details={
                    "dispute_id": dispute_id,
                    "status": d_locked["status"],
                    "resolved_by": str(d_locked["resolved_by"]) if d_locked["resolved_by"] else None,
                    "resolved_at": d_locked["resolved_at"].isoformat() if d_locked["resolved_at"] else None,
                },
            )
        s.execute(
            text(
                "UPDATE app.disputes SET status=:o, resolution=:r, resolved_by=CAST(:u AS uuid), resolved_at=now() "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"o": body.outcome, "r": body.resolution, "u": p.id, "id": dispute_id},
        )
        if body.outcome == "upheld" and body.adjust_points:
            # rescoring via ledger adjustment (DAT-05): reversal + new entry
            stage_id = str(d_locked["stage_id"])
            team_id = str(d_locked["team_id"])
            event_id = str(d_locked["event_id"])
            tenant_id = d["tenant_id"]
            add_ledger_entry(
                s,
                tenant_id=str(tenant_id),
                event_id=event_id,
                stage_id=stage_id,
                team_id=team_id,
                component="adjustment",
                kind="adjustment",
                points=float(body.adjust_points),
                reason_code="DISPUTE_UPHELD",
                submission_id=str(d_locked["submission_id"]),
                actor_id=p.id,
                note=f"Dispute {dispute_id[:8]} upheld: {body.resolution[:200]}",
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="dispute.resolved",
            entity_type="dispute",
            entity_id=dispute_id,
            request_id=request.state.request_id,
            event_scope=f"event:{d_locked['event_id']}",
            details={
                "outcome": body.outcome,
                "resolution": body.resolution,
                "adjust_points": body.adjust_points,
            },
        )
    return {"ok": True}


class ManualAdjustmentIn(BaseModel):
    stage_id: str
    team_id: str
    points: float
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/admin/adjustments")
def manual_adjustment(body: ManualAdjustmentIn, request: Request, p: Principal = Depends(admin_step_up_verified)):
    """Admin-only manual score adjustment; requires recent password step-up."""
    if body.points == 0:
        raise ApiError(
            "VALIDATION_ERROR", details={"adjustment": "stage_id, team_id, nonzero points, reason required."}
        )
    if abs(body.points) > 10000:
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "Points must be within +/-10000."})
    with app_session() as s:
        stage = require_stage_in_tenant(s, body.stage_id, p.tenant_id)  # REM-001 tenant scope
        team = require_team_in_tenant(s, body.team_id, p.tenant_id)  # REM-001 tenant scope
        if str(team["event_id"]) != str(stage["event_id"]):
            raise ApiError("VALIDATION_ERROR", details={"team_id": "Team must belong to the stage event."})
        event_id = str(stage["event_id"])
        tenant_id = s.execute(
            text("SELECT tenant_id FROM app.events WHERE id = CAST(:e AS uuid)"), {"e": event_id}
        ).scalar_one()
        add_ledger_entry(
            s,
            tenant_id=str(tenant_id),
            event_id=event_id,
            stage_id=body.stage_id,
            team_id=body.team_id,
            component="adjustment",
            kind="adjustment",
            points=body.points,
            reason_code="MANUAL",
            actor_id=p.id,
            note=body.reason,
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="scoring.manual_adjustment",
            entity_type="team",
            entity_id=body.team_id,
            request_id=request.state.request_id,
            details={"points": body.points, "reason": body.reason},
            event_scope=f"event:{event_id}",
        )
    return {"ok": True}


@router.get("/admin/system/health")
def system_health(p: Principal = Depends(require_organizer)):
    """Operational health signals for incident diagnosis (REM-056).

    Surfaces job queue depth by status, oldest queued job age, outbox backlog,
    dead-letter count, and DB pool pressure alongside the basic DB reachability
    probe so an operator can tell an API-alive / worker-degraded split apart.
    """
    probes = health_probe()
    with app_session() as s:
        jobs = s.execute(text("SELECT status, count(*) FROM app.jobs GROUP BY status")).all()
        oldest = s.execute(
            text(
                "SELECT COALESCE(MIN(EXTRACT(epoch FROM (now() - created_at))), 0) FROM app.jobs WHERE status='queued'"
            )
        ).scalar_one()
        outbox_depth = s.execute(text("SELECT count(*) FROM app.outbox_events WHERE delivered_at IS NULL")).scalar_one()
        outbox_oldest = s.execute(
            text(
                "SELECT COALESCE(MIN(EXTRACT(epoch FROM (now() - created_at))), 0) "
                "FROM app.outbox_events WHERE delivered_at IS NULL"
            )
        ).scalar_one()
        review_backlog = s.execute(
            text("SELECT count(*) FROM app.review_items WHERE status IN ('open','in_review')")
        ).scalar_one()
        open_disputes = s.execute(text("SELECT count(*) FROM app.disputes WHERE status='open'")).scalar_one()
    # DB pool stats are cheap to read from the SQLAlchemy engine status; surface
    # them so an operator can spot pool exhaustion without a separate metrics endpoint.
    pool = app_engine.pool
    pool_status = {
        "size": getattr(pool, "size", lambda: None)(),
        "checked_in": getattr(pool, "checkedin", lambda: None)(),
        "checked_out": getattr(pool, "checkedout", lambda: None)(),
        "overflow": getattr(pool, "overflow", lambda: None)(),
    }
    return {
        "databases": {"app": probes["database_app"], "gt": probes["database_gt"]},
        "jobs": {r[0]: int(r[1]) for r in jobs},
        "job_queue_depth": int((jobs and sum(int(r[1]) for r in jobs if r[0] == "queued")) or 0),
        "oldest_queued_job_age_s": int(oldest),
        "outbox": {
            "depth": int(outbox_depth),
            "oldest_undelivered_age_s": int(outbox_oldest),
        },
        "review_backlog": int(review_backlog),
        "open_disputes": int(open_disputes),
        "db_pool": pool_status,
        "clock": probes.get("clock"),
        "profile": settings.profile,
        "environment": settings.environment,
        "runner_enabled": settings.runner_enabled,
        "ai_assessment_enabled": settings.ai_assessment_enabled,
    }
