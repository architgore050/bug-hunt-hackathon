# Bug Hunt CTF review policy

Status: active repository review policy as of 2026-11-27.

Read this before any specialist lens. `AGENTS.md` is the binding repository instruction. Use the linked docs to understand the implemented contract; if code and docs disagree, report the conflict instead of silently choosing one.

## Product and event facts

- The product is **Bug Hunt CTF**. The event is **Fall Back**, run by the Software Development Club at VIT Bhopal University.
- The submitted proposal PDF is immutable. Official preset: 6 December 2026, 180 minutes, offline, teams of 4 to 5. `backend/seed.py` mirrors it.
- Do not introduce out-of-scope product names into routes, UI, data, copy, or documentation.
- Demo credentials in `backend/seed.py` are development-only. A real event requires replacement credentials and an environment-provided `JWT_SECRET`.

## Non-negotiable engineering invariants

| Area | Review rule |
|---|---|
| Authority | The server owns time, state, eligibility, deadlines, verdicts, and scores. Client input never decides them. Identity comes from the token, never the request body. |
| Ground truth | Participant-facing paths must never access the `gt` schema. PostgreSQL's `app_api` role enforces the boundary; `backend/tests/test_gt_isolation.py` tests it. |
| Restricted key | `challenge-app/ORGANIZER_ANSWER_KEY.md` is restricted. Never serve it to participants, return it through an API, or include it in a frontend bundle. Do not open it during an ordinary code review. |
| Score ledger | Ledger rows are append-only. Corrections are linked reversal or adjustment entries, never updates or deletes. |
| Award claims | Uniqueness per stage, team, and award unit is enforced in the database. Handlers remain idempotent under at-least-once queue delivery. |
| Submission transaction | Reserve the idempotency key first, lock the stage row, read `clock_timestamp()` once, then validate in order: paused, not active, ended, caps, cooldown, schema. Commit the operation in one transaction. |
| Feedback | Verdicts, matched bug codes, and points stay hidden until `feedback_released`. Check every participant-visible response, event, log surfaced to clients, and realtime/polling path. |
| Errors | Use the envelope and stable catalog codes in `backend/app/errors.py`. Never return stack traces or account-existence signals. |
| Migrations | Ordered SQL files in `backend/migrations/`, applied by `scripts/migrate.sh`, forward-only, expand/contract. No destructive change without a forward fix. |
| Frontend safety | Follow `docs/FRONTEND_DESIGN_DIRECTION.md`. Use bespoke SVG icons. No drop shadows, gradients, emoji, icon libraries, or em dashes in UI copy. Render participant content with `PlainMarkdown` or text nodes, never HTML. |
| Claims | Capacity, performance, and security claims must be measured or marked provisional. Never invent test results or readiness evidence. |

## High-risk paths to trace

- `backend/app/submissions.py` and level submission handlers: idempotency, lock order, one clock read, caps, cooldown, hidden feedback.
- `backend/app/scoring.py`, database triggers, and migrations: append-only ledger, reversal linkage, unique award claims, race behavior.
- `backend/app/auth.py` and dependencies: token-derived identity, session revocation, role checks, step-up, generic failures.
- `backend/app/challenges.py` and assignment/file routes: team scoping, path validation, inert text storage, restricted-file exclusion.
- `backend/app/levels.py` and frontend level routes: server-owned progression, repository lock, gate checks, no client-authoritative state.
- `backend/worker.py` and scheduler jobs: retries, deduplication, deadlines, auto-submit, transaction boundaries.
- `frontend/src/components/SubmissionPayload.tsx` and `PlainMarkdown`: participant content stays inert.
- `backend/seed.py`: only the intended participant file list is ingested; restricted material is excluded.

## Verification gates

Run the gates relevant to the change and report exact results. Do not infer a pass from an old document.

```bash
cd backend && pytest
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run build
```

`scripts/e2e_journey.py` requires a running API, worker, and seeded database. Run it only when that stack is available and the review calls for it; do not claim an E2E pass without the actual output.

Before release-worthy changes, also check:

- No new unowned task markers, filler copy, or placeholder text.
- Relative links and documented commands resolve.
- Production claims point to current evidence.
- Database grant changes include ground-truth isolation verification.

## Evidence and severity overrides

- Use the shared `[severity][lens][confidence] path:line: issue` finding format.
- A reachable participant path to ground truth, mutable score ledger, client-controlled verdict or score, pre-release verdict leak, or committed secret is a **blocker**.
- A missing database constraint for award uniqueness or ledger immutability is a **blocker** when concurrent requests can corrupt scoring.
- A submission path that validates in the wrong order, reads the clock more than once, or commits partially is **major** or **blocker** based on exploitability and scoring impact.
- Stale docs that would cause an unsafe deploy or expose restricted data are at least **major**.
- Do not turn unmeasured capacity, security, or performance expectations into findings. Ask for evidence or mark the claim provisional.

## Review boundaries

A normal review must not read or reproduce the restricted organizer answer key. Review the ingestion boundary, access controls, participant file list, and isolation tests instead. If the user explicitly requests an organizer-side ground-truth review, keep all key material out of the report and participant-facing artifacts.
