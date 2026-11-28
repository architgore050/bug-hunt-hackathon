Status: updated plan (PLAN ONLY), 2026-11-28 on branch `plan/scoring-evaluation-pipeline`

# Scoring and Evaluation Pipeline Plan

Scope: everything between "participant submits" and "score is visible" for the four-level Bug Hunt CTF participant platform (Fall Back). This document is a plan only; no source code, configuration, or migrations are modified here.

---

## 1. Decisions Table

All assumed decisions below are marked `ASSUMED` pending explicit owner confirmation. Open policy/content items remain `OPEN` and are flagged `[DECISION NEEDED]`. Decision IDs (`D-xx`) follow the decisions table in `docs/design/Bug_Hunt_CTF_Participant_Website_Spec.md`.

| ID | Decision | Status | Impact if it changes |
|---|---|---|---|
| D-02 | **Team dedupe & aggregation:** L1 and L2 use one award per team per bug, applied separately per level (`stage_id`). L3 and L4 team score = **best-scoring member submission** (not sum across members, not lead-only). | ASSUMED | If L1+L2 share a single dedupe pool, `award_claims` uniqueness must move from `(stage_id, team_id, award_unit_id)` to `(event_id, team_id, award_unit_id)`. If L3/L4 use sum or lead-only, aggregation logic and `max_points` change. |
| D-03 | **Runner & compile definition:** "Compile" means build + lint + test suite only, with dependencies baked into pinned per-stack images (no internet). If no isolated runner VM exists by event day, L3 and L4 evaluate through the offline organizer test-runner (ADR-019). Both paths sit behind one evaluator interface. | ASSUMED | If live multi-container services (e.g. MongoDB + nginx) are required at runtime, runner VM sizing, timeouts, and image specs must be redesigned. |
| D-04 | **L3 & L4 scoring mechanics:** L3 is scored by hidden functional tests. L4 is scored by running submitted tests against both the buggy base variant (must fail/catch bugs) and the fixed reference variant (must pass), plus L4 docs via human rubric (AI assessment optional, capped, with human override). | ASSUMED | If AI assessment is enabled for L4 docs, requires provider qualification (DEC-13), prompt-injection test suite, and `ai_docs_max_points` config. |
| D-05 | **Weights & `max_points`:** Not decided. `max_points` and component weights are per-level stage/event configuration with no hardcoded production numbers (`stage.config.max_points`, `stage.config.scoring.weights`). `[DECISION NEEDED]` | OPEN | Blocks score finalization, `READY` gate, and production seed/config validation. |
| D-07 | **L3/L4 auto-submit with no upload:** Server exports the latest saved workspace snapshot (`app.level_drafts`) as a diff against the frozen base repo, then sends it through the exact same submission and evaluation path as a manual submit (empty diff -> explicit empty submission, 0 points). | ASSUMED | If empty auto-submit should incur a penalty or block progression, `auto_submit.py` and `release_feedback` must be updated. |
| D-10 | **A/B option fairness:** Launch readiness gate (`READY` checklist), not runtime code: equal bug count and severity distribution, equivalent hidden test suites, and independent verification by two solvers across Option A and Option B. | ASSUMED | If A/B parity cannot be achieved, normalization/scaling factors per option would be needed in `scoring.py`. |
| D-11 | **Level 3 side quest:** Not defined. Plan a dedicated ledger component slot (`side_quest`) gated by `stage.config.side_quest`, flagged `[DECISION NEEDED]`, supporting either automated hidden tests or human review. | OPEN | Blocks L3 evaluator completion and L3 `max_points` finalization. |
| INT-01 | **Pre-release verdict hiding:** Mask all pre-release submission statuses (including `rejected_auto` and `duplicate`) to `received` in participant endpoints until `feedback_released = true`. | ASSUMED | `GET /v1/team/score` currently sums ledger points with no `feedback_released` gate (verified in `levels.py`), so live points are participant-visible before release; `/team/score` gating must be tightened (folded into T-01). |

---

## 2. Re-Verified Current State Audit

Re-verified directly against repository files on 2026-11-28. Runtime execution of `pytest`, `e2e_journey.py`, and `npm run build` could not run locally (no local PostgreSQL, Python 3.12, or `node_modules`) and are therefore marked `UNVERIFIED` here.

| Component | Status | Evidence (file paths) | Findings and gaps |
|---|---|---|---|
| Immutable score ledger & trigger | DONE | `backend/migrations/0001_init.sql`, `backend/migrations/0002_score_ledger_immutable.sql`, `backend/app/scoring.py` | `trg_score_ledger_append_only` blocks `UPDATE`/`DELETE`. `add_ledger_entry` supports `component`, `kind`, `reverses_entry_id`. Runtime test pass: `UNVERIFIED` locally. |
| Team, repo-lock & progression tables | DONE | `backend/migrations/0003_four_level_flow.sql`, `backend/app/routers/levels.py`, `backend/app/flow.py` | `app.teams`, `app.team_members` (`is_lead`), `app.team_repo_choices`, `app.participant_pointers`, `app.participant_progress`, `POST /v1/team/repo-lock`. |
| Drafts & artifact upload validation | DONE | `backend/app/routers/levels.py`, `backend/app/storage.py`, `backend/migrations/0003_four_level_flow.sql` | `app.level_drafts` + `POST /v1/uploads` with `.zip`/`.diff`/`.patch` checks, size cap, central-directory-only ZIP inspection (rejects `..`, abs paths, symlinks, duplicates, decompression bombs). |
| Idempotent manual & auto-submit | DONE | `backend/app/routers/levels.py`, `backend/app/auto_submit.py` | `POST /v1/levels/{n}/submit` reserves `Idempotency-Key`, locks pointer + stage, reads `clock_timestamp()` once. `auto_submit.py` exports L3/L4 draft diff via `_compute_diff_from_draft` and uses the same submission contract. |
| L1 & L2 deterministic flag matching | PARTIAL | `backend/app/matching.py`, `backend/app/evaluator_level.py` | `decide()` and `decide_multi()` handle overlap, tolerance, category families, alias evidence, and ordered locations. **Gaps:** `evaluate_level_submission` does not set `submissions.matched_bug_code`, and a crash mid-loop turns already-claimed flags into `duplicate` on retry. |
| Team aggregation & best-member L3/L4 | PARTIAL | `backend/app/scoring.py`, `backend/app/routers/levels.py` | `claim_award_unit` enforces `UNIQUE(stage_id, team_id, award_unit_id)` for L1/L2. **Gap:** L3/L4 best-scoring member aggregation (with tie-break and reversal of superseded member entries) is not implemented. |
| Stage release & penalty job for levels | PARTIAL | `backend/app/evaluator.py`, `backend/app/routers/admin.py` | `release_feedback` filters `WHERE s.kind = 'bug_report'`, skipping `level_report` (L1/L2) and `level_artifact` (L3/L4). `record_test_results` in `admin.py` rejects `level_artifact`, and `apply_test_results` requires `award_claims`. |
| Pre-confirm diff-apply validation | MISSING | `backend/app/routers/levels.py`, `backend/app/storage.py` | No dry-run check verifies that uploaded `.diff`/`.patch` applies cleanly to the frozen base repo before the participant confirms submit. |
| Evaluator interface & runner backends | MISSING | `backend/app/config.py`, `backend/app/routers/levels.py`, `backend/app/evaluator_level.py` | `runner_enabled=False`; `POST /v1/runs` returns `503 RUNNER_UNAVAILABLE`. No `RunnerBackend` interface, no isolated runner gateway, and `evaluate_level_submission` only creates a `review_items` row for `level_artifact`. |
| L3 hidden tests & side quest scoring | MISSING | `backend/app/evaluator_level.py` | Neither automated runner execution nor `side_quest` ledger component exists. Blocked on `D-05` and `D-11`. |
| L4 buggy/fixed variant tests & docs | MISSING | `backend/app/evaluator_level.py`, `backend/app/config.py` | No variant test harness (buggy vs fixed) and no `test_quality` / `docs_quality` rubric/AI pipeline (`ai_assessment_enabled=False`). Blocked on `D-04` and `D-05`. |
| Leaderboard versioning & `304` polling | PARTIAL | `backend/app/routers/leaderboard.py`, `backend/app/scoring.py` | `leaderboard_snapshots` stores `version` and `visibility`. **Gap:** `GET /v1/leaderboard/{stage_id}` ignores `?since=<version>` and never returns `304 Not Modified`. |
| Participant verdict hiding (INT-01) | PARTIAL | `backend/app/routers/submissions.py`, `backend/app/routers/levels.py` | `my_submissions` masks `matched_auto`/`needs_review`/`in_review`/`decided`/`ledgered` to `received` before `feedback_released`, **but** does not mask `rejected_auto` or `duplicate`. `GET /v1/team/score` sums `score_ledger_entries` per level with no `feedback_released` gate, so live component points are participant-visible before release. |
| A/B repo fairness & production content | BLOCKED | `backend/seed.py`, `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md` | Option A (Papyrus) and Option B (Marina) in `seed.py` are dev fixtures only. Blocked on `D-10` independent solver certification. |

---

## 3. Final Pipeline Design

### 3.1 Submission state machine

Add `evaluation_state VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'` (and admin-only `evaluation_error TEXT`) on `app.submissions` so v1 `status` values remain backward-compatible:

```text
RECEIVED ──(enqueue evaluate_level_submission)──> QUEUED
QUEUED   ──(worker claims job)──────────────────> EVALUATING
EVALUATING ─┬─(auto-scored / review decided)────> SCORED
            ├─(borderline / human rubric / ADR-019)─> NEEDS_REVIEW ──(review decided)─> SCORED
            └─(dead-lettered / corrupt artifact)────> FAILED ──(admin retry)──────────> QUEUED
```

Participant visibility (INT-01): before `feedback_released = true`, `my_submissions` returns `received` for all states (including `rejected_auto`, `duplicate`, `FAILED`). `GET /v1/team/score` shows `evaluation_status = "evaluating"` while any team submission for that level has `evaluation_state IN ('RECEIVED', 'QUEUED', 'EVALUATING', 'NEEDS_REVIEW')`.

### 3.2 Evaluator interface and two runner backends

Define `ArtifactEvaluator` (protocol in `backend/app/runner_gateway.py`) used by `evaluate_level_submission` for `kind = 'level_artifact'`:

- `evaluate_l3(submission, artifact, challenge_version, stage_cfg) -> ArtifactEvalResult`
- `evaluate_l4(submission, artifact, challenge_version, stage_cfg) -> ArtifactEvalResult`
- `ArtifactEvalResult`: `{status: 'completed' | 'needs_review' | 'failed', tests_passed, tests_total, variant_results: {buggy_caught, buggy_total, fixed_passed, fixed_total}, side_quest_passed: bool | None, stdout_excerpt, stderr_excerpt, error_code}`

Two concrete backends implement this interface, selected by `settings.runner_enabled` (and `stage.config.runner_mode`):

1. **`IsolatedRunnerBackend` (Runner VM active):**
   - Sends artifact storage reference + frozen `challenge_version_id` to the isolated runner gateway (separate VM, no internet, pinned per-stack images with baked dependencies per `D-03`).
   - Runner unpacks safely (rejects `..`, abs paths, symlinks), applies diff/overlay, and runs configured build + lint + test commands within `stage.config.runner.timeout_s`.
   - L3 runs hidden functional tests + automated side-quest tests (if configured).
   - L4 runs participant tests against both the buggy base repo variant and the fixed reference variant.
   - If the runner is temporarily unreachable, the job stays `QUEUED`/`EVALUATING` and retries with backoff (score card shows `"Evaluating..."`); saving and submitting remain unaffected.
2. **`OfflineOrganizerBackend` (ADR-019 fallback when `runner_enabled = false`):**
   - Immediately transitions the submission to `NEEDS_REVIEW` and creates a `review_items` entry (`reason = 'offline_l3_eval'` or `'offline_l4_eval'`).
   - Organizer runs the artifact offline, records `(tests_passed, tests_total, variant_results, side_quest_passed)` via `POST /v1/admin/challenges/{id}/test-results` and docs rubric via the reviewer queue.
   - Both backends feed the exact same ledger-writing functions so scoring, dedupe, and leaderboard behavior are identical.

### 3.3 Ledger components

All scores remain append-only rows in `app.score_ledger_entries`:

| Level | Components Written | Config Keys (no hardcoded weights) |
|---|---|---|
| L1 & L2 | `evidence_report`, `code_review`, `functional_test` (if applicable), `ctf_bonus`, `penalty`, `adjustment` | `stage.config.max_points`, `event.config.scoring.weights`, `stage.config.penalty` |
| L3 | `functional_test`, `side_quest` (`[DECISION NEEDED: D-11]`), `code_review` (optional per `D-05`), `adjustment` | `stage.config.max_points`, `stage.config.scoring.weights`, `stage.config.side_quest` |
| L4 | `test_quality` (buggy-caught + fixed-pass), `docs_quality` (human rubric; optional capped AI per `D-04`), `adjustment` | `stage.config.max_points`, `stage.config.scoring.weights`, `stage.config.docs_ai` |

### 3.4 Team aggregation rules per level (`D-02`)

- **L1 & L2:** `claim_award_unit` enforces `UNIQUE (stage_id, team_id, award_unit_id)`, so each bug is awarded at most once per team per level. Team level score = `SUM(points)` for that `stage_id` (excluding `ctf_bonus` in `score / max_points`; including `ctf_bonus` and `penalty` in cumulative `points`).
- **L3 & L4 (best-scoring member submission):**
  - Every member's submission is evaluated independently and its component breakdown is recorded in `app.submission_scores` (audit/replay table).
  - The team's active ledger entries for `stage_id` represent **only the single best-scoring member submission** (`total_points` descending).
  - When a new member submission beats the current active best for `(stage_id, team_id)` (under a team-row `FOR UPDATE` lock), the scorer appends reversal entries (`reverses_entry_id`) for the previous best member's ledger rows and appends award entries for the new best member. `SUM(app.score_ledger_entries.points)` stays the single source of truth.
  - **Edge cases:**
    1. **Tied members:** Tie-break by earliest `submissions.received_at`, then `submissions.id` ascending; the earlier submission keeps the active award (no churn/reversal on tie).
    2. **Member with no upload:** Auto-submit or manual empty submit records `empty = true` (0 points). It does not overwrite or reduce a teammate's positive best score. If all members submit empty, team level score = 0.
    3. **Late auto-submit:** Uses the exact same evaluation path as manual submit; if an auto-submitted draft diff scores higher than an earlier teammate's manual submit, it replaces the team's best score via reversal + award.

---

## 4. Implementation Task List

Ordered so each task is independently mergeable and `main` stays working: ledger and aggregation tasks come first, then the evaluator interface, then the two runner backends, then L3/L4 evaluators and readiness gates.

| ID | Title | Files Touched | Depends On | Size | Status | Tests Required | Gating Checks |
|---|---|---|---|---|---|---|---|
| T-01 | Mask `rejected_auto`/`duplicate` before release + gate `/team/score` live points (INT-01) | `backend/app/routers/submissions.py`, `backend/app/routers/levels.py` | None | S | NOT STARTED | `test_gt_isolation.py` or `test_flow_submissions.py` pre-release masking test, including `/team/score` points gate | CHK-SEC-02 |
| T-02 | Add `?since=<version>` and `304 Not Modified` to leaderboard | `backend/app/routers/leaderboard.py` | None | S | NOT STARTED | `test_scoring.py` leaderboard `304` and version bump tests | CHK-RES-03 |
| T-03 | Expand schema: `evaluation_state`, `submission_flag_results`, `submission_scores`, `runner_evaluations` | `backend/migrations/0005_scoring_pipeline.sql`, `backend/app/models_app.py` | None | M | NOT STARTED | Migration idempotency & schema grant tests (`app_api`, `gt_admin`) | CHK-COR-01, CHK-RES-02 |
| T-04 | Crash-resumable L1/L2 evaluation + `matched_bug_code` + `release_feedback` for `level_report` | `backend/app/evaluator_level.py`, `backend/app/evaluator.py` | T-03 | M | NOT STARTED | Mid-run crash/retry test, L1/L2 `release_feedback` default & penalty tests | CHK-COR-01, CHK-COR-03, CHK-RES-02 |
| T-05 | Implement L3/L4 best-member team aggregation with reversal + tie-break | `backend/app/scoring.py`, `backend/app/routers/levels.py` | T-03 | M | NOT STARTED | Tied members, empty member, late auto-submit beating manual submit tests | CHK-COR-04, CHK-COR-05 |
| T-06 | Add negative flag tests & auto-submit vs manual ledger parity test | `backend/tests/test_flow_submissions.py`, `backend/tests/test_flow_auto_submit.py` | T-04 | S | NOT STARTED | Outside-repo file, out-of-range lines, L1/L2 auto vs manual ledger equality | CHK-COR-03, CHK-FLG-03 |
| T-07 | Pre-confirm `.diff`/`.patch` apply dry-run check against frozen base repo | `backend/app/storage.py`, `backend/app/routers/levels.py` | None | M | NOT STARTED | `test_flow_uploads.py`: clean diff passes, conflicting/malformed diff rejected pre-confirm | CHK-L34-01 |
| T-08 | Define `ArtifactEvaluator` interface and `OfflineOrganizerBackend` (ADR-019) | `backend/app/runner_gateway.py`, `backend/app/routers/admin.py`, `backend/app/evaluator.py`, `backend/app/evaluator_level.py` | T-03, T-05 | M | NOT STARTED | `record_test_results` for `level_artifact`, offline L3/L4 scoring + review flow tests | CHK-RES-01, CHK-COR-04 |
| T-09 | Implement `IsolatedRunnerBackend` + pinned A/B stack images (`D-03`) | `backend/app/runner_gateway.py`, `runner/` (new), `backend/app/config.py` | T-08, D-03 | L | BLOCKED | Runner down fallback (`Evaluating...`), hidden test isolation, symlink/traversal sandbox tests | CHK-L34-01, CHK-L34-02, CHK-RES-01 |
| T-10 | Implement L3 evaluator: hidden tests + `side_quest` ledger slot (`D-05`, `D-11`) | `backend/app/evaluator_level.py`, `backend/app/scoring.py` | T-08, D-05, D-11 | M | BLOCKED | L3 hidden test scoring, side-quest component, config-driven `max_points` tests | CHK-L34-02, CHK-L34-03 |
| T-11 | Implement L4 evaluator: buggy vs fixed variant tests + docs rubric / optional AI (`D-04`, `D-05`) | `backend/app/evaluator_level.py`, `backend/app/scoring.py` | T-08, D-04, D-05 | L | BLOCKED | Buggy-fail/fixed-pass test matrix, docs rubric, prompt-injection tests if AI enabled | CHK-L34-02, CHK-SEC-03 |
| T-12 | Add A/B fairness `READY` checklist gate & independent solver sign-off (`D-10`) | `backend/seed.py`, `backend/app/routers/admin.py`, `docs/ONE_SHOT_ACCEPTANCE_CRITERIA.md` | T-10, T-11, D-10 | M | BLOCKED | `READY` gate blocks without A/B equivalence check; Option A vs B score parity test | CHK-L34-03 |

---

## 5. Check Matrix

Maps acceptance scenarios 1-15 of `Bug_Hunt_CTF_Participant_Website_Spec.md` §8 and every pipeline check from Section 4 of the initial plan to an implementation task or existing module. Spec §8 has 16 items: scenario 16 (min-width message and keyboard-only controls) is UI accessibility scope and is out of scope for this pipeline plan (see Section 7). S8-xx IDs are keyed to the spec §8 item numbers.

### 5.1 Spec §8 Acceptance Scenarios (1-15)

| Scenario | Description | Mapped Task / Existing | Status | Notes |
|---|---|---|---|---|
| S8-01 | Non-lead cannot lock repo, even via direct API | Existing (`levels.py::repo_lock`) | DONE | Covered by `test_flow_repo_lock.py` (runtime `UNVERIFIED` locally). |
| S8-02 | Two lead clicks at once produce one lock; second returns existing | Existing (`levels.py::repo_lock`) | DONE | `UNIQUE(team_id)` + `Idempotency-Key`. |
| S8-03 | 7s modal cooldown; server rejects lock outside allowed window | Existing (frontend + `levels.py`) | DONE | Server checks stage status/window on lock. |
| S8-04 | Dashboard round-trip restores files, split layout, selection, drafts | Existing (frontend + `level_drafts`) | DONE | Frontend IndexedDB + `GET/PUT /v1/levels/{n}/draft`. |
| S8-05 | Closing browser and reopening restores from server draft | Existing (`level_drafts`) | DONE | Verified in `levels.py` draft endpoints. |
| S8-06 | Local L1 data deleted only after server ack (`202`) | Existing (frontend) | DONE | Frontend persistence rule; no backend task needed. |
| S8-07 | After L1 submit, typing L1 URL redirects forward; Dashboard opens | Existing (frontend + `flow.py`) | DONE | Server enforces pointer monotonicity. |
| S8-08 | Warnings at 5/3/1m; server auto-submits at 0 even if browser closed | Existing (`auto_submit.py`) + T-06 | PARTIAL | Auto-submit implemented; T-06 adds ledger parity assertion. |
| S8-09 | Start button disabled with teammate names; enables after last submit | Existing (`levels.py::level_gate`) | DONE | `GET /v1/levels/{n}/gate` returns `waiting_on[]`. |
| S8-10 | L2 flag with 3 locations submits and is stored in order | Existing (`levels.py`, `matching.py`) | DONE | `decide_multi()` + ordered `locations` JSONB. |
| S8-11 | Zip with `../` or symlinks rejected; nothing extracts outside sandbox | Existing (`storage.py`) + T-09 | PARTIAL | Upload-time ZIP inspection DONE; runner-side extraction gated by T-09. |
| S8-12 | Diff that doesn't apply gives clear error before participant confirms | T-07 | NOT STARTED | Missing pre-confirm dry-run check. |
| S8-13 | When runner is off, output panel says so; saving and submitting still work | Existing (`levels.py`) + T-08 | PARTIAL | `503 RUNNER_UNAVAILABLE` + submit works; T-08 wires offline eval. |
| S8-14 | Retrying submit after lost response returns original receipt | Existing (`levels.py`) | DONE | `Idempotency-Key` replay returns original receipt. |
| S8-15 | Score and leaderboard update within polling interval after eval finishes | T-02, T-04, T-05 | PARTIAL | Snapshot refresh exists; T-02 adds `?since=` / `304`. |

### 5.2 Pipeline Checks

| Check ID | Description | Mapped Task | Status |
|---|---|---|---|
| CHK-COR-01 | Same submission scored twice gives identical ledger result (determinism) | T-03, T-04 | NOT STARTED |
| CHK-COR-02 | Retried submit with same `Idempotency-Key` returns original receipt, 0 new ledger rows | Existing (`levels.py`) | DONE |
| CHK-COR-03 | Auto-submit and manual submit produce identical ledger entries | T-04, T-06 | NOT STARTED |
| CHK-COR-04 | Team total equals sum of member components after dedupe / best-member rule (`D-02`) | T-04, T-05, T-08 | NOT STARTED |
| CHK-COR-05 | Ledger is append-only; corrections are new reversing rows, never edits | Existing (`0002` trigger) + T-05 (reversal logic) | PARTIAL |
| CHK-FLG-01 | Exact line, overlapping range, off-by-N (within/outside tolerance) | Existing (`matching.py`) | DONE |
| CHK-FLG-02 | Wrong file routes to `needs_review` (never auto-penalized) | Existing (`matching.py`) | DONE |
| CHK-FLG-03 | File outside repo and range outside file rejected at submit | Existing (`levels.py`) + T-06 | PARTIAL |
| CHK-FLG-04 | Duplicate flag (already claimed by team) pays 0, no penalty | Existing (`evaluator_level.py`) | DONE |
| CHK-FLG-05 | L2 flag with 3 locations preserves order and scores via `decide_multi()` | Existing (`matching.py`) | DONE |
| CHK-L34-01 | Diff fail reported before confirm; zip `../`/symlinks rejected and sandboxed | T-07, T-09 | NOT STARTED |
| CHK-L34-02 | Hidden tests never exposed in participant bundle or run output | T-09, T-10, T-11 | BLOCKED |
| CHK-L34-03 | Option A and Option B produce comparable scores on equivalent solutions | T-10, T-12 | BLOCKED |
| CHK-SEC-01 | No answer-key or evaluator data reachable from participant endpoints | Existing (`db.py` `app_api`) | DONE |
| CHK-SEC-02 | Per-flag correctness hidden from participants before release (INT-01) | T-01 | NOT STARTED |
| CHK-SEC-03 | Explanation text never rendered as HTML; AI text treated as untrusted (prompt-injection) | Existing (FE) + T-11 | PARTIAL / BLOCKED |
| CHK-RES-01 | Runner off: save and submit still work, score shows `"Evaluating..."` | Existing (`levels.py`) + T-08, T-09 | PARTIAL |
| CHK-RES-02 | Evaluator crash mid-run resumes without double-scoring | T-03, T-04 | NOT STARTED |
| CHK-RES-03 | Leaderboard refreshes within one polling interval; `304` when unchanged | T-02 | NOT STARTED |

Flagged gap: No check in Section 5 is left without a task or existing implementation mapping.

---

## 6. Open Questions (Most Blocking First)

1. **[D-05] Per-level `max_points` and component weights (Blocks: T-10, T-11, score finalization):** Owner must supply `stage.config.max_points` for L1, L2, L3, L4, and component weights per level (e.g., whether L1/L2 use `evidence_report` + `code_review` only, L3 split between `functional_test` and `side_quest`, L4 split between `test_quality` and `docs_quality`).
2. **[D-11] Level 3 side-quest definition (Blocks: T-10):** Owner must define the side quest for both Option A and Option B, its `side_quest.max_points`, and whether it is verified by automated hidden tests or human review.
3. **[D-03 / ADR-010] Runner provisioning & per-stack commands (Blocks: T-09):** Will an isolated runner VM be provisioned before event day, or will L3/L4 run solely on `OfflineOrganizerBackend` (ADR-019)? If provisioned, confirm exact build/lint/test commands and `runner.timeout_s` per stack.
4. **[D-04] Level 4 docs assessment mode (Blocks: T-11):** Confirm human rubric only (DEC-13 default) vs. optional capped AI assessment (which requires provider approval and prompt-injection test cases).
5. **[D-10] Independent A/B equivalence sign-off (Blocks: T-12, `READY` gate):** Assign two independent solvers to certify equal bug count, severity distribution, and hidden test parity between Option A and Option B.
6. **[D-02] Confirmation of assumed dedupe & best-member rules (Blocks: T-05 confirmation):** Confirm L1 and L2 separate per-level bug dedupe and L3/L4 best-scoring member selection.

---

## 7. Out of Scope for This Plan

- Implementing any source code, migrations, runner scripts, or frontend components (PLAN ONLY).
- Production challenge authoring (actual Option A / Option B bugs, hidden test suites, worked examples).
- Production event schedule values (`D-12`), invite/email delivery, and D1 infrastructure provisioning (Cloudflare Tunnel, OCI VM setup).
- Real-time SSE/WebSocket push for leaderboard or score updates (D1 uses polling with `304`).
- Multi-domain / multi-region D2 deployment.
- Spec §8 scenario 16 (min-width message and keyboard-only controls on execution pages): UI accessibility scope, outside the scoring and evaluation pipeline.
