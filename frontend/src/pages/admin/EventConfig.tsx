import { useState } from 'react'
import { Panel, Button, Field, Chip, StatusChip } from '../../ui/components'
import { useAdmin } from '../../admin/store'
import { useToast } from '../../admin/ui'
import type { EventStatus } from '../../admin/types'

const EVENT_STATUSES: EventStatus[] = ['Upcoming', 'Registration Open', 'Live', 'Paused', 'Completed']
const ADMIN_ROLES = ['super_admin', 'admin', 'organizer', 'viewer'] as const

export default function EventConfig() {
  const { state, updateEvent, setEventStatus, setPermission, resetWorkspace } = useAdmin()
  const toast = useToast()
  const [tab, setTab] = useState<'event' | 'rounds' | 'permissions'>('event')
  const ev = state.event

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">CONFIGURATION</span>
          <h1 className="display admin-page-title">Event Configuration</h1>
          <p className="muted small" style={{ marginTop: 6 }}>Event settings, rounds, permissions and event-wide configuration. Sample local store.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'event'} className={`tab ${tab === 'event' ? 'active' : ''}`} onClick={() => setTab('event')}>Event settings</button>
        <button role="tab" aria-selected={tab === 'rounds'} className={`tab ${tab === 'rounds' ? 'active' : ''}`} onClick={() => setTab('rounds')}>Rounds ({state.rounds.length})</button>
        <button role="tab" aria-selected={tab === 'permissions'} className={`tab ${tab === 'permissions' ? 'active' : ''}`} onClick={() => setTab('permissions')}>Permissions</button>
      </div>

      {tab === 'event' && (
        <Panel title="Event settings">
          <div className="stack" style={{ gap: 14 }}>
            <div className="grid-split">
              <Field label="Event name" htmlFor="cfg-name"><input id="cfg-name" className="input" value={ev.eventName} onChange={(e) => updateEvent({ eventName: e.target.value })} /></Field>
              <Field label="Organizer" htmlFor="cfg-org"><input id="cfg-org" className="input" value={ev.organizer} onChange={(e) => updateEvent({ organizer: e.target.value })} /></Field>
            </div>
            <div className="grid-split">
              <Field label="Overall status" htmlFor="cfg-status">
                <div className="select-wrap"><select id="cfg-status" className="select" value={ev.eventStatus} onChange={(e) => { setEventStatus(e.target.value as EventStatus); toast.push({ kind: 'info', title: 'Event status changed', body: e.target.value }) }}>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              </Field>
              <Field label="Timezone" htmlFor="cfg-tz"><input id="cfg-tz" className="input mono" value={ev.timezone} onChange={(e) => updateEvent({ timezone: e.target.value })} /></Field>
            </div>
            <div className="grid-split">
              <Field label="Max participants" htmlFor="cfg-mp"><input id="cfg-mp" className="input mono" type="number" min={1} value={ev.maxParticipants} onChange={(e) => updateEvent({ maxParticipants: Number(e.target.value) || 0 })} /></Field>
              <Field label="Max teams" htmlFor="cfg-mt"><input id="cfg-mt" className="input mono" type="number" min={1} value={ev.maxTeams} onChange={(e) => updateEvent({ maxTeams: Number(e.target.value) || 0 })} /></Field>
            </div>
            <div className="grid-split">
              <Field label="Team size min" htmlFor="cfg-tmin"><input id="cfg-tmin" className="input mono" type="number" min={1} value={ev.teamSizeMin} onChange={(e) => updateEvent({ teamSizeMin: Number(e.target.value) || 1 })} /></Field>
              <Field label="Team size max" htmlFor="cfg-tmax"><input id="cfg-tmax" className="input mono" type="number" min={1} value={ev.teamSizeMax} onChange={(e) => updateEvent({ teamSizeMax: Number(e.target.value) || 1 })} /></Field>
            </div>
            <label className="checkbox-row"><input type="checkbox" checked={ev.registrationOpen} onChange={(e) => updateEvent({ registrationOpen: e.target.checked })} /><span>Registration open</span></label>
            <Field label="Scoring notes" htmlFor="cfg-scoring"><textarea id="cfg-scoring" className="textarea" value={ev.scoringNotes} onChange={(e) => updateEvent({ scoringNotes: e.target.value })} /></Field>
            <div className="panel-2" style={{ padding: 12 }}>
              <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Official preset</span>
              <p className="small muted" style={{ margin: 0 }}>Fall Back. 6 December 2026. 180 minutes. Offline. Teams of 4-5. SDC, VIT Bhopal University.</p>
            </div>
            <div>
              <Button variant="danger" onClick={() => { if (window.confirm('Reset the local admin workspace to seed data? This clears local changes.')) { resetWorkspace(); toast.push({ kind: 'warning', title: 'Workspace reset to sample data' }) } }}>Reset sample workspace</Button>
            </div>
          </div>
        </Panel>
      )}

      {tab === 'rounds' && (
        <Panel title="Round overview">
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Rounds</caption>
              <thead><tr><th scope="col">Round</th><th scope="col">Duration</th><th scope="col">Active</th><th scope="col">Status</th><th scope="col">Current</th></tr></thead>
              <tbody>
                {[...state.rounds].sort((a, b) => a.order - b.order).map((r) => (
                  <tr key={r.id}>
                    <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="muted small">{r.description}</div></td>
                    <td className="mono small">{r.durationMinutes} min</td>
                    <td><Chip tone={r.active ? 'ok' : 'muted'}>{r.active ? 'active' : 'inactive'}</Chip></td>
                    <td><StatusChip value={r.status} /></td>
                    <td>{ev.currentRoundId === r.id ? <Chip tone="signal">current</Chip> : <span className="muted small">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>Manage rounds in the Evaluations section. <Button size="sm" onClick={() => setTab('event')}>Back to settings</Button></p>
        </Panel>
      )}

      {tab === 'permissions' && (
        <Panel title="Role-based permissions">
          <p className="muted small" style={{ marginTop: 0 }}>Administrative routes are protected; these toggles record intended role permissions. Server enforcement is separate.</p>
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Permissions</caption>
              <thead><tr><th scope="col">Permission</th><th scope="col">Description</th>{ADMIN_ROLES.map((r) => <th key={r} scope="col" className="num">{r.replaceAll('_', ' ')}</th>)}</tr></thead>
              <tbody>
                {state.permissions.map((p) => (
                  <tr key={p.permission}>
                    <td className="mono small">{p.permission}</td>
                    <td className="small muted">{p.description}</td>
                    {ADMIN_ROLES.map((role) => (
                      <td key={role} className="num">
                        <input type="checkbox" aria-label={`${p.permission} for ${role}`} checked={p.roles[role]} onChange={(e) => setPermission(p.permission, role, e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}
