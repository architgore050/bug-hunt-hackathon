import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ResultsResponse } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { InstrumentRack } from '../../components/InstrumentRack';
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
    const interval = setInterval(fetchResults, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-[#2D333D] pb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CHANNEL CH-04 // METRIC LEDGER
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Certified Scoring Telemetry
          </h1>
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchResults} /> : null}

      {loading ? (
        <div className="p-10 text-center font-mono text-xs text-[#7F8896]">
          Interrogating ledger balances from database bus...
        </div>
      ) : !results?.released ? (
        <div className="instr-bezel p-6 text-center font-mono text-xs text-[#7F8896] space-y-2">
          <div className="text-sm font-bold text-[#E5A83B]">RESULTS CURRENTLY SEALED</div>
          <p className="font-sans text-xs">
            Evaluation is in flight. Results unlock upon organizer feedback release.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="instr-bezel p-4 font-mono">
              <span className="text-[10px] text-[#7F8896] uppercase block">Total Points</span>
              <span className="text-3xl font-black text-[#437A55] mt-1 block">
                {results.total} <span className="text-xs text-[#7F8896]">PTS</span>
              </span>
            </div>

            <div className="instr-bezel p-4 font-mono">
              <span className="text-[10px] text-[#7F8896] uppercase block">Penalties</span>
              <span className="text-3xl font-black text-[#BD3A3A] mt-1 block">
                -{results.penalties} <span className="text-xs text-[#7F8896]">PTS</span>
              </span>
            </div>

            <div className="instr-bezel p-4 font-mono sm:col-span-2">
              <span className="text-[10px] text-[#7F8896] uppercase block mb-1">Subsystem Weights</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(results.by_component || {}).map(([comp, pts]) => (
                  <div key={comp} className="flex justify-between border-b border-[#2D333D] pb-1">
                    <span className="text-[#7F8896] uppercase truncate">{comp}:</span>
                    <span className="font-bold text-[#EAECE8]">{pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <InstrumentRack
            channel="TX-ENTRIES"
            title="Individual Ledger Transactions"
            telemetryTag="CERTIFIED LEDGER"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#101216] border-b border-[#2D333D] text-[#7F8896]">
                  <tr>
                    <th className="p-3 uppercase">Receipt</th>
                    <th className="p-3 uppercase">Component</th>
                    <th className="p-3 uppercase">Reason / Bug Code</th>
                    <th className="p-3 uppercase">Timestamp</th>
                    <th className="p-3 uppercase text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2D333D]">
                  {results.entries.map((entry, i) => (
                    <tr key={i} className="hover:bg-[#1C2026]">
                      <td className="p-3 text-[#E5A83B] font-bold">{entry.receipt_code || 'SYSTEM'}</td>
                      <td className="p-3 uppercase">{entry.component}</td>
                      <td className="p-3 text-[#EAECE8]">{entry.matched_bug_code || entry.reason_code}</td>
                      <td className="p-3 text-[#7F8896]">{formatIST(entry.received_at)}</td>
                      <td
                        className={`p-3 text-right font-bold ${
                          entry.points >= 0 ? 'text-[#437A55]' : 'text-[#BD3A3A]'
                        }`}
                      >
                        {entry.points > 0 ? `+${entry.points}` : entry.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </InstrumentRack>
        </div>
      )}
    </div>
  );
};
