"""Reviewer endpoints: claim from the queue, inspect the report, record a decision.

Decisions are auditable and route into the scoring ledger (ADM-RV-01..03,
ADM-RV-08). Participant content is served as plain text only (EVA-05); the UI
must never render it as HTML/Markdown.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..audit import audit_write
from ..db import app_session, uuid7
from ..deps import Principal, require_staff
from ..errors import ApiError
from ..jobs import enqueue
from ..tenancy import require_tenant, tenant_filter_clause

router = APIRouter(tags=["review"])

CLAIM_TIMEOUT_MIN = 10


def _encode_cursor(created_at: datetime, item_id: str) -> str:
    """Opaque queue cursor: base64("created_at|id") over the (created_at, id) DESC order (REM-028)."""
    return base64.b64encode(f"{created_at.isoformat()}|{item_id}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[str, str]:
    """Decode a queue cursor; tampered tokens fail as VALIDATION_ERROR (REM-028)."""
    try:
        raw = base64.b64decode(cursor.encode(), validate=True).decode()
        cur_ts, cur_id = raw.split("|", 1)
        uuid.UUID(cur_id)
        datetime.fromisoformat(cur_ts)  # server cursors are isoformat(); anything else is tampered
    except ValueError as err:
        raise ApiError("VALIDATION_ERROR", details={"cursor": "Invalid cursor."}) from err
    return cur_ts, cur_id


@router.get("/review/queue")
def review_queue(
    p: Principal = Depends(require_staff()),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
    status: str | None = None,
    claimed_by: str | None = None,
):
    """Reviewer queue: tenant-scoped (REM-001), cursor-paginated with filters and a total (REM-028)."""
    with app_session() as s:
        tid = require_tenant(s, p.tenant_id)
        tenant_clause, tenant_bind = tenant_filter_clause("sub", tid)
        filter_clauses: list[str] = [tenant_clause]
        binds: dict = {"_tfilter": tenant_bind}
        if status:
            filter_clauses.append("ri.status = :status")
            binds["status"] = status
        else:
            # Actionable queue rows only unless a status filter narrows it deliberately.
            filter_clauses.append("ri.status IN ('open','claimed')")
        if claimed_by:
            try:
                uuid.UUID(claimed_by)
            except ValueError as err:
                raise ApiError("VALIDATION_ERROR", details={"claimed_by": "Invalid reviewer id."}) from err
            filter_clauses.append("ri.claimed_by = CAST(:cb AS uuid)")
            binds["cb"] = claimed_by
        where = " AND ".join(filter_clauses)
        row_binds = {**binds, "n": limit}
        cursor_sql = ""
        if cursor:
            cur_ts, cur_id = _decode_cursor(cursor)
            cursor_sql = " AND (ri.created_at, ri.id) < (CAST(:cts AS timestamptz), CAST(:cid AS uuid))"
            row_binds["cts"] = cur_ts
            row_binds["cid"] = cur_id
        rows = (
            s.execute(
                text(
                    "SELECT ri.id, ri.status, ri.priority, ri.created_at, ri.claimed_by, ri.claimed_at, "
                    "sub.id AS submission_id, sub.kind, sub.title, sub.file_path, sub.line_start, sub.line_end, "
                    "sub.category, sub.received_at, sub.status AS submission_status, "
                    "sub.flag_code IS NOT NULL AS has_flag "
                    "FROM app.review_items ri JOIN app.submissions sub ON sub.id = ri.submission_id "
                    f"WHERE {where}{cursor_sql} ORDER BY ri.created_at DESC, ri.id DESC LIMIT :n"
                ),
                row_binds,
            )
            .mappings()
            .all()
        )
        # The total matches the filters only, never the cursor position (REM-028).
        total = s.execute(
            text(
                "SELECT count(*) FROM app.review_items ri JOIN app.submissions sub ON sub.id = ri.submission_id "
                f"WHERE {where}"
            ),
            binds,
        ).scalar_one()
    items = []
    for r in rows:
        claimed_by_me = r["claimed_by"] is not None and str(r["claimed_by"]) == p.id
        items.append(
            {
                "review_item_id": str(r["id"]),
                "submission_id": str(r["submission_id"]),
                "kind": r["kind"],
                "title": r["title"],
                "file_path": r["file_path"],
                "line_range": [r["line_start"], r["line_end"]],
                "category": r["category"],
                "received_at": r["received_at"].isoformat(),
                "priority": r["priority"],
                "status": r["status"],
                "claimed_by_me": claimed_by_me,
            }
        )
    next_cursor = None
    if len(rows) >= limit:
        last = rows[-1]
        next_cursor = _encode_cursor(last["created_at"], str(last["id"]))
    return {"items": items, "next_cursor": next_cursor, "total": int(total)}


@router.post("/review/items/{item_id}/claim")
def claim_item(item_id: str, p: Principal = Depends(require_staff())):
    """Claim a queue item for review (REM-001 tenant scope, REM-012 idempotency)."""
    with app_session() as s:
        tid = require_tenant(s, p.tenant_id)
        row = (
            s.execute(
                text(
                    "SELECT ri.id, ri.status, ri.claimed_by, ri.claimed_at, ri.submission_id "
                    "FROM app.review_items ri JOIN app.submissions sub ON sub.id = ri.submission_id "
                    "WHERE ri.id = CAST(:i AS uuid) AND sub.tenant_id = CAST(:tid AS uuid) FOR UPDATE OF ri"
                ),
                {"i": item_id, "tid": tid},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ApiError("NOT_FOUND")
        if row["status"] == "decided":
            raise ApiError("VALIDATION_ERROR", details={"claim": "Item already decided."})
        if row["status"] == "claimed" and row["claimed_by"] is not None:
            if str(row["claimed_by"]) == p.id:
                # REM-012: re-claiming your own live claim is an idempotent no-op.
                return {"ok": True}
            claimed_at = row["claimed_at"]
            claim_fresh = claimed_at is not None and datetime.now(UTC) - claimed_at < timedelta(
                minutes=CLAIM_TIMEOUT_MIN
            )
            if claim_fresh:
                # REM-012: another reviewer's active claim is a conflict, not a soft validation error.
                raise ApiError("IDEMPOTENCY_CONFLICT")
            # A claim older than CLAIM_TIMEOUT_MIN is stale and may be taken over.
        s.execute(
            text(
                "UPDATE app.review_items SET status='claimed', claimed_by = CAST(:u AS uuid), claimed_at = now() "
                "WHERE id = CAST(:i AS uuid)"
            ),
            {"u": p.id, "i": item_id},
        )
        s.execute(
            text("UPDATE app.submissions SET status='in_review' WHERE id = CAST(:sid AS uuid)"),
            {"sid": str(row["submission_id"])},
        )
    return {"ok": True}


@router.get("/review/items/{item_id}")
def review_detail(item_id: str, p: Principal = Depends(require_staff())):
    """Full review context: report text (plain), code candidates, evidence, history."""
    with app_session() as s:
        tid = require_tenant(s, p.tenant_id)
        row = (
            s.execute(
                text(
                    "SELECT ri.id, ri.status, sub.id AS submission_id, sub.kind, sub.title, sub.payload, "
                    "sub.file_path, sub.line_start, sub.line_end, sub.category, sub.received_at, "
                    "sub.receipt_code, sub.flag_code, sub.challenge_version_id, sub.team_id, "
                    "sub.status AS submission_status "
                    "FROM app.review_items ri JOIN app.submissions sub ON sub.id = ri.submission_id "
                    "WHERE ri.id = CAST(:i AS uuid) AND sub.tenant_id = CAST(:tid AS uuid)"
                ),
                {"i": item_id, "tid": tid},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ApiError("NOT_FOUND")
        file_content = None
        if row["file_path"]:
            f = (
                s.execute(
                    text(
                        "SELECT content, lang, line_count FROM app.challenge_files "
                        "WHERE challenge_version_id = CAST(:c AS uuid) AND path = :p"
                    ),
                    {"c": str(row["challenge_version_id"]), "p": row["file_path"]},
                )
                .mappings()
                .first()
            )
            if f is not None:
                file_content = {"content": f["content"], "lang": f["lang"], "line_count": f["line_count"]}
        history = s.execute(
            text("SELECT count(*) FROM app.submissions WHERE team_id = CAST(:t AS uuid) AND kind = 'bug_report'"),
            {"t": str(row["team_id"])},
        ).scalar_one()
    return {
        "review_item_id": str(row["id"]),
        "status": row["status"],
        "submission": {
            "id": str(row["submission_id"]),
            "kind": row["kind"],
            "title": row["title"],
            "payload": row["payload"],
            "file_path": row["file_path"],
            "line_start": row["line_start"],
            "line_end": row["line_end"],
            "category": row["category"],
            "received_at": row["received_at"].isoformat(),
            "receipt_code": row["receipt_code"],
            "flag_code": row["flag_code"],
            "status": row["submission_status"],
        },
        "file": file_content,
        "team_total_reports": int(history),
    }


class RubricScores(BaseModel):
    functionality: float = Field(ge=0, le=1, default=0)
    root_cause: float = Field(ge=0, le=1, default=0)
    code_quality: float = Field(ge=0, le=1, default=0)
    testing: float = Field(ge=0, le=1, default=0)
    evidence: float = Field(ge=0, le=1, default=0)


# MANUAL-REVALIDATION (REM-061): decision payload contract needs boundary tests against docs/API_REFERENCE.md.
class DecisionIn(BaseModel):
    decision: str = Field(
        pattern="^(accept_full|accept_partial|duplicate|reject_invalid|unplanned_valid|needs_second_review)$"
    )
    rubric: RubricScores
    notes: str | None = Field(default=None, max_length=2000)


# REFACTOR (REM-050): decision handling duplicated with evaluator.apply_review_outcome; extract a shared review-outcome service in v2.
@router.post("/review/items/{item_id}/decision")
def record_decision(item_id: str, body: DecisionIn, request: Request, p: Principal = Depends(require_staff())):
    """Reviewer decision. The ledger application happens in the evaluator job with
    the matched bug context; here we record the decision and enqueue the work."""
    with app_session() as s:
        tid = require_tenant(s, p.tenant_id)
        row = (
            s.execute(
                text(
                    "SELECT ri.id, ri.status, ri.submission_id, ri.claimed_by, sub.team_id, sub.kind, "
                    "sub.challenge_version_id "
                    "FROM app.review_items ri JOIN app.submissions sub ON sub.id = ri.submission_id "
                    "WHERE ri.id = CAST(:i AS uuid) AND sub.tenant_id = CAST(:tid AS uuid) FOR UPDATE OF ri"
                ),
                {"i": item_id, "tid": tid},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ApiError("NOT_FOUND")
        if row["status"] == "decided":
            raise ApiError("VALIDATION_ERROR", details={"decision": "Already decided."})
        owns_claim = row["status"] == "claimed" and row["claimed_by"] is not None and str(row["claimed_by"]) == p.id
        # REM-012: deciding requires the reviewer's own live claim; admins keep a documented override.
        if not owns_claim and p.role != "admin":
            raise ApiError("AUTH_FORBIDDEN", message="Claim this item before deciding.")

        # REM-012: terminal-state mapping kept in lockstep with evaluator.apply_review_outcome.
        # unplanned_valid is terminal here (the evaluator scores it); needs_second_review requeues
        # the item as 'open' so a second reviewer can claim it.
        sub_status = {
            "accept_full": "decided",
            "accept_partial": "decided",
            "duplicate": "duplicate",
            "reject_invalid": "rejected_auto",
            "unplanned_valid": "decided",
            "needs_second_review": "in_review",
        }[body.decision]

        review_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.reviews (id, submission_id, reviewer_id, decision, rubric, quality, notes) "
                "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), CAST(:u AS uuid), :d, CAST(:rub AS jsonb), :q, :n)"
            ),
            {
                "id": review_id,
                "sid": str(row["submission_id"]),
                "u": p.id,
                "d": body.decision,
                "rub": json.dumps(body.rubric.model_dump()),
                "q": 1.0 if body.decision == "accept_full" else (0.5 if body.decision == "accept_partial" else 0.0),
                "n": body.notes,
            },
        )
        if body.decision == "needs_second_review":
            # REM-012: reopen for the second reviewer (evaluator.apply_review_outcome expects
            # review_item 'open' with claimed_by NULL for this decision).
            s.execute(
                text(
                    "UPDATE app.review_items SET status='open', claimed_by=NULL, claimed_at=NULL "
                    "WHERE id = CAST(:i AS uuid)"
                ),
                {"i": item_id},
            )
        else:
            # REM-012: every other decision terminalizes the item atomically in this FOR UPDATE txn.
            s.execute(
                text("UPDATE app.review_items SET status='decided' WHERE id = CAST(:i AS uuid)"),
                {"i": item_id},
            )
        s.execute(
            text("UPDATE app.submissions SET status=:st WHERE id = CAST(:sid AS uuid)"),
            {"st": sub_status, "sid": str(row["submission_id"])},
        )
        enqueue(
            s,
            "apply_review_outcome",
            {"submission_id": str(row["submission_id"]), "review_id": review_id, "decision": body.decision},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="review.decided",
            entity_type="submission",
            entity_id=str(row["submission_id"]),
            request_id=request.state.request_id,
            details={"decision": body.decision},
            event_scope="review",
        )
    return {"ok": True, "decision": body.decision}
