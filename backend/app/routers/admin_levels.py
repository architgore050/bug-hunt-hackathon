"""Organizer/admin operations for the four-level flow: repo-lock override,
progress matrix, auto-submit trigger, repo options, level bootstrap.

Sensitive operations (lock override, repo options) require step-up
re-authentication like the ground-truth endpoints (AUTH-09); every action
writes an audit entry with the acting organizer and the reason.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..audit import audit_write
from ..db import app_session, uuid7
from ..deps import Principal, require_organizer, step_up_verified
from ..errors import ApiError
from ..flow import LEVEL_COUNT, teammate_view
from ..jobs import enqueue
from ..tenancy import require_event_in_tenant, require_team_in_tenant

router = APIRouter(tags=["admin-levels"])


class RepoLockOverride(BaseModel):
    option_key: str = Field(min_length=1, max_length=10)
    reason: str = Field(min_length=4, max_length=400)


class RepoOptionIn(BaseModel):
    option_key: str = Field(min_length=1, max_length=10)
    label: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    challenge_version_id: str


@router.post("/admin/teams/{team_id}/repo-lock")
def admin_repo_lock(
    team_id: str,
    body: RepoLockOverride,
    request: Request,
    p: Principal = Depends(require_organizer),
):
    """Set or override a team's repository option (audited, step-up required)."""
    p = step_up_verified(request, p)
    with app_session() as s:
        team = require_team_in_tenant(s, team_id, p.tenant_id)  # REM-001 tenant scope
        option = (
            s.execute(
                text(
                    "SELECT challenge_version_id FROM app.repo_options "
                    "WHERE event_id = CAST(:e AS uuid) AND option_key = :k"
                ),
                {"e": str(team["event_id"]), "k": body.option_key},
            )
            .mappings()
            .first()
        )
        if option is None:
            raise ApiError("VALIDATION_ERROR", details={"option_key": "Unknown repository option for this event."})
        existing = s.execute(
            text("SELECT option_key FROM app.team_repo_choices WHERE team_id = CAST(:t AS uuid)"),
            {"t": team_id},
        ).first()
        if existing is None:
            s.execute(
                text(
                    "INSERT INTO app.team_repo_choices (id, event_id, team_id, option_key, challenge_version_id, "
                    "locked_by, lock_source, audit_reason) "
                    "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), CAST(:t AS uuid), :k, CAST(:cv AS uuid), "
                    "CAST(:u AS uuid), 'admin_override', :reason)"
                ),
                {
                    "id": str(uuid7()),
                    "e": str(team["event_id"]),
                    "t": team_id,
                    "k": body.option_key,
                    "cv": str(option["challenge_version_id"]),
                    "u": p.id,
                    "reason": body.reason,
                },
            )
        else:
            s.execute(
                text(
                    "UPDATE app.team_repo_choices SET option_key = :k, challenge_version_id = CAST(:cv AS uuid), "
                    "locked_by = CAST(:u AS uuid), locked_at = now(), lock_source = 'admin_override', audit_reason = :reason "
                    "WHERE team_id = CAST(:t AS uuid)"
                ),
                {
                    "k": body.option_key,
                    "cv": str(option["challenge_version_id"]),
                    "u": p.id,
                    "t": team_id,
                    "reason": body.reason,
                },
            )
        s.execute(
            text(
                "INSERT INTO app.assignments (id, event_id, stage_id, challenge_version_id, team_id) "
                "SELECT gen_random_uuid(), e.id, st.id, CAST(:cv AS uuid), CAST(:t AS uuid) "
                "FROM app.stages st JOIN app.events e ON e.id = st.event_id "
                "WHERE st.event_id = CAST(:e AS uuid) AND st.kind = 'level' "
                "AND NOT EXISTS (SELECT 1 FROM app.assignments a WHERE a.stage_id = st.id AND a.team_id = CAST(:t AS uuid))"
            ),
            {"e": str(team["event_id"]), "cv": str(option["challenge_version_id"]), "t": team_id},
        )
        s.execute(
            text(
                "UPDATE app.participant_progress SET status = 'available', updated_at = now() "
                "WHERE level_no = 1 AND status = 'locked' AND user_id IN "
                "(SELECT user_id FROM app.team_members WHERE team_id = CAST(:t AS uuid))"
            ),
            {"t": team_id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="repo.admin_override",
            entity_type="team",
            entity_id=team_id,
            request_id=request.state.request_id,
            details={"option": body.option_key, "reason": body.reason, "previous": existing[0] if existing else None},
            event_scope=f"event:{team['event_id']}",
        )
    return {"ok": True, "team_id": team_id, "option": body.option_key}


@router.post("/admin/events/{event_id}/repo-options")
def admin_repo_option(event_id: str, body: RepoOptionIn, request: Request, p: Principal = Depends(require_organizer)):
    """Register a repo option for the event (data-driven option set)."""
    p = step_up_verified(request, p)
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        cv = s.execute(
            text("SELECT id FROM app.challenge_versions WHERE id = CAST(:c AS uuid) AND event_id = CAST(:e AS uuid)"),
            {"c": body.challenge_version_id, "e": event_id},
        ).first()
        if cv is None:
            raise ApiError(
                "VALIDATION_ERROR", details={"challenge_version_id": "Unknown challenge version for this event."}
            )
        s.execute(
            text(
                "INSERT INTO app.repo_options (id, event_id, option_key, label, description, challenge_version_id) "
                "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :k, :l, :d, CAST(:cv AS uuid)) "
                "ON CONFLICT (event_id, option_key) DO UPDATE SET label = :l, description = :d, "
                "challenge_version_id = CAST(:cv AS uuid)"
            ),
            {
                "id": str(uuid7()),
                "e": event_id,
                "k": body.option_key,
                "l": body.label,
                "d": body.description,
                "cv": body.challenge_version_id,
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="repo_option.configured",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            details={"option_key": body.option_key, "challenge_version_id": body.challenge_version_id},
            event_scope=f"event:{event_id}",
        )
    return {"ok": True}


@router.get("/admin/events/{event_id}/progress")
def admin_progress(event_id: str, p: Principal = Depends(require_organizer)):
    """Team-by-team, member-by-member progression matrix for live ops."""
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        teams = (
            s.execute(
                text(
                    "SELECT t.id, t.name, t.status, c.option_key, c.lock_source FROM app.teams t "
                    "LEFT JOIN app.team_repo_choices c ON c.team_id = t.id "
                    "WHERE t.event_id = CAST(:e AS uuid) ORDER BY t.name"
                ),
                {"e": event_id},
            )
            .mappings()
            .all()
        )
        out = []
        for t in teams:
            members = teammate_view(s, str(t["id"]))
            out.append(
                {
                    "team_id": str(t["id"]),
                    "team_name": t["name"],
                    "team_status": t["status"],
                    "repo_option": t["option_key"],
                    "lock_source": t["lock_source"],
                    "members": [
                        {
                            "name": m["name"],
                            "pointer": {"level_no": m["pointer_level"], "node": m["pointer_node"]}
                            if m["pointer_level"]
                            else None,
                            "levels": {"1": m["l1"], "2": m["l2"], "3": m["l3"], "4": m["l4"]},
                        }
                        for m in members
                    ],
                }
            )
    return {"event_id": event_id, "teams": out, "level_count": LEVEL_COUNT}


@router.post("/admin/jobs/auto-submit")
def admin_trigger_auto_submit(request: Request, p: Principal = Depends(require_organizer)):
    """Manually enqueue the auto-submit scan (the worker also scans each loop)."""
    with app_session() as s:
        job_id = enqueue(s, "auto_submit_levels", {"trigger": "manual"})
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="auto_submit.triggered",
            entity_type="job",
            entity_id=job_id,
            request_id=request.state.request_id,
        )
    return {"ok": True, "job_id": job_id}


@router.post("/admin/events/{event_id}/levels/bootstrap")
def admin_bootstrap_levels(event_id: str, request: Request, p: Principal = Depends(require_organizer)):
    """Create the four level stages for an event if they are missing
    (kind='level', ordinals 1..4, synthetic draft windows)."""
    with app_session() as s:
        require_event_in_tenant(s, event_id, p.tenant_id)  # REM-001 tenant scope
        created = 0
        names = {
            1: "Level 1: Find the Bugs",
            2: "Level 2: Trace the Cross-File Defect",
            3: "Level 3: Repair and Side Quest",
            4: "Level 4: Tests and Documentation",
        }
        for n in range(1, LEVEL_COUNT + 1):
            exists = s.execute(
                text("SELECT 1 FROM app.stages WHERE event_id = CAST(:e AS uuid) AND kind = 'level' AND ordinal = :n"),
                {"e": event_id, "n": n},
            ).first()
            if exists:
                continue
            s.execute(
                text(
                    "INSERT INTO app.stages (id, event_id, name, kind, ordinal, status, grace_seconds, config) "
                    "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :name, 'level', :n, 'draft', 3, CAST(:c AS jsonb))"
                ),
                {"id": str(uuid.uuid4()), "e": event_id, "name": names[n], "n": n, "c": "{}"},
            )
            created += 1
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="levels.bootstrapped",
            entity_type="event",
            entity_id=event_id,
            request_id=request.state.request_id,
            details={"created": created},
            event_scope=f"event:{event_id}",
        )
    return {"ok": True, "created": created}
