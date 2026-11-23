import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ReviewQueueItem } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { StampBadge } from '../../components/StampBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const ReviewQueue: React.FC = () => {
  const navigate = useNavigate();

  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'claimed' | 'mine'>('all');
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
    const interval = setInterval(fetchQueue, 8000); // 8s per spec
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2B2E35]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              ASSESSMENT PROTOCOL // TRIAGE DESK
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            Reviewer Examination Queue
          </h1>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 font-mono text-xs">
          {(['all', 'open', 'claimed', 'mine'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1 uppercase border ${
                filter === f
                  ? 'border-[#C04A36] bg-[#C04A36] text-white font-bold'
                  : 'border-[#2B2E35] text-[#868A94] hover:bg-[#20232A]'
              }`}
            >
              {f} ({queue.filter((item) => (f === 'all' ? true : f === 'mine' ? item.claimed_by_me : item.status === f)).length})
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchQueue} /> : null}

      <div className="border border-[#2B2E35] bg-[#181A1F] overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center font-mono text-xs text-[#868A94]">
            Retrieving triage candidates from evaluator queue...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center font-mono text-xs text-[#868A94]">
            No pending submissions matching filter criteria.
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#141519] border-b border-[#2B2E35] text-[#868A94]">
              <tr>
                <th className="p-3.5 uppercase">Priority</th>
                <th className="p-3.5 uppercase">Title / Category</th>
                <th className="p-3.5 uppercase">File Location</th>
                <th className="p-3.5 uppercase">Received</th>
                <th className="p-3.5 uppercase">Status</th>
                <th className="p-3.5 uppercase text-right">Triage Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2B2E35]">
              {filteredItems.map((item) => (
                <tr key={item.review_item_id} className="hover:bg-[#1E2026]">
                  <td className="p-3.5 font-bold text-[#CF8B38]">P{item.priority}</td>
                  <td className="p-3.5 max-w-sm truncate text-[#ECEEF2]">
                    <div className="font-bold">{item.title}</div>
                    <div className="text-[10px] text-[#868A94] uppercase">{item.category}</div>
                  </td>
                  <td className="p-3.5 text-[#868A94] truncate">
                    {item.file_path ? `${item.file_path} (L${item.line_range?.[0]}..${item.line_range?.[1]})` : '—'}
                  </td>
                  <td className="p-3.5 text-[#868A94] whitespace-nowrap">
                    {formatIST(item.received_at)}
                  </td>
                  <td className="p-3.5">
                    <StampBadge
                      label={item.claimed_by_me ? 'CLAIMED BY YOU' : item.status}
                      tone={item.claimed_by_me ? 'success' : item.status === 'open' ? 'warning' : 'neutral'}
                    />
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      type="button"
                      disabled={claimingId === item.review_item_id}
                      onClick={() => handleClaimAndOpen(item)}
                      className={`px-3 py-1 uppercase text-[11px] font-bold border ${
                        item.claimed_by_me
                          ? 'border-[#3E7259] bg-[#3E7259] text-[#ECEEF2]'
                          : 'border-[#C04A36] text-[#ECEEF2] hover:bg-[#C04A36]'
                      }`}
                    >
                      {claimingId === item.review_item_id
                        ? 'Locking...'
                        : item.claimed_by_me
                        ? 'Resume Review &rarr;'
                        : 'Claim & Inspect &rarr;'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
