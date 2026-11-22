"""Unit tests for the deterministic matching engine (spec 13.2)."""
from __future__ import annotations

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.matching import GtBugView, GtLocation, decide, location_score, alias_evidence


def bug(code="BUG-01", points=25, category="data_handling", locs=None, aliases=None):
    return GtBugView(
        bug_id="id-" + code, code=code, points=points, category=category, severity="high",
        root_cause_group="g",
        aliases=aliases or [("delete", 1.0)],
        locations=locs or [GtLocation("routes/notes.js", 44, 46)],
    )


RULES = {"max_span": 25, "location_tolerance_lines": 2, "min_description_chars": 20}


def test_exact_overlap_accepts_full():
    d = decide(
        {"file_path": "routes/notes.js", "line_start": 44, "line_end": 46,
         "description": "delete passes the author id into a query matching by note id",
         "category": "data_handling"},
        [bug()], RULES, set(),
    )
    assert d.outcome == "accept_full"


def test_near_location_with_alias_accepts():
    d = decide(
        {"file_path": "routes/notes.js", "line_start": 48, "line_end": 52,
         "description": "the delete statement targets the wrong note id",
         "category": "data_handling"},
        [bug()], RULES, set(),
    )
    assert d.outcome in ("accept_full", "accept_partial", "needs_review")
    assert d.features.location_score > 0


def test_wrong_file_needs_review():
    d = decide(
        {"file_path": "db.js", "line_start": 10, "line_end": 14,
         "description": "delete looks wrong here too", "category": "data_handling"},
        [bug()], RULES, set(),
    )
    assert d.outcome == "needs_review"


def test_thin_unmatched_report_is_structurally_rejected():
    d = decide({"file_path": "unknown.js", "line_start": 1, "line_end": 2, "description": "bad"}, [bug()], RULES, set())
    assert d.outcome == "reject_invalid"


def test_span_over_cap_rejected():
    d = decide(
        {"file_path": "routes/notes.js", "line_start": 1, "line_end": 40,
         "description": "delete bug somewhere in this whole file", "category": "data_handling"},
        [bug()], RULES, set(),
    )
    assert d.outcome == "reject_invalid"


def test_already_awarded_unit_is_duplicate():
    d = decide(
        {"file_path": "routes/notes.js", "line_start": 44, "line_end": 46,
         "description": "delete passes the author id into a query matching by note id",
         "category": "data_handling"},
        [bug()], RULES, {"BUG-01"},
    )
    assert d.outcome == "duplicate"


def test_location_score_bounds():
    loc = GtLocation("f", 10, 12)
    assert location_score((10, 12), loc, 2) == 1.0
    assert location_score((14, 16), loc, 2) == 1.0  # within tolerance distance 2
    assert 0.0 <= location_score((20, 22), loc, 2) < 1.0
    assert location_score((100, 110), loc, 2) == 0.0


def test_alias_evidence_weighted_fraction():
    aliases = [("delete", 1.0), ("wrong note", 1.0)]
    assert alias_evidence("the delete call removes the wrong note", aliases) == 1.0
    assert 0.0 < alias_evidence("delete", aliases) < 1.0
    assert alias_evidence("nothing relevant", aliases) == 0.0
