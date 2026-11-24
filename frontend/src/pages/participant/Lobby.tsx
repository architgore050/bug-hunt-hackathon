import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Announcement, ConfigResponse, StateResponse } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { clockOffset, fmtDateTime } from '../../lib/format'
import {
  Button,
  CheckRow,
  Chip,
  CountdownTimer,
  EmptyState,
  ErrorBanner,
  KVRow,
  LoadingShell,
  Panel,
  StatusChip,
  useNowTick,
} from '../../ui/components'

const STATE_REFETCH = 5_000

function severityTone(s: Announcement['severity']): 'info' | 'warn' | 'danger' {
  if (s === 'warning') return 'warn'
  if (s === 'critical') return 'danger'
  return 'info'
}

export default function Lobby() {
  const { user, acceptRules } = useAuth()
  const nowMs = useNowTick()

  const stateQ = useQuery({
    queryKey: ['state'],
    queryFn: () => api<StateResponse>('/v1/state'),
    refetchInterval: STATE_REFETCH,
  })
  const configQ = useQuery({
    queryKey: ['config'],
    queryFn: () => api<ConfigResponse>('/v1/config'),
    staleTime: 60_000,
  })
  const annQ = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<{ announcements: Announcement[] }>('/v1/announcements'),
    refetchInterval: 30_000,
  })

  const round = stateQ.data?.round ?? null
  const offset = stateQ.data ? clockOffset(stateQ.data.server_time, stateQ.dataUpdatedAt) : 0
  const adjustedNow = nowMs + offset

  const stage = round?.status
  const countingToStart = stage === 'armed' && round?.starts_at
  const countingToEnd = (stage === 'active' || stage === 'paused') && round?.ends_at_effective

  return (
    <div className="stack-lg">
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="exhibit-num">LOBBY / {user?.email ?? ''}</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.8rem, 4.5vw, 2.6rem)' }}>
          {round ? round.name : 'Fall Back lobby'}
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusChip value={round?.status ?? null} size="lg" />
          <StatusChip value={round?.event_status ?? null} size="lg" />
          {round?.paused && <Chip tone="warn" size="lg">Timer stopped</Chip>}
        </div>
      </header>

      {stateQ.isLoading && <LoadingShell label="Loading round state" />}
      {stateQ.isError && <ErrorBanner error={stateQ.error} onRetry={() => void stateQ.refetch()} />}

      {stateQ.data && (
        <div className="grid-2">
          <div className="stack">
            {/* Round status stamp + countdown */}
            <Panel exhibit="EX-01" title="Round clock">
              {!round && (
                <EmptyState
                  title="No round configured yet"
                  note="The organizers have not configured or published a stage for this event. This lobby will show the round clock, your assignment and the countdown as soon as a stage exists."
                />
              )}
              {round && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, alignItems: 'flex-end' }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span className="overline">Stage status</span>
                    <StatusChip value={round.status} size="lg" />
                  </div>
                  {countingToStart && (
                    <CountdownTimer
                      targetMs={new Date(round.starts_at as string).getTime()}
                      nowMs={adjustedNow}
                      label="Starts in"
                    />
                  )}
                  {countingToEnd && (
                    <CountdownTimer
                      targetMs={new Date(round.ends_at_effective as string).getTime()}
                      nowMs={adjustedNow}
                      label={round.status === 'paused' ? 'Time remaining (clock stopped)' : 'Time remaining'}
                    />
                  )}
                  {!countingToStart && !countingToEnd && (
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span className="overline">Window</span>
                      <span className="mono small">
                        {round.starts_at ? `Start ${fmtDateTime(round.starts_at)}` : 'Start not set'}
                        {round.ends_at_effective ? ` · End ${fmtDateTime(round.ends_at_effective)}` : ''}
                      </span>
                    </div>
                  )}
                  <div style={{ flexBasis: '100%' }} className="muted small">
                    Grace period {round.grace_seconds}s after the deadline {'·'} server owns the clock; this page
                    polls every {STATE_REFETCH / 1000}s. {round.ends_at_effective ? `Effective end ${fmtDateTime(round.ends_at_effective)} (includes organizer adjustments).` : ''}
                  </div>
                </div>
              )}
            </Panel>

            {/* Readiness checklist */}
            <Panel exhibit="EX-02" title="Readiness checklist">
              <CheckRow
                ok={stateQ.isError ? false : true}
                label="Platform API reachable"
                detail={stateQ.data ? `Server clock ${fmtDateTime(stateQ.data.server_time)}` : undefined}
              />
              <CheckRow
                ok={!!user?.team}
                label="Team assignment"
                detail={user?.team ? `${user.team.name} · join code ${user.team.join_code}` : 'No team membership found. Contact the organizers desk.'}
              />
              <CheckRow
                ok={user?.rules_accepted ?? null}
                label="Competition rules accepted"
                detail={user?.rules_accepted ? `Accepted for rules version ${user.rules_version ?? ''}` : 'Acceptance is required before the workspace opens.'}
                action={
                  user && !user.rules_accepted ? (
                    <Button size="sm" variant="primary" onClick={() => void acceptRules().catch(() => undefined)}>
                      Accept rules
                    </Button>
                  ) : undefined
                }
              />
              <CheckRow
                ok={round ? ['armed', 'active', 'paused'].includes(round.status) : null}
                label="Round window open for challenge delivery"
                detail={
                  round
                    ? `Stage ${round.status}: materials release at 'armed' and reports are accepted while 'active'.`
                    : undefined
                }
                action={
                  <Link to="/app/workspace" className="btn btn-sm">
                    Open workspace
                  </Link>
                }
              />
            </Panel>

            {/* Schedule phases */}
            <Panel exhibit="EX-03" title="Schedule phases">
              {configQ.isLoading && <LoadingShell label="Loading schedule" />}
              {configQ.isError && <ErrorBanner error={configQ.error} title="Schedule unavailable" />}
              {configQ.data && (
                <div className="ruled">
                  {configQ.data.schedule.length === 0 && (
                    <p className="muted small" style={{ padding: 12 }}>The published schedule for this event is empty.</p>
                  )}
                  {configQ.data.schedule.map((s, i) => (
                    <div key={s.phase} style={{ display: 'flex', gap: 14, padding: '10px 4px', alignItems: 'baseline' }}>
                      <span className="exhibit-num">{String(i + 1).padStart(2, '0')}</span>
                      <span style={{ flex: 1 }}>{s.phase}</span>
                      <span className="chip chip-tone-muted">{s.duration_minutes} MIN</span>
                    </div>
                  ))}
                </div>
              )}
              {configQ.data && (
                <div style={{ marginTop: 12 }}>
                  <KVRow k="Runner" v={configQ.data.runner_enabled ? 'enabled' : 'disabled'} />
                  <KVRow k="AI assessment" v={configQ.data.ai_assessment_enabled ? 'enabled' : 'disabled'} />
                  <KVRow
                    k="CTF bonus cap"
                    v={configQ.data.ctf_bonus_cap_points !== undefined && configQ.data.ctf_bonus_cap_points !== null ? `${configQ.data.ctf_bonus_cap_points} pts` : 'per event config'}
                  />
                </div>
              )}
            </Panel>
          </div>

          <div className="stack">
            {/* Team panel */}
            <Panel exhibit="EX-04" title="Team">
              {user?.team ? (
                <>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', marginBottom: 6 }}>{user.team.name}</div>
                  <div className="overline" style={{ marginBottom: 2 }}>Join code</div>
                  <div className="mono" style={{ fontSize: 24, letterSpacing: '0.14em', color: 'var(--signal)' }}>
                    {user.team.join_code}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <KVRow k="Event" v={`${user.team.slug} (${user.team.event_status})`} />
                  </div>
                </>
              ) : (
                <EmptyState
                  title="No team record on this account"
                  note="Your membership appears here once the organizers attach your account to a team. Reports cannot be filed without a team."
                />
              )}
            </Panel>

            {/* Announcements */}
            <Panel exhibit="EX-05" title="Announcements">
              {annQ.isLoading && <LoadingShell label="Loading announcements" />}
              {annQ.isError && <ErrorBanner error={annQ.error} onRetry={() => void annQ.refetch()} />}
              {annQ.data && annQ.data.announcements.length === 0 && (
                <EmptyState title="No announcements yet" note="Organizer notices will appear here during the event." />
              )}
              {annQ.data && (
                <div className="ruled" style={{ margin: '-16px' }}>
                  {annQ.data.announcements.map((a) => (
                    <div key={a.id} style={{ padding: '12px 16px', display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip tone={severityTone(a.severity)}>{a.severity}</Chip>
                        <span className="muted small mono">{fmtDateTime(a.created_at)}</span>
                      </div>
                      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
                      <span className="muted small">posted by {a.author}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Links */}
            <Panel exhibit="EX-06" title="Console shortcuts">
              <div style={{ display: 'grid', gap: 8 }}>
                <Link to="/app/workspace" className="btn">Workspace</Link>
                <Link to="/app/submissions" className="btn">Submission history</Link>
                <Link to="/app/results" className="btn">Results</Link>
                <Link to="/app/leaderboard" className="btn">Leaderboard</Link>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
