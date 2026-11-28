import { useEffect, useRef, useState } from 'react'
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
  ConfirmButton,
} from '../../ui/components'
import { adminErrorText, needsStepUp, StepUpGateHint, StepUpPanel, useStepUpWindow } from '../../components/StepUp'

interface Team {
  id: string
  name: string
  member_count: number
}

interface Participant {
  id: string
  email: string
  name: string
  role: string
  team_id: string
  team_name: string
  password_set: boolean
  created_at: string
}

const EMPTY_TEAMS: Team[] = []
const EMPTY_PARTICIPANTS: Participant[] = []

type StaffRole = 'reviewer' | 'organizer' | 'admin'

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
  const { nowMs, elevated } = useStepUpWindow(stepUpUntil)
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

  const teams = teamsQ.data?.teams ?? EMPTY_TEAMS
  const participants = participantsQ.data?.participants ?? EMPTY_PARTICIPANTS

  const [form, setForm] = useState({ email: '', name: '', team_id: '' })
  const [teamChoices, setTeamChoices] = useState<Record<string, string>>({})
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [staffForm, setStaffForm] = useState<{ email: string; name: string; role: StaffRole; password: string }>({
    email: '',
    name: '',
    role: 'reviewer',
    password: '',
  })
  const resetInputRef = useRef<HTMLInputElement | null>(null)
  const resetTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const previousResetTarget = useRef<string | null>(null)

  useEffect(() => {
    if (!eventId && eventsQ.data?.events.length) setEventId(eventsQ.data.events[0].id)
  }, [eventsQ.data, eventId])

  useEffect(() => {
    if (!teams.length) {
      setForm((old) => old.team_id === '' ? old : { ...old, team_id: '' })
      return
    }
    if (!teams.some((team) => team.id === form.team_id)) {
      const firstTeamId = teams[0].id
      setForm((old) => old.team_id === firstTeamId ? old : { ...old, team_id: firstTeamId })
    }
    setTeamChoices((old) => {
      let changed = false
      const next = { ...old }
      for (const participant of participants) {
        if (!next[participant.id]) {
          next[participant.id] = participant.team_id
          changed = true
        }
      }
      return changed ? next : old
    })
  }, [teams, participants, form.team_id])

  useEffect(() => {
    setError(null)
    setNotice(null)
    setForm({ email: '', name: '', team_id: '' })
    setTeamChoices({})
    setResetTarget(null)
    setResetPasswordValue('')
  }, [eventId])

  useEffect(() => {
    if (resetTarget) {
      previousResetTarget.current = resetTarget
      resetInputRef.current?.focus()
      return
    }
    if (previousResetTarget.current) {
      resetTriggerRefs.current[previousResetTarget.current]?.focus()
      previousResetTarget.current = null
    }
  }, [resetTarget])

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  function showError(err: unknown) {
    if (needsStepUp(err)) setStepUpUntil(null)
    setError(err instanceof ApiRequestError ? adminErrorText(err) : 'The operation failed. Please retry.')
  }

  async function registerStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin || !elevated) return
    setBusy(true)
    clearMessages()
    try {
      await api('/v1/auth/register', {
        method: 'POST',
        body: {
          email: staffForm.email.trim().toLowerCase(),
          name: staffForm.name.trim(),
          role: staffForm.role,
          password: staffForm.password,
        },
      })
      setNotice(`Registered ${staffForm.role} account for ${staffForm.email.trim().toLowerCase()}. Deliver the administrator-assigned password privately.`)
      setStaffForm({ email: '', name: '', role: 'reviewer', password: '' })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
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
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/events/${eventId}/participants/${participant.id}`, { method: 'DELETE' })
      setNotice(
        'Participant removed from this event. If this was their last team membership, their sessions are revoked and they can no longer sign in.',
      )
      await queryClient.invalidateQueries({ queryKey: ['admin-participants', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-teams', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function resetParticipantPassword(participant: Participant) {
    if (!isAdmin || !elevated || resetPasswordValue.length < 12) return
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/users/${participant.id}/password-reset`, {
        method: 'POST',
        body: { password: resetPasswordValue },
      })
      setNotice(
        `Password reset for ${participant.email}. All previous sessions and refresh tokens were revoked. Deliver the new password in person or through an organization-approved authenticated one-to-one channel, never in email or a public/team chat.`,
      )
      setResetTarget(null)
      setResetPasswordValue('')
      await queryClient.invalidateQueries({ queryKey: ['admin-participants', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-lg">
      <header className="stack">
        <span className="exhibit-num">ADMINISTRATION</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Participants</h1>
        <p className="muted small" style={{ maxWidth: '80ch' }}>
          Accounts are created by administrators only. No invitation tokens or activation links are issued.
Participants without a password choose one at first sign-in. Staff receive an administrator-assigned password. Organizers can view the roster; only admins can
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

      {isAdmin && (
        <StepUpPanel
          stepUpUntil={stepUpUntil}
          onStepUp={setStepUpUntil}
          nowMs={nowMs}
          note="Staff and participant registration, team creation/changes, removal and password resets require a fresh admin password confirmation, valid for five minutes."
        />
      )}

      {isAdmin && (
        <Panel exhibit="01" title="Register staff account" actions={!elevated ? <StepUpGateHint /> : undefined}>
          <form onSubmit={registerStaff} className="grid-2">
            <Field label="Email address" htmlFor="staff-email" required>
              <input id="staff-email" className="input" type="email" autoComplete="off" required value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} />
            </Field>
            <Field label="Name" htmlFor="staff-name" required>
              <input id="staff-name" className="input" minLength={2} maxLength={160} required value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
            </Field>
            <Field label="Role" htmlFor="staff-role" required>
              <select id="staff-role" className="select" value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value as StaffRole })}>
                <option value="reviewer">Reviewer</option>
                <option value="organizer">Organizer</option>
                <option value="admin">Administrator</option>
              </select>
            </Field>
            <Field label="Initial password" htmlFor="staff-password" required>
              <input id="staff-password" className="input" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} />
            </Field>
            <div className="stack" style={{ gridColumn: '1 / -1' }}>
              <Button type="submit" variant="primary" disabled={busy || !elevated || staffForm.name.trim().length < 2 || staffForm.password.length < 12 || !staffForm.email}>
                Register staff account
              </Button>
              <p className="muted small">Only administrators can create reviewer, organizer and admin accounts. The password is assigned here and cannot be claimed by the account holder.</p>
            </div>
          </form>
        </Panel>
      )}

      {eventId && (
        <>
          <div className="grid-2">
            <Panel exhibit="02" title="Register participant" actions={isAdmin && !elevated ? <StepUpGateHint /> : undefined}>
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
                    Only participants can claim a first password. This event does not verify mailbox ownership, so registered participant emails must be distributed through a controlled channel.
                  </p>
                </form>
              ) : (
                <p className="muted small">Participant registration is restricted to administrators.</p>
              )}
            </Panel>

            <Panel exhibit="03" title="Teams">
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

          <Panel exhibit="04" title="Registered participant roster">
            {participantsQ.isLoading && <LoadingShell label="Loading participants" />}
            {participantsQ.isError && <ErrorBanner error={participantsQ.error} onRetry={() => void participantsQ.refetch()} />}
            {participantsQ.data && participants.length === 0 && <EmptyState title="No participants registered" note="New participant accounts are created from the admin-only form above." />}
            {participants.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Email</th><th>Name</th><th>Team</th><th>Password</th>
                      {isAdmin && <th>Admin actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((participant) => (
                      <tr key={participant.id}>
                        <td className="mono small">{participant.email}</td>
                        <td>{participant.name}</td>
                        <td>{participant.team_name}</td>
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
                                    ref={resetInputRef}
                                    className="input mono-input"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={12}
                                    maxLength={200}
                                    placeholder="New password (12+ chars)"
                                    aria-label={`New password for ${participant.email}`}
                                    value={resetPasswordValue}
                                    onChange={(e) => setResetPasswordValue(e.target.value)}
                                  />
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <Button size="sm" variant="primary" disabled={busy || !elevated || resetPasswordValue.length < 12} onClick={() => void resetParticipantPassword(participant)}>Reset password</Button>
                                    <Button size="sm" variant="ghost" onClick={() => { setResetTarget(null); setResetPasswordValue('') }}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button
                                    ref={(node) => { resetTriggerRefs.current[participant.id] = node }}
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={busy || !elevated}
                                    onClick={() => { setResetTarget(participant.id); setResetPasswordValue('') }}
                                  >Reset password</button>
                                  <ConfirmButton
                                    label="Remove participant"
                                    confirmLabel="Confirm removal"
                                    variant="danger"
                                    disabled={busy || !elevated}
                                    onConfirm={() => void removeParticipant(participant)}
                                  />
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
