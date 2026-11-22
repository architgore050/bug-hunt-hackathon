import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { LeaderboardResponse, StateResponse } from '../../lib/types'
import { fmtDateTime, fmtPoints } from '../../lib/format'
import { Chip, EmptyState, ErrorBanner, LoadingShell, Panel, StatusChip } from '../../ui/components'

export default function Leaderboard() {
  const stateQ = useQuery({
    queryKey: ['state'],
    queryFn: () => api<StateResponse>('/v1/state'),
    refetchInterval: 10_000,
  })
  const stageId = stateQ.data?.round?.id ?? null
  const visibility = stateQ.data?.leaderboard_visibility ?? 'hidden'

  const lbQ = useQuery({
    queryKey: ['leaderboard', stageId],
    queryFn: () => api<LeaderboardResponse>(`/v1/leaderboard/${stageId}`),
    enabled: !!stageId,
    refetchInterval: 20_000,
  })

  if (stateQ.isLoading) return <LoadingShell label="Loading round state" />
  if (stateQ.isError) return <ErrorBanner error={stateQ.error} onRetry={() => void stateQ.refetch()} />
  if (!stageId) {
    return (
      <EmptyState
        title="No stage to rank"
        note="The leaderboard activates when the event has a configured stage. Check the lobby for round status."
      />
    )
  }

  return (
    <div className="stack-lg">
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="exhibit-num">EX-LADDER</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Leaderboard</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusChip value={visibility} />
          <Chip tone="muted">stage {stageId.slice(0, 8)}</Chip>
          {lbQ.data?.generated_at && <Chip tone="muted">snapshot {fmtDateTime(lbQ.data.generated_at)}</Chip>}
        </div>
      </header>

      {lbQ.isLoading && <LoadingShell label="Loading leaderboard" />}
      {lbQ.isError && <ErrorBanner error={lbQ.error} onRetry={() => void lbQ.refetch()} />}

      {lbQ.data && !lbQ.data.visible && (
        <Panel exhibit="EX-01" title="Visibility">
          <EmptyState
            title="The leaderboard is hidden for this round"
            note={lbQ.data.message ?? 'The stage configuration keeps team ranking hidden until the organizers change the visibility mode or release results.'}
          />
        </Panel>
      )}

      {lbQ.data?.visible && !lbQ.data.snapshot && (
        <Panel exhibit="EX-01" title="Snapshots">
          <EmptyState
            title="No results published yet"
            note={lbQ.data.message ?? 'Snapshots appear once evaluation produces team totals. This page polls while you wait.'}
          />
        </Panel>
      )}

      {lbQ.data?.snapshot && (
        <Panel exhibit="EX-02" title="Team ranking">
          {visibility === 'frozen' && (
            <p className="muted small" style={{ marginBottom: 10 }}>
              Frozen mode: this snapshot is delayed by the configured interval, not live.
            </p>
          )}
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Team ranking by score</caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Team</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col" className="num">Invalid reports</th>
                  <th scope="col">Last accepted</th>
                </tr>
              </thead>
              <tbody>
                {lbQ.data.snapshot.rows.map((r) => (
                  <tr key={r.team_id}>
                    <td className="mono">{r.rank}</td>
                    <td>{r.team_name}</td>
                    <td className="num">{fmtPoints(r.score)}</td>
                    <td className="num">{r.invalid_reports}</td>
                    <td className="mono small">{r.last_accepted_at ? fmtDateTime(r.last_accepted_at) : ''}</td>
                  </tr>
                ))}
                {lbQ.data?.snapshot.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No teams recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Tie-break order: total score, then fewer invalid reports, then the earlier last accepted finding.
          </p>
        </Panel>
      )}
    </div>
  )
}
