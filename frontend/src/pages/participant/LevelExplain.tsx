// Level explanation page (levels 1-4).
//
// Shows the server-provided level brief, the current countdown, the shared
// progress bar and warnings, and for Level 1 the repository lock section.
// The gate Start button polls GET /v1/levels/{n}/gate and navigates to the
// execution workspace; the server re-checks on entry.

import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchLevelContent } from '../../lib/api-levels'
import type { LevelContentResponse } from '../../lib/api-levels'
import { guardRedirect } from '../../lib/guards'
import { useLevelsQuery, useProgressQuery, useServerNow, useTeamQuery } from '../../lib/event-session'
import { EventProgressBar } from '../../components/event/ProgressBar'
import { EventWarnings } from '../../components/event/Warnings'
import { GateButton } from '../../components/lock/GateButton'
import { RepoLockSection } from '../../components/lock/RepoLockSection'
import { ApiRequestError } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { Button, Chip, ErrorBanner, LoadingShell, Panel, SectionHeading, StatusChip } from '../../ui/components'
import { PlainMarkdown } from '../../ui/components'
import { useQueryClient } from '@tanstack/react-query'

export default function LevelExplain() {
  const { levelNo } = useParams()
  const n = Number(levelNo)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const nowMs = useServerNow()
  const levelsQ = useLevelsQuery()
  const progressQ = useProgressQuery()
  const teamQ = useTeamQuery()

  const contentQ = useQuery({
    queryKey: ['level-content', n],
    queryFn: (): Promise<LevelContentResponse> => fetchLevelContent(n),
    enabled: Number.isInteger(n) && n >= 1 && n <= 4,
    staleTime: 30_000,
  })

  const pointer = progressQ.data?.pointer ?? null

  // Guard: submitted, future or locked levels redirect to the current node.
  const redirect = useMemo(() => guardRedirect(pointer, n, 'explain'), [pointer, n])

  if (!Number.isInteger(n) || n < 1 || n > 4) {
    return <NotFoundish />
  }
  if (redirect) return <Navigate to={redirect} replace />
  if (contentQ.isPending && !contentQ.data) return <LoadingShell label="Loading level explanation" />
  if (contentQ.isError) return <ContentError error={contentQ.error} onRetry={() => void contentQ.refetch()} />

  const content = contentQ.data!
  const summary = levelsQ.data?.levels.find((l) => l.level_no === n) ?? null

  return (
    <div>
      <EventProgressBar levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} />
      <div className="wrap-wide page">
        <EventWarnings levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} deadlineModal={false} />

        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline', marginBottom: 14 }}>
          <span className="exhibit-num">{`EX-${n}`}</span>
          <h1 className="display" style={{ margin: 0 }}>{content.title}</h1>
          <StatusChip value={content.stage_status} size="lg" />
        </header>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          <span className="overline">Level window</span>
          <span className="mono small">{content.ends_at_effective ? `closes ${fmtDateTime(content.ends_at_effective)}` : 'no deadline published'}</span>
          {summary && <Chip tone="info">{`grace ${summary.grace_seconds}s`}</Chip>}
        </div>

        <Panel exhibit={`EX-${n}.1`} title="What you are doing">
          <PlainMarkdown text={content.explain_markdown} />
        </Panel>

        {n === 1 && (
          <>
            <SectionHeading num={`EX-${n}.2`} title="Repository choice" note="lead only, once, for the whole event" />
            {teamQ.isPending && <LoadingShell label="Loading team" />}
            {teamQ.data && (
              <RepoLockSection
                levelContent={content}
                team={teamQ.data}
                onServerChange={() => {
                  void queryClient.invalidateQueries({ queryKey: ['team'] })
                  void queryClient.invalidateQueries({ queryKey: ['level-content', n] })
                  void queryClient.invalidateQueries({ queryKey: ['levels'] })
                  void queryClient.invalidateQueries({ queryKey: ['progress'] })
                }}
              />
            )}
            {teamQ.isError && <ErrorBanner error={teamQ.error} />}
          </>
        )}

        <SectionHeading num={`EX-${n}.3`} title="Enter execution" note="checked against the server every 5 seconds" />
        <Panel>
          {content.instructions_markdown && (
            <details style={{ marginBottom: 12 }}>
              <summary className="overline" style={{ cursor: 'pointer' }}>Repository brief (locked option)</summary>
              <div style={{ marginTop: 10 }}>
                <PlainMarkdown text={content.instructions_markdown} />
              </div>
            </details>
          )}
          <GateButton levelNo={n} label={`Start ${content.title.split(':')[0] ?? `Level ${n}`}`} onEnter={() => navigate(`/level/${n}/run`)} />
          {pointer?.level_no === n && pointer.node === 'exec' && (
            <div className="small muted" style={{ marginTop: 10 }}>
              You are already in the execution node for this level.
            </div>
          )}
        </Panel>

        <p className="small muted">
          Other stops for this level: <Button size="sm" onClick={() => navigate(`/level/${n}/rules`)}>Rules</Button>{' '}
          <Button size="sm" onClick={() => navigate(`/level/${n}/guide`)}>Guide</Button>{' '}
          <Button size="sm" onClick={() => navigate('/dashboard')}>Dashboard</Button>
        </p>
      </div>
    </div>
  )
}

function NotFoundish() {
  return (
    <div className="wrap page">
      <Panel title="No such level" exhibit="EX-404">
        <p>Levels are numbered 1 to 4.</p>
      </Panel>
    </div>
  )
}

function ContentError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN'
  if (code === 'LEVEL_NOT_OPEN') {
    return (
      <div className="wrap page">
        <div className="banner banner-tone-info" role="status">
          <span className="banner-title">The event is not running yet</span>
          <div className="small">Level content appears once the event is live.</div>
        </div>
      </div>
    )
  }
  if (code === 'RULES_NOT_ACCEPTED') {
    return (
      <div className="wrap page">
        <div className="banner banner-tone-warn" role="alert">
          <span className="banner-title">Accept the rules first</span>
          <div className="small">Open the dashboard to accept the competition rules.</div>
        </div>
      </div>
    )
  }
  return (
    <div className="wrap page">
      <ErrorBanner error={error} title="Could not load level content" onRetry={onRetry} />
    </div>
  )
}
