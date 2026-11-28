import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { SystemHealth } from '../../lib/types'
import { Panel, Chip, Button, StatusChip } from '../../ui/components'
import { FlagIcon, ClockIcon } from '../../ui/icons'
import { fmtDateTime } from '../../lib/format'
import { useAdmin, teamTotal } from '../../admin/store'
import { StatTile, StatusDot } from '../../admin/ui'
import { PlusIcon, UploadIcon } from '../../admin/icons'

const EVENT_STATUS_TONE: Record<string, 'ok' | 'warn' | 'signal' | 'info' | 'muted'> = {
  Upcoming: 'info',
  'Registration Open': 'ok',
  Live: 'signal',
  Paused: 'warn',
  Completed: 'muted',
}

export default function Overview() {
  const { state } = useAdmin()
  const navigate = useNavigate()

  const healthQ = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api<SystemHealth>('/v1/admin/system/health'),
    refetchInterval: 10_000,
    retry: false,
  })

  const metrics = useMemo(() => {
    const participants = state.participants.filter((p) => p.participationStatus !== 'removed')
    const activeTeams = state.teams.filter((t) => t.status === 'active')
    const activeParticipants = participants.filter((p) => p.participationStatus === 'active')
    const currentRound = state.rounds.find((r) => r.id === state.event.currentRoundId) ?? state.rounds.find((r) => r.status === 'active') ?? null
    const evaluationsCompleted = state.evaluations.filter((e) => e.status === 'published').length
    const questionsConfigured = state.questions.length
    const flagsDiscovered = state.teams.reduce((s, t) => s + t.ctfBonus, 0)
    const malpractice = state.incidents.filter((i) => i.status !== 'dismissed').length
    const openMalpractice = state.incidents.filter((i) => i.status === 'new' || i.status === 'under_review').length
    return { participants, activeTeams, activeParticipants, currentRound, evaluationsCompleted, questionsConfigured, flagsDiscovered, malpractice, openMalpractice }
  }, [state])

  const recentTeams = useMemo(() => {
    return [...state.teams].sort((a, b) => teamTotal(b, state.adjustments) - teamTotal(a, state.adjustments)).slice(0, 5)
  }, [state])

  const serverHealthy = healthQ.data ? healthQ.data.databases.app === 'ok' || String(healthQ.data.databases.app) === 'up' : null

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">OPERATIONS / OVERVIEW</span>
          <h1 className="display admin-page-title">{state.event.eventName} control room</h1>
          <p className="muted small" style={{ marginTop: 6, maxWidth: '70ch' }}>
            {state.event.organizer}. 6 December 2026. 180 minutes. Offline. Teams of 4-5.
          </p>
        </div>
        <span className={`chip chip-lg chip-tone-${EVENT_STATUS_TONE[state.event.eventStatus]}`} style={{ fontSize: 13 }}>
          {state.event.eventStatus}
        </span>
      </div>

      <Panel title="Event status" actions={<Link to="/admin/event-config" className="btn btn-sm">Manage status</Link>}>
        <div className="stat-grid">
          {(['Upcoming', 'Registration Open', 'Live', 'Paused', 'Completed'] as const).map((s) => (
            <div key={s} className="panel-2" style={{ padding: 12, borderColor: s === state.event.eventStatus ? 'var(--signal)' : undefined }}>
              <span className="overline" style={{ display: 'block', marginBottom: 6 }}>{s}</span>
              <StatusDot tone={s === state.event.eventStatus ? (EVENT_STATUS_TONE[s] ?? 'muted') : 'muted'} label={s === state.event.eventStatus ? 'current' : 'inactive'} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="stat-grid">
        <StatTile label="Total participants" value={metrics.participants.length} sub={`of ${state.event.maxParticipants} capacity`} />
        <StatTile label="Total teams" value={state.teams.length} sub={`of ${state.event.maxTeams} capacity`} />
        <StatTile label="Active teams" value={metrics.activeTeams.length} tone="signal" />
        <StatTile label="Active participants" value={metrics.activeParticipants.length} tone="ok" />
        <StatTile label="Current round" value={metrics.currentRound ? String(metrics.currentRound.order) : '-'} sub={metrics.currentRound?.name ?? 'none active'} />
        <StatTile label="Questions configured" value={metrics.questionsConfigured} />
        <StatTile label="Evaluations completed" value={metrics.evaluationsCompleted} sub={`${state.evaluations.length} total`} />
        <StatTile label="Flags discovered" value={metrics.flagsDiscovered} tone="signal" />
        <StatTile label="Malpractice incidents" value={metrics.malpractice} sub={metrics.openMalpractice > 0 ? `${metrics.openMalpractice} open` : 'none open'} tone={metrics.openMalpractice > 0 ? 'warn' : 'ok'} />
        <StatTile
          label="Server health"
          value={healthQ.isLoading ? '...' : healthQ.isError ? 'unknown' : serverHealthy ? 'Operational' : 'Check'}
          tone={healthQ.isError ? 'muted' : serverHealthy ? 'ok' : 'warn'}
          sub={healthQ.isError ? 'monitoring API unreachable' : 'from /v1/admin/system/health'}
        />
      </div>

      <div className="two-col">
        <Panel title="Live activity feed" actions={<Chip tone="signal" size="lg">chronological</Chip>}>
          <div className="ruled" style={{ maxHeight: 460, overflowY: 'auto' }}>
            {state.activity.length === 0 && <p className="muted small">No activity recorded yet.</p>}
            {state.activity.slice(0, 40).map((a) => (
              <div key={a.id} className="activity-row">
                <span className="mono small muted">{fmtDateTime(a.timestamp)}</span>
                <span>
                  <span className="mono small" style={{ color: 'var(--signal)' }}>{a.action}</span>{' '}
                  <span>{a.targetLabel}</span>{' '}
                  {a.previousValue != null && a.newValue != null && (
                    <span className="muted small mono">{a.previousValue} {'->'} {a.newValue}</span>
                  )}
                  {a.newValue != null && a.previousValue == null && <span className="muted small mono">{a.newValue}</span>}
                  <span className="muted small" style={{ display: 'block' }}>by {a.admin} {'·'} {a.targetType}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="stack">
          <Panel title="Quick actions">
            <div style={{ display: 'grid', gap: 8 }}>
              <Button onClick={() => navigate('/admin/participants?csv=1')}><UploadIcon size={15} /> Import participants CSV</Button>
              <Button onClick={() => navigate('/admin/participants?newTeam=1')}><PlusIcon size={15} /> Add a team</Button>
              <Button onClick={() => navigate('/admin/evaluations?newEval=1')}><PlusIcon size={15} /> Create evaluation</Button>
              <Button onClick={() => navigate('/admin/evaluations?newQuestion=1')}><PlusIcon size={15} /> Add question</Button>
              <Button onClick={() => navigate('/admin/evaluations?assignRepo=1')}><PlusIcon size={15} /> Assign repository</Button>
              <Button onClick={() => navigate('/admin/scoreboard?adjust=1')}><PlusIcon size={15} /> Adjust team score</Button>
              <Button variant="primary" onClick={() => navigate('/admin/operations')}><FlagIcon size={15} /> Open live monitoring</Button>
            </div>
          </Panel>

          <Panel title="Server status">
            {healthQ.isLoading && <span className="loading-inline">Loading</span>}
            {healthQ.isError && <p className="muted small">Monitoring API unreachable. See the Infrastructure page for demo service status.</p>}
            {healthQ.data && (
              <div className="ruled">
                <div className="kv-row"><span className="kv-key">database app</span><span className="kv-val"><StatusChip value={String(healthQ.data.databases.app)} /></span></div>
                <div className="kv-row"><span className="kv-key">database gt</span><span className="kv-val"><StatusChip value={String(healthQ.data.databases.gt)} /></span></div>
                <div className="kv-row"><span className="kv-key">environment</span><span className="kv-val">{healthQ.data.environment}</span></div>
                <div className="kv-row"><span className="kv-key">runner</span><span className="kv-val">{healthQ.data.runner_enabled ? 'enabled' : 'disabled'}</span></div>
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <Link to="/admin/infrastructure" className="btn btn-sm"><ClockIcon size={13} /> Infrastructure detail</Link>
            </div>
          </Panel>

          <Panel title="Leading teams">
            <div className="ruled">
              {recentTeams.map((t, i) => (
                <div key={t.id} className="kv-row">
                  <span><span className="mono muted">{i + 1}</span> {t.name}</span>
                  <span className="kv-val" style={{ color: 'var(--signal)' }}>{teamTotal(t, state.adjustments)}</span>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Sample data. Functional repair primary; CTF bonus separate.</p>
          </Panel>
        </div>
      </div>

      <p className="muted small">
        Sections marked sample data run on a local in-browser store for this preview; live operations, challenge tools and
        system health read the real platform API.
      </p>
    </div>
  )
}
