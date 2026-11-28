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
        session.execute(
            text("UPDATE app.submissions SET evaluation_state = 'EVALUATING' WHERE id = CAST(:sid AS uuid)"),
            {"sid": submission_id},
        )
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
            session.execute(
                text("UPDATE app.submissions SET evaluation_state = 'NEEDS_REVIEW' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
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
        existing_flags = {
            int(r["flag_index"]): dict(r)
            for r in session.execute(
                text(
                    "SELECT flag_index, outcome, matched_bug_code FROM app.submission_flag_results "
                    "WHERE submission_id = CAST(:sid AS uuid)"
                ),
                {"sid": submission_id},
            )
            .mappings()
            .all()
        }
        level_no = int(payload_data.get("level_no") or payload.get("level_no") or 1)

    with gt_session() as gts:
        candidates = _candidates_for_version(gts, challenge_version_id)

    outcomes: list[str] = []
    first_matched_code: str | None = None
    with app_session() as session:
        for idx, flag in enumerate(flags):
            if idx in existing_flags:
                prev = existing_flags[idx]
                outcomes.append(prev["outcome"])
                if first_matched_code is None and prev["matched_bug_code"]:
                    first_matched_code = prev["matched_bug_code"]
                continue
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
            outcome = decision.outcome
            matched_code = decision.bug.code if decision.bug is not None else None
            claimed_award = False
            if outcome == "accept_full" and decision.bug is not None:
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
                    claimed_award = True
                    awarded.add(bug.code)
                    if first_matched_code is None:
                        first_matched_code = bug.code
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
                    )
                    jobs.enqueue(
                        session,
                        "create_review_item",
                        {"submission_id": submission_id, "reason": "auto_accept_confirm", "priority": 7},
                    )
                else:
                    outcome = "duplicate"
            elif outcome in ("accept_partial", "needs_review") and decision.bug is not None:
                jobs.enqueue(
                    session,
                    "create_review_item",
                    {"submission_id": submission_id, "reason": f"level{level_no}_{outcome}", "priority": 5},
                )
            outcomes.append(outcome)
            session.execute(
                text(
                    "INSERT INTO app.submission_flag_results "
                    "(id, submission_id, flag_index, outcome, matched_bug_code, "
                    "location_score, category_score, alias_evidence, claimed_award) "
                    "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), :idx, :out, :mbc, :ls, :cs, :ae, :ca) "
                    "ON CONFLICT (submission_id, flag_index) DO NOTHING"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "sid": submission_id,
                    "idx": idx,
                    "out": outcome,
                    "mbc": matched_code,
                    "ls": round(float(decision.features.location_score), 4),
                    "cs": round(float(decision.features.category_score), 4),
                    "ae": round(float(decision.features.alias_evidence), 4),
                    "ca": claimed_award,
                },
            )
        # aggregate the LEVEL submission status (verdict detail stays hidden until release)
        if any(o == "accept_full" for o in outcomes):
            new_status = "matched_auto"
            eval_state = "SCORED"
        elif any(o in ("accept_partial", "needs_review") for o in outcomes):
            new_status = "needs_review"
            eval_state = "NEEDS_REVIEW"
        elif outcomes and all(o in ("reject_invalid", "duplicate") for o in outcomes):
            new_status = "rejected_auto"
            eval_state = "SCORED"
        else:
            new_status = "received"  # explicit empty submission: nothing to match
            eval_state = "SCORED"
        session.execute(
            text(
                "UPDATE app.submissions SET status = :st, "
                "matched_bug_code = COALESCE(matched_bug_code, :mbc), "
                "evaluation_state = :es "
                "WHERE id = CAST(:sid AS uuid)"
            ),
            {"st": new_status, "mbc": first_matched_code, "es": eval_state, "sid": submission_id},
        )
