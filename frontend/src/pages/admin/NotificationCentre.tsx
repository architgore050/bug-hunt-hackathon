import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel, Button, Chip, EmptyState } from '../../ui/components'
import { fmtDateTime } from '../../lib/format'
import { useAdmin } from '../../admin/store'
import type { NotificationKind, NotificationSeverity } from '../../admin/types'

const KINDS: NotificationKind[] = ['registration', 'csv_import', 'round_change', 'submission', 'score_change', 'flag', 'malpractice', 'server_degraded', 'infrastructure_critical', 'system']
const SEVERITIES: NotificationSeverity[] = ['info', 'warning', 'critical']

function sevTone(s: NotificationSeverity): 'info' | 'warn' | 'danger' {
  if (s === 'critical') return 'danger'
  if (s === 'warning') return 'warn'
  return 'info'
}

export default function NotificationCentre() {
  const { state, markNotificationRead, markAllNotificationsRead } = useAdmin()
  const [kind, setKind] = useState('')
  const [sev, setSev] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)

  let rows = [...state.notifications]
  if (kind) rows = rows.filter((n) => n.kind === kind)
  if (sev) rows = rows.filter((n) => n.severity === sev)
  if (unreadOnly) rows = rows.filter((n) => !n.read)
  const unread = state.notifications.filter((n) => !n.read).length

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">ALERTS</span>
          <h1 className="display admin-page-title">Notification Centre</h1>
          <p className="muted small" style={{ marginTop: 6 }}>{unread} unread. Registration, CSV import, round changes, submissions, score changes, flags, malpractice, server degradation, critical failures.</p>
        </div>
        <Button onClick={() => markAllNotificationsRead()}>Mark all read</Button>
      </div>

      <Panel title="Notifications">
        <div className="admin-toolbar">
          <div className="select-wrap"><select className="select" aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</select></div>
          <div className="select-wrap"><select className="select" aria-label="Filter by severity" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">All severities</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <label className="checkbox-row"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /><span>Unread only</span></label>
        </div>
        {rows.length === 0 ? <EmptyState title="No notifications" note="Adjust filters." /> : (
          <div className="ruled">
            {rows.map((n) => (
              <div key={n.id} className={`feed-item ${n.read ? '' : 'unread'}`} style={{ borderBottom: '1px solid var(--line)' }}>
                <span className="feed-meta">{n.kind.replaceAll('_', ' ')} {'·'} {fmtDateTime(n.timestamp)} <Chip tone={sevTone(n.severity)}>{n.severity}</Chip> {!n.read && <Chip tone="signal">unread</Chip>}</span>
                <span style={{ fontWeight: 600 }}>{n.title}</span>
                <span className="muted small">{n.body}</span>
                <span style={{ display: 'inline-flex', gap: 8, marginTop: 6 }}>
                  {!n.read && <Button size="sm" onClick={() => markNotificationRead(n.id)}>Mark read</Button>}
                  {n.link && <Link to={n.link} className="btn btn-sm">Open</Link>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
