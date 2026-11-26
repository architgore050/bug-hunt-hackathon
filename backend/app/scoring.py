"""Scoring service: the immutable ledger, award application, leaderboard snapshots.

Score model (SCORING_MODEL.md; provisional defaults, configurable per event,
frozen at publication and required to be approved by the organizer):

  award_unit_points = gt bug points (base value of one scoreable bug)
  An accepted report produces component entries:
    functional_test: award_unit_points * w_functional * test_fraction
    code_review:     award_unit_points * w_code_review * review_quality
    evidence_report: award_unit_points * w_evidence  * evidence_quality
  w_functional + w_code_review + w_evidence = 1.0 (validated at config freeze)
  ctf_bonus: separate entries, capped by stage config ctf_bonus_cap_points.

The ledger is append-only. Corrections append reversal/adjustment entries;
existing rows are never modified (architecture 8.3, DAT-01/05).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import uuid7
from .models_app import LeaderboardSnapshot, ScoreLedgerEntry


def add_ledger_entry(
    session: Session,
    *,
    tenant_id: str,
    event_id: str,
    stage_id: str,
    team_id: str,
    component: str,
    kind: str,
    points: float,
    reason_code: str,
    submission_id: str | None = None,
    award_unit_id: str | None = None,
    actor_id: str | None = None,
    reverses_entry_id: str | None = None,
    note: str | None = None,
) -> str:
    entry_id = str(uuid7())
    row = ScoreLedgerEntry(
        id=uuid.UUID(entry_id),
        tenant_id=uuid.UUID(tenant_id),
        event_id=uuid.UUID(event_id),
        stage_id=uuid.UUID(stage_id),
        team_id=uuid.UUID(team_id),
        submission_id=uuid.UUID(submission_id) if submission_id else None,
        award_unit_id=award_unit_id,
        component=component,
        kind=kind,
        points=round(float(points), 2),
        reason_code=reason_code,
        actor_id=uuid.UUID(actor_id) if actor_id else None,
        reverses_entry_id=uuid.UUID(reverses_entry_id) if reverses_entry_id else None,
        note=note,
    )
    session.add(row)
    return entry_id


def claim_award_unit(
    session: Session,
    *,
    event_id: str,
    stage_id: str,
    team_id: str,
    award_unit_id: str,
    submission_id: str,
) -> bool:
    """Atomically claim one award unit for a team and stage.

    PostgreSQL arbitrates concurrent claims through the unique constraint
    (stage_id, team_id, award_unit_id). A losing worker receives False rather
    than an IntegrityError, so duplicate evaluation jobs remain harmless.
    """
    claimed_id = session.execute(
        text(
            "INSERT INTO app.award_claims "
            "(id, event_id, stage_id, team_id, award_unit_id, submission_id) "
            "VALUES (CAST(:id AS uuid), CAST(:event_id AS uuid), CAST(:stage_id AS uuid), "
            "CAST(:team_id AS uuid), :award_unit_id, CAST(:submission_id AS uuid)) "
            "ON CONFLICT (stage_id, team_id, award_unit_id) DO NOTHING "
            "RETURNING id"
        ),
        {
            "id": str(uuid.uuid4()),
            "event_id": event_id,
            "stage_id": stage_id,
            "team_id": team_id,
            "award_unit_id": award_unit_id,
            "submission_id": submission_id,
        },
    ).scalar_one_or_none()
    return claimed_id is not None


def compute_award_points(
    bug_points: float, weights: dict, *, test_fraction: float, review_quality: float, evidence_quality: float
) -> dict:
    """Split one award unit into component points per the frozen weights."""
    w_func = float(weights.get("functional_test", 0.5))
    w_review = float(weights.get("code_review", 0.3))
    w_evidence = float(weights.get("evidence_report", 0.2))
    return {
        "functional_test": round(bug_points * w_func * max(0.0, min(1.0, test_fraction)), 2),
        "code_review": round(bug_points * w_review * max(0.0, min(1.0, review_quality)), 2),
        "evidence_report": round(bug_points * w_evidence * max(0.0, min(1.0, evidence_quality)), 2),
    }


def team_totals(session: Session, stage_id: str) -> list[dict]:
    rows = session.execute(
        text("SELECT team_id, SUM(points) AS total FROM app.score_ledger_entries WHERE stage_id = :s GROUP BY team_id"),
        {"s": stage_id},
    ).all()
    return [{"team_id": str(r.team_id), "total": float(r.total or 0)} for r in rows]


def build_leaderboard(
    session: Session,
    *,
    event_id: str,
    stage_id: str,
    team_names: dict[str, str],
    invalid_counts: dict[str, int] | None = None,
    last_accepted_at: dict[str, datetime | None] | None = None,
) -> dict:
    """Ranks with the published tie-break order (INT-12):
    1. total score desc; 2. fewer invalid reports; 3. earlier last accepted finding.
    """
    invalid_counts = invalid_counts or {}
    last_accepted_at = last_accepted_at or {}
    totals = {t["team_id"]: t["total"] for t in team_totals(session, stage_id)}

    def sort_key(team_id: str):
        return (
            -totals.get(team_id, 0.0),
            invalid_counts.get(team_id, 0),
            last_accepted_at.get(team_id) or datetime.max.replace(tzinfo=UTC),
        )

    ordered = sorted(team_names.keys(), key=sort_key)
    rows = []
    for rank, team_id in enumerate(ordered, start=1):
        rows.append(
            {
                "rank": rank,
                "team_id": team_id,
                "team_name": team_names.get(team_id, "?"),
                "score": totals.get(team_id, 0.0),
                "invalid_reports": invalid_counts.get(team_id, 0),
                "last_accepted_at": last_accepted_at.get(team_id).isoformat()
                if last_accepted_at.get(team_id)
                else None,
            }
        )
    return {"stage_id": stage_id, "event_id": event_id, "rows": rows, "generated_at": datetime.now(UTC).isoformat()}


def save_snapshot(session: Session, *, event_id: str, stage_id: str, payload: dict, visibility: str) -> int:
    current = session.execute(
        text("SELECT COALESCE(MAX(version), 0) FROM app.leaderboard_snapshots WHERE stage_id = :s"),
        {"s": stage_id},
    ).scalar_one()
    version = int(current) + 1
    session.add(
        LeaderboardSnapshot(
            id=uuid.uuid4(),
            event_id=uuid.UUID(event_id),
            stage_id=uuid.UUID(stage_id),
            version=version,
            payload=payload,
            visibility=visibility,
        )
    )
    return version
