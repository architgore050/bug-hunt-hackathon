// Level 1 know-more page per repository option (/level/1/repo/:optionKey).
//
// Shows the server-provided option label and description. The full repository
// brief (README) unlocks for the team's locked option after the lead locks;
// the page says exactly that instead of exposing or inventing content.

import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchLevelContent } from '../../lib/api-levels'
import { guardRedirect } from '../../lib/guards'
import { useProgressQuery, useLevelsQuery, useServerNow } from '../../lib/event-session'
import { EventProgressBar } from '../../components/event/ProgressBar'
import { Button, Chip, EmptyState, ErrorBanner, LoadingShell, Panel } from '../../ui/components'
import { PlainMarkdown } from '../../ui/components'

const OPTION_RE = /^[abAB]$/

export default function LevelKnowMore() {
  const { levelNo, optionKey } = useParams()
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

  const pointer = progressQ.data?.pointer ?? null

  // Know-more pages belong to the Level 1 lock step; guard like explain.
  const redirect = useMemo(() => guardRedirect(pointer, n, 'explain'), [pointer, n])
  const badOption = !optionKey || !OPTION_RE.test(optionKey)

  if (badOption) return <Navigate to={`/level/${n}/explain`} replace />
  if (redirect) return <Navigate to={redirect} replace />
  if (contentQ.isPending && !contentQ.data) return <LoadingShell label="Loading repository details" />
  if (contentQ.isError) {
    return (
      <div className="wrap page">
        <ErrorBanner error={contentQ.error} onRetry={() => void contentQ.refetch()} />
      </div>
    )
  }

  const content = contentQ.data!
  const key = (optionKey as string).toUpperCase()
  const option = content.repo_options.find((o) => o.option_key.toUpperCase() === key) ?? null
  const isLockedOption = content.repo_option?.option_key.toUpperCase() === key

  return (
    <div>
      <EventProgressBar levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} />
      <div className="wrap-wide page">
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline', marginBottom: 18 }}>
          <span className="exhibit-num">EX-{n}</span>
          <h1 className="display" style={{ margin: 0 }}>Option {key}</h1>
          {isLockedOption && <Chip tone="ok">your team's repository</Chip>}
        </header>

        {option ? (
          <Panel exhibit={`EX-${n}.O`} title={option.label}>
            <p style={{ margin: 0 }}>{option.description}</p>
          </Panel>
        ) : (
          <EmptyState title="Unknown repository option" note={`The event does not publish an option "${key}".`} />
        )}

        {isLockedOption && content.instructions_markdown && (
          <Panel exhibit={`EX-${n}.B`} title="Repository brief">
            <PlainMarkdown text={content.instructions_markdown} />
          </Panel>
        )}
        {!isLockedOption && (
          <div className="notice-inline small" style={{ marginTop: 14 }}>
            The full repository brief and file tree unlock for the team's chosen option once the team lead locks the
            repository on the Level 1 explanation page.
          </div>
        )}

        <p className="small muted" style={{ marginTop: 16 }}>
          <Button size="sm" onClick={() => navigate(`/level/${n}/explain`)}>Back to the explanation</Button>
        </p>
      </div>
    </div>
  )
}
