import crypto from 'node:crypto'
import path from 'node:path'

const DEV_EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex')
const SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0
  ? process.env.JWT_SECRET.trim()
  : DEV_EPHEMERAL_SECRET

export const ACCESS_TOKEN_TTL_S = Number(process.env.ACCESS_TOKEN_TTL_S || 900)
export const REFRESH_TOKEN_TTL_S = Number(process.env.REFRESH_TOKEN_TTL_S || 604800)
export const REFRESH_REUSE_GRACE_S = Number(process.env.REFRESH_REUSE_GRACE_S || 15)
export const MAX_SESSIONS_PER_USER = Number(process.env.MAX_SESSIONS_PER_USER || 5)
export const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH || 12)

export interface AccessPayload {
  sub: string
  sid: string
  role: 'participant' | 'reviewer' | 'organizer' | 'admin'
  tv: number
  iat: number
  exp: number
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

export function createAccessToken(opts: {
  userId: string
  sessionId: string
  role: 'participant' | 'reviewer' | 'organizer' | 'admin'
  tokenVersion: number
}): { token: string; expiresAt: Date } {
  const nowSec = Math.floor(Date.now() / 1000)
  const expSec = nowSec + ACCESS_TOKEN_TTL_S
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64urlEncode(
    JSON.stringify({
      sub: opts.userId,
      sid: opts.sessionId,
      role: opts.role,
      tv: opts.tokenVersion,
      iat: nowSec,
      exp: expSec,
    } satisfies AccessPayload),
  )
  const signingInput = `${header}.${payload}`
  const sig = crypto.createHmac('sha256', SECRET).update(signingInput).digest('base64url')
  return {
    token: `${signingInput}.${sig}`,
    expiresAt: new Date(expSec * 1000),
  }
}

export function verifyAccessToken(token: string): { status: 'ok'; payload: AccessPayload } | { status: 'expired' | 'invalid' } {
  const parts = token.split('.')
  if (parts.length !== 3) return { status: 'invalid' }
  const [header, payload, sig] = parts
  const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { status: 'invalid' }
  }
  try {
    const parsed = JSON.parse(b64urlDecode(payload).toString('utf8')) as AccessPayload
    const nowSec = Math.floor(Date.now() / 1000)
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowSec) {
      return { status: 'expired' }
    }
    return { status: 'ok', payload: parsed }
  } catch {
    return { status: 'invalid' }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false
  const parts = storedHash.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hex] = parts
  const derived = crypto.scryptSync(password, salt, 64)
  const target = Buffer.from(hex, 'hex')
  if (derived.length !== target.length) return false
  return crypto.timingSafeEqual(derived, target)
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function tokenHash(raw: string): string {
  return sha256Hex(raw)
}

export function flagCodeHash(code: string): string {
  return sha256Hex(code.trim())
}

export function ipHash(ip: string): string {
  return crypto.createHmac('sha256', SECRET).update(ip || '').digest('hex').slice(0, 32)
}

export function newRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function newUuid(): string {
  return crypto.randomUUID()
}

function sortDeep(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortDeep)
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      out[k] = sortDeep((val as Record<string, unknown>)[k])
    }
    return out
  }
  return val
}

export function canonicalPayloadHash(payload: unknown): string {
  return sha256Hex(JSON.stringify(sortDeep(payload)))
}

export function receiptCode(submissionId: string, now: Date): string {
  const h = crypto
    .createHmac('sha256', SECRET)
    .update(`${submissionId}:${now.toISOString()}`)
    .digest('hex')
    .toUpperCase()
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`
}

export function normalizeRepoPath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0') || rawPath.startsWith('/') || rawPath.startsWith('\\')) {
    return null
  }
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, '/'))
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    path.posix.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}
