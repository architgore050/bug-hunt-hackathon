import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { SubmissionRow } from '../../lib/types'
import { fmtDateTime } from '../../lib/format'
import { Chip, EmptyState, ErrorBanner, LoadingShell, Panel } from '../../ui/components'
import { FlagIcon } from '../../ui/icons'

export default function Submissions() {
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['submissions'],
    queryFn: () => api<{ submissions: SubmissionRow[] }>('/v1/submissions'),
    refetchInterval: 15_000,
  })

  const rows = q.data?.submissions ?? []
  const bugReports = rows.filter((r) => r.kind === 'bug_report').length
  const flags = rows.filter((r) => r.kind === 'ctf_flag').length

  return (
    <div className="stack-lg">
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="exhibit-num">EX-SUBS</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Submission history</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone="muted">{rows.length} total</Chip>
          <Chip tone="muted">{bugReports} bug reports</Chip>
          <Chip tone="muted">{flags} flags</Chip>
        </div>
        <p className="muted small" style={{ maxWidth: '74ch' }}>
          Every accepted submission carries an immutable receipt code. Before results are released the platform
          keeps verdict details hidden and shows the coarse receipt status only.
        </p>
      </header>

      {q.isLoading && <LoadingShell label="Loading submissions" />}
      {q.isError && <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />}

      {q.data && rows.length === 0 && (
        <EmptyState
          title="No submissions yet"
          note="File your first bug report from the workspace. Receipts and statuses appear here immediately after the server acknowledges them."
          action={<Link to="/app/workspace" className="btn btn-sm">Open workspace</Link>}
        />
      )}

      {q.data && rows.length > 0 && (
        <Panel exhibit="EX-01" title="All submissions, newest first">
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Submission history with receipt codes and status</caption>
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Title</th>
                  <th scope="col">Location</th>
                  <th scope="col">Received</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" tabIndex={0} onClick={() => navigate(`/app/submissions/${s.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/app/submissions/${s.id}`)
                    }}
                    aria-label={`Open submission ${s.receipt_code}`}
                  >
                    <td className="mono" style={{ color: 'var(--signal)' }}>{s.receipt_code}</td>
                    <td>
                      {s.kind === 'ctf_flag' ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <FlagIcon size={13} /> flag
                        </span>
                      ) : (
                        'report'
                      )}
                    </td>
                    <td style={{ minWidth: 200 }}>
                      {s.title}
                      {s.category && <div className="muted small">{s.category.replaceAll('_', ' ')}</div>}
                    </td>
                    <td className="mono small">
                      {s.file_path ? `${s.file_path}:${s.line_start}-${s.line_end}` : s.kind === 'ctf_flag' ? 'flag code' : ''}
                    </td>
                    <td className="mono small">{fmtDateTime(s.received_at)}</td>
                    <td><Chip tone="info">{s.status.replaceAll('_', ' ')}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}
