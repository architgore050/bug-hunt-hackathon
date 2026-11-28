Status: describes the implementation as of 2026-11-22

# Performance and Capacity

This document contains measured facts and explicit arithmetic only. No benchmark numbers are invented. The single most important sentence: the 50-participant cap is PROVISIONAL and stays provisional until the 50-user rehearsal load test passes on the real D1 path (ADR-011; readiness item `load_test_50`).

## 1. Targets (from the master docs, D1 profile)

Source note: the "master docs" cited in this document set (`d1guide`, `sysarch`) are the design-level documents maintained alongside the project; they are not committed inside this repository, so their numbers are quoted here with the target status made explicit.

From `d1guide.txt` / `sysarch.txt` (deployment profile D1):

| Metric | Target | Scope |
| --- | --- | --- |
| Submission acknowledgement (POST /v1/submissions -> 202) | p95 <= 500 ms | server side and end-to-end measured separately |
| Read endpoints (/v1/state, file content, leaderboard) | p95 <= 300 ms | cached state and normal file reads; large searches measured separately |
| State update propagation (polling) | <= 5 s | consistent with the 5 s polling cadence |
| Event cap | 50 participants / 12 teams | only after a full-path 50-user load test passes |

These are testable targets, not promises: the master docs explicitly forbid claiming availability or RPO/RTO numbers before drills and load tests pass.

## 2. What has been measured so far

Nothing that qualifies as a capacity measurement. Verified on 2026-11-22:

- No load-test scripts and no `docs/LOAD_TEST_REPORT.md` exist in this repository (checked the whole tree). The intended home for the report is `docs/LOAD_TEST_REPORT.md`; when the first load test runs, its actual numbers go there and this section gets updated with the reference. Until then: UNRUN.
- What HAS been exercised at low scale in development: the full e2e journey (`scripts/e2e_journey.py`) runs against a local dev stack with 11 seeded participants in 2 teams, exercising submission acceptance, idempotent replay, cooldown rejection, evaluation, review, release and dispute. This proves correctness of the paths, not capacity.
- The pytest suite runs against a real PostgreSQL with the production migration (CI uses a PostgreSQL 17 service container; local dev clusters may run 16 or 17); no behavior has been validated against anything other than real PostgreSQL.

Assumption (explicit): development-machine latency gives no basis for p95 claims on the D1 VM. Do not cite dev timings as benchmarks.

## 3. Capacity model (arithmetic, not measurement)

### 3.1 Background polling load

Measured frontend cadences (TanStack `refetchInterval` in `frontend/src`): round state 5 s (lobby and workspace), submissions list 15 s, submission detail 20 s, leaderboard 10-20 s, results 10-30 s, review queue 8 s, admin dashboard 5-15 s, landing 60 s; draft autosave fires only when dirty.

Worst-case participant (Lobby or Workspace open the whole round):

- `/v1/state` every 5 s = 0.2 req/s per user
- slower surfaces (leaderboard 10-20 s, announcements/submissions 15-30 s) add roughly 0.05-0.1 req/s per user

At 50 participants: ~10 req/s of state polling plus ~2-4 req/s of slow-surface polling, i.e. roughly 12-15 req/s of steady-state background traffic on one uvicorn process. Each poll is one indexed primary read plus small aggregates (announcements count, leaderboard snapshot version); no scans of submissions at this cadence. This is comfortably inside the D1 envelope on paper, which is exactly why the gate is a measured rehearsal and not this paragraph.

### 3.2 Start-of-round burst (TIM-04)

The stage `start` action triggers every participant to load: `/v1/state`, `/v1/config`, `/v1/assignments` (one row + 11 file metadata rows), then 11 `files/content` fetches (each file is well under the 512 KiB cap) plus search usage. Rough envelope: ~15 requests per participant within the first minute, ~750 requests in that minute (~12 req/s average, spiky). In-process rate limits (120/min per user for file content, 30/min for assignments/search) are sized not to block honest burst behavior. There is no bundle pre-delivery (the master docs' encrypted pre-delivery idea is not implemented); the mitigation in v1 is simply that total challenge payload is small (11 text files).

### 3.3 Submission burst

Caps bound the transactional load: per participant 80 reports/round, 12/file, one report per file per 20 s cooldown. Absolute worst case at 50 participants is ~0.4 accepted submissions/s average over 3 hours with short spikes; each accepted submission is one serialized transaction (stage row lock, single `clock_timestamp()` read, insert submission + 2 jobs + outbox + audit). The stage-row `FOR UPDATE` serializes concurrent submissions briefly; at this scale lock hold time is milliseconds, but it is the first thing to watch under load (record lock waits in the rehearsal).

### 3.4 Worker throughput

The worker polls every 2 s and drains up to 20 jobs per pass; evaluation is one gt read of all candidate bugs plus one app transaction per submission. Even the worst-case burst (50 x ~80 reports over a round) is orders of magnitude below what this loop processes; review-item creation and leaderboard refresh add constant-factor jobs. Queue health (`oldest_queued_job_age_s`, dead letters) is exposed in `/v1/admin/system/health` and `/v1/admin/events/{id}/live` and must be watched during the rehearsal (OPS-02).

## 4. Indexes that serve the hot paths

From `migrations/0001_init.sql`:

| Hot path | Index |
| --- | --- |
| Job claim (`status='queued' AND run_after <= now() ORDER BY ...`) | `ix_jobs_claim (status, run_after)` |
| Per-file and per-round cap counts | `ix_app_submissions_author_id`, `ix_sub_stage_received (stage_id, received_at)`, `ix_sub_team_status (team_id, status)` |
| Cooldown (latest report per file) | `ix_sub_stage_received` |
| Round state (latest stage) | `ix_app_stages_event_id`; `ix_app_time_adjustments_stage_id` |
| Leaderboard build | `ix_app_score_ledger_entries_stage_id`, `..._team_id` |
| Results readout | `ix_app_score_ledger_entries_team_id`, `ix_app_submissions_team_id` |
| Review queue (open/claimed scan) | none on `status` (small table; acceptable at this scale, noted honestly) |
| Audit listing/verify | `ix_audit_entries_scope_seq (event_scope, seq)` |

## 5. Resource envelope (planning, from the master docs; not yet measured on real hardware)

`sysarch.txt` 13.4 initial envelope for a 2 OCPU / 12 GB A1 host: PostgreSQL 2-3 GiB, all API/proxy/tunnel processes together 2-3 GiB, workers <= 1 GiB, ~2 GiB OS reserve, >= 3 GiB page-cache/headroom. This repo's connection budget: each process holds pool 8 + overflow 4 per engine (`config.py`); one API process (app + gt engines, 24 max) plus one worker process (app engine, 12 max) stays under ~36 connections, inside PostgreSQL defaults. The A1 host may still fail the 50-user gate; if the rehearsal fails, reduce the event cap or move to paid infrastructure (that decision path is in the master docs and the runbook).

## 6. Qualification gate

The cap stays provisional until ALL of these pass, in order:

1. Load test scripts written and run from OUTSIDE the provider through the real Cloudflare/Tunnel path (master docs 18.2): realistic journeys, realistic payload sizes, recorded hardware, region, image digests, script commit, concurrency ramp and duration.
2. Submission ack p95 <= 500 ms and reads p95 <= 300 ms under 50-participant journeys, with server-side and end-to-end latency reported separately.
3. Queue age, dead letters, lock waits, connection usage, CPU/RSS/disk recorded during the run and within budget.
4. Results written to `docs/LOAD_TEST_REPORT.md` (does not exist yet) and the `load_test_50` readiness item checked; only then can the event go live at the 50-participant cap (the readiness gate enforces the checklist mechanically).

A 10x-overhead load test at 500 synthetic users is the aspirational master-doc bar; for the v1 free-VM profile the binding gate is the 50-user full-path rehearsal above.
