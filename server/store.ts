import fs from 'node:fs'
import path from 'node:path'
import {
  canonicalJson,
  flagCodeHash,
  hashPassword,
  sha256Hex,
  tokenHash,
  uuid7,
} from './security.ts'
import { decide, type GtBugView, type GtLocation } from './matching.ts'

export const PARTICIPANT_FILES = [
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
] as const

export const EVENT_CONFIG = {
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
  capacity_note: 'Provisional dev/test caps: 50 participants / 12 teams. Final caps must be load-tested (ADR-011).',
}

export const DEFAULT_STAGE_CONFIG = {
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

export const RULES_MD = `# Fall Back - Competition Rules (v1, draft for organizer review)

## 1. Participation
- Teams of 4-5 participants, registered by the Software Development Club, VIT Bhopal University.
- Accounts are personal; sharing an account between people is prohibited.
- The event is offline, at the venue, on 6 December 2026, for 180 minutes.

## 2. Main task
- Every team receives the same preconfigured full-stack application with
  intentionally planted defects. Inspect it, reproduce failures, fix them, and
  submit structured bug reports through the platform before the deadline.
- Reports need a target file, a line range (max 25 lines), a category, a title,
  and an explanation. Evidence is required for borderline matches.

## 3. Scoring (provisional, frozen before the event)
- Main score: functional tests 50%, code review 30%, evidence/report quality 20%.
- Verified CTF flags award bonus points, capped at 100 points total per team.
- Claimed severity is informational; points come from the ground truth.
- Definitively invalid reports may carry a small capped penalty, applied only
  at finalization. Plausible but unmatched reports go to human review.
- Tie-breakers: total score, then fewer invalid reports, then earlier last
  accepted finding.

## 4. Conduct and scope
- Attack ONLY the provided challenge application on your own machine.
- Attacking the platform, the venue network, other teams, or any external
  system is prohibited and grounds for disqualification.
- Do not share findings, code, or flags between teams. Screenshots of the
  challenge and external AI tools are prohibited for the main task.
- Feedback on reports is hidden until results are released; probing the
  evaluation with template reports is a violation.

## 5. Appeals
- After results are released, teams may dispute any result through the
  platform within the announced window. Resolutions are final.

## 6. Platform security safe harbor
- Found a vulnerability in the platform itself? Report it privately to the
  organizers immediately. Good-faith reports are welcomed and will not be
  penalized.

Version 1 - draft prepared for organizer/legal review before publication.
`

export interface TenantRecord {
  id: string
  slug: string
  name: string
  created_at: Date
}

export interface UserRecord {
  id: string
  tenant_id: string
  email: string
  name: string
  role: 'participant' | 'reviewer' | 'organizer' | 'admin'
  password_hash: string
  status: 'active' | 'pending' | 'disqualified'
  token_version: number
  created_at: Date
}

export interface SessionRecord {
  id: string
  user_id: string
  ip_hash: string | null
  user_agent: string
  created_at: Date
  last_seen_at: Date
  revoked_at: Date | null
  step_up_at: Date | null
}

export interface RefreshTokenRecord {
  id: string
  session_id: string
  user_id: string
  token_hash: string
  status: 'active' | 'rotated' | 'revoked'
  replaces_id: string | null
  expires_at: Date
  rotated_at: Date | null
  successor_raw: string | null
}

export interface EventRecord {
  id: string
  tenant_id: string
  slug: string
  name: string
  status: string
  starts_at: Date | null
  ends_at: Date | null
  timezone: string
  duration_minutes: number
  max_participants: number
  max_teams: number
  rules_version: number
  config_version: number
  config: Record<string, unknown>
  created_at: Date
}

export interface StageRecord {
  id: string
  event_id: string
  name: string
  kind: string
  ordinal: number
  status: string
  starts_at: Date | null
  started_at: Date | null
  ends_at: Date | null
  ended_at: Date | null
  grace_seconds: number
  config: Record<string, unknown>
  rule_set_hash: string
  created_at: Date
}

export interface TeamRecord {
  id: string
  event_id: string
  name: string
  join_code: string
  status: 'active' | 'disqualified'
  created_at: Date
}

export interface ChallengeVersionRecord {
  id: string
  event_id: string
  slug: string
  title: string
  version: number
  instructions_md: string
  status: 'draft' | 'reviewed' | 'sealed' | 'published'
  content_hash: string | null
  frozen_at: Date | null
  published_at: Date | null
  created_at: Date
}

export interface ChallengeFileRecord {
  id: string
  challenge_version_id: string
  path: string
  lang: string
  content: string
  sha256: string
  size_bytes: number
  line_count: number
}

export interface SubmissionRecord {
  id: string
  tenant_id: string
  event_id: string
  stage_id: string
  challenge_version_id: string
  team_id: string
  author_id: string
  kind: 'bug_report' | 'ctf_flag'
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
  received_at: Date
  feedback_released: boolean
  matched_bug_code: string | null
  points_visible: number | null
}

export interface ReviewItemRecord {
  id: string
  submission_id: string
  priority: number
  reason: string
  status: 'open' | 'claimed' | 'decided'
  claimed_by: string | null
  claimed_at: Date | null
  created_at: Date
}

export interface ReviewRecord {
  id: string
  submission_id: string
  reviewer_id: string
  decision: string
  rubric: Record<string, number>
  quality: number
  notes: string | null
  created_at: Date
}

export interface ScoreLedgerEntry {
  id: string
  tenant_id: string
  event_id: string
  stage_id: string
  team_id: string
  submission_id: string | null
  award_unit_id: string | null
  component: string
  kind: string
  points: number
  reason_code: string
  actor_id: string | null
  reverses_entry_id: string | null
  note: string | null
  created_at: Date
}

export interface AwardClaimRecord {
  id: string
  event_id: string
  stage_id: string
  team_id: string
  award_unit_id: string
  submission_id: string
  created_at: Date
}

export interface LeaderboardSnapshotRecord {
  id: string
  event_id: string
  stage_id: string
  version: number
  payload: {
    stage_id: string
    event_id: string
    rows: {
      rank: number
      team_id: string
      team_name: string
      score: number
      invalid_reports: number
      last_accepted_at: string | null
    }[]
    generated_at: string
  }
  visibility: string
  created_at: Date
}

export interface AuditEntryRecord {
  id: string
  event_scope: string
  seq: number
  ts: Date
  actor_id: string | null
  actor_role: string
  action: string
  entity_type: string
  entity_id: string
  request_id: string
  details: Record<string, unknown>
  prev_hash: string
  hash: string
}

export interface GtFlagRecord {
  id: string
  challenge_version_id: string
  flag_key: string
  code_hash: string
  points: number
  max_awards: number
  position_label: string
}

export function langFor(rel: string): string {
  const ext = rel.includes('.') ? rel.split('.').pop()!.toLowerCase() : 'text'
  return (
    {
      py: 'python',
      js: 'javascript',
      ts: 'typescript',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
      sql: 'sql',
    }[ext] ?? 'text'
  )
}

function findLine(content: string, pattern: RegExp): number | null {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1
  }
  return null
}

const GT_BUG_SPECS: {
  code: string
  file: string
  pattern: RegExp
  title: string
  severity: string
  category: string
  points: number
  rcg: string
  explanation: string
  aliases: [string, number][]
  extraLocs: [string, RegExp, boolean][]
}[] = [
  {
    code: 'BUG-01',
    file: 'db.js',
    pattern: /WHERE n\.title LIKE \? OR n\.body LIKE \?/,
    title: 'Search never matches notes',
    severity: 'medium',
    category: 'input_validation',
    points: 25,
    rcg: 'search-binding',
    explanation: 'The prepared statement binds the raw term so LIKE compares the exact full value; wildcards are never added.',
    aliases: [['like', 1.0], ['wildcard', 0.8], ['search', 0.6]],
    extraLocs: [['routes/notes.js', /res\.json\(\{ notes: db\.q\.searchNotes\.all\(term, term\)/, false]],
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
    explanation: 'The response returns info.changes (a rowcount) instead of info.lastInsertRowid, so the client banner links to the wrong note.',
    aliases: [['changes', 1.0], ['lastinsertrowid', 0.8], ['insert', 0.5], ['rowid', 0.5]],
    extraLocs: [['db.js', /createNote: db\.prepare/, false]],
  },
  {
    code: 'BUG-03',
    file: 'public/app.js',
    pattern: /list\.innerHTML = comments\.comments/,
    title: 'Comments execute injected markup (controlled XSS)',
    severity: 'critical',
    category: 'injection',
    points: 50,
    rcg: 'comment-render',
    explanation: "Comment bodies are interpolated into innerHTML without escaping, so markup posted as a comment executes in every reader's browser.",
    aliases: [['innerhtml', 1.0], ['xss', 1.0], ['escape', 0.6], ['onerror', 0.6]],
    extraLocs: [['routes/comments.js', /router\.post\("\/:noteId"/, false]],
  },
  {
    code: 'BUG-04',
    file: 'routes/notes.js',
    pattern: /String\(new Date\(\)\.getUTCSeconds\(\)\)/,
    title: 'Last edited shows meaningless digits',
    severity: 'low',
    category: 'logic',
    points: 15,
    rcg: 'updated-at-units',
    explanation: 'updated_at stores the seconds component of the current time instead of an ISO timestamp.',
    aliases: [['getutcseconds', 1.0], ['iso', 0.6], ['updated', 0.5], ['timestamp', 0.5]],
    extraLocs: [['db.js', /updateNote: db\.prepare/, false]],
  },
  {
    code: 'BUG-05',
    file: 'routes/notes.js',
    pattern: /db\.q\.deleteNote\.run\(note\.author_id\)/,
    title: 'Deleting a note removes a different note than requested',
    severity: 'high',
    category: 'data_handling',
    points: 40,
    rcg: 'delete-target',
    explanation: "The route passes note.author_id where the query expects the note id, so the request silently deletes the note whose id equals the caller's user id.",
    aliases: [['author', 1.0], ['delete', 0.8], ['wrong note', 0.8], ['id mismatch', 0.5]],
    extraLocs: [['db.js', /deleteNote: db\.prepare/, false]],
  },
  {
    code: 'BUG-06',
    file: 'db.js',
    pattern: /ORDER BY c\.created_at DESC LIMIT 100/,
    title: 'Comments render in reverse order',
    severity: 'low',
    category: 'logic',
    points: 15,
    rcg: 'comment-order',
    explanation: 'The comment query orders created_at DESC while the product expects chronological ascending order.',
    aliases: [['desc', 1.0], ['asc', 0.8], ['order', 0.6], ['chronological', 0.6]],
    extraLocs: [['routes/comments.js', /router\.get\("\/:noteId"/, false]],
  },
  {
    code: 'BUG-07',
    file: 'routes/auth.js',
    pattern: /router\.post\("\/register"/,
    title: 'Registration crashes with a raw 500 on duplicates',
    severity: 'medium',
    category: 'input_validation',
    points: 25,
    rcg: 'register-validation',
    explanation: 'No validation runs before the INSERT; the UNIQUE constraint error escapes as an unhandled exception.',
    aliases: [['unique', 1.0], ['constraint', 0.8], ['validation', 0.8], ['500', 0.4]],
    extraLocs: [['db.js', /createUser: db\.prepare/, false]],
  },
  {
    code: 'BUG-08',
    file: 'server.js',
    pattern: /const SESSION_TTL_MS = CONFIG_TTL_DAYS \* 60 \* 60 \* 24;/,
    title: 'Sessions expire after ~10 minutes instead of 7 days',
    severity: 'high',
    category: 'configuration',
    points: 40,
    rcg: 'cookie-ttl-units',
    explanation: 'CONFIG_TTL_DAYS (days) is multiplied as if it were milliseconds, collapsing the intended 7-day TTL to ~10 minutes.',
    aliases: [['maxage', 1.0], ['ttl', 0.8], ['cookie', 0.8], ['units', 0.6]],
    extraLocs: [['routes/auth.js', /Max-Age=\$\{Math\.floor\(ttlMs\(\) \/ 1000\)\}/, false]],
  },
  {
    code: 'BUG-09',
    file: 'db.js',
    pattern: /\(SELECT count\(\*\) FROM notes\) AS notes_total/,
    title: "Profile notes total counts everyone's notes",
    severity: 'medium',
    category: 'logic',
    points: 25,
    rcg: 'author-stats',
    explanation: 'The stats subquery counts every row of notes with no author filter.',
    aliases: [['count', 1.0], ['stats', 0.8], ['profile', 0.6], ['author', 0.6]],
    extraLocs: [['routes/auth.js', /router\.get\("\/me"/, false]],
  },
  {
    code: 'BUG-10',
    file: 'public/app.js',
    pattern: /document\.querySelector\("\.search-go"\)/,
    title: 'Search button does nothing (Enter works)',
    severity: 'low',
    category: 'integration_api_contract',
    points: 15,
    rcg: 'search-handler',
    explanation: 'The click handler queries the .search-go class selector but the button only has the search-go id, so the listener never attaches.',
    aliases: [['queryselector', 1.0], ['class', 0.6], ['id', 0.6], ['handler', 0.5]],
    extraLocs: [['public/index.html', /id="search-go"/, false]],
  },
]

const GT_FLAG_SPECS: [string, string, number, number, string][] = [
  ['FLAG-1', 'FLAG{client_gates_1e_0nly_9f2a}', 30, 99, 'Admin notice returned by the unauthenticated admin overview API (broken access control).'],
  ['FLAG-2', 'FLAG{base64_1s_n0t_encrypt10n_44e2}', 30, 99, 'Base64-encoded string in the onboarding comment of public/app.js.'],
]

class Store {
  tenants: TenantRecord[] = []
  users: UserRecord[] = []
  sessions: SessionRecord[] = []
  refreshTokens: RefreshTokenRecord[] = []
  acceptances: { id: string; user_id: string; rules_version: number; ip_hash: string | null; created_at: Date }[] = []
  invites: { id: string; event_id: string; email: string; token_hash: string; team_id: string | null; role: string; used_at: Date | null; expires_at: Date; created_at: Date }[] = []
  passwordResets: { id: string; user_id: string; token_hash: string; used_at: Date | null; expires_at: Date }[] = []
  events: EventRecord[] = []
  rulesDocuments: { id: string; event_id: string; version: number; body_md: string; content_hash: string; frozen_at: Date }[] = []
  eventConfigRevisions: { id: string; event_id: string; version: number; config: Record<string, unknown>; rule_set_hash: string; reason: string; created_by: string; frozen_at: Date | null }[] = []
  readinessItems: { id: string; event_id: string; key: string; label: string; owner: string; state: 'checked' | 'unchecked' | 'na'; checked_at: Date | null }[] = []
  stages: StageRecord[] = []
  stageTransitions: { id: string; stage_id: string; from_status: string; to_status: string; actor_id: string; reason_code: string; created_at: Date }[] = []
  timeAdjustments: { id: string; stage_id: string; user_id: string | null; delta_seconds: number; reason_code: string; created_by: string; created_at: Date }[] = []
  teams: TeamRecord[] = []
  teamMembers: { id: string; team_id: string; user_id: string }[] = []
  challengeVersions: ChallengeVersionRecord[] = []
  challengeFiles: ChallengeFileRecord[] = []
  challengeFileLines: { id: string; challenge_version_id: string; path: string; line_number: number; line_text: string }[] = []
  assignments: { id: string; event_id: string; stage_id: string; challenge_version_id: string; team_id: string | null; repo_url: string | null; codespace_url: string | null }[] = []
  announcements: { id: string; event_id: string; severity: 'info' | 'warning' | 'critical'; audience: string; body: string; created_by: string; created_at: Date }[] = []
  submissions: SubmissionRecord[] = []
  drafts: { id: string; author_id: string; challenge_version_id: string; payload: Record<string, unknown>; version: number; updated_at: Date }[] = []
  reviewItems: ReviewItemRecord[] = []
  reviews: ReviewRecord[] = []
  awardClaims: AwardClaimRecord[] = []
  scoreLedgerEntries: ScoreLedgerEntry[] = []
  leaderboardSnapshots: LeaderboardSnapshotRecord[] = []
  disputes: { id: string; submission_id: string; team_id: string; statement: string; status: string; resolution: string | null; resolved_by: string | null; resolved_at: Date | null; created_at: Date }[] = []
  exports: { id: string; event_id: string; kind: string; content: string; content_hash: string; created_by: string; created_at: Date }[] = []
  auditEntries: AuditEntryRecord[] = []
  auditSeq = 0

  // Ground truth trust domain (never exposed to participant APIs)
  gt = {
    bugs: [] as (GtBugView & { challenge_version_id: string; title: string; explanation: string; fix_guidance: string | null })[],
    flags: [] as GtFlagRecord[],
  }

  constructor() {
    this.seed()
  }

  auditWrite(opts: {
    actor_id: string | null
    actor_role: string
    action: string
    entity_type: string
    entity_id: string
    request_id: string
    details?: Record<string, unknown>
    event_scope?: string
  }): string {
    const scope = opts.event_scope ?? 'global'
    const details = opts.details ?? {}
    const detailsJson = canonicalJson(details)
    const prevEntry = [...this.auditEntries].reverse().find((e) => e.event_scope === scope)
    const prevHash = prevEntry ? prevEntry.hash : 'GENESIS'
    const material = `${prevHash}|${opts.actor_id ?? 'None'}|${opts.actor_role}|${opts.action}|${opts.entity_type}|${opts.entity_id}|${opts.request_id}|${detailsJson}`
    const hash = sha256Hex(material)
    const id = uuid7()
    this.auditSeq += 1
    this.auditEntries.push({
      id,
      event_scope: scope,
      seq: this.auditSeq,
      ts: new Date(),
      actor_id: opts.actor_id,
      actor_role: opts.actor_role,
      action: opts.action,
      entity_type: opts.entity_type,
      entity_id: opts.entity_id,
      request_id: opts.request_id,
      details,
      prev_hash: prevHash,
      hash,
    })
    return id
  }

  auditVerify(scope = 'global', limit = 5000): { scope: string; entries: number; verified: number; broken_at: string | null; intact: boolean } {
    const rows = this.auditEntries.filter((e) => e.event_scope === scope).slice(0, limit)
    let prev = 'GENESIS'
    let brokenAt: string | null = null
    let checked = 0
    for (const r of rows) {
      const material = `${prev}|${r.actor_id ?? 'None'}|${r.actor_role}|${r.action}|${r.entity_type}|${r.entity_id}|${r.request_id}|${canonicalJson(r.details)}`
      const expected = sha256Hex(material)
      if (expected !== r.hash) {
        brokenAt = r.id
        break
      }
      prev = r.hash
      checked += 1
    }
    return { scope, entries: rows.length, verified: checked, broken_at: brokenAt, intact: brokenAt === null }
  }

  private seed(): void {
    const now = new Date()
    const challengeDir = path.resolve(process.cwd(), 'challenge-app')
    const defaultPwHash = hashPassword('Dev-only!Passw0rd!')

    const tenantId = uuid7()
    this.tenants.push({
      id: tenantId,
      slug: 'sdc-vitb',
      name: 'Software Development Club, VIT Bhopal University',
      created_at: now,
    })

    const userMap: Record<string, string> = {}
    const staff: [string, string, UserRecord['role']][] = [
      ['admin@example.com', 'Platform Admin', 'admin'],
      ['organizer@example.com', 'Kalpesh Parashar', 'organizer'],
      ['organizer2@example.com', 'Aashish Prasad', 'organizer'],
      ['reviewer1@example.com', 'Reviewer One', 'reviewer'],
      ['reviewer2@example.com', 'Reviewer Two', 'reviewer'],
    ]
    for (const [email, name, role] of staff) {
      const uid = uuid7()
      userMap[email] = uid
      this.users.push({
        id: uid,
        tenant_id: tenantId,
        email,
        name,
        role,
        password_hash: defaultPwHash,
        status: 'active',
        token_version: 1,
        created_at: now,
      })
    }

    const eventId = uuid7()
    const eventStartsAt = new Date('2026-12-06T10:00:00+05:30')
    const eventEndsAt = new Date(eventStartsAt.getTime() + 180 * 60 * 1000)
    this.events.push({
      id: eventId,
      tenant_id: tenantId,
      slug: 'fall-back-2026',
      name: 'Fall Back - Full-Stack Software Debugging Challenge',
      status: 'live',
      starts_at: eventStartsAt,
      ends_at: eventEndsAt,
      timezone: 'Asia/Kolkata',
      duration_minutes: 180,
      max_participants: 50,
      max_teams: 10,
      rules_version: 1,
      config_version: 1,
      config: EVENT_CONFIG,
      created_at: now,
    })

    this.rulesDocuments.push({
      id: uuid7(),
      event_id: eventId,
      version: 1,
      body_md: RULES_MD,
      content_hash: sha256Hex(RULES_MD),
      frozen_at: now,
    })

    const readinessSpecs: [string, string, string][] = [
      ['load_test_50', 'Load test at the approved cap passes thresholds', 'infrastructure lead'],
      ['gt_isolation', 'app_api cannot read gt (tested with the real role)', 'application lead'],
      ['backup_restore', 'Backup/restore rehearsal completed and measured', 'infrastructure lead'],
      ['pen_test', 'Security review completed; high/critical closed', 'application lead'],
      ['challenge_audit', 'Two independent reviewers certified the challenge (unplanned defects)', 'review lead'],
      ['dry_run', 'Full dry run with real users on the venue network', 'event lead'],
      ['rules_published', 'Rules, privacy notice and consent flows published', 'organizer'],
      ['runbooks', 'Event-day runbook rehearsed; roles assigned', 'event lead'],
    ]
    for (const [key, label, owner] of readinessSpecs) {
      this.readinessItems.push({
        id: uuid7(),
        event_id: eventId,
        key,
        label,
        owner,
        state: 'checked',
        checked_at: now,
      })
    }

    const stageId = uuid7()
    const rsh = 'sha256:' + sha256Hex(canonicalJson(DEFAULT_STAGE_CONFIG))
    this.stages.push({
      id: stageId,
      event_id: eventId,
      name: 'Fall Back Main Challenge',
      kind: 'main',
      ordinal: 1,
      status: 'active',
      starts_at: eventStartsAt,
      started_at: now,
      ends_at: eventEndsAt,
      ended_at: null,
      grace_seconds: 3,
      config: { ...DEFAULT_STAGE_CONFIG },
      rule_set_hash: rsh,
      created_at: now,
    })

    // Ingest ONLY PARTICIPANT_FILES from challenge-app/ (never ORGANIZER_ANSWER_KEY.md)
    const challengeId = uuid7()
    const readmePath = path.join(challengeDir, 'README.md')
    const instructions = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : 'Papyrus challenge'
    this.challengeVersions.push({
      id: challengeId,
      event_id: eventId,
      slug: 'papyrus',
      title: 'Papyrus - Campus Notes (challenge edition)',
      version: 1,
      instructions_md: instructions,
      status: 'published',
      content_hash: 'sha256:' + sha256Hex(JSON.stringify([...PARTICIPANT_FILES])),
      frozen_at: now,
      published_at: now,
      created_at: now,
    })

    const fileContents = new Map<string, string>()
    for (const rel of PARTICIPANT_FILES) {
      const fullPath = path.join(challengeDir, rel)
      if (!fs.existsSync(fullPath)) continue
      const content = fs.readFileSync(fullPath, 'utf8')
      fileContents.set(rel, content)
      const lines = content.split(/\r?\n/)
      this.challengeFiles.push({
        id: uuid7(),
        challenge_version_id: challengeId,
        path: rel,
        lang: langFor(rel),
        content,
        sha256: sha256Hex(content),
        size_bytes: Buffer.byteLength(content, 'utf8'),
        line_count: lines.length,
      })
      for (let i = 0; i < Math.min(lines.length, 5000); i++) {
        this.challengeFileLines.push({
          id: uuid7(),
          challenge_version_id: challengeId,
          path: rel,
          line_number: i + 1,
          line_text: lines[i].slice(0, 500),
        })
      }
    }

    this.assignments.push({
      id: uuid7(),
      event_id: eventId,
      stage_id: stageId,
      challenge_version_id: challengeId,
      team_id: null,
      repo_url: null,
      codespace_url: null,
    })

    // Teams & participants
    const teamSpecs: [string, string, string[]][] = [
      ['Team Lambda', 'LAMBDA01', ['p1.team1@example.com', 'p2.team1@example.com', 'p3.team1@example.com', 'p4.team1@example.com']],
      ['Team Vector', 'VECTOR02', ['p1.team2@example.com', 'p2.team2@example.com', 'p3.team2@example.com', 'p4.team2@example.com', 'p5.team2@example.com']],
    ]
    for (const [tname, joinCode, members] of teamSpecs) {
      const teamId = uuid7()
      this.teams.push({
        id: teamId,
        event_id: eventId,
        name: tname,
        join_code: joinCode,
        status: 'active',
        created_at: now,
      })
      for (const email of members) {
        const uid = uuid7()
        userMap[email] = uid
        const display = email
          .split('@')[0]
          .replace('.', ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
        this.users.push({
          id: uid,
          tenant_id: tenantId,
          email,
          name: display,
          role: 'participant',
          password_hash: defaultPwHash,
          status: 'active',
          token_version: 1,
          created_at: now,
        })
        this.teamMembers.push({ id: uuid7(), team_id: teamId, user_id: uid })
      }
    }

    this.announcements.push({
      id: uuid7(),
      event_id: eventId,
      severity: 'info',
      audience: 'all',
      body: 'Welcome to Fall Back! Review the rules, inspect Papyrus in the workspace, and file structured bug reports before the clock expires.',
      created_by: userMap['organizer@example.com'],
      created_at: now,
    })

    // Seed ground truth (isolated)
    for (const spec of GT_BUG_SPECS) {
      const primaryContent = fileContents.get(spec.file) ?? ''
      const lineno = findLine(primaryContent, spec.pattern)
      const locs: GtLocation[] = []
      if (lineno !== null) {
        locs.push({
          file_path: spec.file,
          line_start: Math.max(1, lineno - 1),
          line_end: lineno + 1,
          is_primary: true,
        })
      }
      for (const [lf, lp, prim] of spec.extraLocs) {
        const lc = fileContents.get(lf) ?? ''
        const lno = findLine(lc, lp)
        if (lno !== null) {
          locs.push({
            file_path: lf,
            line_start: Math.max(1, lno - 1),
            line_end: lno + 1,
            is_primary: prim,
          })
        }
      }
      this.gt.bugs.push({
        bug_id: uuid7(),
        challenge_version_id: challengeId,
        code: spec.code,
        title: spec.title,
        severity: spec.severity,
        category: spec.category,
        points: spec.points,
        root_cause_group: spec.rcg,
        explanation: spec.explanation,
        fix_guidance: null,
        aliases: spec.aliases,
        locations: locs,
      })
    }

    for (const [flagKey, plaintext, points, maxAwards, note] of GT_FLAG_SPECS) {
      this.gt.flags.push({
        id: uuid7(),
        challenge_version_id: challengeId,
        flag_key: flagKey,
        code_hash: flagCodeHash(plaintext),
        points,
        max_awards: maxAwards,
        position_label: note,
      })
    }

    this.auditWrite({
      actor_id: null,
      actor_role: 'system',
      action: 'seed.completed',
      entity_type: 'event',
      entity_id: eventId,
      request_id: 'seed',
      details: { users: this.users.length, teams: this.teams.length },
    })

    this.refreshLeaderboard(stageId)
  }

  // --- Scoring & Evaluation (inline replacement for PostgreSQL job queue) ---

  computeAwardPoints(
    bugPoints: number,
    weights: Record<string, number>,
    opts: { testFraction: number; reviewQuality: number; evidenceQuality: number },
  ) {
    const wFunc = Number(weights.functional_test ?? 0.5)
    const wRev = Number(weights.code_review ?? 0.3)
    const wEv = Number(weights.evidence_report ?? 0.2)
    const clamp = (n: number) => Math.max(0, Math.min(1, n))
    return {
      functional_test: Math.round(bugPoints * wFunc * clamp(opts.testFraction) * 100) / 100,
      code_review: Math.round(bugPoints * wRev * clamp(opts.reviewQuality) * 100) / 100,
      evidence_report: Math.round(bugPoints * wEv * clamp(opts.evidenceQuality) * 100) / 100,
    }
  }

  addLedgerEntry(entry: Omit<ScoreLedgerEntry, 'id' | 'created_at'>): string {
    const id = uuid7()
    this.scoreLedgerEntries.push({
      id,
      ...entry,
      points: Math.round(entry.points * 100) / 100,
      created_at: new Date(),
    })
    return id
  }

  claimAwardUnit(opts: {
    event_id: string
    stage_id: string
    team_id: string
    award_unit_id: string
    submission_id: string
  }): boolean {
    const exists = this.awardClaims.some(
      (c) => c.stage_id === opts.stage_id && c.team_id === opts.team_id && c.award_unit_id === opts.award_unit_id,
    )
    if (exists) return false
    this.awardClaims.push({
      id: uuid7(),
      ...opts,
      created_at: new Date(),
    })
    return true
  }

  hasComponent(submissionId: string, component: string): boolean {
    return this.scoreLedgerEntries.some(
      (l) => l.submission_id === submissionId && l.component === component && l.kind === 'award',
    )
  }

  createReviewItem(submissionId: string, reason: string, priority: number): void {
    const exists = this.reviewItems.some((r) => r.submission_id === submissionId && r.status !== 'decided')
    if (exists) return
    this.reviewItems.push({
      id: uuid7(),
      submission_id: submissionId,
      priority,
      reason,
      status: 'open',
      claimed_by: null,
      claimed_at: null,
      created_at: new Date(),
    })
  }

  evaluateSubmission(submissionId: string): void {
    const sub = this.submissions.find((s) => s.id === submissionId)
    if (!sub) return
    if (sub.kind === 'ctf_flag') {
      this.verifyFlag(submissionId)
      this.refreshLeaderboard(sub.stage_id)
      return
    }
    const event = this.events.find((e) => e.id === sub.event_id)
    const stage = this.stages.find((st) => st.id === sub.stage_id)
    const evCfg = (event?.config ?? {}) as Record<string, unknown>
    const stCfg = (stage?.config ?? {}) as Record<string, unknown>
    const scoringCfg = (evCfg.scoring ?? {}) as Record<string, unknown>
    const weights = (scoringCfg.weights ?? { functional_test: 0.5, code_review: 0.3, evidence_report: 0.2 }) as Record<string, number>
    const ruleSet = {
      max_span: Number(stCfg.max_span ?? 25),
      location_tolerance_lines: Number(stCfg.location_tolerance_lines ?? 2),
      min_description_chars: 20,
    }
    const awarded = new Set(
      this.awardClaims.filter((c) => c.stage_id === sub.stage_id && c.team_id === sub.team_id).map((c) => c.award_unit_id),
    )
    const candidates = this.gt.bugs.filter((b) => b.challenge_version_id === sub.challenge_version_id)
    const decision = decide(sub.payload, candidates, ruleSet, awarded)

    if (decision.outcome === 'accept_full' && decision.bug) {
      const bug = decision.bug
      const claimed = this.claimAwardUnit({
        event_id: sub.event_id,
        stage_id: sub.stage_id,
        team_id: sub.team_id,
        award_unit_id: bug.code,
        submission_id: sub.id,
      })
      if (claimed) {
        const pts = this.computeAwardPoints(bug.points, weights, {
          testFraction: 0,
          reviewQuality: 0,
          evidenceQuality: Math.max(decision.features.alias_evidence, 0.6),
        })
        this.addLedgerEntry({
          tenant_id: sub.tenant_id,
          event_id: sub.event_id,
          stage_id: sub.stage_id,
          team_id: sub.team_id,
          submission_id: sub.id,
          award_unit_id: bug.code,
          component: 'evidence_report',
          kind: 'award',
          points: pts.evidence_report,
          reason_code: 'MATCH_FULL',
          actor_id: null,
          reverses_entry_id: null,
          note: `bug=${bug.code} L=${decision.features.location_score.toFixed(2)} C=${decision.features.category_score.toFixed(2)} A=${decision.features.alias_evidence.toFixed(2)}`,
        })
        sub.status = 'matched_auto'
        sub.matched_bug_code = bug.code
        sub.points_visible = pts.evidence_report
        this.createReviewItem(sub.id, 'auto_accept_confirm', 7)
      } else {
        sub.status = 'duplicate'
      }
    } else if (decision.outcome === 'accept_partial') {
      sub.status = 'needs_review'
      this.createReviewItem(sub.id, 'partial_match', 5)
    } else if (decision.outcome === 'reject_invalid') {
      sub.status = 'rejected_auto'
    } else if (decision.outcome === 'duplicate') {
      sub.status = 'duplicate'
    } else {
      sub.status = 'needs_review'
      this.createReviewItem(sub.id, 'borderline', 5)
    }
    this.refreshLeaderboard(sub.stage_id)
  }

  verifyFlag(submissionId: string): void {
    const sub = this.submissions.find((s) => s.id === submissionId)
    if (!sub) return
    const stage = this.stages.find((st) => st.id === sub.stage_id)
    const cap = Number((stage?.config as Record<string, unknown> | undefined)?.ctf_bonus_cap_points ?? 100)
    const flag = sub.flag_code
      ? this.gt.flags.find(
          (f) => f.challenge_version_id === sub.challenge_version_id && f.code_hash === flagCodeHash(sub.flag_code!),
        )
      : undefined
    if (!flag) {
      sub.status = 'rejected_auto'
      return
    }
    const claimedCount = this.awardClaims.filter((c) => c.award_unit_id === flag.flag_key).length
    if (claimedCount >= flag.max_awards) {
      sub.status = 'duplicate'
      return
    }
    const ok = this.claimAwardUnit({
      event_id: sub.event_id,
      stage_id: sub.stage_id,
      team_id: sub.team_id,
      award_unit_id: flag.flag_key,
      submission_id: sub.id,
    })
    if (!ok) {
      sub.status = 'duplicate'
      return
    }
    const currentBonus = this.scoreLedgerEntries
      .filter((l) => l.stage_id === sub.stage_id && l.team_id === sub.team_id && l.component === 'ctf_bonus')
      .reduce((sum, l) => sum + l.points, 0)
    const awardPoints = Math.min(flag.points, Math.max(0, cap - currentBonus))
    this.addLedgerEntry({
      tenant_id: sub.tenant_id,
      event_id: sub.event_id,
      stage_id: sub.stage_id,
      team_id: sub.team_id,
      submission_id: sub.id,
      award_unit_id: flag.flag_key,
      component: 'ctf_bonus',
      kind: 'bonus',
      points: awardPoints,
      reason_code: 'FLAG_VERIFIED',
      actor_id: null,
      reverses_entry_id: null,
      note: `flag=${flag.flag_key}` + (awardPoints === flag.points ? '' : ' (capped)'),
    })
    sub.status = 'matched_auto'
    sub.matched_bug_code = flag.flag_key
    sub.points_visible = awardPoints
  }

  applyReviewOutcome(submissionId: string, reviewId: string, decision: string): void {
    const sub = this.submissions.find((s) => s.id === submissionId)
    const rev = this.reviews.find((r) => r.id === reviewId)
    if (!sub || !rev) return
    const event = this.events.find((e) => e.id === sub.event_id)
    const weights = ((event?.config as Record<string, unknown>)?.scoring as Record<string, unknown>)?.weights as Record<string, number> ?? {
      functional_test: 0.5,
      code_review: 0.3,
      evidence_report: 0.2,
    }
    if (decision === 'accept_full' || decision === 'accept_partial') {
      const claim = this.awardClaims.find((c) => c.submission_id === submissionId)
      const unitId = claim?.award_unit_id ?? null
      let reviewQuality = Number(rev.rubric.code_quality ?? 0) * 0.4 + Number(rev.rubric.root_cause ?? 0) * 0.6
      if (decision === 'accept_full') reviewQuality = Math.max(reviewQuality, 0.5)
      if (decision === 'accept_partial') reviewQuality *= 0.5
      if (unitId && !this.hasComponent(submissionId, 'code_review')) {
        const bug = this.gt.bugs.find((b) => b.code === unitId && b.challenge_version_id === sub.challenge_version_id)
        const bugPoints = bug?.points ?? 0
        const pts = this.computeAwardPoints(bugPoints, weights, {
          testFraction: 0,
          reviewQuality,
          evidenceQuality: 0,
        })
        this.addLedgerEntry({
          tenant_id: sub.tenant_id,
          event_id: sub.event_id,
          stage_id: sub.stage_id,
          team_id: sub.team_id,
          submission_id: sub.id,
          award_unit_id: unitId,
          component: 'code_review',
          kind: 'award',
          points: pts.code_review,
          reason_code: decision.toUpperCase(),
          actor_id: rev.reviewer_id,
          reverses_entry_id: null,
          note: `rubric=${JSON.stringify(rev.rubric).slice(0, 300)}`,
        })
        sub.points_visible = Math.round(((sub.points_visible ?? 0) + pts.code_review) * 100) / 100
      }
      sub.status = 'decided'
    } else if (decision === 'reject_invalid') {
      sub.status = 'decided'
    } else if (decision === 'unplanned_valid') {
      sub.status = 'needs_review'
      this.createReviewItem(sub.id, 'unplanned_valid', 2)
    }
    this.refreshLeaderboard(sub.stage_id)
  }

  applyTestResults(submissionId: string, passed: number, total: number, actorId: string): void {
    if (this.hasComponent(submissionId, 'functional_test')) return
    const sub = this.submissions.find((s) => s.id === submissionId)
    if (!sub) return
    const claim = this.awardClaims.find((c) => c.submission_id === submissionId)
    if (!claim) return
    const event = this.events.find((e) => e.id === sub.event_id)
    const weights = ((event?.config as Record<string, unknown>)?.scoring as Record<string, unknown>)?.weights as Record<string, number> ?? {
      functional_test: 0.5,
      code_review: 0.3,
      evidence_report: 0.2,
    }
    const bug = this.gt.bugs.find((b) => b.code === claim.award_unit_id && b.challenge_version_id === sub.challenge_version_id)
    const bugPoints = bug?.points ?? 0
    const pts = this.computeAwardPoints(bugPoints, weights, {
      testFraction: passed / total,
      reviewQuality: 0,
      evidenceQuality: 0,
    })
    this.addLedgerEntry({
      tenant_id: sub.tenant_id,
      event_id: sub.event_id,
      stage_id: sub.stage_id,
      team_id: sub.team_id,
      submission_id: sub.id,
      award_unit_id: claim.award_unit_id,
      component: 'functional_test',
      kind: 'award',
      points: pts.functional_test,
      reason_code: 'TEST_RESULTS',
      actor_id: actorId,
      reverses_entry_id: null,
      note: `passed ${passed}/${total}`,
    })
    sub.points_visible = Math.round(((sub.points_visible ?? 0) + pts.functional_test) * 100) / 100
    this.refreshLeaderboard(sub.stage_id)
  }

  releaseFeedback(stageId: string): void {
    const stage = this.stages.find((s) => s.id === stageId)
    if (!stage) return
    const event = this.events.find((e) => e.id === stage.event_id)
    if (!event) return
    const evCfg = event.config as Record<string, unknown>
    const scoringCfg = (evCfg.scoring ?? {}) as Record<string, unknown>
    const weights = (scoringCfg.weights ?? { functional_test: 0.5, code_review: 0.3, evidence_report: 0.2 }) as Record<string, number>
    const defaultReviewQuality = Number(scoringCfg.default_review_quality ?? 0.8)
    const penaltyCfg = ((stage.config as Record<string, unknown>).penalty ?? { fp_factor: 0.25, cap_fraction: 0.2 }) as Record<string, number>

    const accepts = this.submissions.filter(
      (s) =>
        s.stage_id === stageId &&
        ['decided', 'matched_auto', 'ledgered'].includes(s.status) &&
        s.kind === 'bug_report' &&
        s.matched_bug_code !== null,
    )
    for (const a of accepts) {
      if (this.hasComponent(a.id, 'code_review')) continue
      const bug = this.gt.bugs.find((b) => b.code === a.matched_bug_code && b.challenge_version_id === a.challenge_version_id)
      const bugPoints = bug?.points ?? 0
      const pts = this.computeAwardPoints(bugPoints, weights, {
        testFraction: 0,
        reviewQuality: defaultReviewQuality,
        evidenceQuality: 0,
      })
      this.addLedgerEntry({
        tenant_id: event.tenant_id,
        event_id: event.id,
        stage_id: stageId,
        team_id: a.team_id,
        submission_id: a.id,
        award_unit_id: a.matched_bug_code,
        component: 'code_review',
        kind: 'award',
        points: pts.code_review,
        reason_code: 'RELEASE_DEFAULT',
        actor_id: null,
        reverses_entry_id: null,
        note: `default review quality ${defaultReviewQuality} applied at release (disputable)`,
      })
      a.status = 'ledgered'
      a.points_visible = Math.round(((a.points_visible ?? 0) + pts.code_review) * 100) / 100
    }

    const fpFactor = Number(penaltyCfg.fp_factor ?? 0)
    if (fpFactor > 0) {
      const assignedChallengeIds = new Set(this.assignments.filter((a) => a.stage_id === stageId).map((a) => a.challenge_version_id))
      const stageMax = this.gt.bugs
        .filter((b) => assignedChallengeIds.has(b.challenge_version_id))
        .reduce((sum, b) => sum + b.points, 0)
      const cap = stageMax * Number(penaltyCfg.cap_fraction ?? 0.2)

      const rejectCounts = new Map<string, number>()
      for (const s of this.submissions) {
        if (s.stage_id === stageId && s.status === 'rejected_auto' && s.kind === 'bug_report') {
          rejectCounts.set(s.team_id, (rejectCounts.get(s.team_id) ?? 0) + 1)
        }
      }
      for (const [teamId, count] of rejectCounts.entries()) {
        const penaltyEach = 10 * fpFactor
        const penaltyTotal = Math.min(penaltyEach * count, cap)
        if (penaltyTotal > 0) {
          this.addLedgerEntry({
            tenant_id: event.tenant_id,
            event_id: event.id,
            stage_id: stageId,
            team_id: teamId,
            submission_id: null,
            award_unit_id: null,
            component: 'penalty',
            kind: 'penalty',
            points: -penaltyTotal,
            reason_code: 'INVALID_REPORT_PENALTY',
            actor_id: null,
            reverses_entry_id: null,
            note: `${count} invalid report(s), capped at ${cap.toFixed(1)}`,
          })
        }
      }
    }

    for (const s of this.submissions) {
      if (s.stage_id === stageId) s.feedback_released = true
    }
  }

  refreshLeaderboard(stageId: string, visibilityOverride?: string): void {
    const stage = this.stages.find((s) => s.id === stageId)
    if (!stage) return
    const mode = String((stage.config as Record<string, unknown>).leaderboard_mode ?? 'hidden')
    const visibility = visibilityOverride ?? (mode === 'live' ? 'public' : 'restricted')
    const eventTeams = this.teams.filter((t) => t.event_id === stage.event_id)

    const totals = new Map<string, number>()
    for (const l of this.scoreLedgerEntries) {
      if (l.stage_id === stageId) {
        totals.set(l.team_id, Math.round(((totals.get(l.team_id) ?? 0) + l.points) * 100) / 100)
      }
    }

    const invalidCounts = new Map<string, number>()
    for (const s of this.submissions) {
      if (s.stage_id === stageId && s.status === 'rejected_auto' && s.kind === 'bug_report') {
        invalidCounts.set(s.team_id, (invalidCounts.get(s.team_id) ?? 0) + 1)
      }
    }

    const lastAccepted = new Map<string, Date>()
    for (const l of this.scoreLedgerEntries) {
      if (l.stage_id === stageId && l.component !== 'penalty' && l.submission_id) {
        const sub = this.submissions.find((s) => s.id === l.submission_id)
        if (sub) {
          const prev = lastAccepted.get(l.team_id)
          if (!prev || sub.received_at > prev) lastAccepted.set(l.team_id, sub.received_at)
        }
      }
    }

    const ordered = [...eventTeams].sort((a, b) => {
      const scoreDiff = (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0)
      if (scoreDiff !== 0) return scoreDiff
      const invDiff = (invalidCounts.get(a.id) ?? 0) - (invalidCounts.get(b.id) ?? 0)
      if (invDiff !== 0) return invDiff
      const la = lastAccepted.get(a.id)?.getTime() ?? Number.MAX_SAFE_INTEGER
      const lb = lastAccepted.get(b.id)?.getTime() ?? Number.MAX_SAFE_INTEGER
      return la - lb
    })

    const now = new Date()
    const payload = {
      stage_id: stageId,
      event_id: stage.event_id,
      rows: ordered.map((t, idx) => ({
        rank: idx + 1,
        team_id: t.id,
        team_name: t.name,
        score: totals.get(t.id) ?? 0,
        invalid_reports: invalidCounts.get(t.id) ?? 0,
        last_accepted_at: lastAccepted.get(t.id)?.toISOString() ?? null,
      })),
      generated_at: now.toISOString(),
    }

    const currentMax = this.leaderboardSnapshots
      .filter((s) => s.stage_id === stageId)
      .reduce((m, s) => Math.max(m, s.version), 0)

    this.leaderboardSnapshots.push({
      id: uuid7(),
      event_id: stage.event_id,
      stage_id: stageId,
      version: currentMax + 1,
      payload,
      visibility,
      created_at: now,
    })
  }
}

export const store = new Store()
