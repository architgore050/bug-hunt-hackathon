import { useNavigate } from 'react-router-dom'
import { EVENT } from '../config'
import { useArena } from '../state/ArenaProvider'
import { Icon, type IconName } from '../ui/Icons'
import { Button, Chip, Panel, Progress, Stat, StatusChip } from '../ui/primitives'

const actions: Array<{ label: string; detail: string; icon: IconName; path: string }> = [
  { label: 'Continue current task', detail: 'Open the active level workspace', icon: 'target', path: '/arena/level' },
  { label: 'Open repository', detail: 'Inspect assigned source files', icon: 'repo', path: '/arena/repository' },
  { label: 'Open code editor', detail: 'Repair workspace with CodeMirror', icon: 'workspace', path: '/arena/workspace' },
  { label: 'Submit an issue', detail: 'File a report with evidence', icon: 'flag', path: '/arena/level' },
  { label: 'View leaderboard', detail: 'Compare team scores', icon: 'leaderboard', path: '/arena/leaderboard' },
]

export default function Overview() {
  const { team, levels, currentLevel, requestLevel } = useArena()
  const navigate = useNavigate()
  const active = levels.find((level) => level.number === currentLevel)
  const upcoming = levels.filter((level) => level.state === 'upcoming' || level.state === 'locked')

  const go = (path: string) => navigate(path)

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Participant console / {EVENT.edition}</div>
          <h1>Competition overview</h1>
          <p>Your team, your position, your current brief, and the work still ahead.</p>
        </div>
        <Chip tone="signal">LEVEL {currentLevel} ACTIVE</Chip>
      </header>

      <div className="ar-overview-grid">
        <Panel eyebrow="Team dossier" title={team?.name ?? 'Your team'} action={<Chip tone="ok">Rank #{team?.rank ?? '-'}</Chip>}>
          <div className="ar-team-brief">
            <div className="ar-team-brief__meta">
              <span className="ar-kv"><small>Team ID</small><strong>{team?.id}</strong></span>
              <span className="ar-kv"><small>Current level</small><strong>{active?.name}</strong></span>
              <span className="ar-kv"><small>Venue</small><strong>{EVENT.venue}</strong></span>
            </div>
            <div className="ar-avatars">
              {team?.members.map((member) => (
                <span key={member.id} className="ar-avatar-sm" title={`${member.name}, ${member.role}`}>{member.initials}</span>
              ))}
              <small>{team?.members.length} members</small>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Standing" title="Score position">
          <div className="ar-stat-grid">
            <Stat label="Total score" value={team?.score ?? 0} sub="core plus bonus" tone="signal" />
            <Stat label="Current rank" value={`#${team?.rank ?? '-'}`} sub={`of 10 teams`} />
            <Stat label="Accepted issues" value={team?.acceptedIssues ?? 0} sub="verified reports" tone="ok" />
            <Stat label="CTF bonus" value={`+${team?.ctfBonus ?? 0}`} sub="separate from core" tone="info" />
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Four stages" title="Competition progress" action={<span className="ar-overline">{levels.filter((level) => level.state === 'completed').length} of 4 complete</span>}>
        <div className="ar-timeline">
          {levels.map((level) => (
            <button key={level.number}
              className={`ar-timeline__item is-${level.state}`}
              onClick={() => { requestLevel(level.number); go('/arena/level') }}>
              <span className="ar-timeline__node">{String(level.number).padStart(2, '0')}</span>
              <span className="ar-timeline__main">
                <span className="ar-timeline__title">
                  <strong>{level.name}</strong>
                  <StatusChip status={level.state} />
                  {level.number === currentLevel && <span className="ar-now">NOW</span>}
                </span>
                <span className="ar-timeline__tagline">{level.tagline}</span>
                <Progress value={level.tasksCompleted} total={level.tasksTotal} />
                <span className="ar-timeline__stats">
                  {level.tasksCompleted}/{level.tasksTotal} tasks · {level.issuesAccepted} issues accepted · {level.repairsCompleted} repairs · {level.flagsFound} flags · {level.pointsEarned} pts
                </span>
              </span>
              <Icon name="chevron-right" size={15} />
            </button>
          ))}
        </div>
      </Panel>

      <div className="ar-overview-grid">
        <Panel eyebrow="Next up" title="Upcoming levels">
          {upcoming.length === 0 ? (
            <p className="ar-muted">All levels are open. Finish the current brief to continue.</p>
          ) : (
            <div className="ar-upcoming">
              {upcoming.map((level) => (
                <div key={level.number} className="ar-upcoming__item">
                  <div className="ar-upcoming__top">
                    <span className="ar-upcoming__no">{String(level.number).padStart(2, '0')}</span>
                    <strong>{level.name}</strong>
                    <Chip tone={level.aiAllowed ? 'info' : 'neutral'}>{level.aiAllowed ? 'AI allowed' : 'No AI'}</Chip>
                  </div>
                  <p>{level.description}</p>
                  <div className="ar-upcoming__meta">
                    {level.restrictions.map((restriction) => <span key={restriction}><Icon name="shield" size={12} />{restriction}</span>)}
                  </div>
                  <small>Expected: {level.expectedActions.join(', ')}. Questions are released when the level unlocks.</small>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="ar-overview-stack">
          <Panel eyebrow="Shortcuts" title="Quick actions">
            <div className="ar-quick-actions">
              {actions.map((action) => (
                <button key={action.label} onClick={() => go(action.path)}>
                  <span className="ar-quick-actions__icon"><Icon name={action.icon} size={16} /></span>
                  <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Scoring" title="Where your points come from">
            <ScoreBreakdown />
          </Panel>
        </div>
      </div>
    </div>
  )
}

function ScoreBreakdown() {
  const { team } = useArena()
  const navigate = useNavigate()
  if (!team) return null
  const rows = [
    { label: 'Bug identification', value: team.breakdown.bugIdentification },
    { label: 'Accepted issues', value: team.breakdown.acceptedIssues },
    { label: 'Repair points', value: team.breakdown.repair },
    { label: 'Evaluation points', value: team.breakdown.evaluation },
  ]
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <div className="ar-breakdown">
      {rows.map((row) => (
        <div key={row.label} className="ar-breakdown__row">
          <span>{row.label}</span>
          <div className="ar-breakdown__bar"><i style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <strong>{row.value}</strong>
        </div>
      ))}
      <div className="ar-breakdown__bonus">
        <span><Icon name="flag" size={13} /> CTF bonus, shown separately</span>
        <strong>+{team.breakdown.ctfBonus}</strong>
      </div>
      {team.breakdown.penalties !== 0 && (
        <div className="ar-breakdown__bonus is-penalty">
          <span><Icon name="warning" size={13} /> Penalties</span>
          <strong>{team.breakdown.penalties}</strong>
        </div>
      )}
      <Button variant="ghost" size="sm" icon="leaderboard" onClick={() => navigate('/arena/leaderboard')} className="ar-breakdown__link">
        Full leaderboard
      </Button>
    </div>
  )
}
