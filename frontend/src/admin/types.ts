export type EventStatus = 'Upcoming' | 'Registration Open' | 'Live' | 'Paused' | 'Completed'

export type RegistrationStatus = 'registered' | 'pending' | 'invited' | 'waitlisted'
export type ParticipationStatus = 'active' | 'inactive' | 'disabled' | 'removed'

export interface Participant {
  id: string
  name: string
  email: string
  teamId: string | null
  registrationStatus: RegistrationStatus
  participationStatus: ParticipationStatus
  registeredAt: string
  lastActiveAt: string | null
}

export interface Team {
  id: string
  name: string
  capacity: number
  createdAt: string
  joinCode: string
  functionalScore: number
  evaluationScore: number
  ctfBonus: number
  penalties: number
}

export type RoundStatus = 'draft' | 'active' | 'completed'
export type PublishStatus = 'draft' | 'published'

export interface Round {
  id: string
  name: string
  description: string
  active: boolean
  durationMinutes: number
  instructions: string
  order: number
  status: RoundStatus
}

export interface Criterion {
  id: string
  name: string
  description: string
  maxPoints: number
}

export interface Evaluation {
  id: string
  roundId: string | null
  title: string
  description: string
  instructions: string
  repositoryId: string | null
  maxScore: number
  bonusPoints: number
  criteria: Criterion[]
  questionIds: string[]
  status: PublishStatus
  createdAt: string
  updatedAt: string
}

export type Difficulty = 'easy' | 'medium' | 'hard'
export type QuestionStatus = 'draft' | 'published'

export interface Question {
  id: string
  title: string
  description: string
  instructions: string
  expectedTask: string
  scoringCriteria: string
  maxPoints: number
  difficulty: Difficulty
  status: QuestionStatus
  roundId: string | null
  evaluationId: string | null
  order: number
}

export type RepositoryStatus = 'draft' | 'active' | 'archived'

export interface Repository {
  id: string
  name: string
  identifier: string
  url: string
  roundId: string | null
  evaluationId: string | null
  status: RepositoryStatus
  lastUpdated: string
  configuration: string
}

export interface ScoreAdjustment {
  id: string
  teamId: string
  teamName: string
  amount: number
  reason: string
  category: 'malpractice' | 'penalty' | 'scoring_error' | 'evaluation_correction' | 'administrative' | 'malpractice_reversal'
  adminIdentity: string
  timestamp: string
  previousScore: number
  updatedScore: number
  incidentId: string | null
}

export type IncidentType =
  | 'clipboard_copy'
  | 'clipboard_paste'
  | 'ctrl_c'
  | 'ctrl_v'
  | 'ctrl_shift_i'
  | 'repeated_suspicious_activity'
  | 'admin_warning'
  | 'other'

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export type IncidentStatus = 'new' | 'under_review' | 'confirmed' | 'dismissed' | 'action_taken'

export interface IncidentEvent {
  id: string
  timestamp: string
  kind: string
  detail: string
}

export interface IncidentNote {
  id: string
  timestamp: string
  admin: string
  body: string
}

export interface Incident {
  id: string
  teamId: string
  teamName: string
  participantId: string | null
  participantName: string | null
  type: IncidentType
  timestamp: string
  roundId: string | null
  roundName: string | null
  severity: IncidentSeverity
  status: IncidentStatus
  events: IncidentEvent[]
  notes: IncidentNote[]
  warningIssued: boolean
  penaltyApplied: boolean
}

export type AdminRole = 'super_admin' | 'admin' | 'organizer' | 'viewer'
export type AdminStatus = 'active' | 'suspended' | 'revoked' | 'pending'

export interface AdminAccount {
  id: string
  name: string
  email: string
  role: AdminRole
  status: AdminStatus
  createdAt: string
  lastLoginAt: string | null
  resetRequired: boolean
  resetToken: string | null
  resetTokenIssuedAt: string | null
}

export interface LoginAttempt {
  id: string
  timestamp: string
  email: string
  success: boolean
  reason: string
}

export interface AdminSession {
  id: string
  adminId: string
  adminName: string
  createdAt: string
  lastSeenAt: string
  revoked: boolean
}

export interface ActivityEntry {
  id: string
  timestamp: string
  admin: string
  action: string
  targetType: string
  targetId: string
  targetLabel: string
  previousValue: string | null
  newValue: string | null
}

export type NotificationKind =
  | 'registration'
  | 'csv_import'
  | 'round_change'
  | 'submission'
  | 'score_change'
  | 'flag'
  | 'malpractice'
  | 'server_degraded'
  | 'infrastructure_critical'
  | 'system'

export type NotificationSeverity = 'info' | 'warning' | 'critical'

export interface AppNotification {
  id: string
  timestamp: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body: string
  read: boolean
  link: string | null
}

export interface PermissionRow {
  permission: string
  description: string
  roles: Record<AdminRole, boolean>
}

export interface EventConfig {
  eventName: string
  organizer: string
  eventStatus: EventStatus
  currentRoundId: string | null
  timezone: string
  registrationOpen: boolean
  maxParticipants: number
  maxTeams: number
  teamSizeMin: number
  teamSizeMax: number
  scoringNotes: string
}

export type ServiceStatus = 'Operational' | 'Degraded' | 'Critical' | 'Offline'

export interface Service {
  id: string
  name: string
  status: ServiceStatus
  detail: string
}

export interface InfraSample {
  t: string
  cpu: number
  ram: number
  disk: number
  networkIn: number
  networkOut: number
  load: number
  connections: number
  apiResponseMs: number
  errorRate: number
}

export interface AdminWorkspace {
  event: EventConfig
  participants: Participant[]
  teams: Team[]
  rounds: Round[]
  evaluations: Evaluation[]
  questions: Question[]
  repositories: Repository[]
  adjustments: ScoreAdjustment[]
  incidents: Incident[]
  admins: AdminAccount[]
  loginAttempts: LoginAttempt[]
  sessions: AdminSession[]
  activity: ActivityEntry[]
  notifications: AppNotification[]
  permissions: PermissionRow[]
  services: Service[]
  infraSamples: InfraSample[]
  recentIncidents: { id: string; timestamp: string; service: string; status: ServiceStatus; detail: string }[]
}
