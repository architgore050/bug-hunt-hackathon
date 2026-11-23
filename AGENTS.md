# AGENTS.md - working rules for AI agents and engineers on this repo

This file governs any AI agent or human contributor working in
`bug-hunt-hackathon/`. Read it before writing code.

## Identity and naming

- The product is **Bug Hunt CTF**. The event is **Fall Back** (Software
  Development Club, VIT Bhopal University). Keep the names distinct.
- **Echelon is out of scope.** It must not appear in product, UI, routes,
  copy, data, or new documentation.
- The submitted proposal PDF is immutable. The proposal's facts (6 December
  2026, 180 minutes, offline, teams of 4-5) are the official preset; the
  platform preset in `backend/seed.py` mirrors them.

## Trust rules

- The GitHub token for this repo is a secret: read it only from the user's
  upload store or an environment variable; never paste it into source,
  `.env.example`, shell history, markdown, logs, screenshots, or commits.
- `challenge-app/ORGANIZER_ANSWER_KEY.md` is RESTRICTED. Never ship it to
  participants, the participant API, or any frontend bundle. The platform seed
  ingests only the participant file list from `backend/seed.py`.
- Demo credentials in `backend/seed.py` are dev-only. Before any real event,
  replace them and rotate `JWT_SECRET` via environment configuration.

## Engineering invariants (do not break)

1. The server owns time, state and truth. Client input never decides
   eligibility, deadlines, verdicts or scores. Identity comes from the token,
   never from the body.
2. Ground truth is a separate trust domain. Participant-facing code paths must
   never touch the `gt` schema (enforced by the `app_api` DB role and tested
   in `backend/tests/test_gt_isolation.py`).
3. The score ledger is append-only. Corrections are reversal/adjustment
   entries that reference the original; never UPDATE or DELETE ledger rows.
4. Award claims are unique per (stage, team, award unit) at the database
   level. Handlers stay idempotent; the queue delivers at-least-once.
5. Submissions: reserve idempotency key first, lock the stage row, read
   `clock_timestamp()` once, validate in order (paused → not active → ended →
   caps → cooldown → schema), commit everything in one transaction.
6. Feedback is hidden until release. Participant endpoints must not leak
   verdicts, matched bug codes, or points before `feedback_released`.
7. Error responses use the envelope in `backend/app/errors.py` with a stable
   catalog code; never leak stack traces or account-existence signals.
8. Migrations are ordered SQL files in `backend/migrations/`, applied by
   `scripts/migrate.sh`, forward-only, expand/contract; no destructive change
   without a forward fix.
9. Frontend follows `docs/FRONTEND_DESIGN_DIRECTION.md` (case-file design
   system, bespoke SVG icons, no drop shadows/gradients/emoji/icon libraries,
   no em dashes in UI copy) and never renders participant content as HTML
   (`PlainMarkdown` / text nodes only).
10. Every user-visible claim of capacity, performance or security must be
    measured or marked provisional. Never fabricate test results.

## Testing gates

- `cd backend && pytest` must pass (34 tests) before any backend change merges.
- `scripts/e2e_journey.py` (46 checks, needs running API + worker + seeded DB)
  before any release-worthy change.
- `cd frontend && npm run build` must be clean; no TODO/Lorem/XXX anywhere.

## Conventions

- Python: SQLAlchemy 2.0 style, raw SQL through `text()` with explicit
  `CAST(... AS uuid)` for parameters; server defaults for anything raw SQL
  inserts may skip.
- Docs: English only, no em dashes, real content only, status header on top,
  unverified claims marked "unverified".
- Commits: imperative, one logical change, no secrets in messages.
