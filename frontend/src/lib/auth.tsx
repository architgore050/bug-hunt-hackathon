import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, refreshSession, setAccessToken } from './api'
import type { Me, LoginResponse, Role } from './types'

export function homePathFor(role: Role): string {
  if (role === 'participant') return '/arena/overview'
  if (role === 'reviewer') return '/review'
  return '/admin'
}

interface AuthContextValue {
  user: Me | null
  /** loading = session restore in flight; authed = signed in; anon = signed out */
  status: 'loading' | 'authed' | 'anon'
  login: (email: string, password: string) => Promise<LoginResponse>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
  acceptRules: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [status, setStatus] = useState<'loading' | 'authed' | 'anon'>('loading')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadMe = useCallback(async (): Promise<Me | null> => {
    const me = await api<Me>('/v1/me')
    return me
  }, [])

  useEffect(() => {
    let cancelled = false
    async function restore() {
      const ok = await refreshSession()
      if (cancelled) return
      if (!ok) {
        setAccessToken(null)
        setStatus('anon')
        return
      }
      try {
        const me = await loadMe()
        if (cancelled) return
        setUser(me)
        setStatus(me ? 'authed' : 'anon')
      } catch {
        if (cancelled) return
        setAccessToken(null)
        setStatus('anon')
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [loadMe])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResponse> => {
      const res = await api<LoginResponse>('/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      setAccessToken(res.access_token)
      const me = await loadMe().catch(() => null)
      setUser(me ?? ({ ...res.user, team: null, rules_accepted: false, rules_version: null } as Me))
      setStatus('authed')
      return res
    },
    [loadMe],
  )

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api<{ ok: boolean }>('/v1/auth/logout', { method: 'POST' })
    } catch {
      // A failed logout (expired token, offline) still ends the local session.
    }
    setAccessToken(null)
    setUser(null)
    setStatus('anon')
  }, [])

  const refreshMe = useCallback(async (): Promise<void> => {
    const me = await loadMe()
    setUser(me)
  }, [loadMe])

  const acceptRules = useCallback(async (): Promise<void> => {
    await api<{ ok: boolean; rules_version: number }>('/v1/me/acceptances', { method: 'POST', body: {} })
    await refreshMe()
  }, [refreshMe])

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, refreshMe, acceptRules }),
    [user, status, login, logout, refreshMe, acceptRules],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
