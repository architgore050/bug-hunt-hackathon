import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ResultsResponse } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { ExhibitCard } from '../../components/ExhibitCard';
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-[#2B2E35] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              CERTIFIED OUTCOME // LEDGER BALANCES
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            Team Score & Cryptographic Ledger
          </h1>
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchResults} /> : null}

      {loading ? (
        <div className="p-12 text-center font-mono text-xs text-[#868A94]">
          Auditing stage results from ledger...
        </div>
      ) : !results?.released ? (
        <div className="border border-[#2B2E35] bg-[#181A1F] p-8 text-center font-mono text-xs text-[#868A94] space-y-2">
          <div className="text-sm font-bold text-[#CF8B38]">RESULTS CURRENTLY SEALED</div>
          <p className="font-sans text-xs">
            Evaluation is in progress or awaiting organizer feedback release. Check back once stage is released.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="border border-[#3E7259] bg-[#181A1F] p-5 font-mono">
              <span className="text-[11px] text-[#868A94] uppercase block">Total Certified Score</span>
              <span className="text-3xl font-bold text-[#5EA57E] mt-1 block">
                {results.total} <span className="text-xs text-[#868A94]">PTS</span>
              </span>
            </div>

            <div className="border border-[#2B2E35] bg-[#181A1F] p-5 font-mono">
              <span className="text-[11px] text-[#868A94] uppercase block">Penalties Incurred</span>
              <span className="text-3xl font-bold text-[#E2715A] mt-1 block">
                -{results.penalties} <span className="text-xs text-[#868A94]">PTS</span>
              </span>
            </div>

            <div className="border border-[#2B2E35] bg-[#181A1F] p-5 font-mono sm:col-span-2">
              <span className="text-[11px] text-[#868A94] uppercase block">Component Breakdown</span>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                {Object.entries(results.by_component || {}).map(([comp, pts]) => (
                  <div key={comp} className="flex justify-between border-b border-[#2B2E35]/60 pb-1">
                    <span className="text-[#868A94] uppercase truncate">{comp}:</span>
                    <span className="font-bold text-[#ECEEF2]">{pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Ledger Entries Table */}
          <ExhibitCard
            exhibitNumber="EX-01"
            category="AUDIT TRAIL"
            title="Individual Ledger Transactions"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#141519] border-b border-[#2B2E35] text-[#868A94]">
                  <tr>
                    <th className="p-3 uppercase">Receipt Code</th>
                    <th className="p-3 uppercase">Component</th>
                    <th className="p-3 uppercase">Reason / Bug Code</th>
                    <th className="p-3 uppercase">Timestamp</th>
                    <th className="p-3 uppercase text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2B2E35]">
                  {results.entries.map((entry, i) => (
                    <tr key={i} className="hover:bg-[#1E2026]">
                      <td className="p-3 text-[#CF8B38] font-bold">{entry.receipt_code || 'SYSTEM'}</td>
                      <td className="p-3 uppercase">{entry.component}</td>
                      <td className="p-3 text-[#ECEEF2]">{entry.matched_bug_code || entry.reason_code}</td>
                      <td className="p-3 text-[#868A94]">{formatIST(entry.received_at)}</td>
                      <td
                        className={`p-3 text-right font-bold ${
                          entry.points >= 0 ? 'text-[#5EA57E]' : 'text-[#E2715A]'
                        }`}
                      >
                        {entry.points > 0 ? `+${entry.points}` : entry.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ExhibitCard>
        </div>
      )}
    </div>
  );
};
