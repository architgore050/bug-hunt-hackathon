"""Deterministic report matching engine (spec 13.2).

Pure function of (report, ground truth revision, rule set, existing claims).
Records all feature values so every decision is explainable and replayable
(DAT-05). Auto-accept is conservative: borderline cases go to review (EVA-01,
INT-11). The engine never sees or needs hidden test inputs.

Score components per award unit (event config, frozen at publication):
  functional_test  - hidden functional tests of the repaired app (organizer
                     offline evaluation; recorded via the admin API in v1, see
                     ADR-019)
  code_review      - reviewer rubric (configurable percentage, required by the
                     product owner; see SCORING_MODEL.md)
  evidence_report  - report quality/evidence completeness
  ai_assessment    - optional, disabled by default (DEC-13)
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field

CATEGORIES_FAMILIES: dict[str, list[str]] = {
    "logic": ["logic", "error_handling", "other"],
    "input_validation": ["input_validation", "logic", "other"],
    "authentication_authorization": ["authentication_authorization", "other"],
    "injection": ["injection", "input_validation"],
    "cryptography": ["cryptography", "other"],
    "resource_handling": ["resource_handling", "logic"],
    "concurrency": ["concurrency", "logic"],
    "error_handling": ["error_handling", "logic"],
    "configuration": ["configuration", "other"],
    "integration_api_contract": ["integration_api_contract", "logic"],
    "data_handling": ["data_handling", "logic", "input_validation"],
    "other": ["other"],
}


@dataclass
class GtLocation:
    file_path: str
    line_start: int
    line_end: int
    is_primary: bool = True


@dataclass
class GtBugView:
    """The evaluator's view of one ground-truth bug (award unit)."""

    bug_id: str
    code: str
    points: float
    category: str
    severity: str
    root_cause_group: str
    aliases: list[tuple[str, float]] = field(default_factory=list)
    locations: list[GtLocation] = field(default_factory=list)


@dataclass
class MatchFeatures:
    location_score: float = 0.0
    category_score: float = 0.0
    alias_evidence: float = 0.0
    span: int = 0
    distance: int | None = None


@dataclass
class MatchDecision:
    outcome: str  # accept_full | accept_partial | reject_invalid | needs_review
    bug: GtBugView | None
    features: MatchFeatures
    explanation: str


def rule_set_hash(rule_set: dict) -> str:
    canonical = json.dumps(rule_set, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", " ", (text or "").lower()).strip()


def _location_distance(a: tuple[int, int], b: tuple[int, int]) -> int:
    """Line distance between two ranges: 0 if overlapping."""
    a0, a1 = a
    b0, b1 = b
    if a1 < b0:
        return b0 - a1
    if b1 < a0:
        return a0 - b1
    return 0


def location_score(report_range: tuple[int, int], loc: GtLocation, tolerance: int) -> float:
    dist = _location_distance(report_range, (loc.line_start, loc.line_end))
    if dist == 0:
        return 1.0
    if dist <= tolerance:
        return 1.0
    window = 10 - tolerance
    if window <= 0:
        return 0.0
    return max(0.0, 1.0 - (dist - tolerance) / window)


def alias_evidence(report_text: str, aliases: list[tuple[str, float]]) -> float:
    text_n = _normalize(report_text)
    if not aliases:
        return 0.0
    total_weight = sum(w for _, w in aliases) or 1.0
    hit = sum(w for kw, w in aliases if _normalize(kw) in text_n)
    return hit / total_weight


def decide(
    report: dict,
    candidates: list[GtBugView],
    rule_set: dict,
    already_awarded_units: set[str],
) -> MatchDecision:
    """Match one report against candidate bugs (spec 13.2). Deterministic."""
    tol = int(rule_set.get("location_tolerance_lines", 2))
    max_span = int(rule_set.get("max_span", 25))
    min_desc = int(rule_set.get("min_description_chars", 40))
    file_path = report.get("file_path") or ""
    ls = int(report.get("line_start") or 0)
    le = int(report.get("line_end") or 0)
    span = max(0, le - ls + 1)
    desc = (report.get("description") or "") + " " + (report.get("evidence") or "")
    cat = report.get("category") or ""

    # Structural rejection first: objective conditions only (architecture 11.1)
    if span > max_span:
        return MatchDecision("reject_invalid", None, MatchFeatures(span=span), "span exceeds max_span")
    if not file_path:
        return MatchDecision("reject_invalid", None, MatchFeatures(span=span), "missing file_path")

    scored: list[tuple[float, float, float, GtBugView, MatchFeatures]] = []
    for bug in candidates:
        feats = MatchFeatures(span=span)
        best_loc = 0.0
        best_dist: int | None = None
        for loc in bug.locations:
            if loc.file_path != file_path:
                # root-cause group: another symptom in a different file can still score
                # via alias evidence; location score only counts same-file proximity.
                continue
            s = location_score((ls, le), loc, tol)
            d = _location_distance((ls, le), (loc.line_start, loc.line_end))
            if s > best_loc or best_dist is None:
                best_loc, best_dist = s, d
        feats.location_score = best_loc
        feats.distance = best_dist
        fam = CATEGORIES_FAMILIES.get(cat, [])
        if cat and bug.category == cat:
            feats.category_score = 1.0
        elif bug.category in fam:
            feats.category_score = 0.6
        feats.alias_evidence = alias_evidence(desc, bug.aliases)
        combined = feats.location_score * max(feats.category_score, feats.alias_evidence * 0.5 + feats.category_score * 0.5)
        scored.append((combined, feats.location_score, feats.category_score, bug, feats))

    if not scored:
        # plausible but unmatched -> human review, never auto-penalize (INT-02)
        if len(desc.strip()) >= min_desc:
            return MatchDecision("needs_review", None, MatchFeatures(span=span), "no candidate in same file; plausible report routed to review")
        return MatchDecision("reject_invalid", None, MatchFeatures(span=span), "unmatched and too thin to review")

    scored.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
    combined, L, C, bug, feats = scored[0]

    if bug.code in already_awarded_units:
        return MatchDecision("duplicate", bug, feats, f"award unit {bug.code} already claimed")

    auto_full = L >= 0.9 and C >= 0.6 and feats.alias_evidence >= 0.2
    auto_partial = L >= 0.9 and C == 0

    if auto_full:
        return MatchDecision("accept_full", bug, feats, "location, category and alias evidence aligned")
    if auto_partial:
        return MatchDecision("accept_partial", bug, feats, "location aligned; category unconfirmed, routed for confirmation")
    if L == 0 and feats.alias_evidence == 0 and len(desc.strip()) < min_desc:
        return MatchDecision("reject_invalid", None, feats, "no location or alias evidence and description too short")
    return MatchDecision("needs_review", bug, feats, "borderline match routed to human review")
