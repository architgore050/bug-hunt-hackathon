import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PublicRules } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { Chip, ErrorBanner, LoadingShell, Panel, PlainMarkdown } from '../ui/components'

export default function Rules() {
  const q = useQuery({
    queryKey: ['public-rules'],
    queryFn: () => api<{ rules: PublicRules | null }>('/v1/public/rules'),
    staleTime: 60_000,
  })

  return (
    <div className="wrap page stack">
      <header style={{ display: 'grid', gap: 10, paddingTop: 10 }}>
        <span className="exhibit-num">EX-RULES</span>
        <h1 className="display" style={{ margin: 0 }}>Competition rules</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {q.data?.rules && (
            <>
              <Chip tone="muted">Version {q.data.rules.version}</Chip>
              <Chip tone="muted">{q.data.rules.frozen_at ? `Frozen ${fmtDateTime(q.data.rules.frozen_at)}` : 'Draft, not frozen'}</Chip>
            </>
          )}
        </div>
        <p className="muted small" style={{ maxWidth: '70ch' }}>
          The authoritative text is served by the platform. This page renders the published document as plain text;
          what you read here is what the server returns, word for word.
        </p>
      </header>

      {q.isLoading && <LoadingShell label="Loading rules" />}
      {q.isError && <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.rules === null && (
        <Panel title="Rules not published yet" exhibit="EX-00">
          <p className="muted">
            The organizers have not published a rules document for this event yet. This page will show the frozen
            rules text as soon as publication happens.
          </p>
        </Panel>
      )}
      {q.data?.rules && (
        <Panel exhibit="EX-01" title={`Fall Back rules, v${q.data.rules.version}`}>
          <PlainMarkdown text={q.data.rules.body_markdown} />
        </Panel>
      )}
    </div>
  )
}
