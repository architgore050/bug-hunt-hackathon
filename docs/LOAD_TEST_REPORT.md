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

1. Polling phase: one poller per successful seeded login from a hard-coded candidate list, polling `/state`, `/time`, `/assignments` and challenge file reads every 5 s each, for a configurable duration. `--users` feeds the candidate-list slice and is not a participant count.
2. Acknowledgement burst: attempts two reports for each of the first five candidate emails in a sequential loop inside one client, not a concurrent burst. With the current seed, one candidate has no account, so 8 reports are actually attempted.

Latency samples and p50 / p95 / p99 values are produced only for `/state`, `/time` and `/submissions` acknowledgement time. `/assignments` and challenge file reads are issued and their non-200 responses are counted in the run error count, but latency percentiles are not calculated for those endpoint classes. The script measures API responses only; it does not measure state-update visibility or worker job latency.

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

# terminal 4: synthetic over-cap dev probe, not a qualifying cap rehearsal
python scripts/load_test.py --base http://127.0.0.1:8100 --users 60 --seconds 300
# --users feeds the candidate-list slice; --seconds is the polling phase duration
```

The accepted flags are `--base`, `--users` and `--seconds`. `--users` is not a
participant count. The script hard-codes 10 candidate emails:
`p1.team1@example.com` through `p5.team1@example.com`, then
`p1.team2@example.com` through `p5.team2@example.com`. It slices that list to
`users // 12 + 2` entries, capped at 10. With `--users 60` it attempts 7
logins; only 6 of those accounts are seeded because `p5.team1@example.com` is
absent from the current seed, so 6 pollers run. The burst attempts two reports
for each of the first five candidates in a sequential loop. Because
`p5.team1@example.com` has no token, 8 reports are actually attempted, not 10.
These limitations are tracked separately and must be resolved before this tool
can qualify the 50-participant cap.

Record the exact command and the machine profile alongside every result row.

## 5. Results table (every script cell UNRUN)

The script-generated table contains only metrics that `scripts/load_test.py`
emits. `/assignments` and challenge file reads are exercised and error-counted
only; their latency percentiles are not script output. State-update visibility
and worker job latency are not measured by the current script and must not be
inferred from its output.

| Metric | Target | Measured p50 | Measured p95 | Measured p99 | Run errors (total) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET /state (polling phase) | p95 <= 300 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| GET /time (polling phase) | p95 <= 300 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |
| POST submission ack (burst) | p95 <= 500 ms | UNRUN | UNRUN | UNRUN | UNRUN | UNRUN |

Fill this table only from an executed run; do not extrapolate, do not round up,
and keep the raw tool output in an attachment or the run log. The
`Run errors (total)` cell comes from the total error count printed by the script.

### Manual or future instrumentation metrics (not script output)

| Metric | Target | Status | Measurement requirement |
| --- | --- | --- | --- |
| GET /assignments p95 | p95 <= 300 ms | FUTURE INSTRUMENTATION / UNRUN | Add latency sampling around the assignments request; the current script only exercises it and counts errors. |
| Challenge file read p95 | p95 <= 300 ms | FUTURE INSTRUMENTATION / UNRUN | Add latency sampling around the file content request; the current script only exercises it and counts errors. |
| State update visibility | <= 5 s | MANUAL / UNRUN | Measure from a controlled state change to participant-observed visibility; do not infer this from API latency. |
| Worker job latency (release path) | no target yet | FUTURE INSTRUMENTATION / UNRUN | Add worker timing or a worker metric; the current script does not measure this. |

## 6. Acceptance rule

The rehearsal must pass at the approved cap before `max_participants` is raised above the seeded 50 participants (ADR-011, L-14). "Pass" means: script-produced p95 targets for `/state` and `/time` met, submission ack p95 met during the burst, zero 5xx responses in the run, and a separately recorded manual check that state updates become visible within 5 s. A failure does not block the event; it caps the participant count at the highest passing level and triggers the degradation ladder in DEPLOYMENT_RUNBOOK.md.

## 7. Capacity reasoning

Steady state: 50 users polling four light endpoints every 5 s is roughly 10 requests per second of background load, trivial for a single FastAPI process on PostgreSQL local storage. What actually stresses the system is synchronised behaviour: the start-of-round submission burst (all 10 teams at once, each hitting the stage-row lock path), a release moment (every participant polls the instant feedback opens), and a leaderboard refresh storm after scoring events. The number that matters is p95 under burst, not the average: a 40 ms average with a 900 ms p95 burst means teams see frozen screens at the worst moment. Postgres local storage keeps round-trip latency low but makes the stage-row lock the contention point (ADR-012); the burst measurement is what validates it. If burst p95 fails, options in order: lengthen the polling interval, move the leaderboard off the submission path, and only then consider a second replica (which triggers the shared rate-limiter follow-up, L-05).
