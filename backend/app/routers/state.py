"""Authoritative state endpoints: server time, round state, participant config.

The server owns time and state (TIM-01/02). Clients poll /state every ~5 s
during an active stage (spec 12.1 D1 realtime profile).
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db import app_session, db_now
from ..deps import Principal, get_principal, require_role
from ..errors import ApiError

router = APIRouter(tags=["state"])


@router.get("/time")
def server_time():
    with app_session() as s:
        now = db_now(s)
    return {"server_time_ms": int(now.timestamp() * 1000), "server_time": now.isoformat()}


def _effective_end(session, stage_row, user_id: str | None):
    """ends_at + global adjustments + per-user adjustments (spec EVENTS module)."""
    base = stage_row["ends_at"]
    if base is None:
        return None
    delta = 0
    rows = session.execute(
        text(
            "SELECT COALESCE(SUM(delta_seconds), 0) FROM app.time_adjustments "
            "WHERE stage_id = CAST(:s AS uuid) AND (user_id IS NULL OR user_id = CAST(:u AS uuid))"
        ),
        {"s": str(stage_row["id"]), "u": user_id},
    ).scalar_one()
    delta = int(rows or 0)
    return base + timedelta(seconds=delta)


@router.get("/state")
def round_state(p: Principal = Depends(get_principal)):
    require_role("participant", "reviewer", "organizer", "admin")(p)
    with app_session() as s:
        stage = (
            s.execute(
                text(
                    "SELECT st.id, st.name, st.kind, st.status, st.starts_at, st.ends_at, st.grace_seconds, "
                    "st.config, e.id AS event_id, e.status AS event_status, e.rules_version "
                    "FROM app.stages st JOIN app.events e ON e.id = st.event_id "
                    "WHERE e.status IN ('ready','live','closed','finalized') AND st.kind <> 'level' "
                    "ORDER BY st.ordinal DESC, st.created_at DESC LIMIT 1"
                )
            )
            .mappings()
            .first()
        )
        if stage is None:
            return {"server_time": db_now(s).isoformat(), "round": None}
        now = db_now(s)
        eff_end = _effective_end(s, stage, p.id)
        ann_v = s.execute(
            text("SELECT count(*) FROM app.announcements WHERE event_id = CAST(:e AS uuid)"),
            {"e": str(stage["event_id"])},
        ).scalar_one()
        lb = s.execute(
            text(
                "SELECT COALESCE(MAX(version), 0), COALESCE(MAX(visibility), 'hidden') FROM app.leaderboard_snapshots WHERE stage_id = CAST(:s AS uuid)"
            ),
            {"s": str(stage["id"])},
        ).first()
        paused = stage["status"] == "paused"
    return {
        "server_time": now.isoformat(),
        "round": {
            "id": str(stage["id"]),
            "name": stage["name"],
            "kind": stage["kind"],
            "status": stage["status"],
            "event_status": stage["event_status"],
            "starts_at": stage["starts_at"].isoformat() if stage["starts_at"] else None,
            "ends_at_effective": eff_end.isoformat() if eff_end else None,
            "grace_seconds": stage["grace_seconds"],
            "paused": paused,
        },
        "rules_version": stage["rules_version"],
        "announcements_version": int(ann_v),
        "leaderboard_version": int(lb[0] or 0),
        "leaderboard_visibility": lb[1] or "hidden",
    }


@router.get("/config")
def participant_config(p: Principal = Depends(get_principal)):
    """Stage configuration visible to the participant: caps, modes, scoring weights, flags (spec TABLE 15)."""
    require_role("participant", "reviewer", "organizer", "admin")(p)
    with app_session() as s:
        stage = (
            s.execute(
                text(
                    "SELECT st.id, st.config, st.grace_seconds, e.config AS event_config FROM app.stages st "
                    "JOIN app.events e ON e.id = st.event_id "
                    "WHERE e.status IN ('ready','live','closed','finalized') AND st.kind <> 'level' ORDER BY st.ordinal DESC LIMIT 1"
                )
            )
            .mappings()
            .first()
        )
    if stage is None:
        raise ApiError("NOT_FOUND", message="No active stage configured yet.")
    cfg = stage["config"] or {}
    ev = stage["event_config"] or {}
    # Never leak hidden material here: only operational values and published policy.
    safe_keys = (
        "feedback_mode",
        "leaderboard_mode",
        "max_span",
        "max_reports_per_file",
        "max_reports_per_round",
        "file_cooldown_s",
        "location_tolerance_lines",
        "ctf_bonus_cap_points",
        "penalty",
        "schedule",
    )
    return {
        "stage_id": str(stage["id"]),
        "grace_seconds": stage["grace_seconds"],
        "runner_enabled": bool(ev.get("features", {}).get("runner_enabled", False)),
        "ai_assessment_enabled": bool(ev.get("features", {}).get("ai_assessment_enabled", False)),
        "scoring_weights": ev.get("scoring", {}).get("weights", {}),
        "ctf_bonus_cap_points": ev.get("scoring", {}).get("ctf_bonus_cap_points"),
        "limits": {k: cfg.get(k) for k in safe_keys if cfg.get(k) is not None},
        "schedule": ev.get("schedule", []),
    }
