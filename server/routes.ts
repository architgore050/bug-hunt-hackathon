import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { ApiError, asyncHandler } from './errors.ts'
import { decideMultiLocation, decideReport } from './matching.ts'
import {
  ACCESS_TOKEN_TTL_S,
  MAX_SESSIONS_PER_USER,
  PASSWORD_MIN_LENGTH,
  REFRESH_REUSE_GRACE_S,
  REFRESH_TOKEN_TTL_S,
  canonicalPayloadHash,
  createAccessToken,
  hashPassword,
  ipHash,
  newRefreshToken,
  newUuid,
  normalizeRepoPath,
  receiptCode,
  sha256Hex,
  tokenHash,
  verifyAccessToken,
  verifyPassword,
} from './security.ts'
import { langForPath, store } from './store.ts'
import type { Role, SubmissionRecord, UserRecord } from './store.ts'

const REFRESH_COOKIE = 'bhctf_refresh'
const CATEGORIES = new Set([
  'logic',
  'input_validation',
  'authentication_authorization',
  'injection',
  'cryptography',
  'resource_handling',
  'concurrency',
  'error_handling',
  'configuration',
  'integration_api_contract',
  'data_handling',
  'other',
])
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const MAX_LOCATIONS = 5
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES + 1024 },
})

interface Principal {
  id: string
  email: string
  name: string
  role: Role
  status: string
  sessionId: string
}

type AuthedRequest = Request & { requestId?: string; principal?: Principal }

function setRefreshCookie(res: Response, rawToken: string) {
  res.cookie(REFRESH_COOKIE, rawToken, {
    maxAge: REFRESH_TOKEN_TTL_S * 1000,
    httpOnly: true,
    secure: process.env.ENVIRONMENT === 'production',
    sameSite: 'strict',
    path: '/v1/auth/refresh',
  })
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth/refresh' })
}

function requirePrincipal(req: Request): Principal {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new ApiError('AUTH_TOKEN_EXPIRED', {}, 'Authentication required.')
  }
  const token = auth.slice(7).trim()
  const verified = verifyAccessToken(token)
  if (verified.status === 'expired') {
    throw new ApiError('AUTH_TOKEN_EXPIRED')
  }
  if (verified.status === 'invalid') {
    throw new ApiError('AUTH_SESSION_REVOKED')
  }
  const { sub, sid, tv } = verified.payload
  const user = store.users.get(sub)
  const session = store.sessions.get(sid)
  if (!user || !session || session.revoked_at || user.token_version !== tv || user.status !== 'active') {
    throw new ApiError('AUTH_SESSION_REVOKED')
  }
  session.last_seen_at = new Date().toISOString()
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    sessionId: session.id,
  }
}

function requireRoles(req: Request, ...roles: Role[]): Principal {
  const p = requirePrincipal(req)
  if (!roles.includes(p.role)) {
    throw new ApiError('AUTH_FORBIDDEN')
  }
  return p
}

function requireStepUp(req: Request, p: Principal): Principal {
  const session = store.sessions.get(p.sessionId)
  if (!session || !session.step_up_at) {
    throw new ApiError('ADMIN_STEP_UP_REQUIRED')
  }
  const elapsedMs = Date.now() - new Date(session.step_up_at).getTime()
  if (elapsedMs > 5 * 60_000) {
    throw new ApiError('ADMIN_STEP_UP_REQUIRED')
  }
  return p
}

function latestPublishedEvent() {
  const list = Array.from(store.events.values())
    .filter((e) => e.status !== 'draft')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return list[0] ?? null
}

function latestLiveEvent() {
  const list = Array.from(store.events.values())
    .filter((e) => ['ready', 'live', 'closed', 'finalized'].includes(e.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return list[0] ?? null
}

function requireRulesAccepted(p: Principal) {
  if (p.role !== 'participant') return
  const ev = latestLiveEvent()
  if (!ev) return
  const key = `${p.id}:${ev.rules_version}`
  if (!store.acceptances.has(key)) {
    throw new ApiError('RULES_NOT_ACCEPTED')
  }
}

function requireMember(p: Principal) {
  const team = store.getTeamForUser(p.id)
  if (!team) {
    throw new ApiError('AUTH_FORBIDDEN', {}, 'You are not assigned to a team for this event.')
  }
  const event = store.events.get(team.event_id)
  if (!event) {
    throw new ApiError('NOT_FOUND', {}, 'Event not found.')
  }
  return { team, event }
}

function requireLiveEventStatus(eventStatus: string) {
  if (!['ready', 'live', 'closed', 'finalized'].includes(eventStatus)) {
    throw new ApiError('LEVEL_NOT_OPEN', {}, 'The event is not running yet.')
  }
}

function buildUnifiedDiff(
  baseFiles: Array<{ path: string; content: string }>,
  editedFiles: Record<string, string>,
): string {
  const baseMap = new Map(baseFiles.map((f) => [f.path, f.content]))
  const allPaths = Array.from(new Set([...baseMap.keys(), ...Object.keys(editedFiles)])).sort()
  const chunks: string[] = []
  for (const filePath of allPaths) {
    const before = baseMap.get(filePath) ?? ''
    const after = typeof editedFiles[filePath] === 'string' ? editedFiles[filePath] : before
    if (before === after) continue
    const bLines = before.split('\n')
    const aLines = after.split('\n')
    chunks.push(`--- a/${filePath}`)
    chunks.push(`+++ b/${filePath}`)
    chunks.push(`@@ -1,${bLines.length} +1,${aLines.length} @@`)
    for (const line of bLines) chunks.push(`-${line}`)
    for (const line of aLines) chunks.push(`+${line}`)
  }
  return chunks.join('\n') + (chunks.length ? '\n' : '')
}

function evaluateLevelSubmission(sub: SubmissionRecord) {
  const choice = store.teamRepoChoices.get(sub.team_id)
  const challengeId = choice?.challenge_version_id ?? sub.challenge_version_id
  const bugs = store.getGtBugsForChallenge(challengeId)
  const stage = store.stages.get(sub.stage_id)
  const ruleSet = stage?.config ?? {}
  const flags = Array.isArray(sub.payload.flags) ? (sub.payload.flags as Array<Record<string, unknown>>) : []

  if (!flags.length) return

  let bestBugCode: string | null = null
  let totalPoints = 0
  let anyNeedsReview = false

  for (const f of flags) {
    const locations = Array.isArray(f.locations)
      ? (f.locations as Array<{ file_path: string; line_start: number; line_end: number }>)
      : []
    const awarded = new Set<string>()
    for (const claim of store.awardClaims) {
      if (claim.startsWith(`${sub.stage_id}:${sub.team_id}:`)) {
        awarded.add(claim.slice(`${sub.stage_id}:${sub.team_id}:`.length))
      }
    }
    const decision =
      locations.length > 1
        ? decideMultiLocation(
            locations,
            `${String(f.description ?? '')} ${String(f.evidence ?? '')}`,
            String(f.category ?? ''),
            bugs,
            ruleSet,
            awarded,
          )
        : decideReport(
            {
              file_path: locations[0]?.file_path ?? String(f.file_path ?? ''),
              line_start: locations[0]?.line_start ?? Number(f.line_start ?? 0),
              line_end: locations[0]?.line_end ?? Number(f.line_end ?? 0),
              description: String(f.description ?? ''),
              evidence: f.evidence ? String(f.evidence) : '',
              category: String(f.category ?? ''),
            },
            bugs,
            ruleSet,
            awarded,
          )

    if ((decision.outcome === 'accept_full' || decision.outcome === 'accept_partial') && decision.bug) {
      const claimKey = `${sub.stage_id}:${sub.team_id}:${decision.bug.code}`
      if (!store.awardClaims.has(claimKey)) {
        store.awardClaims.add(claimKey)
        const pts = decision.outcome === 'accept_full' ? decision.bug.points : decision.bug.points * 0.5
        totalPoints += pts
        bestBugCode = bestBugCode ?? decision.bug.code
        store.scoreLedger.push({
          id: newUuid(),
          tenant_id: sub.tenant_id,
          event_id: sub.event_id,
          stage_id: sub.stage_id,
          team_id: sub.team_id,
          component: 'code_review',
          kind: 'award',
          points: pts,
          reason_code: `AUTO_${decision.outcome.toUpperCase()}`,
          submission_id: sub.id,
          actor_id: null,
          note: `${decision.bug.code} matched`,
          created_at: new Date().toISOString(),
        })
      }
    } else if (decision.outcome === 'needs_review') {
      anyNeedsReview = true
    }
  }

  if (anyNeedsReview) {
    sub.status = 'needs_review'
    store.reviewItems.set(newUuid(), {
      id: newUuid(),
      submission_id: sub.id,
      status: 'open',
      priority: 10,
      claimed_by: null,
      claimed_at: null,
      created_at: new Date().toISOString(),
    })
  } else if (bestBugCode) {
    sub.status = 'matched_auto'
    sub.matched_bug_code = bestBugCode
    sub.points_visible = totalPoints
  }
}

export function createApiRouter(): Router {
  const r = Router()

  // ---------------- Public ----------------

  r.get('/time', (_req, res) => {
    const now = new Date()
    res.json({ server_time_ms: now.getTime(), server_time: now.toISOString() })
  })

  r.get('/public/event', (_req, res) => {
    const ev = latestPublishedEvent()
    if (!ev) {
      res.json({ event: null })
      return
    }
    const summary = (ev.config.public_summary as Record<string, unknown> | undefined) ?? {}
    res.json({
      event: {
        slug: ev.slug,
        name: ev.name,
        status: ev.status,
        starts_at: ev.starts_at,
        ends_at: ev.ends_at,
        timezone: ev.timezone,
        duration_minutes: ev.duration_minutes,
        max_participants: ev.max_participants,
        max_teams: ev.max_teams,
        rules_version: ev.rules_version,
        format: summary,
      },
    })
  })

  r.get('/public/rules', (_req, res) => {
    const doc = store.rulesDocs[store.rulesDocs.length - 1]
    if (!doc) {
      res.json({ rules: null })
      return
    }
    const ev = store.events.get(doc.event_id)
    res.json({
      rules: {
        version: doc.version,
        body_markdown: doc.body_md,
        frozen_at: doc.frozen_at,
        event_name: ev?.name ?? 'Fall Back',
      },
    })
  })

  // ---------------- Auth ----------------

  r.post(
    '/auth/login',
    asyncHandler((req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const password = String(req.body?.password ?? '')
      if (!email || !password) {
        throw new ApiError('AUTH_INVALID_CREDENTIALS')
      }
      let user = store.usersByEmail.get(email)
      if (!user) {
        throw new ApiError('AUTH_INVALID_CREDENTIALS')
      }
      if (!user.password_hash) {
        user.password_hash = hashPassword(password)
        user.status = 'active'
      } else if (!verifyPassword(password, user.password_hash)) {
        throw new ApiError('AUTH_INVALID_CREDENTIALS')
      }
      if (user.status === 'disqualified') {
        throw new ApiError('AUTH_FORBIDDEN', {}, 'This account was disqualified. Contact the organizers.')
      }

      // Enforce session cap cleanly by evicting oldest session
      const liveSessions = Array.from(store.sessions.values())
        .filter((s) => s.user_id === user.id && !s.revoked_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      while (liveSessions.length >= MAX_SESSIONS_PER_USER) {
        const victim = liveSessions.shift()!
        victim.revoked_at = new Date().toISOString()
        for (const rt of store.refreshTokensByHash.values()) {
          if (rt.session_id === victim.id) rt.status = 'revoked'
        }
      }

      const now = new Date()
      const sessionId = newUuid()
      store.sessions.set(sessionId, {
        id: sessionId,
        user_id: user.id,
        ip_hash: ipHash(req.ip ?? ''),
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        created_at: now.toISOString(),
        last_seen_at: now.toISOString(),
        step_up_at: null,
        revoked_at: null,
      })

      const { token, expiresAt } = createAccessToken({
        userId: user.id,
        sessionId,
        role: user.role,
        tokenVersion: user.token_version,
      })
      const rawRefresh = newRefreshToken()
      const rtHash = tokenHash(rawRefresh)
      store.refreshTokensByHash.set(rtHash, {
        id: newUuid(),
        session_id: sessionId,
        user_id: user.id,
        token_hash: rtHash,
        status: 'active',
        rotated_at: null,
        successor_raw: null,
        expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
      })

      store.writeAudit({
        actor_id: user.id,
        actor_role: user.role,
        action: 'auth.login',
        entity_type: 'user',
        entity_id: user.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
      })

      setRefreshCookie(res, rawRefresh)
      res.json({
        access_token: token,
        expires_at: expiresAt.toISOString(),
        server_time: now.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        },
      })
    }),
  )

  r.post(
    '/auth/register',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'admin')
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const name = String(req.body?.name ?? '').trim()
      const password = String(req.body?.password ?? '')
      const role = String(req.body?.role ?? 'participant') as Role
      if (!email || name.length < 2 || password.length < PASSWORD_MIN_LENGTH) {
        throw new ApiError('VALIDATION_ERROR', { password: `Minimum ${PASSWORD_MIN_LENGTH} characters.` })
      }
      if (!['participant', 'reviewer', 'organizer', 'admin'].includes(role)) {
        throw new ApiError('VALIDATION_ERROR', { role: 'participant|reviewer|organizer|admin' })
      }
      if (store.usersByEmail.has(email)) {
        throw new ApiError('VALIDATION_ERROR', { email: 'Registration failed. Try again.' })
      }
      const user: UserRecord = {
        id: newUuid(),
        tenant_id: store.tenantId,
        email,
        name,
        role,
        password_hash: hashPassword(password),
        status: 'active',
        token_version: 1,
        created_at: new Date().toISOString(),
      }
      store.users.set(user.id, user)
      store.usersByEmail.set(email, user)
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'auth.registered',
        entity_type: 'user',
        entity_id: email,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { email, role },
      })
      res.status(201).json({ ok: true, email, message: 'Account created. The user can now sign in.' })
    }),
  )

  r.post(
    '/auth/refresh',
    asyncHandler((req, res) => {
      if (req.headers['x-bhctf-client'] !== '1') {
        throw new ApiError('AUTH_SESSION_REVOKED')
      }
      const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined
      if (!raw) throw new ApiError('AUTH_SESSION_REVOKED')
      const rt = store.refreshTokensByHash.get(tokenHash(raw))
      const now = new Date()
      if (!rt || rt.status === 'revoked' || new Date(rt.expires_at).getTime() < now.getTime()) {
        throw new ApiError('AUTH_SESSION_REVOKED')
      }
      const user = store.users.get(rt.user_id)
      const session = store.sessions.get(rt.session_id)
      if (!user || !session || session.revoked_at || user.status !== 'active') {
        throw new ApiError('AUTH_SESSION_REVOKED')
      }
      if (rt.status === 'rotated') {
        const elapsedSec = rt.rotated_at ? (now.getTime() - new Date(rt.rotated_at).getTime()) / 1000 : Infinity
        if (elapsedSec <= REFRESH_REUSE_GRACE_S && rt.successor_raw) {
          const { token, expiresAt } = createAccessToken({
            userId: user.id,
            sessionId: session.id,
            role: user.role,
            tokenVersion: user.token_version,
          })
          setRefreshCookie(res, rt.successor_raw)
          res.json({ access_token: token, expires_at: expiresAt.toISOString(), server_time: now.toISOString() })
          return
        }
        session.revoked_at = now.toISOString()
        for (const item of store.refreshTokensByHash.values()) {
          if (item.session_id === session.id) item.status = 'revoked'
        }
        throw new ApiError('AUTH_SESSION_REVOKED')
      }

      const newRaw = newRefreshToken()
      const newHash = tokenHash(newRaw)
      rt.status = 'rotated'
      rt.rotated_at = now.toISOString()
      rt.successor_raw = newRaw
      store.refreshTokensByHash.set(newHash, {
        id: newUuid(),
        session_id: session.id,
        user_id: user.id,
        token_hash: newHash,
        status: 'active',
        rotated_at: null,
        successor_raw: null,
        expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
      })
      session.last_seen_at = now.toISOString()

      const { token, expiresAt } = createAccessToken({
        userId: user.id,
        sessionId: session.id,
        role: user.role,
        tokenVersion: user.token_version,
      })
      setRefreshCookie(res, newRaw)
      res.json({ access_token: token, expires_at: expiresAt.toISOString(), server_time: now.toISOString() })
    }),
  )

  r.post(
    '/auth/logout',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const session = store.sessions.get(p.sessionId)
      if (session) session.revoked_at = new Date().toISOString()
      for (const rt of store.refreshTokensByHash.values()) {
        if (rt.session_id === p.sessionId) rt.status = 'revoked'
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'auth.logout',
        entity_type: 'user',
        entity_id: p.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
      })
      clearRefreshCookie(res)
      res.json({ ok: true })
    }),
  )

  r.post(
    '/auth/step-up',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const user = store.users.get(p.id)
      const password = String(req.body?.password ?? '')
      if (!user || !verifyPassword(password, user.password_hash)) {
        throw new ApiError('AUTH_INVALID_CREDENTIALS')
      }
      const session = store.sessions.get(p.sessionId)
      if (session) session.step_up_at = new Date().toISOString()
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'auth.step_up',
        entity_type: 'user',
        entity_id: p.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
      })
      res.json({ ok: true, valid_until: new Date(Date.now() + 5 * 60_000).toISOString() })
    }),
  )

  r.get(
    '/me',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const team = store.getTeamForUser(p.id)
      const teamEvent = team ? store.events.get(team.event_id) : null
      const liveEv = latestLiveEvent()
      const rulesAccepted = liveEv ? store.acceptances.has(`${p.id}:${liveEv.rules_version}`) : false
      res.json({
        id: p.id,
        email: p.email,
        name: p.name,
        role: p.role,
        status: p.status,
        team: team && teamEvent
          ? {
              id: team.id,
              name: team.name,
              join_code: team.join_code,
              event_id: teamEvent.id,
              slug: teamEvent.slug,
              event_status: teamEvent.status,
            }
          : null,
        rules_accepted: rulesAccepted,
        rules_version: liveEv?.rules_version ?? null,
      })
    }),
  )

  r.get(
    '/me/sessions',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const rows = Array.from(store.sessions.values())
        .filter((s) => s.user_id === p.id && !s.revoked_at)
        .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
        .map((s) => ({
          id: s.id,
          created_at: s.created_at,
          last_seen_at: s.last_seen_at,
          device: s.user_agent.slice(0, 80),
        }))
      res.json(rows)
    }),
  )

  r.delete(
    '/me/sessions/:sessionId',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const sid = String(req.params.sessionId)
      const s = store.sessions.get(sid)
      if (s && s.user_id === p.id) {
        s.revoked_at = new Date().toISOString()
        for (const rt of store.refreshTokensByHash.values()) {
          if (rt.session_id === sid) rt.status = 'revoked'
        }
      }
      res.json({ ok: true })
    }),
  )

  r.post(
    '/me/acceptances',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const ev = latestLiveEvent()
      if (!ev) throw new ApiError('NOT_FOUND', {}, 'No published event found.')
      const version = Number(req.body?.version ?? ev.rules_version)
      const key = `${p.id}:${version}`
      if (!store.acceptances.has(key)) {
        store.acceptances.set(key, {
          id: newUuid(),
          user_id: p.id,
          rules_version: version,
          created_at: new Date().toISOString(),
        })
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'rules.accepted',
        entity_type: 'event',
        entity_id: ev.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { version },
      })
      res.json({ ok: true, rules_version: version })
    }),
  )

  // ---------------- State & V1 Challenge/Submission endpoints ----------------

  r.get(
    '/state',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'participant', 'reviewer', 'organizer', 'admin')
      const ev = latestLiveEvent()
      const stage = ev ? store.getMainStage(ev.id) : null
      const now = new Date()
      if (!ev || !stage) {
        res.json({ server_time: now.toISOString(), round: null, announcements_version: store.announcements.length, leaderboard_visibility: 'hidden' })
        return
      }
      const effEnd = store.getEffectiveEnd(stage, p.id)
      const snaps = store.leaderboardSnapshots.filter((s) => s.stage_id === stage.id)
      const latestSnap = snaps[snaps.length - 1]
      res.json({
        server_time: now.toISOString(),
        round: {
          id: stage.id,
          name: stage.name,
          kind: stage.kind,
          status: stage.status,
          event_status: ev.status,
          starts_at: stage.starts_at,
          ends_at_effective: effEnd ? effEnd.toISOString() : null,
          grace_seconds: stage.grace_seconds,
          paused: stage.status === 'paused',
        },
        rules_version: ev.rules_version,
        announcements_version: store.announcements.length,
        leaderboard_version: latestSnap?.version ?? 0,
        leaderboard_visibility: latestSnap?.visibility ?? 'hidden',
      })
    }),
  )

  r.get(
    '/config',
    asyncHandler((req, res) => {
      requireRoles(req, 'participant', 'reviewer', 'organizer', 'admin')
      const ev = latestLiveEvent()
      const stage = ev ? store.getMainStage(ev.id) : null
      if (!ev || !stage) {
        throw new ApiError('NOT_FOUND', {}, 'No active stage configured yet.')
      }
      const features = (ev.config.features as Record<string, unknown> | undefined) ?? {}
      const scoring = (ev.config.scoring as Record<string, unknown> | undefined) ?? {}
      const safeKeys = [
        'feedback_mode',
        'leaderboard_mode',
        'max_span',
        'max_reports_per_file',
        'max_reports_per_round',
        'file_cooldown_s',
        'location_tolerance_lines',
        'ctf_bonus_cap_points',
        'penalty',
      ]
      const limits: Record<string, unknown> = {}
      for (const k of safeKeys) {
        if (stage.config[k] !== undefined) limits[k] = stage.config[k]
      }
      res.json({
        stage_id: stage.id,
        grace_seconds: stage.grace_seconds,
        runner_enabled: Boolean(features.runner_enabled ?? false),
        ai_assessment_enabled: Boolean(features.ai_assessment_enabled ?? false),
        scoring_weights: (scoring.weights as Record<string, number> | undefined) ?? {},
        ctf_bonus_cap_points: (scoring.ctf_bonus_cap_points as number | undefined) ?? 100,
        limits,
        schedule: (ev.config.schedule as unknown[]) ?? [],
      })
    }),
  )

  r.get(
    '/announcements',
    asyncHandler((req, res) => {
      requirePrincipal(req)
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100)
      const list = [...store.announcements].reverse().slice(0, limit)
      res.json({ announcements: list })
    }),
  )

  r.get(
    '/assignments',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const ev = latestLiveEvent()
      const stage = ev ? store.getMainStage(ev.id) : null
      if (!ev || !stage) throw new ApiError('NOT_FOUND', {}, 'No stage configured.')
      const team = store.getTeamForUser(p.id)
      const teamChoice = team ? store.teamRepoChoices.get(team.id) : null
      const teamAssign = store.assignments.find(
        (a) => a.stage_id === stage.id && (a.team_id === team?.id || a.team_id === null),
      )
      const challengeId = teamChoice?.challenge_version_id ?? teamAssign?.challenge_version_id
      const ch = challengeId ? store.challenges.get(challengeId) : null
      if (!ch || ch.status !== 'published') {
        res.json({ assignments: [], message: 'No challenge assigned yet.' })
        return
      }
      const files = store.challengeFiles.get(ch.id) ?? []
      res.json({
        assignments: [
          {
            challenge_id: ch.id,
            slug: ch.slug,
            title: ch.title,
            version: ch.version,
            instructions_markdown: ch.instructions_md,
            repo_url: teamAssign?.repo_url ?? null,
            codespace_url: teamAssign?.codespace_url ?? null,
            stage_id: stage.id,
            stage_status: stage.status,
            files: files.map((f) => ({ path: f.path, lang: f.lang, size_bytes: f.size_bytes, line_count: f.line_count })),
          },
        ],
      })
    }),
  )

  r.get(
    '/challenges/:challengeId/files/content',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const norm = normalizeRepoPath(String(req.query.path ?? ''))
      if (!norm) throw new ApiError('PATH_INVALID')
      const files = store.challengeFiles.get(String(req.params.challengeId)) ?? []
      const file = files.find((f) => f.path === norm)
      if (!file) throw new ApiError('FILE_NOT_FOUND')
      res.json({ path: file.path, lang: file.lang, content: file.content, line_count: file.line_count, sha256: file.sha256 })
    }),
  )

  r.get(
    '/challenges/:challengeId/search',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const q = String(req.query.q ?? '').trim().toLowerCase()
      if (q.length < 2) throw new ApiError('VALIDATION_ERROR', { q: 'Minimum 2 characters.' })
      const files = store.challengeFiles.get(String(req.params.challengeId)) ?? []
      const results: Array<{ path: string; line_number: number; text: string }> = []
      for (const f of files) {
        const lines = f.content.split('\n')
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(q)) {
            results.push({ path: f.path, line_number: i + 1, text: lines[i].slice(0, 200) })
            if (results.length >= 50) break
          }
        }
        if (results.length >= 50) break
      }
      res.json({ results })
    }),
  )

  r.get(
    '/submissions',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'participant')
      const rows = Array.from(store.submissions.values())
        .filter((s) => s.author_id === p.id)
        .sort((a, b) => b.received_at.localeCompare(a.received_at))
        .slice(0, 200)
        .map((s) => {
          const item: Record<string, unknown> = {
            id: s.id,
            kind: s.kind,
            title: s.title,
            file_path: s.file_path,
            line_start: s.line_start,
            line_end: s.line_end,
            category: s.category,
            receipt_code: s.receipt_code,
            received_at: s.received_at,
            flag_code: s.kind === 'ctf_flag' ? s.flag_code : null,
          }
          if (s.feedback_released) {
            item.status = s.status
            item.matched_bug_code = s.matched_bug_code
            item.points_visible = s.points_visible ?? 0
          } else {
            item.status = ['received', 'matched_auto', 'needs_review', 'in_review', 'decided', 'ledgered'].includes(s.status)
              ? 'received'
              : s.status
          }
          return item
        })
      res.json({ submissions: rows })
    }),
  )

  r.get(
    '/submissions/:submissionId',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'participant')
      const sub = store.submissions.get(String(req.params.submissionId))
      if (!sub || sub.author_id !== p.id) throw new ApiError('NOT_FOUND')
      res.json({
        id: sub.id,
        kind: sub.kind,
        title: sub.title,
        file_path: sub.file_path,
        line_start: sub.line_start,
        line_end: sub.line_end,
        category: sub.category,
        receipt_code: sub.receipt_code,
        received_at: sub.received_at,
        payload: sub.payload,
        released: sub.feedback_released,
        matched_bug_code: sub.feedback_released ? sub.matched_bug_code : null,
        points: sub.feedback_released ? (sub.points_visible ?? 0) : null,
      })
    }),
  )

  r.post(
    '/submissions/:submissionId/dispute',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'participant')
      const sub = store.submissions.get(String(req.params.submissionId))
      if (!sub || sub.author_id !== p.id) throw new ApiError('NOT_FOUND')
      if (!sub.feedback_released) {
        throw new ApiError('VALIDATION_ERROR', { dispute: 'Disputes open after results are released.' })
      }
      const statement = String(req.body?.statement ?? '').trim()
      if (statement.length < 10) {
        throw new ApiError('VALIDATION_ERROR', { statement: 'Minimum 10 characters.' })
      }
      const id = newUuid()
      store.disputes.set(id, {
        id,
        submission_id: sub.id,
        team_id: sub.team_id,
        statement,
        status: 'open',
        resolution: null,
        created_at: new Date().toISOString(),
      })
      sub.status = 'disputed'
      res.status(201).json({ ok: true })
    }),
  )

  r.get(
    '/leaderboard/:stageId',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const stageId = String(req.params.stageId)
      const stage = store.stages.get(stageId)
      if (!stage) throw new ApiError('NOT_FOUND')
      const mode = String(stage.config.leaderboard_mode ?? 'hidden')
      const released = stage.status === 'released' || stage.status === 'final'
      if (mode === 'hidden' && p.role === 'participant' && !released) {
        res.json({ visible: false, message: 'The leaderboard is hidden for this round.' })
        return
      }
      const snaps = store.leaderboardSnapshots.filter((s) => s.stage_id === stageId)
      const snap = snaps[snaps.length - 1]
      if (!snap) {
        res.json({ visible: true, snapshot: null, message: 'No results published yet.' })
        return
      }
      res.json({ visible: true, version: snap.version, snapshot: snap.payload, generated_at: snap.created_at })
    }),
  )

  r.get(
    '/results/:stageId',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'participant')
      const stageId = String(req.params.stageId)
      const stageSubs = Array.from(store.submissions.values()).filter((s) => s.stage_id === stageId)
      const released = stageSubs.some((s) => s.feedback_released)
      if (!released) {
        res.json({ released: false, message: 'Results are not released yet.' })
        return
      }
      const { team } = requireMember(p)
      const entries = store.scoreLedger
        .filter((e) => e.stage_id === stageId && e.team_id === team.id)
        .map((e) => {
          const sub = e.submission_id ? store.submissions.get(e.submission_id) : null
          return {
            component: e.component,
            kind: e.kind,
            points: e.points,
            reason_code: e.reason_code,
            title: sub?.title ?? null,
            receipt_code: sub?.receipt_code ?? null,
            matched_bug_code: sub?.matched_bug_code ?? null,
            received_at: sub?.received_at ?? null,
          }
        })
      const byComponent: Record<string, number> = {}
      let penalties = 0
      for (const e of entries) {
        if (e.kind === 'penalty') penalties += e.points
        byComponent[e.component] = (byComponent[e.component] ?? 0) + e.points
      }
      const total = Object.values(byComponent).reduce((a, b) => a + b, 0) + penalties
      res.json({ released: true, total: Math.round(total * 100) / 100, by_component: byComponent, penalties, entries })
    }),
  )

  // ---------------- Four-Level Participant Flow ----------------

  r.get(
    '/levels',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      store.initParticipantFlow(event.id, p.id)

      const now = new Date()
      const levelStages = Array.from(store.stages.values())
        .filter((s) => s.event_id === event.id && s.kind === 'level')
        .sort((a, b) => a.ordinal - b.ordinal)

      const levels = levelStages.map((st) => {
        const gate = store.computeGate(event.id, p.id, team.id, st.ordinal, now)
        const prog = store.participantProgress.get(`${p.id}:${st.ordinal}`)
        return {
          level_no: st.ordinal,
          name: st.name,
          stage_id: st.id,
          status: st.status,
          starts_at: st.starts_at,
          ends_at: st.ends_at,
          grace_seconds: st.grace_seconds,
          gate_allowed: gate.allowed,
          gate_reason: gate.reason,
          participant_status: prog?.status ?? 'locked',
        }
      })

      const ptr = store.participantPointers.get(p.id)
      res.json({
        levels,
        pointer: ptr ? { level_no: ptr.level_no, node: ptr.node } : null,
      })
    }),
  )

  r.get(
    '/levels/:levelNo/gate',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const levelNo = Number(req.params.levelNo)
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > 4) throw new ApiError('NOT_FOUND')
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      store.initParticipantFlow(event.id, p.id)
      const gate = store.computeGate(event.id, p.id, team.id, levelNo, new Date())
      res.json(gate)
    }),
  )

  r.get(
    '/levels/:levelNo/content',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const levelNo = Number(req.params.levelNo)
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > 4) throw new ApiError('NOT_FOUND')
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      store.initParticipantFlow(event.id, p.id)

      const stage = store.getLevelStage(event.id, levelNo)
      if (!stage) throw new ApiError('NOT_FOUND', {}, 'This level is not configured.')
      const gate = store.computeGate(event.id, p.id, team.id, levelNo, new Date())
      const choice = store.teamRepoChoices.get(team.id) ?? null
      const challenge = choice ? store.challenges.get(choice.challenge_version_id) : null
      const effEnd = store.getEffectiveEnd(stage, p.id)
      const ptr = store.participantPointers.get(p.id)
      const options = (store.repoOptions.get(event.id) ?? []).map((o) => ({
        option_key: o.option_key,
        label: o.label,
        description: o.description,
      }))

      res.json({
        level_no: levelNo,
        stage_id: stage.id,
        stage_status: stage.status,
        gate,
        explain_markdown: String(stage.config.explain_md ?? ''),
        instructions_markdown: challenge?.instructions_md ?? null,
        title: String(stage.config.explain_title ?? stage.name),
        starts_at: stage.starts_at,
        ends_at_effective: effEnd ? effEnd.toISOString() : null,
        grace_seconds: stage.grace_seconds,
        repo_option: choice && challenge ? { option_key: choice.option_key, title: challenge.title } : null,
        pointer: ptr ? { level_no: ptr.level_no, node: ptr.node } : null,
        is_lead: store.isTeamLead(team.id, p.id),
        repo_options: options,
      })
    }),
  )

  r.get(
    '/levels/:levelNo/workspace',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const levelNo = Number(req.params.levelNo)
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > 4) throw new ApiError('NOT_FOUND')
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      store.initParticipantFlow(event.id, p.id)

      const now = new Date()
      const gate = store.computeGate(event.id, p.id, team.id, levelNo, now)
      if (!gate.allowed) {
        const lower = gate.reason.toLowerCase()
        const code =
          lower.includes('repo') || lower.includes('team lead')
            ? 'REPO_NOT_LOCKED'
            : gate.waiting_on.length > 0
              ? 'TEAM_GATE_BLOCKED'
              : 'LEVEL_NOT_OPEN'
        throw new ApiError(code, { waiting_on: gate.waiting_on }, gate.reason)
      }

      const stage = store.getLevelStage(event.id, levelNo)
      if (!stage) throw new ApiError('NOT_FOUND')
      const ptr = store.participantPointers.get(p.id)!
      if (ptr.level_no !== levelNo) {
        throw new ApiError(
          ptr.level_no > levelNo ? 'LEVEL_ALREADY_SUBMITTED' : 'LEVEL_NOT_OPEN',
          {},
          'Your current node is another level.',
        )
      }
      if (ptr.node === 'done') {
        throw new ApiError('LEVEL_ALREADY_SUBMITTED')
      }
      if (ptr.node === 'explain') {
        ptr.node = 'exec'
        ptr.updated_at = now.toISOString()
        const prog = store.participantProgress.get(`${p.id}:${levelNo}`)
        if (prog) {
          prog.status = 'in_progress'
          prog.updated_at = now.toISOString()
        }
      }

      const choice = store.teamRepoChoices.get(team.id)
      if (!choice) throw new ApiError('REPO_NOT_LOCKED')
      const ch = store.challenges.get(choice.challenge_version_id)
      if (!ch) throw new ApiError('NOT_FOUND')
      const files = (store.challengeFiles.get(ch.id) ?? []).map((f) => ({
        path: f.path,
        lang: f.lang,
        size_bytes: f.size_bytes,
        line_count: f.line_count,
      }))
      const draft = store.levelDrafts.get(`${p.id}:${levelNo}`) ?? { payload: {}, version: 0, updated_at: null }
      const effEnd = store.getEffectiveEnd(stage, p.id)

      res.json({
        level_no: levelNo,
        stage_id: stage.id,
        editable: levelNo >= 3,
        repo_option: { option_key: choice.option_key, title: ch.title },
        challenge_id: ch.id,
        files,
        draft,
        ends_at_effective: effEnd ? effEnd.toISOString() : null,
        grace_seconds: stage.grace_seconds,
        limits: {
          max_span: Number(stage.config.max_span ?? 25),
          max_flags: Number(stage.config.max_flags_per_level ?? 12),
          max_locations: levelNo === 2 ? MAX_LOCATIONS : 1,
        },
      })
    }),
  )

  r.get(
    '/levels/:levelNo/draft',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const levelNo = Number(req.params.levelNo)
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > 4) throw new ApiError('NOT_FOUND')
      requireMember(p)
      const draft = store.levelDrafts.get(`${p.id}:${levelNo}`) ?? { payload: {}, version: 0, updated_at: null }
      res.json(draft)
    }),
  )

  r.put(
    '/levels/:levelNo/draft',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const levelNo = Number(req.params.levelNo)
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > 4) throw new ApiError('NOT_FOUND')
      requireMember(p)
      const ptr = store.participantPointers.get(p.id)
      if (!ptr || ptr.level_no !== levelNo) {
        throw new ApiError(
          ptr && ptr.level_no > levelNo ? 'LEVEL_ALREADY_SUBMITTED' : 'LEVEL_NOT_OPEN',
          {},
          'Drafts are only accepted for your current level.',
        )
      }
      const key = `${p.id}:${levelNo}`
      const existing = store.levelDrafts.get(key)
      const reqVersion = req.body?.version
      const payload = (req.body?.payload as Record<string, unknown>) ?? {}
      const nowIso = new Date().toISOString()
      if (!existing) {
        store.levelDrafts.set(key, { payload, version: 1, updated_at: nowIso })
        res.json({ version: 1 })
        return
      }
      if (reqVersion !== undefined && reqVersion !== null && Number(reqVersion) !== existing.version) {
        throw new ApiError('DRAFT_VERSION_CONFLICT')
      }
      existing.payload = payload
      existing.version += 1
      existing.updated_at = nowIso
      res.json({ version: existing.version })
    }),
  )

  r.post(
    '/team/repo-lock',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const idemKey = String(req.headers['idempotency-key'] ?? '')
      if (idemKey.length < 8 || idemKey.length > 80) {
        throw new ApiError('VALIDATION_ERROR', { 'Idempotency-Key': 'Required header (8..80 chars).' })
      }
      const optionKey = String(req.body?.option ?? '').trim()
      const confirm = req.body?.confirm
      if (confirm !== true) {
        throw new ApiError('VALIDATION_ERROR', { confirm: 'The irreversible-lock acknowledgement is required.' })
      }
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      if (!store.isTeamLead(team.id, p.id)) {
        throw new ApiError('AUTH_FORBIDDEN', {}, 'Only the team lead can lock the repository option.')
      }

      const existing = store.teamRepoChoices.get(team.id)
      if (existing) {
        if (existing.idempotency_key === idemKey) {
          if (existing.option_key !== optionKey) throw new ApiError('IDEMPOTENCY_CONFLICT')
          const ch = store.challenges.get(existing.challenge_version_id)
          res.json({
            option: existing.option_key,
            title: ch?.title ?? existing.option_key,
            locked_at: existing.locked_at,
            locked_by: existing.locked_by_name,
            replay: true,
          })
          return
        }
        throw new ApiError('REPO_ALREADY_LOCKED', { option: existing.option_key })
      }

      const opts = store.repoOptions.get(event.id) ?? []
      const opt = opts.find((o) => o.option_key === optionKey)
      if (!opt) throw new ApiError('VALIDATION_ERROR', { option: 'Unknown repository option.' })

      const ch = store.challenges.get(opt.challenge_version_id)
      const nowIso = new Date().toISOString()
      const choice = {
        id: newUuid(),
        event_id: event.id,
        team_id: team.id,
        option_key: opt.option_key,
        challenge_version_id: opt.challenge_version_id,
        locked_by: p.id,
        locked_by_name: p.name,
        locked_at: nowIso,
        lock_source: 'lead',
        idempotency_key: idemKey,
      }
      store.teamRepoChoices.set(team.id, choice)

      // Open Level 1 for every member of this team
      for (const mem of store.teamMembers) {
        if (mem.team_id !== team.id) continue
        store.initParticipantFlow(event.id, mem.user_id)
        const prog = store.participantProgress.get(`${mem.user_id}:1`)
        if (prog && prog.status === 'locked') {
          prog.status = 'available'
          prog.updated_at = nowIso
        }
      }

      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'repo.locked',
        entity_type: 'team',
        entity_id: team.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { option: opt.option_key, challenge_version_id: opt.challenge_version_id },
      })

      res.json({
        option: choice.option_key,
        title: ch?.title ?? opt.label,
        locked_at: choice.locked_at,
        locked_by: choice.locked_by_name,
        replay: false,
      })
    }),
  )

  r.get(
    '/team',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const { team } = requireMember(p)
      const choice = store.teamRepoChoices.get(team.id)
      const ch = choice ? store.challenges.get(choice.challenge_version_id) : null
      res.json({
        team_id: team.id,
        team_name: team.name,
        event_id: team.event_id,
        is_lead: store.isTeamLead(team.id, p.id),
        repo_option: choice && ch
          ? {
              option_key: choice.option_key,
              challenge_version_id: choice.challenge_version_id,
              locked_at: choice.locked_at,
              lock_source: choice.lock_source,
              idempotency_key: choice.idempotency_key,
              locked_by_name: choice.locked_by_name,
              title: ch.title,
              slug: ch.slug,
            }
          : null,
        members: store.teammateView(team.id),
      })
    }),
  )

  r.get(
    '/team/score',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      const { team, event } = requireMember(p)
      const levelMap = new Map<number, { level_no: number; name: string; components: Record<string, number>; total: number }>()
      let total = 0
      for (const entry of store.scoreLedger) {
        if (entry.team_id !== team.id) continue
        const st = store.stages.get(entry.stage_id)
        if (!st || st.kind !== 'level') continue
        total += entry.points
        let row = levelMap.get(st.ordinal)
        if (!row) {
          row = { level_no: st.ordinal, name: st.name, components: {}, total: 0 }
          levelMap.set(st.ordinal, row)
        }
        row.components[entry.component] = (row.components[entry.component] ?? 0) + entry.points
        row.total += entry.points
      }
      const released = ['closed', 'finalized'].includes(event.status)
      res.json({
        team_id: team.id,
        levels: Array.from(levelMap.values()).sort((a, b) => a.level_no - b.level_no),
        total,
        released,
        released_total: released ? total : null,
      })
    }),
  )

  r.get(
    '/progress',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      store.initParticipantFlow(event.id, p.id)

      const now = new Date()
      const ptr = store.participantPointers.get(p.id)
      const levels = [1, 2, 3, 4].map((n) => ({
        level_no: n,
        status: store.participantProgress.get(`${p.id}:${n}`)?.status ?? 'locked',
        gate: store.computeGate(event.id, p.id, team.id, n, now),
      }))
      const choice = store.teamRepoChoices.get(team.id)
      const ch = choice ? store.challenges.get(choice.challenge_version_id) : null
      const teammates = store.teammateView(team.id).map((t) => ({ name: t.name, levels: t.levels }))

      res.json({
        pointer: ptr ? { level_no: ptr.level_no, node: ptr.node } : null,
        levels,
        teammates,
        repo_option: choice && ch ? { option_key: choice.option_key, title: ch.title } : null,
      })
    }),
  )

  r.get(
    '/repo/tree',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      const ptr = store.initParticipantFlow(event.id, p.id)
      const lvl = req.query.level ? Number(req.query.level) : ptr.level_no
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > 4) throw new ApiError('NOT_FOUND')
      if (lvl > ptr.level_no) throw new ApiError('LEVEL_NOT_OPEN', {}, 'That level has not opened for your team yet.')
      const choice = store.teamRepoChoices.get(team.id)
      if (!choice) throw new ApiError('REPO_NOT_LOCKED')
      const files = (store.challengeFiles.get(choice.challenge_version_id) ?? []).map((f) => ({
        path: f.path,
        lang: f.lang,
        size_bytes: f.size_bytes,
        line_count: f.line_count,
      }))
      res.json({ level_no: lvl, repo_option: choice.option_key, files })
    }),
  )

  r.get(
    '/repo/files/{*filePath}',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const rawParam = Array.isArray(req.params.filePath)
        ? req.params.filePath.join('/')
        : String(req.params.filePath ?? '')
      const norm = normalizeRepoPath(decodeURIComponent(rawParam))
      if (!norm) throw new ApiError('PATH_INVALID')
      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      const ptr = store.initParticipantFlow(event.id, p.id)
      const lvl = req.query.level ? Number(req.query.level) : ptr.level_no
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > 4) throw new ApiError('NOT_FOUND')
      if (lvl > ptr.level_no) throw new ApiError('LEVEL_NOT_OPEN', {}, 'That level has not opened for your team yet.')
      const choice = store.teamRepoChoices.get(team.id)
      if (!choice) throw new ApiError('REPO_NOT_LOCKED')
      const files = store.challengeFiles.get(choice.challenge_version_id) ?? []
      const f = files.find((item) => item.path === norm)
      if (!f) throw new ApiError('FILE_NOT_FOUND')
      res.json({
        path: f.path,
        lang: f.lang,
        content: f.content,
        line_count: f.line_count,
        sha256: f.sha256,
        level_no: lvl,
        editable: lvl >= 3,
      })
    }),
  )

  r.post(
    '/uploads',
    upload.single('file'),
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const level = Number(req.query.level)
      if (!Number.isInteger(level) || level < 1 || level > 4) throw new ApiError('NOT_FOUND')
      const file = req.file
      if (!file) throw new ApiError('ARTIFACT_INVALID', { file: 'Missing file upload.' })
      const filename = file.originalname.split(/[/\\]/).pop() || 'artifact'
      const ext = (filename.split('.').pop() || '').toLowerCase()
      if (!['zip', 'diff', 'patch'].includes(ext)) {
        throw new ApiError('ARTIFACT_INVALID', { filename: 'Only .zip, .diff and .patch are accepted.' })
      }
      if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        throw new ApiError('ARTIFACT_INVALID', { file: 'Invalid file size.' })
      }

      const { event } = requireMember(p)
      requireLiveEventStatus(event.status)
      const ptr = store.participantPointers.get(p.id)
      if (!ptr || ptr.level_no !== level) {
        throw new ApiError(ptr && ptr.level_no > level ? 'LEVEL_ALREADY_SUBMITTED' : 'LEVEL_NOT_OPEN')
      }
      const prog = store.participantProgress.get(`${p.id}:${level}`)
      if (prog && (prog.status === 'submitted' || prog.status === 'auto_submitted')) {
        throw new ApiError('LEVEL_ALREADY_SUBMITTED')
      }

      const artifactId = newUuid()
      const sha = sha256Hex(file.buffer)
      store.artifacts.set(artifactId, {
        id: artifactId,
        owner_id: p.id,
        event_id: event.id,
        level_no: level,
        kind: ext as 'zip' | 'diff' | 'patch',
        filename,
        sha256: sha,
        size_bytes: file.size,
        entry_count: ext === 'zip' ? 1 : null,
        uncompressed_bytes: file.size,
        storage_key: `mem://${p.id}/level${level}/${artifactId}-${filename}`,
        content_text: ext === 'zip' ? `[zip:${file.size} bytes]` : file.buffer.toString('utf8'),
        status: 'staged',
      })
      res.json({
        artifact_id: artifactId,
        kind: ext,
        filename,
        sha256: sha,
        size_bytes: file.size,
        entry_count: ext === 'zip' ? 1 : null,
        level_no: level,
        status: 'staged',
      })
    }),
  )

  r.post(
    '/levels/:levelNo/submit',
    asyncHandler((req, res) => {
      const p = requirePrincipal(req)
      requireRulesAccepted(p)
      const levelNo = Number(req.params.levelNo)
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > 4) throw new ApiError('NOT_FOUND')
      const idemKey = String(req.headers['idempotency-key'] ?? '')
      if (idemKey.length < 8 || idemKey.length > 80) {
        throw new ApiError('VALIDATION_ERROR', { 'Idempotency-Key': 'Required header (8..80 chars).' })
      }
      const body = (req.body ?? {}) as {
        flags?: Array<Record<string, unknown>>
        confirm_empty?: boolean
        artifact_id?: string | null
        compute_diff?: boolean
      }
      const payloadHash = canonicalPayloadHash(body)

      const { team, event } = requireMember(p)
      requireLiveEventStatus(event.status)
      if (team.status !== 'active') {
        throw new ApiError('AUTH_FORBIDDEN', {}, 'This team cannot submit.')
      }
      store.initParticipantFlow(event.id, p.id)

      const idemComposite = `${p.id}:${idemKey}`
      const existingIdem = store.submissionsByIdem.get(idemComposite)
      if (existingIdem) {
        if (existingIdem.payload_hash !== payloadHash) throw new ApiError('IDEMPOTENCY_CONFLICT')
        res.status(202).json({
          submission_id: existingIdem.id,
          receipt_code: existingIdem.receipt_code,
          received_at: existingIdem.received_at,
          status: 'received',
          replay: true,
          level_no: levelNo,
        })
        return
      }

      const ptr = store.participantPointers.get(p.id)!
      if (ptr.level_no > levelNo || (ptr.level_no === levelNo && ptr.node === 'done')) {
        throw new ApiError('LEVEL_ALREADY_SUBMITTED')
      }
      if (ptr.level_no < levelNo) {
        throw new ApiError('LEVEL_NOT_OPEN', {}, 'Your current node is an earlier level.')
      }

      const stage = store.getLevelStage(event.id, levelNo)
      if (!stage) throw new ApiError('NOT_FOUND')
      if (stage.status === 'paused') throw new ApiError('ROUND_PAUSED')
      if (stage.status !== 'armed' && stage.status !== 'active') {
        throw new ApiError(
          ['ended', 'evaluating', 'released', 'final'].includes(stage.status) ? 'ROUND_ENDED' : 'LEVEL_NOT_OPEN',
        )
      }
      const now = new Date()
      const effEnd = store.getEffectiveEnd(stage, p.id)
      const graceMs = (stage.grace_seconds || 0) * 1000
      if (effEnd && now.getTime() > effEnd.getTime() + graceMs) {
        throw new ApiError('ROUND_ENDED')
      }
      const prog = store.participantProgress.get(`${p.id}:${levelNo}`)
      if (!prog || (prog.status !== 'in_progress' && prog.status !== 'available')) {
        throw new ApiError('LEVEL_ALREADY_SUBMITTED')
      }

      const choice = store.teamRepoChoices.get(team.id)
      if (!choice) throw new ApiError('REPO_NOT_LOCKED')
      const challengeVersionId = choice.challenge_version_id
      const repoFiles = store.challengeFiles.get(challengeVersionId) ?? []
      const fileLineMap = new Map(repoFiles.map((f) => [f.path, f.line_count]))

      const maxSpan = Number(stage.config.max_span ?? 25)
      const tolerance = Number(stage.config.location_tolerance_lines ?? 2)
      const maxFlags = Number(stage.config.max_flags_per_level ?? 12)
      const canonFlags: Array<Record<string, unknown>> = []
      let artifactMeta: { id: string; kind: string; filename: string; sha256: string; size_bytes: number; storage_key: string } | null = null

      if (levelNo <= 2) {
        const flags = Array.isArray(body.flags) ? body.flags : []
        if (flags.length > maxFlags) {
          throw new ApiError('SUBMISSION_CAP_REACHED', { limit: maxFlags })
        }
        if (flags.length === 0 && body.confirm_empty !== true) {
          throw new ApiError('SUBMISSION_INVALID', { flags: 'Submitting zero flags needs the explicit empty-submission confirmation.' })
        }
        for (const flag of flags) {
          const title = String(flag.title ?? '')
          if (title.trim().length < 5 || title.length > 120) {
            throw new ApiError('SUBMISSION_INVALID', { title: 'Required, 5-120 characters.' })
          }
          const description = String(flag.description ?? '')
          if (description.trim().length < 20) {
            throw new ApiError('SUBMISSION_INVALID', { description: 'Required, at least 20 characters.' })
          }
          const category = String(flag.category ?? '')
          if (!CATEGORIES.has(category)) {
            throw new ApiError('SUBMISSION_INVALID', { category: 'Category must come from the taxonomy.' })
          }
          const sev = flag.claimed_severity ? String(flag.claimed_severity) : null
          if (sev && !SEVERITIES.has(sev)) {
            throw new ApiError('SUBMISSION_INVALID', { claimed_severity: 'Invalid severity.' })
          }
          const locs = Array.isArray(flag.locations) ? (flag.locations as Array<Record<string, unknown>>) : []
          if (levelNo === 1 && locs.length !== 1) {
            throw new ApiError('LOCATION_INVALID', { locations: 'Level 1 flags carry exactly one location.' })
          }
          if (levelNo === 2 && (locs.length < 1 || locs.length > MAX_LOCATIONS)) {
            throw new ApiError('LOCATION_INVALID', { locations: `Level 2 flags carry 1 to ${MAX_LOCATIONS} ordered locations.` })
          }
          const canonLocs = locs.map((loc) => {
            const fp = String(loc.file_path ?? '')
            const lc = fileLineMap.get(fp)
            if (lc === undefined) throw new ApiError('FILE_NOT_FOUND', { file_path: fp })
            const ls = Number(loc.line_start ?? 0)
            const le = Number(loc.line_end ?? 0)
            if (ls < 1 || le < ls) throw new ApiError('LOCATION_INVALID', { line_range: `${fp}: invalid lines.` })
            if (le - ls + 1 > maxSpan) throw new ApiError('SUBMISSION_INVALID', { line_range: `Span exceeds ${maxSpan} lines.` })
            if (le > Math.max(lc, 1) + tolerance) throw new ApiError('LOCATION_INVALID', { line_range: `${fp}: range beyond EOF.` })
            return { file_path: fp, line_start: ls, line_end: le }
          })
          canonFlags.push({
            title: title.trim(),
            category,
            claimed_severity: sev,
            description,
            evidence: flag.evidence ? String(flag.evidence) : null,
            locations: canonLocs,
            file_path: canonLocs[0].file_path,
            line_start: canonLocs[0].line_start,
            line_end: canonLocs[0].line_end,
          })
        }
      } else {
        if (body.artifact_id) {
          const art = store.artifacts.get(body.artifact_id)
          if (!art || art.owner_id !== p.id || art.level_no !== levelNo) {
            throw new ApiError('ARTIFACT_INVALID', { artifact_id: 'No such staged artifact for this level.' })
          }
          if (art.status !== 'staged') {
            throw new ApiError('ARTIFACT_INVALID', { artifact_id: 'Artifact already bound to a submission.' })
          }
          art.status = 'submitted'
          artifactMeta = {
            id: art.id,
            kind: art.kind,
            filename: art.filename,
            sha256: art.sha256,
            size_bytes: art.size_bytes,
            storage_key: art.storage_key,
          }
        } else if (body.compute_diff) {
          const draft = store.levelDrafts.get(`${p.id}:${levelNo}`)
          const editedFiles = ((draft?.payload?.files as Record<string, string>) ?? {})
          const diffText = buildUnifiedDiff(repoFiles, editedFiles)
          const artId = newUuid()
          const sha = sha256Hex(diffText)
          const sizeBytes = Buffer.byteLength(diffText, 'utf8')
          const storageKey = `mem://${p.id}/level${levelNo}/level${levelNo}-draft.diff`
          store.artifacts.set(artId, {
            id: artId,
            owner_id: p.id,
            event_id: event.id,
            level_no: levelNo,
            kind: 'diff',
            filename: `level${levelNo}-draft.diff`,
            sha256: sha,
            size_bytes: sizeBytes,
            entry_count: 0,
            uncompressed_bytes: sizeBytes,
            storage_key: storageKey,
            content_text: diffText,
            status: 'submitted',
          })
          artifactMeta = {
            id: artId,
            kind: 'diff',
            filename: `level${levelNo}-draft.diff`,
            sha256: sha,
            size_bytes: sizeBytes,
            storage_key: storageKey,
          }
        } else {
          throw new ApiError('ARTIFACT_REQUIRED', { artifact: 'Upload a .zip/.diff/.patch artifact or submit the computed draft diff.' })
        }
      }

      const submissionId = newUuid()
      const receipt = receiptCode(submissionId, now)
      const nowIso = now.toISOString()
      const kind = levelNo <= 2 ? 'level_report' : 'level_artifact'
      const sub: SubmissionRecord = {
        id: submissionId,
        tenant_id: event.tenant_id,
        event_id: event.id,
        stage_id: stage.id,
        challenge_version_id: challengeVersionId,
        team_id: team.id,
        author_id: p.id,
        kind,
        idempotency_key: idemKey,
        payload: {
          level_no: levelNo,
          kind,
          flags: canonFlags,
          confirm_empty: Boolean(body.confirm_empty),
          empty: levelNo <= 2 ? canonFlags.length === 0 : !artifactMeta,
          ...(artifactMeta ? { artifact: artifactMeta } : {}),
        },
        payload_hash: payloadHash,
        status: 'received',
        receipt_code: receipt,
        title: `Level ${levelNo} submission`,
        file_path: (canonFlags[0]?.file_path as string | undefined) ?? null,
        line_start: (canonFlags[0]?.line_start as number | undefined) ?? null,
        line_end: (canonFlags[0]?.line_end as number | undefined) ?? null,
        category: (canonFlags[0]?.category as string | undefined) ?? null,
        flag_code: null,
        feedback_released: stage.status === 'released' || stage.status === 'final',
        matched_bug_code: null,
        points_visible: null,
        received_at: nowIso,
      }
      store.submissions.set(submissionId, sub)
      store.submissionsByIdem.set(idemComposite, sub)

      evaluateLevelSubmission(sub)

      // Advance pointer and progress
      prog.status = 'submitted'
      prog.submission_id = submissionId
      prog.submitted_at = nowIso
      prog.updated_at = nowIso

      if (levelNo >= 4) {
        ptr.level_no = 4
        ptr.node = 'done'
      } else {
        ptr.level_no = levelNo + 1
        ptr.node = 'explain'
        const nextProg = store.participantProgress.get(`${p.id}:${levelNo + 1}`)
        if (nextProg) {
          nextProg.status = 'locked'
          nextProg.updated_at = nowIso
        }
      }
      ptr.updated_at = nowIso

      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'level.submitted',
        entity_type: 'submission',
        entity_id: submissionId,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { level: levelNo, receipt, kind },
      })

      res.status(202).json({
        submission_id: submissionId,
        receipt_code: receipt,
        received_at: nowIso,
        status: 'received',
        replay: false,
        level_no: levelNo,
      })
    }),
  )

  r.post(
    '/runs',
    asyncHandler((req, res) => {
      requirePrincipal(req)
      throw new ApiError(
        'RUNNER_UNAVAILABLE',
        {},
        'Running code is disabled for this event. Your drafts are saved and you can submit your work.',
      )
    }),
  )

  // ---------------- Review ----------------

  r.get(
    '/review/queue',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'reviewer', 'organizer', 'admin')
      const queue = Array.from(store.reviewItems.values())
        .filter((ri) => ri.status === 'open' || ri.status === 'claimed')
        .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
        .map((ri) => {
          const s = store.submissions.get(ri.submission_id)!
          return {
            review_item_id: ri.id,
            submission_id: s.id,
            kind: s.kind === 'ctf_flag' ? 'ctf_flag' : 'bug_report',
            title: s.title,
            file_path: s.file_path,
            line_range: [s.line_start, s.line_end],
            category: s.category,
            received_at: s.received_at,
            priority: ri.priority,
            status: ri.status,
            claimed_by_me: ri.claimed_by === p.id,
          }
        })
      res.json({ queue })
    }),
  )

  r.post(
    '/review/items/:itemId/claim',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'reviewer', 'organizer', 'admin')
      const ri = store.reviewItems.get(String(req.params.itemId))
      if (!ri) throw new ApiError('NOT_FOUND')
      if (ri.status === 'decided') throw new ApiError('VALIDATION_ERROR', { claim: 'Item already decided.' })
      ri.status = 'claimed'
      ri.claimed_by = p.id
      ri.claimed_at = new Date().toISOString()
      const sub = store.submissions.get(ri.submission_id)
      if (sub) sub.status = 'in_review'
      res.json({ ok: true })
    }),
  )

  r.get(
    '/review/items/:itemId',
    asyncHandler((req, res) => {
      requireRoles(req, 'reviewer', 'organizer', 'admin')
      const ri = store.reviewItems.get(String(req.params.itemId))
      if (!ri) throw new ApiError('NOT_FOUND')
      const s = store.submissions.get(ri.submission_id)!
      const files = store.challengeFiles.get(s.challenge_version_id) ?? []
      const f = s.file_path ? files.find((item) => item.path === s.file_path) : null
      const teamTotalReports = Array.from(store.submissions.values()).filter((x) => x.team_id === s.team_id).length
      res.json({
        review_item_id: ri.id,
        status: ri.status,
        submission: {
          id: s.id,
          kind: s.kind === 'ctf_flag' ? 'ctf_flag' : 'bug_report',
          title: s.title,
          payload: s.payload,
          file_path: s.file_path,
          line_start: s.line_start,
          line_end: s.line_end,
          category: s.category,
          received_at: s.received_at,
          receipt_code: s.receipt_code,
          flag_code: s.flag_code,
          status: s.status,
        },
        file: f ? { content: f.content, lang: f.lang, line_count: f.line_count } : null,
        team_total_reports: teamTotalReports,
      })
    }),
  )

  r.post(
    '/review/items/:itemId/decision',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'reviewer', 'organizer', 'admin')
      const ri = store.reviewItems.get(String(req.params.itemId))
      if (!ri) throw new ApiError('NOT_FOUND')
      if (ri.status === 'decided') throw new ApiError('VALIDATION_ERROR', { decision: 'Already decided.' })
      const decision = String(req.body?.decision ?? '')
      const rubric = (req.body?.rubric as Record<string, number>) ?? {}
      const notes = req.body?.notes ? String(req.body.notes) : null
      const statusMap: Record<string, string> = {
        accept_full: 'decided',
        accept_partial: 'decided',
        duplicate: 'duplicate',
        reject_invalid: 'rejected_auto',
        unplanned_valid: 'needs_review',
        needs_second_review: 'in_review',
      }
      if (!statusMap[decision]) throw new ApiError('VALIDATION_ERROR', { decision: 'Unknown decision.' })
      const sub = store.submissions.get(ri.submission_id)!
      ri.status = 'decided'
      sub.status = statusMap[decision]
      const quality = decision === 'accept_full' ? 1 : decision === 'accept_partial' ? 0.5 : 0
      store.reviews.push({
        id: newUuid(),
        submission_id: sub.id,
        reviewer_id: p.id,
        decision,
        rubric,
        quality,
        notes,
        created_at: new Date().toISOString(),
      })
      if (quality > 0) {
        const pts = Math.round(25 * quality * 100) / 100
        store.scoreLedger.push({
          id: newUuid(),
          tenant_id: sub.tenant_id,
          event_id: sub.event_id,
          stage_id: sub.stage_id,
          team_id: sub.team_id,
          component: 'code_review',
          kind: 'award',
          points: pts,
          reason_code: `REVIEW_${decision.toUpperCase()}`,
          submission_id: sub.id,
          actor_id: p.id,
          note: notes,
          created_at: new Date().toISOString(),
        })
        sub.points_visible = (sub.points_visible ?? 0) + pts
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'review.decided',
        entity_type: 'submission',
        entity_id: sub.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { decision },
      })
      res.json({ ok: true, decision })
    }),
  )

  // ---------------- Admin & Organizer ----------------

  r.get(
    '/admin/events',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const events = Array.from(store.events.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
      res.json({ events })
    }),
  )

  r.post(
    '/admin/events',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const name = String(req.body?.name ?? '').trim()
      const slug = String(req.body?.slug ?? '').trim()
      if (name.length < 3 || !/^[a-z0-9-]+$/.test(slug)) {
        throw new ApiError('VALIDATION_ERROR', { slug: 'Valid name and lowercase slug required.' })
      }
      const id = newUuid()
      const nowIso = new Date().toISOString()
      store.events.set(id, {
        id,
        tenant_id: store.tenantId,
        slug,
        name,
        status: 'draft',
        starts_at: req.body?.starts_at ?? null,
        ends_at: null,
        timezone: String(req.body?.timezone ?? 'Asia/Kolkata'),
        duration_minutes: Number(req.body?.duration_minutes ?? 180),
        max_participants: Number(req.body?.max_participants ?? 50),
        max_teams: Number(req.body?.max_teams ?? 12),
        rules_version: 1,
        config_version: 1,
        config: { features: { runner_enabled: false, ai_assessment_enabled: false } },
        created_at: nowIso,
      })
      store.readinessItems.set(id, [])
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'event.created',
        entity_type: 'event',
        entity_id: id,
        request_id: (req as AuthedRequest).requestId ?? '-',
      })
      res.status(201).json({ event_id: id })
    }),
  )

  r.post(
    '/admin/events/:eventId/status',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const ev = store.events.get(String(req.params.eventId))
      if (!ev) throw new ApiError('NOT_FOUND')
      const target = String(req.body?.status ?? '')
      const allowed: Record<string, string[]> = {
        draft: ['configured'],
        configured: ['ready', 'draft'],
        ready: ['live'],
        live: ['closed'],
        closed: ['finalized'],
        finalized: ['archived'],
      }
      if (!allowed[ev.status]?.includes(target)) {
        throw new ApiError('VALIDATION_ERROR', { transition: `Cannot move from ${ev.status} to ${target}.` })
      }
      const from = ev.status
      ev.status = target
      if (target === 'live' && !ev.starts_at) {
        const now = new Date()
        ev.starts_at = now.toISOString()
        ev.ends_at = new Date(now.getTime() + ev.duration_minutes * 60_000).toISOString()
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'event.status_changed',
        entity_type: 'event',
        entity_id: ev.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { from, to: target },
      })
      res.json({ ok: true, status: target })
    }),
  )

  r.get(
    '/admin/events/:eventId/live',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const eventId = String(req.params.eventId)
      const teams = Array.from(store.teams.values()).filter((t) => t.event_id === eventId)
      const teamIds = new Set(teams.map((t) => t.id))
      const participants = new Set(store.teamMembers.filter((m) => teamIds.has(m.team_id)).map((m) => m.user_id)).size
      const submissionCounts: Record<string, number> = {}
      for (const s of store.submissions.values()) {
        if (s.event_id === eventId) submissionCounts[s.status] = (submissionCounts[s.status] ?? 0) + 1
      }
      const stages = Array.from(store.stages.values())
        .filter((st) => st.event_id === eventId)
        .sort((a, b) => (a.kind === 'level' ? 1 : 0) - (b.kind === 'level' ? 1 : 0) || a.ordinal - b.ordinal)
      const revBacklog = Array.from(store.reviewItems.values()).filter((r) => r.status === 'open').length
      res.json({
        teams: teams.length,
        participants_online_estimate: participants,
        submission_counts: submissionCounts,
        job_queue: { oldest_queued_age_s: 0, dead_letters: 0 },
        review_backlog: revBacklog,
        stages,
        health: { database_app: 'ok', database_gt: 'isolated', clock: new Date().toISOString() },
        kill_switches: { runner_enabled: false, ai_assessment_enabled: false, telemetry_enabled: false },
      })
    }),
  )

  r.post(
    '/admin/stages/:stageId/control',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const st = store.stages.get(String(req.params.stageId))
      if (!st) throw new ApiError('NOT_FOUND')
      const action = String(req.body?.action ?? '')
      const reason = String(req.body?.reason ?? '').trim()
      if (!reason) throw new ApiError('VALIDATION_ERROR', { reason: 'A reason code is required for stage control.' })
      const now = new Date()
      if (action === 'seal' && st.status === 'draft') st.status = 'sealed'
      else if (action === 'arm' && st.status === 'sealed') st.status = 'armed'
      else if (action === 'start' && st.status === 'armed') {
        st.status = 'active'
        st.started_at = now.toISOString()
        const ev = store.events.get(st.event_id)
        const dur = ev?.duration_minutes ?? 180
        st.ends_at = new Date(now.getTime() + dur * 60_000).toISOString()
      } else if (action === 'pause' && st.status === 'active') st.status = 'paused'
      else if (action === 'resume' && st.status === 'paused') st.status = 'active'
      else if (action === 'extend') {
        const sec = Number(req.body?.seconds ?? 0)
        if (sec <= 0 || sec > 3600) throw new ApiError('VALIDATION_ERROR', { seconds: '1..3600' })
        const cur = st.ends_at ? new Date(st.ends_at).getTime() : now.getTime()
        st.ends_at = new Date(cur + sec * 1000).toISOString()
      } else if (action === 'end' && (st.status === 'active' || st.status === 'paused')) {
        st.status = 'ended'
        st.ended_at = now.toISOString()
      } else {
        throw new ApiError('VALIDATION_ERROR', { transition: `Cannot ${action} from ${st.status}.` })
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: `stage.${action}`,
        entity_type: 'stage',
        entity_id: st.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { reason },
      })
      res.json({ ok: true, action })
    }),
  )

  r.post(
    '/admin/stages/:stageId/release',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const st = store.stages.get(String(req.params.stageId))
      if (!st) throw new ApiError('NOT_FOUND')
      const action = String(req.body?.action ?? 'release')
      if (action === 'evaluate') st.status = 'evaluating'
      else {
        st.status = 'released'
        for (const sub of store.submissions.values()) {
          if (sub.stage_id === st.id) sub.feedback_released = true
        }
        store.refreshLeaderboardSnapshot(st.id, st.event_id, 'public')
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: `stage.${action}`,
        entity_type: 'stage',
        entity_id: st.id,
        request_id: (req as AuthedRequest).requestId ?? '-',
      })
      res.json({ ok: true })
    }),
  )

  r.get(
    '/admin/events/:eventId/readiness',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      res.json({ items: store.readinessItems.get(String(req.params.eventId)) ?? [] })
    }),
  )

  r.post(
    '/admin/events/:eventId/readiness/:key',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const items = store.readinessItems.get(String(req.params.eventId)) ?? []
      const item = items.find((i) => i.key === req.params.key)
      const state = String(req.body?.state ?? 'checked') as 'checked' | 'unchecked' | 'na'
      if (item) {
        item.state = state
        item.checked_at = state === 'checked' ? new Date().toISOString() : null
      }
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'readiness.updated',
        entity_type: 'event',
        entity_id: String(req.params.eventId),
        request_id: (req as AuthedRequest).requestId ?? '-',
        details: { key: req.params.key, state },
      })
      res.json({ ok: true })
    }),
  )

  r.get(
    '/admin/events/:eventId/progress',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const eventId = String(req.params.eventId)
      const teams = Array.from(store.teams.values())
        .filter((t) => t.event_id === eventId)
        .map((t) => {
          const choice = store.teamRepoChoices.get(t.id)
          const members = store.teammateView(t.id)
          return {
            team_id: t.id,
            team_name: t.name,
            team_status: t.status,
            repo_option: choice?.option_key ?? null,
            lock_source: choice?.lock_source ?? null,
            members: members.map((m) => ({
              name: m.name,
              pointer: m.pointer,
              levels: m.levels,
            })),
          }
        })
      res.json({ event_id: eventId, teams, level_count: 4 })
    }),
  )

  r.post(
    '/admin/events/:eventId/announcements',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const body = String(req.body?.body ?? '').trim()
      const severity = String(req.body?.severity ?? 'info') as 'info' | 'warning' | 'critical'
      if (body.length < 3) throw new ApiError('VALIDATION_ERROR', { body: 'Required.' })
      store.announcements.push({
        id: newUuid(),
        event_id: String(req.params.eventId),
        severity,
        audience: 'all',
        body,
        author: p.name,
        created_at: new Date().toISOString(),
      })
      res.status(201).json({ ok: true })
    }),
  )

  r.post(
    '/admin/events/:eventId/teams',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const eventId = String(req.params.eventId)
      const name = String(req.body?.name ?? '').trim()
      if (name.length < 2) throw new ApiError('VALIDATION_ERROR', { name: 'Minimum 2 chars.' })
      const id = newUuid()
      const joinCode = id.slice(0, 8).toUpperCase()
      store.teams.set(id, { id, event_id: eventId, name, join_code: joinCode, status: 'active' })
      res.status(201).json({ team_id: id, join_code: joinCode })
    }),
  )

  r.post(
    '/admin/events/:eventId/invites',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const raw = newRefreshToken()
      const id = newUuid()
      store.invites.set(id, {
        id,
        event_id: String(req.params.eventId),
        email,
        token_hash: tokenHash(raw),
        team_id: req.body?.team_id ?? null,
        role: (req.body?.role ?? 'participant') as Role,
        used_at: null,
        expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      })
      res.status(201).json({ invite_token: raw, activation_url: `/login` })
    }),
  )

  r.get(
    '/admin/events/:eventId/participants',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const eventId = String(req.params.eventId)
      const teams = Array.from(store.teams.values()).filter((t) => t.event_id === eventId)
      const teamMap = new Map(teams.map((t) => [t.id, t]))
      const rows = store.teamMembers
        .filter((m) => teamMap.has(m.team_id))
        .map((m) => {
          const u = store.users.get(m.user_id)!
          const t = teamMap.get(m.team_id)!
          return {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            status: u.status,
            team_name: t.name,
            activated: Boolean(u.password_hash),
          }
        })
      res.json({ participants: rows })
    }),
  )

  r.post(
    '/admin/events/:eventId/challenges',
    asyncHandler((req, res) => {
      const p = requireStepUp(req, requireRoles(req, 'organizer', 'admin'))
      const cid = newUuid()
      store.challenges.set(cid, {
        id: cid,
        event_id: String(req.params.eventId),
        slug: String(req.body?.slug ?? 'challenge'),
        title: String(req.body?.title ?? 'Challenge'),
        version: 1,
        instructions_md: String(req.body?.instructions_markdown ?? ''),
        status: 'draft',
        content_hash: null,
        frozen_at: null,
        published_at: null,
      })
      store.challengeFiles.set(cid, [])
      store.writeAudit({
        actor_id: p.id,
        actor_role: p.role,
        action: 'challenge.created',
        entity_type: 'challenge',
        entity_id: cid,
        request_id: (req as AuthedRequest).requestId ?? '-',
      })
      res.status(201).json({ challenge_id: cid })
    }),
  )

  r.post(
    '/admin/challenges/:challengeId/files',
    upload.single('file'),
    asyncHandler((req, res) => {
      requireStepUp(req, requireRoles(req, 'organizer', 'admin'))
      const ch = store.challenges.get(String(req.params.challengeId))
      if (!ch) throw new ApiError('NOT_FOUND')
      if (!['draft', 'reviewed'].includes(ch.status)) throw new ApiError('GROUND_TRUTH_LOCKED')
      const file = req.file
      if (!file) throw new ApiError('VALIDATION_ERROR', { file: 'Required' })
      const norm = normalizeRepoPath(file.originalname)
      if (!norm) throw new ApiError('PATH_INVALID')
      const text = file.buffer.toString('utf8')
      const list = store.challengeFiles.get(ch.id) ?? []
      const existingIdx = list.findIndex((item) => item.path === norm)
      const record = {
        path: norm,
        lang: langForPath(norm),
        content: text,
        sha256: sha256Hex(file.buffer),
        size_bytes: file.size,
        line_count: text.split('\n').length,
      }
      if (existingIdx >= 0) list[existingIdx] = record
      else list.push(record)
      store.challengeFiles.set(ch.id, list)
      res.json({ ok: true, path: norm, line_count: record.line_count })
    }),
  )

  r.post(
    '/admin/challenges/:challengeId/freeze',
    asyncHandler((req, res) => {
      requireStepUp(req, requireRoles(req, 'organizer', 'admin'))
      const ch = store.challenges.get(String(req.params.challengeId))
      if (!ch) throw new ApiError('NOT_FOUND')
      const files = store.challengeFiles.get(ch.id) ?? []
      if (!files.length) throw new ApiError('VALIDATION_ERROR', { files: 'Upload at least one file before freezing.' })
      ch.status = 'sealed'
      ch.content_hash = `sha256:${sha256Hex(files.map((f) => f.sha256).join(''))}`
      ch.frozen_at = new Date().toISOString()
      res.json({ ok: true, content_hash: ch.content_hash })
    }),
  )

  r.post(
    '/admin/challenges/:challengeId/publish',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const ch = store.challenges.get(String(req.params.challengeId))
      if (!ch) throw new ApiError('NOT_FOUND')
      ch.status = 'published'
      ch.published_at = new Date().toISOString()
      store.assignments.push({
        id: newUuid(),
        event_id: ch.event_id,
        stage_id: String(req.body?.stage_id ?? ''),
        challenge_version_id: ch.id,
        team_id: null,
        repo_url: null,
        codespace_url: null,
      })
      res.json({ ok: true })
    }),
  )

  r.post(
    '/admin/challenges/:challengeId/ground-truth/test-results',
    asyncHandler((req, res) => {
      const p = requireStepUp(req, requireRoles(req, 'organizer', 'admin'))
      const subId = String(req.body?.submission_id ?? '')
      const passed = Number(req.body?.tests_passed ?? 0)
      const total = Number(req.body?.tests_total ?? 0)
      const sub = store.submissions.get(subId)
      if (!sub || total <= 0 || passed < 0 || passed > total) {
        throw new ApiError('VALIDATION_ERROR', { tests: 'Provide submission_id, tests_passed, tests_total.' })
      }
      const pts = Math.round((passed / total) * 50 * 100) / 100
      store.scoreLedger.push({
        id: newUuid(),
        tenant_id: sub.tenant_id,
        event_id: sub.event_id,
        stage_id: sub.stage_id,
        team_id: sub.team_id,
        component: 'functional_test',
        kind: 'award',
        points: pts,
        reason_code: 'TEST_RESULTS_RECORDED',
        submission_id: sub.id,
        actor_id: p.id,
        note: `${passed}/${total} tests passed`,
        created_at: new Date().toISOString(),
      })
      sub.points_visible = (sub.points_visible ?? 0) + pts
      res.json({ ok: true })
    }),
  )

  r.get(
    '/admin/audit',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500)
      const entries = [...store.auditLog].reverse().slice(0, limit)
      res.json({ entries })
    }),
  )

  r.get(
    '/admin/audit/verify',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      res.json(store.verifyAudit())
    }),
  )

  r.get(
    '/admin/disputes',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const disputes = Array.from(store.disputes.values()).map((d) => {
        const sub = store.submissions.get(d.submission_id)
        return {
          id: d.id,
          status: d.status,
          statement: d.statement,
          created_at: d.created_at,
          title: sub?.title ?? 'Submission',
          receipt_code: sub?.receipt_code ?? '-',
          submission_id: d.submission_id,
        }
      })
      res.json({ disputes })
    }),
  )

  r.post(
    '/admin/disputes/:disputeId/resolve',
    asyncHandler((req, res) => {
      const p = requireRoles(req, 'organizer', 'admin')
      const d = store.disputes.get(String(req.params.disputeId))
      if (!d) throw new ApiError('NOT_FOUND')
      const outcome = String(req.body?.outcome ?? '')
      if (outcome !== 'upheld' && outcome !== 'rejected') {
        throw new ApiError('VALIDATION_ERROR', { outcome: 'upheld|rejected' })
      }
      d.status = outcome
      d.resolution = String(req.body?.resolution ?? '')
      const adjustPoints = Number(req.body?.adjust_points ?? 0)
      if (outcome === 'upheld' && adjustPoints !== 0) {
        const sub = store.submissions.get(d.submission_id)
        if (sub) {
          store.scoreLedger.push({
            id: newUuid(),
            tenant_id: sub.tenant_id,
            event_id: sub.event_id,
            stage_id: sub.stage_id,
            team_id: d.team_id,
            component: 'adjustment',
            kind: 'adjustment',
            points: adjustPoints,
            reason_code: 'DISPUTE_UPHELD',
            submission_id: sub.id,
            actor_id: p.id,
            note: d.resolution,
            created_at: new Date().toISOString(),
          })
        }
      }
      res.json({ ok: true })
    }),
  )

  r.get(
    '/admin/events/:eventId/export/:kind',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      const eventId = String(req.params.eventId)
      const kind = String(req.params.kind)
      if (!['results', 'submissions', 'ledger'].includes(kind)) {
        throw new ApiError('VALIDATION_ERROR', { kind: 'results|submissions|ledger' })
      }
      let content = ''
      if (kind === 'results') {
        content = ['team_id,team_name,score']
          .concat(
            Array.from(store.teams.values())
              .filter((t) => t.event_id === eventId)
              .map((t) => {
                const total = store.scoreLedger.filter((e) => e.team_id === t.id).reduce((s, e) => s + e.points, 0)
                return `${t.id},"${t.name}",${total}`
              }),
          )
          .join('\n')
      } else if (kind === 'submissions') {
        content = ['submission_id,kind,title,status,receipt_code,received_at']
          .concat(
            Array.from(store.submissions.values())
              .filter((s) => s.event_id === eventId)
              .map((s) => `${s.id},${s.kind},"${s.title.replace(/"/g, '""')}",${s.status},${s.receipt_code},${s.received_at}`),
          )
          .join('\n')
      } else {
        content = ['entry_id,stage_id,team_id,component,kind,points,reason_code,created_at']
          .concat(
            store.scoreLedger
              .filter((e) => e.event_id === eventId)
              .map((e) => `${e.id},${e.stage_id},${e.team_id},${e.component},${e.kind},${e.points},${e.reason_code},${e.created_at}`),
          )
          .join('\n')
      }
      res.json({ filename: `${kind}_${eventId.slice(0, 8)}.csv`, content })
    }),
  )

  r.get(
    '/admin/system/health',
    asyncHandler((req, res) => {
      requireRoles(req, 'organizer', 'admin')
      res.json({
        databases: { app: 'ok', gt: 'isolated' },
        jobs: { done: store.submissions.size },
        oldest_queued_job_age_s: 0,
        profile: process.env.PROFILE || 'dev',
        environment: process.env.ENVIRONMENT || 'development',
        runner_enabled: false,
        ai_assessment_enabled: false,
      })
    }),
  )

  // Suppress unused import warning on NextFunction if strict
  void (undefined as unknown as NextFunction)

  return r
}
