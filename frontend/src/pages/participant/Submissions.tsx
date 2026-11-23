import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SubmissionItem } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { SectorBadge } from '../../components/SectorBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const Submissions: React.FC = () => {
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchSubmissions = async () => {
    try {
      setError(null);
      const res = await api.getSubmissions();
      setSubmissions(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
    const interval = setInterval(fetchSubmissions, 15000); // /v1/submissions cadence
    return () => clearInterval(interval);
  }, []);

  const bugReports = submissions.filter((s) => s.kind === 'bug_report');
  const ctfFlags = submissions.filter((s) => s.kind === 'ctf_flag');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#22303F]">
        <div>
          <p className="coordinate">FILING LOG // SEALED RECEIPTS</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE]">
            Filed findings
          </h1>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="topo-panel bg-[#0C1220] px-3 py-1.5 text-[#7E8FA1]">
            TOTAL: <strong className="text-[#E2E8EE]">{submissions.length}</strong>
          </div>
          <div className="topo-panel bg-[#0C1220] px-3 py-1.5 text-[#7E8FA1]">
            FAULTS: <strong className="text-[#E2A56B]">{bugReports.length}</strong>
          </div>
          <div className="topo-panel bg-[#0C1220] px-3 py-1.5 text-[#7E8FA1]">
            FLAGS: <strong className="text-[#63A98D]">{ctfFlags.length}</strong>
          </div>
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchSubmissions} /> : null}

      <div className="topo-panel bg-[#111A27] overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center font-mono text-xs text-[#7E8FA1]" role="status">
            Unsealing the filing log...
          </div>
        ) : submissions.length === 0 ? (
          <div className="p-12 text-center font-mono text-xs text-[#7E8FA1] space-y-3">
            <div>No findings filed yet. The map awaits your survey.</div>
            <Link
              to="/app/workspace"
              className="inline-block px-4 py-2 border border-[#4A8FA8] text-[#E2E8EE] uppercase tracking-[0.14em] hover:bg-[#4A8FA8]/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
            >
              Open the field desk &rarr;
            </Link>
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#0C1220] border-b border-[#22303F] text-[#7E8FA1]">
              <tr>
                <th className="p-3.5 uppercase tracking-[0.12em]">Seal</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Kind</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Finding</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Coordinate</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Filed</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Verdict</th>
                <th className="p-3.5 uppercase tracking-[0.12em]">Dossier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22303F]">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-[#131C2B] transition-colors">
                  <td className="p-3.5 font-bold text-[#E2A56B]">{sub.receipt_code}</td>
                  <td className="p-3.5">
                    <SectorBadge
                      label={sub.kind === 'ctf_flag' ? 'FLAG' : 'FAULT'}
                      tone={sub.kind === 'ctf_flag' ? 'stabilized' : 'elevation'}
                    />
                  </td>
                  <td className="p-3.5 max-w-xs truncate text-[#E2E8EE]">
                    <div className="font-bold">{sub.title || sub.flag_code || 'Untitled finding'}</div>
                    {sub.category && (
                      <div className="text-[10px] text-[#7E8FA1] uppercase tracking-[0.12em]">
                        {sub.category}
                      </div>
                    )}
                  </td>
                  <td className="p-3.5 text-[#7E8FA1] truncate">
                    {sub.file_path
                      ? `${sub.file_path} (L${sub.line_range?.[0]}..${sub.line_range?.[1]})`
                      : '—'}
                  </td>
                  <td className="p-3.5 text-[#7E8FA1] whitespace-nowrap">
                    {formatIST(sub.received_at)}
                  </td>
                  <td className="p-3.5">
                    <SectorBadge
                      label={sub.status}
                      tone={
                        sub.status.includes('match') || sub.status === 'accept_full'
                          ? 'stabilized'
                          : sub.status.includes('reject')
                          ? 'shear'
                          : sub.status === 'received'
                          ? 'elevation'
                          : 'strain'
                      }
                    />
                  </td>
                  <td className="p-3.5">
                    <Link
                      to={`/app/submissions/${sub.id}`}
                      className="px-2.5 py-1 border border-[#22303F] text-[#E2E8EE] hover:bg-[#1A273A] inline-block uppercase text-[11px] tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                    >
                      Open &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="coordinate">
        VERDICTS REMAIN MASKED AS "RECEIVED" UNTIL THE COMMAND POST RELEASES STAGE FEEDBACK.
      </p>
    </div>
  );
};
