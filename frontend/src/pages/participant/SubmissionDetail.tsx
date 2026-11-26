import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { SubmissionDetail as Detail } from '../../lib/types'
import { fmtDateTime } from '../../lib/format'
import { Chip, EmptyState, ErrorBanner, KVRow, LoadingShell, Panel, StatusChip } from '../../ui/components'
import { DisputeForm } from '../../components/DisputeForm'
import { SubmissionPayload } from '../../components/SubmissionPayload'

export default function SubmissionDetail() {
  const { submissionId } = useParams()
  const q = useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => api<Detail>(`/v1/submissions/${submissionId}`),
    refetchInterval: 20_000,
  })

  return (
    <div className="stack-lg">
      <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Link to="/app/submissions" className="muted small">Submission history</Link>
        <span className="muted">/</span>
        <span className="mono" style={{ color: 'var(--signal)' }}>{q.data?.receipt_code ?? submissionId}</span>
      </header>

      {q.isLoading && <LoadingShell label="Loading submission" />}
      {q.isError && (
        <div className="stack">
          <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
          <EmptyState
            title="Submission not found"
            note="The platform does not disclose whether another team member's submission exists. This page shows only your own filings."
            action={<Link to="/app/submissions" className="btn btn-sm">Back to history</Link>}
          />
        </div>
      )}

      {q.data && (
        <div className="grid-2">
          <div className="stack">
            <Panel exhibit="EX-01" title="Report as filed" actions={<StatusChip value={q.data.status} />}>
              <div className="ruled panel-2" style={{ padding: '0 16px', marginBottom: 14 }}>
                <KVRow k="Title" v={q.data.title} />
                <KVRow k="Kind" v={q.data.kind === 'ctf_flag' ? 'ctf_flag' : 'bug_report'} />
                {q.data.kind === 'bug_report' && <KVRow k="Location" v={`${q.data.file_path ?? ''}:${q.data.line_start ?? ''}-${q.data.line_end ?? ''}`} />}
                {q.data.category && <KVRow k="Category" v={q.data.category.replaceAll('_', ' ')} />}
                <KVRow k="Received" v={fmtDateTime(q.data.received_at)} />
              </div>
              <SubmissionPayload payload={q.data.payload} />
            </Panel>
          </div>
          <div className="stack">
            <Panel exhibit="EX-02" title="Verdict">
              {q.data.released ? (
                <>
                  <div className="ruled panel-2" style={{ padding: '0 16px' }}>
                    <KVRow k="Matched bug" v={q.data.matched_bug_code ?? 'no match'} />
                    <KVRow k="Points" v={q.data.points !== null ? String(q.data.points) : '0'} />
                  </div>
                  <p className="muted small">
                    Feedback is public for this round. Dispute through the platform within the announced window.
                  </p>
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                    <DisputeForm submissionId={q.data.id} receiptCode={q.data.receipt_code} idPrefix="dispute-detail" />
                  </div>
                </>
              ) : (
                <>
                  <Chip tone="muted" size="lg">Verdict hidden</Chip>
                  <p className="muted small" style={{ marginTop: 10 }}>
                    Feedback on reports stays hidden until the organizers release results. The receipt code above is
                    your proof of filing; keep it for the dispute window.
                  </p>
                </>
              )}
            </Panel>
            <Panel exhibit="EX-03" title="Receipt">
              <div className="mono" style={{ fontSize: 20, color: 'var(--ok)', wordBreak: 'break-all' }}>{q.data.receipt_code}</div>
              <p className="muted small">Immutable acknowledgement issued when the server accepted this submission.</p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
