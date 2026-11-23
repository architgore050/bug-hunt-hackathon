import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ReviewQueueItem } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { AnnunciatorBar } from '../../components/AnnunciatorBar';
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
    const interval = setInterval(fetchQueue, 8000);
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2D333D]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              TRIAGE DESK // CHANNEL CH-REV
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Examiner Calibration Queue
          </h1>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-xs">
          {(['all', 'open', 'claimed', 'mine'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1 uppercase text-[10px] font-bold border ${
                filter === f
                  ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013]'
                  : 'border-[#2D333D] text-[#7F8896] hover:bg-[#20242B]'
              }`}
            >
              {f} ({queue.filter((item) => (f === 'all' ? true : f === 'mine' ? item.claimed_by_me : item.status === f)).length})
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchQueue} /> : null}

      <div className="instr-rack border border-[#2D333D] bg-[#181B20] overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center font-mono text-xs text-[#7F8896]">
            Polling triage candidates from evaluation bus...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center font-mono text-xs text-[#7F8896]">
            No triage candidates currently matching filter.
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#14161A] border-b border-[#2D333D] text-[#7F8896]">
              <tr>
                <th className="p-3 uppercase">Priority</th>
                <th className="p-3 uppercase">Heading / Taxonomy</th>
                <th className="p-3 uppercase">Module Location</th>
                <th className="p-3 uppercase">Received</th>
                <th className="p-3 uppercase">State</th>
                <th className="p-3 uppercase text-right">Actuator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D333D]">
              {filteredItems.map((item) => (
                <tr key={item.review_item_id} className="hover:bg-[#1C2026]">
                  <td className="p-3 font-bold text-[#E5A83B]">P{item.priority}</td>
                  <td className="p-3 max-w-sm truncate text-[#EAECE8]">
                    <div className="font-bold">{item.title}</div>
                    <div className="text-[10px] text-[#7F8896] uppercase">{item.category}</div>
                  </td>
                  <td className="p-3 text-[#7F8896] truncate">
                    {item.file_path ? `${item.file_path} (L${item.line_range?.[0]}..${item.line_range?.[1]})` : '—'}
                  </td>
                  <td className="p-3 text-[#7F8896] whitespace-nowrap">
                    {formatIST(item.received_at)}
                  </td>
                  <td className="p-3">
                    <AnnunciatorBar
                      label={item.claimed_by_me ? 'LOCKED BY YOU' : item.status}
                      tone={item.claimed_by_me ? 'sage' : item.status === 'open' ? 'amber' : 'neutral'}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      disabled={claimingId === item.review_item_id}
                      onClick={() => handleClaimAndOpen(item)}
                      className={`px-3 py-1 uppercase text-[10px] font-bold border ${
                        item.claimed_by_me
                          ? 'border-[#437A55] bg-[#437A55] text-white'
                          : 'border-[#E5A83B] text-[#E5A83B] hover:bg-[#E5A83B] hover:text-[#0E1013]'
                      }`}
                    >
                      {claimingId === item.review_item_id
                        ? 'Locking...'
                        : item.claimed_by_me
                        ? 'Resume Triage &rarr;'
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
