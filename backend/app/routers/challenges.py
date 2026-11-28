"""Challenge delivery: assignments, file tree, file content, instructions.

Access rules (spec CHALLENGES module): only when the stage allows it and the
participant's team is assigned; path normalization and traversal rejection;
size limits; no ground-truth data in any response (DAT-03).
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from ..db import app_session, db_now
from ..deps import Principal, get_principal, rate_limit, require_rules_accepted
from ..errors import ApiError
from ..tenancy import require_challenge_in_tenant

router = APIRouter(tags=["challenges"])

MAX_FILE_BYTES = 512 * 1024
MAX_QUERY_CHARS = 100  # REM-024: bounded search input


def _participant_team_id(s, p: Principal) -> str | None:
    row = s.execute(
        text("SELECT team_id FROM app.team_members WHERE user_id = CAST(:u AS uuid) LIMIT 1"),
        {"u": p.id},
    ).first()
    return str(row[0]) if row else None


def _require_released_stage(s, p: Principal) -> dict:
    # REM-001: scope the latest-stage selection to the caller's tenant.
    # REM-014: an armed-but-not-started stage must not leak content: the gate
    # requires status 'active' AND the DB clock to have reached starts_at.
    stage = (
        s.execute(
            text(
                "SELECT st.id, st.status, st.starts_at FROM app.stages st "
                "JOIN app.events e ON e.id = st.event_id AND e.tenant_id = CAST(:tid AS uuid) "
                "WHERE e.status IN ('ready','live','closed','finalized') AND st.kind <> 'level' ORDER BY st.ordinal DESC LIMIT 1"
            ),
            {"tid": p.tenant_id},
        )
        .mappings()
        .first()
    )
    if stage is None:
        raise ApiError("NOT_FOUND", message="No stage configured.")
    now = db_now(s)
    starts_at = stage["starts_at"]
    if stage["status"] == "armed" and (starts_at is None or now < starts_at):
        # Armed but not started yet — the content key is not available until
        # T0; report it as 425 so the client can retry at the announced start.
        raise ApiError("KEY_NOT_AVAILABLE")
    if stage["status"] != "active":
        raise ApiError("ROUND_NOT_ACTIVE", message="Challenge materials are not released yet.")
    if starts_at is None or now < starts_at:
        # Active on paper but the DB clock has not reached starts_at (e.g. a
        # scheduled start that has not fired): the content key is not yet
        # available either.
        raise ApiError("KEY_NOT_AVAILABLE")
    return stage


def _assigned_challenge(s, stage_id: str, team_id: str | None) -> dict | None:
    row = (
        s.execute(
            text(
                "SELECT cv.id, cv.slug, cv.title, cv.version, cv.instructions_md, cv.status, a.repo_url, a.codespace_url "
                "FROM app.assignments a JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                "WHERE a.stage_id = CAST(:s AS uuid) AND (a.team_id IS NULL OR a.team_id = CAST(:t AS uuid)) "
                "AND cv.status = 'published' LIMIT 1"
            ),
            {"s": stage_id, "t": team_id},
        )
        .mappings()
        .first()
    )
    return row


@router.get("/assignments")
def my_assignments(p: Principal = Depends(get_principal)):
    rate_limit(f"assign:{p.id}", limit=30, window_s=60)
    with app_session() as s:
        team_id = _participant_team_id(s, p)
        stage = _require_released_stage(s, p)
        ch = _assigned_challenge(s, str(stage["id"]), team_id)
        if ch is None:
            return {"assignments": [], "message": "No challenge assigned yet."}
        files = (
            s.execute(
                text(
                    "SELECT path, lang, size_bytes, line_count FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:c AS uuid) ORDER BY path"
                ),
                {"c": str(ch["id"])},
            )
            .mappings()
            .all()
        )
    return {
        "assignments": [
            {
                "challenge_id": str(ch["id"]),
                "slug": ch["slug"],
                "title": ch["title"],
                "version": ch["version"],
                "instructions_markdown": ch["instructions_md"],
                "repo_url": ch["repo_url"],
                "codespace_url": ch["codespace_url"],
                "stage_id": str(stage["id"]),
                "stage_status": stage["status"],
                "files": [
                    {"path": f["path"], "lang": f["lang"], "size_bytes": f["size_bytes"], "line_count": f["line_count"]}
                    for f in files
                ],
            }
        ]
    }


@router.get("/challenges/{challenge_id}/files/content")
def file_content(challenge_id: str, path: str = Query(..., max_length=500), p: Principal = Depends(get_principal)):
    require_rules_accepted(p)
    rate_limit(f"file:{p.id}", limit=120, window_s=60)
    # path traversal defense (SEC-03 / PATH_INVALID)
    norm = os.path.normpath(path)
    if norm.startswith("..") or os.path.isabs(norm) or "\x00" in norm:
        raise ApiError("PATH_INVALID")
    with app_session() as s:
        # REM-001: resolve the challenge inside the caller's tenant before
        # any content read; a foreign or missing challenge is a uniform NOT_FOUND.
        require_challenge_in_tenant(s, challenge_id, p.tenant_id)
        team_id = _participant_team_id(s, p)
        stage = _require_released_stage(s, p)
        ch = _assigned_challenge(s, str(stage["id"]), team_id)
        if ch is None or str(ch["id"]) != challenge_id:
            # do not reveal whether the challenge exists for other teams
            raise ApiError("FILE_NOT_FOUND")
        f = (
            s.execute(
                text(
                    "SELECT path, lang, content, line_count, sha256 FROM app.challenge_files "
                    "WHERE challenge_version_id = CAST(:c AS uuid) AND path = :p"
                ),
                {"c": challenge_id, "p": norm},
            )
            .mappings()
            .first()
        )
    if f is None or len(f["content"].encode()) > MAX_FILE_BYTES:
        raise ApiError("FILE_NOT_FOUND")
    return {
        "path": f["path"],
        "lang": f["lang"],
        "content": f["content"],
        "line_count": f["line_count"],
        "sha256": f["sha256"],
    }


@router.get("/challenges/{challenge_id}/search")
def search_files(
    challenge_id: str, q: str = Query(..., min_length=2, max_length=100), p: Principal = Depends(get_principal)
):
    """Server-side, bounded search (spec WS-10). Rate limited; max 50 results."""
    require_rules_accepted(p)
    rate_limit(f"search:{p.id}", limit=30, window_s=60)
    # REM-024: FastAPI's Query(max_length) already rejects longer values with a
    # 422, but we keep an explicit check so the cap holds even if the signature
    # is refactored away from declarative validation.
    if len(q) > MAX_QUERY_CHARS:
        raise ApiError("VALIDATION_ERROR", details={"q": f"Search query must be at most {MAX_QUERY_CHARS} characters."})
    with app_session() as s:
        # REM-001: resolve the challenge inside the caller's tenant before any
        # content read; a foreign or missing challenge is a uniform NOT_FOUND.
        require_challenge_in_tenant(s, challenge_id, p.tenant_id)
        team_id = _participant_team_id(s, p)
        stage = _require_released_stage(s, p)
        ch = _assigned_challenge(s, str(stage["id"]), team_id)
        if ch is None or str(ch["id"]) != challenge_id:
            raise ApiError("FILE_NOT_FOUND")
        rows = (
            s.execute(
                text(
                    "SELECT path, line_number, line_text FROM app.challenge_file_lines "
                    "WHERE challenge_version_id = CAST(:c AS uuid) AND lower(line_text) LIKE lower(:q) LIMIT 50"
                ),
                {"c": challenge_id, "q": f"%{q}%"},
            )
            .mappings()
            .all()
        )
    return {
        "results": [{"path": r["path"], "line_number": r["line_number"], "text": r["line_text"][:200]} for r in rows]
    }
