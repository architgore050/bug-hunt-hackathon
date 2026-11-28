"""Evaluation job handlers (spec 10.5, 13.x).

The evaluator is the only component that reads ground truth (gt schema, via
gt_session). Handlers are idempotent: award claims are guarded by the database
unique constraint, and component entries are checked before insert. Every
decision path records its feature values for replayability (DAT-05).

Score components per award unit (weights frozen in event config):
  functional_test  - organizer-recorded hidden-test results (ADR-019)
  code_review      - reviewer rubric score
  evidence_report  - deterministic alias-evidence quality from the match
  ctf_bonus        - verified flags, capped per stage config
"""

from __future__ import annotations

import json

from sqlalchemy import text

from . import jobs
from .db import app_session, gt_session
from .matching import GtBugView, GtLocation, decide
from .scoring import add_ledger_entry, build_leaderboard, claim_award_unit, compute_award_points, save_snapshot


def _submission(session, submission_id: str):
    return (
        session.execute(
            text(
                "SELECT s.id, s.kind, s.payload, s.status, s.stage_id, s.event_id, s.team_id, s.author_id, "
                "s.challenge_version_id, s.flag_code, s.received_at, e.tenant_id, st.config AS stage_config, "
                "st.rule_set_hash, e.config AS event_config "
                "FROM app.submissions s JOIN app.stages st ON st.id = s.stage_id "
                "JOIN app.events e ON e.id = s.event_id WHERE s.id = CAST(:sid AS uuid)"
            ),
            {"sid": submission_id},
        )
        .mappings()
        .first()
    )


def _candidates_for_version(gt_session_, challenge_version_id: str) -> list[GtBugView]:
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
    out = []
    for r in rows:
        bug = GtBugView(
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
        out.append(bug)
    return out


def _already_awarded(session, stage_id: str, team_id: str) -> set[str]:
    rows = session.execute(
        text(
            "SELECT award_unit_id FROM app.award_claims WHERE stage_id = CAST(:s AS uuid) AND team_id = CAST(:t AS uuid)"
        ),
        {"s": stage_id, "t": team_id},
    ).all()
    return {r[0] for r in rows}


def _has_component(session, submission_id: str, component: str, award_unit_id: str | None = None) -> bool:
    if award_unit_id is None:
        row = session.execute(
            text(
                "SELECT 1 FROM app.score_ledger_entries WHERE submission_id = CAST(:sid AS uuid) "
                "AND component = :c AND kind = 'award'"
            ),
            {"sid": submission_id, "c": component},
        ).first()
    else:
        row = session.execute(
            text(
                "SELECT 1 FROM app.score_ledger_entries WHERE submission_id = CAST(:sid AS uuid) "
                "AND award_unit_id = :unit AND component = :c AND kind = 'award'"
            ),
            {"sid": submission_id, "unit": award_unit_id, "c": component},
        ).first()
    return row is not None


@jobs.handler("evaluate_submission")
def evaluate_submission(payload: dict) -> None:
    submission_id = payload["submission_id"]
    with app_session() as session:
        sub = _submission(session, submission_id)
        if sub is None:
            raise ValueError(f"submission {submission_id} not found")
        if sub["kind"] == "ctf_flag":
            jobs.enqueue(session, "verify_flag", {"submission_id": submission_id})
            return
        weights = (
            (sub["event_config"] or {})
            .get("scoring", {})
            .get("weights", {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2})
        )
        stage_cfg = sub["stage_config"] or {}
        rule_set = {
            "max_span": stage_cfg.get("max_span", 25),
            "location_tolerance_lines": stage_cfg.get("location_tolerance_lines", 2),
            "min_description_chars": 20,
        }
        team_id = str(sub["team_id"])
        awarded = _already_awarded(session, str(sub["stage_id"]), team_id)
    with gt_session() as gts:
        candidates = _candidates_for_version(gts, str(sub["challenge_version_id"]))
    report = sub["payload"] or {}
    decision = decide(report, candidates, rule_set, awarded)
    with app_session() as session:
        sub = _submission(session, submission_id)
        if decision.outcome == "accept_full":
            bug = decision.bug
            claimed = claim_award_unit(
                session,
                event_id=str(sub["event_id"]),
                stage_id=str(sub["stage_id"]),
                team_id=str(sub["team_id"]),
                award_unit_id=bug.code,
                submission_id=submission_id,
            )
            if claimed:
                points = compute_award_points(
                    float(bug.points),
                    weights,
                    test_fraction=0.0,
                    review_quality=0.0,
                    evidence_quality=max(decision.features.alias_evidence, 0.6),
                )
                # evidence component is deterministic and immediate
                add_ledger_entry(
                    session,
                    tenant_id=str(sub["tenant_id"]),
                    event_id=str(sub["event_id"]),
                    stage_id=str(sub["stage_id"]),
                    team_id=str(sub["team_id"]),
                    submission_id=submission_id,
                    award_unit_id=bug.code,
                    component="evidence_report",
                    kind="award",
                    points=points["evidence_report"],
                    reason_code="MATCH_FULL",
                    note=f"bug={bug.code} L={decision.features.location_score:.2f} C={decision.features.category_score:.2f} A={decision.features.alias_evidence:.2f}",
                    dedupe_award=True,
                )
                session.execute(
                    text(
                        "UPDATE app.submissions SET status='matched_auto', matched_bug_code=:c WHERE id = CAST(:sid AS uuid)"
                    ),
                    {"c": bug.code, "sid": submission_id},
                )
                # accepted reports still need a code-review score: enqueue reviewer confirmation
                jobs.enqueue(
                    session,
                    "create_review_item",
                    {"submission_id": submission_id, "reason": "auto_accept_confirm", "priority": 7},
                )
            else:
                session.execute(
                    text("UPDATE app.submissions SET status='duplicate' WHERE id = CAST(:sid AS uuid)"),
                    {"sid": submission_id},
                )
        elif decision.outcome == "accept_partial":
            session.execute(
                text("UPDATE app.submissions SET status='needs_review' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            jobs.enqueue(
                session,
                "create_review_item",
                {"submission_id": submission_id, "reason": "partial_match", "priority": 5},
            )
        elif decision.outcome == "reject_invalid":
            session.execute(
                text("UPDATE app.submissions SET status='rejected_auto' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
        else:  # needs_review
            session.execute(
                text("UPDATE app.submissions SET status='needs_review' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            jobs.enqueue(
                session, "create_review_item", {"submission_id": submission_id, "reason": "borderline", "priority": 5}
            )


@jobs.handler("create_review_item")
def create_review_item(payload: dict) -> None:
    submission_id = payload["submission_id"]
    with app_session() as session:
        existing = session.execute(
            text("SELECT 1 FROM app.review_items WHERE submission_id = CAST(:sid AS uuid) AND status <> 'decided'"),
            {"sid": submission_id},
        ).first()
        if existing:
            return
        session.execute(
            text(
                "INSERT INTO app.review_items (id, submission_id, priority, reason) "
                "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), :p, :r)"
            ),
            {
                "id": str(__import__("uuid").uuid4()),
                "sid": submission_id,
                "p": payload.get("priority", 5),
                "r": payload.get("reason"),
            },
        )


@jobs.handler("verify_flag")
def verify_flag(payload: dict) -> None:
    submission_id = payload["submission_id"]
    from .security import flag_code_hash

    with app_session() as s:
        sub = _submission(s, submission_id)
        if sub is None:
            raise ValueError("submission missing")
    with gt_session() as gts:
        flag = None
        if sub["flag_code"]:
            flag = (
                gts.execute(
                    text(
                        "SELECT id, flag_key, points, max_awards FROM gt.gt_flags WHERE challenge_version_id = CAST(:c AS uuid) AND code_hash = :h"
                    ),
                    {"c": str(sub["challenge_version_id"]), "h": flag_code_hash(sub["flag_code"])},
                )
                .mappings()
                .first()
            )
    with app_session() as session:
        sub = _submission(session, submission_id)
        cap = float((sub["stage_config"] or {}).get("ctf_bonus_cap_points", 100))
        if flag is None:
            session.execute(
                text("UPDATE app.submissions SET status='rejected_auto' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            return
        # Serialize the cap read and ledger write for this team. Without this
        # lock, concurrent workers can each award against the same stale total.
        session.execute(
            text("SELECT id FROM app.teams WHERE id = CAST(:team AS uuid) FOR UPDATE"),
            {"team": str(sub["team_id"])},
        ).scalar_one()
        # max_awards is shared by every team claiming this public flag key.
        # The transaction-scoped lock serializes the count and claim across workers.
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended('ctf_flag:' || :flag_key, 0))"),
            {"flag_key": flag["flag_key"]},
        ).scalar_one()
        # max_awards per flag
        claimed = session.execute(
            text("SELECT count(*) FROM app.award_claims WHERE award_unit_id = :u"),
            {"u": flag["flag_key"]},
        ).scalar_one()
        if int(claimed) >= int(flag["max_awards"]):
            session.execute(
                text("UPDATE app.submissions SET status='duplicate' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            return
        ok = claim_award_unit(
            session,
            event_id=str(sub["event_id"]),
            stage_id=str(sub["stage_id"]),
            team_id=str(sub["team_id"]),
            award_unit_id=flag["flag_key"],
            submission_id=submission_id,
        )
        if not ok:
            session.execute(
                text("UPDATE app.submissions SET status='duplicate' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            return
        # ctf bonus capped per team: current bonus total + this flag <= cap
        current = session.execute(
            text(
                "SELECT COALESCE(SUM(points), 0) FROM app.score_ledger_entries WHERE stage_id = CAST(:s AS uuid) AND team_id = CAST(:t AS uuid) AND component = 'ctf_bonus'"
            ),
            {"s": str(sub["stage_id"]), "t": str(sub["team_id"])},
        ).scalar_one()
        award_points = min(float(flag["points"]), max(0.0, cap - float(current)))
        add_ledger_entry(
            session,
            tenant_id=str(sub["tenant_id"]),
            event_id=str(sub["event_id"]),
            stage_id=str(sub["stage_id"]),
            team_id=str(sub["team_id"]),
            submission_id=submission_id,
            award_unit_id=flag["flag_key"],
            component="ctf_bonus",
            kind="bonus",
            points=award_points,
            reason_code="FLAG_VERIFIED",
            note=f"flag={flag['flag_key']}" + ("" if award_points == float(flag["points"]) else " (capped)"),
        )
        session.execute(
            text("UPDATE app.submissions SET status='matched_auto', matched_bug_code=:k WHERE id = CAST(:sid AS uuid)"),
            {"k": flag["flag_key"], "sid": submission_id},
        )


@jobs.handler("apply_review_outcome")
def apply_review_outcome(payload: dict) -> None:
    """Apply the persisted reviewer decision to every claimed award unit."""
    submission_id = payload["submission_id"]
    review_id = payload["review_id"]
    with app_session() as session:
        sub = _submission(session, submission_id)
        if sub is None:
            return
        review = (
            session.execute(
                text("SELECT submission_id, decision, rubric, quality FROM app.reviews WHERE id = CAST(:r AS uuid)"),
                {"r": review_id},
            )
            .mappings()
            .first()
        )
        if review is None or str(review["submission_id"]) != submission_id:
            return
        decision = review["decision"]
        rubric = review["rubric"] or {}
        if decision in ("accept_full", "accept_partial"):
            claims = (
                session.execute(
                    text("SELECT award_unit_id FROM app.award_claims WHERE submission_id = CAST(:sid AS uuid)"),
                    {"sid": submission_id},
                )
                .scalars()
                .all()
            )
            weights = (
                (sub["event_config"] or {})
                .get("scoring", {})
                .get("weights", {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2})
            )
            review_quality = float(rubric.get("code_quality", 0)) * 0.4 + float(rubric.get("root_cause", 0)) * 0.6
            if decision == "accept_full":
                review_quality = max(review_quality, 0.5)
            if decision == "accept_partial":
                review_quality *= 0.5
            for unit_id in claims:
                if _has_component(session, submission_id, "code_review", unit_id):
                    continue
                with gt_session() as gts:
                    bug = gts.execute(
                        text(
                            "SELECT points FROM gt.gt_bugs WHERE code = :c AND challenge_version_id = CAST(:v AS uuid)"
                        ),
                        {"c": unit_id, "v": str(sub["challenge_version_id"])},
                    ).first()
                bug_points = float(bug[0]) if bug else 0.0
                pts = compute_award_points(
                    bug_points, weights, test_fraction=0.0, review_quality=review_quality, evidence_quality=0.0
                )
                add_ledger_entry(
                    session,
                    tenant_id=str(sub["tenant_id"]),
                    event_id=str(sub["event_id"]),
                    stage_id=str(sub["stage_id"]),
                    team_id=str(sub["team_id"]),
                    submission_id=submission_id,
                    award_unit_id=unit_id,
                    component="code_review",
                    kind="award",
                    points=pts["code_review"],
                    reason_code=decision.upper(),
                    note=f"rubric={json.dumps(rubric, default=str)[:300]}",
                    dedupe_award=True,
                )
            session.execute(
                text("UPDATE app.submissions SET status='decided' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
        elif decision == "reject_invalid":
            session.execute(
                text("UPDATE app.submissions SET status='rejected_auto' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
        elif decision == "unplanned_valid":
            session.execute(
                text("UPDATE app.submissions SET status='needs_review' WHERE id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            jobs.enqueue(
                session,
                "create_review_item",
                {"submission_id": submission_id, "reason": "unplanned_valid", "priority": 2},
            )


@jobs.handler("apply_test_results")
def apply_test_results(payload: dict) -> None:
    """Organizer-recorded functional test results for every claimed award unit."""
    submission_id = payload["submission_id"]
    passed, total = int(payload["tests_passed"]), int(payload["tests_total"])
    with app_session() as session:
        sub = _submission(session, submission_id)
        if sub is None:
            return
        claims = (
            session.execute(
                text("SELECT award_unit_id FROM app.award_claims WHERE submission_id = CAST(:sid AS uuid)"),
                {"sid": submission_id},
            )
            .scalars()
            .all()
        )
        weights = (
            (sub["event_config"] or {})
            .get("scoring", {})
            .get("weights", {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2})
        )
        for unit_id in claims:
            if _has_component(session, submission_id, "functional_test", unit_id):
                continue
            with gt_session() as gts:
                bug = gts.execute(
                    text("SELECT points FROM gt.gt_bugs WHERE code = :c AND challenge_version_id = CAST(:v AS uuid)"),
                    {"c": unit_id, "v": str(sub["challenge_version_id"])},
                ).first()
            bug_points = float(bug[0]) if bug else 0.0
            pts = compute_award_points(
                bug_points, weights, test_fraction=passed / total, review_quality=0.0, evidence_quality=0.0
            )
            add_ledger_entry(
                session,
                tenant_id=str(sub["tenant_id"]),
                event_id=str(sub["event_id"]),
                stage_id=str(sub["stage_id"]),
                team_id=str(sub["team_id"]),
                submission_id=submission_id,
                award_unit_id=unit_id,
                component="functional_test",
                kind="award",
                points=pts["functional_test"],
                reason_code="TEST_RESULTS",
                note=f"passed {passed}/{total}",
                dedupe_award=True,
            )
        from .scoring import finalize_submission_score

        finalize_submission_score(
            session,
            submission_id=submission_id,
            stage_id=str(sub["stage_id"]),
            team_id=str(sub["team_id"]),
            event_id=str(sub["event_id"]),
            author_id=str(sub["author_id"]),
            tenant_id=str(sub["tenant_id"]),
            received_at=sub["received_at"],
            kind=sub["kind"],
        )


@jobs.handler("release_feedback")
def release_feedback(payload: dict) -> None:
    """Stage release: penalties (capped, applied at release only, INT-01/INT-11),
    code_review defaults for unreviewed accepts, feedback visibility."""
    stage_id = payload["stage_id"]
    with app_session() as session:
        stage = (
            session.execute(
                text(
                    "SELECT st.id, st.status, st.config, e.id AS event_id, e.tenant_id, e.config AS event_config "
                    "FROM app.stages st JOIN app.events e ON e.id = st.event_id WHERE st.id = CAST(:s AS uuid) FOR UPDATE OF st"
                ),
                {"s": stage_id},
            )
            .mappings()
            .first()
        )
        if stage is None or stage["status"] not in ("evaluating", "released", "final"):
            return
        cfg = stage["config"] or {}
        weights = (
            (stage["event_config"] or {})
            .get("scoring", {})
            .get("weights", {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2})
        )
        default_review_quality = float(
            (stage["event_config"] or {}).get("scoring", {}).get("default_review_quality", 0.8)
        )
        penalty_cfg = cfg.get("penalty", {"fp_factor": 0.25, "cap_fraction": 0.2})
        severity_points = {"low": 10, "medium": 20, "high": 30, "critical": 50}

        # 1. code_review defaults for every accepted award unit without a review entry
        accepts = (
            session.execute(
                text(
                    "SELECT s.id, s.team_id, s.challenge_version_id, e.tenant_id "
                    "FROM app.submissions s JOIN app.events e ON e.id = s.event_id "
                    "WHERE s.stage_id = CAST(:s AS uuid) AND s.status IN ('decided','matched_auto','ledgered') "
                    "AND s.kind IN ('bug_report', 'level_report') AND s.matched_bug_code IS NOT NULL"
                ),
                {"s": stage_id},
            )
            .mappings()
            .all()
        )
        for a in accepts:
            claims = (
                session.execute(
                    text("SELECT award_unit_id FROM app.award_claims WHERE submission_id = CAST(:sid AS uuid)"),
                    {"sid": str(a["id"])},
                )
                .scalars()
                .all()
            )
            for unit_id in claims:
                if _has_component(session, str(a["id"]), "code_review", unit_id):
                    continue
                with gt_session() as gts:
                    bug = gts.execute(
                        text(
                            "SELECT points FROM gt.gt_bugs WHERE code = :c AND challenge_version_id = CAST(:v AS uuid)"
                        ),
                        {"c": unit_id, "v": str(a["challenge_version_id"])},
                    ).first()
                bug_points = float(bug[0]) if bug else 0.0
                pts = compute_award_points(
                    bug_points, weights, test_fraction=0.0, review_quality=default_review_quality, evidence_quality=0.0
                )
                add_ledger_entry(
                    session,
                    tenant_id=str(a["tenant_id"]),
                    event_id=str(stage["event_id"]),
                    stage_id=stage_id,
                    team_id=str(a["team_id"]),
                    submission_id=str(a["id"]),
                    award_unit_id=unit_id,
                    component="code_review",
                    kind="award",
                    points=pts["code_review"],
                    reason_code="RELEASE_DEFAULT",
                    note=f"default review quality {default_review_quality} applied at release (disputable)",
                    dedupe_award=True,
                )
            if claims:
                session.execute(
                    text(
                        "UPDATE app.submissions SET status='ledgered', evaluation_state='SCORED' WHERE id = CAST(:sid AS uuid)"
                    ),
                    {"sid": str(a["id"])},
                )

        # 2. penalties for definitively invalid reports, capped (applied at release only)
        if float(penalty_cfg.get("fp_factor", 0)) > 0:
            rejects = (
                session.execute(
                    text(
                        "SELECT s.team_id, e.tenant_id, count(*) AS n FROM app.submissions s JOIN app.events e ON e.id = s.event_id "
                        "WHERE s.stage_id = CAST(:s AS uuid) AND s.status = 'rejected_auto' AND s.kind IN ('bug_report', 'level_report') GROUP BY s.team_id, e.tenant_id"
                    ),
                    {"s": stage_id},
                )
                .mappings()
                .all()
            )
            for r in rejects:
                existing = session.execute(
                    text(
                        "SELECT 1 FROM app.score_ledger_entries WHERE stage_id = CAST(:s AS uuid) "
                        "AND team_id = CAST(:t AS uuid) AND reason_code = 'INVALID_REPORT_PENALTY' LIMIT 1"
                    ),
                    {"s": stage_id, "t": str(r["team_id"])},
                ).first()
                if existing:
                    continue
                penalty_each = severity_points["low"] * float(penalty_cfg.get("fp_factor", 0.25))
                cap = _stage_max_points(session, stage_id) * float(penalty_cfg.get("cap_fraction", 0.2))
                penalty_total = min(penalty_each * int(r["n"]), cap)
                if penalty_total > 0:
                    add_ledger_entry(
                        session,
                        tenant_id=str(r["tenant_id"]),
                        event_id=str(stage["event_id"]),
                        stage_id=stage_id,
                        team_id=str(r["team_id"]),
                        component="penalty",
                        kind="penalty",
                        points=-penalty_total,
                        reason_code="INVALID_REPORT_PENALTY",
                        note=f"{int(r['n'])} invalid report(s), capped at {cap:.1f}",
                    )

        # 3. publish feedback only for the actual release transition
        if stage["status"] in ("released", "final"):
            session.execute(
                text(
                    "UPDATE app.submissions SET feedback_released = true, points_visible = COALESCE(("
                    "SELECT SUM(l.points) FROM app.score_ledger_entries l WHERE l.submission_id = app.submissions.id"
                    "), 0) WHERE stage_id = CAST(:s AS uuid)"
                ),
                {"s": stage_id},
            )


def _stage_max_points(session, stage_id: str) -> float:
    challenge_ids = (
        session.execute(
            text("SELECT challenge_version_id FROM app.assignments WHERE stage_id = CAST(:s AS uuid)"),
            {"s": stage_id},
        )
        .scalars()
        .all()
    )
    if not challenge_ids:
        return 0.0
    with gt_session() as gts:
        rows = gts.execute(
            text(
                "SELECT COALESCE(SUM(points), 0) FROM gt.gt_bugs WHERE challenge_version_id = ANY(CAST(:ids AS uuid[]))"
            ),
            {"ids": [str(value) for value in challenge_ids]},
        ).scalar_one()
    return float(rows or 0)


@jobs.handler("refresh_leaderboard")
def refresh_leaderboard(payload: dict) -> None:
    stage_id = payload["stage_id"]
    visibility = payload.get("visibility")
    with app_session() as session:
        stage = (
            session.execute(
                text("SELECT id, status, config, event_id FROM app.stages WHERE id = CAST(:s AS uuid)"),
                {"s": stage_id},
            )
            .mappings()
            .first()
        )
        if stage is None:
            return
        if stage["status"] in ("released", "final"):
            release_feedback({"stage_id": stage_id})
        cfg = stage["config"] or {}
        if visibility is None:
            mode = cfg.get("leaderboard_mode", "hidden")
            visibility = "public" if mode == "live" else "restricted"
        teams = session.execute(
            text("SELECT id, name FROM app.teams WHERE event_id = CAST(:e AS uuid)"),
            {"e": str(stage["event_id"])},
        ).all()
        team_names = {str(t[0]): t[1] for t in teams}
        invalid = dict(
            session.execute(
                text(
                    "SELECT team_id, count(*) FROM app.submissions WHERE stage_id = CAST(:s AS uuid) AND status = 'rejected_auto' AND kind = 'bug_report' GROUP BY team_id"
                ),
                {"s": stage_id},
            ).all()
        )
        invalid = {str(k): int(v) for k, v in invalid.items()}
        last_accepted_rows = session.execute(
            text(
                "SELECT l.team_id, MAX(s.received_at) FROM app.score_ledger_entries l "
                "JOIN app.submissions s ON s.id = l.submission_id "
                "WHERE l.stage_id = CAST(:s AS uuid) AND l.component <> 'penalty' GROUP BY l.team_id"
            ),
            {"s": stage_id},
        ).all()
        last_accepted = {str(r[0]): r[1] for r in last_accepted_rows if r[1] is not None}
        board = build_leaderboard(
            session,
            event_id=str(stage["event_id"]),
            stage_id=stage_id,
            team_names=team_names,
            invalid_counts=invalid,
            last_accepted_at=last_accepted,
        )
        save_snapshot(session, event_id=str(stage["event_id"]), stage_id=stage_id, payload=board, visibility=visibility)


@jobs.handler("dispatch_outbox")
def dispatch_outbox(payload: dict) -> None:
    with app_session() as session:
        rows = session.execute(
            text("SELECT id FROM app.outbox_events WHERE delivered_at IS NULL LIMIT 100 FOR UPDATE SKIP LOCKED")
        ).all()
        for r in rows:
            session.execute(
                text(
                    "UPDATE app.outbox_events SET delivered_at = now(), attempts = attempts + 1 WHERE id = CAST(:id AS uuid)"
                ),
                {"id": str(r[0])},
            )
