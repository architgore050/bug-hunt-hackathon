import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { LeaderboardResponse } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { InstrumentRack } from '../../components/InstrumentRack';
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-[#2D333D] pb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CHANNEL CH-05 // MASTER BOARD
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Station Standings & Rank Registers
          </h1>
        </div>

        {boardData?.generated_at && (
          <div className="text-xs font-mono text-[#7F8896]">
            SNAPSHOT: {formatIST(boardData.generated_at)}
          </div>
        )}
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchBoard} /> : null}

      {loading ? (
        <div className="p-10 text-center font-mono text-xs text-[#7F8896]">
          Polling rank registers from scoreboard cache...
        </div>
      ) : !boardData?.visible ? (
        <div className="instr-bezel p-6 text-center font-mono text-xs text-[#7F8896] space-y-2">
          <div className="text-sm font-bold text-[#E5A83B]">LEADERBOARD CURRENTLY SEALED</div>
          <p className="font-sans text-xs">
            Standings hidden to prevent live score tracking. Unlocks once results are certified.
          </p>
        </div>
      ) : (
        <InstrumentRack
          channel="LEADERBOARD-01"
          title="Consolidated Team Rankings"
          telemetryTag="CERTIFIED RANKS"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#101216] border-b border-[#2D333D] text-[#7F8896]">
                <tr>
                  <th className="p-3 uppercase">Rank</th>
                  <th className="p-3 uppercase">Operator Unit</th>
                  <th className="p-3 uppercase">Cumulative Score</th>
                  <th className="p-3 uppercase">Invalid Filings</th>
                  <th className="p-3 uppercase">Last Verified Finding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D333D]">
                {(boardData.snapshot || []).map((row) => (
                  <tr
                    key={row.rank}
                    className={`hover:bg-[#1C2026] ${
                      row.rank === 1
                        ? 'bg-[#E5A83B]/10 font-bold'
                        : row.rank === 2
                        ? 'bg-[#467499]/10'
                        : row.rank === 3
                        ? 'bg-[#437A55]/10'
                        : ''
                    }`}
                  >
                    <td className="p-3 font-bold text-sm">
                      {row.rank === 1 ? (
                        <span className="text-[#E5A83B]">01</span>
                      ) : (
                        String(row.rank).padStart(2, '0')
                      )}
                    </td>
                    <td className="p-3 font-bold text-[#EAECE8]">{row.team_name}</td>
                    <td className="p-3 font-bold text-sm text-[#5FA57F]">{row.score} PTS</td>
                    <td className="p-3 text-[#D96A5F]">{row.invalid_reports}</td>
                    <td className="p-3 text-[#7F8896]">
                      {row.last_accepted ? formatIST(row.last_accepted) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[#2D333D] text-[10px] font-mono text-[#7F8896] flex items-center justify-between">
            <span>TIE-BREAK: Total Points &rarr; Minimal Invalids &rarr; Earliest Acceptance (INT-12)</span>
            <span>SDC CERTIFIED</span>
          </div>
        </InstrumentRack>
      )}
    </div>
  );
};
