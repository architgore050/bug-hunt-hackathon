-- 0002_four_level_flow.sql: tables for the four-level participant event flow.
-- Additive expand migration: no existing table or column is modified or removed.
-- Applied by scripts/migrate.sh as pgadmin; runtime grants follow dev_db.sh
-- default privileges, plus explicit grants below for existing clusters.

-- The team lead is an explicit flag (one true row per team). Teams created
-- before this migration fall back to the deterministic lowest joined_at
-- member in app/flow.py until an organizer promotes a lead.
ALTER TABLE app.team_members ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_app_team_members_team_lead ON app.team_members (team_id, is_lead);

-- Data-driven repo options (more options can be added later without a model rewrite).
CREATE TABLE app.repo_options (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES app.events (id),
    option_key VARCHAR(10) NOT NULL,
    label VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    challenge_version_id UUID NOT NULL REFERENCES app.challenge_versions (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, option_key)
);

-- One immutable choice per team. lock_source: lead | admin_override | auto.
CREATE TABLE app.team_repo_choices (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES app.events (id),
    team_id UUID NOT NULL REFERENCES app.teams (id) UNIQUE,
    option_key VARCHAR(10) NOT NULL,
    challenge_version_id UUID NOT NULL REFERENCES app.challenge_versions (id),
    locked_by UUID REFERENCES app.users (id),
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key VARCHAR(80),
    lock_source VARCHAR(20) NOT NULL DEFAULT 'lead',
    audit_reason TEXT,
    UNIQUE (event_id, team_id)
);

-- The server-owned monotonic node pointer. node: explain | exec | done.
CREATE TABLE app.participant_pointers (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES app.users (id),
    event_id UUID NOT NULL REFERENCES app.events (id),
    level_no INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 4),
    node VARCHAR(20) NOT NULL CHECK (node IN ('explain', 'exec', 'done')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-level participant status. status: locked | available | in_progress |
-- submitted | auto_submitted | missed.
CREATE TABLE app.participant_progress (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app.users (id),
    event_id UUID NOT NULL REFERENCES app.events (id),
    level_no INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 4),
    status VARCHAR(20) NOT NULL DEFAULT 'locked'
        CHECK (status IN ('locked', 'available', 'in_progress', 'submitted', 'auto_submitted', 'missed')),
    submission_id UUID REFERENCES app.submissions (id),
    submitted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, level_no)
);

-- Server drafts per participant per level (flags for L1/L2, edited workspace
-- files and notes for L3/L4). Versioned for optimistic concurrency.
CREATE TABLE app.level_drafts (
    id UUID PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES app.users (id),
    event_id UUID NOT NULL REFERENCES app.events (id),
    level_no INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 4),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (author_id, level_no)
);

-- Immutable artifact metadata for uploads and computed diffs. Artifacts are
-- staged while the participant works and bound to a submission at submit time.
-- Bytes live behind the storage adapter (private local dir in D0); the API
-- never stores artifact content in the database.
CREATE TABLE app.submission_artifacts (
    id UUID PRIMARY KEY,
    submission_id UUID REFERENCES app.submissions (id),
    owner_id UUID NOT NULL REFERENCES app.users (id),
    event_id UUID NOT NULL REFERENCES app.events (id),
    level_no INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 4),
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('zip', 'diff', 'patch')),
    filename VARCHAR(300) NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    size_bytes INTEGER NOT NULL,
    entry_count INTEGER NOT NULL DEFAULT 0,
    uncompressed_bytes BIGINT NOT NULL DEFAULT 0,
    storage_key VARCHAR(300) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'submitted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_app_repo_options_event_id ON app.repo_options (event_id);
CREATE INDEX ix_app_team_repo_choices_event_id ON app.team_repo_choices (event_id);
CREATE INDEX ix_app_participant_pointers_event_id ON app.participant_pointers (event_id);
CREATE INDEX ix_app_participant_progress_event_id ON app.participant_progress (event_id);
CREATE INDEX ix_app_participant_progress_user_id ON app.participant_progress (user_id);
CREATE INDEX ix_app_level_drafts_author_id ON app.level_drafts (author_id);
CREATE INDEX ix_app_submission_artifacts_owner ON app.submission_artifacts (owner_id, level_no, status);
CREATE INDEX ix_app_submission_artifacts_submission ON app.submission_artifacts (submission_id);

GRANT ALL ON app.repo_options, app.team_repo_choices, app.participant_pointers,
    app.participant_progress, app.level_drafts, app.submission_artifacts TO app_api;
GRANT ALL ON app.repo_options, app.team_repo_choices, app.participant_pointers,
    app.participant_progress, app.level_drafts, app.submission_artifacts TO gt_admin;
GRANT ALL ON app.repo_options, app.team_repo_choices, app.participant_pointers,
    app.participant_progress, app.level_drafts, app.submission_artifacts TO scheduler;
