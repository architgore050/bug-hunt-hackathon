// Per-level rules page: event rules plus this level's brief from the server.
// Reachable from every explanation and workspace page without losing state
// (it is its own route; the workspace returns via browser navigation).

import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchLevelContent } from '../../lib/api-levels'
import { guardRedirect } from '../../lib/guards'
import { useProgressQuery, useLevelsQuery, useServerNow } from '../../lib/event-session'
import { api } from '../../lib/api'
import { EventProgressBar } from '../../components/event/ProgressBar'
import { ErrorBanner, LoadingShell, Panel, SectionHeading } from '../../ui/components'
import { PlainMarkdown } from '../../ui/components'
import type { PublicRules } from '../../lib/types'

export default function LevelRules() {
  const { levelNo } = useParams()
  const n = Number(levelNo)
  const navigate = useNavigate()
  const nowMs = useServerNow()
  const levelsQ = useLevelsQuery()
  const progressQ = useProgressQuery()

  const contentQ = useQuery({
    queryKey: ['level-content', n],
    queryFn: () => fetchLevelContent(n),
    enabled: Number.isInteger(n) && n >= 1 && n <= 4,
    staleTime: 30_000,
  })

  const rulesQ = useQuery({
    queryKey: ['public-rules'],
    queryFn: () => api<{ rules: PublicRules | null }>('/v1/public/rules'),
    staleTime: 60_000,
  })

  const pointer = progressQ.data?.pointer ?? null
  const redirect = useMemo(() => guardRedirect(pointer, n, 'explain'), [pointer, n])

  if (!Number.isInteger(n) || n < 1 || n > 4 || redirect) return <Navigate to={redirect ?? '/dashboard'} replace />

  return (
    <div>
      <EventProgressBar levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} />
      <div className="wrap-wide page">
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline', marginBottom: 18 }}>
          <span className="exhibit-num">{`EX-${n}`}</span>
          <h1 className="display" style={{ margin: 0 }}>{`Level ${n} rules`}</h1>
        </header>

        {contentQ.isPending && <LoadingShell label="Loading level brief" />}
        {contentQ.isError && <ErrorBanner error={contentQ.error} onRetry={() => void contentQ.refetch()} />}
        {contentQ.data && (
          <Panel exhibit={`EX-${n}.R`} title="This level's brief">
            <PlainMarkdown text={contentQ.data.explain_markdown} />
          </Panel>
        )}

        <SectionHeading num="EX-R" title="Event rules" note={rulesQ.data?.rules ? `version ${rulesQ.data.rules.version}` : 'not published'} />
        {rulesQ.isPending && <LoadingShell label="Loading rules" />}
        {rulesQ.isError && <ErrorBanner error={rulesQ.error} onRetry={() => void rulesQ.refetch()} />}
        {rulesQ.data?.rules && <Panel><PlainMarkdown text={rulesQ.data.rules.body_markdown} /></Panel>}
        {rulesQ.data && !rulesQ.data.rules && (
          <Panel>
            <p className="small muted">The organizer has not published rules yet.</p>
          </Panel>
        )}

        <p className="small muted">
          <button type="button" className="btn btn-sm" onClick={() => navigate(-1)}>Back</button>
        </p>
      </div>
    </div>
  )
}
