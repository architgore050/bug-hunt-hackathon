import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { ApiError, formatApiErrorMessage } from './errors.ts'
import {
  ACCESS_TOKEN_TTL_S,
  MAX_SESSIONS_PER_USER,
  PASSWORD_MIN_LENGTH,
  REFRESH_REUSE_GRACE_S,
  REFRESH_TOKEN_TTL_S,
  canonicalJson,
  canonicalPayloadHash,
  createAccessToken,
  decodeAccessToken,
  flagCodeHash,
  hashPassword,
  ipHash,
  JwtExpiredError,
  newRefreshToken,
  receiptCode,
  sha256Hex,
  tokenHash,
  uuid7,
  verifyPassword,
} from './security.ts'
import { DEFAULT_STAGE_CONFIG, langFor, store, type StageRecord, type UserRecord } from './store.ts'

const REFRESH_COOKIE = 'bhctf_refresh'

const rateBucket = new Map<string, number[]>()

function rateLimit(key: string, limit: number, windowS: number): void {
  const now = Date.now() / 1000
  const hits = (rateBucket.get(key) ?? []).filter((t) => now - t < windowS)
  if (hits.length >= limit) {
    throw new ApiError('AUTH_RATE_LIMITED', { n: Math.ceil(windowS) })
  }
  hits.push(now)
  rateBucket.set(key, hits.slice(-60))
}

interface AuthedRequest extends Request {
  requestId: string
  principal?: {
    id: string
    email: string
    name: string
    role: UserRecord['role']
    status: UserRecord['status']
    sessionId: string
    tokenVersion: number
  }
}

function getPrincipal(req: AuthedRequest): NonNullable<AuthedRequest['principal']> {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw new ApiError('AUTH_TOKEN_EXPIRED')
  }
  const raw = authHeader.slice(7).trim()
  let claims
  try {
    claims = decodeAccessToken(raw)
  } catch (err) {
    if (err instanceof JwtExpiredError) throw new ApiError('AUTH_TOKEN_EXPIRED')
    throw new ApiError('AUTH_SESSION_REVOKED')
  }
  const user = store.users.find((u) => u.id === claims.sub)
  const session = store.sessions.find((s) => s.id === claims.sid && s.user_id === claims.sub)
  if (!user || !session || session.revoked_at !== null) {
    throw new ApiError('AUTH_SESSION_REVOKED')
  }
  if (user.status === 'disqualified') {
    throw new ApiError('AUTH_FORBIDDEN', {}, 'This account was disqualified. Contact the organizers.')
  }
  if (user.status !== 'active') {
    throw new ApiError('AUTH_NOT_ACTIVATED')
  }
  if ((claims.tv ?? 1) !== user.token_version) {
    throw new ApiError('AUTH_SESSION_REVOKED')
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    sessionId: session.id,
    tokenVersion: user.token_version,
  }
}

function requireRole(...roles: UserRecord['role'][]) {
  return (req: AuthedRequest) => {
    const p = getPrincipal(req)
    if (!roles.includes(p.role)) throw new ApiError('AUTH_FORBIDDEN')
    return p
  }
}

function requireRulesAccepted(p: NonNullable<AuthedRequest['principal']>): void {
  if (p.role !== 'participant') return
  const ev = [...store.events]
    .reverse()
    .find((e) => ['ready', 'live', 'closed', 'finalized'].includes(e.status))
  if (!ev) return
  const accepted = store.acceptances.some((a) => a.user_id === p.id && a.rules_version === ev.rules_version)
  if (!accepted) throw new ApiError('RULES_NOT_ACCEPTED')
}

function requireStepUp(req: AuthedRequest) {
  const p = requireRole('organizer', 'admin')(req)
  const session = store.sessions.find((s) => s.id === p.sessionId)
  const stepUpAt = session?.step_up_at
  if (!stepUpAt || Date.now() - stepUpAt.getTime() > 5 * 60 * 1000) {
    throw new ApiError('ADMIN_STEP_UP_REQUIRED')
  }
  return p
}

function setRefreshCookie(req: Request, res: Response, rawToken: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.cookie(REFRESH_COOKIE, rawToken, {
    maxAge: REFRESH_TOKEN_TTL_S * 1000,
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/v1/auth/refresh',
  })
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth/refresh' })
}

function latestPublishedStage(): StageRecord | undefined {
  const validEvents = new Set(
    store.events
      .filter((e) => ['ready', 'live', 'closed', 'finalized'].includes(e.status))
      .map((e) => e.id),
  )
  return [...store.stages]
    .filter((st) => validEvents.has(st.event_id))
    .sort((a, b) => b.ordinal - a.ordinal || b.created_at.getTime() - a.created_at.getTime())[0]
}

function effectiveEnd(stage: StageRecord, userId: string): Date | null {
  if (!stage.ends_at) return null
  const delta = store.timeAdjustments
    .filter((ta) => ta.stage_id === stage.id && (ta.user_id === null || ta.user_id === userId))
    .reduce((sum, ta) => sum + ta.delta_seconds, 0)
  return new Date(stage.ends_at.getTime() + delta * 1000)
}

function participantTeamId(userId: string): string | null {
  const tm = store.teamMembers.find((m) => m.user_id === userId)
  return tm ? tm.team_id : null
}

function assignedChallenge(stageId: string, teamId: string | null) {
  const asg = store.assignments.find(
    (a) =>
      a.stage_id === stageId &&
      (a.team_id === null || a.team_id === teamId) &&
      store.challengeVersions.some((cv) => cv.id === a.challenge_version_id && cv.status === 'published'),
  )
  if (!asg) return null
  const cv = store.challengeVersions.find((c) => c.id === asg.challenge_version_id)
  if (!cv) return null
  return { cv, asg }
}

const VALID_CATEGORIES = new Set([
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 } })

function wrap(fn: (req: AuthedRequest, res: Response, next: NextFunction) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next)
  }
}

export function createApiRouter(): express.Router {
  const router = express.Router()

  // --- health ---
  router.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=10')
    res.json({
      status: 'ok',
      database_app: 'up',
      database_gt: 'up',
      clock: new Date().toISOString(),
    })
  })

  // --- public ---
  router.get(
    '/v1/time',
    wrap((_req, res) => {
      const now = new Date()
      res.json({ server_time_ms: now.getTime(), server_time: now.toISOString() })
    }),
  )

  router.get(
    '/v1/public/event',
    wrap((_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=10')
      const ev = [...store.events].reverse().find((e) => e.status !== 'draft')
      if (!ev) return res.json({ event: null })
      const cfg = ev.config as Record<string, unknown>
      return res.json({
        event: {
          slug: ev.slug,
          name: ev.name,
          status: ev.status,
          starts_at: ev.starts_at ? ev.starts_at.toISOString() : null,
          ends_at: ev.ends_at ? ev.ends_at.toISOString() : null,
          timezone: ev.timezone,
          duration_minutes: ev.duration_minutes,
          max_participants: ev.max_participants,
          max_teams: ev.max_teams,
          rules_version: ev.rules_version,
          format: cfg.public_summary ?? {},
        },
      })
    }),
  )

  router.get(
    '/v1/public/rules',
    wrap((_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=10')
      const doc = [...store.rulesDocuments].sort((a, b) => b.version - a.version)[0]
      if (!doc) return res.json({ rules: null })
      const ev = store.events.find((e) => e.id === doc.event_id)
      return res.json({
        rules: {
          version: doc.version,
          body_markdown: doc.body_md,
          frozen_at: doc.frozen_at.toISOString(),
          event_name: ev?.name ?? 'Fall Back',
        },
      })
    }),
  )

  // --- auth ---
  router.post(
    '/v1/auth/login',
    wrap((req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const password = String(req.body?.password ?? '')
      const ip = req.ip || '127.0.0.1'
      rateLimit(`login:${ip}`, 20, 60)
      rateLimit(`login-u:${email}`, 10, 60)

      const user = store.users.find((u) => u.email.toLowerCase() === email)
      if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
        throw new ApiError('AUTH_INVALID_CREDENTIALS')
      }
      if (user.status === 'pending') throw new ApiError('AUTH_NOT_ACTIVATED')
      if (user.status === 'disqualified') {
        throw new ApiError('AUTH_FORBIDDEN', {}, 'This account was disqualified. Contact the organizers.')
      }

      const now = new Date()
      // Reclaim zombie sessions and enforce max_sessions_per_user
      for (const sess of store.sessions) {
        if (sess.user_id === user.id && sess.revoked_at === null) {
          const hasLiveRt = store.refreshTokens.some(
            (rt) => rt.session_id === sess.id && rt.status === 'active' && rt.expires_at > now,
          )
          if (!hasLiveRt) sess.revoked_at = now
        }
      }
      const liveSessions = store.sessions
        .filter((s) => s.user_id === user.id && s.revoked_at === null)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())

      while (liveSessions.length >= MAX_SESSIONS_PER_USER) {
        const victim = liveSessions.shift()!
        victim.revoked_at = now
        for (const rt of store.refreshTokens) {
          if (rt.session_id === victim.id) rt.status = 'revoked'
        }
        store.auditWrite({
          actor_id: user.id,
          actor_role: user.role,
          action: 'auth.session_evicted',
          entity_type: 'session',
          entity_id: victim.id,
          request_id: req.requestId,
        })
      }

      const sessionId = uuid7()
      store.sessions.push({
        id: sessionId,
        user_id: user.id,
        ip_hash: ipHash(ip),
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        created_at: now,
        last_seen_at: now,
        revoked_at: null,
        step_up_at: null,
      })

      const { token, expiresAt } = createAccessToken({
        userId: user.id,
        sessionId,
        role: user.role,
        tokenVersion: user.token_version,
      })

      const rawRefresh = newRefreshToken()
      store.refreshTokens.push({
        id: uuid7(),
        session_id: sessionId,
        user_id: user.id,
        token_hash: tokenHash(rawRefresh),
        status: 'active',
        replaces_id: null,
        expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
        rotated_at: null,
        successor_raw: null,
      })

      store.auditWrite({
        actor_id: user.id,
        actor_role: user.role,
        action: 'auth.login',
        entity_type: 'user',
        entity_id: user.id,
        request_id: req.requestId,
      })

      setRefreshCookie(req, res, rawRefresh)
      return res.json({
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

  router.post(
    '/v1/auth/refresh',
    wrap((req, res) => {
      if (!req.headers['x-bhctf-client']) {
        throw new ApiError('AUTH_FORBIDDEN', {}, 'Missing client header.')
      }
      const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined
      if (!raw) throw new ApiError('AUTH_SESSION_REVOKED')

      const th = tokenHash(raw)
      const rt = store.refreshTokens.find((r) => r.token_hash === th)
      if (!rt) throw new ApiError('AUTH_SESSION_REVOKED')
      const now = new Date()
      if (rt.status === 'revoked' || rt.expires_at < now) {
        throw new ApiError('AUTH_SESSION_REVOKED')
      }

      const user = store.users.find((u) => u.id === rt.user_id)
      const session = store.sessions.find((s) => s.id === rt.session_id)
      if (!user || !session || session.revoked_at !== null || user.status !== 'active') {
        throw new ApiError('AUTH_SESSION_REVOKED')
      }

      if (rt.status === 'rotated') {
        const inGrace =
          rt.rotated_at !== null && (now.getTime() - rt.rotated_at.getTime()) / 1000 <= REFRESH_REUSE_GRACE_S
        if (inGrace && rt.successor_raw) {
          const { token, expiresAt } = createAccessToken({
            userId: user.id,
            sessionId: session.id,
            role: user.role,
            tokenVersion: user.token_version,
          })
          setRefreshCookie(req, res, rt.successor_raw)
          return res.json({
            access_token: token,
            expires_at: expiresAt.toISOString(),
            server_time: now.toISOString(),
          })
        }
        // Outside grace: revoke session family
        session.revoked_at = now
        for (const item of store.refreshTokens) {
          if (item.session_id === session.id) item.status = 'revoked'
        }
        throw new ApiError('AUTH_SESSION_REVOKED')
      }

      const newRaw = newRefreshToken()
      const newId = uuid7()
      store.refreshTokens.push({
        id: newId,
        session_id: session.id,
        user_id: user.id,
        token_hash: tokenHash(newRaw),
        status: 'active',
        replaces_id: rt.id,
        expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
        rotated_at: null,
        successor_raw: null,
      })
      rt.status = 'rotated'
      rt.rotated_at = now
      rt.successor_raw = newRaw
      session.last_seen_at = now

      const { token, expiresAt } = createAccessToken({
        userId: user.id,
        sessionId: session.id,
        role: user.role,
        tokenVersion: user.token_version,
      })
      setRefreshCookie(req, res, newRaw)
      return res.json({
        access_token: token,
        expires_at: expiresAt.toISOString(),
        server_time: now.toISOString(),
      })
    }),
  )

  router.post(
    '/v1/auth/logout',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const now = new Date()
      const sess = store.sessions.find((s) => s.id === p.sessionId)
      if (sess) sess.revoked_at = now
      for (const rt of store.refreshTokens) {
        if (rt.session_id === p.sessionId) rt.status = 'revoked'
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'auth.logout',
        entity_type: 'user',
        entity_id: p.id,
        request_id: req.requestId,
      })
      clearRefreshCookie(res)
      return res.json({ ok: true })
    }),
  )

  router.post(
    '/v1/auth/activate',
    wrap((req, res) => {
      const inviteToken = String(req.body?.invite_token ?? '')
      const password = String(req.body?.password ?? '')
      const acceptRules = Boolean(req.body?.accept_rules)
      if (!acceptRules) throw new ApiError('RULES_NOT_ACCEPTED')
      if (password.length < PASSWORD_MIN_LENGTH) {
        throw new ApiError('VALIDATION_ERROR', { password: `Minimum ${PASSWORD_MIN_LENGTH} characters.` })
      }
      const th = tokenHash(inviteToken)
      const now = new Date()
      const inv = store.invites.find((i) => i.token_hash === th)
      if (!inv || inv.used_at !== null || inv.expires_at < now) {
        throw new ApiError(
          'NOT_FOUND',
          {},
          'This invite is invalid or expired. Request a new invite from the organizers.',
        )
      }
      const ev = store.events.find((e) => e.id === inv.event_id)
      const tenantId = ev?.tenant_id ?? store.tenants[0]?.id ?? uuid7()
      const pwHash = hashPassword(password)
      let user = store.users.find((u) => u.email.toLowerCase() === inv.email.toLowerCase())
      if (user) {
        user.password_hash = pwHash
        user.status = 'active'
      } else {
        user = {
          id: uuid7(),
          tenant_id: tenantId,
          email: inv.email.toLowerCase(),
          name: inv.email.split('@')[0],
          role: (inv.role as UserRecord['role']) || 'participant',
          password_hash: pwHash,
          status: 'active',
          token_version: 1,
          created_at: now,
        }
        store.users.push(user)
      }
      inv.used_at = now
      if (inv.team_id && !store.teamMembers.some((m) => m.team_id === inv.team_id && m.user_id === user!.id)) {
        store.teamMembers.push({ id: uuid7(), team_id: inv.team_id, user_id: user.id })
      }
      if (ev && !store.acceptances.some((a) => a.user_id === user!.id && a.rules_version === ev.rules_version)) {
        store.acceptances.push({
          id: uuid7(),
          user_id: user.id,
          rules_version: ev.rules_version,
          ip_hash: ipHash(req.ip),
          created_at: now,
        })
      }
      store.auditWrite({
        actor_id: user.id,
        actor_role: user.role,
        action: 'auth.activated',
        entity_type: 'user',
        entity_id: user.id,
        request_id: req.requestId,
      })
      return res.json({ ok: true, email: inv.email })
    }),
  )

  router.post(
    '/v1/auth/step-up',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const password = String(req.body?.password ?? '')
      const user = store.users.find((u) => u.id === p.id)
      if (!user || !verifyPassword(password, user.password_hash)) {
        rateLimit(`stepup:${p.id}`, 5, 300)
        throw new ApiError('AUTH_INVALID_CREDENTIALS')
      }
      const sess = store.sessions.find((s) => s.id === p.sessionId)
      if (sess) sess.step_up_at = new Date()
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'auth.step_up',
        entity_type: 'user',
        entity_id: p.id,
        request_id: req.requestId,
      })
      return res.json({ ok: true, valid_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
    }),
  )

  router.post(
    '/v1/auth/password/reset-request',
    wrap((req, res) => {
      rateLimit(`reset:${req.ip}`, 3, 600)
      return res.json({ ok: true, message: 'If the address is registered, a reset link has been created.' })
    }),
  )

  router.get(
    '/v1/me',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const tm = store.teamMembers.find((m) => m.user_id === p.id)
      const team = tm ? store.teams.find((t) => t.id === tm.team_id) : undefined
      const teamEvent = team ? store.events.find((e) => e.id === team.event_id) : undefined
      const currentEvent = [...store.events]
        .reverse()
        .find((e) => ['ready', 'live', 'closed', 'finalized'].includes(e.status))
      const accepted = currentEvent
        ? store.acceptances.some((a) => a.user_id === p.id && a.rules_version === currentEvent.rules_version)
        : false

      return res.json({
        id: p.id,
        email: p.email,
        name: p.name,
        role: p.role,
        status: p.status,
        team:
          team && teamEvent
            ? {
                id: team.id,
                name: team.name,
                join_code: team.join_code,
                event_id: teamEvent.id,
                slug: teamEvent.slug,
                event_status: teamEvent.status,
              }
            : null,
        rules_accepted: accepted,
        rules_version: currentEvent ? currentEvent.rules_version : null,
      })
    }),
  )

  router.get(
    '/v1/me/sessions',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const rows = store.sessions
        .filter((s) => s.user_id === p.id && s.revoked_at === null)
        .sort((a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime())
      return res.json(
        rows.map((r) => ({
          id: r.id,
          created_at: r.created_at.toISOString(),
          last_seen_at: r.last_seen_at.toISOString(),
          device: r.user_agent.slice(0, 80),
        })),
      )
    }),
  )

  router.delete(
    '/v1/me/sessions/:sessionId',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const sid = String(req.params.sessionId)
      const sess = store.sessions.find((s) => s.id === sid && s.user_id === p.id)
      if (sess) {
        sess.revoked_at = new Date()
        for (const rt of store.refreshTokens) {
          if (rt.session_id === sid) rt.status = 'revoked'
        }
      }
      return res.json({ ok: true })
    }),
  )

  router.post(
    '/v1/me/acceptances',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const ev = [...store.events]
        .reverse()
        .find((e) => ['ready', 'live', 'closed', 'finalized'].includes(e.status))
      if (!ev) throw new ApiError('NOT_FOUND', {}, 'No published event found.')
      const version = Number(req.body?.version ?? ev.rules_version)
      if (!store.acceptances.some((a) => a.user_id === p.id && a.rules_version === version)) {
        store.acceptances.push({
          id: uuid7(),
          user_id: p.id,
          rules_version: version,
          ip_hash: ipHash(req.ip),
          created_at: new Date(),
        })
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'rules.accepted',
        entity_type: 'event',
        entity_id: ev.id,
        request_id: req.requestId,
        details: { version },
      })
      return res.json({ ok: true, rules_version: version })
    }),
  )

  // --- state & config ---
  router.get(
    '/v1/state',
    wrap((req, res) => {
      const p = requireRole('participant', 'reviewer', 'organizer', 'admin')(req)
      const stage = latestPublishedStage()
      const now = new Date()
      if (!stage) {
        return res.json({
          server_time: now.toISOString(),
          round: null,
          announcements_version: 0,
          leaderboard_visibility: 'hidden',
        })
      }
      const ev = store.events.find((e) => e.id === stage.event_id)!
      const effEnd = effectiveEnd(stage, p.id)
      const annCount = store.announcements.filter((a) => a.event_id === ev.id).length
      const snaps = store.leaderboardSnapshots.filter((s) => s.stage_id === stage.id)
      const maxLbVer = snaps.reduce((m, s) => Math.max(m, s.version), 0)
      const lbVis = snaps.length > 0 ? snaps[snaps.length - 1].visibility : 'hidden'

      return res.json({
        server_time: now.toISOString(),
        round: {
          id: stage.id,
          name: stage.name,
          kind: stage.kind,
          status: stage.status,
          event_status: ev.status,
          starts_at: stage.starts_at ? stage.starts_at.toISOString() : null,
          ends_at_effective: effEnd ? effEnd.toISOString() : null,
          grace_seconds: stage.grace_seconds,
          paused: stage.status === 'paused',
        },
        rules_version: ev.rules_version,
        announcements_version: annCount,
        leaderboard_version: maxLbVer,
        leaderboard_visibility: lbVis,
      })
    }),
  )

  router.get(
    '/v1/config',
    wrap((req, res) => {
      requireRole('participant', 'reviewer', 'organizer', 'admin')(req)
      const stage = latestPublishedStage()
      if (!stage) throw new ApiError('NOT_FOUND', {}, 'No active stage configured yet.')
      const ev = store.events.find((e) => e.id === stage.event_id)!
      const evCfg = ev.config as Record<string, unknown>
      const stCfg = stage.config as Record<string, unknown>
      const features = (evCfg.features ?? {}) as Record<string, unknown>
      const scoring = (evCfg.scoring ?? {}) as Record<string, unknown>
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
        'schedule',
      ]
      const limits: Record<string, unknown> = {}
      for (const k of safeKeys) {
        if (stCfg[k] !== undefined) limits[k] = stCfg[k]
      }
      return res.json({
        stage_id: stage.id,
        grace_seconds: stage.grace_seconds,
        runner_enabled: Boolean(features.runner_enabled ?? false),
        ai_assessment_enabled: Boolean(features.ai_assessment_enabled ?? false),
        scoring_weights: scoring.weights ?? {},
        ctf_bonus_cap_points: scoring.ctf_bonus_cap_points ?? null,
        limits,
        schedule: evCfg.schedule ?? [],
      })
    }),
  )

  router.get(
    '/v1/announcements',
    wrap((req, res) => {
      getPrincipal(req)
      const limit = Math.min(Number(req.query.limit ?? 50), 100)
      const rows = [...store.announcements]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit)
      return res.json({
        announcements: rows.map((a) => {
          const author = store.users.find((u) => u.id === a.created_by)
          return {
            id: a.id,
            severity: a.severity,
            audience: a.audience,
            body: a.body,
            author: author?.name ?? 'Organizer',
            created_at: a.created_at.toISOString(),
          }
        }),
      })
    }),
  )

  // --- challenges ---
  function requireReleasedStage(): StageRecord {
    const stage = latestPublishedStage()
    if (!stage) throw new ApiError('NOT_FOUND', {}, 'No stage configured.')
    if (!['armed', 'active', 'paused', 'ended', 'evaluating', 'released', 'final'].includes(stage.status)) {
      throw new ApiError('ROUND_NOT_ACTIVE', {}, 'Challenge materials are not released yet.')
    }
    return stage
  }

  router.get(
    '/v1/assignments',
    wrap((req, res) => {
      const p = getPrincipal(req)
      rateLimit(`assign:${p.id}`, 30, 60)
      const teamId = participantTeamId(p.id)
      const stage = requireReleasedStage()
      const found = assignedChallenge(stage.id, teamId)
      if (!found) return res.json({ assignments: [], message: 'No challenge assigned yet.' })
      const files = store.challengeFiles
        .filter((f) => f.challenge_version_id === found.cv.id)
        .sort((a, b) => a.path.localeCompare(b.path))
      return res.json({
        assignments: [
          {
            challenge_id: found.cv.id,
            slug: found.cv.slug,
            title: found.cv.title,
            version: found.cv.version,
            instructions_markdown: found.cv.instructions_md,
            repo_url: found.asg.repo_url,
            codespace_url: found.asg.codespace_url,
            stage_id: stage.id,
            stage_status: stage.status,
            files: files.map((f) => ({
              path: f.path,
              lang: f.lang,
              size_bytes: f.size_bytes,
              line_count: f.line_count,
            })),
          },
        ],
      })
    }),
  )

  router.get(
    '/v1/challenges/:challengeId/files/content',
    wrap((req, res) => {
      const p = getPrincipal(req)
      requireRulesAccepted(p)
      rateLimit(`file:${p.id}`, 120, 60)
      const challengeId = String(req.params.challengeId)
      const rawPath = String(req.query.path ?? '')
      if (!rawPath || rawPath.length > 500 || rawPath.includes('\x00') || path.isAbsolute(rawPath)) {
        throw new ApiError('PATH_INVALID')
      }
      const norm = path.posix.normalize(rawPath.replace(/\\/g, '/'))
      if (norm.startsWith('..') || path.posix.isAbsolute(norm)) {
        throw new ApiError('PATH_INVALID')
      }
      const teamId = participantTeamId(p.id)
      const stage = requireReleasedStage()
      const found = assignedChallenge(stage.id, teamId)
      if (!found || found.cv.id !== challengeId) {
        throw new ApiError('FILE_NOT_FOUND')
      }
      const f = store.challengeFiles.find((cf) => cf.challenge_version_id === challengeId && cf.path === norm)
      if (!f || f.size_bytes > 512 * 1024) {
        throw new ApiError('FILE_NOT_FOUND')
      }
      return res.json({
        path: f.path,
        lang: f.lang,
        content: f.content,
        line_count: f.line_count,
        sha256: f.sha256,
      })
    }),
  )

  router.get(
    '/v1/challenges/:challengeId/search',
    wrap((req, res) => {
      const p = getPrincipal(req)
      requireRulesAccepted(p)
      rateLimit(`search:${p.id}`, 30, 60)
      const challengeId = String(req.params.challengeId)
      const q = String(req.query.q ?? '')
      if (q.length < 2 || q.length > 100) {
        throw new ApiError('VALIDATION_ERROR', { q: '2..100 characters' })
      }
      const teamId = participantTeamId(p.id)
      const stage = requireReleasedStage()
      const found = assignedChallenge(stage.id, teamId)
      if (!found || found.cv.id !== challengeId) throw new ApiError('FILE_NOT_FOUND')
      const needle = q.toLowerCase()
      const results = store.challengeFileLines
        .filter((l) => l.challenge_version_id === challengeId && l.line_text.toLowerCase().includes(needle))
        .slice(0, 50)
        .map((r) => ({ path: r.path, line_number: r.line_number, text: r.line_text.slice(0, 200) }))
      return res.json({ results })
    }),
  )

  // --- drafts ---
  router.get(
    '/v1/drafts/:challengeId',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      const challengeId = String(req.params.challengeId)
      const d = store.drafts.find((dr) => dr.author_id === p.id && dr.challenge_version_id === challengeId)
      if (!d) return res.json({ payload: {}, version: 0, updated_at: null })
      return res.json({ payload: d.payload, version: d.version, updated_at: d.updated_at.toISOString() })
    }),
  )

  router.put(
    '/v1/drafts/:challengeId',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      const challengeId = String(req.params.challengeId)
      const payload = (req.body?.payload ?? {}) as Record<string, unknown>
      const version = req.body?.version as number | undefined
      const existing = store.drafts.find((dr) => dr.author_id === p.id && dr.challenge_version_id === challengeId)
      if (!existing) {
        store.drafts.push({
          id: uuid7(),
          author_id: p.id,
          challenge_version_id: challengeId,
          payload,
          version: 1,
          updated_at: new Date(),
        })
        return res.json({ version: 1 })
      }
      if (version !== undefined && version !== null && Number(version) !== existing.version) {
        throw new ApiError('DRAFT_VERSION_CONFLICT')
      }
      existing.payload = payload
      existing.version += 1
      existing.updated_at = new Date()
      return res.json({ version: existing.version })
    }),
  )

  // --- submissions ---
  router.post(
    '/v1/submissions',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      requireRulesAccepted(p)
      rateLimit(`submit:${p.id}`, 30, 60)

      const idemKey = String(req.headers['idempotency-key'] ?? '')
      if (idemKey.length < 8 || idemKey.length > 80) {
        throw new ApiError('VALIDATION_ERROR', { 'Idempotency-Key': 'Required, 8..80 characters.' })
      }

      const body = (req.body ?? {}) as Record<string, unknown>
      const kind = body.kind === 'ctf_flag' ? 'ctf_flag' : body.kind === 'bug_report' || !body.kind ? 'bug_report' : null
      if (!kind) throw new ApiError('SUBMISSION_INVALID', { kind: 'bug_report or ctf_flag' })

      const payloadHash = canonicalPayloadHash(body)
      const tm = store.teamMembers.find((m) => m.user_id === p.id)
      const team = tm ? store.teams.find((t) => t.id === tm.team_id) : undefined
      if (!team) throw new ApiError('AUTH_FORBIDDEN', {}, 'You are not assigned to a team for this event.')
      if (team.status !== 'active') throw new ApiError('AUTH_FORBIDDEN', {}, 'This team cannot submit.')

      const existing = store.submissions.find((s) => s.author_id === p.id && s.idempotency_key === idemKey)
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw new ApiError('IDEMPOTENCY_CONFLICT')
        return res.status(202).json({
          submission_id: existing.id,
          receipt_code: existing.receipt_code,
          received_at: existing.received_at.toISOString(),
          status: 'received',
          replay: true,
          team_id: team.id,
        })
      }

      const stage = [...store.stages]
        .filter((st) => st.event_id === team.event_id)
        .sort((a, b) => b.ordinal - a.ordinal)[0]
      if (!stage) throw new ApiError('ROUND_NOT_ACTIVE')

      const now = new Date()
      const effEnd = effectiveEnd(stage, p.id)
      const graceMs = (stage.grace_seconds || 0) * 1000

      if (stage.status === 'paused') throw new ApiError('ROUND_PAUSED')
      if (stage.status !== 'active') {
        if (['ended', 'evaluating', 'released', 'final'].includes(stage.status)) {
          throw new ApiError('ROUND_ENDED')
        }
        throw new ApiError('ROUND_NOT_ACTIVE')
      }
      if (effEnd && now.getTime() > effEnd.getTime() + graceMs) {
        throw new ApiError('ROUND_ENDED')
      }

      const cfg = stage.config as Record<string, unknown>
      const filePath = body.file_path ? String(body.file_path) : null
      const lineStart = body.line_start !== undefined && body.line_start !== null ? Number(body.line_start) : null
      const lineEnd = body.line_end !== undefined && body.line_end !== null ? Number(body.line_end) : null
      const category = body.category ? String(body.category) : null
      const title = body.title ? String(body.title) : null
      const description = body.description ? String(body.description) : null
      const flagCode = body.flag_code ? String(body.flag_code) : null

      if (kind === 'bug_report') {
        if (!title || title.trim().length < 5) {
          throw new ApiError('SUBMISSION_INVALID', { title: 'Required, 5-120 characters.' })
        }
        if (!filePath) throw new ApiError('SUBMISSION_INVALID', { file_path: 'Target file is required.' })
        if (!lineStart || !lineEnd || lineStart > lineEnd) {
          throw new ApiError('SUBMISSION_INVALID', { line_start: 'Line range is invalid.' })
        }
        const maxSpan = Number(cfg.max_span ?? 25)
        if (lineEnd - lineStart + 1 > maxSpan) {
          throw new ApiError('SUBMISSION_INVALID', { line_range: `Span exceeds ${maxSpan} lines.` })
        }
        if (!description || description.trim().length < 20) {
          throw new ApiError('SUBMISSION_INVALID', { description: 'Required, at least 20 characters.' })
        }
        if (!category || !VALID_CATEGORIES.has(category)) {
          throw new ApiError('SUBMISSION_INVALID', { category: 'Category must come from the taxonomy.' })
        }
      } else {
        if (!flagCode || flagCode.trim().length < 4) {
          throw new ApiError('SUBMISSION_INVALID', { flag_code: 'Flag codes are at least 4 characters.' })
        }
      }

      const found = assignedChallenge(stage.id, team.id)
      if (!found) {
        throw new ApiError('SUBMISSION_INVALID', { challenge: 'No challenge assigned to your team.' })
      }

      if (kind === 'bug_report') {
        const fileExists = store.challengeFiles.some(
          (cf) => cf.challenge_version_id === found.cv.id && cf.path === filePath,
        )
        if (!fileExists) throw new ApiError('FILE_NOT_FOUND')

        const maxPerFile = Number(cfg.max_reports_per_file ?? 12)
        const perFile = store.submissions.filter(
          (s) =>
            s.stage_id === stage.id &&
            s.author_id === p.id &&
            s.kind === 'bug_report' &&
            s.file_path === filePath &&
            s.status !== 'rejected_auto',
        ).length
        if (perFile >= maxPerFile) {
          throw new ApiError('SUBMISSION_CAP_REACHED', { file: filePath, limit: maxPerFile })
        }

        const maxPerRound = Number(cfg.max_reports_per_round ?? 80)
        const perRound = store.submissions.filter(
          (s) => s.stage_id === stage.id && s.author_id === p.id && s.kind === 'bug_report',
        ).length
        if (perRound >= maxPerRound) {
          throw new ApiError('SUBMISSION_CAP_REACHED', { round: true, limit: maxPerRound })
        }

        const cooldown = Number(cfg.file_cooldown_s ?? 20)
        if (cooldown > 0) {
          const last = [...store.submissions]
            .filter(
              (s) => s.stage_id === stage.id && s.author_id === p.id && s.kind === 'bug_report' && s.file_path === filePath,
            )
            .sort((a, b) => b.received_at.getTime() - a.received_at.getTime())[0]
          if (last) {
            const since = (now.getTime() - last.received_at.getTime()) / 1000
            if (since < cooldown) {
              throw new ApiError('SUBMISSION_COOLDOWN', { n: Math.ceil(cooldown - since) })
            }
          }
        }
      }

      const ev = store.events.find((e) => e.id === team.event_id)!
      const subId = uuid7()
      const receipt = receiptCode(subId, now.toISOString())
      store.submissions.push({
        id: subId,
        tenant_id: ev.tenant_id,
        event_id: ev.id,
        stage_id: stage.id,
        challenge_version_id: found.cv.id,
        team_id: team.id,
        author_id: p.id,
        kind,
        idempotency_key: idemKey,
        payload: body,
        payload_hash: payloadHash,
        status: 'received',
        receipt_code: receipt,
        title: (title || (kind === 'ctf_flag' ? 'Flag submission' : 'Report')).slice(0, 160),
        file_path: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        category,
        flag_code: flagCode,
        received_at: now,
        feedback_released: false,
        matched_bug_code: null,
        points_visible: null,
      })

      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'submission.created',
        entity_type: 'submission',
        entity_id: subId,
        request_id: req.requestId,
        details: { kind, receipt },
        event_scope: `event:${ev.id}`,
      })

      // Inline evaluation (replaces PostgreSQL worker queue)
      store.evaluateSubmission(subId)

      return res.status(202).json({
        submission_id: subId,
        receipt_code: receipt,
        received_at: now.toISOString(),
        status: 'received',
        replay: false,
        team_id: team.id,
      })
    }),
  )

  router.get(
    '/v1/submissions',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      const rows = store.submissions
        .filter((s) => s.author_id === p.id)
        .sort((a, b) => b.received_at.getTime() - a.received_at.getTime())
        .slice(0, 200)
      return res.json({
        submissions: rows.map((r) => {
          const coarse = ['received', 'matched_auto', 'needs_review', 'in_review', 'decided', 'ledgered'].includes(
            r.status,
          )
            ? 'received'
            : r.status
          const item: Record<string, unknown> = {
            id: r.id,
            kind: r.kind,
            title: r.title,
            file_path: r.file_path,
            line_start: r.line_start,
            line_end: r.line_end,
            category: r.category,
            receipt_code: r.receipt_code,
            received_at: r.received_at.toISOString(),
            flag_code: r.kind === 'ctf_flag' ? r.flag_code : null,
            status: r.feedback_released ? r.status : coarse,
          }
          if (r.feedback_released) {
            item.matched_bug_code = r.matched_bug_code
            item.points_visible = r.points_visible ?? 0
          }
          return item
        }),
      })
    }),
  )

  router.get(
    '/v1/submissions/:submissionId',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      const sid = String(req.params.submissionId)
      const r = store.submissions.find((s) => s.id === sid && s.author_id === p.id)
      if (!r) throw new ApiError('NOT_FOUND')
      return res.json({
        id: r.id,
        kind: r.kind,
        title: r.title,
        file_path: r.file_path,
        line_start: r.line_start,
        line_end: r.line_end,
        category: r.category,
        receipt_code: r.receipt_code,
        received_at: r.received_at.toISOString(),
        payload: r.payload,
        released: r.feedback_released,
        matched_bug_code: r.feedback_released ? r.matched_bug_code : null,
        points: r.feedback_released ? (r.points_visible ?? 0) : null,
        status: r.feedback_released ? r.status : 'received',
      })
    }),
  )

  router.post(
    '/v1/submissions/:submissionId/dispute',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      const sid = String(req.params.submissionId)
      const statement = String(req.body?.statement ?? '')
      if (statement.length < 10 || statement.length > 1000) {
        throw new ApiError('VALIDATION_ERROR', { statement: '10..1000 characters' })
      }
      const r = store.submissions.find((s) => s.id === sid && s.author_id === p.id)
      if (!r) throw new ApiError('NOT_FOUND')
      if (!r.feedback_released) {
        throw new ApiError('VALIDATION_ERROR', { dispute: 'Disputes open after results are released.' })
      }
      store.disputes.push({
        id: uuid7(),
        submission_id: r.id,
        team_id: r.team_id,
        statement,
        status: 'open',
        resolution: null,
        resolved_by: null,
        resolved_at: null,
        created_at: new Date(),
      })
      r.status = 'disputed'
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'dispute.created',
        entity_type: 'submission',
        entity_id: r.id,
        request_id: req.requestId,
      })
      return res.status(201).json({ ok: true })
    }),
  )

  // --- leaderboard & results ---
  router.get(
    '/v1/leaderboard/:stageId',
    wrap((req, res) => {
      const p = getPrincipal(req)
      const stageId = String(req.params.stageId)
      const stage = store.stages.find((s) => s.id === stageId)
      if (!stage) throw new ApiError('NOT_FOUND')
      const cfg = stage.config as Record<string, unknown>
      const mode = String(cfg.leaderboard_mode ?? 'hidden')
      const released = ['released', 'final'].includes(stage.status)
      if (mode === 'hidden' && p.role === 'participant' && !released) {
        return res.json({ visible: false, message: 'The leaderboard is hidden for this round.' })
      }
      const delayS = Number(cfg.leaderboard_delay_s ?? 600)
      const cutoff = new Date(Date.now() - (mode === 'frozen' ? delayS * 1000 : 0))
      const snap = [...store.leaderboardSnapshots]
        .filter((s) => s.stage_id === stageId && s.created_at <= cutoff)
        .sort((a, b) => b.version - a.version)[0]
      if (!snap) return res.json({ visible: true, snapshot: null, message: 'No results published yet.' })
      return res.json({
        visible: true,
        version: snap.version,
        snapshot: snap.payload,
        generated_at: snap.created_at.toISOString(),
      })
    }),
  )

  router.get(
    '/v1/results/:stageId',
    wrap((req, res) => {
      const p = requireRole('participant')(req)
      const stageId = String(req.params.stageId)
      const released = store.submissions.some((s) => s.stage_id === stageId && s.feedback_released)
      if (!released) return res.json({ released: false, message: 'Results are not released yet.' })
      const teamId = participantTeamId(p.id)
      if (!teamId) throw new ApiError('AUTH_FORBIDDEN', {}, 'No team membership found.')

      const rows = store.scoreLedgerEntries
        .filter((l) => l.stage_id === stageId && l.team_id === teamId)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())

      const byComponent: Record<string, number> = {}
      let penalties = 0
      const items = rows.map((r) => {
        const sub = r.submission_id ? store.submissions.find((s) => s.id === r.submission_id) : undefined
        if (r.kind === 'penalty') penalties += r.points
        byComponent[r.component] = (byComponent[r.component] ?? 0) + r.points
        return {
          component: r.component,
          kind: r.kind,
          points: r.points,
          reason_code: r.reason_code,
          title: sub?.title ?? null,
          receipt_code: sub?.receipt_code ?? null,
          matched_bug_code: sub?.matched_bug_code ?? null,
          received_at: sub ? sub.received_at.toISOString() : null,
        }
      })
      const total = Object.values(byComponent).reduce((s, v) => s + v, 0) + penalties
      const roundedByComp: Record<string, number> = {}
      for (const [k, v] of Object.entries(byComponent)) {
        roundedByComp[k] = Math.round(v * 100) / 100
      }
      return res.json({
        released: true,
        total: Math.round(total * 100) / 100,
        by_component: roundedByComp,
        penalties: Math.round(penalties * 100) / 100,
        entries: items,
      })
    }),
  )

  // --- reviewer ---
  router.get(
    '/v1/review/queue',
    wrap((req, res) => {
      const p = requireRole('reviewer', 'organizer', 'admin')(req)
      const items = store.reviewItems
        .filter((ri) => ri.status === 'open' || ri.status === 'claimed')
        .sort((a, b) => a.priority - b.priority || a.created_at.getTime() - b.created_at.getTime())
        .slice(0, 200)
        .map((ri) => {
          const s = store.submissions.find((sub) => sub.id === ri.submission_id)!
          return {
            review_item_id: ri.id,
            submission_id: s.id,
            kind: s.kind,
            title: s.title,
            file_path: s.file_path,
            line_range: [s.line_start, s.line_end],
            category: s.category,
            received_at: s.received_at.toISOString(),
            priority: ri.priority,
            status: ri.status,
            claimed_by_me: ri.claimed_by !== null && ri.claimed_by === p.id,
          }
        })
      return res.json({ queue: items })
    }),
  )

  router.post(
    '/v1/review/items/:itemId/claim',
    wrap((req, res) => {
      const p = requireRole('reviewer', 'organizer', 'admin')(req)
      const itemId = String(req.params.itemId)
      const ri = store.reviewItems.find((r) => r.id === itemId)
      if (!ri) throw new ApiError('NOT_FOUND')
      if (ri.status === 'decided') throw new ApiError('VALIDATION_ERROR', { claim: 'Item already decided.' })
      if (
        ri.status === 'claimed' &&
        ri.claimed_by &&
        ri.claimed_by !== p.id &&
        ri.claimed_at &&
        Date.now() - ri.claimed_at.getTime() < 10 * 60 * 1000
      ) {
        throw new ApiError('VALIDATION_ERROR', { claim: 'Claimed by another reviewer.' })
      }
      ri.status = 'claimed'
      ri.claimed_by = p.id
      ri.claimed_at = new Date()
      const sub = store.submissions.find((s) => s.id === ri.submission_id)
      if (sub) sub.status = 'in_review'
      return res.json({ ok: true })
    }),
  )

  router.get(
    '/v1/review/items/:itemId',
    wrap((req, res) => {
      requireRole('reviewer', 'organizer', 'admin')(req)
      const itemId = String(req.params.itemId)
      const ri = store.reviewItems.find((r) => r.id === itemId)
      if (!ri) throw new ApiError('NOT_FOUND')
      const sub = store.submissions.find((s) => s.id === ri.submission_id)
      if (!sub) throw new ApiError('NOT_FOUND')
      let fileContent: { content: string; lang: string; line_count: number } | null = null
      if (sub.file_path) {
        const cf = store.challengeFiles.find(
          (f) => f.challenge_version_id === sub.challenge_version_id && f.path === sub.file_path,
        )
        if (cf) fileContent = { content: cf.content, lang: cf.lang, line_count: cf.line_count }
      }
      const history = store.submissions.filter((s) => s.team_id === sub.team_id && s.kind === 'bug_report').length
      return res.json({
        review_item_id: ri.id,
        status: ri.status,
        submission: {
          id: sub.id,
          kind: sub.kind,
          title: sub.title,
          payload: sub.payload,
          file_path: sub.file_path,
          line_start: sub.line_start,
          line_end: sub.line_end,
          category: sub.category,
          received_at: sub.received_at.toISOString(),
          receipt_code: sub.receipt_code,
          flag_code: sub.flag_code,
          status: sub.status,
        },
        file: fileContent,
        team_total_reports: history,
      })
    }),
  )

  router.post(
    '/v1/review/items/:itemId/decision',
    wrap((req, res) => {
      const p = requireRole('reviewer', 'organizer', 'admin')(req)
      const itemId = String(req.params.itemId)
      const decision = String(req.body?.decision ?? '')
      const valid = ['accept_full', 'accept_partial', 'duplicate', 'reject_invalid', 'unplanned_valid', 'needs_second_review']
      if (!valid.includes(decision)) throw new ApiError('VALIDATION_ERROR', { decision: 'Invalid decision.' })
      const ri = store.reviewItems.find((r) => r.id === itemId)
      if (!ri) throw new ApiError('NOT_FOUND')
      if (ri.status === 'decided') throw new ApiError('VALIDATION_ERROR', { decision: 'Already decided.' })
      if (ri.status === 'claimed' && ri.claimed_by && ri.claimed_by !== p.id) {
        throw new ApiError('AUTH_FORBIDDEN', {}, 'Claim this item before deciding.')
      }
      const rubric = (req.body?.rubric ?? {}) as Record<string, number>
      const notes = req.body?.notes ? String(req.body.notes).slice(0, 2000) : null
      const subStatusMap: Record<string, string> = {
        accept_full: 'decided',
        accept_partial: 'decided',
        duplicate: 'duplicate',
        reject_invalid: 'rejected_auto',
        unplanned_valid: 'needs_review',
        needs_second_review: 'in_review',
      }
      const reviewId = uuid7()
      store.reviews.push({
        id: reviewId,
        submission_id: ri.submission_id,
        reviewer_id: p.id,
        decision,
        rubric,
        quality: decision === 'accept_full' ? 1.0 : decision === 'accept_partial' ? 0.5 : 0.0,
        notes,
        created_at: new Date(),
      })
      ri.status = 'decided'
      const sub = store.submissions.find((s) => s.id === ri.submission_id)
      if (sub) sub.status = subStatusMap[decision]
      store.applyReviewOutcome(ri.submission_id, reviewId, decision)
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'review.decided',
        entity_type: 'submission',
        entity_id: ri.submission_id,
        request_id: req.requestId,
        details: { decision },
        event_scope: 'review',
      })
      return res.json({ ok: true, decision })
    }),
  )

  // --- admin / organizer ---
  router.get(
    '/v1/admin/events',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      const events = [...store.events]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .map((e) => ({
          id: e.id,
          slug: e.slug,
          name: e.name,
          status: e.status,
          starts_at: e.starts_at ? e.starts_at.toISOString() : null,
          ends_at: e.ends_at ? e.ends_at.toISOString() : null,
          timezone: e.timezone,
          max_participants: e.max_participants,
          max_teams: e.max_teams,
          rules_version: e.rules_version,
          config_version: e.config_version,
        }))
      return res.json({ events })
    }),
  )

  router.post(
    '/v1/admin/events',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const name = String(req.body?.name ?? '').trim()
      const slug = String(req.body?.slug ?? '').trim()
      if (name.length < 3 || !/^[a-z0-9-]+$/.test(slug)) {
        throw new ApiError('VALIDATION_ERROR', { event: 'Valid name and slug required.' })
      }
      const tenant = store.tenants[0]
      if (!tenant) throw new ApiError('VALIDATION_ERROR', { tenant: 'No tenant exists.' })
      const evId = uuid7()
      store.events.push({
        id: evId,
        tenant_id: tenant.id,
        slug,
        name,
        status: 'draft',
        starts_at: null,
        ends_at: null,
        timezone: String(req.body?.timezone ?? 'Asia/Kolkata'),
        duration_minutes: Number(req.body?.duration_minutes ?? 180),
        max_participants: Number(req.body?.max_participants ?? 50),
        max_teams: Number(req.body?.max_teams ?? 12),
        rules_version: 1,
        config_version: 1,
        config: {
          features: { runner_enabled: false, ai_assessment_enabled: false },
          scoring: { weights: { functional_test: 0.5, code_review: 0.3, evidence_report: 0.2 }, ctf_bonus_cap_points: 100 },
          public_summary: {},
        },
        created_at: new Date(),
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'event.created',
        entity_type: 'event',
        entity_id: evId,
        request_id: req.requestId,
      })
      return res.status(201).json({ event_id: evId })
    }),
  )

  const EVENT_TRANSITIONS: Record<string, string[]> = {
    draft: ['configured'],
    configured: ['ready', 'draft'],
    ready: ['live'],
    live: ['closed'],
    closed: ['finalized'],
    finalized: ['archived'],
  }

  router.post(
    '/v1/admin/events/:eventId/status',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const target = String(req.body?.status ?? '')
      const ev = store.events.find((e) => e.id === eventId)
      if (!ev) throw new ApiError('NOT_FOUND')
      if (!(EVENT_TRANSITIONS[ev.status] ?? []).includes(target)) {
        throw new ApiError('VALIDATION_ERROR', { transition: `Cannot move from ${ev.status} to ${target}.` })
      }
      if (target === 'live') {
        const pending = store.readinessItems.filter((r) => r.event_id === eventId && r.state === 'unchecked').length
        if (pending > 0) {
          throw new ApiError('VALIDATION_ERROR', { readiness: `${pending} readiness items are unchecked.` })
        }
        const now = new Date()
        ev.starts_at = ev.starts_at ?? now
        ev.ends_at = new Date(now.getTime() + ev.duration_minutes * 60 * 1000)
      }
      const from = ev.status
      ev.status = target
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'event.status_changed',
        entity_type: 'event',
        entity_id: eventId,
        request_id: req.requestId,
        details: { from, to: target },
      })
      return res.json({ ok: true, status: target })
    }),
  )

  router.post(
    '/v1/admin/events/:eventId/stages',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const cfg = { ...DEFAULT_STAGE_CONFIG, ...((req.body?.config as Record<string, unknown>) ?? {}) }
      const rsh = 'sha256:' + sha256Hex(canonicalJson(cfg))
      const ord = store.stages.filter((s) => s.event_id === eventId).reduce((m, s) => Math.max(m, s.ordinal), 0)
      const stId = uuid7()
      store.stages.push({
        id: stId,
        event_id: eventId,
        name: String(req.body?.name ?? 'Main Stage'),
        kind: String(req.body?.kind ?? 'main'),
        ordinal: ord + 1,
        status: 'draft',
        starts_at: null,
        started_at: null,
        ends_at: null,
        ended_at: null,
        grace_seconds: Number(req.body?.grace_seconds ?? 3),
        config: cfg,
        rule_set_hash: rsh,
        created_at: new Date(),
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'stage.created',
        entity_type: 'stage',
        entity_id: stId,
        request_id: req.requestId,
        details: { rule_set_hash: rsh },
      })
      return res.status(201).json({ stage_id: stId, rule_set_hash: rsh })
    }),
  )

  router.post(
    '/v1/admin/stages/:stageId/control',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const stageId = String(req.params.stageId)
      const action = String(req.body?.action ?? '')
      const reason = String(req.body?.reason ?? '')
      if (!reason) throw new ApiError('VALIDATION_ERROR', { reason: 'A reason code is required for stage control.' })
      const st = store.stages.find((s) => s.id === stageId)
      if (!st) throw new ApiError('NOT_FOUND')
      const ev = store.events.find((e) => e.id === st.event_id)!
      const now = new Date()
      const prevStatus = st.status

      if (action === 'seal') {
        if (st.status !== 'draft') throw new ApiError('VALIDATION_ERROR', { transition: `Cannot seal from ${st.status}.` })
        st.status = 'sealed'
      } else if (action === 'arm') {
        if (st.status !== 'sealed') throw new ApiError('VALIDATION_ERROR', { transition: `Cannot arm from ${st.status}.` })
        st.status = 'armed'
      } else if (action === 'start') {
        if (st.status !== 'armed') {
          throw new ApiError('VALIDATION_ERROR', { transition: `Arm the stage first (status is ${st.status}).` })
        }
        st.status = 'active'
        st.started_at = now
        st.starts_at = st.starts_at ?? now
        st.ends_at = new Date(now.getTime() + ev.duration_minutes * 60 * 1000)
      } else if (action === 'pause') {
        if (st.status !== 'active') throw new ApiError('VALIDATION_ERROR', { transition: 'Only an active stage can pause.' })
        st.status = 'paused'
      } else if (action === 'resume') {
        if (st.status !== 'paused') throw new ApiError('VALIDATION_ERROR', { transition: 'Only a paused stage can resume.' })
        const pausedTrans = [...store.stageTransitions]
          .reverse()
          .find((t) => t.stage_id === stageId && t.to_status === 'pause')
        if (pausedTrans && st.ends_at) {
          const elapsedMs = Math.min(7200_000, Math.max(0, now.getTime() - pausedTrans.created_at.getTime()))
          st.ends_at = new Date(st.ends_at.getTime() + elapsedMs)
        }
        st.status = 'active'
      } else if (action === 'extend') {
        const seconds = Number(req.body?.seconds ?? 0)
        if (seconds <= 0 || seconds > 3600) throw new ApiError('VALIDATION_ERROR', { seconds: '1..3600' })
        if (st.ends_at) st.ends_at = new Date(st.ends_at.getTime() + seconds * 1000)
      } else if (action === 'end') {
        if (st.status !== 'active' && st.status !== 'paused') {
          throw new ApiError('VALIDATION_ERROR', { transition: 'Only an active or paused stage can end.' })
        }
        st.status = 'ended'
        st.ended_at = now
      } else {
        throw new ApiError('VALIDATION_ERROR', { action: 'Unknown action.' })
      }

      store.stageTransitions.push({
        id: uuid7(),
        stage_id: stageId,
        from_status: prevStatus,
        to_status: action,
        actor_id: p.id,
        reason_code: reason,
        created_at: now,
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: `stage.${action}`,
        entity_type: 'stage',
        entity_id: stageId,
        request_id: req.requestId,
        details: { reason },
      })
      return res.json({ ok: true, action })
    }),
  )

  router.post(
    '/v1/admin/stages/:stageId/release',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const stageId = String(req.params.stageId)
      const action = String(req.body?.action ?? 'release')
      const reason = String(req.body?.reason ?? 'results release')
      const st = store.stages.find((s) => s.id === stageId)
      if (!st) throw new ApiError('NOT_FOUND')
      if (action === 'evaluate' && st.status !== 'ended') {
        throw new ApiError('VALIDATION_ERROR', { transition: 'Stage must be ended first.' })
      }
      if (action === 'release' && !['ended', 'evaluating'].includes(st.status)) {
        throw new ApiError('VALIDATION_ERROR', { transition: `Cannot release from ${st.status}.` })
      }
      if (action === 'evaluate') {
        st.status = 'evaluating'
        store.releaseFeedback(stageId)
      } else if (action === 'release') {
        st.status = 'released'
        store.releaseFeedback(stageId)
        store.refreshLeaderboard(stageId, 'public')
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: `stage.${action}`,
        entity_type: 'stage',
        entity_id: stageId,
        request_id: req.requestId,
        details: { reason },
      })
      return res.json({ ok: true })
    }),
  )

  router.post(
    '/v1/admin/events/:eventId/teams',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const name = String(req.body?.name ?? '').trim()
      if (name.length < 2) throw new ApiError('VALIDATION_ERROR', { name: 'Team name required.' })
      const ev = store.events.find((e) => e.id === eventId)
      if (!ev) throw new ApiError('NOT_FOUND')
      const count = store.teams.filter((t) => t.event_id === eventId).length
      if (count >= ev.max_teams) {
        throw new ApiError('VALIDATION_ERROR', { capacity: `Team cap (${ev.max_teams}) reached.` })
      }
      const teamId = uuid7()
      const joinCode = uuid7().replace(/-/g, '').slice(0, 8).toUpperCase()
      store.teams.push({ id: teamId, event_id: eventId, name, join_code: joinCode, status: 'active', created_at: new Date() })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'team.created',
        entity_type: 'team',
        entity_id: teamId,
        request_id: req.requestId,
      })
      return res.status(201).json({ team_id: teamId, join_code: joinCode })
    }),
  )

  router.post(
    '/v1/admin/events/:eventId/invites',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const raw = newRefreshToken()
      store.invites.push({
        id: uuid7(),
        event_id: eventId,
        email,
        token_hash: tokenHash(raw),
        team_id: req.body?.team_id ? String(req.body.team_id) : null,
        role: String(req.body?.role ?? 'participant'),
        used_at: null,
        expires_at: new Date(Date.now() + 48 * 3600 * 1000),
        created_at: new Date(),
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'invite.created',
        entity_type: 'event',
        entity_id: eventId,
        request_id: req.requestId,
        details: { email },
      })
      return res.status(201).json({ invite_token: raw, activation_url: `/activate?invite=${raw}` })
    }),
  )

  router.get(
    '/v1/admin/events/:eventId/participants',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const invs = store.invites.filter((i) => i.event_id === eventId)
      return res.json({
        participants: invs.map((i) => {
          const u = store.users.find((usr) => usr.email.toLowerCase() === i.email.toLowerCase())
          const tm = u ? store.teamMembers.find((m) => m.user_id === u.id) : undefined
          const t = tm ? store.teams.find((tm2) => tm2.id === tm.team_id) : undefined
          return {
            id: u?.id ?? null,
            email: u?.email ?? i.email,
            name: u?.name ?? null,
            role: u?.role ?? i.role,
            status: u?.status ?? 'pending',
            team_name: t?.name ?? null,
            activated: i.used_at !== null,
          }
        }),
      })
    }),
  )

  // --- admin challenges (step-up gated) ---
  router.post(
    '/v1/admin/events/:eventId/challenges',
    wrap((req, res) => {
      const p = requireStepUp(req)
      const eventId = String(req.params.eventId)
      const slug = String(req.body?.slug ?? '').trim()
      const title = String(req.body?.title ?? '').trim()
      if (!/^[a-z0-9-]+$/.test(slug) || !title) {
        throw new ApiError('VALIDATION_ERROR', { challenge: 'Valid slug and title required.' })
      }
      const cid = uuid7()
      store.challengeVersions.push({
        id: cid,
        event_id: eventId,
        slug,
        title,
        version: 1,
        instructions_md: String(req.body?.instructions_markdown ?? ''),
        status: 'draft',
        content_hash: null,
        frozen_at: null,
        published_at: null,
        created_at: new Date(),
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'challenge.created',
        entity_type: 'challenge',
        entity_id: cid,
        request_id: req.requestId,
        event_scope: `event:${eventId}`,
      })
      return res.status(201).json({ challenge_id: cid })
    }),
  )

  router.post(
    '/v1/admin/challenges/:challengeId/files',
    upload.single('file'),
    wrap((req, res) => {
      const p = requireStepUp(req)
      const challengeId = String(req.params.challengeId)
      const file = req.file
      if (!file) throw new ApiError('VALIDATION_ERROR', { file: 'File required.' })
      const rawPath = file.originalname || ''
      if (!rawPath || rawPath.includes('\x00') || path.isAbsolute(rawPath)) throw new ApiError('PATH_INVALID')
      const norm = path.posix.normalize(rawPath.replace(/\\/g, '/'))
      if (norm.startsWith('..') || path.posix.isAbsolute(norm)) throw new ApiError('PATH_INVALID')

      const cv = store.challengeVersions.find((c) => c.id === challengeId)
      if (!cv) throw new ApiError('NOT_FOUND')
      if (!['draft', 'reviewed'].includes(cv.status)) throw new ApiError('GROUND_TRUTH_LOCKED')

      const textContent = file.buffer.toString('utf8')
      const lines = textContent.split(/\r?\n/)
      const existing = store.challengeFiles.find((cf) => cf.challenge_version_id === challengeId && cf.path === norm)
      const sha = sha256Hex(file.buffer)
      if (existing) {
        existing.content = textContent
        existing.sha256 = sha
        existing.size_bytes = file.buffer.length
        existing.line_count = lines.length
      } else {
        store.challengeFiles.push({
          id: uuid7(),
          challenge_version_id: challengeId,
          path: norm,
          lang: langFor(norm),
          content: textContent,
          sha256: sha,
          size_bytes: file.buffer.length,
          line_count: lines.length,
        })
      }
      store.challengeFileLines = store.challengeFileLines.filter(
        (l) => !(l.challenge_version_id === challengeId && l.path === norm),
      )
      for (let i = 0; i < Math.min(lines.length, 5000); i++) {
        store.challengeFileLines.push({
          id: uuid7(),
          challenge_version_id: challengeId,
          path: norm,
          line_number: i + 1,
          line_text: lines[i].slice(0, 500),
        })
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'challenge.file_uploaded',
        entity_type: 'challenge',
        entity_id: challengeId,
        request_id: req.requestId,
        details: { path: norm },
        event_scope: 'challenge',
      })
      return res.json({ ok: true, path: norm, line_count: lines.length })
    }),
  )

  router.post(
    '/v1/admin/challenges/:challengeId/freeze',
    wrap((req, res) => {
      const p = requireStepUp(req)
      const challengeId = String(req.params.challengeId)
      const cv = store.challengeVersions.find((c) => c.id === challengeId)
      if (!cv) throw new ApiError('NOT_FOUND')
      if (!['draft', 'reviewed'].includes(cv.status)) throw new ApiError('GROUND_TRUTH_LOCKED')
      const files = store.challengeFiles
        .filter((f) => f.challenge_version_id === challengeId)
        .sort((a, b) => a.path.localeCompare(b.path))
      if (files.length === 0) {
        throw new ApiError('VALIDATION_ERROR', { files: 'Upload at least one file before freezing.' })
      }
      const contentHash = 'sha256:' + sha256Hex(files.map((f) => f.sha256).join(''))
      cv.status = 'sealed'
      cv.content_hash = contentHash
      cv.frozen_at = new Date()
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'challenge.frozen',
        entity_type: 'challenge',
        entity_id: challengeId,
        request_id: req.requestId,
        details: { content_hash: contentHash },
        event_scope: 'challenge',
      })
      return res.json({ ok: true, content_hash: contentHash })
    }),
  )

  router.post(
    '/v1/admin/challenges/:challengeId/publish',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const challengeId = String(req.params.challengeId)
      const stageId = String(req.body?.stage_id ?? '')
      if (!stageId) throw new ApiError('VALIDATION_ERROR', { stage_id: 'Required.' })
      const cv = store.challengeVersions.find((c) => c.id === challengeId)
      if (!cv) throw new ApiError('NOT_FOUND')
      if (cv.status !== 'sealed') throw new ApiError('GROUND_TRUTH_LOCKED')
      cv.status = 'published'
      cv.published_at = new Date()
      store.assignments.push({
        id: uuid7(),
        event_id: cv.event_id,
        stage_id: stageId,
        challenge_version_id: challengeId,
        team_id: null,
        repo_url: null,
        codespace_url: null,
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'challenge.published',
        entity_type: 'challenge',
        entity_id: challengeId,
        request_id: req.requestId,
        details: { stage_id: stageId },
        event_scope: 'challenge',
      })
      return res.json({ ok: true })
    }),
  )

  router.post(
    '/v1/admin/challenges/:challengeId/ground-truth/bugs',
    wrap((req, res) => {
      const p = requireStepUp(req)
      const challengeId = String(req.params.challengeId)
      const cv = store.challengeVersions.find((c) => c.id === challengeId)
      if (!cv) throw new ApiError('NOT_FOUND')
      if (!['draft', 'reviewed'].includes(cv.status)) throw new ApiError('GROUND_TRUTH_LOCKED')
      const bugId = uuid7()
      const b = req.body ?? {}
      store.gt.bugs.push({
        bug_id: bugId,
        challenge_version_id: challengeId,
        code: String(b.code ?? ''),
        title: String(b.title ?? ''),
        severity: String(b.severity ?? 'medium'),
        category: String(b.category ?? 'logic'),
        points: Number(b.points ?? 10),
        root_cause_group: String(b.root_cause_group ?? 'other'),
        explanation: String(b.explanation ?? ''),
        fix_guidance: b.fix_guidance ? String(b.fix_guidance) : null,
        locations: Array.isArray(b.locations) ? b.locations : [],
        aliases: Array.isArray(b.aliases) ? b.aliases.map((a: { keyword: string; weight?: number }) => [a.keyword, a.weight ?? 1.0]) : [],
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'gt.bug_added',
        entity_type: 'gt_bug',
        entity_id: bugId,
        request_id: req.requestId,
        details: { code: b.code },
        event_scope: `challenge:${challengeId}`,
      })
      return res.status(201).json({ bug_id: bugId })
    }),
  )

  router.post(
    '/v1/admin/challenges/:challengeId/ground-truth/flags',
    wrap((req, res) => {
      const p = requireStepUp(req)
      const challengeId = String(req.params.challengeId)
      const b = req.body ?? {}
      const hash = flagCodeHash(String(b.code ?? ''))
      if (!store.gt.flags.some((f) => f.challenge_version_id === challengeId && f.code_hash === hash)) {
        store.gt.flags.push({
          id: uuid7(),
          challenge_version_id: challengeId,
          flag_key: String(b.flag_key ?? ''),
          code_hash: hash,
          points: Number(b.points ?? 30),
          max_awards: Number(b.max_awards ?? 99),
          position_label: String(b.position_label ?? ''),
        })
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'gt.flag_added',
        entity_type: 'gt_flag',
        entity_id: String(b.flag_key ?? ''),
        request_id: req.requestId,
        event_scope: `challenge:${challengeId}`,
      })
      return res.status(201).json({ ok: true })
    }),
  )

  router.post(
    '/v1/admin/challenges/:challengeId/ground-truth/test-results',
    wrap((req, res) => {
      const p = requireStepUp(req)
      const subId = String(req.body?.submission_id ?? '')
      const passed = Number(req.body?.tests_passed ?? 0)
      const total = Number(req.body?.tests_total ?? 0)
      if (!subId || total <= 0 || passed < 0 || passed > total) {
        throw new ApiError('VALIDATION_ERROR', { tests: 'Provide submission_id, tests_passed, tests_total.' })
      }
      store.applyTestResults(subId, passed, total, p.id)
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'scoring.test_results_recorded',
        entity_type: 'submission',
        entity_id: subId,
        request_id: req.requestId,
        details: { passed, total },
        event_scope: 'scoring',
      })
      return res.json({ ok: true })
    }),
  )

  // --- live ops, readiness, audit, exports, disputes ---
  router.post(
    '/v1/admin/events/:eventId/announcements',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const severity = (req.body?.severity ?? 'info') as 'info' | 'warning' | 'critical'
      const body = String(req.body?.body ?? '').trim()
      if (body.length < 3) throw new ApiError('VALIDATION_ERROR', { body: 'Announcement body too short.' })
      store.announcements.push({
        id: uuid7(),
        event_id: eventId,
        severity,
        audience: 'all',
        body,
        created_by: p.id,
        created_at: new Date(),
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'announcement.created',
        entity_type: 'event',
        entity_id: eventId,
        request_id: req.requestId,
        details: { severity },
      })
      return res.status(201).json({ ok: true })
    }),
  )

  router.post(
    '/v1/admin/events/:eventId/time-adjustment',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const stageId = String(req.body?.stage_id ?? '')
      const delta = Number(req.body?.delta_seconds ?? 0)
      const reasonCode = String(req.body?.reason_code ?? 'OTHER')
      const userId = req.body?.user_id ? String(req.body.user_id) : null
      if (!stageId || delta === 0) {
        throw new ApiError('VALIDATION_ERROR', { adjustment: 'stage_id and nonzero delta_seconds required.' })
      }
      store.timeAdjustments.push({
        id: uuid7(),
        stage_id: stageId,
        user_id: userId,
        delta_seconds: delta,
        reason_code: reasonCode,
        created_by: p.id,
        created_at: new Date(),
      })
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'stage.time_adjustment',
        entity_type: 'stage',
        entity_id: stageId,
        request_id: req.requestId,
        details: { delta_seconds: delta, reason_code: reasonCode },
      })
      return res.json({ ok: true })
    }),
  )

  router.get(
    '/v1/admin/events/:eventId/live',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const submissionCounts: Record<string, number> = {}
      for (const s of store.submissions) {
        if (s.event_id === eventId) {
          submissionCounts[s.status] = (submissionCounts[s.status] ?? 0) + 1
        }
      }
      const eventTeams = store.teams.filter((t) => t.event_id === eventId)
      const teamIdSet = new Set(eventTeams.map((t) => t.id))
      const participantCount = new Set(
        store.teamMembers.filter((m) => teamIdSet.has(m.team_id)).map((m) => m.user_id),
      ).size
      const stages = store.stages
        .filter((s) => s.event_id === eventId)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          starts_at: s.starts_at ? s.starts_at.toISOString() : null,
          ends_at: s.ends_at ? s.ends_at.toISOString() : null,
          config: s.config,
        }))
      const reviewBacklog = store.reviewItems.filter((r) => r.status === 'open').length
      return res.json({
        teams: eventTeams.length,
        participants_online_estimate: participantCount,
        submission_counts: submissionCounts,
        job_queue: { oldest_queued_age_s: 0, dead_letters: 0 },
        review_backlog: reviewBacklog,
        stages,
        health: { database_app: 'up', database_gt: 'up', clock: new Date().toISOString() },
        kill_switches: { runner_enabled: false, ai_assessment_enabled: false, telemetry_enabled: false },
      })
    }),
  )

  router.get(
    '/v1/admin/events/:eventId/readiness',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const items = store.readinessItems
        .filter((r) => r.event_id === eventId)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((r) => ({
          key: r.key,
          label: r.label,
          state: r.state,
          owner: r.owner,
          checked_at: r.checked_at ? r.checked_at.toISOString() : null,
        }))
      return res.json({ items })
    }),
  )

  router.post(
    '/v1/admin/events/:eventId/readiness/:key',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const key = String(req.params.key)
      const state = String(req.body?.state ?? 'checked')
      if (!['checked', 'unchecked', 'na'].includes(state)) throw new ApiError('VALIDATION_ERROR')
      const item = store.readinessItems.find((r) => r.event_id === eventId && r.key === key)
      if (item) {
        item.state = state as 'checked' | 'unchecked' | 'na'
        item.checked_at = state === 'checked' ? new Date() : null
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'readiness.updated',
        entity_type: 'event',
        entity_id: eventId,
        request_id: req.requestId,
        details: { key, state },
      })
      return res.json({ ok: true })
    }),
  )

  router.get(
    '/v1/admin/audit/verify',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      return res.json(store.auditVerify())
    }),
  )

  router.get(
    '/v1/admin/audit',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      const limit = Math.min(Number(req.query.limit ?? 100), 500)
      const action = req.query.action ? String(req.query.action) : null
      const rows = [...store.auditEntries]
        .filter((e) => !action || e.action === action)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit)
        .map((r) => ({
          seq: r.seq,
          ts: r.ts.toISOString(),
          actor_role: r.actor_role,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          request_id: r.request_id,
          details: r.details,
        }))
      return res.json({ entries: rows })
    }),
  )

  router.get(
    '/v1/admin/events/:eventId/export/:kind',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const eventId = String(req.params.eventId)
      const kind = String(req.params.kind)
      if (!['results', 'submissions', 'ledger'].includes(kind)) {
        throw new ApiError('VALIDATION_ERROR', { kind: 'results|submissions|ledger' })
      }
      const csvCell = (v: unknown) => {
        const s = String(v ?? '')
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const lines: string[] = []
      if (kind === 'results') {
        lines.push('team_id,team_name,score')
        const rows = store.teams
          .filter((t) => t.event_id === eventId)
          .map((t) => ({
            id: t.id,
            name: t.name,
            total: store.scoreLedgerEntries
              .filter((l) => l.team_id === t.id)
              .reduce((s, l) => s + l.points, 0),
          }))
          .sort((a, b) => b.total - a.total)
        for (const r of rows) lines.push([r.id, r.name, r.total].map(csvCell).join(','))
      } else if (kind === 'submissions') {
        lines.push('submission_id,kind,title,status,receipt_code,received_at,file_path,line_start,line_end')
        const rows = store.submissions
          .filter((s) => s.event_id === eventId)
          .sort((a, b) => a.received_at.getTime() - b.received_at.getTime())
        for (const r of rows) {
          lines.push(
            [r.id, r.kind, r.title, r.status, r.receipt_code, r.received_at.toISOString(), r.file_path ?? '', r.line_start ?? '', r.line_end ?? '']
              .map(csvCell)
              .join(','),
          )
        }
      } else {
        lines.push('entry_id,stage_id,team_id,component,kind,points,reason_code,submission_id,created_at')
        const rows = store.scoreLedgerEntries
          .filter((l) => l.event_id === eventId)
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        for (const r of rows) {
          lines.push(
            [r.id, r.stage_id, r.team_id, r.component, r.kind, r.points, r.reason_code, r.submission_id ?? '', r.created_at.toISOString()]
              .map(csvCell)
              .join(','),
          )
        }
      }
      const content = lines.join('\n') + '\n'
      store.exports.push({
        id: uuid7(),
        event_id: eventId,
        kind: `${kind}_csv`,
        content,
        content_hash: sha256Hex(content),
        created_by: p.id,
        created_at: new Date(),
      })
      return res.json({ filename: `${kind}_${eventId.slice(0, 8)}.csv`, content })
    }),
  )

  router.get(
    '/v1/admin/disputes',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      const disputes = [...store.disputes]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .map((d) => {
          const sub = store.submissions.find((s) => s.id === d.submission_id)
          return {
            id: d.id,
            status: d.status,
            statement: d.statement,
            created_at: d.created_at.toISOString(),
            title: sub?.title ?? 'Submission',
            receipt_code: sub?.receipt_code ?? '-',
            submission_id: d.submission_id,
          }
        })
      return res.json({ disputes })
    }),
  )

  router.post(
    '/v1/admin/disputes/:disputeId/resolve',
    wrap((req, res) => {
      const p = requireRole('organizer', 'admin')(req)
      const disputeId = String(req.params.disputeId)
      const outcome = String(req.body?.outcome ?? '')
      const resolution = String(req.body?.resolution ?? '')
      const adjustPoints = req.body?.adjust_points !== undefined ? Number(req.body.adjust_points) : 0
      if (!['upheld', 'rejected'].includes(outcome)) {
        throw new ApiError('VALIDATION_ERROR', { outcome: 'upheld|rejected' })
      }
      const d = store.disputes.find((dp) => dp.id === disputeId)
      if (!d) throw new ApiError('NOT_FOUND')
      if (['upheld', 'rejected'].includes(d.status)) {
        throw new ApiError('VALIDATION_ERROR', { dispute: 'Already resolved.' })
      }
      d.status = outcome
      d.resolution = resolution
      d.resolved_by = p.id
      d.resolved_at = new Date()
      if (outcome === 'upheld' && adjustPoints) {
        const sub = store.submissions.find((s) => s.id === d.submission_id)
        if (sub) {
          store.addLedgerEntry({
            tenant_id: sub.tenant_id,
            event_id: sub.event_id,
            stage_id: sub.stage_id,
            team_id: d.team_id,
            submission_id: sub.id,
            award_unit_id: null,
            component: 'adjustment',
            kind: 'adjustment',
            points: adjustPoints,
            reason_code: 'DISPUTE_UPHELD',
            actor_id: p.id,
            reverses_entry_id: null,
            note: `Dispute ${disputeId.slice(0, 8)} upheld: ${resolution.slice(0, 200)}`,
          })
          store.refreshLeaderboard(sub.stage_id)
        }
      }
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'dispute.resolved',
        entity_type: 'dispute',
        entity_id: disputeId,
        request_id: req.requestId,
        details: { outcome },
      })
      return res.json({ ok: true })
    }),
  )

  router.post(
    '/v1/admin/adjustments',
    wrap((req, res) => {
      const p = requireRole('admin')(req)
      const stageId = String(req.body?.stage_id ?? '')
      const teamId = String(req.body?.team_id ?? '')
      const points = Number(req.body?.points ?? 0)
      const reason = String(req.body?.reason ?? '')
      if (!stageId || !teamId || !reason || points === 0) {
        throw new ApiError('VALIDATION_ERROR', { adjustment: 'stage_id, team_id, points, reason required.' })
      }
      const st = store.stages.find((s) => s.id === stageId)
      if (!st) throw new ApiError('NOT_FOUND')
      const ev = store.events.find((e) => e.id === st.event_id)!
      store.addLedgerEntry({
        tenant_id: ev.tenant_id,
        event_id: ev.id,
        stage_id: stageId,
        team_id: teamId,
        submission_id: null,
        award_unit_id: null,
        component: 'adjustment',
        kind: 'adjustment',
        points,
        reason_code: 'MANUAL',
        actor_id: p.id,
        reverses_entry_id: null,
        note: reason,
      })
      store.refreshLeaderboard(stageId)
      store.auditWrite({
        actor_id: p.id,
        actor_role: p.role,
        action: 'scoring.manual_adjustment',
        entity_type: 'team',
        entity_id: teamId,
        request_id: req.requestId,
        details: { points, reason },
        event_scope: 'scoring',
      })
      return res.json({ ok: true })
    }),
  )

  router.get(
    '/v1/admin/system/health',
    wrap((req, res) => {
      requireRole('organizer', 'admin')(req)
      return res.json({
        databases: { app: 'up', gt: 'up' },
        jobs: { done: store.submissions.length },
        oldest_queued_job_age_s: 0,
        profile: process.env.PROFILE || 'dev',
        environment: process.env.ENVIRONMENT || 'development',
        runner_enabled: false,
        ai_assessment_enabled: false,
      })
    }),
  )

  return router
}

export function apiErrorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as AuthedRequest).requestId || '-'
  if (err instanceof ApiError) {
    const message = formatApiErrorMessage(err, requestId)
    res
      .status(err.status)
      .setHeader('X-Request-Id', requestId)
      .json({
        error: {
          code: err.code,
          message,
          request_id: requestId,
          details: err.details,
        },
      })
    return
  }
  console.error('[API INTERNAL_ERROR]', requestId, err)
  const message = `Something went wrong. Reference: ${requestId}.`
  res
    .status(500)
    .setHeader('X-Request-Id', requestId)
    .json({
      error: {
        code: 'INTERNAL_ERROR',
        message,
        request_id: requestId,
        details: {},
      },
    })
}
