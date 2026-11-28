// Fetch wrapper for the Bug Hunt CTF API.
//
// - The access token lives in memory only (module variable). It is obtained at
//   login and on reload via POST /v1/auth/refresh using the HttpOnly,
//   path-scoped refresh cookie (Origin + X-BHCTF-Client headers required).
// - A 401 with code AUTH_TOKEN_EXPIRED triggers one silent refresh and one
//   retry of the original request.
// - Every failure is normalized to ApiRequestError carrying the server error
//   envelope {error:{code,message,request_id,details}}.

export class ApiRequestError extends Error {
  code: string
  serverMessage: string
  requestId: string
  details: Record<string, unknown>
  status: number
  network: boolean

  constructor(init: {
    code: string
    serverMessage: string
    requestId?: string
    details?: Record<string, unknown>
    status?: number
    network?: boolean
  }) {
    super(init.serverMessage)
    this.name = 'ApiRequestError'
    this.code = init.code
    this.serverMessage = init.serverMessage
    this.requestId = init.requestId ?? ''
    this.details = init.details ?? {}
    this.status = init.status ?? 0
    this.network = init.network ?? false
  }

  /** Human-facing line: envelope message plus the code for staff-style traces. */
  describe(): string {
    if (this.network) return this.serverMessage
    return this.serverMessage
  }
}

let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

interface RefreshResponse {
  access_token: string
  expires_at: string
  server_time: string
}

let refreshInFlight: Promise<boolean> | null = null

async function performRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Origin: window.location.origin,
        'X-BHCTF-Client': 'web',
      },
    })
    if (!res.ok) return false
    const data = (await res.json()) as RefreshResponse
    accessToken = data.access_token
    return true
  } catch {
    return false
  }
}

/** Silent refresh; concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  idempotencyKey?: string
  /** Internal: skip the silent-refresh retry (used by the retry itself). */
  _retried?: boolean
}

async function parseErrorBody(res: Response): Promise<{ code: string; message: string; request_id: string; details: Record<string, unknown> } | null> {
  try {
    const raw = (await res.json()) as { error?: { code?: string; message?: string; request_id?: string; details?: Record<string, unknown> } }
    if (raw && raw.error && typeof raw.error.code === 'string') {
      return {
        code: raw.error.code,
        message: raw.error.message ?? 'Request failed.',
        request_id: raw.error.request_id ?? '',
        details: (raw.error.details as Record<string, unknown>) ?? {},
      }
    }
    return null
  } catch {
    return null
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-BHCTF-Client': 'web' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let res: Response
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : isFormData ? (options.body as FormData) : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiRequestError({
      code: 'NETWORK',
      serverMessage: 'Cannot reach the platform API. Check your connection and retry.',
      status: 0,
      network: true,
    })
  }

  // One silent refresh + one retry on an expired access token.
  if (res.status === 401 && !options._retried) {
    const err = await parseErrorBody(res)
    if (err && err.code === 'AUTH_TOKEN_EXPIRED') {
      const ok = await refreshSession()
      if (ok) return api<T>(path, { ...options, _retried: true })
    }
  }

  if (res.status === 204) return undefined as T

  const data: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    let envelope: { code: string; message: string; request_id: string; details: Record<string, unknown> } | null = null
    if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
      const raw = (data as { error?: { code?: string; message?: string; request_id?: string; details?: Record<string, unknown> } }).error
      if (raw && typeof raw.code === 'string') {
        envelope = {
          code: raw.code,
          message: raw.message ?? 'Request failed.',
          request_id: raw.request_id ?? '',
          details: raw.details ?? {},
        }
      }
    }
    throw new ApiRequestError({
      code: envelope?.code ?? `HTTP_${res.status}`,
      serverMessage: envelope?.message ?? `Request failed with status ${res.status}.`,
      requestId: envelope?.request_id ?? res.headers.get('X-Request-Id') ?? '',
      details: envelope?.details ?? {},
      status: res.status,
    })
  }

  return data as T
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `bhctf-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}
