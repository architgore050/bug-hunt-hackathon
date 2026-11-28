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
    dedupe_award: bool = False,
) -> str | None:
    """Append a ledger row.

    Award entries are deduplicated by the partial unique index from migration
    0005, so concurrent evaluators cannot score one unit twice. Corrections,
    bonuses, penalties and adjustments keep the normal append-only path.
    """
    entry_id = str(uuid7())
    if dedupe_award:
        if not submission_id or not award_unit_id:
            raise ValueError("dedupe_award requires submission_id and award_unit_id")
        inserted_id = session.execute(
            text(
                "INSERT INTO app.score_ledger_entries "
                "(id, tenant_id, event_id, stage_id, team_id, submission_id, award_unit_id, component, kind, "
                "points, reason_code, actor_id, reverses_entry_id, note) "
                "VALUES (CAST(:id AS uuid), CAST(:tenant AS uuid), CAST(:event AS uuid), CAST(:stage AS uuid), "
                "CAST(:team AS uuid), CAST(:submission AS uuid), :unit, :component, :kind, :points, :reason, "
                "CAST(:actor AS uuid), CAST(:reverses AS uuid), :note) "
                "ON CONFLICT (submission_id, award_unit_id, component) WHERE kind = 'award' DO NOTHING "
                "RETURNING id"
            ),
            {
                "id": entry_id,
                "tenant": tenant_id,
                "event": event_id,
                "stage": stage_id,
                "team": team_id,
                "submission": submission_id,
                "unit": award_unit_id,
                "component": component,
                "kind": kind,
                "points": round(float(points), 2),
                "reason": reason_code,
                "actor": actor_id,
                "reverses": reverses_entry_id,
                "note": note,
            },
        ).scalar_one_or_none()
        return str(inserted_id) if inserted_id is not None else None
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


def _submission_ledger_total(session: Session, submission_id: str) -> float:
    return float(
        session.execute(
            text(
                "SELECT COALESCE(SUM(points), 0) FROM app.score_ledger_entries WHERE submission_id = CAST(:sid AS uuid)"
            ),
            {"sid": submission_id},
        ).scalar_one()
        or 0
    )


def finalize_submission_score(
    session: Session,
    *,
    submission_id: str,
    stage_id: str,
    team_id: str,
    event_id: str,
    author_id: str,
    tenant_id: str,
    received_at,
    kind: str = "level_report",
) -> None:
    """Record a member's submission score and apply L3/L4 best-member aggregation.

    For L3/L4 (kind='level_artifact'), only the best-scoring member's ledger
    entries count toward the team total. When a new submission beats the current
    best for (stage_id, team_id), reversal entries are appended for the previous
    best member's ledger rows and the new submission becomes team best. Ties are
    broken by earliest submissions.received_at, then submissions.id ascending;
    the earlier submission keeps the active award (no churn/reversal on tie).

    For L1/L2 (kind='level_report'), claim_award_unit already enforces
    UNIQUE(stage_id, team_id, award_unit_id); this function only records the
    submission_scores row without best-member reversal.
    """
    total = round(_submission_ledger_total(session, submission_id), 2)

    # Upsert the per-member submission_scores row.
    # ON CONFLICT touches only the score fields; is_team_best is never
    # overwritten here — it is decided by the aggregation pass below.
    was_best = bool(
        session.execute(
            text(
                "INSERT INTO app.submission_scores "
                "(id, event_id, stage_id, team_id, submission_id, author_id, "
                "total_points, components, is_team_best, received_at, updated_at) "
                "VALUES (CAST(:id AS uuid), CAST(:eid AS uuid), CAST(:stid AS uuid), "
                "CAST(:tid AS uuid), CAST(:sub AS uuid), CAST(:aid AS uuid), :pts, "
                "CAST('{}' AS jsonb), false, :rec, now()) "
                "ON CONFLICT (submission_id) DO UPDATE "
                "SET total_points = EXCLUDED.total_points, updated_at = now() "
                "RETURNING is_team_best"
            ),
            {
                "id": str(uuid.uuid4()),
                "eid": event_id,
                "stid": stage_id,
                "tid": team_id,
                "sub": submission_id,
                "aid": author_id,
                "pts": total,
                "rec": received_at,
            },
        ).scalar_one()
    )

    # Best-member aggregation applies only to L3/L4 artifact submissions.
    if kind != "level_artifact":
        return

    # Serialize best-member changes on the team row.
    session.execute(
        text("SELECT id FROM app.teams WHERE id = CAST(:tid AS uuid) FOR UPDATE"),
        {"tid": team_id},
    )

    # Current best for this (stage_id, team_id), tie-broken by received_at then id.
    current_best = (
        session.execute(
            text(
                "SELECT ss.submission_id, ss.total_points, ss.is_team_best, s.received_at, s.id "
                "FROM app.submission_scores ss "
                "JOIN app.submissions s ON s.id = ss.submission_id "
                "WHERE ss.stage_id = CAST(:stid AS uuid) AND ss.team_id = CAST(:tid AS uuid) "
                "ORDER BY ss.total_points DESC, s.received_at ASC, s.id ASC "
                "LIMIT 1"
            ),
            {"stid": stage_id, "tid": team_id},
        )
        .mappings()
        .first()
    )

    should_be_best = False
    if current_best is None:
        should_be_best = True
    else:
        current_total = float(current_best["total_points"] or 0)
        if total > current_total:
            should_be_best = True
        elif total == current_total:
            # Tie-break: earlier received_at, then earlier submission id.
            if str(current_best["submission_id"]) == submission_id:
                should_be_best = True
            elif current_best["received_at"] is not None and received_at is not None:
                if received_at < current_best["received_at"] or (
                    received_at == current_best["received_at"] and submission_id < str(current_best["submission_id"])
                ):
                    should_be_best = True
            else:
                if submission_id < str(current_best["submission_id"]):
                    should_be_best = True

    if should_be_best and not was_best:
        # Reverse the previous best member's non-reversal ledger entries.
        if current_best is not None and str(current_best["submission_id"]) != submission_id:
            prev_sub_id = str(current_best["submission_id"])
            prev_rows = (
                session.execute(
                    text(
                        "SELECT id, points FROM app.score_ledger_entries e "
                        "WHERE e.submission_id = CAST(:ps AS uuid) AND e.stage_id = CAST(:stid AS uuid) "
                        "AND e.reverses_entry_id IS NULL "
                        "AND NOT EXISTS (SELECT 1 FROM app.score_ledger_entries r "
                        "WHERE r.reverses_entry_id = e.id)"
                    ),
                    {"ps": prev_sub_id, "stid": stage_id},
                )
                .mappings()
                .all()
            )
            for row in prev_rows:
                add_ledger_entry(
                    session,
                    tenant_id=tenant_id,
                    event_id=event_id,
                    stage_id=stage_id,
                    team_id=team_id,
                    submission_id=prev_sub_id,
                    component="adjustment",
                    kind="reversal",
                    points=-float(row["points"] or 0),
                    reason_code="BEST_MEMBER_REPLACED",
                    reverses_entry_id=str(row["id"]),
                    note="superseded by better member submission",
                )
            session.execute(
                text("UPDATE app.submission_scores SET is_team_best = false WHERE submission_id = CAST(:ps AS uuid)"),
                {"ps": prev_sub_id},
            )
        session.execute(
            text("UPDATE app.submission_scores SET is_team_best = true WHERE submission_id = CAST(:sid AS uuid)"),
            {"sid": submission_id},
        )
    elif not should_be_best and was_best:
        session.execute(
            text("UPDATE app.submission_scores SET is_team_best = false WHERE submission_id = CAST(:sid AS uuid)"),
            {"sid": submission_id},
        )
