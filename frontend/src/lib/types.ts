// Shared types representing the backend contracts
export type Role = 'participant' | 'reviewer' | 'organizer' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
}

export interface Team {
  id: string;
  name: string;
  join_code: string;
  event_id?: string;
  slug?: string;
  event_status?: string;
}

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  team: Team | null;
  rules_accepted: boolean;
  rules_version: string;
}

export interface PublicEvent {
  slug: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  duration_minutes: number;
  max_participants: number;
  max_teams: number;
  rules_version: string;
  format?: string;
}

export interface PublicRules {
  version: string;
  body_markdown: string;
  frozen_at: string | null;
  event_name: string;
}

export interface RoundState {
  id: string;
  name: string;
  kind: string;
  status: 'draft' | 'sealed' | 'armed' | 'active' | 'paused' | 'ended' | 'evaluating' | 'released' | 'final';
  event_status: string;
  starts_at: string | null;
  ends_at_effective: string | null;
  grace_seconds: number;
  paused: boolean;
}

export interface StateResponse {
  server_time: string;
  server_time_ms: number;
  round: RoundState | null;
  rules_version: string;
  announcements_version: string;
  leaderboard_version: string;
  leaderboard_visibility: string;
}

export interface ChallengeFile {
  path: string;
  lang: string;
  size_bytes: number;
  line_count: number;
}

export interface Assignment {
  challenge_id: string;
  slug: string;
  title: string;
  version: string;
  instructions_markdown?: string;
  repo_url?: string;
  codespace_url?: string;
  stage_id: string;
  stage_status: string;
  files: ChallengeFile[];
}

export interface FileContentResponse {
  path: string;
  lang: string;
  content: string;
  line_count: number;
  sha256: string;
}

export interface SearchMatch {
  path: string;
  line_number: number;
  text: string;
}

export type BugCategory =
  | 'authentication'
  | 'authorization'
  | 'injection'
  | 'data_handling'
  | 'business_logic'
  | 'cryptography'
  | 'error_handling'
  | 'api_design'
  | 'rate_limiting'
  | 'concurrency'
  | 'configuration'
  | 'integrity';

export interface SubmissionIn {
  kind: 'bug_report' | 'ctf_flag';
  challenge_id?: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  related_locations?: Array<{ file_path: string; line_start: number; line_end: number }>;
  category?: BugCategory;
  claimed_severity?: 'low' | 'medium' | 'high' | 'critical';
  title?: string;
  description?: string;
  impact?: string;
  evidence?: string;
  suggested_fix?: string;
  flag_code?: string;
}

export interface SubmissionReceipt {
  submission_id: string;
  receipt_code: string;
  received_at: string;
  status: string;
  replay: boolean;
  team_id?: string;
}

export interface SubmissionItem {
  id: string;
  kind: 'bug_report' | 'ctf_flag';
  title?: string;
  file_path?: string;
  line_range?: [number, number];
  category?: string;
  received_at: string;
  receipt_code: string;
  status: string;
  matched_bug_code?: string | null;
  points?: number | null;
  flag_code?: string;
}

export interface SubmissionDetail {
  id: string;
  kind: 'bug_report' | 'ctf_flag';
  title?: string;
  payload: Record<string, unknown>;
  file_path?: string;
  line_range?: [number, number];
  category?: string;
  received_at: string;
  receipt_code: string;
  flag_code?: string;
  status: string;
  matched_bug_code?: string | null;
  points?: number | null;
}

export interface DraftPayload {
  payload: Partial<SubmissionIn>;
  version: number;
  updated_at?: string;
}

export interface Announcement {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  audience: string;
  body: string;
  author: string;
  created_at: string;
}

export interface LeaderboardRow {
  rank: number;
  team_name: string;
  score: number;
  invalid_reports: number;
  last_accepted: string | null;
}

export interface LeaderboardResponse {
  visible: boolean;
  version?: string;
  snapshot: LeaderboardRow[] | null;
  generated_at?: string;
}

export interface LedgerEntry {
  component: string;
  kind: string;
  points: number;
  reason_code: string;
  title?: string;
  receipt_code?: string;
  matched_bug_code?: string;
  received_at: string;
}

export interface ResultsResponse {
  released: boolean;
  total: number;
  by_component: Record<string, number>;
  penalties: number;
  entries: LedgerEntry[];
}

export interface ReviewQueueItem {
  review_item_id: string;
  submission_id: string;
  kind: string;
  title: string;
  file_path?: string;
  line_range?: [number, number];
  category?: string;
  received_at: string;
  priority: number;
  status: string;
  claimed_by_me: boolean;
}

export interface ReviewItemDetail {
  review_item_id: string;
  status: string;
  submission: {
    id: string;
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    file_path?: string;
    line_range?: [number, number];
    category?: string;
    received_at: string;
    receipt_code: string;
    flag_code?: string;
    status: string;
  };
  file: {
    content: string;
    lang: string;
    line_count: number;
  } | null;
  team_total_reports: number;
}

export type ReviewDecision =
  | 'accept_full'
  | 'accept_partial'
  | 'duplicate'
  | 'reject_invalid'
  | 'unplanned_valid'
  | 'needs_second_review';

export interface Rubric {
  functionality: number;
  root_cause: number;
  code_quality: number;
  testing: number;
  evidence: number;
}

export interface DisputeItem {
  id: string;
  submission_id: string;
  team_id: string;
  receipt_code: string;
  title: string;
  statement: string;
  status: 'pending' | 'upheld' | 'rejected';
  resolution?: string;
  created_at: string;
}

export interface ReadinessItem {
  key: string;
  label: string;
  state: 'checked' | 'unchecked' | 'na';
  checked_at?: string;
}

export interface AuditVerification {
  scope: string;
  entries: number;
  verified: number;
  broken_at: number | null;
  intact: boolean;
}

export interface SystemHealth {
  status: string;
  database_app: string;
  database_gt: string;
  clock: string;
  jobs_queued?: number;
  oldest_job_age_s?: number;
  runner_enabled?: boolean;
  ai_assessment_enabled?: boolean;
}
