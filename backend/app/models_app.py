"""SQLAlchemy models for the ``app`` schema (participant/admin domain data).

Ground truth lives in models_gt.py under the ``gt`` schema and is reachable only
through the gt_admin role (see db.py). The app_api runtime role cannot read it.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class AppBase(DeclarativeBase):
    pass


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# --- tenancy -----------------------------------------------------------------


class Tenant(AppBase):
    __tablename__ = "tenants"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    created_at: Mapped[datetime] = ts()


# --- identity ----------------------------------------------------------------


class User(AppBase):
    __tablename__ = "users"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.tenants.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # participant | reviewer | organizer | admin  (integrity_officer folded into reviewer for v1, documented)
    role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(256))
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    registration_id: Mapped[str | None] = mapped_column(String(64))
    accommodation_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()


class SessionRow(AppBase):
    __tablename__ = "sessions"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = ts()
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # last successful step-up re-authentication (AUTH-09; see deps.step_up_verified)
    step_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(AppBase):
    """Opaque refresh tokens, hashed at rest. Family = session_id (AUTH-01..04)."""

    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.sessions.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # active | rotated | revoked
    status: Mapped[str] = mapped_column(String(12), default="active", server_default=text("'active'"), nullable=False)
    # encrypted successor token, recoverable within the reuse grace window (spec 6.2)
    successor_encrypted: Mapped[str | None] = mapped_column(Text)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaces_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = ts()


class Acceptance(AppBase):
    __tablename__ = "acceptances"
    __table_args__ = (UniqueConstraint("user_id", "rules_version"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False, index=True)
    rules_version: Mapped[int] = mapped_column(Integer, nullable=False)
    accepted_at: Mapped[datetime] = ts()
    ip_hash: Mapped[str | None] = mapped_column(String(64))


# --- events ------------------------------------------------------------------


class Event(AppBase):
    __tablename__ = "events"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.tenants.id"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # draft | configured | ready | live | closed | finalized | archived  (spec 12.1)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default=text("'draft'"), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(60), default="Asia/Kolkata", nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=180, server_default=text("180"), nullable=False)
    max_participants: Mapped[int] = mapped_column(Integer, default=50, server_default=text("50"), nullable=False)
    max_teams: Mapped[int] = mapped_column(Integer, default=12, server_default=text("12"), nullable=False)
    rules_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    # frozen at publication; {scoring: {...}, features: {...}, capacity_note: str, schedule: [...]}
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False)
    config_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    created_at: Mapped[datetime] = ts()


class EventConfigRevision(AppBase):
    __tablename__ = "event_config_revisions"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    rule_set_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()


class RulesDocument(AppBase):
    __tablename__ = "rules_documents"
    __table_args__ = (UniqueConstraint("event_id", "version"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()


class ReadinessItem(AppBase):
    __tablename__ = "readiness_items"
    __table_args__ = (UniqueConstraint("event_id", "key"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    state: Mapped[str] = mapped_column(
        String(20), default="unchecked", server_default=text("'unchecked'"), nullable=False
    )  # unchecked|checked|na
    owner: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --- teams and participants --------------------------------------------------


class Team(AppBase):
    __tablename__ = "teams"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    join_code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="active", server_default=text("'active'"), nullable=False
    )  # active|disqualified
    seat_label: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = ts()


class TeamMember(AppBase):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.teams.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False, index=True)
    seat_label: Mapped[str | None] = mapped_column(String(40))
    joined_at: Mapped[datetime] = ts()


# --- stages (the spec's "rounds"; see SOURCE_OF_TRUTH_AND_TRACEABILITY R-013) --


class Stage(AppBase):
    __tablename__ = "stages"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), default="main", nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    # draft|sealed|armed|active|paused|ended|evaluating|released|final  (spec 12.2)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default=text("'draft'"), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    grace_seconds: Mapped[int] = mapped_column(Integer, default=3, server_default=text("3"), nullable=False)
    # frozen at arming: caps, feedback_mode, leaderboard_mode, scoring weights, ctf policy, run limits
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False)
    rule_set_hash: Mapped[str | None] = mapped_column(String(80))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()


class StageTransition(AppBase):
    __tablename__ = "stage_transitions"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.users.id"))
    reason_code: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = ts()


class TimeAdjustment(AppBase):
    __tablename__ = "time_adjustments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.users.id"), index=True)
    delta_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    reason_code: Mapped[str] = mapped_column(String(40), nullable=False)  # ACCOMMODATION|OUTAGE|DEVICE_FAILURE|OTHER
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False)
    created_at: Mapped[datetime] = ts()


# --- challenges ---------------------------------------------------------------


class ChallengeVersion(AppBase):
    __tablename__ = "challenge_versions"

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    # draft|reviewed|frozen|sealed|published|archived  (spec 12.4)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default=text("'draft'"), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(80))
    instructions_md: Mapped[str | None] = mapped_column(Text)
    participant_manifest: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()
    __table_args__ = (
        UniqueConstraint("event_id", "slug", "version"),
        {"schema": "app"},
    )


class ChallengeFile(AppBase):
    """Participant-visible source files. Answer material never goes here."""

    __tablename__ = "challenge_files"
    __table_args__ = (UniqueConstraint("challenge_version_id", "path"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app.challenge_versions.id"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    lang: Mapped[str] = mapped_column(String(20), default="text", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    line_count: Mapped[int] = mapped_column(Integer, nullable=False)


class ChallengeFileLine(AppBase):
    """Precomputed line index for server-side search, built at challenge sealing (FE-04)."""

    __tablename__ = "challenge_file_lines"
    __table_args__ = (
        Index("ix_cfl_version_line", "challenge_version_id", "line_number"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = pk()
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app.challenge_versions.id"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    line_text: Mapped[str] = mapped_column(Text, nullable=False)


class Assignment(AppBase):
    """Repository/challenge assignment. Not hardcoded to one repo or team (master prompt §4)."""

    __tablename__ = "assignments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app.challenge_versions.id"), nullable=False, index=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.teams.id"), index=True)  # NULL = every team
    repo_url: Mapped[str | None] = mapped_column(String(300))
    codespace_url: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = ts()


# --- drafts and submissions ---------------------------------------------------


class Draft(AppBase):
    __tablename__ = "drafts"
    __table_args__ = (
        UniqueConstraint("author_id", "challenge_version_id"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = pk()
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False, index=True)
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.challenge_versions.id"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    updated_at: Mapped[datetime] = ts()


class Submission(AppBase):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("author_id", "idempotency_key"),
        Index("ix_sub_stage_received", "stage_id", "received_at"),
        Index("ix_sub_team_status", "team_id", "status"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.tenants.id"), nullable=False, index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.challenge_versions.id"), nullable=False)
    team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.teams.id"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # bug_report | ctf_flag
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # received|matched_auto|needs_review|in_review|decided|rejected_auto|duplicate|disputed|ledgered
    status: Mapped[str] = mapped_column(
        String(24), default="received", server_default=text("'received'"), nullable=False
    )
    receipt_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(500))
    line_start: Mapped[int | None] = mapped_column(Integer)
    line_end: Mapped[int | None] = mapped_column(Integer)
    category: Mapped[str | None] = mapped_column(String(60))
    flag_code: Mapped[str | None] = mapped_column(String(200))
    # server clock_timestamp() captured after the stage row lock (ADR-012)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # feedback policy (INT-01): verdict details are hidden until release
    feedback_released: Mapped[bool] = mapped_column(default=False, server_default=text("false"), nullable=False)
    matched_bug_code: Mapped[str | None] = mapped_column(String(40))
    points_visible: Mapped[float] = mapped_column(Numeric(10, 2), default=0, server_default=text("0"), nullable=False)
    created_at: Mapped[datetime] = ts()


class ReviewItem(AppBase):
    __tablename__ = "review_items"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    submission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.submissions.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20), default="open", server_default=text("'open'"), nullable=False
    )  # open|claimed|decided
    claimed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.users.id"))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[int] = mapped_column(Integer, default=5, server_default=text("5"), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = ts()


class Review(AppBase):
    __tablename__ = "reviews"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    submission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.submissions.id"), nullable=False, index=True)
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False)
    # accept_full | accept_partial | duplicate | reject_invalid | unplanned_valid | needs_second_review
    decision: Mapped[str] = mapped_column(String(30), nullable=False)
    # rubric scores 0.0-1.0: functionality, root_cause, code_quality, testing, evidence
    rubric: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False)
    quality: Mapped[float] = mapped_column(Numeric(3, 2), default=1.0, server_default=text("1.0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    is_double_review: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), nullable=False)
    created_at: Mapped[datetime] = ts()


class Dispute(AppBase):
    __tablename__ = "disputes"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    submission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.submissions.id"), nullable=False, index=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.teams.id"), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="open", server_default=text("'open'"), nullable=False
    )  # open|in_review|upheld|rejected
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()


# --- scoring ------------------------------------------------------------------

# INVARIANT (REM-017): every scoring/award mutation must audit_write inside the
# same DB transaction as the ledger/claim change, so the audit hash chain stays
# parallel to the append-only ledger. Audit chain heads are serialized per
# event_scope (see audit.py); verification must enumerate all scopes.


class ScoreLedgerEntry(AppBase):
    """Append-only ledger. Corrections are reversal/adjustment entries (architecture 8.3).

    INVARIANT (REM-051): `reverses_entry_id` ties every reversal/adjustment
    entry back to the original it corrects; the pair (original + reversal)
    gives net zero for the reversed award. Rows are never UPDATEd/DELETEd in
    production code paths (append-only; DB triggers reject UPDATE/DELETE).
    """

    __tablename__ = "score_ledger_entries"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.tenants.id"), nullable=False, index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.teams.id"), nullable=False, index=True)
    submission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.submissions.id"), index=True)
    award_unit_id: Mapped[str | None] = mapped_column(String(80), index=True)
    # functional_test | code_review | evidence_report | ai_assessment | ctf_bonus | penalty | adjustment
    component: Mapped[str] = mapped_column(String(30), nullable=False)
    # award | bonus | penalty | adjustment | reversal
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    points: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(60), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.users.id"))
    reverses_entry_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app.score_ledger_entries.id"), index=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()


class AwardClaim(AppBase):
    """One effective award per (team, stage, award unit) - database-enforced (DAT-01).

    INVARIANT (REM-051): UNIQUE(stage_id, team_id, award_unit_id) is the
    database guarantee behind "exactly one effective award per
    (stage, team, award_unit)"; scoring.claim_award_unit's atomic
    ON CONFLICT DO NOTHING insert depends on it.
    """

    __tablename__ = "award_claims"
    __table_args__ = (UniqueConstraint("stage_id", "team_id", "award_unit_id"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.teams.id"), nullable=False, index=True)
    award_unit_id: Mapped[str] = mapped_column(String(80), nullable=False)
    submission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.submissions.id"), nullable=False)
    created_at: Mapped[datetime] = ts()


class LeaderboardSnapshot(AppBase):
    __tablename__ = "leaderboard_snapshots"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.stages.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    visibility: Mapped[str] = mapped_column(
        String(20), default="hidden", server_default=text("'hidden'"), nullable=False
    )  # hidden|restricted|public
    created_at: Mapped[datetime] = ts()


# --- operations ----------------------------------------------------------------


class Announcement(AppBase):
    __tablename__ = "announcements"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(
        String(20), default="info", server_default=text("'info'"), nullable=False
    )  # info|warning|critical
    audience: Mapped[str] = mapped_column(String(20), default="all", server_default=text("'all'"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False)
    created_at: Mapped[datetime] = ts()


class Job(AppBase):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_claim", "status", "run_after"), {"schema": "app"})

    id: Mapped[uuid.UUID] = pk()
    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False)
    # queued|running|done|failed|dead
    status: Mapped[str] = mapped_column(
        String(12), default="queued", server_default=text("'queued'"), nullable=False, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, server_default=text("5"), nullable=False)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OutboxEvent(AppBase):
    __tablename__ = "outbox_events"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False)
    created_at: Mapped[datetime] = ts()
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)


class ExportFile(AppBase):
    __tablename__ = "exports"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.events.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)  # results_csv|submissions_csv|ledger_csv|audit_csv
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app.users.id"), nullable=False)
    created_at: Mapped[datetime] = ts()
