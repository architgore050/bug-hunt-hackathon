Status: draft plan (PLAN ONLY), created 2026-11-28 on branch `plan/scoring-evaluation-pipeline`

# Scoring and Evaluation Pipeline Plan

Scope: everything between "participant submits" and "score is visible" for the four-level Bug Hunt CTF participant platform (Fall Back). This document is a plan only; no source code, configuration, or migrations are modified here.

---

## 1. Current State Audit

### 1.1 Reference documents and existing code inventory

- **Spec and architecture documents found:**
  - `docs/design/Bug_Hunt_CTF_Participant_Website_Spec.md` (draft v0.1; covers §2.1, §2.4, §3.5, §5.2-§5.9, §6, §7, §8).
  - `Bug_Hunt_CTF___System_Architecture.md` and `03-specification.md` do **not** exist in the repository under those filenames. Their implemented equivalents in `docs/` are `docs/SYSTEM_ARCHITECTURE.md`, `docs/SCORING_MODEL.md`, `docs/EVENT_FLOW.md`, `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`, and `docs/REQUIREMENTS_RECONCILIATION.md`.
- **Existing backend code found:**
  - **Score ledger:** `backend/migrations/0001_init.sql` (`app.score_ledger_entries`, `app.award_claims`), `backend/migrations/0002_score_ledger_immutable.sql` (`trg_score_ledger_append_only` trigger), `backend/app/scoring.py` (`add_ledger_entry`, `claim_award_unit`, `compute_award_points`, `team_totals`).
  - **Submissions:** `backend/app/routers/submissions.py` (v1 `/v1/submissions`), `backend/app/routers/levels.py` (four-level `POST /v1/levels/{level_no}/submit`, `POST /v1/uploads`), `backend/app/evaluator.py` (v1 handlers), `backend/app/evaluator_level.py` (`evaluate_level_submission`), `backend/app/matching.py` (`decide`, `decide_multi`), `backend/app/storage.py` (`inspect_zip`, `save`).
  - **Drafts:** `backend/migrations/0003_four_level_flow.sql` (`app.level_drafts`, `app.submission_artifacts`), `backend/app/routers/submissions.py` (`GET/PUT /v1/drafts/{challenge_id}`), `backend/app/routers/levels.py` (`GET/PUT /v1/levels/{level_no}/draft`, `_compute_diff_from_draft`).
  - **Runner gateway:** `backend/app/config.py` (`runner_enabled: bool = False`), `backend/app/routers/levels.py` (`POST /v1/runs`, `GET /v1/runs/{run_id}` returning `503 RUNNER_UNAVAILABLE`). No runner VM, gateway client, or image definitions exist.
  - **Scheduler:** `backend/worker.py` (`AUTO_SUBMIT_SCAN_INTERVAL_S = 10.0`), `backend/app/auto_submit.py` (`scan_and_submit`, `_auto_submit_one`, `auto_submit_levels`), `backend/app/jobs.py` (`claim_next`, `requeue_expired_leases`, `drain`).
  - **Leaderboard:** `backend/app/scoring.py` (`build_leaderboard`, `save_snapshot`), `backend/app/evaluator.py` (`refresh_leaderboard`), `backend/app/routers/leaderboard.py` (`GET /v1/leaderboard/{stage_id}`, `GET /v1/results/{stage_id}`).
  - **Team tables:** `backend/migrations/0001_init.sql` (`app.teams`, `app.team_members`, `app.assignments`), `backend/migrations/0003_four_level_flow.sql` (`is_lead`, `app.repo_options`, `app.team_repo_choices`, `app.participant_pointers`, `app.participant_progress`), `backend/app/routers/levels.py` (`GET /v1/team`, `GET /v1/team/score`, `POST /v1/team/repo-lock`).

### 1.2 Component status audit

Status legend: **DONE** (implemented and verified in code), **PARTIAL** (exists with gaps against the four-level spec), **MISSING** (not implemented), **BLOCKED** (waiting on an open owner/product decision).

| Component | Status | Evidence (file paths) | Audit findings and gaps |
|---|---|---|---|
| Immutable score ledger & DB trigger | DONE | `backend/migrations/0001_init.sql`, `backend/migrations/0002_score_ledger_immutable.sql`, `backend/app/scoring.py` | Append-only enforced by `trg_score_ledger_append_only` (`BEFORE UPDATE OR DELETE`). `add_ledger_entry` supports `component`, `kind`, `reverses_entry_id`. `test_scoring.py` tests trigger. |
| Team & repo-lock tables + endpoints | DONE | `backend/migrations/0003_four_level_flow.sql`, `backend/app/routers/levels.py`, `backend/app/routers/admin_levels.py` | `app.teams`, `app.team_members` (`is_lead`), `app.team_repo_choices` (`UNIQUE(team_id)`), `POST /v1/team/repo-lock`, `GET /v1/team`. |
| Drafts & artifact upload validation | DONE | `backend/app/routers/levels.py`, `backend/app/storage.py`, `backend/tests/test_flow_uploads.py` | Server drafts in `app.level_drafts`; `POST /v1/uploads` validates `.zip`/`.diff`/`.patch`, size cap, central-directory-only ZIP inspection (rejects `..`, abs paths, symlinks, duplicates, decompression bombs). |
| Idempotent manual & auto-submit path | DONE | `backend/app/routers/levels.py`, `backend/app/auto_submit.py`, `backend/tests/test_flow_auto_submit.py`, `backend/tests/test_idempotency.py` | `POST /v1/levels/{n}/submit` reserves `Idempotency-Key`, locks pointer + stage, reads `clock_timestamp()` once, commits submission + job + outbox + audit in one tx. `auto_submit.py` shares the same transactional contract. |
| L1 & L2 deterministic flag matching | PARTIAL | `backend/app/matching.py`, `backend/app/evaluator_level.py` | `decide()` and `decide_multi()` implement overlap, tolerance, category families, alias evidence, and ordered locations. **Gaps:** (1) `evaluate_level_submission` does not set `matched_bug_code` on `app.submissions`; (2) mid-run crash after `claim_award_unit` turns retried flags into `"duplicate"` and can misclassify `app.submissions.status`; (3) L1/L2 `level_report` has no per-flag evaluation record table (only aggregate `submissions.status`). |
| Team aggregation & dedupe (`D-02`) | PARTIAL | `backend/app/scoring.py`, `backend/app/routers/levels.py`, `backend/app/evaluator_level.py` | `claim_award_unit` enforces `UNIQUE(stage_id, team_id, award_unit_id)`. `GET /v1/team/score` sums `score_ledger_entries` by level and component. **Gap:** `D-02` is still provisional (`one_award_per_team_per_bug`); `points` vs `score` excludes `ctf_bonus`, but L3/L4 max points and penalty interactions are unapproved (`D-05`). |
| L3/L4 pre-confirm diff-apply check | MISSING | `backend/app/routers/levels.py`, `backend/app/storage.py` | Spec §5.8 requires checking that a `.diff`/`.patch` applies cleanly against the frozen base repo and reporting failures before the participant confirms submit. Currently `POST /v1/uploads` and `POST /v1/levels/{n}/submit` never validate diff applicability. |
| Isolated runner gateway & execution | BLOCKED | `backend/app/config.py`, `backend/app/routers/levels.py` | `runner_enabled=False` (ADR-010); `POST /v1/runs` returns `503 RUNNER_UNAVAILABLE`. Blocked on isolated runner VM design, capacity review, and `D-03` (per-stack compile/test definition). |
| L3 evaluation (hidden tests + side quest) | MISSING / BLOCKED | `backend/app/evaluator_level.py`, `backend/app/routers/admin.py`, `backend/app/evaluator.py` | `evaluate_level_submission` only inserts a `review_items` row (`reason='level_artifact'`). `record_test_results` in `admin.py` rejects `level_artifact`, and `apply_test_results` in `evaluator.py` requires an `award_claims` row (which `level_artifact` never creates). Side quest (`D-11`) is undefined. |
| L4 evaluation (buggy/fixed tests + docs) | MISSING / BLOCKED | `backend/app/evaluator_level.py`, `backend/app/config.py` | No runner harness to execute submitted tests against buggy vs fixed repo variants. `ai_assessment_enabled=False` (DEC-13). Blocked on `D-04` (tests + docs scoring) and `D-05` (weights). |
| Stage release & penalty job for levels | PARTIAL | `backend/app/evaluator.py`, `backend/app/routers/admin.py` | `release_feedback` filters `WHERE s.kind = 'bug_report'`, so L1/L2 `level_report` and L3/L4 `level_artifact` submissions are skipped for `RELEASE_DEFAULT` `code_review` entries and `INVALID_REPORT_PENALTY`. |
| Leaderboard versioning & `304` polling | PARTIAL | `backend/app/routers/leaderboard.py`, `backend/app/scoring.py` | `leaderboard_snapshots` stores incrementing `version` and `visibility`. **Gaps:** `GET /v1/leaderboard/{stage_id}` ignores `?since=<version>` and never returns `304 Not Modified`; no unified event-wide `/v1/leaderboard?since=` endpoint; `team_score` is unversioned. |
| Participant verdict hiding (INT-01) | PARTIAL | `backend/app/routers/submissions.py`, `backend/app/routers/levels.py` | `my_submissions` masks `matched_auto`/`needs_review`/`in_review`/`decided`/`ledgered` to `received` before `feedback_released`, **but** does not mask `rejected_auto` or `duplicate` (leaks verdict). `GET /v1/team/score` shows `evaluation_status` and live points before release. |
| A/B option fairness & production content | BLOCKED | `backend/seed.py`, `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md` | Option A (Papyrus) and Option B (Marina) in `seed.py` are dev fixtures only. Blocked on `D-10` (independent solver equivalence certification). |

---

## 2. Pipeline Design

### 2.1 End-to-end stages and data flow

```text
[Participant Browser / Auto-Submit Scheduler]
   │
   ├─(L3/L4 pre-submit)─> POST /v1/uploads (zip/diff/patch) -> storage.save() + inspect_zip()
   │                       + [NEW] diff-apply dry-run check (before confirm)
   │
   └─ POST /v1/levels/{n}/submit (Idempotency-Key)  OR  auto_submit.scan_and_submit()
        │  (1 tx: reserve idem key -> lock pointer -> lock stage -> clock_timestamp()
        │         -> validate -> insert app.submissions [RECEIVED] + bind artifact
        │         -> enqueue evaluate_level_submission [QUEUED] + outbox + audit
        │         -> advance pointer)
        ▼
[app.jobs queue] ──(worker.py: FOR UPDATE SKIP LOCKED, 120s lease)──> [Evaluator]
        │
        ├─ L1/L2 (kind='level_report'):
        │    1. Transition submission -> EVALUATING
        │    2. Load frozen ground truth via gt_session (gt.gt_bugs, gt_aliases, gt_locations)
        │    3. Per-flag deterministic match: decide() [L1] or decide_multi() [L2]
        │       -> persist per-flag result in [NEW] app.submission_flag_results (idempotent)
        │    4. Claim award unit via app.award_claims UNIQUE(stage_id, team_id, award_unit_id)
        │    5. Write immutable ledger row (evidence_report) if claimed & not yet ledgered
        │    6. Enqueue create_review_item (confirm or borderline/unmatched)
        │    7. Transition submission -> SCORED / NEEDS_REVIEW / FAILED
        │
        ├─ L3 (kind='level_artifact'):
        │    1. Transition submission -> EVALUATING
        │    2. Dispatch to Runner Gateway (isolated VM) against frozen base repo:
        │       - Safe unpack / git apply (reject traversal/symlinks)
        │       - Run hidden functional test suite + side-quest checks
        │    3. If runner unavailable: keep QUEUED/EVALUATING ("Evaluating..."), retry with backoff
        │       or route to organizer offline test-results path (ADR-019)
        │    4. Write functional_test + side_quest ledger entries (idempotent)
        │    5. Enqueue review item if human review required -> SCORED or NEEDS_REVIEW
        │
        └─ L4 (kind='level_artifact'):
             1. Transition submission -> EVALUATING
             2. Dispatch to Runner Gateway:
                - Run participant test suite against (a) buggy variant (expect fail)
                  and (b) fixed variant (expect pass)
             3. Docs assessment: capped AI assessment (if enabled & prompt-injection hardened)
                and/or human reviewer rubric
             4. Write test_quality + docs_quality ledger entries -> SCORED or NEEDS_REVIEW
        ▼
[Score Aggregation & Leaderboard]
   - Enqueue refresh_leaderboard(stage_id) after any ledger write or review decision
   - Build snapshot from SUM(app.score_ledger_entries.points) + tie-break metrics
   - Save versioned row in app.leaderboard_snapshots
   - GET /v1/leaderboard/{stage_id}?since=<version> returns 304 if unchanged, else snapshot
   - GET /v1/team/score reads ledger totals + evaluation_status ("Evaluating" while pending)
```

### 2.2 Submission state machine

Target logical lifecycle states for a submission (`RECEIVED`, `QUEUED`, `EVALUATING`, `SCORED`, `NEEDS_REVIEW`, `FAILED`) and how they map to `app.submissions.status`:

| Logical State | `app.submissions.status` (DB) | Entry Condition | Exit / Next States | Participant-Visible Before Release (INT-01) |
|---|---|---|---|---|
| `RECEIVED` | `received` | Submission row inserted in submit tx | `QUEUED` (job enqueued in same tx) | `received` |
| `QUEUED` | `queued` (or `received` + job `queued`) | `evaluate_level_submission` job in `app.jobs` | `EVALUATING` (worker claims job) | `received` |
| `EVALUATING` | `evaluating` | Worker starts evaluation / runner job in flight | `SCORED`, `NEEDS_REVIEW`, `FAILED` | `received` (and `Evaluating` on score card) |
| `SCORED` | `matched_auto`, `decided`, `ledgered`, `rejected_auto`, `duplicate` | All automated/review scoring complete for submission | Terminal (except post-release `disputed`) | `received` (masked until `feedback_released=true`) |
| `NEEDS_REVIEW` | `needs_review`, `in_review` | Borderline match, L3/L4 human rubric, or runner fallback | `SCORED` (after `apply_review_outcome`) | `received` |
| `FAILED` | `failed` | Unrecoverable evaluation error (dead-lettered job) or corrupt artifact | `QUEUED` (admin retry) or `SCORED` (manual override) | `received` (alerts organizer in `system/health`) |

Note: `app.submissions.status` currently has a `CHECK` constraint in `0001_init.sql`. Adding `queued`, `evaluating`, and `failed` requires a forward-only expand migration updating that constraint, or tracking `evaluation_state` in a dedicated column (`RECEIVED`, `QUEUED`, `EVALUATING`, `SCORED`, `NEEDS_REVIEW`, `FAILED`) while keeping `status` backward-compatible with v1. A dedicated `evaluation_state` column avoids breaking v1 status checks.

### 2.3 Tables and fields to add (planned migrations)

1. **`app.submissions` (expand):**
   - `evaluation_state VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'` (`RECEIVED`, `QUEUED`, `EVALUATING`, `SCORED`, `NEEDS_REVIEW`, `FAILED`).
   - `evaluation_error TEXT NULL` (internal/admin-only failure reason; never exposed to participants).
2. **`app.submission_flag_results` (new table, L1/L2 per-flag audit & crash-safe idempotency):**
   - `id UUID PRIMARY KEY`, `submission_id UUID NOT NULL REFERENCES app.submissions(id)`, `flag_index INTEGER NOT NULL`, `outcome VARCHAR(24) NOT NULL`, `matched_bug_code VARCHAR(40)`, `location_score NUMERIC(5,4)`, `category_score NUMERIC(5,4)`, `alias_evidence NUMERIC(5,4)`, `claimed_award BOOLEAN NOT NULL DEFAULT false`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `UNIQUE (submission_id, flag_index)`.
   - Fixes the crash-resumption bug in `evaluator_level.py`: on worker retry, already-processed `flag_index` rows are skipped instead of re-evaluating and turning a prior `accept_full` into `duplicate`.
3. **`app.runner_evaluations` (new table, L3/L4 runner jobs):**
   - `id UUID PRIMARY KEY`, `submission_id UUID REFERENCES app.submissions(id)`, `artifact_id UUID REFERENCES app.submission_artifacts(id)`, `challenge_version_id UUID NOT NULL`, `kind VARCHAR(20)` (`practice_run`, `l3_eval`, `l4_eval`, `diff_check`), `status VARCHAR(20)` (`queued`, `running`, `completed`, `failed`, `unavailable`), `exit_code INTEGER`, `tests_passed INTEGER`, `tests_total INTEGER`, `variant_results JSONB`, `stdout_truncated TEXT`, `stderr_truncated TEXT`, `created_at TIMESTAMPTZ`, `finished_at TIMESTAMPTZ`.
4. **`app.stages` / `app.events` config keys:**
   - Explicit JSONB keys for per-level weights, `max_points`, `side_quest_points`, `ai_docs_max_points`, and `scoring.team_dedupe`.

### 2.4 API changes (planned)

- `POST /v1/uploads`: for `.diff`/`.patch`, optionally run a lightweight dry-run patch check (or `POST /v1/uploads/{id}/verify-diff` against the frozen base repo) so a diff that fails to apply is reported **before** the participant confirms `POST /v1/levels/{n}/submit`.
- `GET /v1/leaderboard/{stage_id}?since=<version>` (and optional `GET /v1/leaderboard?since=<version>`): return `304 Not Modified` when the latest visible snapshot `version <= since`.
- `POST /v1/admin/challenges/{challenge_id}/test-results`: extend to accept `level_artifact` submissions (L3/L4) without requiring an `app.award_claims` row, writing `functional_test` directly against the level's configured `max_points`.
- `POST /v1/admin/submissions/{submission_id}/retry`: re-enqueue a `FAILED` submission safely.
- `POST /v1/admin/ledger/adjust`: already exists as `manual_adjustment` (admin-only, step-up) for human overrides; ensure it also enqueues `refresh_leaderboard`.

---

## 3. Scoring Rules Per Level

All provisional dev defaults are marked; every unresolved policy item is tagged `[DECISION NEEDED]` with its decision ID (`D-02`, `D-04`, `D-05`, `D-07`, `D-10`, `D-11`).

### 3.1 Cross-level rules

- **Ledger components:** `evidence_report`, `code_review`, `functional_test`, `ctf_bonus`, `penalty`, `adjustment`, plus planned L3/L4 components `side_quest`, `test_quality`, `docs_quality`.
- **Team aggregation and dedupe (`D-02`):**
  - Current dev default: `one_award_per_team_per_bug` enforced by `UNIQUE (stage_id, team_id, award_unit_id)` in `app.award_claims`. Team total = `SUM(points)` over `app.score_ledger_entries` for the team.
  - `[DECISION NEEDED: D-02]` Confirm whether `one_award_per_team_per_bug` applies per-level (current: `stage_id` is per level, so the same bug could be claimed in L1 and L2 if present in both) or across L1+L2 combined, and whether L3/L4 team submissions are scored per-member or aggregated at team level (e.g., best member artifact vs. lead artifact vs. sum).
- **A/B repo fairness (`D-10`):**
  - `[DECISION NEEDED: D-10]` Option A (MERN/Express) and Option B (nginx + FastAPI + SQLite) must have identical bug counts, severity distributions, point totals, and hidden test counts, certified by two independent solvers before `READY`.

### 3.2 Level 1 (Single-location bug hunt)

- **Input:** `flags[]` (each: 1 `(file_path, line_start, line_end)`, `category`, `title`, `description`, `evidence`).
- **Matching:** `matching.decide()` against `gt.gt_bugs` + `gt.gt_locations` + `gt.gt_aliases` for the team's `challenge_version_id`.
  - Structural reject (`reject_invalid`): `span > max_span` (25), missing file, file outside repo (`FILE_NOT_FOUND` at submit), range outside file (`LOCATION_INVALID`), or unmatched with `len(desc) < min_description_chars` (20).
  - Location score: `1.0` if overlapping or within `location_tolerance_lines` (2); linear decay to `0.0` over `10 - tolerance` lines.
  - `accept_full`: `L >= 0.9` and `C >= 0.6` and `alias_evidence >= 0.2`. Claims award unit; pays `evidence_report = bug.points * w_evidence * max(alias_evidence, 0.6)`.
  - `accept_partial`: `L >= 0.9` and `C == 0` -> `NEEDS_REVIEW` (reviewer decides full/partial).
  - `duplicate`: award unit already in `app.award_claims` for `(stage_id, team_id)` -> 0 points, no penalty.
- **Weights & penalties (`D-05`):**
  - `[DECISION NEEDED: D-05]` Approve production L1 `max_points`, component weights (`w_functional`, `w_code_review`, `w_evidence`), and whether L1 uses `evidence_report` + `code_review` only (since participants do not submit code fixes in L1) or keeps the 0.5/0.3/0.2 split.

### 3.3 Level 2 (Multi-location bug hunt)

- **Input:** `flags[]` (each: 1 to 5 ordered `(file_path, line_start, line_end)` locations, `category`, `title`, `description`, `evidence`).
- **Matching:** `matching.decide_multi()` for `len(locations) > 1`, `decide()` for `len(locations) == 1`. Location score is the mean of best same-file location scores across the flag's locations; order is preserved in `submissions.payload`.
- **Scoring & partial credit (`D-05`):**
  - `[DECISION NEEDED: D-05]` Approve whether partial location matches in L2 (e.g., 2 of 3 locations found) receive fractional credit automatically or route to `NEEDS_REVIEW` (`accept_partial` = `0.5 * review_quality`), and approve L2 `max_points`.

### 3.4 Level 3 (Bug fixes + side quest)

- **Input:** `.zip`, `.diff`, or `.patch` artifact (or server-computed diff from `app.level_drafts` on manual/auto submit).
- **Auto-submit with no uploads (`D-07`):**
  - Current behavior (`auto_submit.py`): exports `app.level_drafts` diff against frozen base; if empty, records an explicit empty submission (`empty: true`, 0 points).
  - `[DECISION NEEDED: D-07]` Confirm this policy for production (draft diff fallback vs. 0-point empty submission).
- **Evaluation & scoring (`D-04`, `D-05`, `D-11`):**
  - Apply artifact onto frozen base repo inside isolated runner; run hidden functional test suite -> `functional_test = l3_max_points * w_func * (tests_passed / tests_total)`.
  - `[DECISION NEEDED: D-11]` Define the Level 3 side quest, its verification checks (automated runner test vs. manual review), and its point value/cap.
  - `[DECISION NEEDED: D-04, D-05]` Define L3 `max_points`, pass/fail vs. proportional test scoring, and whether code review rubric applies to L3 diffs.

### 3.5 Level 4 (Tests + documentation)

- **Input:** `.zip`, `.diff`, or `.patch` artifact (or server-computed draft diff).
- **Evaluation & scoring (`D-04`, `D-05`):**
  - **Tests:** Run participant-written tests in isolated runner against (a) **buggy** base variant (tests should fail/catch bugs) and (b) **fixed** reference variant (tests should pass without false positives). Score = `l4_test_max * (bugs_caught / total_bugs)` conditioned on passing the fixed variant.
  - **Docs:** `[DECISION NEEDED: D-04]` Decide whether documentation updates are scored by human reviewer rubric only (current DEC-13: `ai_assessment_enabled=False`) or by capped AI assessment with prompt-injection isolation and human override.
  - `[DECISION NEEDED: D-05]` Approve L4 `max_points` and the split between test quality and documentation quality.

---

## 4. Verification Checks

Status legend: **NOT STARTED**, **IN PROGRESS**, **DONE** (verified passing in existing repo tests), **BLOCKED** (depends on missing/blocked component).

### 4.1 Correctness

| ID | Check | Component Verified | Status | Existing Evidence / Gap |
|---|---|---|---|---|
| CHK-COR-01 | Same submission scored twice gives an identical ledger result (determinism) | `evaluator_level.py`, `matching.py`, `scoring.py` | IN PROGRESS | `test_matching.py` tests `decide()` determinism; `evaluate_level_submission` needs `submission_flag_results` to be crash-replay deterministic. |
| CHK-COR-02 | Retried submit with same `Idempotency-Key` returns original receipt and adds zero ledger rows | `routers/levels.py`, `routers/submissions.py` | DONE | Verified in `test_idempotency.py` and `test_flow_submissions.py::test_idempotent_level_submission_replay_and_conflict`. |
| CHK-COR-03 | Auto-submit and manual submit produce identical ledger entries | `auto_submit.py`, `routers/levels.py`, `evaluator_level.py` | IN PROGRESS | `test_flow_auto_submit.py` verifies draft-to-submission parity; needs explicit assertion comparing ledger rows for identical L1/L2 payloads. |
| CHK-COR-04 | Team total equals sum of member components after dedupe rule (`D-02`) | `scoring.py`, `routers/levels.py` (`/team/score`) | DONE | Verified in `test_flow_submissions.py::test_team_dedupe_second_teammate_does_not_double_award` and `test_team_points_show_completed_level_score_and_cumulative_points`. |
| CHK-COR-05 | Ledger is append-only; corrections are new reversing rows, never edits | `0002_score_ledger_immutable.sql`, `scoring.py` | DONE | Verified in `test_scoring.py::test_ledger_is_database_enforced_append_only`. |

### 4.2 Flag matching

| ID | Check | Component Verified | Status | Existing Evidence / Gap |
|---|---|---|---|---|
| CHK-FLG-01 | Exact line, overlapping range, and off-by-N (within/outside tolerance) | `matching.py` (`location_score`) | DONE | Verified in `test_matching.py` (`test_exact_overlap_accepts_full`, `test_near_location_with_alias_accepts`, `test_location_score_bounds`). |
| CHK-FLG-02 | Wrong file routes to `needs_review` (never auto-penalized) | `matching.py` (`decide`) | DONE | Verified in `test_matching.py::test_wrong_file_needs_review`. |
| CHK-FLG-03 | File outside repo and line range outside file rejected at submit | `routers/levels.py` (`_validate_flag`) | IN PROGRESS | `_validate_flag` raises `FILE_NOT_FOUND` / `LOCATION_INVALID`; add dedicated negative test cases in `test_flow_submissions.py`. |
| CHK-FLG-04 | Duplicate flag (same bug already claimed by team) pays 0, no penalty | `evaluator_level.py`, `scoring.py` | DONE | Verified in `test_matching.py::test_already_awarded_unit_is_duplicate` and `test_flow_submissions.py`. |
| CHK-FLG-05 | L2 flag with 3 locations preserves order and scores via `decide_multi()` | `routers/levels.py`, `matching.py` | DONE | Verified in `test_flow_submissions.py::test_l2_multilocation_flag_matches_cross_file_bug`. |

### 4.3 Level 3 and 4

| ID | Check | Component Verified | Status | Existing Evidence / Gap |
|---|---|---|---|---|
| CHK-L34-01 | Diff that fails to apply is reported before confirm; zip with `../` or symlinks is rejected and nothing extracts outside sandbox | `storage.py`, `routers/levels.py`, Runner | PARTIAL / NOT STARTED | Zip traversal & symlink rejection **DONE** in `test_flow_uploads.py`. Pre-confirm diff-apply check **NOT STARTED**. |
| CHK-L34-02 | Hidden tests never exposed in participant bundle or run output | Runner Gateway, `routers/levels.py`, `gt` schema | BLOCKED | Blocked on runner implementation (`D-03`, `D-04`). |
| CHK-L34-03 | Option A and Option B produce comparable scores on equivalent solutions | `seed.py`, challenge packages, `evaluator_level.py` | BLOCKED | Blocked on `D-10` (final A/B packages + independent solver certification). |

### 4.4 Integrity and security

| ID | Check | Component Verified | Status | Existing Evidence / Gap |
|---|---|---|---|---|
| CHK-SEC-01 | No answer-key or evaluator data reachable from participant endpoints | `db.py` (`app_api` role), `routers/*.py` | DONE | Verified in `test_gt_isolation.py`. |
| CHK-SEC-02 | Per-flag correctness hidden from participants on one-shot levels (INT-01) | `routers/submissions.py`, `routers/levels.py` | IN PROGRESS | `my_submissions` leaks `rejected_auto`/`duplicate` before release; must mask all pre-release statuses to `received`. |
| CHK-SEC-03 | Explanation text never rendered as HTML; AI-assessed text treated as untrusted input (prompt-injection test cases) | `frontend/` (`PlainMarkdown`), AI evaluator | IN PROGRESS / BLOCKED | Frontend `PlainMarkdown` renders text-only (no `dangerouslySetInnerHTML`). AI prompt-injection harness **BLOCKED** on `D-04` / DEC-13. |

### 4.5 Resilience

| ID | Check | Component Verified | Status | Existing Evidence / Gap |
|---|---|---|---|---|
| CHK-RES-01 | Runner off: save and submit still work, score shows `"Evaluating..."` | `routers/levels.py`, `routers/runs` | DONE | Verified in `test_flow_submissions.py::test_runs_disabled_but_submission_paths_open` and `test_team_points_show_completed_level_score_and_cumulative_points`. |
| CHK-RES-02 | Evaluator crash mid-run resumes without double-scoring | `jobs.py`, `evaluator_level.py`, `submission_flag_results` | NOT STARTED | `claim_award_unit` blocks double-award, but `evaluator_level.py` lacks per-flag checkpointing and crashes turn retried flags into `duplicate`. |
| CHK-RES-03 | Leaderboard refreshes within one polling interval; `304` when unchanged | `routers/leaderboard.py`, `evaluator.py` | NOT STARTED | Snapshot refresh on submit/eval works; `?since=<version>` and `304 Not Modified` are not implemented. |

---

## 5. Work Breakdown

Ordered by dependency and risk:

| # | Task | Status | Dependencies | Size | Gating Checks |
|---|---|---|---|---|---|
| T1 | Mask `rejected_auto`/`duplicate` in `my_submissions` before `feedback_released` (INT-01) | NOT STARTED | None | S | CHK-SEC-02 |
| T2 | Add `app.submission_flag_results` + `evaluation_state` migration; make `evaluate_level_submission` crash-resumable and set `matched_bug_code` | NOT STARTED | None | M | CHK-COR-01, CHK-COR-03, CHK-RES-02 |
| T3 | Fix `release_feedback` and `record_test_results` / `apply_test_results` to support `level_report` and `level_artifact` | NOT STARTED | T2 | M | CHK-COR-01, CHK-COR-04 |
| T4 | Add `?since=<version>` and `304 Not Modified` to `GET /v1/leaderboard/{stage_id}` | NOT STARTED | None | S | CHK-RES-03 |
| T5 | Add missing negative tests: file outside repo, range outside file, auto-submit vs manual ledger parity | NOT STARTED | T2 | S | CHK-COR-03, CHK-FLG-03 |
| T6 | Implement pre-confirm diff-apply dry-run check against frozen base repo (`POST /v1/uploads` or verify endpoint) | NOT STARTED | None | M | CHK-L34-01 |
| T7 | Design and build isolated Runner Gateway + baked A/B stack images (Node/Express, Python/FastAPI) | BLOCKED | D-03, ADR-010 approval | L | CHK-L34-02, CHK-RES-01 |
| T8 | Implement L3 evaluator: runner hidden test execution + side-quest scoring | BLOCKED | T3, T7, D-04, D-05, D-11 | L | CHK-L34-02, CHK-L34-03 |
| T9 | Implement L4 evaluator: test execution vs buggy & fixed variants + docs rubric / optional AI with prompt-injection tests | BLOCKED | T3, T7, D-04, D-05 | L | CHK-L34-02, CHK-SEC-03 |
| T10 | Validate Option A vs Option B score equivalence with independent solver runs | BLOCKED | T8, T9, D-10 | M | CHK-L34-03 |

---

## 6. Risks and Conflicts with the Existing Architecture

1. **C-4 (Participant upload path vs. admin-only uploads):** Resolved in `storage.py` + `POST /v1/uploads` with central-directory-only ZIP inspection. Remaining risk: `.diff`/`.patch` files are not yet test-applied before submission confirmation, so malformed patches reach `submit` and fail later in evaluation.
2. **C-6 (Compile/run on backend vs. isolated runner VM):** `runner_enabled=False` (ADR-010) keeps the API host safe, but blocks automated L3/L4 evaluation. If the runner is not approved before event day, L3/L4 must fall back to the organizer offline test-results flow (`ADR-019`), which currently rejects `level_artifact` in `admin.py::record_test_results`.
3. **C-11 (Team score = sum of members vs. team-level dedupe):** `award_claims` enforces one award per `(stage_id, team_id, award_unit_id)` for bug reports. Conflict for L3/L4: every team member can submit an artifact independently in `POST /v1/levels/{n}/submit`, so without a team-level artifact aggregation rule (`D-02`/`D-05`), `team/score` will either sum all members' L3/L4 scores (exceeding `max_points`) or ignore teammates' submissions.
4. **C-12 (Level 4 tests and docs vs. bug-report scoring model):** `scoring.py` and `release_feedback` assume `award_claims` + `gt.gt_bugs` rows. L4 test-vs-buggy/fixed and docs rubrics have no `gt_bugs` rows, so `apply_test_results`, `apply_review_outcome`, and `release_feedback` will silently no-op or skip L4 submissions until extended (Task T3).
5. **Audit-discovered code conflicts:**
   - `evaluator_level.py` does not update `matched_bug_code` on `app.submissions`, breaking `release_feedback` default `code_review` attribution.
   - `submissions.py::my_submissions` does not mask `rejected_auto` and `duplicate` before `feedback_released` (INT-01 gap).

---

## 7. Questions for the Team (Most Blocking First)

1. **[BLOCKING: D-03 / ADR-010]** Will an isolated runner VM be provisioned for event day, or should L3/L4 evaluation use the offline organizer test-runner (`ADR-019`)? What exact commands define "compile/test" for Option A (MERN) and Option B (FastAPI)?
2. **[BLOCKING: D-04, D-05]** What are the final `max_points` per level (L1-L4), the component weights per level, and how are L4 tests (buggy vs. fixed) and documentation scored (human rubric only vs. capped AI)?
3. **[BLOCKING: D-02]** For L3 and L4 (where each member can submit an artifact), does the team score take the lead's submission, the highest-scoring member submission, or an average/sum? For L1/L2, is dedupe per-level or across L1+L2 combined?
4. **[BLOCKING: D-11]** What is the Level 3 side quest, and is it verified automatically by hidden tests or by human review?
5. **[BLOCKING: D-10]** Who are the two independent solvers certifying that Option A and Option B have equivalent bug counts, severities, and test suites before `READY`?
6. **[HIGH: D-07]** When a participant has no saved draft changes at the L3/L4 deadline, is the auto-submitted empty submission scored 0 with no penalty, or does it incur any penalty?
7. **[MEDIUM: INT-01]** Should `GET /v1/team/score` hide live `evaluation_status` and component points until `feedback_released` (like `my_submissions`), or remain live for one-shot levels as noted in §5.9?
