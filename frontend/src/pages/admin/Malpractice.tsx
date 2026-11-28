import { useMemo, useState } from 'react'
import { Panel, Button, Field, Chip, EmptyState, StatusChip } from '../../ui/components'
import { fmtDateTime } from '../../lib/format'
import { useAdmin } from '../../admin/store'
import { Modal, ConfirmDialog, useToast } from '../../admin/ui'
import type { Incident, IncidentSeverity, IncidentStatus, IncidentType } from '../../admin/types'
import { useAuth } from '../../lib/auth'

const TYPES: { value: IncidentType; label: string }[] = [
  { value: 'clipboard_copy', label: 'Clipboard copy' },
  { value: 'clipboard_paste', label: 'Clipboard paste' },
  { value: 'ctrl_c', label: 'Ctrl+C' },
  { value: 'ctrl_v', label: 'Ctrl+V' },
  { value: 'ctrl_shift_i', label: 'Ctrl+Shift+I' },
  { value: 'repeated_suspicious_activity', label: 'Repeated suspicious activity' },
  { value: 'admin_warning', label: 'Admin-issued warning' },
  { value: 'other', label: 'Other configured interaction' },
]

const STATUSES: IncidentStatus[] = ['new', 'under_review', 'confirmed', 'dismissed', 'action_taken']
const SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical']

function typeLabel(t: IncidentType): string {
  return TYPES.find((x) => x.value === t)?.label ?? t
}

function sevTone(s: IncidentSeverity): 'ok' | 'warn' | 'danger' | 'muted' {
  if (s === 'critical' || s === 'high') return 'danger'
  if (s === 'medium') return 'warn'
  return 'muted'
}

export default function Malpractice() {
  const { state } = useAdmin()
  const [tab, setTab] = useState<'incidents' | 'activity'>('incidents')
  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">INTEGRITY</span>
          <h1 className="display admin-page-title">Malpractice & Activity</h1>
          <p className="muted small" style={{ marginTop: 6, maxWidth: '72ch' }}>
            Detections are alerts requiring human review, not proof of cheating. A penalty requires an explicit confirmation
            step. Sample local store.
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'incidents'} className={`tab ${tab === 'incidents' ? 'active' : ''}`} onClick={() => setTab('incidents')}>Incidents ({state.incidents.length})</button>
        <button role="tab" aria-selected={tab === 'activity'} className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Admin activity log ({state.activity.length})</button>
      </div>
      {tab === 'incidents' && <IncidentsPanel />}
      {tab === 'activity' && <ActivityPanel />}
    </div>
  )
}

function IncidentsPanel() {
  const { state, setIncidentStatus, addIncidentNote, issueWarning, applyMalpracticePenalty } = useAdmin()
  const { user } = useAuth()
  const toast = useToast()
  const admin = user?.name || user?.email || 'admin'

  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sevFilter, setSevFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [open, setOpen] = useState<Incident | null>(null)
  const [note, setNote] = useState('')
  const [penalty, setPenalty] = useState<Incident | null>(null)
  const [penaltyAmount, setPenaltyAmount] = useState('5')
  const [penaltyReason, setPenaltyReason] = useState('')
  const [confirmPenalty, setConfirmPenalty] = useState(false)

  const incidents = useMemo(() => {
    let r = [...state.incidents].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    if (typeFilter) r = r.filter((i) => i.type === typeFilter)
    if (statusFilter) r = r.filter((i) => i.status === statusFilter)
    if (sevFilter) r = r.filter((i) => i.severity === sevFilter)
    if (teamFilter) r = r.filter((i) => i.teamId === teamFilter)
    return r
  }, [state.incidents, typeFilter, statusFilter, sevFilter, teamFilter])

  const current = open ? state.incidents.find((i) => i.id === open.id) ?? open : null

  return (
    <Panel title="Incidents">
      <div className="admin-toolbar">
        <div className="select-wrap"><select className="select" aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">All event types</option>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
        <div className="select-wrap"><select className="select" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select></div>
        <div className="select-wrap"><select className="select" aria-label="Filter by severity" value={sevFilter} onChange={(e) => setSevFilter(e.target.value)}><option value="">All severities</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div className="select-wrap"><select className="select" aria-label="Filter by team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}><option value="">All teams</option>{state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>

      {incidents.length === 0 ? <EmptyState title="No incidents" note="No suspicious activity matches these filters." /> : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Malpractice incidents</caption>
            <thead><tr><th scope="col">Team</th><th scope="col">Participant</th><th scope="col">Event</th><th scope="col">Timestamp</th><th scope="col">Round</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td className="small">{i.teamName}</td>
                  <td className="small">{i.participantName ?? '-'}</td>
                  <td className="small">{typeLabel(i.type)}</td>
                  <td className="mono small">{fmtDateTime(i.timestamp)}</td>
                  <td className="small">{i.roundName ?? '-'}</td>
                  <td><Chip tone={sevTone(i.severity)}>{i.severity}</Chip></td>
                  <td><StatusChip value={i.status} /></td>
                  <td><Button size="sm" onClick={() => setOpen(i)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current && (
        <Modal title={`Incident: ${current.teamName}`} onClose={() => setOpen(null)} wide actions={<Button onClick={() => setOpen(null)}>Close</Button>}>
          <div className="kv-grid" style={{ marginBottom: 12 }}>
            <div className="panel-2" style={{ padding: 10 }}><span className="overline">Participant</span><div className="small">{current.participantName ?? '-'}</div></div>
            <div className="panel-2" style={{ padding: 10 }}><span className="overline">Event</span><div className="small">{typeLabel(current.type)}</div></div>
            <div className="panel-2" style={{ padding: 10 }}><span className="overline">Timestamp</span><div className="small mono">{fmtDateTime(current.timestamp)}</div></div>
            <div className="panel-2" style={{ padding: 10 }}><span className="overline">Round</span><div className="small">{current.roundName ?? '-'}</div></div>
          </div>

          <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Status</span>
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {STATUSES.map((s) => <Button key={s} size="sm" disabled={current.status === s} onClick={() => { setIncidentStatus(current.id, s, admin); toast.push({ kind: 'info', title: `Marked ${s.replaceAll('_', ' ')}` }) }}>{s.replaceAll('_', ' ')}</Button>)}
          </div>

          <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Event history</span>
          <div className="ruled" style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
            {current.events.map((e) => <div key={e.id} className="kv-row"><span className="mono small muted">{fmtDateTime(e.timestamp)}</span><span className="small"><span className="mono" style={{ color: 'var(--signal)' }}>{e.kind}</span> {e.detail}</span></div>)}
          </div>

          <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Notes</span>
          <div className="ruled" style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 8 }}>
            {current.notes.length === 0 ? <p className="muted small" style={{ padding: '8px 0' }}>No notes.</p> : current.notes.map((n) => <div key={n.id} className="kv-row"><span className="mono small muted">{fmtDateTime(n.timestamp)} {'·'} {n.admin}</span><span className="small">{n.body}</span></div>)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '1 1 200px' }} placeholder="Add a note" aria-label="Add note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" disabled={!note.trim()} onClick={() => { addIncidentNote(current.id, note.trim(), admin); setNote(''); toast.push({ kind: 'success', title: 'Note added' }) }}>Add note</Button>
          </div>

          <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" disabled={current.status === 'under_review'} onClick={() => setIncidentStatus(current.id, 'under_review', admin)}>Mark for investigation</Button>
            <Button size="sm" disabled={current.warningIssued} onClick={() => { issueWarning(current.id, admin, `Warning issued to ${current.teamName}.`); toast.push({ kind: 'warning', title: 'Warning issued' }) }}>{current.warningIssued ? 'Warning issued' : 'Issue warning'}</Button>
            <Button size="sm" variant="danger" disabled={current.penaltyApplied} onClick={() => setPenalty(current)}>{current.penaltyApplied ? 'Penalty applied' : 'Apply penalty'}</Button>
          </div>
        </Modal>
      )}

      {penalty && (
        <Modal title="Apply malpractice penalty" onClose={() => setPenalty(null)} actions={<><Button onClick={() => setPenalty(null)}>Cancel</Button><Button variant="primary" disabled={!penaltyReason.trim()} onClick={() => setConfirmPenalty(true)}>Review</Button></>}>
          <p className="muted small" style={{ marginTop: 0 }}>Penalty is applied only after this confirmation. It appends a score adjustment and records the incident.</p>
          <div className="stack" style={{ gap: 12 }}>
            <Field label="Penalty amount" htmlFor="pen-amt"><input id="pen-amt" className="input mono" type="number" min={0} step="0.5" value={penaltyAmount} onChange={(e) => setPenaltyAmount(e.target.value)} /></Field>
            <Field label="Reason" htmlFor="pen-reason" required><textarea id="pen-reason" className="textarea" value={penaltyReason} onChange={(e) => setPenaltyReason(e.target.value)} required /></Field>
            <div className="panel-2" style={{ padding: 10 }}><span className="overline">Team</span><div className="small">{penalty.teamName}</div></div>
          </div>
          {confirmPenalty && (
            <ConfirmDialog
              title="Confirm penalty"
              danger
              confirmLabel="Apply penalty"
              message={`Apply -${Math.abs(Number(penaltyAmount) || 0)} to ${penalty.teamName}? This appends a permanent audit record.`}
              onCancel={() => setConfirmPenalty(false)}
              onConfirm={() => { applyMalpracticePenalty(penalty.id, Number(penaltyAmount) || 0, penaltyReason.trim(), admin); toast.push({ kind: 'critical', title: 'Penalty applied', body: penalty.teamName }); setConfirmPenalty(false); setPenalty(null); setPenaltyReason('') }}
            />
          )}
        </Modal>
      )}
    </Panel>
  )
}

function ActivityPanel() {
  const { state } = useAdmin()
  const [actionFilter, setActionFilter] = useState('')
  const [adminFilter, setAdminFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')

  const rows = useMemo(() => {
    let r = [...state.activity]
    if (actionFilter) r = r.filter((a) => a.action.toLowerCase().includes(actionFilter.toLowerCase()))
    if (adminFilter) r = r.filter((a) => a.admin.toLowerCase().includes(adminFilter.toLowerCase()))
    if (targetFilter) r = r.filter((a) => a.targetType === targetFilter)
    return r
  }, [state.activity, actionFilter, adminFilter, targetFilter])

  const targetTypes = [...new Set(state.activity.map((a) => a.targetType))].sort()

  return (
    <Panel title="Admin activity log">
      <div className="admin-toolbar">
        <input className="input" style={{ width: 200 }} placeholder="Filter by action" aria-label="Filter by action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} />
        <input className="input" style={{ width: 180 }} placeholder="Filter by admin" aria-label="Filter by admin" value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} />
        <div className="select-wrap"><select className="select" aria-label="Filter by target" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}><option value="">All targets</option>{targetTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      {rows.length === 0 ? <EmptyState title="No activity" note="Administrative actions are recorded here with previous and new values." /> : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Admin activity</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Admin</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Previous</th><th scope="col">New</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="mono small">{fmtDateTime(a.timestamp)}</td>
                  <td className="small">{a.admin}</td>
                  <td className="mono small" style={{ color: 'var(--signal)' }}>{a.action}</td>
                  <td className="small">{a.targetType}: {a.targetLabel}</td>
                  <td className="small mono">{a.previousValue ?? '-'}</td>
                  <td className="small mono">{a.newValue ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
