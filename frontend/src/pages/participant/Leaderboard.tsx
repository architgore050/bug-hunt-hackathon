import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { LeaderboardResponse } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { ExhibitCard } from '../../components/ExhibitCard';
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
    const interval = setInterval(fetchBoard, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-[#2B2E35] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              LIVE STANDINGS // BOARD SNAPSHOT
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            Competition Standings
          </h1>
        </div>

        {boardData?.generated_at && (
          <div className="text-xs font-mono text-[#868A94]">
            GENERATED: {formatIST(boardData.generated_at)}
          </div>
        )}
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchBoard} /> : null}

      {loading ? (
        <div className="p-12 text-center font-mono text-xs text-[#868A94]">
          Computing cryptographic rank snapshots...
        </div>
      ) : !boardData?.visible ? (
        <div className="border border-[#2B2E35] bg-[#181A1F] p-8 text-center font-mono text-xs text-[#868A94] space-y-2">
          <div className="text-sm font-bold text-[#CF8B38]">STANDINGS CURRENTLY SEALED</div>
          <p className="font-sans text-xs">
            Leaderboard mode is set to hidden for active stages to prevent scoreboard scoping. Board unlocks once results are certified.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <ExhibitCard
            exhibitNumber="EX-01"
            category="OFFICIAL RANKINGS"
            title="Team Standings Table"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#141519] border-b border-[#2B2E35] text-[#868A94]">
                  <tr>
                    <th className="p-3 uppercase">Rank</th>
                    <th className="p-3 uppercase">Team Designation</th>
                    <th className="p-3 uppercase">Total Score</th>
                    <th className="p-3 uppercase">Invalid Reports</th>
                    <th className="p-3 uppercase">Last Accepted Finding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2B2E35]">
                  {(boardData.snapshot || []).map((row) => (
                    <tr
                      key={row.rank}
                      className={`hover:bg-[#1E2026] ${
                        row.rank === 1
                          ? 'bg-[#CF8B38]/10'
                          : row.rank === 2
                          ? 'bg-[#868A94]/10'
                          : row.rank === 3
                          ? 'bg-[#C04A36]/10'
                          : ''
                      }`}
                    >
                      <td className="p-3 font-bold text-sm">
                        {row.rank === 1 ? (
                          <span className="text-[#CF8B38]">01</span>
                        ) : (
                          String(row.rank).padStart(2, '0')
                        )}
                      </td>
                      <td className="p-3 font-bold text-[#ECEEF2]">{row.team_name}</td>
                      <td className="p-3 font-bold text-sm text-[#5EA57E]">{row.score} PTS</td>
                      <td className="p-3 text-[#E2715A]">{row.invalid_reports}</td>
                      <td className="p-3 text-[#868A94]">
                        {row.last_accepted ? formatIST(row.last_accepted) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-3 border-t border-[#2B2E35] text-[11px] font-mono text-[#868A94] flex items-center justify-between">
              <span>TIE-BREAK ORDER: Total Points &rarr; Fewer Invalid Reports &rarr; Earlier Timestamp (INT-12)</span>
              <span>CERTIFIED BY SDC</span>
            </div>
          </ExhibitCard>
        </div>
      )}
    </div>
  );
};
