# Onboarding guide

Status: CURRENT. How a new team member (or agent) gets productive in under an hour. Commands assume the repo root `/home/z/my-project/bug-hunt-hackathon/`.

## Prerequisites

Python 3.12+, Node 22+, Git, and a local PostgreSQL 16 or 17. The scripts auto-detect binaries: `../tools/pg17/bin` if present, else `initdb`/`psql` on PATH, else the newest `/usr/lib/postgresql/*/bin` (override with `PG_BIN`). The dev cluster listens on 127.0.0.1:5434 (override `PGPORT`; keep `backend/.env` and `backend/tests` in sync). No other services: the queue is Postgres-backed (ADR-003), no Redis, no runner VM.

## 8-step local setup

```bash
# 1. clone and read the rules first
git clone <repo> bug-hunt-hackathon && cd bug-hunt-hackathon
cat AGENTS.md README.md

# 2. database, roles, schemas (creates app_api / gt_admin / scheduler roles, app+gt+audit schemas)
DB=bughunt scripts/dev_db.sh

# 3. migrations (plain forward-only SQL, tracked in app.schema_migrations)
DB=bughunt PGUSER=pgadmin scripts/migrate.sh

# 4. Python dependencies (venv recommended; system Python may be externally managed)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..

# 5. seed the Fall Back preset (dev-only credentials printed at the end)
cd backend && .venv/bin/python seed.py --reset && cd ..

# 6. run the API + worker (one script, ports and logs per run_dev.sh)
scripts/run_dev.sh          # API on 127.0.0.1:8100; worker via backend/worker.py; logs in logs/
# equivalent manual start: cd backend && .venv/bin/python -m uvicorn app.main:app --port 8100 &
#                          cd backend && .venv/bin/python worker.py &

# 7. run the frontend
cd frontend && npm ci && npm run dev   # Vite on http://localhost:5173

# 8. prove the stack: backend tests + E2E journey
cd backend && .venv/bin/python -m pytest tests/ -q
.venv/bin/python ../scripts/e2e_journey.py
```

Login with a seeded organizer account to reach admin views; seeded participant accounts exercise the participant loop.

## Where to read first

1. `README.md` (layout, quick start), 2. `AGENTS.md` (engineering invariants 1-9, trust rules), 3. `docs/SYSTEM_ARCHITECTURE.md`, 4. `docs/API_REFERENCE.md`, then `docs/SOURCE_OF_TRUTH_AND_TRACEABILITY.md` for how sources rank. Read `docs/GROUND_TRUTH_ISOLATION.md` before touching gt-adjacent code.

## How to run the quality gates

- Backend: `cd backend && python -m pytest tests/ -q` (75 tests: 36 v1 covering auth, authorization, gt isolation, idempotency, matching and scoring, plus 39 four-level flow tests for gates, repo lock, uploads and auto-submit).
- E2E: `python scripts/e2e_journey.py` (46 checks across organizer, participant, reviewer, release, flags, audit).
- Frontend: `cd frontend && npm run build` (must stay clean; CI also greps for TODO/Lorem/XXX).
- CI parity: `.github/workflows/ci.yml` has six jobs (secret scan, backend quality, backend tests, backend e2e, frontend quality, docs hygiene). First green run on GitHub is UNVERIFIED from this repository (L-15).

## How to make a safe change

- Migrations: append a new ordered SQL file to `backend/migrations/`, forward-only, expand/contract; never edit an applied file; no destructive change without a forward fix (AGENTS.md invariant 8).
- Ledger: `app` score ledger is append-only. Corrections are reversal/adjustment entries referencing the original; never UPDATE/DELETE rows (invariant 3).
- Ground truth: participant-facing code must never touch the `gt` schema; the `app_api` role enforces this at the DB level. Use the gt session only in `backend/app/evaluator.py` paths (invariant 2).
- Submissions: reserve idempotency key first, lock the stage row, read `clock_timestamp()` once, validate in order, commit in one transaction (invariant 5).
- Errors: use the envelope in `backend/app/errors.py` with a stable catalog code; never leak stack traces or account existence (invariant 7).
- Time/state/truth: the server owns eligibility, deadlines, verdicts and scores; identity from the token, never the body (invariant 1).

## Seed reset workflow

`cd backend && python seed.py --reset` rebuilds the demo event (Fall Back preset: 6 Dec 2026, 180 min, teams 4-5, schedule 15/10/30/35/60/25/5, 9 demo participants in 2 teams of 4 and 5) and prints dev credentials. Use it between test runs; never run seed against anything resembling production (L-20).

## Common pitfalls

- Port conflicts: if another PostgreSQL cluster already serves 127.0.0.1:5434 (a container, another checkout), `scripts/dev_db.sh` says so and you pick a free port with `PGPORT=`; mirror that port in `backend/.env` and `backend/tests/conftest.py` (`PGPORT` env is honored).
- Foreign PYTHONPATH: if your shell sources something like ROS, its `PYTHONPATH` entries rank ahead of the venv and can shadow pinned deps (pytest may even auto-load foreign plugins). Run project Python commands as `env -u PYTHONPATH .venv/bin/python ...` or unset `PYTHONPATH` first; `scripts/run_dev.sh` already strips it.
- Binaries: if `scripts/dev_db.sh` reports no `initdb`/`pg_ctl` found, no supported install was detected; set `PG_BIN` to a PostgreSQL `bin` directory.
- Roles: `app_api` cannot read `gt` by design. If a query fails with permission denied, you are in the wrong session, not hitting a bug.
- Rate limiter restarts: limits are in-process and reset when the API restarts (L-05); do not tune limits from a single restart test.
- Stage lifecycle: a stage must go sealed->armed->started through the admin API. Direct state edits cause validation-order failures in submissions.
- Hidden feedback: participant endpoints must not leak verdicts pre-release; if your feature seems to show scores early, it violates invariant 6.
- Refresh tokens rotate on use; a duplicated request right after rotation can trip reuse detection within the 10 s grace window (`refresh_reuse_grace_s`).

## Where each kind of task goes

| Task | Location |
| --- | --- |
| New participant/admin endpoint | `backend/app/routers/<area>.py` (auth, admin, state, submissions, review, challenges, leaderboard, announcements, public) |
| New async work | job handler in `backend/app/jobs.py` registry + logic in `backend/app/evaluator.py`; must be idempotent |
| Schema change | new file in `backend/migrations/` + models in `backend/app/models_app.py` / `models_gt.py` |
| Frontend page | `frontend/src/pages/participant|admin|review/`; shared types in `frontend/src/lib/types.ts`, API client in `frontend/src/lib/api.ts` |
| Docs | this `docs/` directory; follow existing Status headers and honesty markers |
| Scoring rules | `backend/app/scoring.py`; weights live in event config, not code (ADR-006) |
