"""Announcements (LB-05/WS-07): organizer-published notices read by everyone.

REM-034: reads are scoped to the caller's event (their tenant's active event,
or an explicit event_id they belong to) and filtered by audience at the SQL
predicate, never client-side. History is cursor-paginated so it is never
silently truncated by the limit.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from ..db import app_session
from ..deps import Principal, get_principal
from ..errors import ApiError
from ..tenancy import require_event_in_tenant

router = APIRouter(tags=["announcements"])

# REM-034: audience authorization is applied in the SELECT, per role.
_AUDIENCE_ALL = "('all','participants','staff')"
_AUDIENCE_PARTICIPANT = "('all','participants')"
_AUDIENCE_STAFF = "('all','participants','staff')"


def _audience_filter(p: Principal) -> str:
    if p.role == "participant":
        return _AUDIENCE_PARTICIPANT
    return _AUDIENCE_STAFF


def _caller_event(s, p: Principal, event_id: str | None) -> str:
    """Resolve the event whose announcements the caller may read.

    With an explicit ``event_id`` the event must belong to the caller's
    tenant (REM-001). Without one we fall back to the caller's tenant's
    latest active event rather than a global latest-wins selection.
    """
    if event_id:
        ev = require_event_in_tenant(s, event_id, p.tenant_id)
        return str(ev["id"])
    row = (
        s.execute(
            text(
                "SELECT id FROM app.events WHERE tenant_id = CAST(:tid AS uuid) "
                "AND status IN ('ready','live','closed','finalized') ORDER BY created_at DESC LIMIT 1"
            ),
            {"tid": p.tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise ApiError("NOT_FOUND", message="No active event for announcements.")
    return str(row["id"])


@router.get("/announcements")
def list_announcements(
    p: Principal = Depends(get_principal),
    event_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
):
    with app_session() as s:
        eid = _caller_event(s, p, event_id)
        clauses = ["a.event_id = CAST(:eid AS uuid)", f"a.audience IN {_audience_filter(p)}"]
        binds: dict = {"eid": eid, "n": limit}
        if cursor:
            # cursor is "<created_at_iso> <uuid>"; older rows only.
            try:
                cur_ts, cur_id = cursor.split(" ", 1)
            except ValueError as err:
                raise ApiError("VALIDATION_ERROR", details={"cursor": "Invalid cursor."}) from err
            clauses.append("(a.created_at, a.id) < (CAST(:cts AS timestamptz), CAST(:cid AS uuid))")
            binds["cts"] = cur_ts
            binds["cid"] = cur_id
        rows = (
            s.execute(
                text(
                    "SELECT a.id, a.event_id, a.severity, a.audience, a.body, a.created_at, "
                    "u.name AS author, a.id AS _cursor_id "
                    "FROM app.announcements a JOIN app.users u ON u.id = a.created_by "
                    "WHERE " + " AND ".join(clauses) + " ORDER BY a.created_at DESC, a.id DESC LIMIT :n"
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
        next_cursor = f"{last['created_at'].isoformat()} {last['_cursor_id']}"
    return {
        "event_id": eid,
        "announcements": [
            {
                "id": str(r["id"]),
                "event_id": str(r["event_id"]),
                "severity": r["severity"],
                "audience": r["audience"],
                "body": r["body"],
                "author": r["author"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in items
        ],
        "next_cursor": next_cursor,
    }
