"""Tenant and active-event scoping helpers (REM-001).

The platform is multi-tenant by data model (``app.tenants`` is the root and
``tenant_id`` is carried on ``users``, ``events``, ``submissions`` and
``score_ledger_entries``), but the API layer historically resolved objects by
bare ``event_id`` / ``stage_id`` / ``team_id`` path parameters with no tenant
predicate.  That made every admin/organizer/review/leaderboard endpoint a
potential cross-tenant read or write.

This module centralises the boundary.  Identity (``tenant_id``) is ALWAYS
derived from the authenticated :class:`~app.deps.Principal` on the server,
never from the request body, and every event/stage/team/challenge lookup is
funnelled through one of the ``require_*`` helpers below which add a
``WHERE tenant_id = :tenant`` predicate and return a non-enumerating 404 when
the row is missing or belongs to another tenant.

The helpers are deliberately small and dependency-free so routers can adopt
them incrementally without a wider refactor.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .errors import ApiError


def _not_found() -> None:
    """Single non-enumerating failure for any missing / foreign-tenant object."""
    raise ApiError("NOT_FOUND")


def require_tenant(session: Session, tenant_id: str | None) -> str:
    """Return a non-null tenant id for the caller or fail closed.

    ``Principal.tenant_id`` is server-derived in ``get_principal``; a ``None``
    here means the principal row was inconsistent (e.g. a user whose tenant was
    deleted).  We refuse to serve rather than silently falling back to a
    global scope.
    """
    if not tenant_id:
        _not_found()
    return tenant_id


def require_event_in_tenant(session: Session, event_id: str | None, tenant_id: str | None) -> dict[str, Any]:
    """Load an event row scoped to ``tenant_id``; 404 if missing/foreign."""
    tenant_id = require_tenant(session, tenant_id)
    if not event_id:
        _not_found()
    row = (
        session.execute(
            text(
                "SELECT id, tenant_id, slug, name, status, starts_at, ends_at, "
                "duration_minutes, max_participants, max_teams, rules_version, "
                "config, config_version, timezone "
                "FROM app.events WHERE id = CAST(:eid AS uuid) AND tenant_id = CAST(:tid AS uuid)"
            ),
            {"eid": event_id, "tid": tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        _not_found()
    return dict(row)


def require_stage_in_tenant(session: Session, stage_id: str | None, tenant_id: str | None) -> dict[str, Any]:
    """Load a stage row scoped via its parent event's tenant; 404 if missing/foreign."""
    tenant_id = require_tenant(session, tenant_id)
    if not stage_id:
        _not_found()
    row = (
        session.execute(
            text(
                "SELECT s.id, s.event_id, s.name, s.kind, s.ordinal, s.status, "
                "s.starts_at, s.ends_at, s.grace_seconds, s.config, s.rule_set_hash "
                "FROM app.stages s JOIN app.events e ON e.id = s.event_id "
                "WHERE s.id = CAST(:sid AS uuid) AND e.tenant_id = CAST(:tid AS uuid)"
            ),
            {"sid": stage_id, "tid": tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        _not_found()
    return dict(row)


def require_team_in_tenant(session: Session, team_id: str | None, tenant_id: str | None) -> dict[str, Any]:
    """Load a team row scoped via its parent event's tenant; 404 if missing/foreign."""
    tenant_id = require_tenant(session, tenant_id)
    if not team_id:
        _not_found()
    row = (
        session.execute(
            text(
                "SELECT t.id, t.event_id, t.name, t.join_code, t.status, t.seat_label "
                "FROM app.teams t JOIN app.events e ON e.id = t.event_id "
                "WHERE t.id = CAST(:tid2 AS uuid) AND e.tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid2": team_id, "tid": tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        _not_found()
    return dict(row)


def require_challenge_in_tenant(session: Session, challenge_id: str | None, tenant_id: str | None) -> dict[str, Any]:
    """Load a challenge version scoped via its parent event's tenant; 404 if missing/foreign."""
    tenant_id = require_tenant(session, tenant_id)
    if not challenge_id:
        _not_found()
    row = (
        session.execute(
            text(
                "SELECT cv.id, cv.event_id, cv.slug, cv.title, cv.version, cv.status, "
                "cv.content_hash, cv.instructions_md, cv.participant_manifest "
                "FROM app.challenge_versions cv JOIN app.events e ON e.id = cv.event_id "
                "WHERE cv.id = CAST(:cid AS uuid) AND e.tenant_id = CAST(:tid AS uuid)"
            ),
            {"cid": challenge_id, "tid": tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        _not_found()
    return dict(row)


def require_submission_in_tenant(session: Session, submission_id: str | None, tenant_id: str | None) -> dict[str, Any]:
    """Load a submission row scoped to ``tenant_id``; 404 if missing/foreign."""
    tenant_id = require_tenant(session, tenant_id)
    if not submission_id:
        _not_found()
    row = (
        session.execute(
            text(
                "SELECT id, tenant_id, event_id, stage_id, challenge_version_id, team_id, "
                "author_id, kind, idempotency_key, payload, payload_hash, status, "
                "receipt_code, file_path, line_start, line_end, category, flag_code, "
                "received_at, feedback_released, matched_bug_code, points_visible "
                "FROM app.submissions WHERE id = CAST(:sid AS uuid) AND tenant_id = CAST(:tid AS uuid)"
            ),
            {"sid": submission_id, "tid": tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        _not_found()
    return dict(row)


def require_dispute_in_tenant(session: Session, dispute_id: str | None, tenant_id: str | None) -> dict[str, Any]:
    """Load a dispute row scoped via its submission's tenant; 404 if missing/foreign."""
    tenant_id = require_tenant(session, tenant_id)
    if not dispute_id:
        _not_found()
    row = (
        session.execute(
            text(
                "SELECT d.id, d.submission_id, d.team_id, d.statement, d.status, d.resolved_by, "
                "sub.tenant_id AS tenant_id, sub.event_id AS event_id, sub.stage_id AS stage_id "
                "FROM app.disputes d "
                "JOIN app.submissions sub ON sub.id = d.submission_id "
                "WHERE d.id = CAST(:did AS uuid) AND sub.tenant_id = CAST(:tid AS uuid)"
            ),
            {"did": dispute_id, "tid": tenant_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        _not_found()
    return dict(row)


def tenant_filter_clause(alias: str, principal_tenant_id: str | None) -> tuple[str, str]:
    """Return a ``(sql_fragment, bind_value)`` pair for ad-hoc tenant predicates.

    Routers that build dynamic ``WHERE`` clauses can append
    ``AND {alias}.tenant_id = CAST(:_tfilter AS uuid)`` and bind ``_tfilter``
    to the principal's tenant.  Returns a sentinel that matches nothing when
    the principal has no tenant, so a forgotten guard fails closed rather than
    leaking all rows.
    """
    tid = principal_tenant_id or "00000000-0000-0000-0000-000000000000"
    return f"{alias}.tenant_id = CAST(:_tfilter AS uuid)", tid
