import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ResultsResponse, StateResponse, SubmissionRow } from '../../lib/types'
import { fmtDateTime, fmtPoints } from '../../lib/format'
import { Chip, EmptyState, ErrorBanner, LoadingShell, Panel, StatusChip } from '../../ui/components'
import { DisputeForm } from '../../components/DisputeForm'

const COMPONENT_LABELS: Record<string, string> = {
  functional_test: 'Functional tests',
  code_review: 'Code review',
  evidence_report: 'Evidence and report quality',
  ctf_bonus: 'CTF bonus',
  adjustment: 'Adjustments',
  penalty: 'Penalties',
}

export default function Results() {
  const stateQ = useQuery({
    queryKey: ['state'],
    queryFn: () => api<StateResponse>('/v1/state'),
    refetchInterval: 10_000,
  })
  const stageId = stateQ.data?.round?.id ?? null

  const resultsQ = useQuery({
    queryKey: ['results', stageId],
    queryFn: () => api<ResultsResponse>(`/v1/results/${stageId}`),
    enabled: !!stageId,
    refetchInterval: 30_000,
  })
  const released = resultsQ.data?.released ?? false

  // Receipt code -> submission id, so ledger entries trace back to filings a
  // dispute can attach to. Entries without a receipt (adjustments, penalties)
  // offer no dispute affordance.
  const subsQ = useQuery({
    queryKey: ['submissions'],
    queryFn: () => api<{ submissions: SubmissionRow[] }>('/v1/submissions'),
    enabled: released,
  })
  const receiptToSubmission = new Map((subsQ.data?.submissions ?? []).map((s) => [s.receipt_code, s.id]))

  const [disputeReceipt, setDisputeReceipt] = useState<string | null>(null)

  if (stateQ.isLoading) return <LoadingShell label="Loading round state" />
  if (stateQ.isError) return <ErrorBanner error={stateQ.error} onRetry={() => void stateQ.refetch()} />
  if (!stageId) {
    return (
      <EmptyState
        title="No stage to score"
        note="Results appear once the event has a configured stage. Check the lobby for round status."
      />
    )
  }

  return (
    <div className="stack-lg">
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="exhibit-num">EX-RESULTS</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Team results</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusChip value={stateQ.data?.round?.status ?? null} />
          <Chip tone="muted">stage {stageId.slice(0, 8)}</Chip>
        </div>
      </header>

      {resultsQ.isLoading && <LoadingShell label="Loading results" />}
      {resultsQ.isError && <ErrorBanner error={resultsQ.error} onRetry={() => void resultsQ.refetch()} />}

      {resultsQ.data && !resultsQ.data.released && (
        <Panel exhibit="EX-01" title="Release status">
          <EmptyState
            title="Results are not released yet"
            note={
              <>
                {resultsQ.data.message ?? 'The organizers release verdicts, feedback and the score breakdown after evaluation finishes. This page polls while you wait.'}
                <span style={{ display: 'block', marginTop: 6 }}>Disputes open after results are released.</span>
              </>
            }
          />
        </Panel>
      )}

      {resultsQ.data?.released && (
        <>
          <div className="grid-split">
            <Panel exhibit="EX-01" title="Points breakdown">
              <div style={{ display: 'flex', gap: 20, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 14 }}>
                <div>
                  <span className="overline" style={{ display: 'block' }}>Total points</span>
                  <span className="countdown" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)' }}>{fmtPoints(resultsQ.data.total)}</span>
                </div>
                {(resultsQ.data.penalties ?? 0) !== 0 && (
                  <div>
                    <span className="overline" style={{ display: 'block' }}>Penalties</span>
                    <span className="mono" style={{ color: 'var(--danger)', fontSize: 20 }}>{fmtPoints(resultsQ.data.penalties)}</span>
                  </div>
                )}
              </div>
              <div className="ruled">
                {Object.entries(resultsQ.data.by_component ?? {}).map(([comp, pts]) => (
                  <div key={comp} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0' }}>
                    <span>{COMPONENT_LABELS[comp] ?? comp.replaceAll('_', ' ')}</span>
                    <span className="mono num">{fmtPoints(pts)}</span>
                  </div>
                ))}
                {Object.keys(resultsQ.data.by_component ?? {}).length === 0 && (
                  <p className="muted small">No scored components recorded.</p>
                )}
              </div>
            </Panel>
            <Panel exhibit="EX-02" title="Reading the numbers">
              <p className="muted small">
                The main score combines functional test results recorded by the organizers, reviewer judgment on
                your fixes, and the quality of your evidence. Verified CTF flags add capped bonus points.
                Penalties, if any, are applied only at finalization.
              </p>
              <p className="muted small">
                Every contributing entry below is traceable to a submission receipt. Raise disputes through the
                platform within the announced window after release.
              </p>
            </Panel>
          </div>

          <Panel exhibit="EX-03" title="Ledger entries">
            {(resultsQ.data.entries ?? []).length === 0 ? (
              <EmptyState title="No ledger entries" note="The score ledger for your team is empty for this stage." />
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <caption className="sr-only">Score ledger entries for this team</caption>
                  <thead>
                    <tr>
                      <th scope="col">Component</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Submission</th>
                      <th scope="col">Match</th>
                      <th scope="col">Received</th>
                      <th scope="col" className="num">Points</th>
                      {released && <th scope="col">Dispute</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {resultsQ.data.entries?.map((e, i) => {
                      const disputeSubmissionId = e.receipt_code ? receiptToSubmission.get(e.receipt_code) ?? null : null
                      const disputeOpen = released && e.receipt_code !== null && disputeReceipt === e.receipt_code && disputeSubmissionId !== null
                      const columnCount = released ? 7 : 6
                      return (
                        <Fragment key={i}>
                          <tr>
                            <td>{COMPONENT_LABELS[e.component] ?? e.component.replaceAll('_', ' ')}</td>
                            <td className="mono small">{e.reason_code.replaceAll('_', ' ')}</td>
                            <td className="mono small" style={{ color: 'var(--signal)' }}>
                              {e.receipt_code ?? ''}
                              {e.title ? <div className="muted" style={{ fontFamily: 'var(--font-ui)' }}>{e.title}</div> : null}
                            </td>
                            <td className="mono small">{e.matched_bug_code ?? ''}</td>
                            <td className="mono small">{e.received_at ? fmtDateTime(e.received_at) : ''}</td>
                            <td className="num" style={{ color: e.points < 0 ? 'var(--danger)' : 'var(--paper)' }}>{fmtPoints(e.points)}</td>
                            {released && (
                              <td>
                                {e.receipt_code && disputeSubmissionId ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => setDisputeReceipt(disputeOpen ? null : e.receipt_code)}
                                    aria-expanded={disputeOpen}
                                  >
                                    {disputeOpen ? 'Close form' : 'Dispute'}
                                  </button>
                                ) : (
                                  <span className="muted small">-</span>
                                )}
                              </td>
                            )}
                          </tr>
                          {disputeOpen && disputeSubmissionId && (
                            <tr>
                              <td colSpan={columnCount} style={{ background: 'var(--panel-2)' }}>
                                <DisputeForm
                                  submissionId={disputeSubmissionId}
                                  receiptCode={e.receipt_code}
                                  idPrefix={`dispute-${e.receipt_code ?? i}`}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
