import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { AdminEvent, LiveOps } from '../../lib/types'
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

interface ConfigRevision {
  version: number
  config: Record<string, unknown>
  rule_set_hash: string
  reason: string
  created_at: string
  frozen_at: string | null
}

const TIME_REASONS = ['ACCOMMODATION', 'OUTAGE', 'DEVICE_FAILURE', 'OTHER'] as const

export default function AdminSetup() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const eventsQ = useQuery({
    queryKey: ['admin-events'],
    queryFn: () => api<{ events: AdminEvent[] }>('/v1/admin/events'),
  })
  const [eventId, setEventId] = useState('')
  const [stageId, setStageId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stepUpUntil, setStepUpUntil] = useState<number | null>(null)
  const elevated = stepUpUntil !== null && stepUpUntil > Date.now()

  const liveQ = useQuery({
    queryKey: ['admin-live', eventId],
    queryFn: () => api<LiveOps>(`/v1/admin/events/${eventId}/live`),
    enabled: !!eventId,
  })
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
  const configQ = useQuery({
    queryKey: ['admin-config-revisions', eventId],
    queryFn: () => api<{
      config_version: number
      current_config: Record<string, unknown>
      revisions: ConfigRevision[]
    }>(`/v1/admin/events/${eventId}/config/revisions`),
    enabled: !!eventId,
  })

  const selectedEvent = useMemo(
    () => eventsQ.data?.events.find((event) => event.id === eventId) ?? null,
    [eventsQ.data, eventId],
  )
  const stages = liveQ.data?.stages ?? []
  const teams = teamsQ.data?.teams ?? []
  const participants = participantsQ.data?.participants ?? []

  const [stageForm, setStageForm] = useState({ name: '', kind: 'main', grace: '3' })
  const [teamName, setTeamName] = useState('')
  const [configText, setConfigText] = useState('')
  const [configDirty, setConfigDirty] = useState(false)
  const [configReason, setConfigReason] = useState('')
  const [freezeConfig, setFreezeConfig] = useState(false)
  const [timeForm, setTimeForm] = useState({ delta: '300', reason: 'OUTAGE', user_id: '' })
  const [scoreForm, setScoreForm] = useState({ team_id: '', points: '', reason: '', confirmed: false })

  useEffect(() => {
    if (!eventId && eventsQ.data?.events.length) setEventId(eventsQ.data.events[0].id)
  }, [eventsQ.data, eventId])

  useEffect(() => {
    if (!stageId || !stages.some((stage) => stage.id === stageId)) {
      setStageId(stages[0]?.id ?? '')
    }
  }, [stages, stageId])

  useEffect(() => {
    if (!configDirty && configQ.data) setConfigText(JSON.stringify(configQ.data.current_config ?? {}, null, 2))
  }, [configQ.data, configDirty])

  useEffect(() => {
    setStageForm({ name: '', kind: 'main', grace: '3' })
    setTeamName('')
    setConfigDirty(false)
    setConfigReason('')
    setFreezeConfig(false)
    setTimeForm({ delta: '300', reason: 'OUTAGE', user_id: '' })
    setScoreForm({ team_id: '', points: '', reason: '', confirmed: false })
    setNotice(null)
    setError(null)
  }, [eventId])

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  function showError(err: unknown) {
    setError(err instanceof ApiRequestError ? adminErrorText(err) : err instanceof Error ? err.message : 'The operation failed.')
  }

  async function createStage(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId) return
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/events/${eventId}/stages`, {
        method: 'POST',
        body: {
          name: stageForm.name.trim(),
          kind: stageForm.kind,
          grace_seconds: Number(stageForm.grace),
          config: {},
        },
      })
      setStageForm({ name: '', kind: 'main', grace: '3' })
      setNotice('Stage created.')
      await queryClient.invalidateQueries({ queryKey: ['admin-live', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId) return
    setBusy(true)
    clearMessages()
    try {
      const result = await api<{ team_id: string; join_code: string }>(`/v1/admin/events/${eventId}/teams`, {
        method: 'POST',
        body: { name: teamName.trim() },
      })
      setTeamName('')
      setNotice(`Team created. Initial join code: ${result.join_code}. Keep this code private and distribute it securely.`)
      await queryClient.invalidateQueries({ queryKey: ['admin-teams', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-live', eventId] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId) return
    setBusy(true)
    clearMessages()
    try {
      const parsed: unknown = JSON.parse(configText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Configuration must be a JSON object.')
      }
      await api(`/v1/admin/events/${eventId}/config`, {
        method: 'POST',
        body: { config: parsed, reason: configReason.trim(), freeze: freezeConfig },
      })
      setNotice('Configuration revision saved.')
      setConfigDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['admin-config-revisions', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-events'] })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function adjustTime(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId || !stageId) return
    setBusy(true)
    clearMessages()
    try {
      await api(`/v1/admin/events/${eventId}/time-adjustment`, {
        method: 'POST',
        body: {
          stage_id: stageId,
          delta_seconds: Number(timeForm.delta),
          reason_code: timeForm.reason,
          user_id: timeForm.user_id || null,
        },
      })
      setNotice('Time adjustment recorded.')
      setTimeForm((old) => ({ ...old, user_id: '' }))
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  async function adjustScore(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin || !elevated || !stageId || !scoreForm.team_id || !scoreForm.reason.trim() || !scoreForm.confirmed) return
    setBusy(true)
    clearMessages()
    try {
      await api('/v1/admin/adjustments', {
        method: 'POST',
        body: {
          stage_id: stageId,
          team_id: scoreForm.team_id,
          points: Number(scoreForm.points),
          reason: scoreForm.reason.trim(),
        },
      })
      setNotice('Manual score adjustment appended to the score ledger.')
      setScoreForm({ team_id: '', points: '', reason: '', confirmed: false })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-lg">
      <header className="stack">
        <span className="exhibit-num">EVENT CONFIGURATION</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Setup &amp; scoring</h1>
        <p className="muted small" style={{ maxWidth: '80ch' }}>
          Create stages and teams, manage event configuration revisions, adjust stage time and append audited score adjustments.
        </p>
        <div className="field" style={{ width: 440, maxWidth: '100%' }}>
          <label className="field-label" htmlFor="setup-event">Event</label>
          <div className="select-wrap">
            <select id="setup-event" className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Select event</option>
              {(eventsQ.data?.events ?? []).map((event) => <option key={event.id} value={event.id}>{event.name} ({event.status})</option>)}
            </select>
          </div>
        </div>
        {selectedEvent && <div className="small muted mono">{selectedEvent.slug} · config v{selectedEvent.config_version} · {selectedEvent.timezone}</div>}
      </header>

      {eventsQ.isLoading && <LoadingShell label="Loading events" />}
      {eventsQ.isError && <ErrorBanner error={eventsQ.error} onRetry={() => void eventsQ.refetch()} />}
      {error && <div className="banner banner-tone-danger" role="alert">{error}</div>}
      {notice && <div className="banner banner-tone-ok" role="status">{notice}</div>}
      {!eventId && eventsQ.data && <EmptyState title="Select an event" note="Create an event in Operations before setting up its stages and teams." />}

      {eventId && (
        <>
          {isAdmin && (
            <StepUpPanel
              stepUpUntil={stepUpUntil}
              onStepUp={setStepUpUntil}
              note="Manual score adjustments require admin access and a fresh password confirmation."
            />
          )}

          <div className="grid-2">
            <Panel exhibit="01" title="Create stage">
              <form onSubmit={createStage} className="stack" style={{ gap: 12 }}>
                <Field label="Stage name" htmlFor="stage-name" required>
                  <input id="stage-name" className="input" minLength={2} maxLength={120} required value={stageForm.name} onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })} />
                </Field>
                <div className="grid-2">
                  <Field label="Stage kind" htmlFor="stage-kind" required>
                    <select id="stage-kind" className="select" value={stageForm.kind} onChange={(e) => setStageForm({ ...stageForm, kind: e.target.value })}>
                      <option value="main">main</option><option value="practice">practice</option><option value="bonus">bonus</option>
                    </select>
                  </Field>
                  <Field label="Grace seconds" htmlFor="stage-grace">
                    <input id="stage-grace" className="input mono-input" type="number" min={0} max={3600} value={stageForm.grace} onChange={(e) => setStageForm({ ...stageForm, grace: e.target.value })} />
                  </Field>
                </div>
                <Button type="submit" variant="primary" disabled={busy || stageForm.name.trim().length < 2}>Create stage</Button>
              </form>
              <div className="ruled" style={{ marginTop: 14 }}>
                {liveQ.isLoading && <LoadingShell label="Loading stages" />}
                {liveQ.isError && <ErrorBanner error={liveQ.error} onRetry={() => void liveQ.refetch()} />}
                {stages.map((stage) => (
                  <div className="kv-row" key={stage.id}>
                    <span>{stage.name}</span><StatusChip value={stage.status} />
                  </div>
                ))}
                {liveQ.data && stages.length === 0 && <p className="muted small">No stages exist yet.</p>}
              </div>
            </Panel>

            <Panel exhibit="02" title="Create team">
              <form onSubmit={createTeam} className="stack" style={{ gap: 12 }}>
                <Field label="Team name" htmlFor="team-name" required>
                  <input id="team-name" className="input" minLength={2} maxLength={120} required value={teamName} onChange={(e) => setTeamName(e.target.value)} />
                </Field>
                <Button type="submit" variant="primary" disabled={busy || teamName.trim().length < 2}>Create team</Button>
              </form>
              <div className="ruled" style={{ marginTop: 14 }}>
                {teamsQ.isLoading && <LoadingShell label="Loading teams" />}
                {teamsQ.isError && <ErrorBanner error={teamsQ.error} onRetry={() => void teamsQ.refetch()} />}
                {teams.map((team) => <div className="kv-row" key={team.id}><span>{team.name}</span><Chip>{team.member_count} members</Chip></div>)}
                {teamsQ.data && teams.length === 0 && <p className="muted small">No teams created.</p>}
              </div>
            </Panel>
          </div>

          <Panel exhibit="03" title="Event configuration revisions">
            {configQ.isLoading && <LoadingShell label="Loading configuration" />}
            {configQ.isError && <ErrorBanner error={configQ.error} onRetry={() => void configQ.refetch()} />}
            {configQ.data && (
              <>
                <div className="small muted">Current configuration version: <strong>{configQ.data.config_version}</strong></div>
                <form onSubmit={saveConfig} className="stack" style={{ gap: 12, marginTop: 12 }}>
                  <Field label="Configuration JSON" htmlFor="event-config" required>
                    <textarea id="event-config" className="textarea mono-input" rows={12} spellCheck={false} required value={configText} onChange={(e) => { setConfigText(e.target.value); setConfigDirty(true) }} />
                  </Field>
                  <Field label="Revision reason" htmlFor="config-reason" required>
                    <input id="config-reason" className="input" minLength={5} maxLength={500} required value={configReason} onChange={(e) => setConfigReason(e.target.value)} />
                  </Field>
                  <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={freezeConfig} onChange={(e) => setFreezeConfig(e.target.checked)} />
                    Freeze this revision into the active event configuration
                  </label>
                  <Button type="submit" variant="primary" disabled={busy || !configDirty || configReason.trim().length < 5}>Save revision</Button>
                </form>
                <div className="ruled" style={{ marginTop: 18 }}>
                  <div className="overline" style={{ padding: '10px 0' }}>History</div>
                  {configQ.data.revisions.length === 0 && <p className="muted small">No revisions yet.</p>}
                  {configQ.data.revisions.map((revision) => (
                    <div className="kv-row" key={revision.version} style={{ alignItems: 'flex-start' }}>
                      <div>
                        <strong>v{revision.version}</strong> {revision.frozen_at && <Chip tone="ok">frozen</Chip>}
                        <div className="muted small">{revision.reason}</div>
                        <div className="mono small muted">{revision.rule_set_hash}</div>
                      </div>
                      <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
                        <span className="muted small">{new Date(revision.created_at).toLocaleString()}</span>
                        <Button size="sm" onClick={() => { setConfigText(JSON.stringify(revision.config, null, 2)); setConfigReason(`New revision based on v${revision.version}`); setFreezeConfig(false); setConfigDirty(true) }}>Load into editor</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>

          <Panel exhibit="04" title="Time adjustment">
            <form onSubmit={adjustTime} className="stack" style={{ gap: 12 }}>
              <div className="grid-2">
                <Field label="Stage" htmlFor="time-stage" required>
                  <select id="time-stage" className="select" value={stageId} onChange={(e) => setStageId(e.target.value)} required>
                    <option value="">Select stage</option>
                    {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name} ({stage.status})</option>)}
                  </select>
                </Field>
                <Field label="Time delta (seconds)" htmlFor="time-delta" required>
                  <input id="time-delta" className="input mono-input" type="number" min={-86400} max={86400} step={1} required value={timeForm.delta} onChange={(e) => setTimeForm({ ...timeForm, delta: e.target.value })} />
                </Field>
                <Field label="Reason" htmlFor="time-reason" required>
                  <select id="time-reason" className="select" value={timeForm.reason} onChange={(e) => setTimeForm({ ...timeForm, reason: e.target.value })}>
                    {TIME_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
                  </select>
                </Field>
                <Field label="Participant (optional)" htmlFor="time-participant">
                  <select id="time-participant" className="select" value={timeForm.user_id} onChange={(e) => setTimeForm({ ...timeForm, user_id: e.target.value })}>
                    <option value="">Whole stage</option>
                    {participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.email}</option>)}
                  </select>
                </Field>
              </div>
              <Button type="submit" variant="primary" disabled={busy || !stageId || Number(timeForm.delta) === 0}>Record time adjustment</Button>
            </form>
          </Panel>

          {isAdmin && (
            <Panel exhibit="05" title="Manual score adjustment" actions={!elevated ? <StepUpGateHint /> : undefined}>
              <form onSubmit={adjustScore} className="stack" style={{ gap: 12 }}>
                <div className="grid-2">
                  <Field label="Stage" htmlFor="score-stage" required>
                    <select id="score-stage" className="select" value={stageId} onChange={(e) => setStageId(e.target.value)} required>
                      <option value="">Select stage</option>
                      {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Team" htmlFor="score-team" required>
                    <select id="score-team" className="select" value={scoreForm.team_id} onChange={(e) => setScoreForm({ ...scoreForm, team_id: e.target.value })} required>
                      <option value="">Select team</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Points (+/-)" htmlFor="score-points" required>
                    <input id="score-points" className="input mono-input" type="number" min={-10000} max={10000} step="0.01" required value={scoreForm.points} onChange={(e) => setScoreForm({ ...scoreForm, points: e.target.value })} />
                  </Field>
                  <Field label="Audit reason" htmlFor="score-reason" required>
                    <input id="score-reason" className="input" minLength={5} maxLength={1000} required value={scoreForm.reason} onChange={(e) => setScoreForm({ ...scoreForm, reason: e.target.value })} />
                  </Field>
                </div>
                <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={scoreForm.confirmed} onChange={(e) => setScoreForm({ ...scoreForm, confirmed: e.target.checked })} />
                  I understand this creates an append-only score-ledger entry.
                </label>
                <Button type="submit" variant="danger" disabled={busy || !elevated || !scoreForm.confirmed || !stageId || !scoreForm.team_id || !scoreForm.reason.trim() || !Number(scoreForm.points)}>
                  Append score adjustment
                </Button>
              </form>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
