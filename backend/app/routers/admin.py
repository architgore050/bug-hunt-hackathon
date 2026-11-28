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
import math
import uuid
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .. import security
from ..audit import audit_verify, audit_write
from ..config import settings
from ..db import app_session, gt_session, health_probe, uuid7
from ..deps import Principal, require_organizer, step_up_verified
from ..errors import ApiError
from ..jobs import enqueue
from ..scoring import add_ledger_entry

router = APIRouter(tags=["admin"])


# --- shared input validation (F-C-06 / F-C-18) ----------------------------------

# The score ledger stores NUMERIC(10,2); this is the technical column limit,
# not a scoring policy. The repository defines no authoritative per-event
# maximum adjustment; that cap is an open organizer decision (see the
# Section 5.1 remediation report).
_MAX_LEDGER_POINTS = Decimal("99999999.99")

# Stage control 'extend' accepts 1..3600 s per call (admin.py extend action,
# documented in docs/API_REFERENCE.md). Time adjustments reuse that documented
# per-action ceiling so a single request cannot shift a deadline by hours.
_MAX_TIME_ADJUSTMENT_SECONDS = 3600


def _validated_points(value: object, *, field: str) -> Decimal:
    """Finite-number validation for ledger adjustments (F-C-06).

    Rejects NaN, infinities, booleans, non-numeric strings and values beyond
    the NUMERIC(10,2) ledger column BEFORE any ledger or audit row is written,
    so invalid input can never poison SUM(points).
    """
    if value is None or isinstance(value, bool):
        raise ApiError("VALIDATION_ERROR", details={field: "A finite numeric value is required."})
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ApiError("VALIDATION_ERROR", details={field: "A finite numeric value is required."}) from None
    if not number.is_finite():
        raise ApiError(
            "VALIDATION_ERROR", details={field: "Points must be a finite number (NaN and infinity are rejected)."}
        )
    if abs(number) > _MAX_LEDGER_POINTS:
        raise ApiError("VALIDATION_ERROR", details={field: f"Absolute value must not exceed {_MAX_LEDGER_POINTS}."})
    return number


def _validated_delta_seconds(value: object) -> int:
    """Range/type validation for time-adjustment deltas (F-C-18).

    Rejects NaN, infinity, booleans, non-integral and non-numeric input, and
    deltas whose absolute value exceeds the documented per-call extend cap.
    """
    if value is None or isinstance(value, bool):
        raise ApiError("VALIDATION_ERROR", details={"delta_seconds": "An integer number of seconds is required."})
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise ApiError("VALIDATION_ERROR", details={"delta_seconds": "An integer number of seconds is required."})
    try:
        delta = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ApiError(
            "VALIDATION_ERROR", details={"delta_seconds": "An integer number of seconds is required."}
        ) from None
    if abs(delta) > _MAX_TIME_ADJUSTMENT_SECONDS:
        raise ApiError(
            "VALIDATION_ERROR",
            details={"delta_seconds": f"Absolute value must not exceed {_MAX_TIME_ADJUSTMENT_SECONDS} seconds."},
        )
    return delta


def _is_uuid(value: object) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return True


# --- events -------------------------------------------------------------------


class EventIn(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    slug: str = Field(min_length=3, max_length=80, pattern="^[a-z0-9-]+$")
    starts_at: str | None = None
    # F-C-18: negative durations would put ends_at in the past at event start
    # (make_interval(mins => duration_minutes)); positive is required. An upper
    # bound is an organizer policy decision the repository does not define.
    duration_minutes: int = Field(default=180, gt=0)
    max_participants: int = 50
    max_teams: int = 12
    timezone: str = "Asia/Kolkata"


@router.post("/admin/events", status_code=201)
def create_event(body: EventIn, request: Request, p: Principal = Depends(require_organizer)):
    with app_session() as s:
        tenant = s.execute(text("SELECT id FROM app.tenants ORDER BY created_at LIMIT 1")).first()
        if tenant is None:
            raise ApiError("VALIDATION_ERROR", details={"tenant": "No tenant exists. Run the seed script."})
        ev_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.events "
                "(id, tenant_id, slug, name, starts_at, timezone, duration_minutes, max_participants, max_teams, config) "
                "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), :slug, :name, CAST(:starts AS timestamptz), "
                ":timezone, :dur, :mp, :mt, CAST(:cfg AS jsonb))"
            ),
            {
                "id": ev_id,
                "t": str(tenant[0]),
                "slug": body.slug,
                "name": body.name,
                "starts": body.starts_at,
                "timezone": body.timezone,
                "dur": body.duration_minutes,
                "mp": body.max_participants,
                "mt": body.max_teams,
                "cfg": json.dumps(
                    {
                        "features": {
                            "runner_enabled": settings.runner_enabled,
                            "ai_assessment_enabled": settings.ai_assessment_enabled,
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


@router.post("/admin/events/{event_id}/status")
def set_event_status(event_id: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    target = body.get("status")
    with app_session() as s:
        cur = s.execute(
            text("SELECT status FROM app.events WHERE id = CAST(:e AS uuid) FOR UPDATE"), {"e": event_id}
        ).first()
        if cur is None:
            raise ApiError("NOT_FOUND")
        if target not in EVENT_TRANSITIONS.get(cur[0], set()):
            raise ApiError("VALIDATION_ERROR", details={"transition": f"Cannot move from {cur[0]} to {target}."})
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
        s.execute(text("UPDATE app.events SET status=:st WHERE id = CAST(:e AS uuid)"), {"st": target, "e": event_id})
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="event.status_changed",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            details={"from": cur[0], "to": target},
        )
    return {"ok": True, "status": target}


# Scoring weights are validated at configuration freeze; the three components
# and their 1.0 sum are the documented scoring model (docs/SCORING_MODEL.md 2).
REQUIRED_WEIGHT_COMPONENTS = ("functional_test", "code_review", "evidence_report")


def _validated_weights(config: dict, *, require_complete: bool) -> None:
    """F-C-13: validate scoring weights with clean errors before the freeze transaction.

    Rejects non-numeric values (previously an unhandled ValueError -> 500),
    NaN/infinite values (previously passed the sum comparison because every
    comparison against NaN is false) and negative weights. When freezing, the
    three documented weight components must all be present.
    """
    scoring = config.get("scoring")
    weights = scoring.get("weights") if isinstance(scoring, dict) else None
    if weights is None:
        if require_complete:
            raise ApiError(
                "VALIDATION_ERROR", details={"weights": "Configuration must include scoring.weights before freezing."}
            )
        return
    if not isinstance(weights, dict):
        raise ApiError("VALIDATION_ERROR", details={"weights": "scoring.weights must be an object."})
    if require_complete:
        missing = [c for c in REQUIRED_WEIGHT_COMPONENTS if c not in weights]
        if missing:
            raise ApiError("VALIDATION_ERROR", details={"weights": f"Missing weight components: {', '.join(missing)}."})
    parsed: dict[str, float] = {}
    for key, raw in weights.items():
        if key not in REQUIRED_WEIGHT_COMPONENTS:
            raise ApiError("VALIDATION_ERROR", details={"weights": f"Unknown weight component: '{key}'."})
        if isinstance(raw, bool):
            raise ApiError("VALIDATION_ERROR", details={"weights": f"Weight '{key}' must be numeric."})
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ApiError("VALIDATION_ERROR", details={"weights": f"Weight '{key}' is not a number."}) from None
        if not math.isfinite(value):
            raise ApiError(
                "VALIDATION_ERROR",
                details={"weights": f"Weight '{key}' must be finite (NaN and infinity are rejected)."},
            )
        if value < 0:
            raise ApiError("VALIDATION_ERROR", details={"weights": f"Weight '{key}' must not be negative."})
        parsed[str(key)] = value
    if parsed and abs(sum(parsed.values()) - 1.0) > 0.001:
        raise ApiError("VALIDATION_ERROR", details={"weights": "Scoring weights must sum to 1.0."})


class ConfigIn(BaseModel):
    config: dict
    reason: str = Field(min_length=5, max_length=500)
    freeze: bool = False


@router.post("/admin/events/{event_id}/config")
def revise_config(event_id: str, body: ConfigIn, request: Request, p: Principal = Depends(require_organizer)):
    """New config revision with reason; publication freezes the snapshot (DAT-04)."""
    # F-C-13: all validation runs BEFORE the freeze transaction starts, so a
    # rejected freeze can never leave a partially applied configuration.
    _validated_weights(body.config, require_complete=body.freeze)
    scoring = body.config.get("scoring")
    if isinstance(scoring, dict) and scoring.get("ctf_bonus_cap_points") is not None:
        cap = scoring["ctf_bonus_cap_points"]
        if isinstance(cap, bool):
            raise ApiError("VALIDATION_ERROR", details={"ctf_bonus_cap_points": "Must be numeric."})
        try:
            cap_value = float(cap)
        except (TypeError, ValueError):
            raise ApiError("VALIDATION_ERROR", details={"ctf_bonus_cap_points": "Must be numeric."}) from None
        if not math.isfinite(cap_value) or cap_value <= 0:
            raise ApiError("VALIDATION_ERROR", details={"ctf_bonus_cap_points": "Must be a positive finite number."})
    try:
        canonical = json.dumps(body.config, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except ValueError:
        # a NaN/Infinity anywhere else in the document is not valid JSONB
        raise ApiError("VALIDATION_ERROR", details={"config": "Values must be valid JSON (NaN rejected)."}) from None
    rule_set_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    with app_session() as s:
        ev = s.execute(text("SELECT id FROM app.events WHERE id = CAST(:e AS uuid)"), {"e": event_id}).first()
        if ev is None:
            raise ApiError("NOT_FOUND")
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
                "cfg": canonical,
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
                {"cfg": canonical, "e": event_id},
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="event.config_revised",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            details={"version": int(ver) + 1, "frozen": body.freeze, "reason": body.reason},
        )
    return {"ok": True, "rule_set_hash": rule_set_hash}


@router.get("/admin/events/{event_id}/config/revisions")
def list_config_revisions(event_id: str, p: Principal = Depends(require_organizer)):
    """Return current event config and the bounded immutable revision history."""
    with app_session() as s:
        event = (
            s.execute(
                text("SELECT config, config_version FROM app.events WHERE id = CAST(:e AS uuid)"),
                {"e": event_id},
            )
            .mappings()
            .first()
        )
        if event is None:
            raise ApiError("NOT_FOUND")
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
def list_events(p: Principal = Depends(require_organizer)):
    with app_session() as s:
        rows = (
            s.execute(
                text(
                    "SELECT id, slug, name, status, starts_at, ends_at, timezone, duration_minutes, "
                    "max_participants, max_teams, rules_version, config_version FROM app.events ORDER BY created_at DESC"
                )
            )
            .mappings()
            .all()
        )
    return {"events": [dict(r) for r in rows]}


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
    if body.kind != "main":
        raise ApiError(
            "VALIDATION_ERROR", details={"kind": "Only main stages can be created here; use level bootstrap."}
        )
    cfg = {**DEFAULT_STAGE_CONFIG, **body.config}
    canonical = json.dumps(cfg, sort_keys=True, separators=(",", ":"))
    rsh = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    # F-C-16: application-side MAX+1 alone is racy; the database now enforces
    # UNIQUE (event_id, kind, ordinal) (migration 0004). On a conflict with a
    # concurrent creation, recompute MAX+1 and retry; the whole attempt
    # (ordinal read, insert, audit row) is one transaction, so a failed
    # attempt rolls back cleanly before the next one.
    for attempt in range(5):
        try:
            with app_session() as s:
                ordinal = s.execute(
                    text("SELECT COALESCE(MAX(ordinal), 0) FROM app.stages WHERE event_id = CAST(:e AS uuid)"),
                    {"e": event_id},
                ).scalar_one()
                st_id = str(uuid7())
                s.execute(
                    text(
                        "INSERT INTO app.stages "
                        "(id, event_id, name, kind, ordinal, grace_seconds, config, rule_set_hash) "
                        "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :name, :kind, :ord, :grace, "
                        "CAST(:cfg AS jsonb), :rsh)"
                    ),
                    {
                        "id": st_id,
                        "e": event_id,
                        "name": body.name,
                        "kind": body.kind,
                        "ord": int(ordinal) + 1,
                        "grace": body.grace_seconds,
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
                    details={"rule_set_hash": rsh, "ordinal": int(ordinal) + 1},
                )
            return {"stage_id": st_id, "rule_set_hash": rsh}
        except IntegrityError as exc:
            if not _is_stage_ordinal_conflict(exc):
                raise  # unrelated integrity errors keep their existing behavior
            if attempt == 4:
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"ordinal": "Concurrent stage creation conflicted. Retry the request."},
                ) from exc
    raise ApiError("VALIDATION_ERROR", details={"ordinal": "Concurrent stage creation conflicted. Retry the request."})


def _is_stage_ordinal_conflict(exc: IntegrityError) -> bool:
    """True only for a unique violation of ux_stages_event_kind_ordinal.

    psycopg3 exposes the SQLSTATE as `sqlstate` (pgcode is the psycopg2 name);
    both are accepted here.
    """
    orig = getattr(exc, "orig", None)
    if orig is None:
        return False
    state = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return bool(
        state == "23505"
        and getattr(getattr(orig, "diag", None), "constraint_name", None) == "ux_stages_event_kind_ordinal"
    )


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


@router.post("/admin/stages/{stage_id}/control")
def control_stage(stage_id: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    """arm / start / pause / resume / extend / end - reason code required (ADM-LV-02)."""
    action = body.get("action")
    reason = body.get("reason", "")
    if not reason:
        raise ApiError("VALIDATION_ERROR", details={"reason": "A reason code is required for stage control."})
    mapping = {
        "seal": ("draft", "sealed"),
        "arm": ("sealed", "armed"),
        "start": ("armed", "active"),
        "resume": ("paused", "active"),
        "pause": ("active", "paused"),
        "end": ("active", "ended"),
    }
    with app_session() as s:
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
            # TIM-05: shift ends_at by the pause duration measured from the real
            # active -> paused transition, not stage start or an extend action's
            # paused -> paused audit row. Legacy builds recorded 'pause' as the
            # resulting status, so accept that spelling as well.
            paused_at = s.execute(
                text(
                    "SELECT created_at FROM app.stage_transitions WHERE stage_id = CAST(:s AS uuid) "
                    "AND from_status = 'active' AND to_status IN ('paused', 'pause') "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"s": stage_id},
            ).scalar_one_or_none()
            if paused_at is not None:
                s.execute(
                    text(
                        "UPDATE app.stages SET status='active', ends_at = ends_at + make_interval(secs => LEAST(7200, GREATEST(0, EXTRACT(epoch FROM (CAST(:now AS timestamptz) - CAST(:p AS timestamptz)))::int))) WHERE id = CAST(:s AS uuid)"
                    ),
                    {"s": stage_id, "p": paused_at, "now": now},
                )
            else:
                s.execute(text("UPDATE app.stages SET status='active' WHERE id = CAST(:s AS uuid)"), {"s": stage_id})
        elif action == "extend":
            seconds = int(body.get("seconds", 0))
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
        # F-C-01: record the resulting status, never the action verb. The pause
        # path used to write to_status='pause' while resume looked up 'paused',
        # so resume raised NoResultFound (500) and the stage stayed paused
        # forever. 'extend' does not change the status, so the current status is
        # the accurate resulting value for that row.
        to_status = mapping[action][1] if action in mapping else st["status"]
        s.execute(
            text(
                "INSERT INTO app.stage_transitions (id, stage_id, from_status, to_status, actor_id, reason_code) "
                "VALUES (CAST(:id AS uuid), CAST(:s AS uuid), :f, :t, CAST(:u AS uuid), :r)"
            ),
            {"id": str(uuid7()), "s": stage_id, "f": st["status"], "t": to_status, "u": p.id, "r": reason},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action=f"stage.{action}",
            entity_type="stage",
            entity_id=stage_id,
            request_id=request.state.request_id,
            details={"reason": reason},
        )
    return {"ok": True, "action": action}


@router.post("/admin/stages/{stage_id}/release")
def release_results(stage_id: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    """ENDED -> EVALUATING -> RELEASED: publishes verdicts and leaderboard (ADM-RS-04)."""
    # F-C-15: validate the action BEFORE any operation; an unknown or misspelled
    # action must fail cleanly and never write a bogus entry into the audit
    # chain (previously unknown actions returned 200 ok).
    action = body.get("action")
    reason = body.get("reason", "results release")
    if action not in ("evaluate", "release"):
        raise ApiError("VALIDATION_ERROR", details={"action": "action must be 'evaluate' or 'release'."})
    with app_session() as s:
        st = s.execute(
            text("SELECT status FROM app.stages WHERE id = CAST(:s AS uuid) FOR UPDATE"), {"s": stage_id}
        ).first()
        if st is None:
            raise ApiError("NOT_FOUND")
        if action == "evaluate" and st[0] != "ended":
            raise ApiError("VALIDATION_ERROR", details={"transition": "Stage must be ended first."})
        if action == "release" and st[0] not in ("ended", "evaluating"):
            raise ApiError("VALIDATION_ERROR", details={"transition": f"Cannot release from {st[0]}."})
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
        ev = s.execute(
            text("SELECT max_teams FROM app.events WHERE id = CAST(:e AS uuid) FOR UPDATE"),
            {"e": event_id},
        ).first()
        if ev is None:
            raise ApiError("NOT_FOUND")
        count = s.execute(
            text("SELECT count(*) FROM app.teams WHERE event_id = CAST(:e AS uuid)"),
            {"e": event_id},
        ).scalar_one()
        if int(count) >= int(ev[0]):
            raise ApiError("VALIDATION_ERROR", details={"capacity": f"Team cap ({ev[0]}) reached."})
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
        )
    return {"team_id": team_id, "join_code": join_code}


@router.get("/admin/events/{event_id}/teams")
def list_teams(event_id: str, p: Principal = Depends(require_organizer)):

    with app_session() as s:
        if (
            s.execute(
                text("SELECT 1 FROM app.events WHERE id = CAST(:e AS uuid)"),
                {"e": event_id},
            ).first()
            is None
        ):
            raise ApiError("NOT_FOUND")
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
            event = (
                s.execute(
                    text("SELECT tenant_id, max_participants FROM app.events WHERE id = CAST(:e AS uuid) FOR UPDATE"),
                    {"e": event_id},
                )
                .mappings()
                .first()
            )
            if event is None:
                raise ApiError("NOT_FOUND")

            team = s.execute(
                text("SELECT event_id FROM app.teams WHERE id = CAST(:t AS uuid) FOR UPDATE"),
                {"t": body.team_id},
            ).first()
            if team is None or str(team[0]) != event_id:
                raise ApiError("VALIDATION_ERROR", details={"team_id": "Choose a team from this event."})

            # The target team row is locked above, so concurrent registrations
            # for the same team serialize before checking this cap.
            team_member_count = s.execute(
                text("SELECT count(*) FROM app.team_members WHERE team_id = CAST(:team AS uuid)"),
                {"team": body.team_id},
            ).scalar_one()
            if int(team_member_count) >= settings.max_team_members:
                raise ApiError(
                    "TEAM_FULL",
                    details={"team_id": f"Team member cap ({settings.max_team_members}) reached."},
                )

            member_count = s.execute(
                text(
                    "SELECT count(DISTINCT tm.user_id) FROM app.team_members tm "
                    "JOIN app.teams t ON t.id = tm.team_id WHERE t.event_id = CAST(:e AS uuid)"
                ),
                {"e": event_id},
            ).scalar_one()
            if int(member_count) >= int(event["max_participants"]):
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"capacity": f"Participant cap ({event['max_participants']}) reached."},
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
                        "tenant": str(event["tenant_id"]),
                        "email": body.email.lower(),
                        "name": body.name,
                        "registration_id": str(uuid7())[:8],
                    },
                )
            else:
                user_id = str(existing["id"])
                if str(existing["tenant_id"]) != str(event["tenant_id"]) or existing["role"] != "participant":
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
        target = s.execute(
            text("SELECT event_id FROM app.teams WHERE id = CAST(:t AS uuid) FOR UPDATE"),
            {"t": body.team_id},
        ).first()
        if target is None or str(target[0]) != event_id:
            raise ApiError("VALIDATION_ERROR", details={"team_id": "Choose a team from this event."})
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
            target_count = s.execute(
                text("SELECT count(*) FROM app.team_members WHERE team_id = CAST(:team AS uuid)"),
                {"team": body.team_id},
            ).scalar_one()
            if int(target_count) >= settings.max_team_members:
                raise ApiError(
                    "TEAM_FULL",
                    details={"team_id": f"Team member cap ({settings.max_team_members}) reached."},
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
        user = (
            s.execute(
                text("SELECT email FROM app.users WHERE id = CAST(:u AS uuid) FOR UPDATE"),
                {"u": user_id},
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
def list_participants(event_id: str, p: Principal = Depends(require_organizer)):
    with app_session() as s:
        if (
            s.execute(
                text("SELECT 1 FROM app.events WHERE id = CAST(:e AS uuid)"),
                {"e": event_id},
            ).first()
            is None
        ):
            raise ApiError("NOT_FOUND")
        rows = (
            s.execute(
                text(
                    "SELECT u.id, u.email, u.name, u.role, t.id AS team_id, t.name AS team_name, "
                    "(u.password_hash IS NOT NULL) AS password_set, u.created_at "
                    "FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.users u ON u.id = tm.user_id "
                    "WHERE t.event_id = CAST(:e AS uuid) AND u.role = 'participant' "
                    "ORDER BY u.email LIMIT 500"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
    return {"participants": [dict(r) for r in rows]}


# --- challenges ----------------------------------------------------------------


class ChallengeIn(BaseModel):
    slug: str = Field(pattern="^[a-z0-9-]+$")
    # F-C-18: app.challenge_versions.title is VARCHAR(200); longer values used
    # to fail inside the INSERT with a database 500 instead of a clean 422.
    title: str = Field(min_length=3, max_length=200)
    instructions_markdown: str | None = None


@router.get("/admin/events/{event_id}/challenges")
def list_challenge_versions(event_id: str, p: Principal = Depends(require_organizer)):
    """List safe challenge metadata without participant content or ground-truth secrets."""
    with app_session() as s:
        if (
            s.execute(
                text("SELECT 1 FROM app.events WHERE id = CAST(:e AS uuid)"),
                {"e": event_id},
            ).first()
            is None
        ):
            raise ApiError("NOT_FOUND")
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
        cv = s.execute(
            text("SELECT status FROM app.challenge_versions WHERE id = CAST(:c AS uuid) FOR UPDATE"),
            {"c": challenge_id},
        ).first()
        if cv is None:
            raise ApiError("NOT_FOUND")
        if cv[0] not in ("draft", "reviewed"):
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
            event_scope="challenge",
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
        cv = s.execute(
            text("SELECT status FROM app.challenge_versions WHERE id = CAST(:c AS uuid) FOR UPDATE"),
            {"c": challenge_id},
        ).first()
        if cv is None:
            raise ApiError("NOT_FOUND")
        if cv[0] not in ("draft", "reviewed"):
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
            event_scope="challenge",
        )
    return {"ok": True, "content_hash": content_hash}


@router.post("/admin/challenges/{challenge_id}/publish")
def publish_challenge(challenge_id: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    stage_id = body.get("stage_id")
    if not stage_id:
        raise ApiError("VALIDATION_ERROR", details={"stage_id": "Required."})
    with app_session() as s:
        cv = (
            s.execute(
                text("SELECT status, event_id FROM app.challenge_versions WHERE id = CAST(:c AS uuid) FOR UPDATE"),
                {"c": challenge_id},
            )
            .mappings()
            .first()
        )
        if cv is None:
            raise ApiError("NOT_FOUND")
        if cv["status"] not in ("sealed",):
            raise ApiError("GROUND_TRUTH_LOCKED")
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
            event_scope="challenge",
        )
    return {"ok": True}


# --- ground truth (gt_admin session; step-up required) -------------------------


class BugLocationIn(BaseModel):
    """F-C-18: bug locations were untyped dicts; malformed or missing keys
    raised KeyError/DB errors inside the gt session (500). The fields mirror
    gt.gt_locations: file_path VARCHAR(500), positive line integers."""

    file_path: str = Field(min_length=1, max_length=500)
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    is_primary: bool = True


class BugAliasIn(BaseModel):
    """F-C-18: aliases were untyped dicts; weights must fit NUMERIC(3,2)."""

    keyword: str = Field(min_length=1, max_length=120)
    weight: float = Field(default=1.0, ge=0, le=9.99)


class BugIn(BaseModel):
    code: str = Field(max_length=40)
    title: str
    severity: str = Field(pattern="^(low|medium|high|critical)$")
    category: str
    points: float = Field(gt=0, le=1000)
    root_cause_group: str
    explanation: str
    fix_guidance: str | None = None
    locations: list[BugLocationIn] = Field(default_factory=list, max_length=8)
    aliases: list[BugAliasIn] = Field(default_factory=list, max_length=12)


@router.post("/admin/challenges/{challenge_id}/ground-truth/bugs", status_code=201)
def add_bug(challenge_id: str, body: BugIn, request: Request, p: Principal = Depends(step_up_verified)):
    """Writes ground truth via the gt_admin role only (DAT-03)."""
    with _editable_challenge_lock(challenge_id), gt_session() as gts:
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
            if loc.line_end < loc.line_start:
                raise ApiError(
                    "VALIDATION_ERROR", details={"locations": f"line_end < line_start for '{loc.file_path}'."}
                )
            gts.execute(
                text(
                    "INSERT INTO gt.gt_locations (id, bug_id, file_path, line_start, line_end, is_primary) VALUES (CAST(:id AS uuid), CAST(:b AS uuid), :fp, :ls, :le, :prim)"
                ),
                {
                    "id": str(uuid7()),
                    "b": bug_id,
                    "fp": loc.file_path,
                    "ls": loc.line_start,
                    "le": loc.line_end,
                    "prim": loc.is_primary,
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
        if (
            s.execute(
                text("SELECT 1 FROM app.challenge_versions WHERE id = CAST(:c AS uuid)"),
                {"c": challenge_id},
            ).first()
            is None
        ):
            raise ApiError("NOT_FOUND")
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
def _editable_challenge_lock(challenge_id: str):
    """Hold the challenge row lock until the isolated ground-truth write completes."""
    with app_session() as s:
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
    """F-C-07: flags are ground truth and must obey the same challenge-status
    lock as add_bug. The status check and the insert run in ONE gt transaction:
    the challenge row is locked FOR UPDATE, so a concurrent freeze/publish is
    serialized against the flag write and can no longer interleave (TOCTOU).
    """
    from ..security import flag_code_hash

    with _editable_challenge_lock(challenge_id):
        try:
            with gt_session() as gts:
                code_hash = flag_code_hash(body.code)
                # Exact re-post (same flag key AND same code) is idempotent (F-C-07).
                exact_duplicate = gts.execute(
                    text(
                        "SELECT id FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) "
                        "AND flag_key = :k AND code_hash = :h"
                    ),
                    {"c": challenge_id, "k": body.flag_key, "h": code_hash},
                ).first()
                if exact_duplicate is not None:
                    return {"flag_id": str(exact_duplicate[0]), "ok": True}
                # Same flag key with a DIFFERENT code is rejected.
                duplicate_key = gts.execute(
                    text(
                        "SELECT 1 FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) "
                        "AND flag_key = :k AND code_hash <> :h"
                    ),
                    {"c": challenge_id, "k": body.flag_key, "h": code_hash},
                ).first()
                if duplicate_key:
                    raise ApiError("VALIDATION_ERROR", details={"flag_key": "This flag key already exists."})
                flag_id = gts.execute(
                    text(
                        "INSERT INTO gt.gt_flags (id, challenge_version_id, flag_key, code_hash, points, max_awards) "
                        "VALUES (CAST(:id AS uuid), CAST(:c AS uuid), :k, :h, :pts, :ma) "
                        "ON CONFLICT DO NOTHING RETURNING id"
                    ),
                    {
                        "id": str(uuid7()),
                        "c": challenge_id,
                        "k": body.flag_key,
                        "h": code_hash,
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
    with _editable_challenge_lock(challenge_id):
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


@router.post("/admin/challenges/{challenge_id}/ground-truth/test-results")
def record_test_results(challenge_id: str, body: dict, request: Request, p: Principal = Depends(step_up_verified)):
    """Organizer records offline functional-test results per submission (ADR-019):
    {submission_id, tests_passed, tests_total} -> enqueues ledger application.

    F-C-12: the submission reference is validated BEFORE anything is recorded
    or enqueued: malformed and nonexistent ids, submissions belonging to a
    different challenge, unsupported kinds (no award claims to pay) and
    submissions without a team are rejected here instead of dead-lettering in
    the worker.
    """
    sub_id = body.get("submission_id")
    raw_passed = body.get("tests_passed")
    raw_total = body.get("tests_total")
    try:
        passed = int(raw_passed)
        total = int(raw_total)
    except (TypeError, ValueError, OverflowError):
        raise ApiError(
            "VALIDATION_ERROR", details={"tests": "Provide submission_id, tests_passed, tests_total."}
        ) from None
    if not sub_id or not isinstance(sub_id, str) or not _is_uuid(sub_id) or total <= 0 or passed < 0 or passed > total:
        raise ApiError("VALIDATION_ERROR", details={"tests": "Provide submission_id, tests_passed, tests_total."})
    with app_session() as s:
        sub = (
            s.execute(
                text(
                    "SELECT id, kind, event_id, stage_id, team_id, challenge_version_id FROM app.submissions "
                    "WHERE id = CAST(:sid AS uuid)"
                ),
                {"sid": sub_id},
            )
            .mappings()
            .first()
        )
        if sub is None:
            raise ApiError("NOT_FOUND", details={"submission_id": "No such submission."})
        if str(sub["challenge_version_id"]) != challenge_id:
            raise ApiError(
                "VALIDATION_ERROR", details={"submission_id": "Submission does not belong to this challenge."}
            )
        # the challenge id already equals the submission's challenge version, so
        # this lookup cannot fail (FK); the event cross-check closes the last
        # context gap (a hand-forged cross-event reference).
        challenge_event = s.execute(
            text("SELECT event_id FROM app.challenge_versions WHERE id = CAST(:c AS uuid)"), {"c": challenge_id}
        ).scalar_one()
        if str(challenge_event) != str(sub["event_id"]):
            raise ApiError(
                "VALIDATION_ERROR", details={"submission_id": "Submission does not belong to this challenge."}
            )
        stage_event = s.execute(
            text("SELECT event_id FROM app.stages WHERE id = CAST(:s AS uuid)"), {"s": str(sub["stage_id"])}
        ).scalar_one()
        if str(stage_event) != str(sub["event_id"]):
            raise ApiError(
                "VALIDATION_ERROR", details={"submission_id": "Submission stage does not belong to this event."}
            )
        if sub["team_id"] is not None:
            team_event = s.execute(
                text("SELECT event_id FROM app.teams WHERE id = CAST(:t AS uuid)"), {"t": str(sub["team_id"])}
            ).scalar_one()
            if str(team_event) != str(sub["event_id"]):
                raise ApiError(
                    "VALIDATION_ERROR", details={"submission_id": "Submission team does not belong to this event."}
                )
        if sub["kind"] not in ("bug_report", "level_report"):
            raise ApiError(
                "VALIDATION_ERROR",
                details={
                    "submission_id": f"Test results apply to bug_report or level_report submissions, not {sub['kind']}"
                },
            )
        if sub["team_id"] is None:
            raise ApiError("VALIDATION_ERROR", details={"submission_id": "Submission has no team to score."})
        enqueue(
            s,
            "apply_test_results",
            {"submission_id": sub_id, "tests_passed": passed, "tests_total": total, "actor_id": p.id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="scoring.test_results_recorded",
            entity_type="submission",
            entity_id=sub_id,
            request_id=request.state.request_id,
            details={"passed": passed, "total": total},
            event_scope="scoring",
        )
    return {"ok": True}


# --- live ops -------------------------------------------------------------------


class AnnouncementIn(BaseModel):
    severity: str = Field(default="info", pattern="^(info|warning|critical)$")
    body: str = Field(min_length=3, max_length=1000)


@router.post("/admin/events/{event_id}/announcements", status_code=201)
def create_announcement(
    event_id: str, body: AnnouncementIn, request: Request, p: Principal = Depends(require_organizer)
):
    with app_session() as s:
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
            details={"severity": body.severity},
        )
    return {"ok": True}


@router.post("/admin/events/{event_id}/time-adjustment")
def time_adjustment(event_id: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    stage_id = body.get("stage_id")
    # F-C-18: reject NaN/infinity, non-numeric input and absurd deltas BEFORE
    # any row is written (previously int(body.get(...)) could raise an
    # unhandled ValueError -> 500, and plus/minus a billion seconds was stored).
    delta = _validated_delta_seconds(body.get("delta_seconds"))
    reason_code = body.get("reason_code", "OTHER")
    user_id = body.get("user_id")
    if not stage_id or delta == 0:
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "stage_id and nonzero delta_seconds required."})
    if reason_code not in ("ACCOMMODATION", "OUTAGE", "DEVICE_FAILURE", "OTHER"):
        raise ApiError("VALIDATION_ERROR", details={"reason_code": "ACCOMMODATION|OUTAGE|DEVICE_FAILURE|OTHER"})
    if not _is_uuid(event_id) or not _is_uuid(stage_id) or (user_id is not None and not _is_uuid(user_id)):
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "event_id, stage_id and user_id must be UUIDs."})
    with app_session() as s:
        stage = s.execute(
            text("SELECT id FROM app.stages WHERE id = CAST(:s AS uuid) AND event_id = CAST(:e AS uuid) FOR UPDATE"),
            {"s": stage_id, "e": event_id},
        ).first()
        if stage is None:
            raise ApiError("NOT_FOUND", details={"stage_id": "No such stage for this event."})
        if user_id is not None:
            member = s.execute(
                text(
                    "SELECT 1 FROM app.team_members tm "
                    "JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.users u ON u.id = tm.user_id "
                    "WHERE tm.user_id = CAST(:u AS uuid) AND t.event_id = CAST(:e AS uuid) "
                    "AND u.role = 'participant'"
                ),
                {"u": user_id, "e": event_id},
            ).first()
            if member is None:
                raise ApiError(
                    "VALIDATION_ERROR",
                    details={"user_id": "Participant must have an active team membership in the selected event."},
                )
        s.execute(
            text(
                "INSERT INTO app.time_adjustments (id, stage_id, user_id, delta_seconds, reason_code, created_by) VALUES (CAST(:id AS uuid), CAST(:s AS uuid), CAST(:u AS uuid), :d, :r, CAST(:by AS uuid))"
            ),
            {"id": str(uuid7()), "s": stage_id, "u": user_id, "d": delta, "r": reason_code, "by": p.id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="stage.time_adjustment",
            entity_type="stage",
            entity_id=stage_id,
            request_id=request.state.request_id,
            details={"delta_seconds": delta, "reason_code": reason_code},
        )
    return {"ok": True}


@router.get("/admin/events/{event_id}/live")
def live_ops(event_id: str, p: Principal = Depends(require_organizer)):
    """Control-room view with REAL state (ADM-LV-01); no fabricated indicators."""
    with app_session() as s:
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
                    "SELECT id, name, kind, ordinal, status, starts_at, ends_at, config FROM app.stages WHERE event_id = CAST(:e AS uuid) "
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


@router.post("/admin/events/{event_id}/readiness/{key}")
def set_readiness(event_id: str, key: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    state = body.get("state", "checked")
    if state not in ("checked", "unchecked", "na"):
        raise ApiError("VALIDATION_ERROR")
    with app_session() as s:
        # F-C-16: an UPDATE that matched zero rows used to still return ok;
        # the caller must learn the readiness item does not exist.
        result = s.execute(
            text(
                "UPDATE app.readiness_items SET state=CAST(:st AS varchar), checked_at=CASE WHEN CAST(:st AS varchar)='checked' THEN now() ELSE NULL END WHERE event_id = CAST(:e AS uuid) AND key = :k"
            ),
            {"st": state, "e": event_id, "k": key},
        )
        if result.rowcount == 0:
            raise ApiError("NOT_FOUND", details={"key": "No such readiness item for this event."})
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="readiness.updated",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            details={"key": key, "state": state},
        )
    return {"ok": True}


@router.get("/admin/audit/verify")
def audit_chain_verify(p: Principal = Depends(require_organizer)):
    with app_session() as s:
        result = audit_verify(s)
    return result


@router.get("/admin/audit")
def audit_log(p: Principal = Depends(require_organizer), limit: int = 100, action: str | None = None):
    with app_session() as s:
        if action:
            rows = (
                s.execute(
                    text(
                        "SELECT seq, ts, actor_role, action, entity_type, entity_id, request_id, details FROM audit.entries WHERE action = :a ORDER BY seq DESC LIMIT :n"
                    ),
                    {"a": action, "n": min(limit, 500)},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                s.execute(
                    text(
                        "SELECT seq, ts, actor_role, action, entity_type, entity_id, request_id, details FROM audit.entries ORDER BY seq DESC LIMIT :n"
                    ),
                    {"n": min(limit, 500)},
                )
                .mappings()
                .all()
            )
    return {"entries": [dict(r) for r in rows]}


@router.get("/admin/events/{event_id}/export/{kind}")
def export_csv(event_id: str, kind: str, p: Principal = Depends(require_organizer)):
    if kind not in ("results", "submissions", "ledger"):
        raise ApiError("VALIDATION_ERROR", details={"kind": "results|submissions|ledger"})
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    created_by = p.id
    with app_session() as s:
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
                "h": __import__("hashlib").sha256(content.encode()).hexdigest(),
                "u": created_by,
            },
        )
    return {"filename": f"{kind}_{event_id[:8]}.csv", "content": content}


# --- disputes -------------------------------------------------------------------


# F-C-23: the organizer disputes list is bounded like every other listing
# (announcements use 1..100; the audit viewer 1..500).
MAX_DISPUTES_PAGE_SIZE = 100


@router.get("/admin/disputes")
def list_disputes(
    p: Principal = Depends(require_organizer),
    event_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """F-C-23: bounded, deterministic, optionally event-scoped disputes listing.

    Previously the endpoint loaded every dispute in the database with no
    bound and no ordering tiebreak. The response keeps the 'disputes' key and
    adds pagination metadata.
    """
    if limit < 1 or limit > MAX_DISPUTES_PAGE_SIZE:
        raise ApiError("VALIDATION_ERROR", details={"limit": f"limit must be between 1 and {MAX_DISPUTES_PAGE_SIZE}."})
    if offset < 0:
        raise ApiError("VALIDATION_ERROR", details={"offset": "offset must be >= 0."})
    if event_id is not None and not _is_uuid(event_id):
        raise ApiError("VALIDATION_ERROR", details={"event_id": "Must be a valid event id."})
    params = {"event_id": event_id, "limit": limit, "offset": offset}
    with app_session() as s:
        total = s.execute(
            text(
                "SELECT count(*) FROM app.disputes d JOIN app.submissions s ON s.id = d.submission_id "
                "WHERE (CAST(:event_id AS uuid) IS NULL OR s.event_id = CAST(:event_id AS uuid))"
            ),
            {"event_id": event_id},
        ).scalar_one()
        rows = (
            s.execute(
                text(
                    "SELECT d.id, d.status, d.statement, d.created_at, s.title, s.receipt_code, d.submission_id "
                    "FROM app.disputes d JOIN app.submissions s ON s.id = d.submission_id "
                    "WHERE (CAST(:event_id AS uuid) IS NULL OR s.event_id = CAST(:event_id AS uuid)) "
                    "ORDER BY d.created_at DESC, d.id DESC LIMIT :limit OFFSET :offset"
                ),
                params,
            )
            .mappings()
            .all()
        )
    return {"disputes": [dict(r) for r in rows], "total": int(total), "limit": limit, "offset": offset}


@router.post("/admin/disputes/{dispute_id}/resolve")
def resolve_dispute(dispute_id: str, body: dict, request: Request, p: Principal = Depends(require_organizer)):
    outcome = body.get("outcome")  # upheld | rejected
    resolution = body.get("resolution", "")
    adjust_raw = body.get("adjust_points")  # optional ledger adjustment for the team
    if outcome not in ("upheld", "rejected"):
        raise ApiError("VALIDATION_ERROR", details={"outcome": "upheld|rejected"})
    # F-C-06: validate the adjustment BEFORE any dispute, ledger or audit row
    # is written; NaN/infinity/malformed values used to flow straight into
    # NUMERIC and poison SUM(points) for the team. Zero keeps the existing
    # no-adjustment semantics (falsy check below).
    adjust_points = None
    if adjust_raw is not None:
        adjust_points = _validated_points(adjust_raw, field="adjust_points")
    with app_session() as s:
        d = (
            s.execute(
                text(
                    "SELECT di.id, di.submission_id, di.team_id, di.status, s.stage_id "
                    "FROM app.disputes di JOIN app.submissions s ON s.id = di.submission_id "
                    "WHERE di.id = CAST(:id AS uuid) FOR UPDATE"
                ),
                {"id": dispute_id},
            )
            .mappings()
            .first()
        )
        if d is None:
            raise ApiError("NOT_FOUND")
        if d["status"] in ("upheld", "rejected"):
            raise ApiError("VALIDATION_ERROR", details={"dispute": "Already resolved."})
        s.execute(
            text(
                "UPDATE app.disputes SET status=:o, resolution=:r, resolved_by=CAST(:u AS uuid), resolved_at=now() WHERE id = CAST(:id AS uuid)"
            ),
            {"o": outcome, "r": resolution, "u": p.id, "id": dispute_id},
        )
        if outcome == "upheld" and adjust_points:
            # rescoring via ledger adjustment (DAT-05): reversal + new entry
            stage_id = str(d["stage_id"])
            team_id = str(d["team_id"])
            event_id = s.execute(
                text("SELECT event_id FROM app.stages WHERE id = CAST(:s AS uuid)"), {"s": stage_id}
            ).scalar_one()
            tenant_id = s.execute(
                text("SELECT tenant_id FROM app.events WHERE id = CAST(:e AS uuid)"), {"e": str(event_id)}
            ).scalar_one()
            add_ledger_entry(
                s,
                tenant_id=str(tenant_id),
                event_id=str(event_id),
                stage_id=stage_id,
                team_id=team_id,
                component="adjustment",
                kind="adjustment",
                points=float(adjust_points),
                reason_code="DISPUTE_UPHELD",
                submission_id=str(d["submission_id"]),
                actor_id=p.id,
                note=f"Dispute {dispute_id[:8]} upheld: {resolution[:200]}",
            )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="dispute.resolved",
            entity_type="dispute",
            entity_id=dispute_id,
            request_id=request.state.request_id,
            details={"outcome": outcome},
        )
    return {"ok": True}


@router.post("/admin/adjustments")
def manual_adjustment(body: dict, request: Request, p: Principal = Depends(admin_step_up_verified)):
    """Admin-only manual score adjustment; requires recent password step-up."""
    stage_id = body.get("stage_id")
    team_id = body.get("team_id")
    raw_points = body.get("points")
    reason = body.get("reason", "")
    if not stage_id or not team_id or not reason or raw_points is None:
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "stage_id, team_id, points, reason required."})
    # F-C-06: NaN passes an ordinary `points == 0` check (every comparison with
    # NaN is false) and poisons SUM(points) for the team forever; infinities
    # and oversized values overflow NUMERIC(10,2). Validate as a finite
    # Decimal BEFORE any ledger or audit row is written.
    points = _validated_points(raw_points, field="points")
    if points == 0:
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "stage_id, team_id, points, reason required."})
    if abs(points) > 10000 or len(reason) > 1000:
        raise ApiError(
            "VALIDATION_ERROR", details={"adjustment": "Points must be within +/-10000 and reason <=1000 chars."}
        )
    if not _is_uuid(stage_id) or not _is_uuid(team_id):
        raise ApiError("VALIDATION_ERROR", details={"adjustment": "stage_id and team_id must be UUIDs."})
    with app_session() as s:
        scope = s.execute(
            text(
                "SELECT e.id, e.tenant_id FROM app.stages st JOIN app.events e ON e.id = st.event_id "
                "JOIN app.teams t ON t.event_id = e.id WHERE st.id = CAST(:s AS uuid) AND t.id = CAST(:t AS uuid)"
            ),
            {"s": stage_id, "t": team_id},
        ).first()
        if scope is None:
            raise ApiError("VALIDATION_ERROR", details={"adjustment": "Stage and team must belong to the same event."})
        event_id, tenant_id = str(scope[0]), str(scope[1])
        add_ledger_entry(
            s,
            tenant_id=str(tenant_id),
            event_id=str(event_id),
            stage_id=stage_id,
            team_id=team_id,
            component="adjustment",
            kind="adjustment",
            points=float(points),
            reason_code="MANUAL",
            actor_id=p.id,
            note=reason,
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="scoring.manual_adjustment",
            entity_type="team",
            entity_id=team_id,
            request_id=request.state.request_id,
            details={"points": float(points), "reason": reason},
            event_scope="scoring",
        )
    return {"ok": True}


@router.get("/admin/system/health")
def system_health(p: Principal = Depends(require_organizer)):
    probes = health_probe()
    with app_session() as s:
        jobs = s.execute(text("SELECT status, count(*) FROM app.jobs GROUP BY status")).all()
        oldest = s.execute(
            text(
                "SELECT COALESCE(MIN(EXTRACT(epoch FROM (now() - created_at))), 0) FROM app.jobs WHERE status='queued'"
            )
        ).scalar_one()
    return {
        "databases": {"app": probes["database_app"], "gt": probes["database_gt"]},
        "jobs": {r[0]: int(r[1]) for r in jobs},
        "oldest_queued_job_age_s": int(oldest),
        "profile": settings.profile,
        "environment": settings.environment,
        "runner_enabled": settings.runner_enabled,
        "ai_assessment_enabled": settings.ai_assessment_enabled,
    }
