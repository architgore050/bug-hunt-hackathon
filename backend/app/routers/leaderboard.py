"""Leaderboard and results (spec LBD-01/RES-01).

Visibility follows the frozen stage config: hidden | frozen (delayed snapshots)
| live. Participants never see other participants' reports or per-bug detail.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import text

from ..db import app_session
from ..deps import Principal, get_principal, require_role
from ..errors import ApiError
from ..tenancy import require_stage_in_tenant

router = APIRouter(tags=["leaderboard"])


def _stage_feedback_released(s, stage_id: str) -> bool:
    """REM-009: authoritative per-stage feedback release state.

    Feedback release is the evaluator/worker transaction that flips
    ``app.submissions.feedback_released`` for the whole stage (release_feedback
    job), so a stage counts as released when at least one submission carries
    the flag. A stage with no submissions is not released; the results payload
    stays gated until the release job runs.
    """
    return bool(
        s.execute(
            text(
                "SELECT COALESCE(BOOL_OR(feedback_released), false) FROM app.submissions "
                "WHERE stage_id = CAST(:s AS uuid)"
            ),
            {"s": stage_id},
        ).scalar_one()
    )


@router.get("/leaderboard/{stage_id}")
def leaderboard(
    stage_id: str,
    request: Request,
    response: Response,
    p: Principal = Depends(get_principal),
):
    with app_session() as s:
        # REM-001: tenant-scoped stage lookup; a foreign/missing stage is a
        # non-enumerating 404 instead of a cross-tenant read.
        stage = require_stage_in_tenant(s, stage_id, p.tenant_id)
        cfg = stage["config"] or {}
        mode = cfg.get("leaderboard_mode", "hidden")
        released = stage["status"] in ("released", "final")
        if mode == "hidden" and p.role == "participant" and not released:
            return {"visible": False, "message": "The leaderboard is hidden for this round."}
        delay_s = int(cfg.get("leaderboard_delay_s", 600))
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
    # REM-055: conditional polling. The ETag is derived from the snapshot
    # version (the deterministic sequence written by save_snapshot), so an
    # unchanged snapshot short-circuits to 304 with an empty body and the
    # client keeps its cached payload instead of re-downloading it.
    etag = f'W/"lb-{stage_id}-{snap["version"]}"'
    if request.headers.get("If-None-Match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
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
        # REM-001: tenant-scoped stage lookup before any result read.
        require_stage_in_tenant(s, stage_id, p.tenant_id)
        # REM-009: results are score-bearing. Before the stage's feedback is
        # released they must not be served at all — a 200 with released:false
        # is a soft gate the client may ignore, so raise RELEASE_BLOCKED.
        if not _stage_feedback_released(s, stage_id):
            # MANUAL-REVALIDATION (REM-062): terminal-state/time semantics need contract tests.
            raise ApiError("RELEASE_BLOCKED", details={"reason": "Feedback not released for this stage."})
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
        # REM-010: single-pass ledger total. Every row (including penalties)
        # contributes to ``total`` exactly once; penalty rows are reported as
        # a separate informational subtotal and are excluded from
        # by_component so components + penalties always reconcile to total.
        by_component: dict[str, float] = {}
        penalties = 0.0
        bonuses = 0.0
        total = 0.0
        items = []
        for r in rows:
            pts = float(r["points"])
            total += pts
            if r["kind"] == "penalty":
                penalties += pts
            else:
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
        # REM-049: own-team rank among released stage totals (count of teams
        # with a strictly higher ledger total in the same stage, +1).
        rank = (
            s.execute(
                text(
                    "SELECT COUNT(*) FROM (SELECT l.team_id, SUM(l.points) AS t FROM app.score_ledger_entries l "
                    "WHERE l.stage_id = CAST(:st AS uuid) GROUP BY l.team_id HAVING SUM(l.points) > :total) AS higher"
                ),
                {"st": stage_id, "total": total},
            ).scalar_one()
        ) + 1
    return {
        "released": True,
        "total": round(total, 2),
        "by_component": {k: round(v, 2) for k, v in by_component.items()},
        "penalties": round(penalties, 2),
        "bonuses": round(bonuses, 2),
        "rank": int(rank),
        "entries": items,
    }
