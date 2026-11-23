import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { LeaderboardResponse } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { TopoPanel } from '../../components/TopoPanel';
import { ErrorBanner } from '../../components/ErrorBanner';

export const Leaderboard: React.FC = () => {
  const [boardData, setBoardData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchBoard = async () => {
    try {
      setError(null);
      const sRes = await api.getState();
      if (sRes.round?.id) {
        const bRes = await api.getLeaderboard(sRes.round.id);
        setBoardData(bRes);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoard();
    const interval = setInterval(fetchBoard, 20000); // /v1/leaderboard cadence
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="border-b border-[#22303F] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="coordinate">ELEVATION TABLE // TEAM PEAKS</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            Survey standings
          </h1>
        </div>
        {boardData?.generated_at && (
          <div className="text-xs font-mono text-[#7E8FA1]">
            SNAPSHOT: {formatIST(boardData.generated_at)}
          </div>
        )}
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchBoard} /> : null}

      {loading ? (
        <div className="p-12 text-center font-mono text-xs text-[#7E8FA1]" role="status">
          Triangulating team elevations...
        </div>
      ) : !boardData?.visible ? (
        <div className="topo-panel bg-[#111A27] p-8 text-center font-mono text-xs text-[#7E8FA1] space-y-2">
          <div className="text-sm font-bold text-[#E2A56B] uppercase tracking-[0.14em]">
            ELEVATION SEALED
          </div>
          <p className="font-sans text-xs">
            Standings are hidden during active strata to prevent scoreboard scoping. The table
            unlocks once results are certified.
          </p>
        </div>
      ) : (
        <TopoPanel sector="EP-01" coords="REF: RANKED PEAKS" title="Team elevation table">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#0C1220] border-b border-[#22303F] text-[#7E8FA1]">
                <tr>
                  <th className="p-3 uppercase tracking-[0.12em]">Rank</th>
                  <th className="p-3 uppercase tracking-[0.12em]">Team</th>
                  <th className="p-3 uppercase tracking-[0.12em]">Elevation</th>
                  <th className="p-3 uppercase tracking-[0.12em]">Invalid filings</th>
                  <th className="p-3 uppercase tracking-[0.12em]">Last accepted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22303F]">
                {(boardData.snapshot || []).map((row) => (
                  <tr key={row.rank} className="hover:bg-[#131C2B]">
                    <td className="p-3 font-bold text-sm">
                      {row.rank === 1 ? (
                        <span className="text-[#E2A56B]">{String(row.rank).padStart(2, '0')}</span>
                      ) : (
                        String(row.rank).padStart(2, '0')
                      )}
                    </td>
                    <td className="p-3 font-bold text-[#E2E8EE]">{row.team_name}</td>
                    <td className="p-3 font-bold text-sm text-[#63A98D]">{row.score} PTS</td>
                    <td className="p-3 text-[#E0836F]">{row.invalid_reports}</td>
                    <td className="p-3 text-[#7E8FA1]">
                      {row.last_accepted ? formatIST(row.last_accepted) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-3 border-t border-[#22303F] text-[11px] font-mono text-[#7E8FA1] flex flex-wrap items-center justify-between gap-2">
            <span>TIE-BREAK: TOTAL POINTS &rarr; FEWER INVALID FILINGS &rarr; EARLIER TIMESTAMP</span>
            <span className="coordinate">CERTIFIED BY THE COMMAND POST</span>
          </div>
        </TopoPanel>
      )}
    </div>
  );
};
