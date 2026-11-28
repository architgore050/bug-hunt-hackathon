Status: describes the implementation as of 2026-11-22

# CI/CD Pipeline

Ownership note: the CI workflow is owned by the orchestrator track, not by this documentation pass. This document specifies the workflow contract that `.github/workflows/ci.yml` must implement.

Deployment reality (verified 2026-11-22):

- There is NO `.github/` directory in this repository yet.
- No workflow has ever run.
- Everything below is the specification to implement, plus the mandatory verification step.
- Nothing here should be described as "running" until the first green run is observed on GitHub.

## 1. Workflow contract: `.github/workflows/ci.yml`

Triggers:

- `push` (all branches).
- `pull_request` to the main branch.
- Concurrency group per ref with `cancel-in-progress: true` so stale runs do not waste free-plan minutes.

### Job 1: backend-tests

Purpose: run the pytest suite against a real PostgreSQL 17, because the suite's isolation and idempotency guarantees are database-enforced (unique constraints, role grants, SKIP LOCKED claims).

Steps:

1. `actions/checkout@v4`.
2. Service container: `postgres:17` exposed on `127.0.0.1:5433` with a throwaway superuser password via `env:` (not a repository secret; test-only). Configure health options to wait for readiness.
3. Install a PostgreSQL client (for example `apt-get install -y postgresql-client`) because `scripts/dev_db.sh` and `scripts/migrate.sh` shell out to `psql` / `pg_isready`.
   - Export `PGPORT=5433` and credentials matching the service container.
   - The scripts default `PG_BIN` to a local portable install but fall back to PATH tools, so the client package is sufficient; verify on first run and pin versions once known.
4. Set up Python 3.12 and `pip install -r backend/requirements.txt`.
5. Bootstrap: run `scripts/dev_db.sh` (creates roles/grants inside the service container database) and `scripts/migrate.sh` against a CI database.
   - `tests/conftest.py` itself creates and migrates `bughunt_test`, so the explicit bootstrap mainly validates that the scripts run in CI.
6. Run `python -m pytest backend/tests -v`.
   - The suite self-contains its secrets (`conftest.py` sets a test-only `JWT_SECRET` and dev role passwords scoped to the throwaway database), so NO repository secrets are required for this job.
7. Upload the pytest report as a workflow artifact on failure.

Job-level sanity checks worth adding cheaply (grep assertions, not tests):

- `! grep -r "dangerouslySetInnerHTML" frontend/src`.
- A docs placeholder sweep.
- Keep the required set minimal so the pipeline stays green and meaningful.

### Job 2: frontend-build

Purpose: prove the SPA type-checks, lints and builds.

Steps:

1. `actions/setup-node@v4` (Node 22, matching the repo tooling).
2. `npm ci` in `frontend/`.
3. `npm run lint` (oxlint).
4. `npm run build` (`tsc -b && vite build`).
5. No secrets required.
6. Upload `frontend/dist` as an artifact so a deployment job (future) consumes an immutable build rather than rebuilding.

### Job 3 (future, do not fake): e2e journey

- The e2e journey needs the API + worker + seeded database running.
- It CAN be composed from Job 1's service container plus `run_dev.sh` + `python scripts/e2e_journey.py`.
- Add it once Jobs 1-2 are verified stable; treat it as a required gate before event readiness, in CI or manually per release.

## 2. Secrets needed

- None for the two required jobs:
  - Backend tests use the conftest-provided test secret and dev role credentials scoped to the throwaway service database.
  - Frontend build needs nothing.
- If deployment automation is added later (image build/push, Pages deploy, SSH to the VM), introduce exactly the tokens those steps need (`GH_TOKEN`/deploy key, Cloudflare API token, registry credentials) as GitHub Actions secrets, least-privilege, and never echo them.
- Secret hygiene (SEC-04 area): no production JWT secret in CI; the production `JWT_SECRET` lives only in the VM env file.

## 3. What CI deliberately does NOT do (yet)

- No dependency vulnerability scanning (SEC-04 follow-up: add Dependabot plus an image scanner when images exist).
- No arm64 image builds (no Dockerfiles exist; the D1 guide requires arm64-tested images before event day).
- No deployment job: deploys are manual per `DEPLOYMENT_RUNBOOK.md` until a compose-based pipeline is proven on the real VM.

## 4. Mandatory first-run verification (OPS-02)

The first real CI run MUST be verified on GitHub after push, not assumed:

1. Commit `.github/workflows/ci.yml` per the contract above and push.
2. Open the Actions tab; both jobs must be green on the actual runner (Ubuntu-latest).
   - Common first-run failures to expect and fix: missing `psql` in the backend job, service-container health timing, Node/Python version mismatches, oxlint strictness differences.
3. Record the green run URL and date in the readiness evidence alongside `runbooks`.
   - The master docs' rule applies: the live event must never be the first full run of any pipeline.
4. Branch protection: once green, require the backend + frontend jobs to pass before merging to main, so the event branch cannot regress silently.

## 5. Release flow (manual, documented)

- CI green -> tag/branch -> deploy per `DEPLOYMENT_RUNBOOK.md` Section 2 (compose pull/up on the VM, migrate.sh as owner, health + role tests + e2e journey against the deployment, THEN go live).
- Immutable artifacts: pin image digests once images exist; never `latest` (master guide requirement).
- Change freeze during active rounds (OPS-03): CI may keep running, but deploys during a round are forbidden except emergency kill-switch env changes.
