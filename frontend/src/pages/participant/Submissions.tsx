import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SubmissionItem } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { AnnunciatorBar } from '../../components/AnnunciatorBar';
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2D333D]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CHANNEL CH-03 // TRANSMISSION LOGS
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Transmitted Telemetry Receipts
          </h1>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="instr-bezel px-3 py-1 text-[#7F8896]">
            ENTRIES: <strong className="text-[#EAECE8]">{submissions.length}</strong>
          </div>
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchSubmissions} /> : null}

      <div className="instr-rack border border-[#2D333D] bg-[#181B20] overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center font-mono text-xs text-[#7F8896]">
            Streaming transmission receipts from bus...
          </div>
        ) : submissions.length === 0 ? (
          <div className="p-10 text-center font-mono text-xs text-[#7F8896] space-y-2">
            <div>No telemetry logged to station bus yet.</div>
            <Link
              to="/app/workspace"
              className="inline-block px-3 py-1.5 border border-[#E5A83B] text-[#E5A83B] uppercase font-bold"
            >
              Open Bench & Transmit &rarr;
            </Link>
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#14161A] border-b border-[#2D333D] text-[#7F8896]">
              <tr>
                <th className="p-3 uppercase">Receipt</th>
                <th className="p-3 uppercase">Class</th>
                <th className="p-3 uppercase">Diagnosis Heading</th>
                <th className="p-3 uppercase">Module Location</th>
                <th className="p-3 uppercase">Transmitted</th>
                <th className="p-3 uppercase">State</th>
                <th className="p-3 uppercase text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D333D]">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-[#1C2026]">
                  <td className="p-3 font-bold text-[#E5A83B]">{sub.receipt_code}</td>
                  <td className="p-3">
                    <AnnunciatorBar
                      label={sub.kind === 'ctf_flag' ? 'FLAG' : 'REPORT'}
                      tone={sub.kind === 'ctf_flag' ? 'sage' : 'cyan'}
                    />
                  </td>
                  <td className="p-3 max-w-xs truncate text-[#EAECE8]">
                    <div className="font-bold">{sub.title || sub.flag_code || 'Untitled'}</div>
                    {sub.category && <div className="text-[10px] text-[#7F8896]">{sub.category}</div>}
                  </td>
                  <td className="p-3 text-[#7F8896] truncate">
                    {sub.file_path ? `${sub.file_path} (L${sub.line_range?.[0]}..${sub.line_range?.[1]})` : '—'}
                  </td>
                  <td className="p-3 text-[#7F8896] whitespace-nowrap">
                    {formatIST(sub.received_at)}
                  </td>
                  <td className="p-3">
                    <AnnunciatorBar
                      label={sub.status}
                      tone={
                        sub.status.includes('match') || sub.status === 'accept_full'
                          ? 'sage'
                          : sub.status.includes('reject')
                          ? 'crimson'
                          : sub.status === 'received'
                          ? 'cyan'
                          : 'amber'
                      }
                    />
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      to={`/app/submissions/${sub.id}`}
                      className="px-2.5 py-1 border border-[#3D4654] text-[#EAECE8] hover:bg-[#2A2F38] inline-block uppercase text-[10px] font-bold"
                    >
                      Inspect &rarr;
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
