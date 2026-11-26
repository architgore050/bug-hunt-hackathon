// Per-level guide page: the worked example for the team's locked repository
// (server-provided instructions_markdown = the locked option's README).
// Before the repository is locked there is nothing to show, and the page says
// so instead of inventing content.

import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchLevelContent } from '../../lib/api-levels'
import { guardRedirect } from '../../lib/guards'
import { useProgressQuery, useLevelsQuery, useServerNow, useTeamQuery } from '../../lib/event-session'
import { EventProgressBar } from '../../components/event/ProgressBar'
import { EmptyState, ErrorBanner, LoadingShell, Panel } from '../../ui/components'
import { PlainMarkdown } from '../../ui/components'

export default function LevelGuide() {
  const { levelNo } = useParams()
  const n = Number(levelNo)
  const navigate = useNavigate()
  const nowMs = useServerNow()
  const levelsQ = useLevelsQuery()
  const progressQ = useProgressQuery()
  const teamQ = useTeamQuery()

  const contentQ = useQuery({
    queryKey: ['level-content', n],
    queryFn: () => fetchLevelContent(n),
    enabled: Number.isInteger(n) && n >= 1 && n <= 4,
    staleTime: 30_000,
  })

  const pointer = progressQ.data?.pointer ?? null
  const redirect = useMemo(() => guardRedirect(pointer, n, 'explain'), [pointer, n])

  if (!Number.isInteger(n) || n < 1 || n > 4 || redirect) return <Navigate to={redirect ?? '/dashboard'} replace />

  const repoLocked = Boolean(teamQ.data?.repo_option ?? contentQ.data?.repo_option)
  const guideText = contentQ.data?.instructions_markdown ?? null

  return (
    <div>
      <EventProgressBar levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} />
      <div className="wrap-wide page">
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline', marginBottom: 18 }}>
          <span className="exhibit-num">{`EX-${n}`}</span>
          <h1 className="display" style={{ margin: 0 }}>{`Level ${n} guide`}</h1>
          {contentQ.data?.repo_option && (
            <span className="mono small muted">
              {contentQ.data.repo_option.title} (Option {contentQ.data.repo_option.option_key})
            </span>
          )}
        </header>

        {contentQ.isPending && <LoadingShell label="Loading guide" />}
        {contentQ.isError && <ErrorBanner error={contentQ.error} onRetry={() => void contentQ.refetch()} />}
        {contentQ.data && !repoLocked && (
          <EmptyState
            title="No repository locked yet"
            note="The worked example is keyed to your team's repository. It appears here once the team lead locks one in Level 1."
          />
        )}
        {contentQ.data && repoLocked && !guideText && (
          <EmptyState title="No guide published for this level" note="The organizer has not attached a repository brief to this level." />
        )}
        {contentQ.data && repoLocked && guideText && (
          <Panel exhibit={`EX-${n}.G`} title="Worked example in your repository">
            <PlainMarkdown text={guideText} />
          </Panel>
        )}

        <p className="small muted">
          <button type="button" className="btn btn-sm" onClick={() => navigate(-1)}>Back</button>
        </p>
      </div>
    </div>
  )
}
