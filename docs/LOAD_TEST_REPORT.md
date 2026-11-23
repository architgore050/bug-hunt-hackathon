# Load test report

Status: SCRIPT READY, MEASUREMENT PENDING (UNRUN at the approved cap). `scripts/load_test.py` exists; it has never produced accepted numbers. Every result cell below is UNRUN until a rehearsal is executed. This is the gate for raising `max_participants` (ADR-011).

## 1. Objectives

D1 targets at 50 participants (10 teams x 5):

- Read endpoints p95 <= 300 ms (`/state`, `/time`, `/assignments`, challenge file reads).
- Submission acknowledgement p95 <= 500 ms (the burst path: idempotency reserve, stage-row lock, ledger commit).
- State updates (announcement, release, deadline transitions) visible to all clients within <= 5 s (polling interval).

These are rehearsal gates, not SLAs. If p95 targets fail at the cap, `max_participants` stays lowered and the capacity reasoning below is revisited.

## 2. The tool

`scripts/load_test.py`, two phases:

1. Polling phase: 60 virtual participants polling `/state`, `/time`, `/assignments` and challenge file reads every 5 s each, for a configurable duration. This models steady-state event traffic.
2. Acknowledgement burst: a 10-report burst (submissions with evidence) fired concurrently to model the start-of-round spike when all teams submit at once.

The tool reports p50 / p95 / p99 latency per endpoint class plus error counts. It measures the API only; it does not measure worker lag directly (infer from state-update visibility).

## 3. Environment requirements

- PostgreSQL binaries auto-detected by `scripts/dev_db.sh` (portable `../tools/pg17/bin` if present, else system install; override `PG_BIN`).
- A seeded event: `cd backend && python seed.py --reset` (Fall Back preset).
- API running (`scripts/run_dev.sh` or uvicorn on 127.0.0.1:8100) and the worker running in a second terminal.
- Frontend does not need to run; the tool drives the API directly like the SPA does.
- Run on hardware comparable to the D1 target (OCI Always Free A1: 4 OCPU ARM, 24 GB RAM) for numbers that transfer; localhost laptop runs are indicative only and should be labelled as such in the results table.

## 4. How to run

```bash
# terminal 1: database + seed
DB=bughunt scripts/dev_db.sh
DB=bughunt PGUSER=pgadmin scripts/migrate.sh
cd backend && python seed.py --reset

# terminal 2: API
scripts/run_dev.sh

# terminal 3: worker
cd backend && python worker.py

# terminal 4: load test at the approved cap
python scripts/load_test.py --participants 60 --duration 300 --burst 10
# adjust flags to match the script's CLI; --participants models concurrent pollers, --duration seconds, --burst the submission spike
```

Record the exact command and the machine profile alongside every result row.

## 5. Results table (every cell UNRUN)

| Metric | Target | Measured p50 | Measured p95 | Measured p99 | Errors | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET /state (polling phase) | p95 <= 300 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| GET /time (polling phase) | p95 <= 300 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| GET /assignments (polling phase) | p95 <= 300 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| Challenge file read | p95 <= 300 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| POST submission ack (burst) | p95 <= 500 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| State update visibility | <= 5 s | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| Worker job latency (release path) | no target yet | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |

Fill this table only from an executed run; do not extrapolate, do not round up, and keep the raw tool output in an attachment or the run log.

## 6. Acceptance rule

The rehearsal must pass at the approved cap before `max_participants` is raised above the seeded 50 participants (ADR-011, L-14). "Pass" means: all read p95 targets met, submission ack p95 met during the burst, zero 5xx responses, and state updates within 5 s. A failure does not block the event; it caps the participant count at the highest passing level and triggers the degradation ladder in DEPLOYMENT_RUNBOOK.md.

## 7. Capacity reasoning

Steady state: 50 users polling four light endpoints every 5 s is roughly 10 requests per second of background load, trivial for a single FastAPI process on PostgreSQL local storage. What actually stresses the system is synchronised behaviour: the start-of-round submission burst (all 10 teams at once, each hitting the stage-row lock path), a release moment (every participant polls the instant feedback opens), and a leaderboard refresh storm after scoring events. The number that matters is p95 under burst, not the average: a 40 ms average with a 900 ms p95 burst means teams see frozen screens at the worst moment. Postgres local storage keeps round-trip latency low but makes the stage-row lock the contention point (ADR-012); the burst measurement is what validates it. If burst p95 fails, options in order: lengthen the polling interval, move the leaderboard off the submission path, and only then consider a second replica (which triggers the shared rate-limiter follow-up, L-05).
