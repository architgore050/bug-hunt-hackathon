"""Submission endpoints: the transactional heart of the platform.

POST /v1/submissions implements the architecture's ordered transaction (8.1):
 1. identity from the token (never the body)
 2. idempotency reservation with payload hash (same payload -> original receipt,
    different payload -> 409 IDEMPOTENCY_CONFLICT)
 3. lock the stage row, read clock_timestamp() once (ADR-012)
 4. validate active state, eligibility, assignment, caps, cooldown, schema
 5. insert submission + evaluation job + audit + outbox in ONE transaction
 6. commit, then acknowledge 202 with an immutable receipt

Deadlines, caps and cooldowns are server-side and race-safe.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from .. import security
from ..audit import audit_write
from ..db import app_session, uuid7
from ..deps import Principal, get_principal, rate_limit, require_role, require_rules_accepted
from ..errors import ApiError
from ..jobs import enqueue

router = APIRouter(tags=["submissions"])

CATEGORIES = {
    "logic",
    "input_validation",
    "authentication_authorization",
    "injection",
    "cryptography",
    "resource_handling",
    "concurrency",
    "error_handling",
    "configuration",
    "integration_api_contract",
    "data_handling",
    "other",
}


class RelatedLocation(BaseModel):
    file_path: str = Field(max_length=500)
    line_start: int = Field(ge=1, le=100000)
    line_end: int = Field(ge=1, le=100000)


class SubmissionIn(BaseModel):
    kind: str = Field(default="bug_report", pattern="^(bug_report|ctf_flag)$")
    challenge_id: str | None = None
    file_path: str | None = Field(default=None, max_length=500)
    line_start: int | None = Field(default=None, ge=1, le=100000)
    line_end: int | None = Field(default=None, ge=1, le=100000)
    related_locations: list[RelatedLocation] = Field(default_factory=list, max_length=5)
    category: str | None = None
    claimed_severity: str | None = Field(default=None, pattern="^(low|medium|high|critical)$")
    title: str | None = Field(default=None, min_length=5, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    impact: str | None = Field(default=None, max_length=500)
    evidence: str | None = Field(default=None, max_length=2000)
    suggested_fix: str | None = Field(default=None, max_length=500)
    flag_code: str | None = Field(default=None, min_length=4, max_length=200)


def _stage_config(stage_row) -> dict:
    return stage_row["config"] or {}


def _validate_report_fields(body: SubmissionIn, cfg: dict) -> None:
    if body.kind == "bug_report":
        if not body.title or len(body.title.strip()) < 5:
            raise ApiError("SUBMISSION_INVALID", details={"title": "Required, 5-120 characters."})
        if not body.file_path:
            raise ApiError("SUBMISSION_INVALID", details={"file_path": "Target file is required."})
        if body.line_start is None or body.line_end is None or body.line_start > body.line_end:
            raise ApiError("SUBMISSION_INVALID", details={"line_start": "Line range is invalid."})
        max_span = int(cfg.get("max_span", 25))
        if body.line_end - body.line_start + 1 > max_span:
            raise ApiError("SUBMISSION_INVALID", details={"line_range": f"Span exceeds {max_span} lines."})
        if not body.description or len(body.description.strip()) < 20:
            raise ApiError("SUBMISSION_INVALID", details={"description": "Required, at least 20 characters."})
        if body.category not in CATEGORIES:
            raise ApiError("SUBMISSION_INVALID", details={"category": "Category must come from the taxonomy."})


@router.post("/submissions", status_code=202)
def create_submission(
    body: SubmissionIn,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=80),
    p: Principal = Depends(get_principal),
):
    require_role("participant")(p)
    require_rules_accepted(p)
    rate_limit(f"submit:{p.id}", limit=30, window_s=60)
    payload_hash = security.canonical_payload_hash(body.model_dump())

    with app_session() as s:
        # --- identity context (server-side only) -------------------------------
        member = (
            s.execute(
                text(
                    "SELECT tm.team_id, t.event_id, e.tenant_id, e.status AS event_status "
                    "FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.events e ON e.id = t.event_id WHERE tm.user_id = CAST(:u AS uuid) LIMIT 1"
                ),
                {"u": p.id},
            )
            .mappings()
            .first()
        )
        if member is None:
            raise ApiError("AUTH_FORBIDDEN", message="You are not assigned to a team for this event.")

        # --- idempotency reservation (unique (author_id, idempotency_key)) -----
        existing = (
            s.execute(
                text(
                    "SELECT id, receipt_code, received_at, status, payload_hash FROM app.submissions "
                    "WHERE author_id = CAST(:u AS uuid) AND idempotency_key = :k"
                ),
                {"u": p.id, "k": idempotency_key},
            )
            .mappings()
            .first()
        )
        if existing is not None:
            if existing["payload_hash"] != payload_hash:
                raise ApiError("IDEMPOTENCY_CONFLICT")
            # same payload: original receipt, even if the round has since ended (spec 10.4)
            return _receipt(existing, member, replay=True)

        # --- lock the stage row, then read the DB clock ONCE (ADR-012) ---------
        stage = (
            s.execute(
                text(
                    "SELECT st.id, st.status, st.starts_at, st.ends_at, st.grace_seconds, st.config, st.rule_set_hash, "
                    "e.id AS event_id, e.status AS event_status "
                    "FROM app.stages st JOIN app.events e ON e.id = st.event_id "
                    "WHERE e.id = CAST(:ev AS uuid) AND st.kind <> 'level' ORDER BY st.ordinal DESC LIMIT 1 FOR UPDATE"
                ),
                {"ev": str(member["event_id"])},
            )
            .mappings()
            .first()
        )
        if stage is None:
            raise ApiError("ROUND_NOT_ACTIVE")
        now = s.execute(text("SELECT clock_timestamp()")).scalar_one()  # the ONLY acceptance clock
        cfg = _stage_config(stage)
        eff_end = stage["ends_at"]
        if eff_end is not None:
            adj = s.execute(
                text(
                    "SELECT COALESCE(SUM(delta_seconds), 0) FROM app.time_adjustments "
                    "WHERE stage_id = CAST(:s AS uuid) AND (user_id IS NULL OR user_id = CAST(:u AS uuid))"
                ),
                {"s": str(stage["id"]), "u": p.id},
            ).scalar_one()
            eff_end = eff_end + timedelta(seconds=int(adj or 0))
        grace = int(stage["grace_seconds"] or 0)

        # --- state validation (first failing rule wins, spec 10.4) -------------
        if stage["status"] == "paused":
            raise ApiError("ROUND_PAUSED")
        if stage["status"] not in ("active",):
            if stage["status"] in ("ended", "evaluating", "released", "final"):
                # committed-key replays are handled above; new work is late
                raise ApiError("ROUND_ENDED")
            raise ApiError("ROUND_NOT_ACTIVE")
        if eff_end is not None and now > eff_end + timedelta(seconds=grace):
            raise ApiError("ROUND_ENDED")

        _validate_report_fields(body, cfg)

        if body.kind == "bug_report":
            # assignment + file membership (SEC-02)
            team_id = str(member["team_id"])
            ch = s.execute(
                text(
                    "SELECT a.challenge_version_id FROM app.assignments a "
                    "JOIN app.challenge_versions cv ON cv.id = a.challenge_version_id "
                    "WHERE a.stage_id = CAST(:s AS uuid) AND (a.team_id IS NULL OR a.team_id = CAST(:t AS uuid)) "
                    "AND cv.status = 'published' LIMIT 1"
                ),
                {"s": str(stage["id"]), "t": team_id},
            ).first()
            if ch is None:
                raise ApiError("SUBMISSION_INVALID", details={"challenge": "No challenge assigned to your team."})
            challenge_id = str(ch[0])
            f = s.execute(
                text("SELECT 1 FROM app.challenge_files WHERE challenge_version_id = CAST(:c AS uuid) AND path = :p"),
                {"c": challenge_id, "p": body.file_path},
            ).first()
            if f is None:
                raise ApiError("FILE_NOT_FOUND")
            # caps + cooldown (INT-01/INT-05)
            max_per_file = int(cfg.get("max_reports_per_file", 12))
            per_file = s.execute(
                text(
                    "SELECT count(*) FROM app.submissions WHERE stage_id = CAST(:s AS uuid) AND author_id = CAST(:u AS uuid) "
                    "AND kind = 'bug_report' AND file_path = :fp AND status <> 'rejected_auto'"
                ),
                {"s": str(stage["id"]), "u": p.id, "fp": body.file_path},
            ).scalar_one()
            if int(per_file) >= max_per_file:
                raise ApiError("SUBMISSION_CAP_REACHED", details={"file": body.file_path, "limit": max_per_file})
            max_per_round = int(cfg.get("max_reports_per_round", 80))
            per_round = s.execute(
                text(
                    "SELECT count(*) FROM app.submissions WHERE stage_id = CAST(:s AS uuid) AND author_id = CAST(:u AS uuid) "
                    "AND kind = 'bug_report'"
                ),
                {"s": str(stage["id"]), "u": p.id},
            ).scalar_one()
            if int(per_round) >= max_per_round:
                raise ApiError("SUBMISSION_CAP_REACHED", details={"round": True, "limit": max_per_round})
            cooldown = int(cfg.get("file_cooldown_s", 20))
            if cooldown > 0:
                last = s.execute(
                    text(
                        "SELECT received_at FROM app.submissions WHERE stage_id = CAST(:s AS uuid) "
                        "AND author_id = CAST(:u AS uuid) AND kind = 'bug_report' AND file_path = :fp "
                        "ORDER BY received_at DESC LIMIT 1"
                    ),
                    {"s": str(stage["id"]), "u": p.id, "fp": body.file_path},
                ).first()
                if last is not None:
                    since = (now - last[0]).total_seconds()
                    if since < cooldown:
                        raise ApiError("SUBMISSION_COOLDOWN", details={"n": int(cooldown - since)})
        else:
            # CTF flag: challenge binding same as reports
            team_id = str(member["team_id"])
            ch = s.execute(
                text(
                    "SELECT a.challenge_version_id FROM app.assignments a WHERE a.stage_id = CAST(:s AS uuid) "
                    "AND (a.team_id IS NULL OR a.team_id = CAST(:t AS uuid)) LIMIT 1"
                ),
                {"s": str(stage["id"]), "t": team_id},
            ).first()
            if ch is None:
                raise ApiError("SUBMISSION_INVALID", details={"challenge": "No challenge assigned to your team."})
            challenge_id = str(ch[0])

        # The body value is untrusted. Persist the challenge version resolved from
        # this participant's team assignment, not the caller-supplied identifier.
        persisted_payload = body.model_dump()
        persisted_payload["challenge_id"] = challenge_id

        # --- insert submission + job + audit + outbox in ONE transaction -------
        submission_id = str(uuid7())
        receipt = security.receipt_code(submission_id, now)
        status0 = "received"
        s.execute(
            text(
                "INSERT INTO app.submissions (id, tenant_id, event_id, stage_id, challenge_version_id, team_id, "
                "author_id, kind, idempotency_key, payload, payload_hash, status, receipt_code, title, file_path, "
                "line_start, line_end, category, flag_code, received_at) "
                "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:ev AS uuid), CAST(:st AS uuid), CAST(:cv AS uuid), "
                "CAST(:team AS uuid), CAST(:au AS uuid), :kind, :idem, CAST(:payload AS jsonb), :ph, :status, :receipt, "
                ":title, :fp, :ls, :le, :cat, :flag, :received_at)"
            ),
            {
                "id": submission_id,
                "t": str(member["tenant_id"]),
                "ev": str(member["event_id"]),
                "st": str(stage["id"]),
                "cv": challenge_id,
                "team": str(member["team_id"]),
                "au": p.id,
                "kind": body.kind,
                "idem": idempotency_key,
                "payload": __import__("json").dumps(persisted_payload, default=str),
                "ph": payload_hash,
                "status": status0,
                "receipt": receipt,
                "title": (body.title or ("Flag submission" if body.kind == "ctf_flag" else "Report"))[:160],
                "fp": body.file_path,
                "ls": body.line_start,
                "le": body.line_end,
                "cat": body.category,
                "flag": body.flag_code,
                "received_at": now,
            },
        )
        enqueue(s, "evaluate_submission", {"submission_id": submission_id, "rule_set_hash": stage["rule_set_hash"]})
        enqueue(s, "refresh_leaderboard", {"stage_id": str(stage["id"])})
        s.execute(
            text(
                "INSERT INTO app.outbox_events (id, event_type, payload) VALUES (CAST(:id AS uuid), 'submission_update', "
                "CAST(:p AS jsonb))"
            ),
            {"id": str(uuid7()), "p": __import__("json").dumps({"submission_id": submission_id, "status": "received"})},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="submission.created",
            entity_type="submission",
            entity_id=submission_id,
            request_id=request.state.request_id,
            details={"kind": body.kind, "receipt": receipt},
            event_scope=f"event:{member['event_id']}",
        )
    return _receipt(
        {
            "id": submission_id,
            "receipt_code": receipt,
            "received_at": now,
            "status": status0,
            "payload_hash": payload_hash,
        },
        member,
        replay=False,
    )


def _receipt(row, member, *, replay: bool) -> dict:
    return {
        "submission_id": str(row["id"]),
        "receipt_code": row["receipt_code"],
        "received_at": row["received_at"].isoformat()
        if isinstance(row["received_at"], datetime)
        else str(row["received_at"]),
        "status": "received",
        "replay": replay,
        "team_id": str(member["team_id"]) if member else None,
    }


@router.get("/submissions")
def my_submissions(p: Principal = Depends(get_principal)):
    require_role("participant")(p)
    with app_session() as s:
        rows = (
            s.execute(
                text(
                    "SELECT id, kind, title, file_path, line_start, line_end, category, status, receipt_code, "
                    "received_at, flag_code, feedback_released, matched_bug_code, points_visible "
                    "FROM app.submissions WHERE author_id = CAST(:u AS uuid) ORDER BY received_at DESC LIMIT 200"
                ),
                {"u": p.id},
            )
            .mappings()
            .all()
        )
    out = []
    for r in rows:
        item = {
            "id": str(r["id"]),
            "kind": r["kind"],
            "title": r["title"],
            "file_path": r["file_path"],
            "line_start": r["line_start"],
            "line_end": r["line_end"],
            "category": r["category"],
            "receipt_code": r["receipt_code"],
            "received_at": r["received_at"].isoformat(),
            "flag_code": r["flag_code"] if r["kind"] == "ctf_flag" else None,
        }
        # feedback_mode=hidden until release (INT-01): statuses coarse before release
        if r["feedback_released"]:
            item["status"] = r["status"]
            item["matched_bug_code"] = r["matched_bug_code"]
            item["points_visible"] = float(r["points_visible"] or 0)
        else:
            item["status"] = (
                "received"
                if r["status"] in ("received", "matched_auto", "needs_review", "in_review", "decided", "ledgered")
                else r["status"]
            )
        out.append(item)
    return {"submissions": out}


@router.get("/submissions/{submission_id}")
def my_submission(submission_id: str, p: Principal = Depends(get_principal)):
    require_role("participant")(p)
    with app_session() as s:
        r = (
            s.execute(
                text(
                    "SELECT id, kind, title, file_path, line_start, line_end, category, status, receipt_code, "
                    "received_at, payload, feedback_released, matched_bug_code, points_visible "
                    "FROM app.submissions WHERE id = CAST(:sid AS uuid) AND author_id = CAST(:u AS uuid)"
                ),
                {"sid": submission_id, "u": p.id},
            )
            .mappings()
            .first()
        )
    if r is None:
        # 404, not 403: existence of others' submissions is not disclosed (SEC-02)
        raise ApiError("NOT_FOUND")
    return {
        "id": str(r["id"]),
        "kind": r["kind"],
        "title": r["title"],
        "file_path": r["file_path"],
        "line_start": r["line_start"],
        "line_end": r["line_end"],
        "category": r["category"],
        "receipt_code": r["receipt_code"],
        "received_at": r["received_at"].isoformat(),
        "payload": r["payload"],
        "released": bool(r["feedback_released"]),
        "matched_bug_code": r["matched_bug_code"] if r["feedback_released"] else None,
        "points": float(r["points_visible"] or 0) if r["feedback_released"] else None,
    }


class DisputeIn(BaseModel):
    statement: str = Field(min_length=10, max_length=1000)


@router.post("/submissions/{submission_id}/dispute", status_code=201)
def create_dispute(submission_id: str, body: DisputeIn, request: Request, p: Principal = Depends(get_principal)):
    require_role("participant")(p)
    with app_session() as s:
        r = s.execute(
            text(
                "SELECT id, team_id, feedback_released FROM app.submissions "
                "WHERE id = CAST(:sid AS uuid) AND author_id = CAST(:u AS uuid)"
            ),
            {"sid": submission_id, "u": p.id},
        ).first()
        if r is None:
            raise ApiError("NOT_FOUND")
        if not r[2]:
            raise ApiError("VALIDATION_ERROR", details={"dispute": "Disputes open after results are released."})
        s.execute(
            text(
                "INSERT INTO app.disputes (id, submission_id, team_id, statement) VALUES "
                "(CAST(:id AS uuid), CAST(:sid AS uuid), CAST(:t AS uuid), :st)"
            ),
            {"id": str(uuid7()), "sid": submission_id, "t": str(r[1]), "st": body.statement},
        )
        s.execute(
            text("UPDATE app.submissions SET status='disputed' WHERE id = CAST(:sid AS uuid)"), {"sid": submission_id}
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="dispute.created",
            entity_type="submission",
            entity_id=submission_id,
            request_id=request.state.request_id,
        )
    return {"ok": True}


class DraftIn(BaseModel):
    payload: dict
    version: int | None = None


@router.get("/drafts/{challenge_id}")
def get_draft(challenge_id: str, p: Principal = Depends(get_principal)):
    require_role("participant")(p)
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT payload, version, updated_at FROM app.drafts WHERE author_id = CAST(:u AS uuid) AND challenge_version_id = CAST(:c AS uuid)"
                ),
                {"u": p.id, "c": challenge_id},
            )
            .mappings()
            .first()
        )
    if row is None:
        return {"payload": {}, "version": 0, "updated_at": None}
    return {"payload": row["payload"], "version": row["version"], "updated_at": row["updated_at"].isoformat()}


@router.put("/drafts/{challenge_id}")
def put_draft(challenge_id: str, body: DraftIn, p: Principal = Depends(get_principal)):
    require_role("participant")(p)
    with app_session() as s:
        row = s.execute(
            text(
                "SELECT version FROM app.drafts WHERE author_id = CAST(:u AS uuid) AND challenge_version_id = CAST(:c AS uuid) FOR UPDATE"
            ),
            {"u": p.id, "c": challenge_id},
        ).first()
        if row is None:
            s.execute(
                text(
                    "INSERT INTO app.drafts (id, author_id, challenge_version_id, payload, version) VALUES "
                    "(CAST(:id AS uuid), CAST(:u AS uuid), CAST(:c AS uuid), CAST(:p AS jsonb), 1)"
                ),
                {
                    "id": str(uuid7()),
                    "u": p.id,
                    "c": challenge_id,
                    "p": __import__("json").dumps(body.payload, default=str),
                },
            )
            return {"version": 1}
        if body.version is not None and int(body.version) != int(row[0]):
            raise ApiError("DRAFT_VERSION_CONFLICT")
        s.execute(
            text(
                "UPDATE app.drafts SET payload = CAST(:p AS jsonb), version = version + 1, updated_at = now() "
                "WHERE author_id = CAST(:u AS uuid) AND challenge_version_id = CAST(:c AS uuid)"
            ),
            {"p": __import__("json").dumps(body.payload, default=str), "u": p.id, "c": challenge_id},
        )
        return {"version": int(row[0]) + 1}
