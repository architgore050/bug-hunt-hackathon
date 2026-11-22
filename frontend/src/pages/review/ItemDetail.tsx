import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import type { ReviewDetail } from '../../lib/types'
import { DECISIONS, RUBRIC_KEYS } from '../../lib/types'
import { fmtDateTime } from '../../lib/format'
import { Button, Chip, EmptyState, ErrorBanner, Field, KVRow, LoadingShell, Panel, StatusChip } from '../../ui/components'

const DECISION_LABELS: Record<string, string> = {
  accept_full: 'Accept in full',
  accept_partial: 'Accept partial',
  duplicate: 'Duplicate of another report',
  reject_invalid: 'Reject as invalid',
  unplanned_valid: 'Valid but unplanned (no ground truth match)',
  needs_second_review: 'Needs a second reviewer',
}

function payloadLines(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined || v === '') continue
    out.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  }
  return out
}

export default function ReviewItem() {
  const { itemId } = useParams()
  const queryClient = useQueryClient()

  const [decision, setDecision] = useState<string>('')
  const [rubric, setRubric] = useState<Record<string, number>>({
    functionality: 0,
    root_cause: 0,
    code_quality: 0,
    testing: 0,
    evidence: 0,
  })
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['review-item', itemId],
    queryFn: () => api<ReviewDetail>(`/v1/review/items/${itemId}`),
  })

  async function claim() {
    setError(null)
    setBusy(true)
    try {
      await api<{ ok: boolean }>(`/v1/review/items/${itemId}/claim`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['review-item', itemId] })
      await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : new ApiRequestError({ code: 'UNKNOWN', serverMessage: 'Claim failed.' }))
    } finally {
      setBusy(false)
    }
  }

  async function submitDecision(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!decision) return
    setBusy(true)
    try {
      await api<{ ok: boolean; decision: string }>(`/v1/review/items/${itemId}/decision`, {
        method: 'POST',
        body: {
          decision,
          rubric: {
            functionality: rubric.functionality,
            root_cause: rubric.root_cause,
            code_quality: rubric.code_quality,
            testing: rubric.testing,
            evidence: rubric.evidence,
          },
          notes: notes.trim() || undefined,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      setDone(decision)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : new ApiRequestError({ code: 'UNKNOWN', serverMessage: 'Decision failed.' }))
    } finally {
      setBusy(false)
    }
  }

  if (q.isLoading) return <LoadingShell label="Loading review item" />

  if (q.isError || !q.data) {
    return (
      <div className="stack">
        <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
        <EmptyState
          title="Review item unavailable"
          note="The item may have been decided by another reviewer in the meantime. Back to the queue for the live list."
          action={<Link to="/review" className="btn btn-sm">Back to queue</Link>}
        />
      </div>
    )
  }

  const data = q.data
  const sub = data.submission
  const rangeStart = sub.line_start ?? null
  const rangeEnd = sub.line_end ?? null
  const fileLines = data.file ? data.file.content.replaceAll('\r\n', '\n').split('\n') : []
  const canDecide = data.status === 'claimed'

  if (done) {
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="banner banner-tone-ok" role="status">
          <span className="banner-title">Decision recorded</span>
          <div className="small">
            {DECISION_LABELS[done] ?? done} recorded for {sub.receipt_code}. The scoring ledger application runs in
            the background evaluator job.
          </div>
        </div>
        <Link to="/review" className="btn btn-primary" style={{ justifySelf: 'start' }}>
          Back to queue
        </Link>
      </div>
    )
  }

  return (
    <div className="stack-lg">
      <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Link to="/review" className="muted small">Review queue</Link>
        <span className="muted">/</span>
        <span className="mono small" style={{ color: 'var(--signal)' }}>{sub.receipt_code}</span>
        <StatusChip value={data.status} />
      </header>

      {error && <ErrorBanner error={error} title="Claim conflict" />}

      {data.status === 'open' && (
        <div className="banner banner-tone-signal" role="status">
          <span className="banner-title">This item is unclaimed</span>
          <div className="small">Claim it to enable the decision form. Claims hold for 10 minutes.</div>
          <div>
            <Button variant="primary" onClick={() => void claim()} disabled={busy}>
              {busy ? 'Claiming' : 'Claim this item'}
            </Button>
          </div>
        </div>
      )}
      {data.status === 'decided' && (
        <div className="banner banner-tone-ok" role="status">
          <span className="banner-title">Already decided</span>
          <div className="small">This item was decided; the queue no longer offers it. No further action is possible.</div>
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          {/* The report, plain text only */}
          <Panel
            exhibit="EX-01"
            title="Report payload (plain text)"
            actions={<Chip tone="info">{sub.kind === 'ctf_flag' ? 'ctf flag' : 'bug report'}</Chip>}
          >
            <div className="ruled panel-2" style={{ padding: '0 16px', marginBottom: 14 }}>
              <KVRow k="Receipt" v={sub.receipt_code} />
              <KVRow k="Title" v={sub.title} />
              <KVRow k="Category" v={sub.category?.replaceAll('_', ' ') ?? 'not set'} />
              <KVRow k="Location" v={sub.file_path ? `${sub.file_path}:${rangeStart ?? ''}-${rangeEnd ?? ''}` : 'not set'} />
              <KVRow k="Received" v={fmtDateTime(sub.received_at)} />
              <KVRow k="Team reports" v={String(data.team_total_reports)} />
            </div>
            <pre
              className="mono small"
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius)',
                padding: 14,
                margin: 0,
                maxHeight: 380,
                overflow: 'auto',
              }}
            >
              {payloadLines(sub.payload).join('\n') || '(no payload fields)'}
            </pre>
          </Panel>

          {/* The referenced file with the reported range highlighted */}
          <Panel
            exhibit="EX-02"
            title={sub.file_path ? `Referenced file: ${sub.file_path}` : 'Referenced file'}
            actions={data.file ? <Chip tone="muted">{data.file.line_count} lines</Chip> : undefined}
          >
            {!data.file && (
              <EmptyState
                title="No file attached"
                note={
                  sub.kind === 'ctf_flag'
                    ? 'Flag submissions carry no file reference.'
                    : 'The referenced file is not part of the challenge file set. Decide from the report payload.'
                }
              />
            )}
            {data.file && (
              <div className="codeview" style={{ maxHeight: 460, fontSize: 13 }} aria-label="Referenced file content">
                {fileLines.map((line, i) => {
                  const n = i + 1
                  const inRange = rangeStart !== null && rangeEnd !== null && n >= rangeStart && n <= rangeEnd
                  return (
                    <div key={n} className={`codeline ${inRange ? 'sel' : ''}`} style={{ cursor: 'default' }}>
                      <span className="line-no">{n}</span>
                      <span className="line-code">{line === '' ? ' ' : line}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {data.file && rangeStart !== null && rangeEnd !== null && (
              <div className="muted small mono" style={{ padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
                Reported range: lines {rangeStart}-{rangeEnd} (highlighted). Cross-check the claimed cause against
                the payload before deciding.
              </div>
            )}
          </Panel>
        </div>

        {/* Decision desk */}
        <Panel exhibit="EX-03" title="Decision desk" as="section">
          {!canDecide ? (
            data.status === 'open' ? (
              <EmptyState
                title="Claim required"
                note="Claim the item (button above) to unlock the decision form. This prevents two reviewers working the same report."
              />
            ) : (
              <EmptyState title="Item closed" note="A decision is already recorded for this review item." />
            )
          ) : (
            <form onSubmit={submitDecision} className="stack" style={{ gap: 14 }}>
              <Field label="Decision" htmlFor="rv-decision" required>
                <div className="select-wrap">
                  <select id="rv-decision" className="select" value={decision} onChange={(e) => setDecision(e.target.value)} required>
                    <option value="">Select decision</option>
                    {DECISIONS.map((d) => (
                      <option key={d} value={d}>{DECISION_LABELS[d]}</option>
                    ))}
                  </select>
                </div>
              </Field>

              <fieldset style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'grid', gap: 8 }}>
                <legend className="overline">Rubric, 0 to 1 step 0.05</legend>
                {RUBRIC_KEYS.map((k) => (
                  <div key={k}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <label className="field-label" htmlFor={`rv-${k}`}>{k.replaceAll('_', ' ')}</label>
                      <span className="mono small">{rubric[k].toFixed(2)}</span>
                    </div>
                    <input
                      id={`rv-${k}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={rubric[k]}
                      onChange={(e) => setRubric((r) => ({ ...r, [k]: Number(e.target.value) }))}
                      aria-valuetext={rubric[k].toFixed(2)}
                    />
                  </div>
                ))}
              </fieldset>

              <Field label="Notes" htmlFor="rv-notes" hint="Visible to organizers in the audit trail.">
                <textarea id="rv-notes" className="textarea" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              <Button type="submit" variant="primary" disabled={busy || !decision}>
                {busy ? 'Recording' : 'Record decision'}
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </div>
  )
}
