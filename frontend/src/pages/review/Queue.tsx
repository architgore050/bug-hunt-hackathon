import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import type { ReviewQueueItem } from '../../lib/types'
import { fmtDateTime } from '../../lib/format'
import { Chip, EmptyState, ErrorBanner, LoadingShell, Panel, StatusChip } from '../../ui/components'
import { FlagIcon } from '../../ui/icons'

export default function ReviewQueue() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'open' | 'claimed' | 'mine'>('all')
  const [claimError, setClaimError] = useState<{ id: string; message: string } | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => api<{ queue: ReviewQueueItem[] }>('/v1/review/queue'),
    refetchInterval: 8_000,
  })

  const rows = useMemo(() => {
    const all = q.data?.queue ?? []
    if (filter === 'open') return all.filter((r) => r.status === 'open')
    if (filter === 'claimed') return all.filter((r) => r.status === 'claimed')
    if (filter === 'mine') return all.filter((r) => r.claimed_by_me)
    return all
  }, [q.data, filter])

  async function claim(item: ReviewQueueItem) {
    setClaiming(item.review_item_id)
    setClaimError(null)
    try {
      await api<{ ok: boolean }>(`/v1/review/items/${item.review_item_id}/claim`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      navigate(`/review/items/${item.review_item_id}`)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const detail = typeof err.details.claim === 'string' ? err.details.claim : err.serverMessage
        setClaimError({ id: item.review_item_id, message: detail })
      } else {
        setClaimError({ id: item.review_item_id, message: 'Claim failed unexpectedly.' })
      }
    } finally {
      setClaiming(null)
    }
  }

  const counts = useMemo(() => {
    const all = q.data?.queue ?? []
    return {
      total: all.length,
      open: all.filter((r) => r.status === 'open').length,
      claimed: all.filter((r) => r.status === 'claimed').length,
      mine: all.filter((r) => r.claimed_by_me).length,
    }
  }, [q.data])

  return (
    <div className="stack-lg">
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="exhibit-num">REVIEW QUEUE</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Reports awaiting review</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone="muted">{counts.total} in queue</Chip>
          <Chip tone="signal">{counts.open} open</Chip>
          <Chip tone="info">{counts.claimed} claimed</Chip>
          <Chip tone="ok">{counts.mine} claimed by you</Chip>
        </div>
        <p className="muted small" style={{ maxWidth: '74ch' }}>
          Claims hold for 10 minutes before the item returns to the open pool. Participant content arrives as plain
          text only; the review desk never renders it as rich markup.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="overline">Filter</span>
        {(['all', 'open', 'claimed', 'mine'] as const).map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'chip-tone-signal' : 'chip-tone-muted'}`}
            style={{ cursor: 'pointer', background: 'none' }}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {f === 'mine' ? 'mine' : f}
          </button>
        ))}
        {q.isError && <span className="muted small">last refresh failed; retrying automatically</span>}
      </div>

      {q.isLoading && <LoadingShell label="Loading queue" />}

      {q.isError && !q.data && <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />}

      {q.data && rows.length === 0 && (
        <EmptyState
          title={filter === 'all' ? 'Queue is empty' : 'No items match this filter'}
          note="New review items appear here as participants file reports. The list refreshes every 8 seconds."
          action={<Chip tone="muted">polling active</Chip>}
        />
      )}

      {q.data && rows.length > 0 && (
        <Panel exhibit="EX-01" title={`Queue, ${rows.length} items`}>
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Review queue</caption>
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Title</th>
                  <th scope="col">Location</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.review_item_id}>
                    <td className="mono small">{fmtDateTime(item.received_at)}</td>
                    <td>
                      {item.kind === 'ctf_flag' ? (
                        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                          <FlagIcon size={12} /> flag
                        </span>
                      ) : (
                        'report'
                      )}
                    </td>
                    <td style={{ minWidth: 180 }}>{item.title}</td>
                    <td className="mono small">
                      {item.file_path ? `${item.file_path}:${item.line_range[0] ?? ''}-${item.line_range[1] ?? ''}` : ''}
                    </td>
                    <td className="small">{item.category?.replaceAll('_', ' ') ?? ''}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        <StatusChip value={item.status} />
                        {item.claimed_by_me && <Chip tone="ok">yours</Chip>}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {item.status === 'open' ? (
                          <button className="btn btn-sm" disabled={claiming === item.review_item_id} onClick={() => void claim(item)}>
                            {claiming === item.review_item_id ? 'Claiming' : 'Claim'}
                          </button>
                        ) : (
                          <Link className="btn btn-sm" to={`/review/items/${item.review_item_id}`}>
                            Open
                          </Link>
                        )}
                        {claimError?.id === item.review_item_id && (
                          <span className="field-error" role="alert">{claimError.message}</span>
                        )}
                      </span>
                    </td>
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
