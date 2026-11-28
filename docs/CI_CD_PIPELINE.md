Status: sharded backend test workflow on 2026-11-28; upstream `main` run [#95](https://github.com/architgore050/bug-hunt-hackathon/actions/runs/46141529709) was green on the previous six-job workflow at `05796da64df844e8156dea4ad2b740397dd4e4b8`. This branch's run is pending.

# CI/CD Pipeline

Ownership note: the CI workflow is owned by the orchestrator track. This document describes the workflow that is committed at `.github/workflows/ci.yml`.

Deployment reality (verified 2026-11-28 from the repository only):

- The workflow file exists and defines seven logical jobs. Six of them are the separate runner jobs expanded from the `backend-test-shards` matrix, so twelve runners appear on a GitHub Actions run.
- Upstream `main` run [#95](https://github.com/architgore050/bug-hunt-hackathon/actions/runs/46141529709) completed successfully on commit `05796da64df844e8156dea4ad2b740397dd4e4b8` across the previous six-job workflow. That is not evidence that the sharded workflow or this branch is green; the exact commit's run must be checked.
- The job list below matches the committed file. A remote run is not implied by the job definitions.

## 1. Workflow contract: `.github/workflows/ci.yml`

Triggers:

- `push` to `main` only.
- `pull_request` to `main` only.
- `contents: read` permission.
- Concurrency group per workflow and ref; `cancel-in-progress` is true for pull requests only.

### Job 1: secret-scan

Runs `gitleaks/gitleaks-action` with `fetch-depth: 0` so PR commits are available to the scanner. It uses the automatically provided `GITHUB_TOKEN`; no repository secret is configured.

### Job 2: backend-quality

Runs `ruff check .`, `ruff format --check .`, `bandit -q -r backend/app -ll` and `pip-audit` on Python 3.12 with both runtime and dev requirements installed.

### Job 3: backend-test-shards (six matrix runners)

Purpose: run the pytest suite against a real PostgreSQL 17, because the suite's isolation and idempotency guarantees are database-enforced (unique constraints, role grants, SKIP LOCKED claims). The suite reseeds the database before every test, so it cannot share one database across parallel processes. The matrix gives each file group its own PostgreSQL service and its own `bughunt_test` database. `fail-fast` is off, so one failing shard does not hide the others.

Each runner:

1. Checks out and sets up Python 3.12 with the runtime and dev requirements.
2. Starts a PostgreSQL 17 service container on `127.0.0.1:5433` with trust auth and a health check.
3. Creates `bughunt_test`, the three schemas and the `app_api` / `gt_admin` / `scheduler` roles plus grants directly on the service.
4. Applies `backend/migrations/` in order with `scripts/migrate.sh`.
5. Runs `python -m pytest <shard paths> -q --cov=app --cov-branch --timeout=120` from `backend/`. `COVERAGE_FILE` is `coverage.<group>` so each runner writes its own data file, uploaded as a `coverage.<group>` artifact.
   - `tests/conftest.py` sets a test-only `JWT_SECRET` and dev role passwords for the throwaway database, so no repository secrets are needed for these runners.
   - The shard paths are literals in the workflow `include` list and cover every `backend/tests/test_*.py` file exactly once. Adding a test file requires adding it to a shard.

### Job 4: backend-tests (coverage gate, required check)

This job keeps the original `Backend tests (pytest + coverage)` check name so branch protection does not need a new entry for every shard. It runs even when a shard fails (`if: !cancelled()`) and fails immediately when any shard result is `failure` or `cancelled`. Otherwise it downloads the six coverage artifacts, runs `coverage combine` and enforces `coverage report --fail-under=65` on the combined data. A per-shard threshold would be wrong here because each group covers only part of `app`.

### Job 5: backend-e2e

PostgreSQL 17 service on port 5433, roles and migrations as in the shard runners, `python seed.py --reset`, API on `127.0.0.1:8100` and `worker.py`, a health wait loop, then `python scripts/e2e_journey.py`. The script exits nonzero when a check fails. The job is active, not a future item.

### Job 6: frontend-quality

Node 22: `npm ci`, `npm audit --audit-level=high`, `npm run lint`, `npm test` and `npm run build` (`tsc -b && vite build`) in `frontend/`.

### Job 7: source-hygiene

Greps for em dashes in frontend source and for TODO/Lorem/XXX in platform code. The placeholder ban deliberately excludes the challenge-app vendor product, which keeps its documented TODO.

### E2E journey gate

The e2e journey needs the API, worker and a seeded database; Job 5 provides them. Treat its 46 checks as a required gate before event readiness. It currently exercises the v1 journey; the four-level flow is not yet in the journey script.

## 2. Secrets needed

- No repository secrets are required by the seven jobs. The secret scan reads the automatically provided `GITHUB_TOKEN`; backend test shards use the conftest-provided test secret and dev role credentials scoped to their own throwaway service database; frontend jobs need nothing.
- If deployment automation is added later (image build/push, Pages deploy, SSH to the VM), introduce exactly the tokens those steps need (`GH_TOKEN`/deploy key, Cloudflare API token, registry credentials) as GitHub Actions secrets, least-privilege, and never echo them.
- Secret hygiene (SEC-04 area): no production JWT secret in CI; the production `JWT_SECRET` lives only in the VM env file.

## 3. What CI deliberately does NOT do (yet)

- No deployment job: deploys are manual per `DEPLOYMENT_RUNBOOK.md` until a compose-based pipeline is proven on the real VM.
- No arm64 image builds or image scanning (no Dockerfiles exist; the D1 guide requires arm64-tested images before event day).
- No load rehearsal and no external penetration test: both are readiness gates that a workflow cannot satisfy.
- Branch protection is a GitHub repository setting, not a workflow step; its status must be checked on GitHub and cannot be inferred from this file.

## 4. Mandatory first-run verification (OPS-02)

The first real CI run MUST be verified on GitHub, not assumed from the committed workflow:

1. `.github/workflows/ci.yml` is committed; on any change to it, observe the next Actions run on the exact commit.
2. Open the Actions tab; all seven logical jobs must be green on the actual runner (Ubuntu-latest). Confirm that twelve runner jobs appear: six shard runners plus secret scan, backend quality, coverage gate, e2e, frontend quality and source hygiene.
   - Common first-run failures to expect and fix: service-container health timing, Node/Python version mismatches, linter strictness differences, missing `psql` in the backend jobs, coverage artifacts not uploaded or not combining.
3. Record the green run URL and date in the readiness evidence alongside `runbooks`.
   - The master docs' rule applies: the live event must never be the first full run of any pipeline.
4. Branch protection: once green, require all seven logical jobs (secret scan, backend quality, the six backend test shards, the backend coverage gate, backend e2e, frontend quality and source hygiene) before merging to main, so the event branch cannot regress silently. The sharded runners are separate check names; the coverage gate keeps the original backend tests check name.

## 5. Release flow (manual, documented)

- CI green -> tag/branch -> deploy per `DEPLOYMENT_RUNBOOK.md` Section 2 (compose pull/up on the VM, migrate.sh as owner, health + role tests + e2e journey against the deployment, THEN go live).
- Immutable artifacts: pin image digests once images exist; never `latest` (master guide requirement).
- Change freeze during active rounds (OPS-03): CI may keep running, but deploys during a round are forbidden except emergency kill-switch env changes.
