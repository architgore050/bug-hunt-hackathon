Status: plan for the four-level event flow work; updated as slices land

# Implementation Plan: four-level event flow

Vertical slices over the existing FastAPI backend. The lead (this branch)
owns contracts, migration ordering and integration; every slice ends with the
full pytest suite green and a granular commit.

## Contract freeze

- Old surface: unchanged. `/v1/state`, `/v1/submissions`, `/v1/assignments`,
  `/v1/drafts/{challenge_id}`, admin endpoints, auth, review, leaderboard,
  announcements keep their contracts (the running frontend concept PRs and the
  75-test suite depend on them).
- New surface (participant):
  `GET /v1/levels`, `GET /v1/levels/{n}/content`, `GET /v1/levels/{n}/gate`,
  `GET/PUT /v1/levels/{n}/draft`, `POST /v1/levels/{n}/submit`,
  `GET /v1/progress`, `GET /v1/team`, `GET /v1/team/score`,
  `POST /v1/team/repo-lock`, `GET /v1/repo/tree`, `GET /v1/repo/files/{path}`,
  `POST /v1/uploads`, `POST /v1/runs` (disabled), `GET /v1/runs/{id}`
  (disabled).
- New surface (admin): `POST /v1/admin/teams/{team_id}/repo-lock`,
  `GET /v1/admin/events/{event_id}/progress`,
  `POST /v1/admin/jobs/auto-submit` (manual trigger),
  `POST /v1/admin/events/{event_id}/repo-options`.
- Error codes added: `REPO_ALREADY_LOCKED`, `LEVEL_NOT_OPEN`,
  `TEAM_GATE_BLOCKED`, `REPO_NOT_LOCKED`, `LEVEL_ALREADY_SUBMITTED`,
  `ARTIFACT_INVALID`, `ARTIFACT_REQUIRED`, `RUNNER_UNAVAILABLE` (exists),
  `LOCATION_INVALID`. All follow the existing envelope in
  `app/errors.py`.

## Slices

| # | Slice | Files | Status |
| --- | --- | --- | --- |
| 1 | Baseline: portable Postgres cluster and suite green on rewritten history (original plan inventory: 37 tests) | - | done |
| 2 | Migration 0003: repo_options, team_repo_choices, participant_pointers, participant_progress, level_drafts, submission_artifacts | backend/migrations/0003_four_level_flow.sql | done |
| 3 | Domain module: node state machine, gate computation, pointer transitions | backend/app/flow.py | done |
| 4 | Participant routers: levels, repo, team, progress, uploads, runs | backend/app/routers/levels.py | done |
| 5 | Auto-submit job (scheduler-driven, idempotent) | backend/app/auto_submit.py | done |
| 6 | Evaluation for level submissions (flag lists, multi-location matching) | backend/app/evaluator_level.py, matching.py | done |
| 7 | Artifact storage adapter (local D0, object-storage-ready) | backend/app/storage.py | done |
| 8 | Admin additions: lock override, progress matrix, auto-submit trigger, repo options | backend/app/routers/admin_levels.py | done |
| 9 | Option B dev fixture (Marina, FastAPI + SQLite) with equivalent GT manifest | challenge-app-option-b/, backend/seed.py | done |
| 10 | Seed: four level stages, both repo options, synthetic schedule, pointers | backend/seed.py | done |
| 11 | Tests: gates, repo-lock (non-lead, concurrency, idempotency), no-backtrack, multi-location, uploads safety, auto-submit, deadline race | backend/tests/test_flow_*.py | done |
| 12 | Docs: EVENT_FLOW, REQUIREMENTS_RECONCILIATION, KNOWN_GAPS, HISTORY_REWRITE_REPORT, DATA_MODEL and API_REFERENCE updates | docs/ | done |
| 13 | E2E journey extension for the four-level loop | scripts/e2e_journey.py | follow-up (documented) |
| 14 | Frontend adaptation of the owner-selected concept PR | concept branches | owner decision (blocked) |

Current inventory note: the suite at current HEAD contains 75 tests (36 v1 plus 39 four-level flow). That count is separate from the historical baseline count above.

## Verification gates for this branch

1. `cd backend && pytest` fully green (75 tests: 36 v1 + 39 four-level flow).
2. `ruff check` and `ruff format --check` clean on touched files.
3. Fresh-clone run: dev_db.sh, migrate.sh, seed.py, uvicorn, worker, then the
   documented walkthrough (LOCAL_DEVELOPMENT update).
4. No secrets, no gt leakage in any new participant path (gt isolation test
   extended to the new tables).
