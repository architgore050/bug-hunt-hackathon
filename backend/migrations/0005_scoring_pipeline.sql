-- 0005_scoring_pipeline.sql: additive schema for crash-resumable evaluation,
-- per-member L3/L4 score tracking, and runner evaluation jobs.
-- Forward-only expand migration; grants follow 0003_four_level_flow.sql.

ALTER TABLE app.submissions
    ADD COLUMN IF NOT EXISTS evaluation_state VARCHAR(20) NOT NULL DEFAULT 'RECEIVED';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_app_submissions_evaluation_state'
    ) THEN
        ALTER TABLE app.submissions
            ADD CONSTRAINT ck_app_submissions_evaluation_state
            CHECK (evaluation_state IN ('RECEIVED', 'QUEUED', 'EVALUATING', 'SCORED', 'NEEDS_REVIEW', 'FAILED'));
    END IF;
END $$;

ALTER TABLE app.submissions
    ADD COLUMN IF NOT EXISTS evaluation_error TEXT;

CREATE TABLE IF NOT EXISTS app.submission_flag_results (
    id UUID PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES app.submissions (id),
    flag_index INTEGER NOT NULL,
    outcome VARCHAR(24) NOT NULL,
    matched_bug_code VARCHAR(40),
    location_score NUMERIC(5, 4) NOT NULL DEFAULT 0,
    category_score NUMERIC(5, 4) NOT NULL DEFAULT 0,
    alias_evidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
    claimed_award BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (submission_id, flag_index)
);

CREATE TABLE IF NOT EXISTS app.submission_scores (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES app.events (id),
    stage_id UUID NOT NULL REFERENCES app.stages (id),
    team_id UUID NOT NULL REFERENCES app.teams (id),
    submission_id UUID NOT NULL UNIQUE REFERENCES app.submissions (id),
    author_id UUID NOT NULL REFERENCES app.users (id),
    total_points NUMERIC(10, 2) NOT NULL DEFAULT 0,
    components JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_team_best BOOLEAN NOT NULL DEFAULT false,
    received_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.runner_evaluations (
    id UUID PRIMARY KEY,
    submission_id UUID REFERENCES app.submissions (id),
    artifact_id UUID REFERENCES app.submission_artifacts (id),
    challenge_version_id UUID NOT NULL REFERENCES app.challenge_versions (id),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('practice_run', 'l3_eval', 'l4_eval', 'diff_check')),
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'unavailable')),
    exit_code INTEGER,
    tests_passed INTEGER,
    tests_total INTEGER,
    variant_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    side_quest_passed BOOLEAN,
    stdout_truncated TEXT,
    stderr_truncated TEXT,
    error_code VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_app_submission_flag_results_sub ON app.submission_flag_results (submission_id);
CREATE INDEX IF NOT EXISTS ix_app_submission_scores_stage_team ON app.submission_scores (stage_id, team_id, total_points DESC);
CREATE INDEX IF NOT EXISTS ix_app_runner_evaluations_sub ON app.runner_evaluations (submission_id);

GRANT ALL ON app.submission_flag_results, app.submission_scores, app.runner_evaluations TO app_api;
GRANT ALL ON app.submission_flag_results, app.submission_scores, app.runner_evaluations TO gt_admin;
GRANT ALL ON app.submission_flag_results, app.submission_scores, app.runner_evaluations TO scheduler;
