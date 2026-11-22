-- 0001_init.sql: initial schema for the Bug Hunt CTF platform (v1).
-- Applied by scripts/migrate.sh in order. Idempotency: tracked in app.schema_migrations.

-- ===== schema: audit (append-only) =====
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SEQUENCE IF NOT EXISTS audit.entries_seq;
CREATE TABLE IF NOT EXISTS audit.entries (
    id UUID PRIMARY KEY,
    event_scope VARCHAR(120) NOT NULL DEFAULT 'global',
    seq BIGINT NOT NULL DEFAULT nextval('audit.entries_seq'),
    actor_id UUID,
    actor_role VARCHAR(30) NOT NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(60) NOT NULL,
    entity_id VARCHAR(80),
    request_id VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_entries_scope_seq ON audit.entries (event_scope, seq);
CREATE INDEX IF NOT EXISTS ix_audit_entries_action ON audit.entries (action);
CREATE INDEX IF NOT EXISTS ix_audit_entries_actor ON audit.entries (actor_id);

-- ===== schema: app (participant/admin domain) =====
-- ===== schema: app =====
CREATE TABLE app.jobs (
	id UUID NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	payload JSONB DEFAULT '{}'::jsonb NOT NULL, 
	status VARCHAR(12) DEFAULT 'queued' NOT NULL, 
	attempts INTEGER DEFAULT 0 NOT NULL, 
	max_attempts INTEGER DEFAULT 5 NOT NULL, 
	run_after TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	lease_until TIMESTAMP WITH TIME ZONE, 
	last_error TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE app.outbox_events (
	id UUID NOT NULL, 
	event_type VARCHAR(60) NOT NULL, 
	payload JSONB DEFAULT '{}'::jsonb NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	delivered_at TIMESTAMP WITH TIME ZONE, 
	attempts INTEGER DEFAULT 0 NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE app.tenants (
	id UUID NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	slug VARCHAR(80) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (slug)
);

CREATE TABLE app.events (
	id UUID NOT NULL, 
	tenant_id UUID NOT NULL, 
	slug VARCHAR(80) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	status VARCHAR(20) DEFAULT 'draft' NOT NULL, 
	starts_at TIMESTAMP WITH TIME ZONE, 
	ends_at TIMESTAMP WITH TIME ZONE, 
	timezone VARCHAR(60) NOT NULL, 
	duration_minutes INTEGER DEFAULT 180 NOT NULL, 
	max_participants INTEGER DEFAULT 50 NOT NULL, 
	max_teams INTEGER DEFAULT 12 NOT NULL, 
	rules_version INTEGER DEFAULT 1 NOT NULL, 
	config JSONB DEFAULT '{}'::jsonb NOT NULL, 
	config_version INTEGER DEFAULT 1 NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(tenant_id) REFERENCES app.tenants (id), 
	UNIQUE (slug)
);

CREATE TABLE app.users (
	id UUID NOT NULL, 
	tenant_id UUID NOT NULL, 
	email VARCHAR(320) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	password_hash VARCHAR(256), 
	status VARCHAR(20) DEFAULT 'pending' NOT NULL, 
	token_version INTEGER DEFAULT 1 NOT NULL, 
	registration_id VARCHAR(64), 
	accommodation_note TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(tenant_id) REFERENCES app.tenants (id)
);

CREATE TABLE app.acceptances (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	rules_version INTEGER NOT NULL, 
	accepted_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	ip_hash VARCHAR(64), 
	PRIMARY KEY (id), 
	UNIQUE (user_id, rules_version), 
	FOREIGN KEY(user_id) REFERENCES app.users (id)
);

CREATE TABLE app.announcements (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	severity VARCHAR(20) DEFAULT 'info' NOT NULL, 
	audience VARCHAR(20) DEFAULT 'all' NOT NULL, 
	body TEXT NOT NULL, 
	created_by UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(created_by) REFERENCES app.users (id)
);

CREATE TABLE app.challenge_versions (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	slug VARCHAR(80) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	version INTEGER DEFAULT 1 NOT NULL, 
	status VARCHAR(20) DEFAULT 'draft' NOT NULL, 
	content_hash VARCHAR(80), 
	instructions_md TEXT, 
	participant_manifest JSONB DEFAULT '{}'::jsonb NOT NULL, 
	frozen_at TIMESTAMP WITH TIME ZONE, 
	published_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (event_id, slug, version), 
	FOREIGN KEY(event_id) REFERENCES app.events (id)
);

CREATE TABLE app.event_config_revisions (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	config JSONB NOT NULL, 
	rule_set_hash VARCHAR(80) NOT NULL, 
	reason TEXT NOT NULL, 
	created_by UUID NOT NULL, 
	frozen_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(created_by) REFERENCES app.users (id)
);

CREATE TABLE app.exports (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	content TEXT NOT NULL, 
	content_hash VARCHAR(80) NOT NULL, 
	created_by UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(created_by) REFERENCES app.users (id)
);

CREATE TABLE app.password_resets (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES app.users (id), 
	UNIQUE (token_hash)
);

CREATE TABLE app.readiness_items (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	key VARCHAR(80) NOT NULL, 
	label VARCHAR(200) NOT NULL, 
	state VARCHAR(20) DEFAULT 'unchecked' NOT NULL, 
	owner VARCHAR(120), 
	note TEXT, 
	checked_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	UNIQUE (event_id, key), 
	FOREIGN KEY(event_id) REFERENCES app.events (id)
);

CREATE TABLE app.rules_documents (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	body_md TEXT NOT NULL, 
	content_hash VARCHAR(80) NOT NULL, 
	frozen_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (event_id, version), 
	FOREIGN KEY(event_id) REFERENCES app.events (id)
);

CREATE TABLE app.sessions (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	ip_hash VARCHAR(64), 
	user_agent VARCHAR(300), 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	step_up_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES app.users (id)
);

CREATE TABLE app.stages (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	ordinal INTEGER DEFAULT 1 NOT NULL, 
	status VARCHAR(20) DEFAULT 'draft' NOT NULL, 
	starts_at TIMESTAMP WITH TIME ZONE, 
	ends_at TIMESTAMP WITH TIME ZONE, 
	grace_seconds INTEGER DEFAULT 3 NOT NULL, 
	config JSONB DEFAULT '{}'::jsonb NOT NULL, 
	rule_set_hash VARCHAR(80), 
	started_at TIMESTAMP WITH TIME ZONE, 
	ended_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id)
);

CREATE TABLE app.teams (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	join_code VARCHAR(12) NOT NULL, 
	status VARCHAR(20) DEFAULT 'active' NOT NULL, 
	seat_label VARCHAR(40), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	UNIQUE (join_code)
);

CREATE TABLE app.assignments (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	team_id UUID, 
	repo_url VARCHAR(300), 
	codespace_url VARCHAR(300), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id), 
	FOREIGN KEY(challenge_version_id) REFERENCES app.challenge_versions (id), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id)
);

CREATE TABLE app.challenge_file_lines (
	id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	path VARCHAR(500) NOT NULL, 
	line_number INTEGER NOT NULL, 
	line_text TEXT NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(challenge_version_id) REFERENCES app.challenge_versions (id)
);

CREATE TABLE app.challenge_files (
	id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	path VARCHAR(500) NOT NULL, 
	lang VARCHAR(20) NOT NULL, 
	content TEXT NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	size_bytes INTEGER NOT NULL, 
	line_count INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (challenge_version_id, path), 
	FOREIGN KEY(challenge_version_id) REFERENCES app.challenge_versions (id)
);

CREATE TABLE app.drafts (
	id UUID NOT NULL, 
	author_id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	payload JSONB DEFAULT '{}'::jsonb NOT NULL, 
	version INTEGER DEFAULT 1 NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (author_id, challenge_version_id), 
	FOREIGN KEY(author_id) REFERENCES app.users (id), 
	FOREIGN KEY(challenge_version_id) REFERENCES app.challenge_versions (id)
);

CREATE TABLE app.invites (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	email VARCHAR(320) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	team_id UUID, 
	role VARCHAR(20) DEFAULT 'participant' NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	UNIQUE (token_hash), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id)
);

CREATE TABLE app.leaderboard_snapshots (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	payload JSONB NOT NULL, 
	visibility VARCHAR(20) DEFAULT 'hidden' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id)
);

CREATE TABLE app.refresh_tokens (
	id UUID NOT NULL, 
	session_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	status VARCHAR(12) DEFAULT 'active' NOT NULL, 
	successor_encrypted TEXT, 
	rotated_at TIMESTAMP WITH TIME ZONE, 
	replaces_id UUID, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES app.sessions (id), 
	FOREIGN KEY(user_id) REFERENCES app.users (id), 
	UNIQUE (token_hash)
);

CREATE TABLE app.stage_transitions (
	id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	from_status VARCHAR(20), 
	to_status VARCHAR(20) NOT NULL, 
	actor_id UUID, 
	reason_code VARCHAR(60), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id), 
	FOREIGN KEY(actor_id) REFERENCES app.users (id)
);

CREATE TABLE app.submissions (
	id UUID NOT NULL, 
	tenant_id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	team_id UUID, 
	author_id UUID NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	idempotency_key VARCHAR(80) NOT NULL, 
	payload JSONB NOT NULL, 
	payload_hash VARCHAR(64) NOT NULL, 
	status VARCHAR(24) DEFAULT 'received' NOT NULL, 
	receipt_code VARCHAR(16) NOT NULL, 
	title VARCHAR(160) NOT NULL, 
	file_path VARCHAR(500), 
	line_start INTEGER, 
	line_end INTEGER, 
	category VARCHAR(60), 
	flag_code VARCHAR(200), 
	received_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	feedback_released BOOLEAN DEFAULT false NOT NULL, 
	matched_bug_code VARCHAR(40), 
	points_visible NUMERIC(10, 2) DEFAULT 0 NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (author_id, idempotency_key), 
	FOREIGN KEY(tenant_id) REFERENCES app.tenants (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id), 
	FOREIGN KEY(challenge_version_id) REFERENCES app.challenge_versions (id), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id), 
	FOREIGN KEY(author_id) REFERENCES app.users (id), 
	UNIQUE (receipt_code)
);

CREATE TABLE app.team_members (
	id UUID NOT NULL, 
	team_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	seat_label VARCHAR(40), 
	joined_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (team_id, user_id), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id), 
	FOREIGN KEY(user_id) REFERENCES app.users (id)
);

CREATE TABLE app.time_adjustments (
	id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	user_id UUID, 
	delta_seconds INTEGER NOT NULL, 
	reason_code VARCHAR(40) NOT NULL, 
	created_by UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id), 
	FOREIGN KEY(user_id) REFERENCES app.users (id), 
	FOREIGN KEY(created_by) REFERENCES app.users (id)
);

CREATE TABLE app.award_claims (
	id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	team_id UUID NOT NULL, 
	award_unit_id VARCHAR(80) NOT NULL, 
	submission_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (stage_id, team_id, award_unit_id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id), 
	FOREIGN KEY(submission_id) REFERENCES app.submissions (id)
);

CREATE TABLE app.disputes (
	id UUID NOT NULL, 
	submission_id UUID NOT NULL, 
	team_id UUID NOT NULL, 
	statement TEXT NOT NULL, 
	status VARCHAR(20) DEFAULT 'open' NOT NULL, 
	resolution TEXT, 
	resolved_by UUID, 
	resolved_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(submission_id) REFERENCES app.submissions (id), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id), 
	FOREIGN KEY(resolved_by) REFERENCES app.users (id)
);

CREATE TABLE app.review_items (
	id UUID NOT NULL, 
	submission_id UUID NOT NULL, 
	status VARCHAR(20) DEFAULT 'open' NOT NULL, 
	claimed_by UUID, 
	claimed_at TIMESTAMP WITH TIME ZONE, 
	priority INTEGER DEFAULT 5 NOT NULL, 
	reason VARCHAR(120), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(submission_id) REFERENCES app.submissions (id), 
	FOREIGN KEY(claimed_by) REFERENCES app.users (id)
);

CREATE TABLE app.reviews (
	id UUID NOT NULL, 
	submission_id UUID NOT NULL, 
	reviewer_id UUID NOT NULL, 
	decision VARCHAR(30) NOT NULL, 
	rubric JSONB DEFAULT '{}'::jsonb NOT NULL, 
	quality NUMERIC(3, 2) DEFAULT 1.0 NOT NULL, 
	notes TEXT, 
	is_double_review BOOLEAN DEFAULT false NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(submission_id) REFERENCES app.submissions (id), 
	FOREIGN KEY(reviewer_id) REFERENCES app.users (id)
);

CREATE TABLE app.score_ledger_entries (
	id UUID NOT NULL, 
	tenant_id UUID NOT NULL, 
	event_id UUID NOT NULL, 
	stage_id UUID NOT NULL, 
	team_id UUID NOT NULL, 
	submission_id UUID, 
	award_unit_id VARCHAR(80), 
	component VARCHAR(30) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	points NUMERIC(10, 2) NOT NULL, 
	reason_code VARCHAR(60) NOT NULL, 
	actor_id UUID, 
	reverses_entry_id UUID, 
	note TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(tenant_id) REFERENCES app.tenants (id), 
	FOREIGN KEY(event_id) REFERENCES app.events (id), 
	FOREIGN KEY(stage_id) REFERENCES app.stages (id), 
	FOREIGN KEY(team_id) REFERENCES app.teams (id), 
	FOREIGN KEY(submission_id) REFERENCES app.submissions (id), 
	FOREIGN KEY(actor_id) REFERENCES app.users (id), 
	FOREIGN KEY(reverses_entry_id) REFERENCES app.score_ledger_entries (id)
);

CREATE INDEX ix_app_jobs_status ON app.jobs (status);
CREATE INDEX ix_jobs_claim ON app.jobs (status, run_after);
CREATE INDEX ix_app_jobs_kind ON app.jobs (kind);
CREATE INDEX ix_app_outbox_events_event_type ON app.outbox_events (event_type);
CREATE INDEX ix_app_events_tenant_id ON app.events (tenant_id);
CREATE UNIQUE INDEX ix_app_users_email ON app.users (email);
CREATE INDEX ix_app_users_role ON app.users (role);
CREATE INDEX ix_app_users_tenant_id ON app.users (tenant_id);
CREATE INDEX ix_app_acceptances_user_id ON app.acceptances (user_id);
CREATE INDEX ix_app_announcements_event_id ON app.announcements (event_id);
CREATE INDEX ix_app_challenge_versions_event_id ON app.challenge_versions (event_id);
CREATE INDEX ix_app_event_config_revisions_event_id ON app.event_config_revisions (event_id);
CREATE INDEX ix_app_exports_event_id ON app.exports (event_id);
CREATE INDEX ix_app_password_resets_user_id ON app.password_resets (user_id);
CREATE INDEX ix_app_readiness_items_event_id ON app.readiness_items (event_id);
CREATE INDEX ix_app_rules_documents_event_id ON app.rules_documents (event_id);
CREATE INDEX ix_app_sessions_user_id ON app.sessions (user_id);
CREATE INDEX ix_app_stages_event_id ON app.stages (event_id);
CREATE INDEX ix_app_teams_event_id ON app.teams (event_id);
CREATE INDEX ix_app_assignments_event_id ON app.assignments (event_id);
CREATE INDEX ix_app_assignments_challenge_version_id ON app.assignments (challenge_version_id);
CREATE INDEX ix_app_assignments_team_id ON app.assignments (team_id);
CREATE INDEX ix_app_assignments_stage_id ON app.assignments (stage_id);
CREATE INDEX ix_app_challenge_file_lines_challenge_version_id ON app.challenge_file_lines (challenge_version_id);
CREATE INDEX ix_cfl_version_line ON app.challenge_file_lines (challenge_version_id, line_number);
CREATE INDEX ix_app_challenge_files_challenge_version_id ON app.challenge_files (challenge_version_id);
CREATE INDEX ix_app_drafts_author_id ON app.drafts (author_id);
CREATE INDEX ix_app_invites_event_id ON app.invites (event_id);
CREATE INDEX ix_app_invites_email ON app.invites (email);
CREATE INDEX ix_app_leaderboard_snapshots_stage_id ON app.leaderboard_snapshots (stage_id);
CREATE INDEX ix_app_leaderboard_snapshots_event_id ON app.leaderboard_snapshots (event_id);
CREATE INDEX ix_app_refresh_tokens_user_id ON app.refresh_tokens (user_id);
CREATE INDEX ix_app_refresh_tokens_session_id ON app.refresh_tokens (session_id);
CREATE INDEX ix_app_stage_transitions_stage_id ON app.stage_transitions (stage_id);
CREATE INDEX ix_app_submissions_stage_id ON app.submissions (stage_id);
CREATE INDEX ix_app_submissions_tenant_id ON app.submissions (tenant_id);
CREATE INDEX ix_app_submissions_team_id ON app.submissions (team_id);
CREATE INDEX ix_app_submissions_event_id ON app.submissions (event_id);
CREATE INDEX ix_sub_stage_received ON app.submissions (stage_id, received_at);
CREATE INDEX ix_sub_team_status ON app.submissions (team_id, status);
CREATE INDEX ix_app_submissions_author_id ON app.submissions (author_id);
CREATE INDEX ix_app_team_members_user_id ON app.team_members (user_id);
CREATE INDEX ix_app_team_members_team_id ON app.team_members (team_id);
CREATE INDEX ix_app_time_adjustments_user_id ON app.time_adjustments (user_id);
CREATE INDEX ix_app_time_adjustments_stage_id ON app.time_adjustments (stage_id);
CREATE INDEX ix_app_award_claims_stage_id ON app.award_claims (stage_id);
CREATE INDEX ix_app_award_claims_team_id ON app.award_claims (team_id);
CREATE INDEX ix_app_award_claims_event_id ON app.award_claims (event_id);
CREATE INDEX ix_app_disputes_submission_id ON app.disputes (submission_id);
CREATE INDEX ix_app_review_items_submission_id ON app.review_items (submission_id);
CREATE INDEX ix_app_reviews_submission_id ON app.reviews (submission_id);
CREATE INDEX ix_app_score_ledger_entries_stage_id ON app.score_ledger_entries (stage_id);
CREATE INDEX ix_app_score_ledger_entries_reverses_entry_id ON app.score_ledger_entries (reverses_entry_id);
CREATE INDEX ix_app_score_ledger_entries_tenant_id ON app.score_ledger_entries (tenant_id);
CREATE INDEX ix_app_score_ledger_entries_award_unit_id ON app.score_ledger_entries (award_unit_id);
CREATE INDEX ix_app_score_ledger_entries_event_id ON app.score_ledger_entries (event_id);
CREATE INDEX ix_app_score_ledger_entries_team_id ON app.score_ledger_entries (team_id);
CREATE INDEX ix_app_score_ledger_entries_submission_id ON app.score_ledger_entries (submission_id);

-- ===== schema: gt (ground truth; restricted to gt_admin) =====
-- ===== schema: gt =====
CREATE TABLE gt.gt_bugs (
	id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	code VARCHAR(40) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	severity VARCHAR(20) NOT NULL, 
	category VARCHAR(60) NOT NULL, 
	points NUMERIC(8, 2) NOT NULL, 
	root_cause_group VARCHAR(80) NOT NULL, 
	explanation TEXT NOT NULL, 
	fix_guidance TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (challenge_version_id, code)
);

CREATE TABLE gt.gt_flags (
	id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	flag_key VARCHAR(40) NOT NULL, 
	code_hash VARCHAR(64) NOT NULL, 
	points NUMERIC(8, 2) NOT NULL, 
	max_awards INTEGER NOT NULL, 
	position_label VARCHAR(120), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (challenge_version_id, code_hash)
);

CREATE TABLE gt.gt_revisions (
	id UUID NOT NULL, 
	challenge_version_id UUID NOT NULL, 
	revision_no INTEGER NOT NULL, 
	reason TEXT NOT NULL, 
	payload JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE gt.gt_aliases (
	id UUID NOT NULL, 
	bug_id UUID NOT NULL, 
	keyword VARCHAR(120) NOT NULL, 
	weight NUMERIC(3, 2) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(bug_id) REFERENCES gt.gt_bugs (id)
);

CREATE TABLE gt.gt_locations (
	id UUID NOT NULL, 
	bug_id UUID NOT NULL, 
	file_path VARCHAR(500) NOT NULL, 
	line_start INTEGER NOT NULL, 
	line_end INTEGER NOT NULL, 
	is_primary BOOLEAN NOT NULL, 
	anchor_hash VARCHAR(64), 
	PRIMARY KEY (id), 
	FOREIGN KEY(bug_id) REFERENCES gt.gt_bugs (id)
);

CREATE TABLE gt.gt_test_cases (
	id UUID NOT NULL, 
	bug_id UUID NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT, 
	expected_result TEXT NOT NULL, 
	comparison VARCHAR(20) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(bug_id) REFERENCES gt.gt_bugs (id)
);

CREATE INDEX ix_gt_gt_bugs_challenge_version_id ON gt.gt_bugs (challenge_version_id);
CREATE INDEX ix_gt_gt_flags_challenge_version_id ON gt.gt_flags (challenge_version_id);
CREATE INDEX ix_gt_gt_revisions_challenge_version_id ON gt.gt_revisions (challenge_version_id);
CREATE INDEX ix_gt_gt_aliases_bug_id ON gt.gt_aliases (bug_id);
CREATE INDEX ix_gt_gt_locations_bug_id ON gt.gt_locations (bug_id);
CREATE INDEX ix_gt_gt_test_cases_bug_id ON gt.gt_test_cases (bug_id);
