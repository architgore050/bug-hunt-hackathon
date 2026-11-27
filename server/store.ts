import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flagCodeHash, hashPassword, newUuid, sha256Hex, tokenHash } from './security.ts'
import type { GtBugView } from './matching.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const CHALLENGE_DIR_A = path.join(ROOT_DIR, 'challenge-app')
const CHALLENGE_DIR_B = path.join(ROOT_DIR, 'challenge-app-option-b')

// Participant-facing files only; ORGANIZER_ANSWER_KEY.md is strictly excluded.
const PARTICIPANT_FILES_A = [
  'package.json',
  'server.js',
  'db.js',
  'routes/auth.js',
  'routes/notes.js',
  'routes/comments.js',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/admin.html',
  'README.md',
]

const PARTICIPANT_FILES_B = [
  'README.md',
  'requirements.txt',
  'main.py',
  'database.py',
  'routes/__init__.py',
  'routes/auth.py',
  'routes/notes.py',
  'routes/comments.py',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
]

export type Role = 'participant' | 'reviewer' | 'organizer' | 'admin'
export type LevelNode = 'explain' | 'exec' | 'done'
export type LevelStatus = 'locked' | 'available' | 'in_progress' | 'submitted' | 'auto_submitted' | 'missed'

export interface UserRecord {
  id: string
  tenant_id: string
  email: string
  name: string
  role: Role
  password_hash: string | null
  status: string
  token_version: number
  created_at: string
}

export interface SessionRecord {
  id: string
  user_id: string
  ip_hash: string
  user_agent: string
  created_at: string
  last_seen_at: string
  step_up_at: string | null
  revoked_at: string | null
}

export interface RefreshTokenRecord {
  id: string
  session_id: string
  user_id: string
  token_hash: string
  status: 'active' | 'rotated' | 'revoked'
  rotated_at: string | null
  successor_raw: string | null
  expires_at: string
}

export interface EventRecord {
  id: string
  tenant_id: string
  slug: string
  name: string
  status: string
  starts_at: string | null
  ends_at: string | null
  timezone: string
  duration_minutes: number
  max_participants: number
  max_teams: number
  rules_version: number
  config_version: number
  config: Record<string, unknown>
  created_at: string
}

export interface StageRecord {
  id: string
  event_id: string
  name: string
  kind: string
  ordinal: number
  status: string
  starts_at: string | null
  ends_at: string | null
  started_at: string | null
  ended_at: string | null
  grace_seconds: number
  config: Record<string, unknown>
  rule_set_hash: string
  created_at: string
}

export interface ChallengeFileRecord {
  path: string
  lang: string
  content: string
  sha256: string
  size_bytes: number
  line_count: number
}

export interface ChallengeVersionRecord {
  id: string
  event_id: string
  slug: string
  title: string
  version: number
  instructions_md: string
  status: string
  content_hash: string | null
  frozen_at: string | null
  published_at: string | null
}

export interface TeamRecord {
  id: string
  event_id: string
  name: string
  join_code: string
  status: string
}

export interface TeamMemberRecord {
  id: string
  team_id: string
  user_id: string
  is_lead: boolean
  joined_at: string
}

export interface RepoOptionRecord {
  id: string
  event_id: string
  option_key: string
  label: string
  description: string
  challenge_version_id: string
}

export interface TeamRepoChoiceRecord {
  id: string
  event_id: string
  team_id: string
  option_key: string
  challenge_version_id: string
  locked_by: string | null
  locked_by_name: string
  locked_at: string
  lock_source: string
  idempotency_key: string
  audit_reason?: string
}

export interface PointerRecord {
  user_id: string
  event_id: string
  level_no: number
  node: LevelNode
  updated_at: string
}

export interface ProgressRecord {
  user_id: string
  event_id: string
  level_no: number
  status: LevelStatus
  submission_id: string | null
  submitted_at: string | null
  updated_at: string
}

export interface DraftRecord {
  payload: Record<string, unknown>
  version: number
  updated_at: string | null
}

export interface ArtifactRecord {
  id: string
  owner_id: string
  event_id: string
  level_no: number
  kind: 'zip' | 'diff' | 'patch'
  filename: string
  sha256: string
  size_bytes: number
  entry_count: number | null
  uncompressed_bytes: number
  storage_key: string
  content_text: string
  status: 'staged' | 'submitted'
}

export interface SubmissionRecord {
  id: string
  tenant_id: string
  event_id: string
  stage_id: string
  challenge_version_id: string
  team_id: string
  author_id: string
  kind: string
  idempotency_key: string
  payload: Record<string, unknown>
  payload_hash: string
  status: string
  receipt_code: string
  title: string
  file_path: string | null
  line_start: number | null
  line_end: number | null
  category: string | null
  flag_code: string | null
  feedback_released: boolean
  matched_bug_code: string | null
  points_visible: number | null
  received_at: string
}

export interface ReviewItemRecord {
  id: string
  submission_id: string
  status: 'open' | 'claimed' | 'decided'
  priority: number
  claimed_by: string | null
  claimed_at: string | null
  created_at: string
}

export interface ScoreLedgerEntry {
  id: string
  tenant_id: string
  event_id: string
  stage_id: string
  team_id: string
  component: string
  kind: string
  points: number
  reason_code: string
  submission_id: string | null
  actor_id: string | null
  note: string | null
  created_at: string
}

export interface AuditEntryRecord {
  seq: number
  ts: string
  actor_id: string | null
  actor_role: string
  action: string
  entity_type: string
  entity_id: string
  request_id: string
  details: Record<string, unknown>
  prev_hash: string
  entry_hash: string
}

export interface GtFlagView {
  flag_key: string
  code_hash: string
  points: number
  max_awards: number
  position_label: string
}

export function langForPath(relPath: string): string {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? 'text'
  const map: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sql: 'sql',
    txt: 'text',
  }
  return map[ext] ?? 'text'
}

function readSafeChallengeFiles(baseDir: string, fileList: string[]): ChallengeFileRecord[] {
  const out: ChallengeFileRecord[] = []
  for (const rel of fileList) {
    if (rel.toUpperCase().includes('ORGANIZER_ANSWER_KEY')) continue
    const full = path.join(baseDir, rel)
    if (!fs.existsSync(full)) continue
    const content = fs.readFileSync(full, 'utf8')
    out.push({
      path: rel,
      lang: langForPath(rel),
      content,
      sha256: sha256Hex(content),
      size_bytes: Buffer.byteLength(content, 'utf8'),
      line_count: content.split('\n').length,
    })
  }
  return out
}

function findLine(content: string, pattern: RegExp): number {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return i + 1
  }
  return 1
}

export const RULES_MD = `# Fall Back - Competition Rules (v1, official draft)

## 1. Participation
- Teams of 4-5 participants, registered by the Software Development Club, VIT Bhopal University.
- Accounts are personal; sharing an account between people is prohibited.
- The event is offline, at the venue, on 6 December 2026, for 180 minutes.

## 2. Main task
- Every team receives the same preconfigured full-stack application with intentionally planted defects. Inspect it, reproduce failures, fix them, and submit structured bug reports and fixes through the platform before the deadline.
- Reports need a target file, a line range (max 25 lines), a category, a title, and an explanation. Evidence is required for borderline matches.

## 3. Scoring (provisional, frozen before the event)
- Main score: functional tests 50%, code review 30%, evidence and test quality 20%.
- Verified CTF flags award bonus points, capped at 100 points total per team.
- Claimed severity is informational; points come from the hidden ground truth.
- Definitively invalid reports may carry a small capped penalty, applied only at finalization. Plausible but unmatched reports go to human review.
- Tie-breakers: total score, then fewer invalid reports, then earlier last accepted finding.

## 4. Conduct and scope
- Attack ONLY the provided challenge application on your own machine.
- Attacking the platform, the venue network, other teams, or any external system is prohibited and grounds for disqualification.
- Do not share findings, code, or flags between teams. Screenshots of the challenge and external AI tools are prohibited for the main task.
- Feedback on reports is hidden until results are released; probing the evaluation with template reports is a violation.

## 5. Appeals
- After results are released, teams may dispute any result through the platform within the announced window. Resolutions are final.

## 6. Platform security safe harbor
- Found a vulnerability in the platform itself? Report it privately to the organizers immediately. Good-faith reports are welcomed and will not be penalized.
`

const EVENT_CONFIG = {
  features: { runner_enabled: false, ai_assessment_enabled: false, telemetry_enabled: false },
  scoring: {
    weights: { functional_test: 0.5, code_review: 0.3, evidence_report: 0.2 },
    ctf_bonus_cap_points: 100,
    default_review_quality: 0.8,
  },
  schedule: [
    { phase: 'Registration and Technical Setup', duration_minutes: 15 },
    { phase: 'Event Briefing and Instructions', duration_minutes: 10 },
    { phase: 'Part 1: Setup and Bug Reconnaissance', duration_minutes: 30 },
    { phase: 'Part 2: Debugging and Root-Cause Analysis', duration_minutes: 35 },
    { phase: 'Part 3: Full-Stack Repair and CTF Side Quests', duration_minutes: 60 },
    { phase: 'Part 4: Testing, Verification and Demonstration', duration_minutes: 25 },
    { phase: 'Final Evaluation and Results', duration_minutes: 5 },
  ],
  public_summary: {
    mode: 'offline',
    team_size: '4-5 participants',
    duration_minutes: 180,
    main_score: 'restoring application functionality',
    ctf: 'optional bonus, capped',
  },
}

const DEFAULT_STAGE_CONFIG = {
  feedback_mode: 'hidden',
  leaderboard_mode: 'hidden',
  leaderboard_delay_s: 600,
  max_span: 25,
  max_reports_per_file: 12,
  max_reports_per_round: 80,
  file_cooldown_s: 20,
  location_tolerance_lines: 2,
  ctf_bonus_cap_points: 100,
  penalty: { fp_factor: 0.25, cap_fraction: 0.2, applies: 'at_release_only' },
}

const LEVEL_NAMES: Record<number, string> = {
  1: 'Level 1: Find the Bugs',
  2: 'Level 2: Trace the Cross-File Defect',
  3: 'Level 3: Repair and Side Quest',
  4: 'Level 4: Tests and Documentation',
}

const LEVEL_EXPLAIN_MD: Record<number, string> = {
  1: "Inspect your team's locked repository and file one flag per bug. Each flag needs a file, a line range, a category and an explanation.",
  2: 'One defect spans several files. Report every location it touches as one ordered list on a single flag.',
  3: 'Fix the defects in the editable workspace and complete the side quest. Submit a .zip/.diff/.patch artifact or submit the computed draft diff.',
  4: 'Write the missing tests and update the documentation, then submit your artifact.',
}

export class PlatformStore {
  tenantId = newUuid()
  users = new Map<string, UserRecord>()
  usersByEmail = new Map<string, UserRecord>()
  sessions = new Map<string, SessionRecord>()
  refreshTokensByHash = new Map<string, RefreshTokenRecord>()
  invites = new Map<string, { id: string; event_id: string; email: string; token_hash: string; team_id: string | null; role: Role; used_at: string | null; expires_at: string; created_at: string }>()
  passwordResets = new Map<string, { id: string; user_id: string; token_hash: string; used_at: string | null; expires_at: string }>()
  acceptances = new Map<string, { id: string; user_id: string; rules_version: number; created_at: string }>()

  events = new Map<string, EventRecord>()
  rulesDocs: Array<{ version: number; event_id: string; body_md: string; frozen_at: string }> = []
  readinessItems = new Map<string, Array<{ key: string; label: string; state: 'checked' | 'unchecked' | 'na'; owner: string | null; checked_at: string | null }>>()
  stages = new Map<string, StageRecord>()
  timeAdjustments: Array<{ id: string; stage_id: string; user_id: string | null; delta_seconds: number; reason_code: string; created_by: string; created_at: string }> = []

  challenges = new Map<string, ChallengeVersionRecord>()
  challengeFiles = new Map<string, ChallengeFileRecord[]>()
  repoOptions = new Map<string, RepoOptionRecord[]>()
  assignments: Array<{ id: string; event_id: string; stage_id: string; challenge_version_id: string; team_id: string | null; repo_url: string | null; codespace_url: string | null }> = []

  teams = new Map<string, TeamRecord>()
  teamMembers: TeamMemberRecord[] = []
  teamRepoChoices = new Map<string, TeamRepoChoiceRecord>()

  participantPointers = new Map<string, PointerRecord>()
  participantProgress = new Map<string, ProgressRecord>()
  drafts = new Map<string, DraftRecord>()
  levelDrafts = new Map<string, DraftRecord>()
  artifacts = new Map<string, ArtifactRecord>()

  submissions = new Map<string, SubmissionRecord>()
  submissionsByIdem = new Map<string, SubmissionRecord>()
  reviewItems = new Map<string, ReviewItemRecord>()
  reviews: Array<{ id: string; submission_id: string; reviewer_id: string; decision: string; rubric: Record<string, number>; quality: number; notes: string | null; created_at: string }> = []
  scoreLedger: ScoreLedgerEntry[] = []
  awardClaims = new Set<string>()
  disputes = new Map<string, { id: string; submission_id: string; team_id: string; statement: string; status: string; resolution: string | null; created_at: string }>()
  announcements: Array<{ id: string; event_id: string; severity: 'info' | 'warning' | 'critical'; audience: string; body: string; author: string; created_at: string }> = []
  leaderboardSnapshots: Array<{ stage_id: string; event_id: string; version: number; visibility: string; payload: unknown; created_at: string }> = []
  exports: Array<{ id: string; event_id: string; kind: string; content: string; created_at: string }> = []
  auditLog: AuditEntryRecord[] = []

  // Isolated ground truth domain (never returned from participant endpoints)
  private gtBugs = new Map<string, GtBugView[]>()
  private gtFlags = new Map<string, GtFlagView[]>()

  constructor() {
    this.seed()
  }

  writeAudit(opts: {
    actor_id: string | null
    actor_role: string
    action: string
    entity_type: string
    entity_id: string
    request_id: string
    details?: Record<string, unknown>
  }): void {
    const seq = this.auditLog.length + 1
    const prevHash = seq === 1 ? '0'.repeat(64) : this.auditLog[this.auditLog.length - 1].entry_hash
    const ts = new Date().toISOString()
    const details = opts.details ?? {}
    const entryHash = sha256Hex(`${seq}:${ts}:${opts.actor_role}:${opts.action}:${opts.entity_id}:${prevHash}`)
    this.auditLog.push({
      seq,
      ts,
      actor_id: opts.actor_id,
      actor_role: opts.actor_role,
      action: opts.action,
      entity_type: opts.entity_type,
      entity_id: opts.entity_id,
      request_id: opts.request_id,
      details,
      prev_hash: prevHash,
      entry_hash: entryHash,
    })
  }

  verifyAudit(): { scope: string; entries: number; verified: number; broken_at: string | null; intact: boolean } {
    let expectedPrev = '0'.repeat(64)
    let verified = 0
    for (const e of this.auditLog) {
      const check = sha256Hex(`${e.seq}:${e.ts}:${e.actor_role}:${e.action}:${e.entity_id}:${expectedPrev}`)
      if (e.prev_hash !== expectedPrev || e.entry_hash !== check) {
        return { scope: 'all', entries: this.auditLog.length, verified, broken_at: String(e.seq), intact: false }
      }
      expectedPrev = e.entry_hash
      verified += 1
    }
    return { scope: 'all', entries: this.auditLog.length, verified, broken_at: null, intact: true }
  }

  initParticipantFlow(eventId: string, userId: string): PointerRecord {
    const existing = this.participantPointers.get(userId)
    if (existing) return existing
    const now = new Date().toISOString()
    const ptr: PointerRecord = {
      user_id: userId,
      event_id: eventId,
      level_no: 1,
      node: 'explain',
      updated_at: now,
    }
    this.participantPointers.set(userId, ptr)
    for (let n = 1; n <= 4; n += 1) {
      this.participantProgress.set(`${userId}:${n}`, {
        user_id: userId,
        event_id: eventId,
        level_no: n,
        status: 'locked',
        submission_id: null,
        submitted_at: null,
        updated_at: now,
      })
    }
    return ptr
  }

  getTeamForUser(userId: string): TeamRecord | null {
    const mem = this.teamMembers.find((m) => m.user_id === userId)
    if (!mem) return null
    return this.teams.get(mem.team_id) ?? null
  }

  isTeamLead(teamId: string, userId: string): boolean {
    const members = this.teamMembers.filter((m) => m.team_id === teamId)
    const explicitLead = members.find((m) => m.is_lead)
    if (explicitLead) return explicitLead.user_id === userId
    return members[0]?.user_id === userId
  }

  getLevelStage(eventId: string, levelNo: number): StageRecord | null {
    for (const st of this.stages.values()) {
      if (st.event_id === eventId && st.kind === 'level' && st.ordinal === levelNo) return st
    }
    return null
  }

  getMainStage(eventId?: string): StageRecord | null {
    const list = Array.from(this.stages.values())
      .filter((s) => (eventId ? s.event_id === eventId : true) && s.kind !== 'level')
      .sort((a, b) => b.ordinal - a.ordinal)
    return list[0] ?? null
  }

  getEffectiveEnd(stage: StageRecord, userId: string | null): Date | null {
    if (!stage.ends_at) return null
    const baseMs = new Date(stage.ends_at).getTime()
    let deltaSec = 0
    for (const adj of this.timeAdjustments) {
      if (adj.stage_id === stage.id && (adj.user_id === null || adj.user_id === userId)) {
        deltaSec += adj.delta_seconds
      }
    }
    return new Date(baseMs + deltaSec * 1000)
  }

  computeGate(eventId: string, userId: string, teamId: string | null, levelNo: number, now: Date) {
    const stage = this.getLevelStage(eventId, levelNo)
    if (!stage) {
      return { allowed: false, reason: 'Level not configured yet.', waiting_on: [] as Array<{ name: string; status: string }>, stage_status: null as string | null }
    }
    if (stage.status === 'paused') {
      return { allowed: false, reason: 'The level is paused. Your timer is stopped.', waiting_on: [], stage_status: stage.status }
    }
    if (stage.status !== 'armed' && stage.status !== 'active') {
      return {
        allowed: false,
        reason: stage.status === 'draft' || stage.status === 'sealed' ? 'The level is not open yet.' : 'The level window has closed.',
        waiting_on: [],
        stage_status: stage.status,
      }
    }
    if (stage.status === 'armed' && stage.starts_at && now.getTime() < new Date(stage.starts_at).getTime()) {
      return {
        allowed: false,
        reason: `The level opens at ${stage.starts_at}.`,
        waiting_on: [],
        stage_status: stage.status,
      }
    }
    const effEnd = this.getEffectiveEnd(stage, userId)
    const graceMs = (stage.grace_seconds || 0) * 1000
    if (effEnd && now.getTime() > effEnd.getTime() + graceMs) {
      return { allowed: false, reason: 'The level window has closed.', waiting_on: [], stage_status: stage.status }
    }

    if (!teamId) {
      return { allowed: false, reason: 'You are not assigned to a team yet.', waiting_on: [], stage_status: stage.status }
    }

    if (levelNo === 1) {
      const choice = this.teamRepoChoices.get(teamId)
      if (!choice) {
        return { allowed: false, reason: 'Waiting for your team lead to lock the repository.', waiting_on: [], stage_status: stage.status }
      }
      return { allowed: true, reason: 'ok', waiting_on: [], stage_status: stage.status }
    }

    const members = this.teamMembers.filter((m) => m.team_id === teamId)
    const waiting: Array<{ name: string; status: string }> = []
    for (const mem of members) {
      const prog = this.participantProgress.get(`${mem.user_id}:${levelNo - 1}`)
      const st = prog?.status ?? 'locked'
      if (st !== 'submitted' && st !== 'auto_submitted') {
        const u = this.users.get(mem.user_id)
        waiting.push({ name: u?.name ?? 'Teammate', status: st })
      }
    }
    if (waiting.length > 0) {
      return {
        allowed: false,
        reason: `Waiting for ${waiting.length} teammate(s) to finish level ${levelNo - 1}.`,
        waiting_on: waiting,
        stage_status: stage.status,
      }
    }
    return { allowed: true, reason: 'ok', waiting_on: [], stage_status: stage.status }
  }

  teammateView(teamId: string) {
    const members = this.teamMembers.filter((m) => m.team_id === teamId)
    return members
      .map((m) => {
        const u = this.users.get(m.user_id)
        const ptr = this.participantPointers.get(m.user_id)
        return {
          id: m.user_id,
          name: u?.name ?? m.user_id,
          is_lead: this.isTeamLead(teamId, m.user_id),
          levels: {
            '1': this.participantProgress.get(`${m.user_id}:1`)?.status ?? 'locked',
            '2': this.participantProgress.get(`${m.user_id}:2`)?.status ?? 'locked',
            '3': this.participantProgress.get(`${m.user_id}:3`)?.status ?? 'locked',
            '4': this.participantProgress.get(`${m.user_id}:4`)?.status ?? 'locked',
          },
          pointer: ptr ? { level_no: ptr.level_no, node: ptr.node } : null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  evaluateFlagSubmission(challengeId: string, flagCode: string): GtFlagView | null {
    const flags = this.gtFlags.get(challengeId) ?? []
    const hashed = flagCodeHash(flagCode)
    return flags.find((f) => f.code_hash === hashed) ?? null
  }

  getGtBugsForChallenge(challengeId: string): GtBugView[] {
    return this.gtBugs.get(challengeId) ?? []
  }

  refreshLeaderboardSnapshot(stageId: string, eventId: string, visibility: string) {
    const teams = Array.from(this.teams.values()).filter((t) => t.event_id === eventId)
    const rows = teams.map((t) => {
      const entries = this.scoreLedger.filter((e) => e.stage_id === stageId && e.team_id === t.id)
      const score = entries.reduce((sum, e) => sum + e.points, 0)
      const subs = Array.from(this.submissions.values()).filter((s) => s.stage_id === stageId && s.team_id === t.id)
      const invalidReports = subs.filter((s) => s.status === 'rejected_auto').length
      const acceptedDates = subs
        .filter((s) => s.status === 'matched_auto' || s.status === 'decided')
        .map((s) => s.received_at)
        .sort()
      return {
        rank: 0,
        team_id: t.id,
        team_name: t.name,
        score: Math.round(score * 100) / 100,
        invalid_reports: invalidReports,
        last_accepted_at: acceptedDates.length ? acceptedDates[acceptedDates.length - 1] : null,
      }
    })
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.invalid_reports !== b.invalid_reports) return a.invalid_reports - b.invalid_reports
      if (a.last_accepted_at && b.last_accepted_at) return a.last_accepted_at.localeCompare(b.last_accepted_at)
      return a.team_name.localeCompare(b.team_name)
    })
    rows.forEach((r, idx) => {
      r.rank = idx + 1
    })
    const prevVersions = this.leaderboardSnapshots.filter((s) => s.stage_id === stageId)
    const version = prevVersions.length + 1
    const createdAt = new Date().toISOString()
    this.leaderboardSnapshots.push({
      stage_id: stageId,
      event_id: eventId,
      version,
      visibility,
      payload: {
        stage_id: stageId,
        event_id: eventId,
        rows,
        generated_at: createdAt,
      },
      created_at: createdAt,
    })
  }

  private seed() {
    const now = new Date()
    const nowIso = now.toISOString()
    const defaultPwHash = hashPassword('Dev-only!Passw0rd!')

    const staffList: Array<[string, string, Role]> = [
      ['admin@example.com', 'Platform Admin', 'admin'],
      ['organizer@example.com', 'Kalpesh Parashar', 'organizer'],
      ['organizer2@example.com', 'Aashish Prasad', 'organizer'],
      ['reviewer1@example.com', 'Reviewer One', 'reviewer'],
      ['reviewer2@example.com', 'Reviewer Two', 'reviewer'],
    ]

    for (const [email, name, role] of staffList) {
      const u: UserRecord = {
        id: newUuid(),
        tenant_id: this.tenantId,
        email,
        name,
        role,
        password_hash: defaultPwHash,
        status: 'active',
        token_version: 1,
        created_at: nowIso,
      }
      this.users.set(u.id, u)
      this.usersByEmail.set(email.toLowerCase(), u)
    }

    const eventId = newUuid()
    const eventRecord: EventRecord = {
      id: eventId,
      tenant_id: this.tenantId,
      slug: 'fall-back-2026',
      name: 'Fall Back - Full-Stack Software Debugging Challenge',
      status: 'live',
      // 6 December 2026, 10:00 IST (UTC+05:30)
      starts_at: '2026-12-06T04:30:00.000Z',
      ends_at: '2026-12-06T07:30:00.000Z',
      timezone: 'Asia/Kolkata',
      duration_minutes: 180,
      max_participants: 50,
      max_teams: 10,
      rules_version: 1,
      config_version: 1,
      config: EVENT_CONFIG,
      created_at: nowIso,
    }
    this.events.set(eventId, eventRecord)

    this.rulesDocs.push({
      version: 1,
      event_id: eventId,
      body_md: RULES_MD,
      frozen_at: nowIso,
    })

    this.readinessItems.set(eventId, [
      { key: 'load_test_50', label: 'Load test at the approved cap passes thresholds', state: 'checked', owner: 'infrastructure lead', checked_at: nowIso },
      { key: 'gt_isolation', label: 'Ground truth isolation verified against participant routes', state: 'checked', owner: 'application lead', checked_at: nowIso },
      { key: 'backup_restore', label: 'Backup and restore rehearsal completed and measured', state: 'checked', owner: 'infrastructure lead', checked_at: nowIso },
      { key: 'pen_test', label: 'Security review completed; high/critical closed', state: 'checked', owner: 'application lead', checked_at: nowIso },
      { key: 'challenge_audit', label: 'Two independent reviewers certified the challenge', state: 'checked', owner: 'review lead', checked_at: nowIso },
      { key: 'dry_run', label: 'Full dry run with real users on the venue network', state: 'checked', owner: 'event lead', checked_at: nowIso },
      { key: 'rules_published', label: 'Rules, privacy notice and consent flows published', state: 'checked', owner: 'organizer', checked_at: nowIso },
      { key: 'runbooks', label: 'Event-day runbook rehearsed; roles assigned', state: 'checked', owner: 'event lead', checked_at: nowIso },
    ])

    // Main stage (for v1 endpoints & state polling)
    const mainStageId = newUuid()
    const mainStage: StageRecord = {
      id: mainStageId,
      event_id: eventId,
      name: 'Fall Back Main Challenge',
      kind: 'main',
      ordinal: 1,
      status: 'active',
      starts_at: new Date(now.getTime() - 30 * 60_000).toISOString(),
      ends_at: new Date(now.getTime() + 180 * 60_000).toISOString(),
      started_at: new Date(now.getTime() - 30 * 60_000).toISOString(),
      ended_at: null,
      grace_seconds: 3,
      config: DEFAULT_STAGE_CONFIG,
      rule_set_hash: `sha256:${sha256Hex(JSON.stringify(DEFAULT_STAGE_CONFIG))}`,
      created_at: nowIso,
    }
    this.stages.set(mainStageId, mainStage)

    // Option A challenge (challenge-app)
    const filesA = readSafeChallengeFiles(CHALLENGE_DIR_A, PARTICIPANT_FILES_A)
    const readmeA = filesA.find((f) => f.path === 'README.md')?.content ?? 'Papyrus - Campus Notes'
    const challengeAId = newUuid()
    this.challenges.set(challengeAId, {
      id: challengeAId,
      event_id: eventId,
      slug: 'papyrus',
      title: 'Papyrus - Campus Notes (Option A)',
      version: 1,
      instructions_md: readmeA,
      status: 'published',
      content_hash: `sha256:${sha256Hex(filesA.map((f) => f.sha256).join(''))}`,
      frozen_at: nowIso,
      published_at: nowIso,
    })
    this.challengeFiles.set(challengeAId, filesA)

    // Option B challenge (challenge-app-option-b)
    const filesB = readSafeChallengeFiles(CHALLENGE_DIR_B, PARTICIPANT_FILES_B)
    const readmeB = filesB.find((f) => f.path === 'README.md')?.content ?? 'Marina - Campus Notes'
    const challengeBId = newUuid()
    this.challenges.set(challengeBId, {
      id: challengeBId,
      event_id: eventId,
      slug: 'marina',
      title: 'Marina - Campus Notes (Option B)',
      version: 1,
      instructions_md: readmeB,
      status: 'published',
      content_hash: `sha256:${sha256Hex(filesB.map((f) => f.sha256).join(''))}`,
      frozen_at: nowIso,
      published_at: nowIso,
    })
    this.challengeFiles.set(challengeBId, filesB)

    // Global assignment on main stage (Option A default)
    this.assignments.push({
      id: newUuid(),
      event_id: eventId,
      stage_id: mainStageId,
      challenge_version_id: challengeAId,
      team_id: null,
      repo_url: null,
      codespace_url: null,
    })

    // Repo options for the 4-level flow
    this.repoOptions.set(eventId, [
      {
        id: newUuid(),
        event_id: eventId,
        option_key: 'A',
        label: 'Option A: Papyrus (Node/Express + SQLite)',
        description: 'MERN-style Node/Express campus notes app with browser UI and REST routes.',
        challenge_version_id: challengeAId,
      },
      {
        id: newUuid(),
        event_id: eventId,
        option_key: 'B',
        label: 'Option B: Marina (FastAPI + SQLite)',
        description: 'FastAPI + SQLite campus notes service with parity defects and side quests.',
        challenge_version_id: challengeBId,
      },
    ])

    // Four level stages
    const windows: Record<number, [string, number | null, number | null]> = {
      1: ['active', -30, 120],
      2: ['armed', 15, 60],
      3: ['draft', null, null],
      4: ['draft', null, null],
    }
    for (let n = 1; n <= 4; n += 1) {
      const [status, startOff, dur] = windows[n]
      const starts = startOff !== null ? new Date(now.getTime() + startOff * 60_000).toISOString() : null
      const ends = starts && dur !== null ? new Date(new Date(starts).getTime() + dur * 60_000).toISOString() : null
      const cfg = {
        explain_title: LEVEL_NAMES[n],
        explain_md: LEVEL_EXPLAIN_MD[n],
        max_span: 25,
        max_flags_per_level: 12,
        feedback_mode: 'hidden',
        leaderboard_mode: 'hidden',
      }
      const id = newUuid()
      this.stages.set(id, {
        id,
        event_id: eventId,
        name: LEVEL_NAMES[n],
        kind: 'level',
        ordinal: n,
        status,
        starts_at: starts,
        ends_at: ends,
        started_at: status === 'active' ? starts : null,
        ended_at: null,
        grace_seconds: 3,
        config: cfg,
        rule_set_hash: `sha256:${sha256Hex(JSON.stringify(cfg))}`,
        created_at: nowIso,
      })
    }

    // Teams and participants
    const teamSpecs: Array<[string, string[]]> = [
      ['Team Lambda', ['p1.team1@example.com', 'p2.team1@example.com', 'p3.team1@example.com', 'p4.team1@example.com']],
      ['Team Vector', ['p1.team2@example.com', 'p2.team2@example.com', 'p3.team2@example.com', 'p4.team2@example.com', 'p5.team2@example.com']],
    ]
    for (const [teamName, emails] of teamSpecs) {
      const teamId = newUuid()
      this.teams.set(teamId, {
        id: teamId,
        event_id: eventId,
        name: teamName,
        join_code: teamName.includes('Lambda') ? 'LMBD2026' : 'VCTR2026',
        status: 'active',
      })
      emails.forEach((email, idx) => {
        const uid = newUuid()
        const displayName = email
          .split('@')[0]
          .replace(/\./g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
        const user: UserRecord = {
          id: uid,
          tenant_id: this.tenantId,
          email,
          name: displayName,
          role: 'participant',
          password_hash: defaultPwHash,
          status: 'active',
          token_version: 1,
          created_at: nowIso,
        }
        this.users.set(uid, user)
        this.usersByEmail.set(email.toLowerCase(), user)
        this.teamMembers.push({
          id: newUuid(),
          team_id: teamId,
          user_id: uid,
          is_lead: idx === 0,
          joined_at: nowIso,
        })
        this.initParticipantFlow(eventId, uid)
      })
    }

    const organizer = this.usersByEmail.get('organizer@example.com')
    this.announcements.push({
      id: newUuid(),
      event_id: eventId,
      severity: 'info',
      audience: 'all',
      body: 'Welcome to Fall Back. Sign in, review the rules, and lock your team repository option at Level 1.',
      author: organizer?.name ?? 'Organizer',
      created_at: nowIso,
    })

    // Seed Ground Truth strictly inside private maps
    this.seedGroundTruthA(challengeAId, filesA)
    this.seedGroundTruthB(challengeBId, filesB)
    this.refreshLeaderboardSnapshot(mainStageId, eventId, 'hidden')

    this.writeAudit({
      actor_id: null,
      actor_role: 'system',
      action: 'seed.completed',
      entity_type: 'event',
      entity_id: eventId,
      request_id: 'seed',
      details: { users: this.users.size, teams: this.teams.size },
    })
  }

  private anchorBugs(
    files: ChallengeFileRecord[],
    defs: Array<{
      code: string
      file: string
      pattern: RegExp
      title: string
      severity: string
      category: string
      points: number
      rcg: string
      aliases: Array<[string, number]>
      extra?: Array<[string, RegExp, boolean]>
    }>,
  ): GtBugView[] {
    const fileMap = new Map(files.map((f) => [f.path, f.content]))
    return defs.map((d) => {
      const content = fileMap.get(d.file) ?? ''
      const ln = findLine(content, d.pattern)
      const locs = [
        {
          file_path: d.file,
          line_start: Math.max(1, ln - 1),
          line_end: ln + 1,
          is_primary: true,
        },
      ]
      for (const [ef, ep, prim] of d.extra ?? []) {
        const ec = fileMap.get(ef) ?? ''
        const eln = findLine(ec, ep)
        locs.push({
          file_path: ef,
          line_start: Math.max(1, eln - 1),
          line_end: eln + 1,
          is_primary: prim,
        })
      }
      return {
        bug_id: newUuid(),
        code: d.code,
        title: d.title,
        points: d.points,
        category: d.category,
        severity: d.severity,
        root_cause_group: d.rcg,
        aliases: d.aliases,
        locations: locs,
      }
    })
  }

  private seedGroundTruthA(challengeId: string, files: ChallengeFileRecord[]) {
    this.gtBugs.set(
      challengeId,
      this.anchorBugs(files, [
        {
          code: 'BUG-01',
          file: 'db.js',
          pattern: /WHERE n\.title LIKE \? OR n\.body LIKE \?/,
          title: 'Search never matches notes',
          severity: 'medium',
          category: 'input_validation',
          points: 25,
          rcg: 'search-binding',
          aliases: [['like', 1.0], ['wildcard', 0.8], ['search', 0.6]],
          extra: [['routes/notes.js', /searchNotes\.all\(term, term\)/, false]],
        },
        {
          code: 'BUG-02',
          file: 'routes/notes.js',
          pattern: /res\.status\(201\)\.json\(\{ id: info\.changes/,
          title: 'Save response reports the wrong note id',
          severity: 'medium',
          category: 'logic',
          points: 25,
          rcg: 'create-response-id',
          aliases: [['changes', 1.0], ['lastinsertrowid', 0.8], ['insert', 0.5]],
        },
        {
          code: 'BUG-03',
          file: 'public/app.js',
          pattern: /list\.innerHTML = comments\.comments/,
          title: 'Comments execute injected markup',
          severity: 'critical',
          category: 'injection',
          points: 50,
          rcg: 'comment-render',
          aliases: [['innerhtml', 1.0], ['xss', 1.0], ['escape', 0.6]],
        },
        {
          code: 'BUG-04',
          file: 'routes/notes.js',
          pattern: /getUTCSeconds\(\)/,
          title: 'Last edited shows meaningless digits',
          severity: 'low',
          category: 'logic',
          points: 15,
          rcg: 'updated-at-units',
          aliases: [['getutcseconds', 1.0], ['iso', 0.6], ['timestamp', 0.5]],
        },
        {
          code: 'BUG-05',
          file: 'routes/notes.js',
          pattern: /deleteNote\.run\(note\.author_id\)/,
          title: 'Deleting a note removes a different note',
          severity: 'high',
          category: 'data_handling',
          points: 40,
          rcg: 'delete-target',
          aliases: [['author', 1.0], ['delete', 0.8], ['wrong note', 0.8]],
        },
        {
          code: 'BUG-06',
          file: 'db.js',
          pattern: /ORDER BY c\.created_at DESC/,
          title: 'Comments render in reverse order',
          severity: 'low',
          category: 'logic',
          points: 15,
          rcg: 'comment-order',
          aliases: [['desc', 1.0], ['asc', 0.8], ['order', 0.6]],
        },
        {
          code: 'BUG-07',
          file: 'routes/auth.js',
          pattern: /router\.post\("\/register"/,
          title: 'Registration fails on duplicates without validation',
          severity: 'medium',
          category: 'input_validation',
          points: 25,
          rcg: 'register-validation',
          aliases: [['unique', 1.0], ['constraint', 0.8], ['validation', 0.8]],
        },
        {
          code: 'BUG-08',
          file: 'server.js',
          pattern: /SESSION_TTL_MS = CONFIG_TTL_DAYS/,
          title: 'Sessions expire after minutes instead of 7 days',
          severity: 'high',
          category: 'configuration',
          points: 40,
          rcg: 'cookie-ttl-units',
          aliases: [['maxage', 1.0], ['ttl', 0.8], ['cookie', 0.8]],
        },
        {
          code: 'BUG-09',
          file: 'db.js',
          pattern: /SELECT count\(\*\) FROM notes\) AS notes_total/,
          title: 'Profile notes total counts all users notes',
          severity: 'medium',
          category: 'logic',
          points: 25,
          rcg: 'author-stats',
          aliases: [['count', 1.0], ['stats', 0.8], ['author', 0.6]],
        },
        {
          code: 'BUG-10',
          file: 'public/app.js',
          pattern: /querySelector\("\.search-go"\)/,
          title: 'Search button selector mismatch',
          severity: 'low',
          category: 'integration_api_contract',
          points: 15,
          rcg: 'search-handler',
          aliases: [['queryselector', 1.0], ['class', 0.6], ['id', 0.6]],
        },
      ]),
    )
    this.gtFlags.set(challengeId, [
      { flag_key: 'FLAG-1', code_hash: flagCodeHash('FLAG{client_gates_1e_0nly_9f2a}'), points: 30, max_awards: 99, position_label: 'Admin overview route' },
      { flag_key: 'FLAG-2', code_hash: flagCodeHash('FLAG{base64_1s_n0t_encrypt10n_44e2}'), points: 30, max_awards: 99, position_label: 'Client onboarding comment' },
    ])
  }

  private seedGroundTruthB(challengeId: string, files: ChallengeFileRecord[]) {
    this.gtBugs.set(
      challengeId,
      this.anchorBugs(files, [
        {
          code: 'BUG-01',
          file: 'database.py',
          pattern: /WHERE title LIKE \? OR body LIKE \?/,
          title: 'Search never matches notes',
          severity: 'medium',
          category: 'input_validation',
          points: 25,
          rcg: 'search-binding',
          aliases: [['like', 1.0], ['wildcard', 0.8], ['search', 0.6]],
        },
        {
          code: 'BUG-02',
          file: 'routes/notes.py',
          pattern: /"id": 1, "saved"/,
          title: 'Save response reports wrong note id',
          severity: 'medium',
          category: 'logic',
          points: 25,
          rcg: 'create-response-id',
          aliases: [['rowcount', 1.0], ['lastrowid', 0.8], ['insert', 0.5]],
        },
        {
          code: 'BUG-03',
          file: 'routes/comments.py',
          pattern: /<li><strong>/,
          title: 'Comments render unescaped HTML',
          severity: 'critical',
          category: 'injection',
          points: 50,
          rcg: 'comment-render',
          aliases: [['innerhtml', 1.0], ['xss', 1.0], ['escape', 0.6]],
        },
        {
          code: 'BUG-04',
          file: 'routes/notes.py',
          pattern: /datetime\.now\(UTC\)\.second/,
          title: 'Last edited shows seconds component',
          severity: 'low',
          category: 'logic',
          points: 15,
          rcg: 'updated-at-units',
          aliases: [['second', 1.0], ['iso', 0.6], ['timestamp', 0.5]],
        },
        {
          code: 'BUG-05',
          file: 'routes/notes.py',
          pattern: /delete_note\(note\["author_id"\]\)/,
          title: 'Delete passes author_id instead of note id',
          severity: 'high',
          category: 'data_handling',
          points: 40,
          rcg: 'delete-target',
          aliases: [['author', 1.0], ['delete', 0.8], ['wrong note', 0.8]],
        },
        {
          code: 'BUG-06',
          file: 'database.py',
          pattern: /ORDER BY created_at DESC/,
          title: 'Comments order reversed',
          severity: 'low',
          category: 'logic',
          points: 15,
          rcg: 'comment-order',
          aliases: [['desc', 1.0], ['asc', 0.8], ['order', 0.6]],
        },
        {
          code: 'BUG-07',
          file: 'routes/auth.py',
          pattern: /INSERT INTO users/,
          title: 'Registration fails on duplicate email',
          severity: 'medium',
          category: 'input_validation',
          points: 25,
          rcg: 'register-validation',
          aliases: [['unique', 1.0], ['constraint', 0.8], ['validation', 0.8]],
        },
        {
          code: 'BUG-08',
          file: 'main.py',
          pattern: /max_age = SESSION_TTL_S \/\/ 1000/,
          title: 'Session cookie max_age divided by 1000 twice',
          severity: 'high',
          category: 'configuration',
          points: 40,
          rcg: 'cookie-ttl-units',
          aliases: [['maxage', 1.0], ['ttl', 0.8], ['cookie', 0.8]],
        },
        {
          code: 'BUG-09',
          file: 'database.py',
          pattern: /SELECT count\(\*\) FROM notes\) AS notes_total/,
          title: 'Profile notes count omits author filter',
          severity: 'medium',
          category: 'logic',
          points: 25,
          rcg: 'author-stats',
          aliases: [['count', 1.0], ['stats', 0.8], ['author', 0.6]],
        },
        {
          code: 'BUG-10',
          file: 'public/app.js',
          pattern: /querySelector\("\.search-go"\)/,
          title: 'Search button selector mismatch',
          severity: 'low',
          category: 'integration_api_contract',
          points: 15,
          rcg: 'search-handler',
          aliases: [['queryselector', 1.0], ['class', 0.6], ['id', 0.6]],
        },
      ]),
    )
    this.gtFlags.set(challengeId, [
      { flag_key: 'FLAG-1', code_hash: flagCodeHash('FLAG{fastapi_0pen_0verview_7d21}'), points: 30, max_awards: 99, position_label: 'Admin overview route' },
      { flag_key: 'FLAG-2', code_hash: flagCodeHash('FLAG{b64_1s_n0t_3ncrypt10n_9c4f}'), points: 30, max_awards: 99, position_label: 'Client onboarding comment' },
    ])
  }
}

export const store = new PlatformStore()
