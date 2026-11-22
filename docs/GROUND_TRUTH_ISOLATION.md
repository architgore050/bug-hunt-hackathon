Status: describes the implementation as of 2026-11-22

# Ground-Truth Isolation

The answer key (which bugs are planted where, their point values, alias keywords, and the CTF flag values) is the single most damaging secret in the system (INT-07, DAT-03). One leak invalidates the event. This document describes how the implementation keeps participant code paths and the participant API structurally unable to reach it, and how that is verified.

## 1. The threat

- A serialization bug or over-broad query in a participant-facing endpoint returns gt rows (DAT-03).
- SQL injection into a participant query reads gt. Mitigated structurally: all queries are parameterized `sqlalchemy.text()` calls; there is no string-built SQL in any router.
- A participant API process compromised through a web bug exfiltrates the key. Mitigated by least-privilege DB roles: the process holds no credentials that can read gt, so even full application compromise does not yield the key (the DB credential boundary holds).
- The key is edited mid-round to change outcomes (DAT-04). Mitigated by version freezing: gt writes are refused once a challenge version is sealed.
- The organizer answer-key file leaks through the platform (a file listing or content endpoint serving it). Mitigated by never ingesting it: `backend/seed.py` uploads an explicit allow-list of 11 participant files, and `ORGANIZER_ANSWER_KEY.md` is not among them.

## 2. Schema and role design

Three PostgreSQL schemas, created and granted by `scripts/dev_db.sh`:

| Schema | Contents | Roles with access |
| --- | --- | --- |
| `app` | Domain data, jobs, submissions, ledger | `app_api`, `gt_admin`, `scheduler` (full) |
| `gt` | `gt_bugs`, `gt_locations`, `gt_aliases`, `gt_flags`, `gt_test_cases`, `gt_revisions` | `gt_admin` only (USAGE + CREATE + full DML) |
| `audit` | `audit.entries` | both app roles: INSERT + SELECT only (no UPDATE/DELETE) |

Key points from the grant script:

- `app_api` is never granted anything on `gt`, including in `ALTER DEFAULT PRIVILEGES`, so future gt tables are equally unreachable.
- `app_api`'s `search_path` is `app`; `gt_admin`'s is `app, gt`.
- The application creates two SQLAlchemy engines (`backend/app/db.py`): `app_engine` (role `app_api`, used by every HTTP path) and `gt_engine` (role `gt_admin`, used only by evaluator handlers in `backend/app/evaluator.py`, the admin gt endpoints in `routers/admin.py`, and `seed.py`). The docstring at the top of `db.py` states the boundary; the import graph enforces it in practice: routers import `app_session`, never `gt_session`, except the three admin gt endpoints, which are step-up gated.

## 3. Who can write gt, and when

Writers: organizers via `POST /v1/admin/challenges/{id}/ground-truth/bugs|flags|test-results` and the dev seed script.

Timing rules enforced in `routers/admin.py`:

- `add_bug` and the file upload/freeze endpoints check `challenge_versions.status` and raise 409 `GROUND_TRUTH_LOCKED` unless the version is `draft` or `reviewed`. Once `freeze` sets `sealed` (and `publish` sets `published`), bug and file content are frozen for the event (DAT-04). Corrections after that point are a new challenge version plus a `gt_revisions` row, never in-place edits; the `gt_revisions` table exists for exactly this and is written at seed time.
- Flag registration writes only `code_hash = HMAC-SHA256(flag_code, JWT_SECRET)`; flag plaintext never rests in the database. Verification (`verify_flag` in `evaluator.py`) hashes the submitted code and compares, so even a read of `gt.gt_flags` reveals nothing directly usable.
- `record_test_results` does not write gt at all; it enqueues the `apply_test_results` job which reads bug point values through the gt engine.
- All gt endpoints require `step_up_verified` (5-minute password re-confirmation, AUTH-09) and write audit entries with scope `challenge:{id}` from the gt session.

## 4. Location anchors (DAT-06)

Ground-truth line numbers drift when files are reformatted, so seed-time locations are anchored: `seed.py::find_line` matches a regex pattern against the actual challenge file to locate the bug line, stores `line_start = lineno-1, line_end = lineno+1`, and computes `anchor_hash = sha256` of the 3-line window around it. If an anchor pattern is not found the seed prints a warning and skips the location rather than storing a wrong line. Comparing stored anchors against the frozen file hashes detects drift; a full anchor-validation gate at freeze time is a documented follow-up (the freeze endpoint hashes the file set but does not yet re-verify gt anchors).

## 5. What participant code paths can never touch

Enumerated from the code (routers are the only participant-reachable surface):

- No participant endpoint imports or opens `gt_session`. Verified by reading `routers/*.py`: only `admin.py` uses it, in the three gt endpoints, behind `require_organizer` + `step_up_verified`.
- No participant response includes gt-derived values before release: match verdicts (`matched_bug_code`), points and statuses are gated by `submissions.feedback_released` (INT-01), and `GET /v1/config` whitelists safe operational keys only.
- The search endpoint (`GET /v1/challenges/{id}/search`) reads `app.challenge_file_lines` (the participant-visible copy), never gt.
- The evaluator's gt reads happen in the worker with the gt role and produce only coarse statuses plus ledger notes; ledger notes DO contain feature values (L/C/A and bug codes) but the ledger is participant-visible only after release and only for the team's own entries.

## 6. The two verification tests and how to run them

### 6.1 Psycopg role test (`backend/tests/test_gt_isolation.py`)

Connects with the REAL `app_api` DSN (no test shortcuts) and asserts real PostgreSQL errors:

1. `test_app_role_cannot_read_gt_bugs`: `SELECT * FROM gt.gt_bugs` raises `InsufficientPrivilege`.
2. `test_app_role_cannot_read_gt_flags`: `SELECT code_hash FROM gt.gt_flags` raises `InsufficientPrivilege`.
3. `test_app_role_cannot_write_gt`: `INSERT INTO gt.gt_aliases ...` raises `InsufficientPrivilege`.
4. `test_gt_admin_role_can_read_gt`: the gt role reads >= 10 seeded bugs (positive control).
5. `test_platform_never_serves_answer_key`: through the authenticated participant API, the assignment file list contains no `ORGANIZER_ANSWER_KEY.md` (and nothing prefixed `ORGANIZER`).

Run:

```bash
bash scripts/run_dev.sh          # or ensure scripts/dev_db.sh + migrate.sh ran for DB bughunt_test
cd backend && python -m pytest tests/test_gt_isolation.py -v
```

`conftest.py` builds the `bughunt_test` database with the same role grants and seeds it once per session.

### 6.2 Answer-key-not-served e2e check (`scripts/e2e_journey.py`)

Step 3 of the journey fetches `GET /v1/challenges/{id}/files/content?path=ORGANIZER_ANSWER_KEY.md` and asserts HTTP 404, alongside the path-traversal check (`../../etc/passwd` -> 400). Run the full journey:

```bash
bash scripts/run_dev.sh          # starts API + worker, waits for /health
python scripts/e2e_journey.py    # 46 checks, exit code 0 required
```

Both tests must be green before the `gt_isolation` readiness item ("app_api cannot read gt, tested with the real role") is checked for an event; going live is blocked by the readiness gate while it is unchecked.

## 7. Residual risks, honestly

1. The gt boundary is one shared PostgreSQL instance with schema-level grants. It is not a separate server; a PostgreSQL-level misconfiguration (for example someone re-running grants manually) is the main residual risk. Re-run the role test after any database change.
2. `gt_admin` can also read and write all of `app` (by design: the evaluator updates submissions/ledger). A bug in evaluator code could therefore corrupt app data, though not leak gt to participants.
3. Ledger notes record bug codes and match features, which are verdict material; they are only exposed team-scoped and post-release.
4. The seed script holds flag plaintexts and runs with the gt role; it is dev-only and must never run against a production database (its docstring says so; there is no technical guard).
5. Anchor-hash drift validation at freeze time is not implemented yet (Section 4).
