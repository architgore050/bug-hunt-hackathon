Status: describes the implementation as of 2026-11-28 (migrations 0001 through 0004 included)

# Data Model

Source of truth: the ordered SQL files in `backend/migrations/`, applied by `scripts/migrate.sh` as the database owner (`pgadmin`). ORM mirrors live in `backend/app/models_app.py` and `models_gt.py`; handlers mostly use raw SQL through `sqlalchemy.text`. Column notes below list only constraints/defaults that matter for behavior; every table also has standard `created_at TIMESTAMPTZ DEFAULT now()` unless stated.

## 1. Migration approach

- Versioned plain SQL files in `backend/migrations/`, applied in filename order by `scripts/migrate.sh`. `app.schema_migrations (filename PRIMARY KEY, applied_at)` records what ran; applied files are skipped, `ON_ERROR_STOP=1` aborts on failure. Rationale recorded in `scripts/gen_initial_migration.py` (ADR-018): transparent, reviewable SQL over an ORM-autogenerate black box, expand/contract style.
- Migrations always run as `PGUSER=pgadmin` (database owner). Runtime roles (`app_api`, `gt_admin`) never migrate; DDL grants are established by `scripts/dev_db.sh` plus migration ownership.
- Four migrations are present: `0001_init.sql`, `0002_score_ledger_immutable.sql`, `0003_four_level_flow.sql`, and `0004_stage_ordinal_unique.sql`. The seed script (`backend/seed.py`) is data, not DDL, and is dev/test-only.

## 2. Schema `app` (32 tables, participant/admin domain)

Readable and writable by `app_api` and `gt_admin`.

### Identity and access

- `users`: `id UUID PK`, `tenant_id FK`, `email VARCHAR(320)` UNIQUE index (`ix_app_users_email`), `name`, `role VARCHAR(20)` (participant | reviewer | organizer | admin), `password_hash VARCHAR(256)` nullable (pre-activation), `status VARCHAR(20) DEFAULT 'pending'` (pending | active | disqualified), `token_version INTEGER DEFAULT 1` (bumped on password reset to kill all access tokens, AUTH-01), `registration_id`, `accommodation_note`. Indexes: role, tenant.
- `sessions`: `id UUID PK`, `user_id FK`, `last_seen_at`, `ip_hash VARCHAR(64)` (HMAC-SHA256, first 32 hex, keyed by JWT_SECRET; raw IPs never stored), `user_agent VARCHAR(300)`, `revoked_at`, `step_up_at` (5-minute elevated window, AUTH-09). Index on user_id.
- `refresh_tokens`: `id UUID PK`, `session_id FK`, `user_id FK`, `token_hash VARCHAR(64)` UNIQUE (SHA-256 of the opaque token; raw tokens never at rest), `status VARCHAR(12) DEFAULT 'active'` (active | rotated | revoked), `successor_encrypted TEXT` (Fernet-encrypted successor for the 10 s race grace, AUTH-04), `rotated_at`, `replaces_id`, `expires_at`. Indexes: user_id, session_id.
- `invites`: `event_id FK`, `email`, `token_hash UNIQUE` (single-use activation), `team_id FK nullable`, `role DEFAULT 'participant'`, `used_at`, `expires_at`. Indexes: event, email.
- `password_resets`: `user_id FK`, `token_hash UNIQUE`, `used_at`, `expires_at`.
- `acceptances`: `user_id FK`, `rules_version INTEGER`, `ip_hash`, `UNIQUE (user_id, rules_version)`; the rules gate in `deps.require_rules_accepted` reads it.
- `tenants`: `slug UNIQUE`. One tenant row is created by seed (`sdc-vitb`); multi-tenancy is modeled but v1 runs one club.

### Event, stages, time

- `events`: `slug UNIQUE`, `status DEFAULT 'draft'`, `starts_at/ends_at`, `timezone VARCHAR(60)`, `duration_minutes DEFAULT 180`, `max_participants DEFAULT 50`, `max_teams DEFAULT 12`, `rules_version DEFAULT 1`, `config JSONB` (features, scoring weights, schedule, public_summary), `config_version DEFAULT 1`. Index on tenant.
- `event_config_revisions`: `event_id FK`, `version` (per-event max+1 on insert), `config JSONB NOT NULL`, `rule_set_hash VARCHAR(80)` (sha256 of canonical JSON), `reason TEXT NOT NULL`, `created_by FK`, `frozen_at` (set when the revision freezes the event config, DAT-04).
- `stages`: `event_id FK`, `name`, `kind`, `ordinal DEFAULT 1`, `status DEFAULT 'draft'`, `starts_at/ends_at`, `grace_seconds DEFAULT 3`, `config JSONB` (caps, feedback/leaderboard modes, participant-safe `max_points` evaluation ceiling, penalty policy), `rule_set_hash`, `started_at/ended_at`. `UNIQUE (event_id, kind, ordinal)` is enforced by migration 0004. Index on event.
- `stage_transitions`: `stage_id FK`, `from_status`, `to_status` (stores the resulting status; legacy pause rows may contain `pause`), `actor_id FK`, `reason_code`. Index on stage.
- `time_adjustments`: `stage_id FK`, `user_id FK nullable` (null = whole stage), `delta_seconds INTEGER NOT NULL`, `reason_code VARCHAR(40)`, `created_by FK`. Deadline math sums global + per-user rows. Indexes: stage, user.

### Challenge content (participant-visible)

- `challenge_versions`: `event_id FK`, `slug`, `title`, `version DEFAULT 1`, `status DEFAULT 'draft'` (draft | reviewed | sealed | published), `content_hash VARCHAR(80)`, `instructions_md`, `participant_manifest JSONB`, `frozen_at`, `published_at`, `UNIQUE (event_id, slug, version)`. Once sealed, upload/freeze endpoints raise `GROUND_TRUTH_LOCKED` (DAT-04).
- `challenge_files`: `challenge_version_id FK`, `path VARCHAR(500)`, `lang`, `content TEXT` (inert text, never executed, SEC-03), `sha256`, `size_bytes`, `line_count`, `UNIQUE (challenge_version_id, path)`.
- `challenge_file_lines`: `challenge_version_id`, `path`, `line_number`, `line_text` (truncated to 500 chars at write time; index limited to 5000 lines/file). Indexes: version, `(version, line_number)` (serves the search endpoint scan).
- `assignments`: `event_id`, `stage_id FK`, `challenge_version_id FK`, `team_id FK nullable` (null = all teams), `repo_url`, `codespace_url`. Indexes on event, challenge, team, stage.
- `drafts`: `author_id FK`, `challenge_version_id FK`, `payload JSONB`, `version DEFAULT 1`, `updated_at`, `UNIQUE (author_id, challenge_version_id)`; autosave conflict detection.

### Submissions and evaluation

- `submissions`: the central table. `tenant_id`, `event_id`, `stage_id`, `challenge_version_id`, `team_id nullable`, `author_id` FKs; `kind VARCHAR(20)` (bug_report | ctf_flag); `idempotency_key VARCHAR(80)` with `UNIQUE (author_id, idempotency_key)` (DAT-02); `payload JSONB NOT NULL` (canonical client payload); `payload_hash VARCHAR(64)` (canonical JSON hash used for replay detection); `status VARCHAR(24) DEFAULT 'received'` (received | matched_auto | needs_review | in_review | decided | ledgered | rejected_auto | duplicate | disputed); `receipt_code VARCHAR(16) UNIQUE` (HMAC-derived, printed to participants); `title VARCHAR(160)`; `file_path`, `line_start`, `line_end`, `category`, `flag_code VARCHAR(200)` (plaintext at rest in app schema; verification compares HMACs, flags are low-value material); `received_at TIMESTAMPTZ NOT NULL` (the single acceptance clock value, ADR-012); `feedback_released BOOLEAN DEFAULT false` (verdict visibility switch, INT-01); `matched_bug_code VARCHAR(40)`; `points_visible NUMERIC(10,2) DEFAULT 0`; `created_at`. Indexes: stage, tenant, team, event, author, `(stage_id, received_at)`, `(team_id, status)`; the composite indexes serve the cap/cooldown queries in the submission transaction.
- `review_items`: `submission_id FK`, `status DEFAULT 'open'` (open | claimed | decided), `claimed_by FK`, `claimed_at`, `priority INTEGER DEFAULT 5` (lower = more urgent; unplanned_valid promotion items get 2), `reason VARCHAR(120)`. Index on submission.
- `reviews`: `submission_id FK`, `reviewer_id FK`, `decision VARCHAR(30)`, `rubric JSONB` (five 0..1 criteria), `quality NUMERIC(3,2) DEFAULT 1.0`, `notes`, `is_double_review BOOLEAN DEFAULT false` (column exists; double-review flow is not wired in v1, EVA-02 follow-up).
- `disputes`: `submission_id FK`, `team_id FK`, `statement TEXT`, `status DEFAULT 'open'` (open | upheld | rejected), `resolution`, `resolved_by FK`, `resolved_at`.

### Scoring

- `award_claims`: `event_id`, `stage_id`, `team_id`, `award_unit_id VARCHAR(80)` (gt bug code or flag_key), `submission_id FK`, `UNIQUE (stage_id, team_id, award_unit_id)`. This constraint is the exactly-once guarantee for scoring under at-least-once job delivery (DAT-01). Indexes: stage, team, event.
- `score_ledger_entries`: append-only by convention (no UPDATE/DELETE code paths; `test_scoring.py` asserts the convention). `tenant_id`, `event_id`, `stage_id`, `team_id` FKs; `submission_id` nullable FK; `award_unit_id VARCHAR(80)`; `component VARCHAR(30)` (functional_test | code_review | evidence_report | ctf_bonus | penalty | adjustment); `kind VARCHAR(20)` (award | bonus | penalty | adjustment); `points NUMERIC(10,2)` (negative for penalty); `reason_code VARCHAR(60)` (MATCH_FULL, ACCEPT_FULL, ACCEPT_PARTIAL, TEST_RESULTS, RELEASE_DEFAULT, FLAG_VERIFIED, INVALID_REPORT_PENALTY, DISPUTE_UPHELD, MANUAL); `actor_id` nullable; `reverses_entry_id` self-FK for corrections; `note TEXT` (match features L/C/A recorded here for replay, DAT-05). Indexes: stage, reverses, tenant, award_unit, event, team, submission.
- `leaderboard_snapshots`: `event_id`, `stage_id`, `version` (per-stage increment), `payload JSONB` (ranked rows with tie-break inputs), `visibility DEFAULT 'hidden'` (restricted | public). Indexes: stage, event. Tie-break order baked into `build_leaderboard`: total desc, fewer invalid, earlier last accepted (INT-12).

### Platform machinery

- `jobs`: `kind VARCHAR(40)`, `payload JSONB`, `status VARCHAR(12) DEFAULT 'queued'` (queued | running | done | dead), `attempts DEFAULT 0`, `max_attempts DEFAULT 5`, `run_after`, `lease_until` (120 s claim lease), `last_error TEXT`, `updated_at`. Indexes: status, `(status, run_after)` (claim path), kind.
- `outbox_events`: `event_type`, `payload JSONB`, `delivered_at`, `attempts`. Index on event_type.
- `announcements`: `event_id FK`, `severity DEFAULT 'info'`, `audience DEFAULT 'all'`, `body TEXT`, `created_by FK`. Index on event.
- `readiness_items`: `event_id`, `key`, `label`, `state DEFAULT 'unchecked'` (checked | unchecked | na), `owner`, `note`, `checked_at`, `UNIQUE (event_id, key)`. Seed installs 8 items (load test, gt isolation, backup/restore, pen test, challenge audit, dry run, rules published, runbooks); any unchecked row blocks the live transition.
- `rules_documents`: `event_id`, `version`, `body_md`, `content_hash`, `frozen_at`, `UNIQUE (event_id, version)`.
- `exports`: `event_id`, `kind`, `content`, `content_hash`, `created_by`. Note: the export endpoint currently returns CSV text directly and does not persist rows here; the table is ready for persisted exports but is unused by code as of this date.

## 2b. Migration `0003_four_level_flow.sql` (four-level event flow, 2026-11-25)

Additive expand migration; no existing table changes. Same grant model as
section 2 (app_api/gt_admin/scheduler).

- `repo_options`: data-driven option set per event (`option_key` A/B today,
  UNIQUE (event_id, option_key)), each bound to one `challenge_versions` row.
- `team_repo_choices`: one immutable choice per team (UNIQUE (team_id)),
  option key, challenge version, lock actor/time, `idempotency_key`,
  `lock_source` (lead | admin_override | auto), audit reason.
- `participant_pointers`: the server-owned monotonic node pointer; one row per
  user (UNIQUE (user_id)), `level_no` CHECK 1..4, `node` CHECK
  explain/exec/done. Only `app.flow.advance_pointer` writes it, and only
  forward.
- `participant_progress`: per-user per-level status
  (locked | available | in_progress | submitted | auto_submitted | missed),
  UNIQUE (user_id, level_no), submission link and submitted_at.
- `level_drafts`: versioned server draft per (author, level), optimistic
  concurrency like `drafts`.
- `submission_artifacts`: immutable artifact metadata (kind zip/diff/patch,
  sha256, size, entry count, uncompressed size, private storage key,
  staged->submitted status) bound to a submission at submit time. Bytes live
  behind the storage adapter (`app/storage.py`), never in the database.
- `team_members.is_lead`: explicit lead flag (one true row per team); teams
  created before the flag fall back to the deterministic lowest joined_at
  member until an organizer promotes one (`app.flow.is_team_lead`).

The four levels are `app.stages` rows with `kind='level'` and ordinals 1..4;
the v1 single-stage surfaces (state, config, assignments, v1 submissions)
filter `kind <> 'level'` so both models coexist.

## 3. Schema `gt` (6 tables, ground truth)

No `app_api` grants at all; written/read only via the `gt_admin` engine (`db.gt_session`) from the evaluator and admin gt endpoints, plus the seed script.

- `gt_bugs`: `challenge_version_id`, `code VARCHAR(40)`, `title`, `severity` (low|medium|high|critical), `category`, `points NUMERIC(8,2)`, `root_cause_group VARCHAR(80)`, `explanation TEXT`, `fix_guidance`, `UNIQUE (challenge_version_id, code)`. One row = one award unit (ADR-014).
- `gt_locations`: `bug_id FK`, `file_path`, `line_start`, `line_end`, `is_primary BOOLEAN NOT NULL`, `anchor_hash VARCHAR(64)` (SHA-256 of a 3-line window around the anchored line, computed at seed time from the actual challenge file; DAT-06 drift defense). Index on bug_id.
- `gt_aliases`: `bug_id FK`, `keyword VARCHAR(120)`, `weight NUMERIC(3,2)`; the deterministic matcher's alias-evidence input.
- `gt_flags`: `challenge_version_id`, `flag_key VARCHAR(40)`, `code_hash VARCHAR(64)` (HMAC of the plaintext flag), `points`, `max_awards INTEGER NOT NULL`, `position_label`, `UNIQUE (challenge_version_id, code_hash)`.
- `gt_test_cases`: `bug_id FK`, `name`, `description`, `expected_result`, `comparison`. Reserved for the hidden functional-test suite; organizer-recorded results arrive via the admin API in v1 (ADR-019), the table is not yet read by any code path.
- `gt_revisions`: `challenge_version_id`, `revision_no`, `reason`, `payload JSONB` (the seeded bug/flag codes). Corrections are new revisions, never in-place edits (DAT-04).

Indexes: challenge_version_id on bugs/flags/revisions, bug_id on aliases/locations/test_cases.

## 4. Schema `audit` (1 table)

- `audit.entries`: `id UUID PK`, `event_scope VARCHAR(120) DEFAULT 'global'`, `seq BIGINT DEFAULT nextval('audit.entries_seq')`, `actor_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `request_id`, `details JSONB`, `prev_hash VARCHAR(64)` ("GENESIS" at chain head), `hash VARCHAR(64)` (SHA-256 over `prev_hash|actor|role|action|entity_type|entity_id|request_id|details`), `ts TIMESTAMPTZ`. Per-scope hash chains; `audit_verify` recomputes and reports the first break. Indexes: `(event_scope, seq)`, action, actor. Grant model: app roles get INSERT + SELECT only, no UPDATE/DELETE (dev_db.sh); the chain is tamper-evident from the last external checkpoint, not attacker-proof against a full database compromise (architecture 9.5; export checkpoints are the D1 follow-up, see BACKUP_AND_RECOVERY.md).

## 5. Relationships (fast reference)

```
tenants 1--* events 1--* stages 1--* stage_transitions / time_adjustments
events 1--* challenge_versions 1--* challenge_files / challenge_file_lines
stages 1--1 assignments *--1 challenge_versions (team_id null = all teams)
users *--* teams (team_members) ; teams 1--* submissions
submissions 1--* review_items -> reviews ; submissions 1--* disputes
submissions 1--* award_claims (unique per stage+team+unit) ; submissions 1--* score_ledger_entries
stages 1--* leaderboard_snapshots ; users 1--* sessions 1--* refresh_tokens
gt_bugs 1--* gt_locations / gt_aliases / gt_test_cases
```

## 6. Trust boundary summary

| Concern | Mechanism |
| --- | --- |
| Participant code paths reach gt? | Impossible: `app_api` has zero gt grants; the HTTP app uses only `app_engine`. Verified by `tests/test_gt_isolation.py` |
| Who writes gt | `gt_admin` sessions in `routers/admin.py` gt endpoints (step-up required, pre-seal only) and `backend/seed.py` |
| Cross-team data access | Every participant query filters by `author_id`/`team_id` from the token; UUIDv7 ids are not enumerable |
| Score mutation | None; append-only ledger plus reversal/adjustment entries |
| Verdict leakage | `submissions.feedback_released` gates every participant-facing verdict field |
