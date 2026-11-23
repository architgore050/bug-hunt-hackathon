import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ResultsResponse } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { TopoPanel } from '../../components/TopoPanel';
import { ErrorBanner } from '../../components/ErrorBanner';

export const Results: React.FC = () => {
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchResults = async () => {
    try {
      setError(null);
      const sRes = await api.getState();
      if (sRes.round?.id) {
        const rRes = await api.getResults(sRes.round.id);
        setResults(rRes);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
    const interval = setInterval(fetchResults, 30000); // /v1/results cadence
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="border-b border-[#22303F] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="coordinate">CERTIFIED LEDGER // EQUILIBRIUM BALANCE</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            Team ledger
          </h1>
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchResults} /> : null}

      {loading ? (
        <div className="p-12 text-center font-mono text-xs text-[#7E8FA1]" role="status">
          Auditing the certified ledger...
        </div>
      ) : !results?.released ? (
        <div className="topo-panel bg-[#111A27] p-8 text-center font-mono text-xs text-[#7E8FA1] space-y-2">
          <div className="text-sm font-bold text-[#E2A56B] uppercase tracking-[0.14em]">
            LEDGER SEALED
          </div>
          <p className="font-sans text-xs">
            Evaluation is in progress or awaiting release by the command post. The equilibrium
            balance opens once the stage is released.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="topo-panel border-[#3F7A68] bg-[#111A27] p-5 font-mono">
              <span className="coordinate block">Certified total</span>
              <span className="text-3xl font-bold text-[#63A98D] mt-1 block">
                {results.total} <span className="text-xs text-[#7E8FA1]">PTS</span>
              </span>
            </div>
            <div className="topo-panel bg-[#111A27] p-5 font-mono">
              <span className="coordinate block">Penalties</span>
              <span className="text-3xl font-bold text-[#E0836F] mt-1 block">
                -{results.penalties} <span className="text-xs text-[#7E8FA1]">PTS</span>
              </span>
            </div>
            <div className="topo-panel bg-[#111A27] p-5 font-mono sm:col-span-2">
              <span className="coordinate block">Component breakdown</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                {Object.entries(results.by_component || {}).map(([comp, pts]) => (
                  <div key={comp} className="flex justify-between border-b border-[#22303F]/70 pb-1">
                    <span className="text-[#7E8FA1] uppercase truncate">{comp}:</span>
                    <span className="font-bold text-[#E2E8EE]">{pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <TopoPanel sector="LD-01" coords="REF: TRANSACTIONS" title="Ledger transactions">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#0C1220] border-b border-[#22303F] text-[#7E8FA1]">
                  <tr>
                    <th className="p-3 uppercase tracking-[0.12em]">Seal</th>
                    <th className="p-3 uppercase tracking-[0.12em]">Component</th>
                    <th className="p-3 uppercase tracking-[0.12em]">Ground-truth fault</th>
                    <th className="p-3 uppercase tracking-[0.12em]">Timestamp</th>
                    <th className="p-3 uppercase tracking-[0.12em] text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#22303F]">
                  {results.entries.map((entry, i) => (
                    <tr key={i} className="hover:bg-[#131C2B]">
                      <td className="p-3 text-[#E2A56B] font-bold">{entry.receipt_code || 'SYSTEM'}</td>
                      <td className="p-3 uppercase text-[#E2E8EE]">{entry.component}</td>
                      <td className="p-3 text-[#C6D2DC]">{entry.matched_bug_code || entry.reason_code}</td>
                      <td className="p-3 text-[#7E8FA1]">{formatIST(entry.received_at)}</td>
                      <td
                        className={`p-3 text-right font-bold ${
                          entry.points >= 0 ? 'text-[#63A98D]' : 'text-[#E0836F]'
                        }`}
                      >
                        {entry.points > 0 ? `+${entry.points}` : entry.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TopoPanel>
        </div>
      )}
    </div>
  );
};
