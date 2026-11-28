Status: describes the implementation as of 2026-11-28

# System Architecture

## 1. What the platform is

The Bug Hunt CTF platform runs the "Fall Back" full-stack debugging competition: teams receive a pre-broken application ("Papyrus"), submit structured bug reports and CTF flags through the platform, and the platform matches reports against organizer-held ground truth, scores them from an append-only ledger, and releases results at the end of the round. It is a FastAPI modular monolith plus a single worker process, with PostgreSQL 17 as the only durable store. There is no Redis, no message broker, no object storage and no microservices in v1.

Code locations:

| Component | Path | Notes |
| --- | --- | --- |
| FastAPI app | `backend/app/main.py` | App factory, middleware, router registration, `/health` |
| Routers | `backend/app/routers/*.py` | public, auth, state, challenges, submissions, leaderboard, announcements, review, admin |
| Domain services | `backend/app/matching.py`, `scoring.py`, `evaluator.py`, `audit.py`, `jobs.py`, `security.py` | No scoring logic lives in HTTP handlers |
| Models | `backend/app/models_app.py`, `models_gt.py` | SQLAlchemy 2.0, two engines (see Section 3) |
| Worker | `backend/worker.py` | Single loop, polls every 2 s, drains up to 20 jobs per pass |
| Migrations | Ordered SQL files in `backend/migrations/` (0001 through 0008) | Applied by `scripts/migrate.sh`, tracked in `app.schema_migrations` |
| Seed | `backend/seed.py` | Dev-only demo data (tenant, event, stage, challenge files, ground truth) |
| Frontend | `frontend/` | React 19 + Vite + TypeScript + Tailwind 4, TanStack Query polling |
| Challenge app | `challenge-app/` | Node 22.5+ / Express 4 / `node:sqlite`, 10 planted bugs (275 points) + 2 flags (60 points) |

Runtime dependencies (from `backend/requirements.txt`): FastAPI 0.128.0, uvicorn 0.44.0, SQLAlchemy >= 2.0.44, psycopg 3 (binary), argon2-cffi, PyJWT, pydantic-settings, python-multipart, cryptography, httpx. Python 3.12.

## 2. Topology

```
                        Participants / organizers (browser)
                                     |
                    React SPA (static build, Vite)
                    dev: vite :5173  prod target: Cloudflare Pages
                                     |  same-origin /v1 + /health (dev proxy)
                                     v
                  +------------------------------------------+
                  |            FastAPI (uvicorn :8100)       |
                  |  request pipeline (main.py 7.3):         |
                  |  request id -> body size limit ->        |
                  |  authenticate (JWT) -> authorize ->      |
                  |  validate -> bounded transaction ->      |
                  |  audit -> error envelope                 |
                  +------------------+-----------------------+
              app_engine |                  | gt_engine
           role app_api  |                  |  role gt_admin
        (NO gt grants)   v                  v  (evaluator/admin gt paths only)
                  +------------------------------------------+
                  |            PostgreSQL 17                 |
                  |  schema app   (32 tables: domain + jobs) |
                  |  schema gt    (6 tables: ground truth)   |
                  |  schema audit (1 table, hash chain)      |
                  +------------------+-----------------------+
                                     |  app.jobs (FOR UPDATE SKIP LOCKED + lease)
                                     v
                  +------------------------------------------+
                  |        worker.py (one process)           |
                  |  evaluate_submission, create_review_item,|
                  |  verify_flag, apply_review_outcome,      |
                  |  apply_test_results, release_feedback,   |
                  |  refresh_leaderboard, dispatch_outbox    |
                  +------------------------------------------+
```

The frontend talks to the API same-origin in dev (Vite proxies `/v1` and `/health` to `127.0.0.1:8100`, see `frontend/vite.config.ts`), so the refresh cookie stays first-party. In the D1 target the SPA is served from Cloudflare Pages and the API behind a Cloudflare Tunnel; that deployment is documented in `DEPLOYMENT_RUNBOOK.md` and is not yet built in this repo (no Dockerfile, compose file, or cloudflared config exists as of 2026-11-22).

## 3. Trust domains and the two-engine boundary

`backend/app/db.py` creates exactly two SQLAlchemy engines:

- `app_engine` connects as the `app_api` role. It may read and write `app` tables, insert into `audit`, and has no permission on `gt`. Every HTTP request path uses only this engine.
- `gt_engine` connects as the `gt_admin` role. Only evaluator handlers (`backend/app/evaluator.py`), the admin ground-truth endpoints in `backend/app/routers/admin.py`, and the seed script open sessions on it.

The roles are created and granted by `scripts/dev_db.sh`: `app_api` gets privileges on `app` and insert/select on `audit` only; `gt_admin` gets `app` plus full `gt` privileges. PostgreSQL enforces the boundary even if application code has a bug; `backend/tests/test_gt_isolation.py` asserts the real `app_api` role raises `InsufficientPrivilege` on `gt.gt_bugs`, `gt.gt_flags` and a `gt.gt_aliases` insert. See `GROUND_TRUTH_ISOLATION.md`.

The `scheduler` role also exists in `dev_db.sh` (same grants as `app_api`) but nothing in the code connects with it yet; it is reserved for a future scheduled-maintenance process.

## 4. Request pipeline

Implemented in `backend/app/main.py`:

1. Request ID: taken from the incoming `X-Request-Id` header or generated as a 16-hex-char id; stored on `request.state` and echoed on every response.
2. Body size limit: if `Content-Length` exceeds `max_body_bytes` (512 KiB), a 413 with the standard error envelope is returned immediately.
3. CORS: exact-origin allow-list from `settings.frontend_origin`, credentials allowed, no wildcards (NET-05). Allowed headers: `Authorization`, `Content-Type`, `Idempotency-Key`, `X-BHCTF-Client`.
4. Authentication: `get_principal` (`deps.py`) decodes the pinned-algorithm JWT (HS256, iss `bughunt-api`, aud `bughunt-participant` or `bughunt-admin`), then re-reads the user and session rows from the database so revocation, disqualification and `token_version` changes take effect immediately (AUTH-01).
5. Authorization: `require_role`, `require_staff` (reviewer/organizer/admin), `require_organizer`, `require_admin`, and `step_up_verified` for sensitive routes (AUTH-09).
6. Validation: Pydantic models per endpoint; participant-visible config values come from the stage row, never from the client.
7. Transaction: handlers run inside `app_session()` (single commit/rollback). The submission path inserts submission + job + outbox + audit in ONE transaction (see `routers/submissions.py`).
8. Error envelope: every error is `{"error": {"code", "message", "request_id", "details"}}` from the catalog in `errors.py`; unhandled exceptions return 500 `INTERNAL_ERROR` with the request id, never a stack trace.
9. Response headers: `X-Request-Id`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store` (public, max-age=10 for `/v1/public/*` and `/health`).

Time authority: the only clock used for acceptance and state decisions is `SELECT clock_timestamp()` inside the transaction (`db.db_now`, ADR-012; TIM-01/02). The submission path reads it once after locking the stage row.

## 5. State machines

### 5.1 Event

Enforced in `routers/admin.py::set_event_status` via `EVENT_TRANSITIONS`:

```
draft -> configured -> ready -> live -> closed -> finalized -> archived
              |__________|
```

`configured -> ready` and back is the only backward edge. Going `ready -> live` is blocked while any `app.readiness_items` row for the event is `unchecked` (ADM-EV-05); on success the event gets `starts_at` (now) and `ends_at` (now + duration_minutes) if unset.

### 5.2 Stage

Enforced in `routers/admin.py::control_stage` and `::release_results`:

```
draft -> sealed -> armed -> active -> paused -> active (resume)
                       |          |
                       |          +-> ended -> evaluating -> released -> final
                       +-> (disarm back to draft is allowed from sealed)
```

- `start` sets `started_at = clock_timestamp()` and `ends_at = started_at + event.duration_minutes` in the same statement.
- `pause` / `resume` / `end` / `extend` all require a reason string; every transition inserts a row into `app.stage_transitions` with from-status, resulting to-status, actor and reason code (ADM-LV-02, TIM-05). `extend` records a status self-transition.
- `extend` shifts `ends_at` by 1..3600 seconds. Per-user or per-team make-up time is a separate mechanism: `app.time_adjustments` rows (reason codes ACCOMMODATION | OUTAGE | DEVICE_FAILURE | OTHER) are summed into the effective end for deadline checks and the `/v1/state` readout.
- `evaluate` moves ended -> evaluating and enqueues `release_feedback`; `release` moves to released, enqueues `release_feedback` and `refresh_leaderboard` with visibility public.

`resume` compensates `ends_at` from the latest real active-to-paused transition, not from stage start or an `extend` self-transition. Legacy `pause` rows are recognized, the compensation is capped at 7200 seconds, and the stage row lock serializes concurrent control actions. Verify the resulting deadline during rehearsal.

### 5.3 Submission

`kind = bug_report` path (statuses on `app.submissions.status`):

```
received -> matched_auto | needs_review | rejected_auto | duplicate
matched_auto  -> in_review (claimed) -> decided | needs_review
needs_review  -> in_review -> decided / duplicate / rejected_auto (reviewer)
decided/matched_auto -> ledgered (release_feedback wrote code_review default)
released: feedback_released = true on every stage submission
disputed: participant opens dispute after release
```

`kind = ctf_flag` path: `received -> matched_auto` (flag verified, bonus ledgered) or `rejected_auto` (unknown flag) or `duplicate` (max_awards reached or award unit already claimed).

Statuses visible to participants are coarsened to `received` until `feedback_released` is true (INT-01 verdict-oracle defense); see `routers/submissions.py::my_submissions`.

## 6. Job queue and worker

`app.jobs` is a durable PostgreSQL queue (ADR-003). Claiming is a single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` that sets `status='running'` and a 120 s lease (`jobs.py::claim_next`). The handler runs OUTSIDE the claim transaction. Failures retry with backoff [10, 60, 300, 900] s up to `max_attempts` (default 5), then go to `dead` and surface in `/v1/admin/system/health` and the live-ops view. On worker start (and each loop pass) expired leases are requeued, so a crashed worker's in-flight jobs are retried: delivery is at-least-once, and exactly-once business outcomes come from unique constraints plus idempotent handlers, e.g. `award_claims UNIQUE (stage_id, team_id, award_unit_id)` (DAT-01), ground-truth flag-row IDs as the version-scoped CTF award unit, and `_has_component` checks before inserting ledger entries.

Handlers (all in `backend/app/evaluator.py`): `evaluate_submission`, `create_review_item`, `verify_flag`, `apply_review_outcome`, `apply_test_results`, `release_feedback`, `refresh_leaderboard`, `dispatch_outbox`. `worker.py` polls every 2 s and drains up to 20 jobs per pass. Tests run handlers synchronously via `conftest.worker_drain()`.

The outbox table (`app.outbox_events`) is written in the submission transaction and drained by `dispatch_outbox` (marks delivered); it currently has no external consumer, it is the seam for future push notifications (no SSE in v1).

## 7. Frontend architecture

React 19.3 + Vite 8 + TypeScript, Tailwind 4 via `@tailwindcss/vite`, TanStack Query 5 for server state, react-router-dom 7. 29 source files under `frontend/src/`. Art direction: the "Case File" system in `docs/FRONTEND_DESIGN_DIRECTION.md` (ink/paper palette, hairline borders, bespoke SVG icons in `ui/icons.tsx`, no shadow/gradient decoration).

Routes (`App.tsx`): `/`, `/rules`, `/privacy`, `/terms` (public layout), `/login`, `/activate`, `/app` (participant shell: index lobby, `workspace`, `submissions`, `submissions/:submissionId`, `results`, `leaderboard`), `/review` (reviewer: queue index, `items/:itemId`), `/admin` (organizer/admin: dashboard, `challenges`). There is no `/app/account` route in the current build; account/session management lives in the lobby and `GET /v1/me/sessions`.

Auth handling (`lib/api.ts`, `lib/auth.tsx`): the access token lives in a module variable (memory only, AUTH-02); the refresh token is an HttpOnly cookie the browser holds. On boot the SPA calls `POST /v1/auth/refresh` with `Origin` + `X-BHCTF-Client` headers; a 401 `AUTH_TOKEN_EXPIRED` triggers one silent refresh and one retry. All failures normalize to `ApiRequestError` carrying the server envelope.

Polling cadences (TanStack `refetchInterval`): round state 5 s in the lobby (and 5 s for stage state in the workspace), submissions list 15 s, submission detail 20 s, leaderboard 10-20 s, results 10-30 s, review queue 8 s, admin dashboard 5-15 s, landing page 60 s. Report drafts autosave every 3 s when dirty (`PUT /v1/drafts/{challenge_id}`) with optimistic version conflict handling (FE-01). Time rendering is pinned to `Asia/Kolkata` (`lib/format.ts`); the countdown is derived from the server clock plus a measured offset, never the local clock (TIM-01).

Safety: no `dangerouslySetInnerHTML` anywhere in `frontend/src` (verified by grep); participant content renders through `PlainMarkdown` (`ui/components.tsx`), which formats text without raw HTML (EVA-05).

## 8. Deliberately omitted in v1, and why

| Omitted | Where the decision lives | Follow-up |
| --- | --- | --- |
| Code runner (participant "Run") | `config.py` `runner_enabled=False`, ADR-010 fallback; d1guide 19.3 requires a separate runner VM | Isolated runner VM + gateway, or stay deterministic-only |
| AI-assisted scoring | `config.py` `ai_assessment_enabled=False` (DEC-13); `docs/AI_TOOLING_RESEARCH_AND_DECISION.md` | Provider evaluation gate R5 must pass first |
| Redis / shared cache / SSE | PostgreSQL holds everything (DAT-11); polling at 5-30 s is adequate for 50 users (d1guide 5.5) | Add SSE only if measurements justify it; polling stays as fallback |
| MFA for admins | Step-up is password re-entry valid 5 min (`deps.py::step_up_verified`, AUTH-09) | Cloudflare Access + WebAuthn is the documented production path (ADR-008) |
| Email delivery | Invite/reset tokens surface in the organizer console response and dev logs (`routers/auth.py`, `routers/admin.py`) | SMTP or transactional provider wiring before a public event |
| PgBouncer / multi-replica scaling | Single API process; pool 8 + overflow 4 per engine (DAT-09) | Add pgbouncer and per-process connection budgets if replicating |
| Object storage | Challenge files are text rows in `app.challenge_files` (max 512 KiB per file) | Move blobs to a private bucket when repositories grow |

## 9. Deployment profiles

- D0 (local dev, what actually runs today): PostgreSQL binaries auto-detected by the scripts (portable `../tools/pg17` if present, else system install; PostgreSQL 16 or 17), dev cluster on port 5434, databases `bughunt` and `bughunt_test`, roles `app_api` / `gt_admin` / `scheduler`, uvicorn on 8100, `worker.py`, Vite on 5173. Scripts: `scripts/dev_db.sh`, `scripts/migrate.sh`, `scripts/run_dev.sh`.
- D1 (target, not yet materialized in-repo): one OCI Always Free Ampere A1 VM (2 OCPU / 12 GB) running the API, worker and PostgreSQL behind Cloudflare DNS/TLS/Tunnel, static SPA on Cloudflare Pages. Capacity targets and the qualification gate are in `PERFORMANCE_AND_CAPACITY.md`; the procedure is in `DEPLOYMENT_RUNBOOK.md`.
- D2 (multi-domain, resilient) is explicitly out of scope for v1 (`config.py` profile comment).
