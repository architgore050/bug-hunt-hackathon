import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { Wordmark } from '../components/chrome'
import { Button, Chip } from '../ui/components'
import { AdminProvider, useAdmin } from './store'
import { ToastProvider } from './ui'
import { BellIcon, ClipboardCheckIcon, GridIcon, IncidentIcon, KeyIcon, LogoutIcon, MenuIcon, ServerIcon, SlidersIcon, TrophyIcon, UsersIcon } from './icons'
import { SettingsIcon as GearIcon, ShieldIcon, TeamIcon } from '../ui/icons'
import './admin.css'

interface NavItem {
  to: string
  label: string
  end?: boolean
  icon: (props: { size?: number }) => ReactNode
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', end: true, icon: GridIcon },
  { to: '/admin/participants', label: 'Participants & Teams', icon: UsersIcon },
  { to: '/admin/evaluations', label: 'Evaluations', icon: ClipboardCheckIcon },
  { to: '/admin/scoreboard', label: 'Scoreboard', icon: TrophyIcon },
  { to: '/admin/malpractice', label: 'Malpractice & Activity', icon: IncidentIcon },
  { to: '/admin/infrastructure', label: 'Infrastructure', icon: ServerIcon },
  { to: '/admin/event-config', label: 'Event Configuration', icon: SlidersIcon },
  { to: '/admin/admins', label: 'Admin Accounts', icon: KeyIcon },
]

const OPERATIONS_NAV: NavItem[] = [
  { to: '/admin/operations', label: 'Live Operations', icon: ShieldIcon },
  { to: '/admin/challenges', label: 'Challenge Tools', icon: TeamIcon },
  { to: '/admin/notifications', label: 'Notification Centre', icon: BellIcon },
]

const EVENT_TONE: Record<string, string> = {
  Upcoming: 'info',
  'Registration Open': 'ok',
  Live: 'signal',
  Paused: 'warn',
  Completed: 'muted',
}

function NotificationsCentre({ onNavigate }: { onNavigate: (link: string) => void }) {
  const { state, markNotificationRead, markAllNotificationsRead } = useAdmin()
  const [open, setOpen] = useState(false)
  const unread = state.notifications.filter((n) => !n.read).length
  return (
    <div className="notif-anchor">
      <button type="button" className="btn btn-sm" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <BellIcon size={16} />
        {unread > 0 && <span className="badge-count">{unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="panel-head">
            <span className="overline-strong">Notifications</span>
            <Button size="sm" onClick={() => markAllNotificationsRead()}>Mark all read</Button>
          </div>
          {state.notifications.length === 0 && <div className="feed-item muted small">No notifications.</div>}
          {state.notifications.slice(0, 30).map((n) => (
            <div key={n.id} className={`feed-item ${n.read ? '' : 'unread'}`}>
              <button
                type="button"
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
                onClick={() => { markNotificationRead(n.id); if (n.link) { onNavigate(n.link); setOpen(false) } }}
              >
                <span className="feed-meta">{n.kind.replaceAll('_', ' ')} {'·'} {new Date(n.timestamp).toLocaleTimeString()}</span>
                <span style={{ display: 'block', fontWeight: 600 }}>{n.title}</span>
                <span className="muted small" style={{ display: 'block' }}>{n.body}</span>
              </button>
            </div>
          ))}
          <div className="feed-item">
            <Link to="/admin/notifications" onClick={() => setOpen(false)} className="small">Open notification centre</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function ShellInner({ children }: { children: ReactNode }) {
  const { state } = useAdmin()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const eventTone = EVENT_TONE[state.event.eventStatus] ?? 'muted'
  const openIncidents = state.incidents.filter((i) => i.status === 'new' || i.status === 'under_review').length

  async function signOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={`admin-shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-brand">
          <Wordmark to="/admin" />
        </div>
        <div style={{ padding: '4px 8px 8px' }}>
          <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Event</span>
          <span className={`chip chip-tone-${eventTone}`} title="Overall competition status">{state.event.eventStatus}</span>
          <div className="muted small" style={{ marginTop: 6 }}>{state.event.eventName} {'·'} SDC</div>
        </div>
        <nav className="admin-nav" aria-label="Sections">
          <span className="admin-nav-section">Control</span>
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`} onClick={() => setNavOpen(false)}>
                <Icon size={17} />
                <span>{item.label}</span>
                {item.to === '/admin/malpractice' && openIncidents > 0 && <span className="badge-count">{openIncidents}</span>}
              </NavLink>
            )
          })}
          <span className="admin-nav-section">Platform</span>
          {OPERATIONS_NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`} onClick={() => setNavOpen(false)}>
                <Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div style={{ marginTop: 'auto', padding: '12px 8px 4px', borderTop: '1px solid var(--line)' }}>
          <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Signed in</span>
          <div className="small" style={{ wordBreak: 'break-word' }}>{user?.email ?? 'admin'}</div>
          <div className="muted small mono">{user?.role ?? 'admin'}</div>
          <Button size="sm" style={{ marginTop: 10 }} onClick={() => void signOut()}>
            <LogoutIcon size={14} /> Sign out
          </Button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span className="sidebar-toggle"><Button size="sm" ariaLabel="Toggle navigation" onClick={() => setNavOpen((o) => !o)}><MenuIcon size={16} /></Button></span>
            <span className="overline-strong">Bug Hunt CTF {'·'} Admin</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Chip tone={eventTone === 'ok' ? 'ok' : eventTone === 'signal' ? 'signal' : eventTone === 'warn' ? 'warn' : eventTone === 'danger' ? 'danger' : eventTone === 'info' ? 'info' : 'muted'} size="lg">{state.event.eventStatus}</Chip>
            <NotificationsCentre onNavigate={(link) => navigate(link)} />
            <Link to="/admin/event-config" className="btn btn-sm"><GearIcon size={14} /> Config</Link>
          </span>
        </header>
        <main className="admin-content" id="main">{children}</main>
      </div>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <ToastProvider>
        <ShellInner>{children}</ShellInner>
      </ToastProvider>
    </AdminProvider>
  )
}
