import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import type { SessionInfo } from '../../lib/types'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { Chip, ConfirmButton, EmptyState, ErrorBanner, KVRow, LoadingShell, Panel } from '../../ui/components'

// Account page: profile facts from GET /me and device sessions from
// GET /v1/me/sessions, each row revocable via DELETE /v1/me/sessions/{id}.

export default function Account() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const sessionsQ = useQuery({
    queryKey: ['me-sessions'],
    queryFn: () => api<SessionInfo[]>('/v1/me/sessions'),
  })
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const sessions = sessionsQ.data ?? []
  const currentLabel = sessions.length === 1 ? '1 active session' : `${sessions.length} active sessions`

  async function revokeSession(sessionId: string) {
    setRevokeError(null)
    setRevokingId(sessionId)
    try {
      await api<{ ok: boolean }>(`/v1/me/sessions/${sessionId}`, { method: 'DELETE' })
      void queryClient.invalidateQueries({ queryKey: ['me-sessions'] })
    } catch (err) {
      if (err instanceof ApiRequestError) setRevokeError(err.serverMessage)
      else setRevokeError('Revoking the session failed unexpectedly.')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="stack-lg">
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="exhibit-num">EX-ACCOUNT</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Account</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip tone="muted">{user?.email}</Chip>
          <Chip tone="muted">{currentLabel}</Chip>
        </div>
      </header>

      <Panel exhibit="EX-01" title="Profile">
        {user ? (
          <div className="ruled panel-2" style={{ padding: '0 16px' }}>
            <KVRow k="Name" v={user.name} mono={false} />
            <KVRow k="Email" v={user.email} />
            <KVRow k="Role" v={user.role} />
            <KVRow k="Team" v={user.team ? user.team.name : 'No team'} mono={false} />
            <KVRow
              k="Rules"
              v={user.rules_accepted ? `accepted, version ${user.rules_version ?? 'unknown'}` : 'not accepted yet'}
              mono={false}
            />
          </div>
        ) : (
          <LoadingShell label="Loading profile" />
        )}
      </Panel>

      <Panel exhibit="EX-02" title="Your devices">
        <p className="muted small" style={{ maxWidth: '74ch' }}>
          Every signed-in browser is a separate session with its own refresh cookie. Revoke a device here to end
          that session immediately. Signing out of all devices is done by logging out on each device in turn;
          there is no single global sign-out button.
        </p>

        {sessionsQ.isLoading && <LoadingShell label="Loading sessions" />}
        {sessionsQ.isError && <ErrorBanner error={sessionsQ.error} onRetry={() => void sessionsQ.refetch()} />}
        {revokeError && (
          <div className="banner banner-tone-danger" role="alert" style={{ marginBottom: 12 }}>
            <span className="banner-title">Session revocation failed</span>
            <div className="small">{revokeError}</div>
          </div>
        )}

        {sessionsQ.data && sessions.length === 0 && (
          <EmptyState title="No active sessions" note="You are signed in nowhere else. New sign-ins appear here." />
        )}

        {sessionsQ.data && sessions.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Device sessions with last-seen time and revocation</caption>
              <thead>
                <tr>
                  <th scope="col">Last seen</th>
                  <th scope="col">Device</th>
                  <th scope="col">Signed in</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="mono small">{fmtDateTime(s.last_seen_at)}</td>
                    <td className="mono small" style={{ wordBreak: 'break-word' }}>
                      {s.device ? s.device : <span className="muted">unknown device</span>}
                    </td>
                    <td className="mono small">{fmtDate(s.created_at)}</td>
                    <td>
                      <ConfirmButton
                        label={revokingId === s.id ? 'Revoking' : 'Revoke'}
                        confirmLabel="Confirm revoke"
                        variant="danger"
                        disabled={revokingId !== null}
                        onConfirm={() => void revokeSession(s.id)}
                        title="End this session; the device must sign in again"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
