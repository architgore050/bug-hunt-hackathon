Status: describes the implementation as of 2026-11-22

# Testing Strategy

The pyramid as actually implemented:

- A pytest integration-heavy suite against real PostgreSQL (34 tests).
- Pure-function unit tests for the deterministic matcher and scoring math.
- One end-to-end journey script against a running stack (46 checks).
- Frontend type-check + build + lint with a manual browser matrix.
- The gt-isolation tests that assert the database boundary itself.

CI wiring is specified in `CI_CD_PIPELINE.md` (the workflow file is not committed yet).

## 1. Backend pytest suite (34 tests)

Layout: `backend/tests/`, driven by `pytest.ini` (`testpaths = tests`, 120 s timeout).

`conftest.py` behavior:

- Sets `DATABASE_URL_APP/GT` to the isolated `bughunt_test` database BEFORE importing the app.
- Creates and migrates that database once per session via `dev_db.sh` + `migrate.sh`.
- Reseeds before every test (order independence).
- Clears the in-process rate-limit bucket between tests.
- Serves the app through Starlette's `TestClient` (no sockets).
- `worker_drain()` runs pending jobs synchronously so evaluation paths are tested without the worker process.

Per-file coverage:

| File | Tests | What it proves |
| --- | --- | --- |
| `test_auth.py` (4) | Wrong password -> generic 401 (ATH-01). Password reset bumps token_version and revokes sessions + refresh families (ATH-03). Admin routes demand step-up within 5 min (AUTH-09). Refresh rotation returns the same successor inside the 10 s grace and revokes the family outside it (AUTH-04) |
| `test_authorization.py` (7) | Cross-team submission read -> 404 (SEC-02 IDOR). Participants blocked from admin endpoints. Reviewers blocked from event creation. Forged `challenge_id` in the body is ignored (server resolves the assignment). Unauthenticated 401. Path traversal -> 400 `PATH_INVALID` (SEC-03). Script text in report payload stored and returned as inert text (EVA-05) |
| `test_gt_isolation.py` (5) | Real `app_api` role denied on `gt.gt_bugs` / `gt.gt_flags` / gt INSERT. `gt_admin` positive control. The platform never lists or serves `ORGANIZER_ANSWER_KEY.md` (DAT-03, AT-08) |
| `test_idempotency.py` (4) | Same key five times -> one receipt (DAT-02). Same key different payload -> 409 `IDEMPOTENCY_CONFLICT`. Committed-key replay returns the ORIGINAL receipt even after the deadline. Cooldown races on the same file rejected with 429 (INT-05) |
| `test_matching.py` (8) | Deterministic matcher units: exact overlap auto-accept; near location plus alias evidence accepts; wrong file needs review; thin unmatched report structurally rejected; span over cap rejected; already-awarded unit -> duplicate; `location_score` bounds; weighted alias fraction |
| `test_scoring.py` (5) | Weight split math. Ledger append-only convention. `award_claims` unique constraint blocks double award (DAT-01). CTF bonus capped at `ctf_bonus_cap_points`. Leaderboard tie-break order (total, fewer invalid, earlier last accepted, INT-12). Hidden feedback mode reveals nothing before release (INT-01) |

Run:

```bash
bash scripts/dev_db.sh     # once; conftest creates bughunt_test itself
cd backend && python -m pytest -v
```

Verified result: 34/34 passing.

## 2. Deterministic matcher tests

`test_matching.py` pins the decision table that scoring depends on:

- Candidate selection is same-file within +-10 lines.
- Auto-accept full requires L >= 0.9 AND C >= 0.6 AND A >= 0.2.
- Auto-accept partial requires L >= 0.9 AND C = 0 (routed to review confirmation).
- Structural rejections run first (span over cap, missing file, thin unmatched).

Because `matching.decide` is a pure function of (report, candidates, rule set, claimed units), these tests replay deterministically.

- Any rule change must update them.
- Recorded feature values in ledger notes keep real decisions replayable (DAT-05).

## 3. E2E journey (`scripts/e2e_journey.py`, 46 checks)

Runs against a live stack (`bash scripts/run_dev.sh` first; API on 8100, worker draining). One participant-team-organizer-reviewer journey exercising the P0 paths:

- Health probes real (both databases up).
- Organizer lifecycle: event ready (readiness gate) -> live; stage seal -> arm -> start.
- Participant login, team, rules acceptance, round state, server time.
- Assignment visible with >= 11 files, instructions present, file content readable.
- Path traversal -> 400; `ORGANIZER_ANSWER_KEY.md` -> 404.
- Submission 202 with receipt; idempotent retry returns the same submission.
- Same key different payload -> 409; file cooldown -> 429 `SUBMISSION_COOLDOWN`.
- Second file accepted; IDOR 404.
- Evaluation pipeline runs (worker); participant sees only `received` before release (verdict oracle, INT-01).
- Reviewer queue -> claim -> auditable decision.
- Organizer step-up then records functional test results (ADR-019 path).
- CTF flags: wrong flag accepted but later rejected; correct flag verified as `ctf_bonus` after release; status hidden until release.
- End -> evaluate -> release; participant results with component breakdown and positive total.
- Leaderboard visible after release; audit chain intact; CSV export.
- Dispute filed, seen, resolved.

Run:

```bash
bash scripts/run_dev.sh && python scripts/e2e_journey.py   # pass --base for a remote stack
```

- Exit code 0 required; prints `46/46 checks passed` when green.
- Note: the "reviewer records auditable decision" check and its "auto-matched" fallback are mutually exclusive by branch, so the total executed is 46 either way.

## 4. Frontend verification

Automated:

- `npm run build` (runs `tsc -b && vite build`, clean today).
- `npm run lint` (oxlint, config in `.oxlintrc.json`).
- No component/E2E test framework is wired for the frontend yet (honest limitation); query behavior is exercised indirectly by the backend e2e.

Safety greps that must stay clean:

- No `dangerouslySetInnerHTML` anywhere in `frontend/src`.
- Participant content only through `PlainMarkdown` (EVA-05).

Manual matrix (pre-event):

- Chromium and Firefox, latest two versions each (FE-05).
- Login/refresh across page reload; rules gate.
- Workspace draft autosave + version-conflict recovery (FE-01).
- Submission with Idempotency-Key; cooldown messaging.
- Results/leaderboard after release.
- Reviewer queue on a small viewport.
- Keyboard operability and contrast per the WCAG 2.2 AA target (HUM-03).
- IST (Asia/Kolkata) time rendering everywhere.
- 375 px width without horizontal overflow.

## 5. Ground-truth isolation tests

Both verification layers are described in `GROUND_TRUTH_ISOLATION.md`:

- The psycopg role tests inside pytest (real `app_api` denial, positive gt_admin control).
- The answer-key-not-served assertion in the e2e journey.

Re-run the role tests against PRODUCTION after any database grant change; this is the `gt_isolation` readiness item.

## 6. CI wiring

See `CI_CD_PIPELINE.md`. Contract:

- Backend job runs the pytest suite against a PostgreSQL 17 service container (conftest is already service-compatible: it calls `dev_db.sh`/`migrate.sh`, which need `psql` on PATH and `PGPORT=5433`).
- Frontend job runs `npm ci`, `npm run lint`, `npm run build`.
- The first real CI run must be verified on GitHub after push and the green run recorded as readiness evidence (OPS-02: never let the live event be the first full run).

## 7. Pre-event test gate list

All of these must be green before the event goes live. They map to the seeded `app.readiness_items`, which mechanically block the live transition while unchecked:

1. `load_test_50`: 50-user full-path load test passes the D1 thresholds (PERFORMANCE_AND_CAPACITY.md; report in `docs/LOAD_TEST_REPORT.md`, currently UNRUN).
2. `gt_isolation`: role tests + answer-key check green against the production database.
3. `backup_restore`: dump + restore rehearsal completed with measured RPO/RTO recorded in BACKUP_AND_RECOVERY.md Section 5 (currently UNRUN).
4. `pen_test`: security review completed; high/critical closed (SECURITY_ARCHITECTURE.md Section 11 lists what is not yet covered).
5. `challenge_audit`: two independent reviewers certified the challenge for unplanned defects (INT-02 pre-flight).
6. `dry_run`: full dry run with real users on the venue network (OPS-02).
7. `rules_published`: rules, privacy notice and consent flows published and frozen.
8. `runbooks`: event-day runbook rehearsed; roles assigned.

Per-suite gates for every code change:

- pytest 34/34.
- e2e journey 46/46.
- frontend build clean.
- oxlint clean.
