# Autonomous decision log

Status: CURRENT. ADR-style record of every significant decision made autonomously in this one-shot build. Each entry: Context / Decision / Rationale / Consequences / Follow-up. Precedence of sources is defined in SOURCE_OF_TRUTH_AND_TRACEABILITY.md.

## ADR-001 Modular monolith on FastAPI

Context: v1 must run on a single free VM with one developer and one rehearsal.
Decision: FastAPI app, routers, services, worker in one Python package (`backend/app/`), no microservices.
Rationale: smallest operational surface for D1; Postgres already provides the durability boundary.
Consequences: scaling is vertical; extraction later is possible because routers are thin over services.

## ADR-002 PostgreSQL-only durability, three-schema trust split with real DB roles

Context: spec demanded strong ground-truth isolation; app-only code must not read gt data.
Decision: PostgreSQL 17 with `app`, `gt`, `audit` schemas; distinct least-privilege roles `app_api`, `gt_admin`, `scheduler`; the API connects only as `app_api` (see `backend/app/config.py`, `backend/app/db.py`).
Rationale: role grants make isolation a database property, not a code convention.
Consequences: migrations and seed must grant per role; CI recreates roles in SQL (see `.github/workflows/ci.yml`).
Follow-up: `scheduler` role has no consumer yet (L-11).

## ADR-003 PG-backed job queue with SKIP LOCKED

Context: evaluator work (matching, review items, flag awards, release) must survive restarts.
Decision: `app.jobs` table, claim with `SELECT ... FOR UPDATE SKIP LOCKED` plus leases and lease requeue (`backend/app/jobs.py`).
Rationale: at-least-once delivery with crash recovery without Redis or Celery.
Consequences: handlers must be idempotent; award claims are unique per (stage, team, award unit) at DB level.

## ADR-004 Opaque refresh tokens with family rotation and reuse detection

Context: spec AUTH-04 required revocable refresh without JWT server-side state.
Decision: refresh tokens are random server-stored hashes grouped in families; rotation on use; reuse of a superseded token revokes the family; a 10 s same-successor grace window avoids races (`backend/app/security.py`, config `refresh_reuse_grace_s`).
Rationale: detection of stolen-token replay with bounded false positives.
Consequences: refresh state lives in DB; logout-all deletes families.

## ADR-005 Argon2id with OWASP-tuned parameters

Context: password storage must resist offline cracking.
Decision: Argon2id with parameters matching current OWASP guidance, enforced min length 12 (`backend/app/security.py`, `password_min_length: int = 12`).
Rationale: library default was weaker than the documented posture.
Consequences: modest CPU cost per login; acceptable at event scale.

## ADR-006 Score components frozen with configurable review weight

Context: proposal wanted review weight configurable; spec drafts had fixed weights.
Decision: default components functional_test 0.5 / code_review 0.3 / evidence_report 0.2, CTF bonus cap 100, frozen in seed/event config (`backend/app/scoring.py`, `backend/seed.py`, docs/SCORING_MODEL.md).
Rationale: mirrors the product-owner reconciliation while keeping one canonical default.
Consequences: changing weights mid-event is a config edit plus recompute, not code.
Follow-up: dry run confirms config surface.

## ADR-007 Deterministic matcher with conservative auto-accept

Context: verdicts must be reproducible and auditable.
Decision: keyword/structure-based matcher (`backend/app/matching.py`) with thresholds tuned so uncertain matches become review items instead of auto-accepts.
Rationale: a wrong auto-accept damages the ledger and feedback; a review item costs only organizer time.
Consequences: recall may be lower; organizers review a bounded queue.
Follow-up: tune thresholds only before the event, never during.

## ADR-008 Step-up is password re-entry now

Context: sensitive actions (activation, release, exports) needed re-auth, but WebAuthn enrollment could not be tested in this environment.
Decision: step-up = current password re-entry verified against Argon2id (`frontend/src/components/StepUp.tsx` + backend recheck); WebAuthn or Cloudflare Access deferred.
Rationale: verifiable today, no new failure modes.
Consequences: MFA stays absent (L-04, F-05).
Follow-up: WebAuthn after D1 if platform usage continues.

## ADR-009 Hidden feedback until release

Context: participants could probe the verdict oracle through feedback endpoints.
Decision: matched codes, points and per-item verdicts are withheld until the organizer releases feedback; participant state endpoints exclude them.
Rationale: closes the primary verdict oracle channel.
Consequences: frontend must render "awaiting release" states; tested in E2E.

## ADR-010 Runner disabled; organizer-recorded offline test results

Context: the spec's in-browser runner needs an isolated VM that does not exist here.
Decision: `runner_enabled=False` default (kill switch in `backend/app/config.py`); functional test results are recorded by organizers offline and applied via `apply_test_results` in `backend/app/evaluator.py`.
Rationale: shipping an un-isolated code executor would be a security hole worse than the feature gap.
Consequences: no Run panel in the UI; participants test locally; organizers paste results.
Follow-up: runner only if a hardened VM path is proven before a future event.

## ADR-011 Provisional capacity 50 participants / 10 teams

Context: proposal numbers conflicted (50 participants vs 50 teams); load capacity is unproven.
Decision: seed 10 teams x 5 = 50 participants; `max_participants` stays at the approved cap until a passing load rehearsal; raise only after LOAD_TEST_REPORT passes at cap.
Rationale: honest provisional sizing.
Consequences: the 50-user gate is UNRUN (L-12).
Follow-up: scripts/load_test.py rehearsal, then revisit.

## ADR-012 clock_timestamp() after stage-row lock

Context: submission validation needs one authoritative now that cannot straddle a stage transition.
Decision: lock the stage row first, then read `clock_timestamp()` once and validate in order (paused, not active, ended, caps, cooldown, schema) in a single transaction.
Rationale: removes a race where a deadline transition lands mid-validation.
Consequences: hot stage rows serialize briefly; fine at event scale.
Follow-up: load rehearsal will show contention numbers.

## ADR-013 AI scoring disabled by default with provider gate

Context: master prompt made AI optional; no provider was vetted.
Decision: `ai_assessment_enabled=False` default; enabling requires the DEC-13 gate checklist (approved provider, data boundary review, cost cap, kill switch test) in AI_TOOLING_RESEARCH_AND_DECISION.md.
Rationale: AI output must not affect scores before human review policy exists.
Consequences: none functional while off.
Follow-up: pre-event evaluation only if an organizer chooses to run it.

## ADR-014 Canonical award units

Context: match points and flag points needed one canonical identity to keep awards exactly-once.
Decision: award unit is `gt_bug:<code>` or `gt_flag:<code>` per (stage, team); unique DB constraint enforces no duplicates.
Rationale: replayed jobs and retries collapse to a single award.
Consequences: awards are auditable to a code string.

## ADR-015 Audit hash chain per event scope with verify endpoint

Context: tamper evidence for admin actions and ledger changes.
Decision: append-only `audit` schema rows chained by hash within an event scope; a verify endpoint recomputes the chain (`backend/app/audit.py`, route in `backend/app/routers/admin.py`).
Rationale: cheap integrity check that CI and ops can run.
Consequences: rows can never be edited; corrections are new entries.
Follow-up: include chain verify in the runbook checks.

## ADR-016 Receipt codes HMAC-derived

Context: flag capture receipts must be verifiable offline and unguessable.
Decision: receipts are HMACs over (flag id, team, stage) using a server secret (`backend/app/security.py`).
Rationale: no extra storage, deterministic verification.
Consequences: rotating the HMAC secret invalidates old receipts; rotate only between events.
Follow-up: document rotation in DEPLOYMENT_RUNBOOK checks.

## ADR-017 Purpose-built challenge app instead of a fork

Context: options were forking Juice Shop/DVWA or building a small app.
Decision: purpose-built "Papyrus" Node/Express app with `node:sqlite`, 10 planted bugs (275 pts) and 2 flags (60 pts), with `challenge-app/ORGANIZER_ANSWER_KEY.md` restricted to organizers.
Rationale: runnable end-to-end inside 180 minutes by students; small readable codebase so bugs are findable; ground truth fully controlled and documented.
Consequences: less community polish than a fork; answer key must never ship to participants (AGENTS.md trust rules).
Follow-up: keep answer key out of any participant bundle.

## ADR-018 Plain SQL migrations over Alembic

Context: schema evolution needed to be transparent and debuggable on a VM.
Decision: ordered forward-only SQL files in `backend/migrations/` applied by `scripts/migrate.sh`, tracked in `app.schema_migrations`; expand/contract discipline.
Rationale: fewer moving parts than Alembic for a 4-developer-week build; SQL is reviewable directly.
Consequences: no autogenerate; devs write SQL by hand (`scripts/gen_initial_migration.py` helped bootstrap).
Follow-up: revisit only if schema churn grows.

## ADR-019 Offline organizer-run functional tests

Context: with the runner disabled, functional_test points need a source of truth.
Decision: organizers run the challenge app's test suite offline and submit per-team results; the platform records them as a ledger component.
Rationale: keeps scoring authoritative and simple without code execution.
Consequences: organizer workload during the 60-minute window; results entry is a manual step.
Follow-up: dry run should time this step.

## ADR-020 Bespoke SVG icons and Fraunces/Archivo/Plex Mono identity

Context: icon libraries and Monaco violated the design direction (no drop shadows, gradients, emoji, icon libs) and accessibility goals.
Decision: hand-drawn inline SVG icons and a Fraunces / Archivo / Plex Mono type identity; custom accessible code viewer instead of Monaco.
Rationale: full control over rendering, keyboard use, and offline build size.
Consequences: every new icon is hand work; viewer lacks editor features (acceptable, read-only by design).
