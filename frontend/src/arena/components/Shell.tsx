import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AI_NOTICE, EVENT, LEVEL_POLICY } from '../config'
import { useArena } from '../state/ArenaProvider'
import { Icon, type IconName } from '../ui/Icons'
import { Button, Chip, Modal } from '../ui/primitives'

const NAV: Array<{ id: string; label: string; path: string; icon: IconName; minLevel?: number }> = [
  { id: 'overview', label: 'Overview', path: '/arena/overview', icon: 'overview' },
  { id: 'level', label: 'Current Level', path: '/arena/level', icon: 'level' },
  { id: 'questions', label: 'Challenges', path: '/arena/questions', icon: 'questions' },
  { id: 'repository', label: 'Repository', path: '/arena/repository', icon: 'repo' },
  { id: 'workspace', label: 'Code Workspace', path: '/arena/workspace', icon: 'workspace', minLevel: 3 },
  { id: 'flags', label: 'Flag Submissions', path: '/arena/flags', icon: 'flag' },
  { id: 'team', label: 'Team', path: '/arena/team', icon: 'team' },
  { id: 'leaderboard', label: 'Leaderboard', path: '/arena/leaderboard', icon: 'leaderboard' },
]

function useCountdown() {
  const [end] = useState(() => Date.now() + (2 * 60 + 17) * 60 * 1000)
  const [remaining, setRemaining] = useState(() => end - Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setRemaining(Math.max(0, end - Date.now())), 1000)
    return () => window.clearInterval(id)
  }, [end])
  const total = Math.floor(remaining / 1000)
  const hours = String(Math.floor(total / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function Topbar() {
  const { team, currentLevel, unreadCount, notificationsOpen, setNotificationsOpen, notices, markAllRead, markRead, user, pushToast } = useArena()
  const countdown = useCountdown()
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <header className="ar-topbar">
      <div className="ar-topbar__brand">
        <Link to="/arena/overview" className="ar-brand" aria-label="The Fall Back home">
          <span className="ar-brand__mark">SDC</span>
          <span className="ar-brand__text">
            <strong>THE FALL BACK</strong>
            <small>{EVENT.organiser} · {EVENT.edition}</small>
          </span>
        </Link>
        <span className="ar-live"><i />LIVE</span>
      </div>

      <div className="ar-topbar__meta">
        <button className="ar-meta-btn" onClick={() => pushToast('Team profile opened')}>
          <Icon name="team" size={14} />
          <span><strong>{team?.name ?? 'Loading team'}</strong><small>{team?.id ?? 'TB-0000'}</small></span>
        </button>
        <Chip tone="signal">LEVEL {currentLevel}</Chip>
        <div className="ar-countdown" title="Time remaining">
          <Icon name="clock" size={14} />
          <span>{countdown}</span>
        </div>

        <div className="ar-topbar__actions">
          <div className="ar-popover-anchor">
            <button className="ar-icon-btn ar-icon-btn--bell" aria-label={`Notifications, ${unreadCount} unread`}
              aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}>
              <Icon name="bell" />
              {unreadCount > 0 && <span className="ar-badge">{unreadCount}</span>}
            </button>
            {notificationsOpen && (
              <div className="ar-popover ar-popover--notices">
                <div className="ar-popover__head">
                  <strong>Notifications</strong>
                  <button className="ar-link" onClick={markAllRead}>Mark all read</button>
                </div>
                <div className="ar-popover__list">
                  {notices.slice(0, 6).map((notice) => (
                    <button key={notice.id} className={`ar-notice ${notice.read ? '' : 'is-unread'}`}
                      onClick={() => markRead(notice.id)}>
                      <span className="ar-notice__dot" />
                      <span>
                        <strong>{notice.title}</strong>
                        <small>{notice.body}</small>
                        <em>{notice.time}</em>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="ar-popover__foot">
                  <Link to="/arena/notifications" onClick={() => setNotificationsOpen(false)}>Open notification centre</Link>
                </div>
              </div>
            )}
          </div>

          <div className="ar-popover-anchor">
            <button className="ar-avatar" aria-label="Participant menu" aria-expanded={profileOpen}
              onClick={() => setProfileOpen(!profileOpen)}>{user?.initials ?? 'TR'}</button>
            {profileOpen && (
              <div className="ar-popover ar-popover--profile">
                <div className="ar-popover__head"><strong>{user?.name ?? 'Participant'}</strong></div>
                <Link to="/arena/team" onClick={() => setProfileOpen(false)}>Team workspace</Link>
                <Link to="/arena/leaderboard" onClick={() => setProfileOpen(false)}>Leaderboard</Link>
                <button onClick={() => { setProfileOpen(false); pushToast('Signed in as demo participant') }}>Account</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function Sidebar() {
  const { currentLevel, requestLevel, sidebarCollapsed, setSidebarCollapsed, levels } = useArena()
  const navigate = useNavigate()

  const goLevel = (level: number) => {
    requestLevel(level)
    navigate('/arena/level')
  }

  return (
    <aside className={`ar-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <div className="ar-sidebar__top">
        <span className="ar-overline">Workspace</span>
        <button className="ar-icon-btn" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
          <Icon name={sidebarCollapsed ? 'chevron-right' : 'menu'} size={14} />
        </button>
      </div>

      <nav className="ar-nav" aria-label="Competition sections">
        {NAV.map((item) => {
          const locked = item.minLevel !== undefined && currentLevel < item.minLevel
          return (
            <NavLink key={item.id} to={item.path}
              className={({ isActive }) => `ar-nav__item ${isActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
              onClick={(event) => {
                if (locked) {
                  event.preventDefault()
                  navigate('/arena/level')
                  return
                }
                if (item.id === 'level') goLevel(currentLevel)
              }}>
              <Icon name={locked ? 'lock' : item.icon} size={15} />
              <span>{item.label}</span>
              {locked && <small>L{item.minLevel}</small>}
            </NavLink>
          )
        })}
      </nav>

      <div className="ar-sidebar__levels">
        <div className="ar-overline">Progression</div>
        {levels.map((level) => (
          <button key={level.number} onClick={() => goLevel(level.number)}
            className={`ar-level-link is-${level.state} ${level.number === currentLevel ? 'is-current' : ''}`}>
            <span className="ar-level-link__no">{String(level.number).padStart(2, '0')}</span>
            <span className="ar-level-link__name">{level.name}</span>
            {level.number === 4 && <Icon name="lock" size={12} />}
          </button>
        ))}
      </div>

      <div className="ar-sidebar__foot">
        <div className="ar-overline">Policy</div>
        <div className="ar-policy-mini"><Icon name={LEVEL_POLICY[currentLevel].aiAllowed ? 'chat' : 'lock'} size={13} />
          {LEVEL_POLICY[currentLevel].aiAllowed ? 'AI enabled' : 'AI disabled'}
        </div>
      </div>
    </aside>
  )
}

function Overlays() {
  const { pendingLevel, confirmLevel, cancelLevel, toasts, dismissToast, restrictionNotice, clearRestrictionNotice } = useArena()
  return (
    <>
      <div className="ar-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`ar-toast is-${toast.tone}`}>
            <Icon name={toast.tone === 'ok' ? 'check' : toast.tone === 'warn' || toast.tone === 'danger' ? 'warning' : 'inbox'} size={14} />
            <span>{toast.message}</span>
            <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss"><Icon name="close" size={12} /></button>
          </div>
        ))}
      </div>

      {restrictionNotice && (
        <div className="ar-restriction-notice" role="status" onClick={clearRestrictionNotice}>
          <Icon name="shield" size={14} /> {restrictionNotice}
        </div>
      )}

      {pendingLevel === 4 && (
        <Modal eyebrow="Rules change" title="Entering the final challenge"
          onClose={cancelLevel}
          footer={<>
            <Button variant="ghost" onClick={cancelLevel}>Stay on level 3</Button>
            <Button variant="primary" icon="lock" onClick={confirmLevel}>Enter level 4</Button>
          </>}>
          <div className="ar-transition">
            <div className="ar-transition__badge"><Icon name="lock" size={26} /></div>
            <p>Level 4 issues a new repository, marina, and changes the rules for the rest of the event.</p>
            <ul>
              <li><Icon name="chat" size={14} /> AI assistance is removed and no AI controls remain in the workspace.</li>
              <li><Icon name="shield" size={14} /> Copy, paste and browser developer tools are restricted again.</li>
              <li><Icon name="repo" size={14} /> Your Level 3 workspace state stays intact.</li>
            </ul>
            <div className="ar-transition__notice">{AI_NOTICE}</div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default function Shell() {
  const { isDemo, currentLevel, warnRestriction } = useArena()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const policy = LEVEL_POLICY[currentLevel]
      const ctrl = event.ctrlKey || event.metaKey
      if (!ctrl) return
      const key = event.key.toLowerCase()
      if (key === 'c' && policy.copyRestricted) { event.preventDefault(); warnRestriction('Copy') }
      if (key === 'v' && policy.pasteRestricted) { event.preventDefault(); warnRestriction('Paste') }
      if (event.shiftKey && key === 'i' && policy.devToolsRestricted) { event.preventDefault(); warnRestriction('Developer tools') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentLevel, warnRestriction])

  return (
    <div className="ar-shell">
      <Topbar />
      {isDemo && <div className="ar-demo-strip"><Icon name="warning" size={13} /> DEMO ENVIRONMENT - SAMPLE DATA <span>All scores, teams and repositories here are illustrative.</span></div>}
      <div className="ar-shell__body">
        <Sidebar />
        <main className="ar-main"><Outlet /></main>
      </div>
      <Overlays />
    </div>
  )
}
