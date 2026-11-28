import { useArena } from '../state/ArenaProvider'
import { Icon, type IconName } from '../ui/Icons'
import { Chip, Panel, Progress, Stat } from '../ui/primitives'

const activityIcon: Record<string, IconName> = {
  issue: 'flag', task: 'target', flag: 'flag', repair: 'workspace', score: 'leaderboard',
}

export default function Team() {
  const { team, levels, currentLevel, activity } = useArena()
  if (!team) return <div className="ar-page"><p>Loading team...</p></div>

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Team workspace / shared</div>
          <h1>{team.name}</h1>
          <p>This is a team competition. Every report, repair, and flag is shared across the roster.</p>
        </div>
        <Chip tone="signal">{team.id}</Chip>
      </header>

      <Panel eyebrow="Team dossier" title="Position and progress">
        <div className="ar-stat-grid">
          <Stat label="Rank" value={`#${team.rank}`} tone="signal" sub="overall" />
          <Stat label="Total score" value={team.score} sub={`core ${team.score - team.ctfBonus} + bonus ${team.ctfBonus}`} />
          <Stat label="Current level" value={currentLevel} sub={levels.find((level) => level.number === currentLevel)?.name ?? ''} />
          <Stat label="Accepted issues" value={team.acceptedIssues} tone="ok" />
        </div>
        <div className="ar-team-progress">
          {levels.map((level) => (
            <div key={level.number}>
              <span className="ar-mono">{String(level.number).padStart(2, '0')} {level.name}</span>
              <Progress value={level.tasksCompleted} total={level.tasksTotal} />
              <strong>{level.tasksCompleted}/{level.tasksTotal}</strong>
            </div>
          ))}
        </div>
      </Panel>

      <div className="ar-team-grid">
        <Panel eyebrow="Roster" title={`${team.members.length} members`}>
          <div className="ar-member-list">
            {team.members.map((member) => (
              <div key={member.id}>
                <span className="ar-avatar-sm">{member.initials}</span>
                <span><strong>{member.name}</strong><small>@{member.handle} · {member.role}</small></span>
                <Chip tone="neutral">Active</Chip>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Shared feed" title="Team activity">
          <div className="ar-activity">
            {activity.map((item) => (
              <div key={item.id}>
                <span className="ar-activity__icon"><Icon name={activityIcon[item.type] ?? 'inbox'} size={14} /></span>
                <span><strong>{item.actor}</strong> {item.text}<small>{item.time}</small></span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
