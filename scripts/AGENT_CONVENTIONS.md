# Agent conventions for fixing the 68 remaining findings

You are one of several parallel agents fixing audit findings in the Bug Hunt CTF
repo at `/home/z/my-project/repo` (branch `fix/68-remaining-findings`).

## CRITICAL: file ownership

You share ONE working tree with ~60 other agents running at the same time. To
avoid clobbering each other's edits, you MUST only modify the files listed in
YOUR task's "Files you own" section. Do NOT touch any other file, even for a
trivial import fix — instead, note the needed cross-file change in your final
report and the orchestrator will handle it.

Files already modified by the orchestrator's foundation commit (DO NOT re-edit
these unless your task explicitly lists them):
- `backend/app/tenancy.py` (NEW — shared tenant-scoping helpers)
- `backend/app/deps.py` (Principal.tenant_id, require_rules_accepted tenant-scoped, rate_limit retry_after)
- `backend/app/config.py` (argon2 bounds, minimum_client_version, validate_production_config)
- `backend/app/main.py` (lifespan fail-closed, client-version gate, security headers, Content-Length validation)
- `backend/app/errors.py` (Retry-After header, new error codes)
- `backend/app/audit.py` (advisory lock + all-scope verify)

## What you can rely on (foundation already in place)

- `from app.deps import Principal` — `Principal` now has `.tenant_id: str | None`
  (server-derived, never from request body).
- `from app.tenancy import (require_event_in_tenant, require_stage_in_tenant,
  require_team_in_tenant, require_challenge_in_tenant, require_submission_in_tenant,
  require_dispute_in_tenant, require_tenant, tenant_filter_clause)` — each loads
  a row scoped to the principal's tenant and raises `ApiError("NOT_FOUND")` if
  missing/foreign. Use these in routers instead of bare `WHERE id = :id` queries.
- `from app.config import settings` — has `settings.argon2_time_cost`,
  `settings.argon2_memory_cost`, `settings.argon2_parallelism`,
  `settings.minimum_client_version`.
- `from app.errors import ApiError` — new codes available: `FINALIZE_BLOCKED`,
  `RELEASE_BLOCKED`, `REASON_REQUIRED`, `CLIENT_VERSION_UNSUPPORTED`,
  `RESCORE_NOT_AVAILABLE`, `AUDIT_CHAIN_BROKEN`.
- `from app.audit import audit_write, audit_verify` — `audit_write` is now
  concurrency-safe (advisory lock); `audit_verify(session)` with no scope arg
  walks ALL scopes.
- `rate_limit(...)` now raises `AUTH_RATE_LIMITED` with `retry_after_s` in
  details, and the error handler emits a `Retry-After` header.

## Code style (MUST follow — CI enforces ruff)

- Python 3.12, line length 120, ruff rules E/F/B/UP/I/SIM/C4/PIE/RUF/DTZ/BLE.
- Run `ruff check <your files>` and `ruff format <your files>` before reporting
  done. Both must pass. The orchestrator will re-run on the whole tree.
- Use `from __future__ import annotations` at the top of every new/edited module.
- No bare `except:` — use `except Exception:` (BLE rule) and only when justified.
- No `datetime.utcnow()` / `datetime.now()` without tz — use `datetime.now(UTC)`
  (DTZ rule). `from datetime import UTC`.
- Match the surrounding code's idiom: raw `text(...)` SQL with bind params, the
  `with app_session() as s:` context manager, `.mappings().first()` for dict rows.

## Testing

There is no PostgreSQL available in this sandbox, so you CANNOT run the pytest
suite. You CAN and MUST:
- Run `python3 -m compileall <your .py files>` — must pass.
- Run `ruff check <your .py files>` and `ruff format --check <your .py files>` — must pass.
- For frontend: run `npx tsc --noEmit -p frontend/tsconfig.app.json` from the
  repo root if you touched any `.ts`/`.tsx` file — must pass.
- Add focused regression tests where the finding's acceptance criteria demand
  one; place them in the test file your task names. They will be exercised by
  the orchestrator's final verification once a DB is available, but they must at
  least import cleanly (`python3 -m compileall`).

## Reading the finding

Your finding detail is in `/home/z/my-project/repo/scripts/findings/<ID>.json`.
Read it fully — it has `problem`, `impact`, `verification.evidence_paths`, and
`solution` with `implementation_steps`, `acceptance_criteria`, and
`regression_tests`. Follow the implementation steps; they are specific.

## What "fix" means here

Each finding has a `status`:
- `confirmed` / `partially_fixed`: implement the solution steps in code.
- `needs_owner_decision` / `needs_manual_revalidation`: you cannot fully close
  these (they need a human or external evidence). For these, implement the
  *code-side* part that is unambiguous, add a clear `# OWNER-DECISION:` /
  `# MANUAL-REVALIDATION:` comment at the relevant site describing what remains,
  and report what you did and what is genuinely blocked.
- `deferred_by_design`: do NOT implement; just confirm in your report that the
  finding is intentionally out of scope and why (one sentence).

Do NOT invent features the finding doesn't ask for. Do NOT delete existing tests.
Do NOT reformat files you don't own. Keep diffs minimal and surgical.

## Your final report

Reply with:
1. **Finding ID and one-line summary of what you changed.**
2. **Files modified** (exact paths).
3. **Files you needed to touch but don't own** (so the orchestrator can do it) —
   be specific about the change.
4. **Verification you ran** (compileall / ruff / tsc results).
5. **What remains blocked** (owner-decision / manual-revalidation / external).
6. Any **new error codes or DB columns** the orchestrator must know about.
