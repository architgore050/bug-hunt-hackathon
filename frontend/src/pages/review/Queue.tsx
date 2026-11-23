import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ReviewQueueItem } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { SectorBadge } from '../../components/SectorBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

type QueueFilter = 'all' | 'open' | 'claimed' | 'mine';

export const ReviewQueue: React.FC = () => {
  const navigate = useNavigate();

  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const fetchQueue = async () => {
    try {
      setError(null);
      const res = await api.getReviewQueue();
      setQueue(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 8000); // /v1/review/queue cadence
    return () => clearInterval(interval);
  }, []);

  const handleClaimAndOpen = async (item: ReviewQueueItem) => {
    if (item.claimed_by_me) {
      navigate(`/review/items/${item.review_item_id}`);
      return;
    }

    try {
      setClaimingId(item.review_item_id);
      await api.claimReviewItem(item.review_item_id);
      navigate(`/review/items/${item.review_item_id}`);
    } catch (err) {
      setError(err);
    } finally {
      setClaimingId(null);
    }
  };

  const filteredItems = queue.filter((item) => {
    if (filter === 'open') return item.status === 'open';
    if (filter === 'claimed') return item.status === 'claimed' && !item.claimed_by_me;
    if (filter === 'mine') return item.claimed_by_me;
    return true;
  });

  const countFor = (f: QueueFilter) =>
    queue.filter((item) =>
      f === 'all' ? true : f === 'mine' ? item.claimed_by_me : item.status === f
    ).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#22303F]">
        <div>
          <p className="coordinate">VERIFICATION LEDGER // TRIAGE SURVEY</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            Filed findings awaiting verification
          </h1>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-xs" role="group" aria-label="Queue filter">
          {(['all', 'open', 'claimed', 'mine'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`px-3 py-1 uppercase border tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                filter === f
                  ? 'border-[#4A8FA8] bg-[#4A8FA8] text-[#090E16] font-bold'
                  : 'border-[#22303F] text-[#7E8FA1] hover:bg-[#1A273A]'
              }`}
            >
              {f} ({countFor(f)})
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchQueue} /> : null}

      <div className="topo-panel bg-[#111A27] overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center font-mono text-xs text-[#7E8FA1]" role="status">
            Surveying the verification queue...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center font-mono text-xs text-[#7E8FA1]">
            No filings match this filter. The ledger is clear.
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#0C1220] border-b border-[#22303F] text-[#7E8FA1]">
              <tr>
                <th className="p-3.5 uppercase tracking-[0.12em]">Priority</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Finding</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Coordinate</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Filed</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Lock state</th>
                <th className="p-3.5 uppercase tracking-[0.12em] text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22303F]">
              {filteredItems.map((item) => (
                <tr key={item.review_item_id} className="hover:bg-[#131C2B]">
                  <td className="p-3.5 font-bold text-[#E2A56B]">P{item.priority}</td>
                  <td className="p-3.5 max-w-sm truncate text-[#E2E8EE]">
                    <div className="font-bold">{item.title}</div>
                    <div className="text-[10px] text-[#7E8FA1] uppercase tracking-[0.12em]">
                      {item.category}
                    </div>
                  </td>
                  <td className="p-3.5 text-[#7E8FA1] truncate">
                    {item.file_path
                      ? `${item.file_path} (L${item.line_range?.[0]}..${item.line_range?.[1]})`
                      : '—'}
                  </td>
                  <td className="p-3.5 text-[#7E8FA1] whitespace-nowrap">
                    {formatIST(item.received_at)}
                  </td>
                  <td className="p-3.5">
                    <SectorBadge
                      label={item.claimed_by_me ? 'YOURS' : item.status}
                      tone={item.claimed_by_me ? 'stabilized' : item.status === 'open' ? 'strain' : 'legend'}
                    />
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      type="button"
                      disabled={claimingId === item.review_item_id}
                      onClick={() => handleClaimAndOpen(item)}
                      className={`px-3 py-1 uppercase text-[11px] font-bold border tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                        item.claimed_by_me
                          ? 'border-[#3F7A68] bg-[#3F7A68] text-white'
                          : 'border-[#C44D3F] text-[#E2E8EE] hover:bg-[#C44D3F] hover:text-white'
                      }`}
                    >
                      {claimingId === item.review_item_id
                        ? 'Locking...'
                        : item.claimed_by_me
                        ? 'Resume &rarr;'
                        : 'Claim & verify &rarr;'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="coordinate">
        CLAIMS LOCK FOR 10 MINUTES. EXPIRED CLAIMS RETURN TO THE OPEN QUEUE AUTOMATICALLY.
      </p>
    </div>
  );
};
