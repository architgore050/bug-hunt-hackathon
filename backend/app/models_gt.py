"""SQLAlchemy models for the ``gt`` schema: ground truth (answer key, flags, hidden tests).

Trust boundary (architecture 9.2, blind spot DAT-03):
- Reachable only via the gt_admin role (db.gt_engine / gt_session()).
- The app_api runtime role has no permission on this schema and is tested for it.
- No value in this schema is ever returned by a participant-facing endpoint.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class GtBase(DeclarativeBase):
    pass


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GtBug(GtBase):
    """One scoreable bug = one canonical award unit (ADR-014).

    ``code`` is the participant-visible bug identifier released only with results.
    ``root_cause_group`` groups multiple symptoms so one report cannot be paid twice.
    """

    __tablename__ = "gt_bugs"
    __table_args__ = (
        UniqueConstraint("challenge_version_id", "code"),
        {"schema": "gt"},
    )

    id: Mapped[uuid.UUID] = pk()
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=False, nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # low|medium|high|critical
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    points: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False)
    root_cause_group: Mapped[str] = mapped_column(String(80), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    fix_guidance: Mapped[str | None] = mapped_column(Text)
    # Level scope for the four-level flow (NULL = legacy fixture, matches every
    # level). Filtered on in evaluator_level._candidates_for_version.
    level: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = ts()


class GtLocation(GtBase):
    """Acceptable report locations for a bug. Anchor hash guards line drift (DAT-06)."""

    __tablename__ = "gt_locations"
    __table_args__ = {"schema": "gt"}

    id: Mapped[uuid.UUID] = pk()
    bug_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("gt.gt_bugs.id"), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    line_end: Mapped[int] = mapped_column(Integer, nullable=False)
    is_primary: Mapped[bool] = mapped_column(default=True, nullable=False)
    anchor_hash: Mapped[str | None] = mapped_column(String(64))


class GtAlias(GtBase):
    """Weighted keywords used as matching evidence (spec 13.2)."""

    __tablename__ = "gt_aliases"
    __table_args__ = {"schema": "gt"}

    id: Mapped[uuid.UUID] = pk()
    bug_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("gt.gt_bugs.id"), nullable=False, index=True)
    keyword: Mapped[str] = mapped_column(String(120), nullable=False)
    weight: Mapped[float] = mapped_column(Numeric(3, 2), default=1.0, nullable=False)


class GtFlag(GtBase):
    """CTF flags, stored HMAC-hashed. The plaintext is kept only in the organizer answer key document."""

    __tablename__ = "gt_flags"
    __table_args__ = (
        UniqueConstraint("challenge_version_id", "code_hash"),
        {"schema": "gt"},
    )

    id: Mapped[uuid.UUID] = pk()
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    flag_key: Mapped[str] = mapped_column(String(40), nullable=False)  # stable public identifier used as award unit
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    points: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False)
    max_awards: Mapped[int] = mapped_column(Integer, default=99, nullable=False)
    position_label: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = ts()


class GtTestCase(GtBase):
    """Hidden functional test cases for a bug (organizer offline evaluator input, DEC-12)."""

    __tablename__ = "gt_test_cases"
    __table_args__ = {"schema": "gt"}

    id: Mapped[uuid.UUID] = pk()
    bug_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("gt.gt_bugs.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    expected_result: Mapped[str] = mapped_column(Text, nullable=False)
    comparison: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)  # manual | exact | normalized
    created_at: Mapped[datetime] = ts()


class GtRevision(GtBase):
    """Immutable revision history of the answer key (DAT-04)."""

    __tablename__ = "gt_revisions"
    __table_args__ = {"schema": "gt"}

    id: Mapped[uuid.UUID] = pk()
    challenge_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = ts()
