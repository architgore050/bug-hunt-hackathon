"""Leaderboard and results (spec LBD-01/RES-01).

Visibility follows the frozen stage config: hidden | frozen (delayed snapshots)
| live. Participants never see other participants' reports or per-bug detail.
"""

from __future__ import annotations

from datetime import UTC

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db import app_session
from ..deps import Principal, get_principal, require_role
from ..errors import ApiError

router = APIRouter(tags=["leaderboard"])


@router.get("/leaderboard/{stage_id}")
def leaderboard(stage_id: str, p: Principal = Depends(get_principal)):
    with app_session() as s:
        stage = (
            s.execute(
                text("SELECT id, config, status FROM app.stages WHERE id = CAST(:s AS uuid)"),
                {"s": stage_id},
            )
            .mappings()
            .first()
        )
        if stage is None:
            raise ApiError("NOT_FOUND")
        cfg = stage["config"] or {}
        mode = cfg.get("leaderboard_mode", "hidden")
        released = stage["status"] in ("released", "final")
        if mode == "hidden" and p.role == "participant" and not released:
            return {"visible": False, "message": "The leaderboard is hidden for this round."}
        delay_s = int(cfg.get("leaderboard_delay_s", 600))
        from datetime import datetime, timedelta

        cutoff = datetime.now(UTC) - timedelta(seconds=delay_s if mode == "frozen" else 0)
        snap = (
            s.execute(
                text(
                    "SELECT version, payload, created_at FROM app.leaderboard_snapshots "
                    "WHERE stage_id = CAST(:s AS uuid) AND created_at <= :cutoff "
                    "ORDER BY version DESC LIMIT 1"
                ),
                {"s": stage_id, "cutoff": cutoff},
            )
            .mappings()
            .first()
        )
    if snap is None:
        return {"visible": True, "snapshot": None, "message": "No results published yet."}
    return {
        "visible": True,
        "version": snap["version"],
        "snapshot": snap["payload"],
        "generated_at": snap["created_at"].isoformat(),
    }


@router.get("/results/{stage_id}")
def my_results(stage_id: str, p: Principal = Depends(get_principal)):
    require_role("participant")(p)
    with app_session() as s:
        released = s.execute(
            text(
                "SELECT COALESCE(BOOL_OR(feedback_released), false) FROM app.submissions WHERE stage_id = CAST(:s AS uuid)"
            ),
            {"s": stage_id},
        ).scalar_one()
        if not released:
            return {"released": False, "message": "Results are not released yet."}
        team = s.execute(
            text("SELECT team_id FROM app.team_members WHERE user_id = CAST(:u AS uuid) LIMIT 1"),
            {"u": p.id},
        ).first()
        if team is None:
            raise ApiError("AUTH_FORBIDDEN", message="No team membership found.")
        rows = (
            s.execute(
                text(
                    "SELECT l.component, l.kind, l.points, l.reason_code, s.title, s.receipt_code, s.matched_bug_code, s.received_at "
                    "FROM app.score_ledger_entries l LEFT JOIN app.submissions s ON s.id = l.submission_id "
                    "WHERE l.stage_id = CAST(:st AS uuid) AND l.team_id = CAST(:t AS uuid) ORDER BY l.created_at"
                ),
                {"st": stage_id, "t": str(team[0])},
            )
            .mappings()
            .all()
        )
        by_component: dict[str, float] = {}
        penalties = 0.0
        bonuses = 0.0
        items = []
        for r in rows:
            pts = float(r["points"])
            if r["kind"] == "penalty":
                penalties += pts
            if r["component"] == "ctf_bonus":
                bonuses += pts
            by_component[r["component"]] = by_component.get(r["component"], 0.0) + pts
            items.append(
                {
                    "component": r["component"],
                    "kind": r["kind"],
                    "points": pts,
                    "reason_code": r["reason_code"],
                    "title": r["title"],
                    "receipt_code": r["receipt_code"],
                    "matched_bug_code": r["matched_bug_code"],
                    "received_at": r["received_at"].isoformat() if r["received_at"] else None,
                }
            )
        total = sum(by_component.values())
    return {
        "released": True,
        "total": round(total, 2),
        "by_component": {k: round(v, 2) for k, v in by_component.items()},
        "penalties": round(penalties, 2),
        "entries": items,
    }
