"""Announcements (LB-05/WS-07): organizer-published notices read by everyone."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db import app_session
from ..deps import get_principal, Principal

router = APIRouter(tags=["announcements"])


@router.get("/announcements")
def list_announcements(p: Principal = Depends(get_principal), limit: int = 50):
    with app_session() as s:
        rows = s.execute(
            text(
                "SELECT a.id, a.severity, a.audience, a.body, a.created_at, u.name AS author "
                "FROM app.announcements a JOIN app.users u ON u.id = a.created_by "
                "ORDER BY a.created_at DESC LIMIT :n"
            ),
            {"n": min(limit, 100)},
        ).mappings().all()
    return {"announcements": [
        {"id": str(r["id"]), "severity": r["severity"], "audience": r["audience"], "body": r["body"],
         "author": r["author"], "created_at": r["created_at"].isoformat()}
        for r in rows
    ]}
