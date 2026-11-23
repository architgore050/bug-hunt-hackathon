"""Public endpoints: event info, rules. No private data, cacheable, SEO-safe."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ..db import app_session

router = APIRouter(tags=["public"])


@router.get("/public/event")
def public_event():
    """Public subset only (PUB-01). Reveals no challenge content or participant data."""
    with app_session() as s:
        ev = (
            s.execute(
                text(
                    "SELECT slug, name, status, starts_at, ends_at, timezone, duration_minutes, "
                    "max_participants, max_teams, rules_version, config FROM app.events "
                    "WHERE status <> 'draft' ORDER BY created_at DESC LIMIT 1"
                )
            )
            .mappings()
            .first()
        )
    if ev is None:
        return {"event": None}
    config = ev["config"] or {}
    return {
        "event": {
            "slug": ev["slug"],
            "name": ev["name"],
            "status": ev["status"],
            "starts_at": ev["starts_at"].isoformat() if ev["starts_at"] else None,
            "ends_at": ev["ends_at"].isoformat() if ev["ends_at"] else None,
            "timezone": ev["timezone"],
            "duration_minutes": ev["duration_minutes"],
            "max_participants": ev["max_participants"],
            "max_teams": ev["max_teams"],
            "rules_version": ev["rules_version"],
            "format": config.get("public_summary", {}),
        }
    }


@router.get("/public/rules")
def public_rules():
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT r.version, r.body_md, r.frozen_at, e.name FROM app.rules_documents r "
                    "JOIN app.events e ON e.id = r.event_id ORDER BY r.version DESC LIMIT 1"
                )
            )
            .mappings()
            .first()
        )
    if row is None:
        return {"rules": None}
    return {
        "rules": {
            "version": row["version"],
            "body_markdown": row["body_md"],
            "frozen_at": row["frozen_at"].isoformat() if row["frozen_at"] else None,
            "event_name": row["name"],
        }
    }
