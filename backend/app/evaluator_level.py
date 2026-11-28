"""Evaluation for four-level submissions (job handlers).

`evaluate_level_submission` processes one level submission:

- kind `level_report` (Levels 1-2): every flag inside the payload is matched
  deterministically against the frozen ground truth for the team's challenge
  version. Single-location flags use the v1 `decide()` engine; Level 2 flags
  with several ordered locations use `decide_multi()`. Award claims keep the
  exactly-once guarantee: UNIQUE (stage, team, award_unit) means one award per
  team per bug, so a teammate's matching report cannot double-award.
- kind `level_artifact` (Levels 3-4): functional correctness is decided by
  organizer-run hidden tests and human review (ADR-019), so this handler opens
  a review item with the artifact reference; scoring flows through the existing
  review and test-results paths.

This module never trusts client verdicts and never touches participant-facing
responses: verdicts stay hidden until feedback release, exactly like the v1
flow (AGENTS.md invariant 6).
"""

from __future__ import annotations

import uuid

from sqlalchemy import text

from . import jobs
from .db import app_session, gt_session
from .matching import decide, decide_multi
from .scoring import add_ledger_entry, claim_award_unit, compute_award_points


def _submission(session, submission_id: str):
    return (
        session.execute(
            text(
                "SELECT s.id, s.kind, s.payload, s.status, s.stage_id, s.event_id, s.team_id, s.author_id, "
                "s.challenge_version_id, s.received_at, e.tenant_id, st.config AS stage_config, "
                "e.config AS event_config FROM app.submissions s "
                "JOIN app.stages st ON st.id = s.stage_id JOIN app.events e ON e.id = s.event_id "
                "WHERE s.id = CAST(:sid AS uuid)"
            ),
            {"sid": submission_id},
        )
        .mappings()
        .first()
    )


def _candidates_for_version(gt_session_, challenge_version_id: str):
    """Same candidate shape as the v1 evaluator (gt schema, restricted engine)."""
    rows = (
        gt_session_.execute(
            text(
                "SELECT b.id, b.code, b.points, b.category, b.severity, b.root_cause_group, "
                "coalesce(al.keywords, '{}') AS aliases, coalesce(loc.locations, '{}') AS locations "
                "FROM gt.gt_bugs b "
                "LEFT JOIN (SELECT bug_id, json_agg(json_build_object('keyword', keyword, 'weight', weight)) AS keywords "
                "           FROM gt.gt_aliases GROUP BY bug_id) al ON al.bug_id = b.id "
                "LEFT JOIN (SELECT bug_id, json_agg(json_build_object('file_path', file_path, 'line_start', line_start, "
                "           'line_end', line_end, 'is_primary', is_primary)) AS locations "
                "           FROM gt.gt_locations GROUP BY bug_id) loc ON loc.bug_id = b.id "
                "WHERE b.challenge_version_id = CAST(:c AS uuid)"
            ),
            {"c": challenge_version_id},
        )
        .mappings()
        .all()
    )
    from .matching import GtBugView, GtLocation

    out = []
    for r in rows:
        out.append(
            GtBugView(
                bug_id=str(r["id"]),
                code=r["code"],
                points=float(r["points"]),
                category=r["category"],
                severity=r["severity"],
                root_cause_group=r["root_cause_group"],
                aliases=[(a["keyword"], float(a["weight"])) for a in (r["aliases"] or [])],
                locations=[
                    GtLocation(
                        file_path=loc["file_path"],
                        line_start=int(loc["line_start"]),
                        line_end=int(loc["line_end"]),
                        is_primary=bool(loc["is_primary"]),
                    )
                    for loc in (r["locations"] or [])
                ],
            )
        )
    return out


@jobs.handler("evaluate_level_submission")
def evaluate_level_submission(payload: dict) -> None:
    submission_id = payload["submission_id"]
    with app_session() as session:
        sub = _submission(session, submission_id)
        if sub is None:
            raise ValueError(f"submission {submission_id} not found")
        if sub["kind"] == "level_artifact":
            existing = session.execute(
                text("SELECT 1 FROM app.review_items WHERE submission_id = CAST(:sid AS uuid) AND status <> 'decided'"),
                {"sid": submission_id},
            ).first()
            if not existing:
                session.execute(
                    text(
                        "INSERT INTO app.review_items (id, submission_id, priority, reason) "
                        "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), 3, 'level_artifact')"
                    ),
                    {"id": str(uuid.uuid4()), "sid": submission_id},
                )
            return
        if sub["kind"] != "level_report":
            return
        team_id = str(sub["team_id"])
        stage_id = str(sub["stage_id"])
        event_id = str(sub["event_id"])
        challenge_version_id = str(sub["challenge_version_id"])
        stage_cfg = sub["stage_config"] or {}
        rule_set = {
            "max_span": stage_cfg.get("max_span", 25),
            "location_tolerance_lines": stage_cfg.get("location_tolerance_lines", 2),
            "min_description_chars": 20,
        }
        payload_data = sub["payload"] or {}
        flags = payload_data.get("flags") or []
        awarded = {
            r[0]
            for r in session.execute(
                text(
                    "SELECT award_unit_id FROM app.award_claims WHERE stage_id = CAST(:s AS uuid) AND team_id = CAST(:t AS uuid)"
                ),
                {"s": stage_id, "t": team_id},
            ).all()
        }
        level_no = int(payload_data.get("level_no") or payload.get("level_no") or 1)

    with gt_session() as gts:
        candidates = _candidates_for_version(gts, challenge_version_id)

    outcomes: list[str] = []
    with app_session() as session:
        for flag in flags:
            locations = flag.get("locations") or []
            report_text = f"{flag.get('description') or ''} {flag.get('evidence') or ''}"
            if level_no >= 2 and len(locations) > 1:
                decision = decide_multi(
                    locations,
                    report_text,
                    flag.get("category") or "",
                    candidates,
                    rule_set,
                    awarded,
                )
            else:
                single = locations[0] if locations else {}
                report = {
                    "file_path": single.get("file_path") or flag.get("file_path") or "",
                    "line_start": single.get("line_start") or 0,
                    "line_end": single.get("line_end") or 0,
                    "description": flag.get("description") or "",
                    "evidence": flag.get("evidence") or "",
                    "category": flag.get("category") or "",
                }
                decision = decide(report, candidates, rule_set, awarded)
            outcomes.append(decision.outcome)
            if decision.outcome == "accept_full" and decision.bug is not None:
                bug = decision.bug
                claimed = claim_award_unit(
                    session,
                    event_id=event_id,
                    stage_id=stage_id,
                    team_id=team_id,
                    award_unit_id=bug.code,
                    submission_id=submission_id,
                )
                if claimed:
                    awarded.add(bug.code)
                    weights = (
                        (sub["event_config"] or {})
                        .get("scoring", {})
                        .get("weights", {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2})
                    )
                    points = compute_award_points(
                        float(bug.points),
                        weights,
                        test_fraction=0.0,
                        review_quality=0.0,
                        evidence_quality=max(decision.features.alias_evidence, 0.6),
                    )
                    add_ledger_entry(
                        session,
                        tenant_id=str(sub["tenant_id"]),
                        event_id=event_id,
                        stage_id=stage_id,
                        team_id=team_id,
                        submission_id=submission_id,
                        award_unit_id=bug.code,
                        component="evidence_report",
                        kind="award",
                        points=points["evidence_report"],
                        reason_code="MATCH_FULL",
                        note=f"bug={bug.code} L={decision.features.location_score:.2f} C={decision.features.category_score:.2f} A={decision.features.alias_evidence:.2f}",
                        dedupe_award=True,
                    )
                    jobs.enqueue(
                        session,
                        "create_review_item",
                        {"submission_id": submission_id, "reason": "auto_accept_confirm", "priority": 7},
                    )
                else:
                    outcomes[-1] = "duplicate"
            elif decision.outcome in ("accept_partial", "needs_review") and decision.bug is not None:
                jobs.enqueue(
                    session,
                    "create_review_item",
                    {"submission_id": submission_id, "reason": f"level{level_no}_{decision.outcome}", "priority": 5},
                )
        # aggregate the LEVEL submission status (verdict detail stays hidden until release)
        if any(o == "accept_full" for o in outcomes):
            new_status = "matched_auto"
        elif any(o in ("accept_partial", "needs_review") for o in outcomes):
            new_status = "needs_review"
        elif outcomes and all(o == "duplicate" for o in outcomes):
            new_status = "duplicate"
        elif outcomes and all(o in ("reject_invalid", "duplicate") for o in outcomes):
            new_status = "rejected_auto"
        else:
            new_status = "received"  # explicit empty submission: nothing to match
        session.execute(
            text("UPDATE app.submissions SET status = :st WHERE id = CAST(:sid AS uuid)"),
            {"st": new_status, "sid": submission_id},
        )
