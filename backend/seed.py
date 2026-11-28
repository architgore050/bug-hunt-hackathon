"""Development seed for the Bug Hunt CTF platform (DEV/TEST PROFILES ONLY).

Creates deterministic demo data that exercises every role and state:
- tenant, users (admin, organizer, 2 reviewers, 6 participants in 2 teams)
- the "Fall Back" event with the official proposal preset (schedule, scoring
  weights, CTF policy) and readiness checklist
- one stage with frozen rule set, challenge "papyrus" ingested from
  ../challenge-app (the GENERATED participant tree; the file list comes from
  challenge-app/PARTICIPANT_FILES.json, which never contains the answer key)
- ground truth for option A seeded from organizer/gt-manifest.json (level
  scoped, pattern-resolved locations, DAT-06 anchor hashes) plus the side
  quest flag hashes from organizer/sidequest-flags.json; option B (Marina)
  keeps its development fixture ground truth below
- rules document, announcements, admin-managed participants (no invitation tokens)

Never run against a live deployment: known credentials are dev-only.
Usage: python seed.py [--reset]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
REPO_ROOT = BACKEND.parent
CHALLENGE_DIR = REPO_ROOT / "challenge-app"
CHALLENGE_DIR_B = REPO_ROOT / "challenge-app-option-b"
ORGANIZER_DIR = REPO_ROOT / "organizer"
sys.path.insert(0, str(BACKEND))

from app import security  # noqa: E402
from app.audit import audit_write  # noqa: E402
from app.db import app_session, gt_session, uuid7  # noqa: E402
from app.flow import init_participant_flow  # noqa: E402
from sqlalchemy import text  # noqa: E402


# Participant-visible files for the generated challenge tree. The list itself
# is a build artifact (scripts/build_papyrus_challenge.py) and never contains
# the answer key, which lives outside the tree by construction.
def _load_participant_files() -> list[str]:
    manifest = CHALLENGE_DIR / "PARTICIPANT_FILES.json"
    if not manifest.exists():
        raise SystemExit(
            "challenge-app/PARTICIPANT_FILES.json is missing; run python scripts/build_papyrus_challenge.py first"
        )
    return list(json.loads(manifest.read_text())["files"])


PARTICIPANT_FILES = _load_participant_files()

# Option B fixture (Marina, FastAPI + SQLite): same product concept, same bug
# count, severities, categories and point values as Option A. Development
# fixture only - the production challenge packages are organizer deliverables.
PARTICIPANT_FILES_B = [
    "README.md",
    "requirements.txt",
    "main.py",
    "database.py",
    "routes/__init__.py",
    "routes/auth.py",
    "routes/notes.py",
    "routes/comments.py",
    "public/index.html",
    "public/app.js",
    "public/styles.css",
]

EVENT_CONFIG = {
    "features": {"runner_enabled": False, "ai_assessment_enabled": False, "telemetry_enabled": False},
    "scoring": {
        "weights": {"functional_test": 0.5, "code_review": 0.3, "evidence_report": 0.2},
        "ctf_bonus_cap_points": 100,
        "default_review_quality": 0.8,
    },
    "schedule": [
        {"phase": "Registration and Technical Setup", "duration_minutes": 15},
        {"phase": "Event Briefing and Instructions", "duration_minutes": 10},
        {"phase": "Part 1: Setup and Bug Reconnaissance", "duration_minutes": 30},
        {"phase": "Part 2: Debugging and Root-Cause Analysis", "duration_minutes": 35},
        {"phase": "Part 3: Full-Stack Repair and CTF Side Quests", "duration_minutes": 60},
        {"phase": "Part 4: Testing, Verification and Demonstration", "duration_minutes": 25},
        {"phase": "Final Evaluation and Results", "duration_minutes": 5},
    ],
    "public_summary": {
        "mode": "offline",
        "team_size": "4-5 participants",
        "duration_minutes": 180,
        "main_score": "restoring application functionality",
        "ctf": "optional bonus, capped",
    },
    "capacity_note": "Provisional dev/test caps: 50 participants / 12 teams. Final caps must be load-tested (ADR-011).",
}

STAGE_CONFIG = {
    "feedback_mode": "hidden",
    "leaderboard_mode": "hidden",
    "leaderboard_delay_s": 600,
    "max_span": 25,
    "max_reports_per_file": 12,
    "max_reports_per_round": 80,
    "file_cooldown_s": 20,
    "location_tolerance_lines": 2,
    "ctf_bonus_cap_points": 100,
    "penalty": {"fp_factor": 0.25, "cap_fraction": 0.2, "applies": "at_release_only"},
}


# (code, file, line pattern, title, severity, category, points, root_cause_group, explanation, aliases, locations+)
def _load_manifest_bugs() -> list[dict]:
    """Option A ground truth from the generated manifest (RESTRICTED storage).

    Each entry carries level, resolved 3-line locations with DAT-06 anchor
    hashes, aliases and points; produced by scripts/build_papyrus_challenge.py
    so the seeded truth cannot drift from the shipped challenge-app tree."""
    manifest = ORGANIZER_DIR / "gt-manifest.json"
    if not manifest.exists():
        raise SystemExit("organizer/gt-manifest.json is missing; run python scripts/build_papyrus_challenge.py first")
    data = json.loads(manifest.read_text())
    bugs = []
    for b in data["bugs"]:
        bugs.append(
            {
                "code": b["code"],
                "level": int(b["level"]),
                "title": b["title"],
                "severity": b["severity"],
                "category": b["category"],
                "points": int(b["points"]),
                "root_cause_group": b["root_cause_group"],
                "explanation": b["explanation"],
                "aliases": [(a[0], float(a[1])) for a in b["aliases"]],
                "locations": [
                    {
                        "file_path": loc["file_path"],
                        "line_start": int(loc["line_start"]),
                        "line_end": int(loc["line_end"]),
                        "primary": bool(loc["primary"]),
                        "anchor_hash": loc.get("anchor_hash"),
                    }
                    for loc in b["locations"]
                ],
            }
        )
    return bugs


def _load_sidequest_flags() -> list[dict]:
    """Side quest flags arrive HMAC-hashed only; plaintext stays in the
    organizer answer key (restricted storage)."""
    path = ORGANIZER_DIR / "sidequest-flags.json"
    if not path.exists():
        raise SystemExit(
            "organizer/sidequest-flags.json is missing; run python scripts/build_papyrus_challenge.py first"
        )
    data = json.loads(path.read_text())
    return [
        {
            "flag_key": f["flag_key"],
            "code_hash": f["code_hash"],
            "points": int(f["points"]),
            "max_awards": int(f["max_awards"]),
            "position_label": f["position_label"],
        }
        for f in data["flags"]
    ]


GT_BUGS = _load_manifest_bugs()

# Option A flags: the admin-corner flag (FLAG-1, obtainable through the
# injected client-side admin gate) plus the five side quest hashes. The old
# FLAG-2 artifact (a base64 token inside a participant file) is banned by the
# leakage rules for the generated tree, so it does not ship.
GT_FLAGS = [
    (
        "FLAG-1",
        "FLAG{client_gates_1e_0nly_9f2a}",
        30,
        99,
        "Admin notice returned by the unauthenticated admin overview API (broken access control).",
    )
]
SIDEQUEST_FLAGS = _load_sidequest_flags()

# Repair set R (expansion spec 6.1): the tickets Level 3 and Level 4 score.
REPAIR_SET_TICKETS = (
    "P1-01",
    "P1-04",
    "P1-06",
    "P1-08",
    "P1-12",
    "P2-01",
    "P2-02",
    "P2-04",
    "P2-07",
    "P2-09",
)


def _level_max_points(level_no: int) -> int:
    if level_no in (1, 2):
        return sum(b["points"] for b in GT_BUGS if b["level"] == level_no)
    ticket_points = {b["ticket"]: b["points"] for b in GT_BUGS}
    return sum(ticket_points[t] for t in REPAIR_SET_TICKETS)


# Option B (Marina) ground truth: mirrors the Option A set one-for-one
# (same codes, severities, categories, points, root-cause groups). Locations
# anchor on the Option B files. DEVELOPMENT FIXTURE ONLY.
GT_BUGS_B = [
    (
        "BUG-01",
        "database.py",
        r"WHERE title LIKE \? OR body LIKE \?",
        "Search never matches notes",
        "medium",
        "input_validation",
        25,
        "search-binding",
        "The prepared statement binds the raw term so LIKE compares the exact full value; wildcards are never added.",
        [("like", 1.0), ("wildcard", 0.8), ("search", 0.6)],
        [("routes/notes.py", r"def search\(term", False)],
    ),
    (
        "BUG-02",
        "routes/notes.py",
        r'return \{"id": 1, "saved"',
        "Save response reports the wrong note id",
        "medium",
        "logic",
        25,
        "create-response-id",
        "The response reports a hardcoded rowcount-style value instead of the new note id from the insert, so the client banner links to the wrong note.",
        [("rowcount", 1.0), ("lastrowid", 0.8), ("insert", 0.5), ("wrong id", 0.5)],
        [("database.py", r"def create_note", False)],
    ),
    (
        "BUG-03",
        "routes/comments.py",
        r'f"<li><strong>\{c\[.author_name.\]\}</strong> \{c\[.body.\]\}</li>"',
        "Comments execute injected markup (controlled XSS)",
        "critical",
        "injection",
        50,
        "comment-render",
        "Comment bodies are interpolated into the HTML response without escaping, so markup posted as a comment executes in every reader's browser.",
        [("innerhtml", 1.0), ("xss", 1.0), ("escape", 0.6), ("htmlresponse", 0.6)],
        [("public/app.js", r"list\.innerHTML = data\.notes", False)],
    ),
    (
        "BUG-04",
        "routes/notes.py",
        r"str\(datetime\.now\(UTC\)\.second\)",
        "Last edited shows meaningless digits",
        "low",
        "logic",
        15,
        "updated-at-units",
        "The update response reports the seconds component of the current time instead of the stored ISO timestamp.",
        [("second", 1.0), ("iso", 0.6), ("updated", 0.5), ("timestamp", 0.5)],
        [("database.py", r"def update_note", False)],
    ),
    (
        "BUG-05",
        "routes/notes.py",
        r'database\.delete_note\(note\["author_id"\]\)',
        "Deleting a note removes a different note than requested",
        "high",
        "data_handling",
        40,
        "delete-target",
        "The route passes note.author_id where the query expects the note id, so the request silently deletes the note whose id equals the caller's user id.",
        [("author", 1.0), ("delete", 0.8), ("wrong note", 0.8), ("id mismatch", 0.5)],
        [("database.py", r"def delete_note", False)],
    ),
    (
        "BUG-06",
        "database.py",
        r"WHERE note_id = \? ORDER BY created_at DESC",
        "Comments render in reverse order",
        "low",
        "logic",
        15,
        "comment-order",
        "The comment query orders created_at DESC while the product expects chronological ascending order.",
        [("desc", 1.0), ("asc", 0.8), ("order", 0.6), ("chronological", 0.6)],
        [("routes/comments.py", r"def list_comments", False)],
    ),
    (
        "BUG-07",
        "routes/auth.py",
        r"INSERT INTO users \(email, name, password_hash, created_at\) VALUES",
        "Registration crashes with a raw 500 on duplicates",
        "medium",
        "input_validation",
        25,
        "register-validation",
        "No duplicate check runs before the INSERT; the UNIQUE constraint error escapes as an unhandled exception.",
        [("unique", 1.0), ("constraint", 0.8), ("validation", 0.8), ("500", 0.4)],
        [("database.py", r"CREATE TABLE IF NOT EXISTS users", False)],
    ),
    (
        "BUG-08",
        "main.py",
        r"max_age = SESSION_TTL_S // 1000",
        "Sessions expire after ~10 minutes instead of 7 days",
        "high",
        "configuration",
        40,
        "cookie-ttl-units",
        "The TTL is already seconds but is divided by 1000 again, collapsing the intended 7-day TTL to ~10 minutes.",
        [("maxage", 1.0), ("ttl", 0.8), ("cookie", 0.8), ("units", 0.6)],
        [("main.py", r"SESSION_TTL_DAYS \* 24 \* 60 \* 60", False)],
    ),
    (
        "BUG-09",
        "database.py",
        r"\(SELECT count\(\*\) FROM notes\) AS notes_total",
        "Profile notes total counts everyone's notes",
        "medium",
        "logic",
        25,
        "author-stats",
        "The stats query counts every row of notes with no author filter for the total.",
        [("count", 1.0), ("stats", 0.8), ("profile", 0.6), ("author", 0.6)],
        [("routes/auth.py", r"def me\(user_id", False)],
    ),
    (
        "BUG-10",
        "public/app.js",
        r'document\.querySelector\("\.search-go"\)',
        "Search button does nothing (Enter works)",
        "low",
        "integration_api_contract",
        15,
        "search-handler",
        "The click handler queries the .search-go class selector but the button only has the search-go id, so the listener never attaches.",
        [("queryselector", 1.0), ("class", 0.6), ("id", 0.6), ("handler", 0.5)],
        [("public/index.html", r'id="search-go"', False)],
    ),
]

GT_FLAGS_B = [
    (
        "FLAG-1",
        "FLAG{fastapi_0pen_0verview_7d21}",
        30,
        99,
        "Admin overview API on the Option B app served without authentication (broken access control).",
    ),
    (
        "FLAG-2",
        "FLAG{b64_1s_n0t_3ncrypt10n_9c4f}",
        30,
        99,
        "Base64-encoded string in the onboarding comment of the Option B public/app.js.",
    ),
]

# Four level stages with SYNTHETIC development windows (minutes). These are
# NOT event times; the production schedule is an organizer configuration task.
LEVEL_NAMES = {
    1: "Level 1: Find the Bugs",
    2: "Level 2: Trace the Cross-File Defect",
    3: "Level 3: Repair and Side Quest",
    4: "Level 4: Tests and Documentation",
}
LEVEL_EXPLAIN_MD = {
    1: (
        "The app ships with twelve failing checks and twelve matching hints. Run the checks "
        "(npm run tc:l1), reproduce each failure, find the single line responsible, and file one "
        "report per failure. A report needs a file, a line range, a category, and an explanation "
        "of why the line causes the failure."
    ),
    2: (
        "Ten defects each span two or three files. Error messages and logs are your trail. File one "
        "report per defect with the locations in the order you followed them. Naming only the "
        "visible failure is not enough."
    ),
    3: (
        "Fix the ten tickets in REPAIR_SET.md in your editable workspace. You may use the provided "
        "coding agent and its rules (agent/AGENT_RULES.md). Verify every change against the "
        "documented behaviour before you submit. The side quest pack is optional, is not part of "
        "this repository, and awards capped bonus points through the flag-code endpoint."
    ),
    4: (
        "Your Level 3 repairs are frozen. Add a regression test for each repaired ticket under "
        "test/regression/ and update the documentation so the repository tells the truth. A test "
        "that does not fail on the original defect does not count."
    ),
}
LEVEL_WINDOWS = {1: ("active", -30, 60), 2: ("armed", 15, 45), 3: ("draft", None, None), 4: ("draft", None, None)}

RULES_MD = """# Fall Back - Competition Rules (v1, draft for organizer review)

## 1. Participation
- Teams of 4-5 participants, registered by the Software Development Club, VIT Bhopal University.
- Accounts are personal; sharing an account between people is prohibited.
- The event is offline, at the venue, on 6 December 2026, for 180 minutes.

## 2. Main task
- Every team receives the same preconfigured full-stack application with
  intentionally planted defects. Inspect it, reproduce failures, fix them, and
  submit structured bug reports through the platform before the deadline.
- Reports need a target file, a line range (max 25 lines), a category, a title,
  and an explanation. Evidence is required for borderline matches.

## 3. Scoring (provisional, frozen before the event)
- Main score: functional tests 50%, code review 30%, evidence/report quality 20%.
- Verified CTF flags award bonus points, capped at 100 points total per team.
- Claimed severity is informational; points come from the ground truth.
- Definitively invalid reports may carry a small capped penalty, applied only
  at finalization. Plausible but unmatched reports go to human review.
- Tie-breakers: total score, then fewer invalid reports, then earlier last
  accepted finding.

## 4. Conduct and scope
- Attack ONLY the provided challenge application on your own machine.
- Attacking the platform, the venue network, other teams, or any external
  system is prohibited and grounds for disqualification.
- Do not share findings, code, or flags between teams. Screenshots of the
  challenge and external AI tools are prohibited for the main task.
- Feedback on reports is hidden until results are released; probing the
  evaluation with template reports is a violation.

## 5. Appeals
- After results are released, teams may dispute any result through the
  platform within the announced window. Resolutions are final.

## 6. Platform security safe harbor
- Found a vulnerability in the platform itself? Report it privately to the
  organizers immediately. Good-faith reports are welcomed and will not be
  penalized.

Version 1 - draft prepared for organizer/legal review before publication.
"""


def find_line(path: Path, pattern: str) -> int | None:
    rx = re.compile(pattern)
    for i, line in enumerate(path.read_text().splitlines(), start=1):
        if rx.search(line):
            return i
    return None


def anchor_hash(path: Path, lineno: int) -> str:
    lines = path.read_text().splitlines()
    window = "\n".join(lines[max(0, lineno - 2) : lineno + 1])
    return hashlib.sha256(window.encode()).hexdigest()


def main(reset: bool) -> None:
    if reset:
        with app_session() as s:
            for stmt in (
                "DELETE FROM app.submission_artifacts",
                "DELETE FROM app.level_drafts",
                "DELETE FROM app.participant_progress",
                "DELETE FROM app.participant_pointers",
                "DELETE FROM app.team_repo_choices",
                "DELETE FROM app.repo_options",
                "TRUNCATE app.score_ledger_entries RESTART IDENTITY CASCADE",
                "DELETE FROM app.award_claims",
                "DELETE FROM app.reviews",
                "DELETE FROM app.review_items",
                "DELETE FROM app.disputes",
                "DELETE FROM app.submission_flag_results",
                "DELETE FROM app.submission_scores",
                "DELETE FROM app.runner_evaluations",
                "DELETE FROM app.submissions",
                "DELETE FROM app.drafts",
                "DELETE FROM app.jobs",
                "DELETE FROM app.outbox_events",
                "DELETE FROM app.leaderboard_snapshots",
                "DELETE FROM app.assignments",
                "DELETE FROM app.challenge_file_lines",
                "DELETE FROM app.challenge_files",
                "DELETE FROM app.stage_transitions",
                "DELETE FROM app.time_adjustments",
                "DELETE FROM app.stages",
                "",
                "DELETE FROM app.team_members",
                "DELETE FROM app.teams",
                "DELETE FROM app.acceptances",
                "DELETE FROM app.refresh_tokens",
                "DELETE FROM app.sessions",
                "DELETE FROM app.announcements",
                "DELETE FROM app.exports",
                "DELETE FROM app.event_config_revisions",
                "DELETE FROM app.users",
                "DELETE FROM app.readiness_items",
                "DELETE FROM app.rules_documents",
                "DELETE FROM app.challenge_versions",
                "DELETE FROM app.events",
                "DELETE FROM app.tenants",
            ):
                s.execute(text(stmt))
        with gt_session() as g:
            for stmt in (
                "DELETE FROM gt.gt_aliases",
                "DELETE FROM gt.gt_locations",
                "DELETE FROM gt.gt_test_cases",
                "DELETE FROM gt.gt_bugs",
                "DELETE FROM gt.gt_flags",
                "DELETE FROM gt.gt_revisions",
            ):
                g.execute(text(stmt))
        print("existing data cleared")

    now = datetime.now(UTC)
    with app_session() as s:
        tenant_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.tenants (id, slug, name) VALUES (CAST(:i AS uuid), 'sdc-vitb', 'Software Development Club, VIT Bhopal University')"
            ),
            {"i": tenant_id},
        )

        users = {}
        for email, name, role in [
            ("admin@example.com", "Platform Admin", "admin"),
            ("organizer@example.com", "Kalpesh Parashar", "organizer"),
            ("organizer2@example.com", "Aashish Prasad", "organizer"),
            ("reviewer1@example.com", "Reviewer One", "reviewer"),
            ("reviewer2@example.com", "Reviewer Two", "reviewer"),
        ]:
            uid = str(uuid7())
            users[email] = uid
            s.execute(
                text(
                    "INSERT INTO app.users (id, tenant_id, email, name, role, password_hash) VALUES (CAST(:i AS uuid), CAST(:t AS uuid), :e, :n, :r, :p)"
                ),
                {
                    "i": uid,
                    "t": tenant_id,
                    "e": email,
                    "n": name,
                    "r": role,
                    "p": security.hash_password("Dev-only!Passw0rd!"),
                },
            )

        event_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.events (id, tenant_id, slug, name, status, timezone, duration_minutes, "
                "max_participants, max_teams, rules_version, config) VALUES "
                "(CAST(:i AS uuid), CAST(:t AS uuid), 'fall-back-2026', 'Fall Back - Full-Stack Software Debugging Challenge', "
                "'configured', 'Asia/Kolkata', 180, 50, 10, 1, CAST(:c AS jsonb))"
            ),
            {"i": event_id, "t": tenant_id, "c": json.dumps(EVENT_CONFIG)},
        )
        s.execute(
            text(
                "INSERT INTO app.rules_documents (id, event_id, version, body_md, content_hash, frozen_at) "
                "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), 1, :b, :h, now())"
            ),
            {"i": str(uuid7()), "e": event_id, "b": RULES_MD, "h": hashlib.sha256(RULES_MD.encode()).hexdigest()},
        )
        for key, label, owner in [
            ("load_test_50", "Load test at the approved cap passes thresholds", "infrastructure lead"),
            ("gt_isolation", "app_api cannot read gt (tested with the real role)", "application lead"),
            ("backup_restore", "Backup/restore rehearsal completed and measured", "infrastructure lead"),
            ("pen_test", "Security review completed; high/critical closed", "application lead"),
            ("challenge_audit", "Two independent reviewers certified the challenge (unplanned defects)", "review lead"),
            ("dry_run", "Full dry run with real users on the venue network", "event lead"),
            ("rules_published", "Rules, privacy notice and consent flows published", "organizer"),
            ("runbooks", "Event-day runbook rehearsed; roles assigned", "event lead"),
        ]:
            s.execute(
                text(
                    "INSERT INTO app.readiness_items (id, event_id, key, label, owner) VALUES (CAST(:i AS uuid), CAST(:e AS uuid), :k, :l, :o)"
                ),
                {"i": str(uuid7()), "e": event_id, "k": key, "l": label, "o": owner},
            )

        stage_id = str(uuid7())
        rsh = (
            "sha256:"
            + hashlib.sha256(json.dumps(STAGE_CONFIG, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        )
        s.execute(
            text(
                "INSERT INTO app.stages (id, event_id, name, kind, ordinal, status, config, rule_set_hash) "
                "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), 'Fall Back Main Challenge', 'main', 1, 'draft', CAST(:c AS jsonb), :rsh)"
            ),
            {"i": stage_id, "e": event_id, "c": json.dumps(STAGE_CONFIG), "rsh": rsh},
        )

        # --- challenge version from challenge-app/ --------------------------------
        challenge_id = str(uuid7())
        instructions = Path(CHALLENGE_DIR / "README.md").read_text()
        s.execute(
            text(
                "INSERT INTO app.challenge_versions (id, event_id, slug, title, version, instructions_md) "
                "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), 'papyrus', 'Papyrus - Campus Notes (challenge edition)', 1, :inst)"
            ),
            {"i": challenge_id, "e": event_id, "inst": instructions},
        )
        line_index = []
        for rel in PARTICIPANT_FILES:
            path = CHALLENGE_DIR / rel
            content = path.read_text()
            sha = hashlib.sha256(content.encode()).hexdigest()
            s.execute(
                text(
                    "INSERT INTO app.challenge_files (id, challenge_version_id, path, lang, content, sha256, size_bytes, line_count) "
                    "VALUES (CAST(:i AS uuid), CAST(:c AS uuid), :p, :lang, :content, :sha, :size, :lines)"
                ),
                {
                    "i": str(uuid7()),
                    "c": challenge_id,
                    "p": rel,
                    "lang": _lang(rel),
                    "content": content,
                    "sha": sha,
                    "size": len(content.encode()),
                    "lines": content.count("\n") + 1,
                },
            )
            for ln, line in enumerate(content.splitlines()[:5000], start=1):
                line_index.append((rel, ln, line[:500]))
        for rel, ln, txt in line_index:
            s.execute(
                text(
                    "INSERT INTO app.challenge_file_lines (id, challenge_version_id, path, line_number, line_text) VALUES (CAST(:i AS uuid), CAST(:c AS uuid), :p, :ln, :lt)"
                ),
                {"i": str(uuid7()), "c": challenge_id, "p": rel, "ln": ln, "lt": txt},
            )
        s.execute(
            text(
                "UPDATE app.challenge_versions SET status='published', content_hash=:h, frozen_at=now(), published_at=now() WHERE id = CAST(:i AS uuid)"
            ),
            {
                "h": "sha256:" + hashlib.sha256(json.dumps(list(PARTICIPANT_FILES)).encode()).hexdigest(),
                "i": challenge_id,
            },
        )
        s.execute(
            text(
                "INSERT INTO app.assignments (id, event_id, stage_id, challenge_version_id, repo_url) VALUES "
                "(CAST(:i AS uuid), CAST(:e AS uuid), CAST(:s AS uuid), CAST(:c AS uuid), :repo)"
            ),
            {"i": str(uuid7()), "e": event_id, "s": stage_id, "c": challenge_id, "repo": None},
        )

        # --- four-level flow: repo options and level stages -----------------------
        # Option B challenge version (Marina fixture), development-only.
        challenge_b_id = str(uuid7())
        instructions_b = Path(CHALLENGE_DIR_B / "README.md").read_text()
        s.execute(
            text(
                "INSERT INTO app.challenge_versions (id, event_id, slug, title, version, instructions_md) "
                "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), 'marina', 'Marina - Campus Notes (Option B fixture)', 1, :inst)"
            ),
            {"i": challenge_b_id, "e": event_id, "inst": instructions_b},
        )
        _ingest_challenge(s, challenge_b_id, CHALLENGE_DIR_B, PARTICIPANT_FILES_B)
        s.execute(
            text(
                "UPDATE app.challenge_versions SET status='published', content_hash=:h, frozen_at=now(), published_at=now() WHERE id = CAST(:i AS uuid)"
            ),
            {
                "h": "sha256:" + hashlib.sha256(json.dumps(list(PARTICIPANT_FILES_B)).encode()).hexdigest(),
                "i": challenge_b_id,
            },
        )
        s.execute(
            text("UPDATE app.challenge_versions SET instructions_md = :inst WHERE id = CAST(:i AS uuid)"),
            {"inst": Path(CHALLENGE_DIR / "README.md").read_text(), "i": challenge_id},
        )
        for key, label, desc, cv_id in [
            (
                "A",
                "Option A: Papyrus (Node/Express + SQLite)",
                "MERN-style Node/Express campus notes app with the common frontend.",
                challenge_id,
            ),
            (
                "B",
                "Option B: Marina (FastAPI + SQLite)",
                "nginx + FastAPI + SQLite campus notes app with the same frontend concept.",
                challenge_b_id,
            ),
        ]:
            s.execute(
                text(
                    "INSERT INTO app.repo_options (id, event_id, option_key, label, description, challenge_version_id) "
                    "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), :k, :l, :d, CAST(:cv AS uuid))"
                ),
                {"i": str(uuid7()), "e": event_id, "k": key, "l": label, "d": desc, "cv": cv_id},
            )
        level_stage_ids = {}
        for n in range(1, 5):
            status, start_off, dur = LEVEL_WINDOWS[n]
            cfg = {
                "explain_title": LEVEL_NAMES[n],
                "explain_md": LEVEL_EXPLAIN_MD[n],
                "max_span": 25,
                "max_flags_per_level": 12,
                # Stage ceilings come from the generated manifest: levels 1 and 2
                # sum their own award units; levels 3 and 4 score the repair set
                # (expansion spec 8.5). CTF bonuses accumulate outside this score.
                "max_points": _level_max_points(n),
                "feedback_mode": "hidden",
                "leaderboard_mode": "hidden",
            }
            starts = now + timedelta(minutes=start_off) if start_off is not None else None
            ends = (starts + timedelta(minutes=dur)) if dur is not None and starts is not None else None
            lid = str(uuid7())
            level_stage_ids[n] = lid
            s.execute(
                text(
                    "INSERT INTO app.stages (id, event_id, name, kind, ordinal, status, starts_at, ends_at, grace_seconds, config, rule_set_hash) "
                    "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), :name, 'level', :n, :status, :starts, :ends, 3, CAST(:c AS jsonb), :rsh)"
                ),
                {
                    "i": lid,
                    "e": event_id,
                    "name": LEVEL_NAMES[n],
                    "n": n,
                    "status": status,
                    "starts": starts,
                    "ends": ends,
                    "c": json.dumps(cfg),
                    "rsh": "sha256:"
                    + hashlib.sha256(json.dumps(cfg, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                },
            )

        # --- teams and registered participants -----------------------------------
        teams = {}
        for team_name, member_emails in [
            (
                "Team Lambda",
                ["p1.team1@example.com", "p2.team1@example.com", "p3.team1@example.com", "p4.team1@example.com"],
            ),
            (
                "Team Vector",
                [
                    "p1.team2@example.com",
                    "p2.team2@example.com",
                    "p3.team2@example.com",
                    "p4.team2@example.com",
                    "p5.team2@example.com",
                ],
            ),
        ]:
            team_id = str(uuid7())
            join_code = secrets.token_hex(4).upper()
            teams[team_name] = team_id
            s.execute(
                text(
                    "INSERT INTO app.teams (id, event_id, name, join_code) VALUES (CAST(:i AS uuid), CAST(:e AS uuid), :n, :jc)"
                ),
                {"i": team_id, "e": event_id, "n": team_name, "jc": join_code},
            )
            for idx, email in enumerate(member_emails):
                uid = str(uuid7())
                users[email] = uid
                s.execute(
                    text(
                        "INSERT INTO app.users (id, tenant_id, email, name, role, password_hash) VALUES (CAST(:i AS uuid), CAST(:t AS uuid), :e, :n, 'participant', :p)"
                    ),
                    {
                        "i": uid,
                        "t": tenant_id,
                        "e": email,
                        "n": email.split("@")[0].replace(".", " ").title(),
                        "p": security.hash_password("Dev-only!Passw0rd!"),
                    },
                )
                s.execute(
                    text(
                        "INSERT INTO app.team_members (id, team_id, user_id, is_lead) VALUES (CAST(:i AS uuid), CAST(:t AS uuid), CAST(:u AS uuid), :lead)"
                    ),
                    {"i": str(uuid7()), "t": team_id, "u": uid, "lead": idx == 0},
                )

        s.execute(
            text(
                "INSERT INTO app.announcements (id, event_id, severity, body, created_by) VALUES (CAST(:i AS uuid), CAST(:e AS uuid), 'info', :b, CAST(:u AS uuid))"
            ),
            {
                "i": str(uuid7()),
                "e": event_id,
                "b": "Welcome to Fall Back! Set up your environment before the briefing ends.",
                "u": users["organizer@example.com"],
            },
        )
        # initialize the four-level progression for every participant
        for email, uid in users.items():
            if email.endswith("@example.com") and email.startswith("p"):
                init_participant_flow(s, event_id, uid)

        audit_write(
            s,
            actor_id=None,
            actor_role="system",
            action="seed.completed",
            entity_type="event",
            entity_id=event_id,
            request_id="seed",
            details={"users": len(users), "teams": len(teams)},
        )

    with gt_session() as g:
        _seed_ground_truth(g, challenge_id, CHALLENGE_DIR, GT_BUGS, list(GT_FLAGS) + list(SIDEQUEST_FLAGS))
        _seed_ground_truth(g, challenge_b_id, CHALLENGE_DIR_B, GT_BUGS_B, GT_FLAGS_B)
        g.execute(
            text(
                "INSERT INTO gt.gt_revisions (id, challenge_version_id, revision_no, reason, payload) VALUES (CAST(:i AS uuid), CAST(:c AS uuid), 1, 'initial seed', CAST(:p AS jsonb))"
            ),
            {
                "i": str(uuid7()),
                "c": challenge_id,
                "p": json.dumps(
                    {
                        "bugs": [b["code"] for b in GT_BUGS],
                        "flags": [f[0] for f in GT_FLAGS] + [f["flag_key"] for f in SIDEQUEST_FLAGS],
                        "levels": sorted({b["level"] for b in GT_BUGS}),
                    }
                ),
            },
        )
        g.execute(
            text(
                "INSERT INTO gt.gt_revisions (id, challenge_version_id, revision_no, reason, payload) VALUES (CAST(:i AS uuid), CAST(:c AS uuid), 1, 'initial seed (option B fixture)', CAST(:p AS jsonb))"
            ),
            {
                "i": str(uuid7()),
                "c": challenge_b_id,
                "p": json.dumps({"bugs": [b[0] for b in GT_BUGS_B], "flags": [f[0] for f in GT_FLAGS_B]}),
            },
        )

    print("seed complete:")
    print(f"  event fall-back-2026, stage {stage_id[:8]}, challenge papyrus ({len(PARTICIPANT_FILES)} files)")
    print(f"  option B fixture marina ({len(PARTICIPANT_FILES_B)} files), four level stages (synthetic windows)")
    option_a_points = sum(b["points"] for b in GT_BUGS)
    print(
        f"  ground truth: option A {len(GT_BUGS)} level-scoped bugs ({option_a_points} pts, "
        f"max_points L1={_level_max_points(1)} L2={_level_max_points(2)} L3={_level_max_points(3)} L4={_level_max_points(4)}), "
        f"option B {len(GT_BUGS_B)} fixture bugs ({sum(b[6] for b in GT_BUGS_B)} pts), "
        f"{len(GT_FLAGS) + len(SIDEQUEST_FLAGS)} flags for option A (incl. {len(SIDEQUEST_FLAGS)} side quests)"
    )
    print("  staff: admin@ / organizer@ / reviewer1@ / reviewer2@ example.com - password Dev-only!Passw0rd!")
    print(
        "  participants: p1..p5.team1@ / p1..p5.team2@ example.com - password Dev-only!Passw0rd! (first member is the team lead)"
    )


def _lang(rel: str) -> str:
    ext = rel.rsplit(".", 1)[-1]
    return {"js": "javascript", "html": "html", "css": "css", "json": "json", "md": "markdown"}.get(ext, "text")


def _ingest_challenge(app_session_, challenge_id: str, base_dir: Path, files: list[str]) -> int:
    """Insert participant-visible files and the search line index for one challenge version."""
    line_index = []
    for rel in files:
        path = base_dir / rel
        content = path.read_text()
        sha = hashlib.sha256(content.encode()).hexdigest()
        app_session_.execute(
            text(
                "INSERT INTO app.challenge_files (id, challenge_version_id, path, lang, content, sha256, size_bytes, line_count) "
                "VALUES (CAST(:i AS uuid), CAST(:c AS uuid), :p, :lang, :content, :sha, :size, :lines)"
            ),
            {
                "i": str(uuid7()),
                "c": challenge_id,
                "p": rel,
                "lang": _lang(rel),
                "content": content,
                "sha": sha,
                "size": len(content.encode()),
                "lines": content.count("\n") + 1,
            },
        )
        for ln, line in enumerate(content.splitlines()[:5000], start=1):
            line_index.append((rel, ln, line[:500]))
    for rel, ln, txt in line_index:
        app_session_.execute(
            text(
                "INSERT INTO app.challenge_file_lines (id, challenge_version_id, path, line_number, line_text) VALUES (CAST(:i AS uuid), CAST(:c AS uuid), :p, :ln, :lt)"
            ),
            {"i": str(uuid7()), "c": challenge_id, "p": rel, "ln": ln, "lt": txt},
        )
    return len(line_index)


def _bug_to_dict(bug) -> dict:
    """Legacy tuple fixtures (option B) normalize into the manifest shape."""
    if isinstance(bug, dict):
        return bug
    code, filename, pattern, title, severity, category, points, rcg, explanation, aliases, extra_locs = bug
    locations = [{"file_path": filename, "pattern": pattern, "primary": True}]
    locations += [{"file_path": f, "pattern": p, "primary": bool(prim)} for f, p, prim in extra_locs]
    return {
        "code": code,
        "level": None,
        "title": title,
        "severity": severity,
        "category": category,
        "points": points,
        "root_cause_group": rcg,
        "explanation": explanation,
        "aliases": aliases,
        "locations": locations,
    }


def _seed_ground_truth(gt_session_, challenge_id: str, base_dir: Path, bugs: list, flags: list) -> None:
    """Insert the sealed ground truth for one challenge version (gt schema only).

    Manifest bugs carry level-scoped, already-resolved 3-line locations and
    anchor hashes; legacy tuple fixtures resolve their pattern here."""
    for raw in bugs:
        bug = _bug_to_dict(raw)
        bug_id = str(uuid7())
        gt_session_.execute(
            text(
                "INSERT INTO gt.gt_bugs (id, challenge_version_id, code, title, severity, category, points, "
                "root_cause_group, explanation, level) VALUES (CAST(:i AS uuid), CAST(:c AS uuid), :code, :t, :sev, :cat, :pts, :rcg, :expl, :lvl)"
            ),
            {
                "i": bug_id,
                "c": challenge_id,
                "code": bug["code"],
                "t": bug["title"],
                "sev": bug["severity"],
                "cat": bug["category"],
                "pts": bug["points"],
                "rcg": bug["root_cause_group"],
                "expl": bug["explanation"],
                "lvl": bug.get("level"),
            },
        )
        for loc in bug["locations"]:
            if loc.get("line_start") is not None:
                ls, le, ah = int(loc["line_start"]), int(loc["line_end"]), loc.get("anchor_hash")
            else:
                path = base_dir / loc["file_path"]
                lineno = find_line(path, loc["pattern"])
                if lineno is None:
                    print(f"WARNING: anchor pattern not found for {bug['code']} in {loc['file_path']}")
                    continue
                ls, le, ah = max(1, lineno - 1), lineno + 1, anchor_hash(path, lineno)
            gt_session_.execute(
                text(
                    "INSERT INTO gt.gt_locations (id, bug_id, file_path, line_start, line_end, is_primary, anchor_hash) VALUES (CAST(:i AS uuid), CAST(:b AS uuid), :fp, :ls, :le, :prim, :ah)"
                ),
                {
                    "i": str(uuid7()),
                    "b": bug_id,
                    "fp": loc["file_path"],
                    "ls": ls,
                    "le": le,
                    "prim": bool(loc["primary"]),
                    "ah": ah,
                },
            )
        for kw, w in bug["aliases"]:
            gt_session_.execute(
                text(
                    "INSERT INTO gt.gt_aliases (id, bug_id, keyword, weight) VALUES (CAST(:i AS uuid), CAST(:b AS uuid), :kw, :w)"
                ),
                {"i": str(uuid7()), "b": bug_id, "kw": kw, "w": w},
            )
    for flag in flags:
        if isinstance(flag, dict):
            flag_key, code_hash, points, max_awards, note = (
                flag["flag_key"],
                flag["code_hash"],
                flag["points"],
                flag["max_awards"],
                flag["position_label"],
            )
        else:
            flag_key, plaintext, points, max_awards, note = flag
            code_hash = security.flag_code_hash(plaintext)
        gt_session_.execute(
            text(
                "INSERT INTO gt.gt_flags (id, challenge_version_id, flag_key, code_hash, points, max_awards, position_label) VALUES (CAST(:i AS uuid), CAST(:c AS uuid), :k, :h, :p, :m, :n)"
            ),
            {
                "i": str(uuid7()),
                "c": challenge_id,
                "k": flag_key,
                "h": code_hash,
                "p": points,
                "m": max_awards,
                "n": note,
            },
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="clear existing rows first")
    args = parser.parse_args()
    main(args.reset)
