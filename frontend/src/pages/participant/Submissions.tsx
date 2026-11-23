import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SubmissionItem } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { StampBadge } from '../../components/StampBadge';
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
    const interval = setInterval(fetchSubmissions, 15000);
    return () => clearInterval(interval);
  }, []);

  const bugReports = submissions.filter((s) => s.kind === 'bug_report');
  const ctfFlags = submissions.filter((s) => s.kind === 'ctf_flag');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2B2E35]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              HISTORICAL RECORD // AUDIT SLIPS
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2]">
            Filed Submissions Docket
          </h1>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="border border-[#2B2E35] bg-[#141519] px-3 py-1 text-[#868A94]">
            TOTAL: <strong className="text-[#ECEEF2]">{submissions.length}</strong>
          </div>
          <div className="border border-[#2B2E35] bg-[#141519] px-3 py-1 text-[#868A94]">
            REPORTS: <strong className="text-[#CF8B38]">{bugReports.length}</strong>
          </div>
          <div className="border border-[#2B2E35] bg-[#141519] px-3 py-1 text-[#868A94]">
            FLAGS: <strong className="text-[#3E7259]">{ctfFlags.length}</strong>
          </div>
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchSubmissions} /> : null}

      <div className="border border-[#2B2E35] bg-[#181A1F] overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center font-mono text-xs text-[#868A94]">
            Retrieving submission receipts from audit chain...
          </div>
        ) : submissions.length === 0 ? (
          <div className="p-12 text-center font-mono text-xs text-[#868A94] space-y-3">
            <div>No submissions filed yet.</div>
            <Link
              to="/app/workspace"
              className="inline-block px-4 py-2 border border-[#C04A36] text-[#ECEEF2] uppercase"
            >
              Open Workspace & File Report &rarr;
            </Link>
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#141519] border-b border-[#2B2E35] text-[#868A94]">
              <tr>
                <th className="p-3.5 uppercase">Receipt Code</th>
                <th className="p-3.5 uppercase">Kind</th>
                <th className="p-3.5 uppercase">Title / Category</th>
                <th className="p-3.5 uppercase">Target Location</th>
                <th className="p-3.5 uppercase">Timestamp</th>
                <th className="p-3.5 uppercase">Status / Verdict</th>
                <th className="p-3.5 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2B2E35]">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-[#1E2026] transition-colors">
                  <td className="p-3.5 font-bold text-[#CF8B38]">{sub.receipt_code}</td>
                  <td className="p-3.5">
                    <StampBadge
                      label={sub.kind === 'ctf_flag' ? 'FLAG' : 'REPORT'}
                      tone={sub.kind === 'ctf_flag' ? 'success' : 'info'}
                    />
                  </td>
                  <td className="p-3.5 max-w-xs truncate text-[#ECEEF2]">
                    <div className="font-bold">{sub.title || sub.flag_code || 'Untitled Report'}</div>
                    {sub.category && <div className="text-[10px] text-[#868A94]">{sub.category}</div>}
                  </td>
                  <td className="p-3.5 text-[#868A94] truncate">
                    {sub.file_path ? `${sub.file_path} (L${sub.line_range?.[0]}..${sub.line_range?.[1]})` : '—'}
                  </td>
                  <td className="p-3.5 text-[#868A94] whitespace-nowrap">
                    {formatIST(sub.received_at)}
                  </td>
                  <td className="p-3.5">
                    <StampBadge
                      label={sub.status}
                      tone={
                        sub.status.includes('match') || sub.status === 'accept_full'
                          ? 'success'
                          : sub.status.includes('reject')
                          ? 'danger'
                          : sub.status === 'received'
                          ? 'info'
                          : 'warning'
                      }
                    />
                  </td>
                  <td className="p-3.5">
                    <Link
                      to={`/app/submissions/${sub.id}`}
                      className="px-2.5 py-1 border border-[#2B2E35] text-[#ECEEF2] hover:bg-[#2B2E35] inline-block uppercase text-[11px]"
                    >
                      Dossier &rarr;
                    </Link>
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
