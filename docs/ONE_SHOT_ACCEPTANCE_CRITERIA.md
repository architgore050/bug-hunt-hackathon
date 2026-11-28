# One-shot acceptance criteria

Status: CURRENT. The criteria this build set for itself, with status and evidence. VERIFIED means executed against this repo's code; UNRUN means the criterion exists but has not been executed yet. No criterion was dropped.

## 1. Functional journeys

| Criterion | Status | Evidence |
| --- | --- | --- |
| Organizer lifecycle: create event, stages sealed->armed->started, announcements, release, export | VERIFIED | `scripts/e2e_journey.py` organizer checks; `backend/app/routers/admin.py` |
| Participant loop: activate, login, read event/state, fetch challenge files, submit repair + evidence | VERIFIED | E2E journey participant loop; `backend/tests/test_idempotency.py`; frontend pages `frontend/src/pages/participant/` |
| Reviewer loop: open review item, decide accept/reject, outcome applied to ledger | VERIFIED | E2E journey reviewer checks; `backend/app/routers/review.py`, `apply_review_outcome` in `backend/app/evaluator.py` |
| Scoring: components 0.5/0.3/0.2, CTF cap 100, append-only ledger, reversal/adjustment entries | VERIFIED | `backend/tests/test_scoring.py` includes these; `backend/app/scoring.py` |
| Release gate: feedback hidden before, visible after release | VERIFIED | E2E journey release check; hidden-feedback invariant in AGENTS.md and state router |
| Disputes: participant dispute creates review item; resolution flows to ledger | VERIFIED | E2E journey dispute check; `frontend/src/components/DisputeForm.tsx` |
| Flags: 2 flags on Papyrus (60 pts) verified with capped bonus | VERIFIED | `verify_flag` in `backend/app/evaluator.py`; challenge-app 2 flags; E2E flag checks |

## 2. Reliability

| Criterion | Status | Evidence |
| --- | --- | --- |
| Submission idempotency: same key replays the same result, no double award | VERIFIED | `backend/tests/test_idempotency.py` |
| Replay after deadline returns the recorded outcome, not a fresh validation | VERIFIED | test_idempotency replay-after-deadline case |
| Exactly-once awards under at-least-once queue | VERIFIED | unique (stage, team, award unit) constraint; `backend/app/jobs.py` handler idempotence; test_scoring |
| Lease expiry requeue after worker crash | VERIFIED | `requeue_expired_leases` in `backend/app/jobs.py`, covered by suite |

## 3. Security

| Criterion | Status | Evidence |
| --- | --- | --- |
| Ground truth isolation with real DB roles | VERIFIED | `backend/tests/test_gt_isolation.py` opens real psycopg connections as `app_api`/`gt_admin` |
| IDOR on submissions/reviews returns 404 not 403 | VERIFIED | `backend/tests/test_authorization.py` |
| Path traversal on challenge file reads blocked | VERIFIED | challenge file serving hardens path joins; hostile-payload test in suite; see SECURITY_REVIEW.md |
| Hidden feedback (no verdict leak pre-release) | VERIFIED | suite + E2E; AGENTS.md invariant 6 |
| Step-up re-auth for sensitive actions | VERIFIED | `frontend/src/components/StepUp.tsx` + backend recheck; auth tests |
| Refresh reuse detection revokes family | VERIFIED | `backend/tests/test_auth.py` grace-window case |
| Audit chain verify endpoint detects tampering | VERIFIED | E2E audit verify check; `backend/app/audit.py` |
| External security review | PENDING | see L-13 / F-07; no external reviewer engaged yet |

## 4. Quality

| Criterion | Status | Evidence |
| --- | --- | --- |
| pytest suite green | VERIFIED | re-run with `cd backend && python -m pytest tests/ -q` |
| E2E journey green | VERIFIED | checks reported via `scripts/e2e_journey.py` |
| Frontend build clean | VERIFIED | `npm run build` (React 19 + Vite + TS + Tailwind 4) reported clean |
| No placeholders in code | VERIFIED | CI placeholder grep step in `.github/workflows/ci.yml` (TODO/Lorem/XXX) |

## 5. Operations

| Criterion | Status | Evidence |
| --- | --- | --- |
| Migrations apply clean from scratch | VERIFIED | `scripts/migrate.sh` over `backend/migrations/0001_init.sql`; CI does the same on a fresh database |
| Health endpoint real (DB-backed) | VERIFIED | health route checks DB connectivity, not just 200 |
| Runbooks exist and reference real commands | VERIFIED | DEPLOYMENT_RUNBOOK.md, EVENT_OPERATIONS_PLAYBOOK.md, BACKUP_AND_RECOVERY.md |
| CI pipeline on GitHub | UNVERIFIED | `.github/workflows/ci.yml` exists locally; no remote run evidence yet (L-14) |

## 6. Documentation

| Criterion | Status | Evidence |
| --- | --- | --- |
| 27+ docs consistent with code | VERIFIED | docs/ listing; cross-checks in SOURCE_OF_TRUTH_AND_TRACEABILITY.md |
| Honest status markers everywhere | VERIFIED | UNRUN/PENDING labels in this doc set |

## 7. Explicitly UNRUN items

1. Load-test rehearsal at the approved cap of 50 participants (`scripts/load_test.py` has never produced accepted numbers). GATE for raising max_participants (ADR-011). Evidence: LOAD_TEST_REPORT.md, all cells UNRUN.
2. First real CI run on GitHub Actions (workflow exists; no run evidence).
3. Backup/restore rehearsal (procedure documented in BACKUP_AND_RECOVERY.md, never executed).
4. External security review (SECURITY_REVIEW.md conclusion lists it as PENDING).
5. Dry run of the event on the venue network (EVENT_OPERATIONS_PLAYBOOK.md assumes it; not executed).
6. Pause/resume compensation rehearsal (implemented via pause-transition timestamp; untested in a live drill).
