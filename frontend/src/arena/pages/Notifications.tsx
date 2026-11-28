import { useMemo, useState } from 'react'
import { useArena } from '../state/ArenaProvider'
import { Icon, type IconName } from '../ui/Icons'
import { Button, Chip, Panel, Tabs } from '../ui/primitives'

const kindIcon: Record<string, IconName> = {
  level: 'level', question: 'questions', repo: 'repo', issue: 'flag', score: 'leaderboard',
  flag: 'flag', rank: 'arrow-up', announcement: 'inbox', time: 'clock',
}

type Filter = 'all' | 'unread'

export default function Notifications() {
  const { notices, markAllRead, markRead, pushToast } = useArena()
  const [filter, setFilter] = useState<Filter>('all')
  const visible = useMemo(() => filter === 'unread' ? notices.filter((notice) => !notice.read) : notices, [notices, filter])
  const unread = notices.filter((notice) => !notice.read).length

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Notification centre</div>
          <h1>Notifications</h1>
          <p>Level changes, issue reviews, scores, flags, rank movement, and admin announcements.</p>
        </div>
        <Button icon="check" disabled={unread === 0} onClick={() => { markAllRead(); pushToast('All notifications marked read', 'ok') }}>Mark all read</Button>
      </header>

      <Panel eyebrow="Inbox" title="Recent activity"
        action={<Tabs<Filter> tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: `Unread (${unread})` }]} active={filter} onChange={setFilter} />}>
        <div className="ar-notify-list">
          {visible.map((notice) => (
            <button key={notice.id} className={`ar-notify-row ${notice.read ? '' : 'is-unread'}`} onClick={() => markRead(notice.id)}>
              <span className="ar-notify-row__icon"><Icon name={kindIcon[notice.kind] ?? 'inbox'} size={15} /></span>
              <span className="ar-notify-row__body"><strong>{notice.title}</strong><p>{notice.body}</p><small>{notice.time}</small></span>
              <span className="ar-notify-row__state">{notice.read ? <Chip tone="neutral">Read</Chip> : <Chip tone="signal">New</Chip>}</span>
            </button>
          ))}
          {visible.length === 0 && <p className="ar-muted">No notifications in this view.</p>}
        </div>
      </Panel>
    </div>
  )
}
