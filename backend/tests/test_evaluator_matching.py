"""Decision boundaries for the deterministic single- and multi-location matcher."""

from __future__ import annotations

import pytest
from app.matching import (
    GtBugView,
    GtLocation,
    alias_evidence,
    decide,
    decide_multi,
    location_score,
    rule_set_hash,
)

RULES = {"max_span": 25, "location_tolerance_lines": 2, "min_description_chars": 20}


def _bug(*, category: str = "logic", aliases=None) -> GtBugView:
    return GtBugView(
        bug_id="bug-id",
        code="TEST-BUG",
        points=100,
        category=category,
        severity="high",
        root_cause_group="test-group",
        aliases=aliases or [("wrong row", 1.0)],
        locations=[
            GtLocation("src/handler.py", 10, 12, True),
            GtLocation("src/query.py", 30, 32, False),
        ],
    )


def _report(**overrides) -> dict:
    report = {
        "file_path": "src/handler.py",
        "line_start": 10,
        "line_end": 12,
        "description": "The wrong row identifier is passed to the query.",
        "category": "logic",
    }
    report.update(overrides)
    return report


@pytest.mark.parametrize(
    ("reported_range", "tolerance", "expected"),
    [
        ((10, 12), 2, 1.0),
        ((13, 15), 2, 1.0),
        ((14, 16), 2, 1.0),
        ((15, 17), 2, 0.875),
        ((22, 24), 2, 0.0),
        ((25, 27), 10, 0.0),
    ],
)
def test_location_score_tolerance_decay_and_zero_window(reported_range, tolerance, expected):
    assert location_score(reported_range, GtLocation("src/handler.py", 10, 12), tolerance) == expected


def test_alias_evidence_normalizes_text_and_uses_weights():
    aliases = [("SQL-Injection", 1.0), ("escape", 3.0)]
    assert alias_evidence("sql injection reaches the query", aliases) == 0.25
    assert alias_evidence("nothing relevant", aliases) == 0.0
    assert alias_evidence("anything", []) == 0.0
    assert alias_evidence("zero weight", [("zero", 0.0)]) == 0.0


def test_rule_set_hash_is_canonical_across_key_order():
    first = {"max_span": 25, "location_tolerance_lines": 2}
    second = {"location_tolerance_lines": 2, "max_span": 25}
    assert rule_set_hash(first) == rule_set_hash(second)
    assert rule_set_hash(first).startswith("sha256:")
    assert len(rule_set_hash(first)) == 71


def test_single_location_span_boundary_is_inclusive():
    at_cap = decide(_report(line_start=10, line_end=34), [_bug()], RULES, set())
    assert at_cap.outcome == "accept_full"
    assert at_cap.features.span == 25

    over_cap = decide(_report(line_start=10, line_end=35), [_bug()], RULES, set())
    assert over_cap.outcome == "reject_invalid"
    assert over_cap.bug is None
    assert over_cap.features.span == 26


def test_single_location_requires_a_file_before_scoring():
    decision = decide(_report(file_path=""), [_bug()], RULES, set())
    assert decision.outcome == "reject_invalid"
    assert decision.bug is None
    assert decision.explanation == "missing file_path"


def test_no_candidate_routes_only_descriptions_at_the_review_threshold():
    exact = decide(_report(file_path="unknown.py", description="x" * 20), [], RULES, set())
    thin = decide(_report(file_path="unknown.py", description="x" * 19), [], RULES, set())
    assert exact.outcome == "needs_review"
    assert exact.bug is None
    assert thin.outcome == "reject_invalid"
    assert thin.bug is None


def test_full_match_alias_threshold_is_inclusive():
    exact = decide(
        _report(),
        [_bug(aliases=[("wrong row", 1.0), ("unused", 4.0)])],
        RULES,
        set(),
    )
    below = decide(
        _report(),
        [_bug(aliases=[("wrong row", 1.0), ("unused", 5.0)])],
        RULES,
        set(),
    )
    assert exact.outcome == "accept_full"
    assert exact.features.alias_evidence == 0.2
    assert below.outcome == "needs_review"
    assert below.features.alias_evidence < 0.2


def test_aligned_location_with_unconfirmed_category_routes_to_partial_review():
    decision = decide(_report(category="injection"), [_bug(category="data_handling")], RULES, set())
    assert decision.outcome == "accept_partial"
    assert decision.features.location_score == 1.0
    assert decision.features.category_score == 0.0


def test_already_awarded_best_match_is_duplicate_not_a_new_award():
    decision = decide(_report(), [_bug()], RULES, {"TEST-BUG"})
    assert decision.outcome == "duplicate"
    assert decision.bug is not None
    assert decision.bug.code == "TEST-BUG"


def test_multi_location_rejects_missing_and_oversized_locations():
    assert decide_multi([], "wrong row", "logic", [_bug()], RULES, set()).outcome == "reject_invalid"

    oversized = [
        {"file_path": "src/handler.py", "line_start": 1, "line_end": 25},
        {"file_path": "src/query.py", "line_start": 1, "line_end": 26},
    ]
    rejected = decide_multi(oversized, "wrong row", "logic", [_bug()], RULES, set())
    assert rejected.outcome == "reject_invalid"
    assert rejected.bug is None


def test_multi_location_averages_distinct_locations_and_accepts_full_alignment():
    locations = [
        {"file_path": "src/handler.py", "line_start": 10, "line_end": 12},
        {"file_path": "src/query.py", "line_start": 30, "line_end": 32},
    ]
    aligned = decide_multi(locations, "the wrong row query", "logic", [_bug()], RULES, set())
    assert aligned.outcome == "accept_full"
    assert aligned.features.location_score == 1.0

    partial_locations = [locations[0], {"file_path": "src/query.py", "line_start": 100, "line_end": 102}]
    partial = decide_multi(partial_locations, "the wrong row query", "logic", [_bug()], RULES, set())
    assert partial.outcome == "needs_review"
    assert partial.features.location_score == 0.5


def test_multi_location_requires_distinct_ground_truth_coverage():
    location = {"file_path": "src/handler.py", "line_start": 10, "line_end": 12}
    repeated = [location, dict(location)]
    decision = decide_multi(repeated, "the wrong row query", "logic", [_bug()], RULES, set())
    assert decision.outcome == "needs_review"
    assert decision.features.location_score == 1.0
    assert decision.features.location_coverage == 0.5


def test_multi_location_without_candidates_routes_to_review():
    decision = decide_multi(
        [{"file_path": "src/handler.py", "line_start": 10, "line_end": 12}],
        "the wrong row query",
        "logic",
        [],
        RULES,
        set(),
    )
    assert decision.outcome == "needs_review"
    assert decision.bug is None
