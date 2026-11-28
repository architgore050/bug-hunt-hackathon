import { useMemo, useState } from 'react'
import { useArena } from '../state/ArenaProvider'
import { Icon } from '../ui/Icons'
import { Button, Chip, Modal, Movement, Panel, Stat, Tabs } from '../ui/primitives'
import type { Team } from '../types'

type Scope = 'overall' | 'level'

export default function Leaderboard() {
  const { teams, team: ownTeam, currentLevel } = useArena()
  const [scope, setScope] = useState<Scope>('overall')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Team | null>(null)

  const visible = useMemo(() => {
    const filtered = scope === 'level' ? teams.filter((team) => team.level === currentLevel) : teams
    return filtered
      .filter((team) => team.name.toLowerCase().includes(query.toLowerCase()) || team.id.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.rank - b.rank)
  }, [teams, scope, currentLevel, query])

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Standings / live</div>
          <h1>Leaderboard</h1>
          <p>Core score reflects repair and functional restoration. CTF points are a separate bonus.</p>
        </div>
        <Chip tone="info">{teams.length} registered teams</Chip>
      </header>

      {ownTeam && (
        <Panel eyebrow="Your position" title={ownTeam.name} className="ar-leaderboard-self">
          <div className="ar-stat-grid">
            <Stat label="Rank" value={`#${ownTeam.rank}`} sub={`moved ${ownTeam.movement}`} tone="signal" />
            <Stat label="Core score" value={ownTeam.score - ownTeam.ctfBonus} sub="before bonus" />
            <Stat label="CTF bonus" value={`+${ownTeam.ctfBonus}`} sub="not primary score" tone="info" />
            <Stat label="Repair points" value={ownTeam.repairPoints} sub="accepted repairs" tone="ok" />
          </div>
        </Panel>
      )}

      <div className="ar-podium">
        {visible.slice(0, 3).map((team, index) => (
          <button key={team.id} className={`ar-podium__card is-place-${index + 1} ${team.id === ownTeam?.id ? 'is-own' : ''}`}
            onClick={() => setSelected(team)}>
            <span className="ar-podium__rank">{String(index + 1).padStart(2, '0')}</span>
            <span className="ar-avatar-sm ar-avatar-sm--lg">{team.initials}</span>
            <strong>{team.name}</strong>
            <span className="ar-podium__score">{team.score}<small>pts</small></span>
            <Movement value={team.movement} />
            {team.id === ownTeam?.id && <span className="ar-podium__you">YOUR TEAM</span>}
          </button>
        ))}
      </div>

      <Panel eyebrow="Rankings" title="Full standings"
        action={<Tabs<Scope> tabs={[{ id: 'overall', label: 'Overall' }, { id: 'level', label: `Level ${currentLevel}` }]} active={scope} onChange={setScope} />}>
        <div className="ar-toolbar">
          <div className="ar-search"><Icon name="search" size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams or team ID" aria-label="Search teams" />
          </div>
          <span className="ar-muted">{visible.length} teams shown</span>
        </div>
        <div className="ar-table-wrap">
          <table className="ar-table">
            <thead>
              <tr>
                <th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Level</th>
                <th scope="col">Accepted</th><th scope="col">Repair</th><th scope="col">CTF bonus</th>
                <th scope="col">Movement</th><th scope="col">Score</th><th scope="col"><span className="ar-sr">Detail</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((team) => (
                <tr key={team.id} className={`${team.id === ownTeam?.id ? 'is-own' : ''} ${team.rank <= 3 ? 'is-top' : ''}`}
                  onClick={() => setSelected(team)}>
                  <td className="ar-rank-cell">{String(team.rank).padStart(2, '0')}</td>
                  <td>
                    <span className="ar-team-cell"><span className="ar-avatar-sm">{team.initials}</span>
                      <span><strong>{team.name}</strong><small>{team.id}</small></span>
                      {team.id === ownTeam?.id && <Chip tone="signal">You</Chip>}
                    </span>
                  </td>
                  <td>L{team.level}</td>
                  <td>{team.acceptedIssues}</td>
                  <td>{team.repairPoints}</td>
                  <td className="is-bonus">+{team.ctfBonus}</td>
                  <td><Movement value={team.movement} /></td>
                  <td className="ar-score-cell">{team.score}</td>
                  <td><Icon name="chevron-right" size={13} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {selected && (
        <Modal eyebrow={`Team ${selected.id}`} title={selected.name} onClose={() => setSelected(null)}
          footer={<Button onClick={() => setSelected(null)}>Close</Button>}>
          <div className="ar-team-detail">
            <div className="ar-team-detail__head">
              <Stat label="Rank" value={`#${selected.rank}`} />
              <Stat label="Score" value={selected.score} tone="signal" />
              <Stat label="Level" value={selected.level} />
              <Stat label="Movement" value={<Movement value={selected.movement} />} />
            </div>
            <h3>Score breakdown</h3>
            <div className="ar-team-detail__rows">
              <span>Bug identification<strong>{selected.breakdown.bugIdentification}</strong></span>
              <span>Accepted issues<strong>{selected.breakdown.acceptedIssues}</strong></span>
              <span>Repair points<strong>{selected.breakdown.repair}</strong></span>
              <span>Evaluation points<strong>{selected.breakdown.evaluation}</strong></span>
              <span className="is-bonus">CTF bonus, separate<strong>+{selected.breakdown.ctfBonus}</strong></span>
              {selected.breakdown.penalties !== 0 && <span className="is-penalty">Penalties<strong>{selected.breakdown.penalties}</strong></span>}
            </div>
            <h3>Members</h3>
            <div className="ar-team-detail__members">
              {selected.members.map((member) => (
                <span key={member.id}><span className="ar-avatar-sm">{member.initials}</span>
                  <span><strong>{member.name}</strong><small>{member.role}</small></span></span>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
