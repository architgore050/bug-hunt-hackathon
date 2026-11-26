import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { AdminEvent } from '../../lib/types'
import {
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingShell,
  Panel,
  StatusChip,
} from '../../ui/components'
import { adminErrorText, StepUpGateHint, StepUpPanel } from '../../components/StepUp'

interface Team {
  id: string
  name: string
  status: string
  member_count: number
}

interface Participant {
  id: string
  email: string
  name: string
  role: string
  status: string
  team_id: string
  team_name: string
  password_set: boolean
  created_at: string
}

export default function AdminParticipants() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const eventsQ = useQuery({
    queryKey: ['admin-events'],
    queryFn: () => api<{ events: AdminEvent[] }>('/v1/admin/events'),
  })
  const [eventId, setEventId] = useState('')
  const [stepUpUntil, setStepUpUntil] = useState<number | null>(null)
  const elevated = stepUpUntil !== null && stepUpUntil > Date.now()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const teamsQ = useQuery({
    queryKey: ['admin-teams', eventId],
    queryFn: () => api<{ teams: Team[] }>(`/v1/admin/events/${eventId}/teams`),
    enabled: !!eventId,
  })
  const participantsQ = useQuery({
    queryKey: ['admin-participants', eventId],
    queryFn: () => api<{ participants: Participant[] }>(`/v1/admin/events/${eventId}/participants`),
    enabled: !!eventId,
  })

  const teams = teamsQ.data?.teams ?? []
  const participants = participantsQ.data?.participants ?? []

  const [form, setForm] = useState({ email: '', name: '', team_id: '' })
  const [teamChoices, setTeamChoices] = useState<Record<string, string>>({})
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  useEffect(() => {
    if (!eventId && eventsQ.data?.events.length) setEventId(eventsQ.data.events[0].id)
  }, [eventsQ.data, eventId])

  useEffect(() => {
    if (!teams.length) {
      setForm((old) => ({ ...old, team_id: '' }))
      return
    }
    if (!teams.some((team) => team.id === form.team_id)) {
      setForm((old) => ({ ...old, team_id: teams[0].id }))
    }
    setTeamChoices((old) => {
      const next = { ...old }
      for (const participant of participants) {
        if (!next[participant.id]) next[participant.id] = participant.team_id
      }
      return next
    })
  }, [teams, participants, form.team_id])

  useEffect(() => {
    setError(null)
    setNotice(null)
    setForm({ email: '', name: '', team_id: '' })
    setTeamChoices({})
    setResetTarget(null)
    setResetPassword('')
  }, [eventId])

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  function showError(err: unknown) {
    setError(err instanceof ApiRequestError ? adminErrorText(err) : 'The operation failed. Please retry.')
  }

  async function registerParticipant(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin || !elevated || !eventId || !form.team_id) return
    setBusy(true)
    clearMessages()
    try {
      const result = await api<{ participant_id: string; password_setup_required: boolean }>(
        `/v1/admin/events/${eventId}/participants`,
        {
          method: 'POST',
          body: {
            email: form.email.trim().toLowerCase(),
            name: form.name.trim(),
            team_id: form.team_id,
          },
        },
      )
      setNotice(
        result.password_setup_required
          ? 'Participant registered. They set their initial password on first sign-in.'
          : 'Existing participant account assigned to this event team. Its existing password was preserved.',
      )
      setForm({ email: '', name: '', team_id: teams[0]?.id ?? '' })
      await queryClient.invalidateQueries({ queryKey: ['admin-participants', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-teams', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function moveParticipant(participant: Participant) {
    if (!isAdmin || !elevated || !eventId) return
    const team_id = teamChoices[participant.id] ?? participant.team_id
    if (team_id === participant.team_id) return
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/events/${eventId}/participants/${participant.id}/team`, {
        method: 'PATCH',
        body: { team_id },
      })
      setNotice(`Moved ${participant.email} to the selected team.`)
      await queryClient.invalidateQueries({ queryKey: ['admin-participants', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-teams', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function removeParticipant(participant: Participant) {
    if (!isAdmin || !elevated || !eventId) return
    if (!window.confirm(`Remove ${participant.email} from this event?`)) return
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/events/${eventId}/participants/${participant.id}`, { method: 'DELETE' })
      setNotice(
        'Participant removed from this event. If they had no other event membership, their account was disabled and all sessions were revoked.',
      )
      await queryClient.invalidateQueries({ queryKey: ['admin-participants', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-teams', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(participant: Participant) {
    if (!isAdmin || !elevated || resetPassword.length < 12) return
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/users/${participant.id}/password-reset`, {
        method: 'POST',
        body: { password: resetPassword },
      })
      setNotice(
        `Password reset for ${participant.email}. All previous sessions and refresh tokens were revoked. Deliver the new password through an approved private channel.`,
      )
      setResetTarget(null)
      setResetPassword('')
      await queryClient.invalidateQueries({ queryKey: ['admin-participants', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  const filteredParticipants = participants

  return (
    <div className="stack-lg">
      <header className="stack">
        <span className="exhibit-num">ADMINISTRATION</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Participants</h1>
        <p className="muted small" style={{ maxWidth: '80ch' }}>
          Accounts are created by administrators only. No invitation tokens or activation links are issued.
          New accounts have no password until their first sign-in. Organizers can view the roster; only admins can
          register, move, remove, or reset participants.
        </p>
        <div className="field" style={{ width: 440, maxWidth: '100%' }}>
          <label className="field-label" htmlFor="participants-event">Event</label>
          <div className="select-wrap">
            <select id="participants-event" className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Select event</option>
              {(eventsQ.data?.events ?? []).map((event) => (
                <option key={event.id} value={event.id}>{event.name} ({event.status})</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {eventsQ.isLoading && <LoadingShell label="Loading events" />}
      {eventsQ.isError && <ErrorBanner error={eventsQ.error} onRetry={() => void eventsQ.refetch()} />}
      {error && <div className="banner banner-tone-danger" role="alert">{error}</div>}
      {notice && <div className="banner banner-tone-ok" role="status">{notice}</div>}

      {eventId && isAdmin && (
        <StepUpPanel
          stepUpUntil={stepUpUntil}
          onStepUp={setStepUpUntil}
          note="Participant registration, team changes, removal and password resets require a fresh admin password confirmation. The confirmation is valid for five minutes."
        />
      )}

      {eventId && (
        <>
          <div className="grid-2">
            <Panel exhibit="01" title="Register participant" actions={isAdmin && !elevated ? <StepUpGateHint /> : undefined}>
              {isAdmin ? (
                <form onSubmit={registerParticipant} className="stack" style={{ gap: 12 }}>
                  <Field label="Email address" htmlFor="participant-email" required>
                    <input id="participant-email" className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </Field>
                  <Field label="Participant name" htmlFor="participant-name" required>
                    <input id="participant-name" className="input" minLength={2} maxLength={160} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field label="Team" htmlFor="participant-team" required>
                    <select id="participant-team" className="select" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })} required>
                      <option value="">Select team</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </Field>
                  <Button type="submit" variant="primary" disabled={busy || !elevated || !form.email || form.name.trim().length < 2 || !form.team_id}>
                    {busy ? 'Registering' : 'Register participant'}
                  </Button>
                  <p className="muted small">
                    The account is created without a password. The registered email is checked at sign-in; the first password entered for a passwordless account becomes its initial password. This event intentionally accepts the risk that mailbox ownership is not verified.
                  </p>
                </form>
              ) : (
                <p className="muted small">Participant registration is restricted to administrators.</p>
              )}
            </Panel>

            <Panel exhibit="02" title="Teams">
              {teamsQ.isLoading && <LoadingShell label="Loading teams" />}
              {teamsQ.isError && <ErrorBanner error={teamsQ.error} onRetry={() => void teamsQ.refetch()} />}
              {teams.map((team) => (
                <div className="kv-row" key={team.id}>
                  <span>{team.name}</span>
                  <span className="muted small">{team.member_count} members</span>
                </div>
              ))}
              {teamsQ.data && teams.length === 0 && <EmptyState title="No teams" note="Create a team from the operations console before registering participants." />}
            </Panel>
          </div>

          <Panel exhibit="03" title="Registered participant roster">
            {participantsQ.isLoading && <LoadingShell label="Loading participants" />}
            {participantsQ.isError && <ErrorBanner error={participantsQ.error} onRetry={() => void participantsQ.refetch()} />}
            {participantsQ.data && filteredParticipants.length === 0 && <EmptyState title="No participants registered" note="New participant accounts are created from the admin-only form above." />}
            {filteredParticipants.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Email</th><th>Name</th><th>Team</th><th>Account</th><th>Password</th>
                      {isAdmin && <th>Admin actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParticipants.map((participant) => (
                      <tr key={participant.id}>
                        <td className="mono small">{participant.email}</td>
                        <td>{participant.name}</td>
                        <td>{participant.team_name}</td>
                        <td><StatusChip value={participant.status} /></td>
                        <td><Chip tone={participant.password_set ? 'ok' : 'warn'}>{participant.password_set ? 'set' : 'first sign-in pending'}</Chip></td>
                        {isAdmin && (
                          <td style={{ minWidth: 280 }}>
                            <div className="stack" style={{ gap: 8 }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <select
                                  className="select"
                                  aria-label={`Team for ${participant.email}`}
                                  value={teamChoices[participant.id] ?? participant.team_id}
                                  onChange={(e) => setTeamChoices((old) => ({ ...old, [participant.id]: e.target.value }))}
                                >
                                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                                </select>
                                <Button size="sm" disabled={busy || !elevated || (teamChoices[participant.id] ?? participant.team_id) === participant.team_id} onClick={() => void moveParticipant(participant)}>Move</Button>
                              </div>
                              {resetTarget === participant.id ? (
                                <div className="stack" style={{ gap: 6 }}>
                                  <input
                                    className="input mono-input"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={12}
                                    maxLength={200}
                                    placeholder="New password (12+ chars)"
                                    aria-label={`New password for ${participant.email}`}
                                    value={resetPassword}
                                    onChange={(e) => setResetPassword(e.target.value)}
                                  />
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <Button size="sm" variant="primary" disabled={busy || !elevated || resetPassword.length < 12} onClick={() => void resetPassword(participant)}>Reset password</Button>
                                    <Button size="sm" variant="ghost" onClick={() => { setResetTarget(null); setResetPassword('') }}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <Button size="sm" disabled={busy || !elevated} onClick={() => { setResetTarget(participant.id); setResetPassword('') }}>Reset password</Button>
                                  <Button size="sm" variant="danger" disabled={busy || !elevated} onClick={() => void removeParticipant(participant)}>Remove participant</Button>
                                </div>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small" style={{ marginTop: 10 }}>
              Registration, team reassignment, removal, and password reset are admin-only on both frontend and backend. Password resets revoke all existing sessions and refresh tokens.
            </p>
          </Panel>
        </>
      )}
    </div>
  )
}
