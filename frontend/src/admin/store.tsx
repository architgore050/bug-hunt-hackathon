import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { seedWorkspace } from './data'
import type {
  AdminAccount,
  AdminRole,
  AdminWorkspace,
  AppNotification,
  Evaluation,
  EventStatus,
  Incident,
  IncidentStatus,
  NotificationKind,
  NotificationSeverity,
  Participant,
  ParticipationStatus,
  PermissionRow,
  Question,
  RegistrationStatus,
  Repository,
  Round,
  ScoreAdjustment,
  ServiceStatus,
  Team,
  TeamStatus,
} from './types'

const STORAGE_KEY = 'bhctf.admin.workspace.v1'

function uid(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `${prefix}-${rnd}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export type ScoreCategory = ScoreAdjustment['category']

import { teamTotal } from './scoring'

export { penaltiesFor, manualPositiveFor, teamTotal } from './scoring'

export interface AdjustmentInput {
  teamId: string
  amount: number
  reason: string
  category: ScoreCategory
  adminIdentity: string
  incidentId?: string | null
}

export interface CsvImportRow {
  id: string
  name: string
  email: string
  team: string
  registrationStatus: string
  participationStatus: string
  registeredAt: string
}

export interface CsvImportResult {
  created: number
  duplicates: number
  failed: number
}

interface AdminCtx {
  state: AdminWorkspace
  updateEvent: (patch: Partial<AdminWorkspace['event']>) => void
  setEventStatus: (status: EventStatus) => void
  setCurrentRound: (roundId: string | null) => void
  addParticipant: (p: Omit<Participant, 'id'> & { id?: string }) => Participant
  updateParticipant: (id: string, patch: Partial<Participant>) => void
  setParticipantStatus: (id: string, status: ParticipationStatus) => void
  setRegistrationStatus: (id: string, status: RegistrationStatus) => void
  assignTeam: (participantId: string, teamId: string | null) => void
  removeParticipant: (id: string) => void
  importParticipants: (rows: CsvImportRow[]) => CsvImportResult
  addTeam: (name: string, capacity: number) => Team
  updateTeam: (id: string, patch: Partial<Team>) => void
  setTeamStatus: (id: string, status: TeamStatus) => void
  removeTeam: (id: string) => void
  addRound: (input: Partial<Round> & { name: string }) => Round
  updateRound: (id: string, patch: Partial<Round>) => void
  removeRound: (id: string) => void
  addEvaluation: (input: Partial<Evaluation> & { title: string }) => Evaluation
  updateEvaluation: (id: string, patch: Partial<Evaluation>) => void
  removeEvaluation: (id: string) => void
  setEvaluationStatus: (id: string, status: Evaluation['status']) => void
  attachQuestion: (evaluationId: string, questionId: string) => void
  detachQuestion: (evaluationId: string, questionId: string) => void
  reorderQuestion: (evaluationId: string, questionId: string, dir: -1 | 1) => void
  addQuestion: (input: Partial<Question> & { title: string }) => Question
  updateQuestion: (id: string, patch: Partial<Question>) => void
  removeQuestion: (id: string) => void
  addRepository: (input: Partial<Repository> & { name: string }) => Repository
  updateRepository: (id: string, patch: Partial<Repository>) => void
  removeRepository: (id: string) => void
  applyAdjustment: (input: AdjustmentInput) => void
  addIncidentNote: (incidentId: string, body: string, admin: string) => void
  setIncidentStatus: (incidentId: string, status: IncidentStatus, admin: string) => void
  issueWarning: (incidentId: string, admin: string, body: string) => void
  applyMalpracticePenalty: (incidentId: string, amount: number, reason: string, admin: string) => void
  addAdmin: (input: Partial<AdminAccount> & { name: string; email: string }) => AdminAccount
  updateAdmin: (id: string, patch: Partial<AdminAccount>) => void
  revokeAdmin: (id: string, admin: string) => void
  resetAdminPassword: (id: string, admin: string) => string | null
  completePasswordReset: (id: string, token: string, admin: string) => boolean
  revokeSession: (sessionId: string, admin: string) => void
  setPermission: (permission: string, role: AdminRole, value: boolean) => void
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  setServiceStatus: (id: string, status: ServiceStatus) => void
  logActivity: (entry: { admin: string; action: string; targetType: string; targetId: string; targetLabel: string; previousValue?: string | null; newValue?: string | null }) => void
  pushNotification: (n: { kind: NotificationKind; severity: NotificationSeverity; title: string; body: string; link?: string | null }) => void
  resetWorkspace: () => void
}

const Ctx = createContext<AdminCtx | null>(null)

function loadState(): AdminWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AdminWorkspace
      if (parsed && Array.isArray(parsed.participants)) return parsed
    }
  } catch {
  }
  return seedWorkspace()
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminWorkspace>(() => loadState())
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
    }
  }, [state])

  const mutate = useCallback((fn: (s: AdminWorkspace) => AdminWorkspace) => {
    setState((s) => fn(s))
  }, [])

  const logActivity: AdminCtx['logActivity'] = useCallback((entry) => {
    mutate((s) => ({
      ...s,
      activity: [
        {
          id: uid('a'),
          timestamp: nowIso(),
          admin: entry.admin,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          targetLabel: entry.targetLabel,
          previousValue: entry.previousValue ?? null,
          newValue: entry.newValue ?? null,
        },
        ...s.activity,
      ],
    }))
  }, [mutate])

  const pushNotification: AdminCtx['pushNotification'] = useCallback((n) => {
    const note: AppNotification = { id: uid('n'), timestamp: nowIso(), read: false, link: n.link ?? null, ...n }
    mutate((s) => ({ ...s, notifications: [note, ...s.notifications] }))
  }, [mutate])

  const value = useMemo<AdminCtx>(() => ({
    state,
    updateEvent: (patch) => mutate((s) => ({ ...s, event: { ...s.event, ...patch } })),
    setEventStatus: (status) => {
      const prev = stateRef.current.event.eventStatus
      mutate((s) => ({ ...s, event: { ...s.event, eventStatus: status } }))
      logActivity({ admin: 'admin', action: 'event.status', targetType: 'event', targetId: 'event', targetLabel: s_eventName(stateRef.current), previousValue: prev, newValue: status })
      pushNotification({ kind: 'round_change', severity: 'info', title: 'Event status change', body: `Event moved to ${status}.`, link: '/admin/event-config' })
    },
    setCurrentRound: (roundId) => mutate((s) => ({ ...s, event: { ...s.event, currentRoundId: roundId } })),
    addParticipant: (p) => {
      const participant: Participant = { ...p, id: p.id ?? uid('P') }
      mutate((s) => ({ ...s, participants: [participant, ...s.participants] }))
      logActivity({ admin: 'admin', action: 'participant.created', targetType: 'participant', targetId: participant.id, targetLabel: participant.name })
      pushNotification({ kind: 'registration', severity: 'info', title: 'Participant registered', body: `${participant.name} added.`, link: '/admin/participants' })
      return participant
    },
    updateParticipant: (id, patch) => mutate((s) => ({ ...s, participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    setParticipantStatus: (id, status) => mutate((s) => ({ ...s, participants: s.participants.map((p) => (p.id === id ? { ...p, participationStatus: status } : p)) })),
    setRegistrationStatus: (id, status) => mutate((s) => ({ ...s, participants: s.participants.map((p) => (p.id === id ? { ...p, registrationStatus: status } : p)) })),
    assignTeam: (participantId, teamId) => mutate((s) => ({ ...s, participants: s.participants.map((p) => (p.id === participantId ? { ...p, teamId } : p)) })),
    removeParticipant: (id) => mutate((s) => ({ ...s, participants: s.participants.map((p) => (p.id === id ? { ...p, participationStatus: 'removed', teamId: null } : p)) })),
    importParticipants: (rows) => {
      const s = stateRef.current
      let created = 0
      let duplicates = 0
      let failed = 0
      const existingIds = new Set(s.participants.map((p) => p.id.toLowerCase()))
      const existingEmails = new Set(s.participants.map((p) => p.email.toLowerCase()))
      const seenIds = new Set<string>()
      const seenEmails = new Set<string>()
      const next = [...s.participants]
      const teamByName = new Map(s.teams.map((t) => [t.name.toLowerCase(), t.id]))
      for (const r of rows) {
        if (!r.name || !r.email) {
          failed++
          continue
        }
        const id = (r.id || uid('P')).trim()
        const idKey = id.toLowerCase()
        const emailKey = r.email.toLowerCase()
        if (existingIds.has(idKey) || existingEmails.has(emailKey) || seenIds.has(idKey) || seenEmails.has(emailKey)) {
          duplicates++
          continue
        }
        seenIds.add(idKey)
        seenEmails.add(emailKey)
        const teamId = r.team ? (teamByName.get(r.team.toLowerCase()) ?? null) : null
        next.unshift({
          id,
          name: r.name,
          email: r.email,
          teamId,
          registrationStatus: (r.registrationStatus as RegistrationStatus) || 'registered',
          participationStatus: (r.participationStatus as ParticipationStatus) || 'active',
          registeredAt: r.registeredAt || nowIso(),
          lastActiveAt: null,
        })
        created++
      }
      mutate(() => ({ ...s, participants: next }))
      pushNotification({ kind: 'csv_import', severity: duplicates || failed ? 'warning' : 'info', title: 'CSV import completed', body: `${created} created, ${duplicates} duplicates, ${failed} failed.`, link: '/admin/participants' })
      return { created, duplicates, failed }
    },
    addTeam: (name, capacity) => {
      const team: Team = { id: uid('team'), name, status: 'active', capacity, createdAt: nowIso(), joinCode: uid('FB').slice(0, 8).toUpperCase(), functionalScore: 0, evaluationScore: 0, ctfBonus: 0, penalties: 0 }
      mutate((s) => ({ ...s, teams: [team, ...s.teams] }))
      logActivity({ admin: 'admin', action: 'team.created', targetType: 'team', targetId: team.id, targetLabel: name })
      return team
    },
    updateTeam: (id, patch) => mutate((s) => ({ ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    setTeamStatus: (id, status) => mutate((s) => ({ ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, status } : t)) })),
    removeTeam: (id) => mutate((s) => ({ ...s, teams: s.teams.filter((t) => t.id !== id), participants: s.participants.map((p) => (p.teamId === id ? { ...p, teamId: null } : p)) })),
    addRound: (input) => {
      const round: Round = { id: uid('round'), name: input.name, description: input.description ?? '', active: input.active ?? true, durationMinutes: input.durationMinutes ?? 60, instructions: input.instructions ?? '', order: input.order ?? stateRef.current.rounds.length + 1, status: input.status ?? 'draft' }
      mutate((s) => ({ ...s, rounds: [...s.rounds, round] }))
      logActivity({ admin: 'admin', action: 'round.created', targetType: 'round', targetId: round.id, targetLabel: round.name })
      return round
    },
    updateRound: (id, patch) => mutate((s) => ({ ...s, rounds: s.rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    removeRound: (id) => mutate((s) => ({ ...s, rounds: s.rounds.filter((r) => r.id !== id), evaluations: s.evaluations.map((e) => (e.roundId === id ? { ...e, roundId: null } : e)), questions: s.questions.map((q) => (q.roundId === id ? { ...q, roundId: null } : q)), repositories: s.repositories.map((r) => (r.roundId === id ? { ...r, roundId: null } : r)) })),
    addEvaluation: (input) => {
      const evaluation: Evaluation = { id: uid('eval'), roundId: input.roundId ?? null, title: input.title, description: input.description ?? '', instructions: input.instructions ?? '', repositoryId: input.repositoryId ?? null, maxScore: input.maxScore ?? 0, bonusPoints: input.bonusPoints ?? 0, criteria: input.criteria ?? [], questionIds: input.questionIds ?? [], status: input.status ?? 'draft', createdAt: nowIso(), updatedAt: nowIso() }
      mutate((s) => ({ ...s, evaluations: [evaluation, ...s.evaluations] }))
      logActivity({ admin: 'admin', action: 'evaluation.created', targetType: 'evaluation', targetId: evaluation.id, targetLabel: evaluation.title })
      pushNotification({ kind: 'submission', severity: 'info', title: 'Evaluation created', body: evaluation.title, link: '/admin/evaluations' })
      return evaluation
    },
    updateEvaluation: (id, patch) => mutate((s) => ({ ...s, evaluations: s.evaluations.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: nowIso() } : e)) })),
    removeEvaluation: (id) => mutate((s) => ({ ...s, evaluations: s.evaluations.filter((e) => e.id !== id), questions: s.questions.map((q) => (q.evaluationId === id ? { ...q, evaluationId: null } : q)) })),
    setEvaluationStatus: (id, status) => mutate((s) => ({ ...s, evaluations: s.evaluations.map((e) => (e.id === id ? { ...e, status, updatedAt: nowIso() } : e)) })),
    attachQuestion: (evaluationId, questionId) => mutate((s) => ({
      ...s,
      evaluations: s.evaluations.map((e) => (e.id === evaluationId && !e.questionIds.includes(questionId) ? { ...e, questionIds: [...e.questionIds, questionId], updatedAt: nowIso() } : e)),
      questions: s.questions.map((q) => (q.id === questionId ? { ...q, evaluationId } : q)),
    })),
    detachQuestion: (evaluationId, questionId) => mutate((s) => ({
      ...s,
      evaluations: s.evaluations.map((e) => (e.id === evaluationId ? { ...e, questionIds: e.questionIds.filter((q) => q !== questionId), updatedAt: nowIso() } : e)),
      questions: s.questions.map((q) => (q.id === questionId && q.evaluationId === evaluationId ? { ...q, evaluationId: null } : q)),
    })),
    reorderQuestion: (evaluationId, questionId, dir) => mutate((s) => ({
      ...s,
      evaluations: s.evaluations.map((e) => {
        if (e.id !== evaluationId) return e
        const ids = [...e.questionIds]
        const i = ids.indexOf(questionId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= ids.length) return e
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        return { ...e, questionIds: ids, updatedAt: nowIso() }
      }),
    })),
    addQuestion: (input) => {
      const question: Question = { id: uid('q'), title: input.title, description: input.description ?? '', instructions: input.instructions ?? '', expectedTask: input.expectedTask ?? '', scoringCriteria: input.scoringCriteria ?? '', maxPoints: input.maxPoints ?? 1, difficulty: input.difficulty ?? 'medium', status: input.status ?? 'draft', roundId: input.roundId ?? null, evaluationId: input.evaluationId ?? null, order: input.order ?? stateRef.current.questions.length + 1 }
      mutate((s) => ({ ...s, questions: [...s.questions, question] }))
      return question
    },
    updateQuestion: (id, patch) => mutate((s) => ({ ...s, questions: s.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) })),
    removeQuestion: (id) => mutate((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== id), evaluations: s.evaluations.map((e) => ({ ...e, questionIds: e.questionIds.filter((q) => q !== id) })) })),
    addRepository: (input) => {
      const repo: Repository = { id: uid('repo'), name: input.name, identifier: input.identifier ?? '', url: input.url ?? '', roundId: input.roundId ?? null, evaluationId: input.evaluationId ?? null, status: input.status ?? 'draft', lastUpdated: nowIso(), configuration: input.configuration ?? '' }
      mutate((s) => ({ ...s, repositories: [repo, ...s.repositories] }))
      return repo
    },
    updateRepository: (id, patch) => mutate((s) => ({ ...s, repositories: s.repositories.map((r) => (r.id === id ? { ...r, ...patch, lastUpdated: nowIso() } : r)) })),
    removeRepository: (id) => mutate((s) => ({ ...s, repositories: s.repositories.filter((r) => r.id !== id), evaluations: s.evaluations.map((e) => (e.repositoryId === id ? { ...e, repositoryId: null } : e)) })),
    applyAdjustment: (input) => {
      mutate((s) => {
        const team = s.teams.find((t) => t.id === input.teamId)
        if (!team) return s
        const before = teamTotal(team, s.adjustments)
        const adjustment: ScoreAdjustment = { id: uid('adj'), teamId: team.id, teamName: team.name, amount: input.amount, reason: input.reason, category: input.category, adminIdentity: input.adminIdentity, timestamp: nowIso(), previousScore: before, updatedScore: before + input.amount, incidentId: input.incidentId ?? null }
        return { ...s, adjustments: [adjustment, ...s.adjustments] }
      })
      logActivity({ admin: input.adminIdentity, action: 'scoring.manual_adjustment', targetType: 'team', targetId: input.teamId, targetLabel: input.teamId, previousValue: null, newValue: `${input.amount >= 0 ? '+' : ''}${input.amount}` })
      pushNotification({ kind: 'score_change', severity: 'warning', title: 'Score adjusted', body: `${input.amount >= 0 ? '+' : ''}${input.amount} for ${input.teamId}: ${input.reason}`, link: '/admin/scoreboard' })
    },
    addIncidentNote: (incidentId, body, admin) => mutate((s) => ({ ...s, incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, notes: [...i.notes, { id: uid('in'), timestamp: nowIso(), admin, body }] } : i)) })),
    setIncidentStatus: (incidentId, status, admin) => {
      const inc = stateRef.current.incidents.find((i) => i.id === incidentId)
      mutate((s) => ({ ...s, incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, status, events: [...i.events, { id: uid('ie'), timestamp: nowIso(), kind: 'status_change', detail: `Status set to ${status} by ${admin}.` }] } : i)) }))
      logActivity({ admin, action: 'incident.status', targetType: 'incident', targetId: incidentId, targetLabel: inc?.teamName ?? incidentId, previousValue: inc?.status ?? null, newValue: status })
    },
    issueWarning: (incidentId, admin, body) => {
      mutate((s) => ({ ...s, incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, warningIssued: true, notes: [...i.notes, { id: uid('in'), timestamp: nowIso(), admin, body }], events: [...i.events, { id: uid('ie'), timestamp: nowIso(), kind: 'warning_issued', detail: `Warning issued by ${admin}.` }] } : i)) }))
      logActivity({ admin, action: 'incident.warning', targetType: 'incident', targetId: incidentId, targetLabel: incidentId })
      pushNotification({ kind: 'malpractice', severity: 'warning', title: 'Admin warning issued', body, link: '/admin/malpractice' })
    },
    applyMalpracticePenalty: (incidentId, amount, reason, admin) => {
      const inc = stateRef.current.incidents.find((i) => i.id === incidentId)
      if (!inc) return
      mutate((s) => {
        const team = s.teams.find((t) => t.id === inc.teamId)
        if (!team) return s
        const before = teamTotal(team, s.adjustments)
        const adjustment: ScoreAdjustment = { id: uid('adj'), teamId: team.id, teamName: team.name, amount: -Math.abs(amount), reason, category: 'malpractice', adminIdentity: admin, timestamp: nowIso(), previousScore: before, updatedScore: before - Math.abs(amount), incidentId }
        return {
          ...s,
          adjustments: [adjustment, ...s.adjustments],
          incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, penaltyApplied: true, status: 'action_taken', events: [...i.events, { id: uid('ie'), timestamp: nowIso(), kind: 'penalty_applied', detail: `Penalty ${amount} applied by ${admin}.` }] } : i)),
        }
      })
      logActivity({ admin, action: 'malpractice.penalty', targetType: 'team', targetId: inc.teamId, targetLabel: inc.teamName, previousValue: null, newValue: `-${Math.abs(amount)}` })
      pushNotification({ kind: 'malpractice', severity: 'critical', title: 'Penalty applied', body: `${inc.teamName}: -${Math.abs(amount)}. ${reason}`, link: '/admin/scoreboard' })
    },
    addAdmin: (input) => {
      const admin: AdminAccount = { id: uid('adm'), name: input.name, email: input.email, role: input.role ?? 'organizer', status: input.status ?? 'pending', createdAt: nowIso(), lastLoginAt: null, resetRequired: input.resetRequired ?? true, resetToken: null, resetTokenIssuedAt: null }
      mutate((s) => ({ ...s, admins: [admin, ...s.admins] }))
      return admin
    },
    updateAdmin: (id, patch) => mutate((s) => ({ ...s, admins: s.admins.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    revokeAdmin: (id, admin) => {
      mutate((s) => ({ ...s, admins: s.admins.map((a) => (a.id === id ? { ...a, status: 'revoked' } : a)), sessions: s.sessions.map((sess) => (sess.adminId === id ? { ...sess, revoked: true } : sess)) }))
      logActivity({ admin, action: 'admin.revoke', targetType: 'admin', targetId: id, targetLabel: id })
    },
    resetAdminPassword: (id, admin) => {
      const token = uid('reset').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)
      mutate((s) => ({ ...s, admins: s.admins.map((a) => (a.id === id ? { ...a, resetToken: token, resetTokenIssuedAt: nowIso(), resetRequired: true } : a)) }))
      logActivity({ admin, action: 'admin.password_reset_issued', targetType: 'admin', targetId: id, targetLabel: id })
      return token
    },
    completePasswordReset: (id, token, admin) => {
      const acct = stateRef.current.admins.find((a) => a.id === id)
      if (!acct || !acct.resetToken || acct.resetToken !== token) return false
      mutate((s) => ({ ...s, admins: s.admins.map((a) => (a.id === id ? { ...a, resetToken: null, resetTokenIssuedAt: null, resetRequired: false, status: a.status === 'pending' ? 'active' : a.status } : a)) }))
      logActivity({ admin, action: 'admin.password_reset_completed', targetType: 'admin', targetId: id, targetLabel: id })
      return true
    },
    revokeSession: (sessionId, admin) => {
      mutate((s) => ({ ...s, sessions: s.sessions.map((sess) => (sess.id === sessionId ? { ...sess, revoked: true } : sess)) }))
      logActivity({ admin, action: 'admin.session_revoked', targetType: 'session', targetId: sessionId, targetLabel: sessionId })
    },
    setPermission: (permission, role, value) => mutate((s) => ({ ...s, permissions: s.permissions.map((p: PermissionRow) => (p.permission === permission ? { ...p, roles: { ...p.roles, [role]: value } } : p)) })),
    markNotificationRead: (id) => mutate((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
    markAllNotificationsRead: () => mutate((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
    setServiceStatus: (id, status) => mutate((s) => ({ ...s, services: s.services.map((svc) => (svc.id === id ? { ...svc, status } : svc)) })),
    logActivity,
    pushNotification,
    resetWorkspace: () => setState(seedWorkspace()),
  }), [state, mutate, logActivity, pushNotification])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function s_eventName(s: AdminWorkspace): string {
  return s.event.eventName
}

export function useAdmin(): AdminCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdmin must be used inside AdminProvider')
  return ctx
}

export type { Incident }