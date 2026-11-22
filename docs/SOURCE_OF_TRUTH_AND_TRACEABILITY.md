# Source of truth and traceability

Status: CURRENT as of the v1 one-shot build. Reflects code in this repo; verified claims carry pointers, pending claims are marked UNRUN or PENDING.

## 1. Which source governs what

Precedence is top-down. A conflict between two sources is resolved in favour of the higher one, and the resolution is recorded in the reconciliation decisions below and in `AUTONOMOUS_DECISION_LOG.md`.

| Rank | Source | Governs |
| --- | --- | --- |
| 1 | Master prompt (build directive for this one-shot) | Scope of the build, kill switches, what is optional (AI, runner), what must be honest (UNRUN items) |
| 2 | Locked proposal PDF (Fall Back, 6 Dec 2026, offline, teams of 4-5, 180 min) | Event facts: date, duration, on-site format, team sizes, product-owner intent for scoring |
| 3 | Architecture (SYSTEM_ARCHITECTURE, DATA_MODEL, SECURITY_ARCHITECTURE) | Trust split, schemas, queue, auth mechanics |
| 4 | Specification set (PRODUCT_SPEC_WEBSECTIONS, API_REFERENCE, SCORING_MODEL, COMPETITION_RULES) | Behavioural detail, endpoints, formulas |
| 5 | Blind-spots review and ADRs (this doc + AUTONOMOUS_DECISION_LOG) | Deviations and their rationale |
| 6 | D1 deployment guide (DEPLOYMENT_RUNBOOK, RELEASE_PLAN_D1) | Operational steps for the free VM |

Code wins documentation only where a doc is marked outdated; otherwise a code-vs-doc mismatch is a bug to file. `AGENTS.md` engineering invariants bind any future contributor.

## 2. Reconciliation decisions taken in this build

1. Score model: the proposal's product owner wanted functional tests plus a configurable code-review weight plus an evidence report; earlier drafts used fixed 0.5/0.3/0.2. Resolution: components are functional_test 0.5 / code_review 0.3 / evidence_report 0.2 as the frozen default config, with the review weight configurable in event config (see SCORING_MODEL.md, ADR-006).
2. Event shape: the written spec sketched a two-round event; the proposal defines one 180-minute staged event. Resolution: single-stage with phases, schedule 15/10/30/35/60/25/5, per the proposal (ADR log entry on event shape, seed preset "Fall Back").
3. Runner: the spec assumed in-browser code execution. No isolated runner VM exists in this environment. Resolution: `runner_enabled=False` by default (ADR-010), organizer-recorded offline functional tests instead.
4. AI scoring: optional in the master prompt, off until an approved provider is verified. Resolution: `ai_assessment_enabled=False` with a provider gate (ADR-013, AI_TOOLING_RESEARCH_AND_DECISION.md).
5. Teams required: participant records live under a team per the proposal; solo participation is not modelled in v1.
6. Capacity discrepancy: proposal text said 50 participants in one place and 50 teams in another. Resolution: 10 teams x 5 = 50 participants in seed; formal capacity stays provisional pending the load test (ADR-011).
7. Monaco editor: dropped. It needed an npm editor bundle and did not meet the accessibility and offline-simplicity bar; replaced by a custom accessible code viewer (plain textarea/read-only pre with line numbers, keyboard friendly, ADR-020 rationale and FRONTEND_DESIGN_DIRECTION.md).
8. Migrations: Alembic was considered; plain ordered SQL files under `backend/migrations/` applied by `scripts/migrate.sh` were chosen (ADR-018). Migration state is tracked in `app.schema_migrations`.

## 3. Requirement traceability table

Major capability area, where it is implemented, and where it is verified.

| Area | Implementation (real paths) | Verification |
| --- | --- | --- |
| Auth (Argon2id, JWT HS256 10 min access, refresh rotation + reuse detection) | `backend/app/security.py`, `backend/app/routers/auth.py`, `backend/app/deps.py` | `backend/tests/test_auth.py`; refresh-family grace window test in same file |
| RBAC and account state | `backend/app/deps.py`, `backend/app/routers/admin.py` | `backend/tests/test_authorization.py` |
| Submissions (idempotency, stage-row lock, caps, cooldown) | `backend/app/routers/submissions.py` | `backend/tests/test_idempotency.py`, `backend/tests/test_scoring.py` |
| Deterministic matching engine | `backend/app/matching.py`, `backend/app/evaluator.py` | `backend/tests/test_matching.py` |
| Scoring ledger (append-only, components 0.5/0.3/0.2, CTF cap 100) | `backend/app/scoring.py`, `backend/app/evaluator.py` | `backend/tests/test_scoring.py` |
| Flags (HMAC receipt codes, capped bonus) | `backend/app/evaluator.py` (verify_flag), `backend/app/security.py` | `backend/tests/test_scoring.py` flag cases; E2E journey flag checks |
| Ground truth isolation (three schemas, real DB roles) | `backend/app/db.py`, `backend/app/models_gt.py`, migration `backend/migrations/0001_init.sql` | `backend/tests/test_gt_isolation.py` (real psycopg connections as app_api/gt_admin) |
| Review loop (review items, outcomes, dispute) | `backend/app/routers/review.py`, `backend/app/evaluator.py` (apply_review_outcome) | `backend/tests/test_scoring.py`; E2E reviewer loop |
| Job queue (SKIP LOCKED + leases) | `backend/app/jobs.py`, worker in `backend/app/main.py` entry | `backend/tests/test_idempotency.py` replay cases; E2E |
| Admin lifecycle (stages sealed->armed->started, release, exports) | `backend/app/routers/admin.py`, `backend/app/routers/announcements.py` | `scripts/e2e_journey.py` organizer lifecycle checks |
| Audit chain (append-only, per event, verify endpoint) | `backend/app/audit.py`, verify route in `backend/app/routers/admin.py` | E2E audit verify check; unit coverage in test_scoring/test_auth |
| Frontend (React 19 + Vite + TS + Tailwind 4) | `frontend/src/` pages under `pages/participant`, `pages/admin`, `pages/review`, lib in `frontend/src/lib/` | `npm run build` clean; E2E journey drives the UI paths |
| Seed preset (Fall Back) | `backend/seed.py` | E2E journey resets seed; `scripts/dev_db.sh` |
| E2E journey (46 checks) | `scripts/e2e_journey.py` | Reported passing in the one-shot run; re-run locally to confirm |
| Load test (UNRUN at cap) | `scripts/load_test.py` | `LOAD_TEST_REPORT.md`, all result cells UNRUN |

## 4. Documentation set

27+ docs exist under `docs/`. The ones authored by other workstreams (SYSTEM_ARCHITECTURE, API_REFERENCE, DATA_MODEL, SECURITY_ARCHITECTURE, GROUND_TRUTH_ISOLATION, PERFORMANCE_AND_CAPACITY, DEPLOYMENT_RUNBOOK, BACKUP_AND_RECOVERY, TESTING_STRATEGY, CI_CD_PIPELINE, PRODUCT_SPEC_WEBSECTIONS, EVENT_OPERATIONS_PLAYBOOK, CHALLENGE_DESIGN_AND_GROUND_TRUTH, SCORING_MODEL, COMPETITION_RULES, PARTICIPANT_HANDBOOK, REVIEWER_HANDBOOK, PRIVACY_NOTICE, TERMS_OF_USE, FRONTEND_DESIGN_DIRECTION, AI_TOOLING_RESEARCH_AND_DECISION) are cross-referenced, not rewritten here. The eight build-truth docs (this file, AUTONOMOUS_DECISION_LOG, ONE_SHOT_ACCEPTANCE_CRITERIA, KNOWNS_LIMITATIONS_AND_FOLLOWUPS, RELEASE_PLAN_D1, ONBOARDING_GUIDE, SECURITY_REVIEW, LOAD_TEST_REPORT) are the closing record of the one-shot build.

## 5. Keeping this document honest

Any future deviation from a locked source adds an ADR entry and a line in section 2 in the same change. Pointers in this file must resolve at HEAD.

Rules:

- No traceability row may point at a file that does not exist; fix the pointer, never delete the row to hide a gap.
- A UNRUN or PENDING marker that executes gets its evidence pointer on the same change that closes it.
- Renamed tests or scripts require updating every pointer that referenced them, checked by grep across docs/.
- New capability areas land in the traceability table before they land in event-facing documents.
