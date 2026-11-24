import crypto from 'node:crypto'

export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')
export const ACCESS_TOKEN_TTL_S = Number(process.env.ACCESS_TOKEN_TTL_S) || 900
export const REFRESH_TOKEN_TTL_S = Number(process.env.REFRESH_TOKEN_TTL_S) || 60 * 60 * 12
export const REFRESH_REUSE_GRACE_S = Number(process.env.REFRESH_REUSE_GRACE_S) || 30
export const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH) || 12
export const MAX_SESSIONS_PER_USER = Number(process.env.MAX_SESSIONS_PER_USER) || 5

export function uuid7(): string {
  return crypto.randomUUID()
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.startsWith('scrypt$')) return false
  const parts = stored.split('$')
  if (parts.length !== 3) return false
  const [, salt, hex] = parts
  try {
    const derived = crypto.scryptSync(password, salt, 64)
    const expected = Buffer.from(hex, 'hex')
    if (derived.length !== expected.length) return false
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function tokenHash(rawToken: string): string {
  return sha256Hex(rawToken)
}

export function newRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url')
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

function b64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8')
}

export interface AccessClaims {
  iss: string
  aud: string
  sub: string
  sid: string
  role: string
  tv: number
  iat: number
  nbf: number
  exp: number
  jti: string
}

export function createAccessToken(opts: {
  userId: string
  sessionId: string
  role: string
  tokenVersion: number
}): { token: string; expiresAt: Date } {
  const nowSec = Math.floor(Date.now() / 1000)
  const expSec = nowSec + ACCESS_TOKEN_TTL_S
  const claims: AccessClaims = {
    iss: 'bughunt-api',
    aud: opts.role === 'participant' ? 'bughunt-participant' : 'bughunt-admin',
    sub: opts.userId,
    sid: opts.sessionId,
    role: opts.role,
    tv: opts.tokenVersion,
    iat: nowSec,
    nbf: nowSec,
    exp: expSec,
    jti: crypto.randomBytes(8).toString('hex'),
  }
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64urlEncode(JSON.stringify(claims))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return {
    token: `${header}.${payload}.${sig}`,
    expiresAt: new Date(expSec * 1000),
  }
}

export class JwtExpiredError extends Error {}
export class JwtInvalidError extends Error {}

export function decodeAccessToken(token: string): AccessClaims {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JwtInvalidError('malformed')
  const [headerB64, payloadB64, sigB64] = parts
  let header: { alg?: string }
  try {
    header = JSON.parse(b64urlDecode(headerB64)) as { alg?: string }
  } catch {
    throw new JwtInvalidError('bad header')
  }
  if (header.alg !== 'HS256') throw new JwtInvalidError('alg mismatch')

  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest()
  let actualSig: Buffer
  try {
    actualSig = Buffer.from(sigB64, 'base64url')
  } catch {
    throw new JwtInvalidError('bad sig')
  }
  if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
    throw new JwtInvalidError('sig mismatch')
  }

  let claims: AccessClaims
  try {
    claims = JSON.parse(b64urlDecode(payloadB64)) as AccessClaims
  } catch {
    throw new JwtInvalidError('bad payload')
  }
  if (claims.iss !== 'bughunt-api') throw new JwtInvalidError('bad iss')
  if (claims.aud !== 'bughunt-participant' && claims.aud !== 'bughunt-admin') throw new JwtInvalidError('bad aud')
  if (!claims.sub || !claims.sid || typeof claims.exp !== 'number') throw new JwtInvalidError('missing claims')

  const nowSec = Math.floor(Date.now() / 1000)
  if (claims.exp <= nowSec) throw new JwtExpiredError('expired')
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 5) throw new JwtInvalidError('not yet valid')
  return claims
}

export function receiptCode(submissionId: string, receivedAtIso: string): string {
  const material = `${submissionId}|${receivedAtIso}`
  const digest = crypto.createHmac('sha256', JWT_SECRET).update(material).digest('hex').toUpperCase()
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let take = ''
  for (let i = 0; i < 16; i += 2) {
    const byte = parseInt(digest.slice(i, i + 2), 16)
    take += alphabet[byte % alphabet.length]
  }
  return `${take.slice(0, 4)}-${take.slice(4)}`
}

export function flagCodeHash(code: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(code.trim()).digest('hex')
}

export function ipHash(ip: string | undefined): string | null {
  if (!ip) return null
  return crypto.createHmac('sha256', JWT_SECRET).update(ip).digest('hex').slice(0, 32)
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortDeep(obj[k])
    }
    return out
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

export function canonicalPayloadHash(payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(payload))
}
