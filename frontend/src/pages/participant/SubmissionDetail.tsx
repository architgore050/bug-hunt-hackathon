import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SubmissionDetail } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { TopoPanel } from '../../components/TopoPanel';
import { SectorBadge } from '../../components/SectorBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const SubmissionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Dispute state
  const [statement, setStatement] = useState('');
  const [disputing, setDisputing] = useState(false);
  const [disputeSuccess, setDisputeSuccess] = useState(false);
  const [disputeError, setDisputeError] = useState<unknown>(null);

  const fetchDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getSubmission(id);
      setSubmission(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || statement.trim().length < 10) return;

    try {
      setDisputing(true);
      setDisputeError(null);
      await api.disputeSubmission(id, statement.trim());
      setDisputeSuccess(true);
      fetchDetail();
    } catch (err) {
      setDisputeError(err);
    } finally {
      setDisputing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 text-center font-mono text-xs text-[#718294]" role="status">
        Unsealing the filing envelope...
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <ErrorBanner error={error || new Error('Filing record not found or inaccessible.')} />
        <Link
          to="/app/submissions"
          className="inline-block px-4 py-2 border border-[#22303F] text-xs font-mono text-[#E2E8EE] uppercase tracking-[0.12em] hover:bg-[#1A273A] transition-colors"
        >
          &larr; Return to the filing log
        </Link>
      </div>
    );
  }

  const payload = submission.payload || {};

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="border-b border-[#22303F] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="coordinate">FILING DOSSIER // SEAL: {submission.receipt_code}</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            {submission.title || 'CTF flag filing'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <SectorBadge label={`STATUS: ${submission.status.toUpperCase()}`} tone="elevation" />
          <Link
            to="/app/submissions"
            className="px-3 py-1.5 border border-[#22303F] text-xs font-mono text-[#718294] hover:text-[#E2E8EE] uppercase tracking-[0.12em] transition-colors"
          >
            &larr; Log
          </Link>
        </div>
      </div>

      {/* As filed */}
      <TopoPanel sector="FD-01" coords="REF: ORIGINAL FILING" title="The finding as filed">
        <div className="space-y-4 font-mono text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-[#22303F]">
            <div>
              <span className="coordinate block">KIND</span>
              <span className="font-bold text-[#E2E8EE] uppercase">{submission.kind}</span>
            </div>
            <div>
              <span className="coordinate block">RECEIVED</span>
              <span className="text-[#E2E8EE]">{formatIST(submission.received_at)}</span>
            </div>
            {submission.file_path && (
              <div>
                <span className="coordinate block">COORDINATE</span>
                <span className="text-[#CF824B] font-bold">
                  {submission.file_path} (L{submission.line_range?.[0]}..{submission.line_range?.[1]})
                </span>
              </div>
            )}
            {submission.category && (
              <div>
                <span className="coordinate block">TAXONOMY VECTOR</span>
                <span className="text-[#E2E8EE] font-bold uppercase">{submission.category}</span>
              </div>
            )}
          </div>

          {payload.description ? (
            <div className="space-y-1">
              <span className="coordinate block">Root cause</span>
              <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] font-sans text-sm whitespace-pre-wrap leading-relaxed">
                {String(payload.description)}
              </div>
            </div>
          ) : null}

          {payload.impact ? (
            <div className="space-y-1">
              <span className="coordinate block">Impact radius</span>
              <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] whitespace-pre-wrap">
                {String(payload.impact)}
              </div>
            </div>
          ) : null}

          {payload.evidence ? (
            <div className="space-y-1">
              <span className="coordinate block">Reproduction proof</span>
              <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] whitespace-pre-wrap">
                {String(payload.evidence)}
              </div>
            </div>
          ) : null}

          {payload.suggested_fix ? (
            <div className="space-y-1">
              <span className="coordinate block">Proposed anchor</span>
              <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] whitespace-pre-wrap">
                {String(payload.suggested_fix)}
              </div>
            </div>
          ) : null}

          {submission.flag_code && (
            <div className="space-y-1">
              <span className="coordinate block">Recovered flag</span>
              <div className="p-3 bg-[#0C1220] border border-[#3F7A68] text-[#3F7A68] font-bold">
                {submission.flag_code}
              </div>
            </div>
          )}
        </div>
      </TopoPanel>

      {/* Verdict */}
      <TopoPanel
        sector="FD-02"
        coords="REF: LEDGER OUTCOME"
        title="Evaluation outcome"
        variant="chart"
      >
        <div className="space-y-3 font-mono text-xs">
          {submission.matched_bug_code ? (
            <div className="space-y-2">
              <div className="flex justify-between py-1.5 border-b border-[#2A3B50]">
                <span className="text-[#718294] uppercase tracking-[0.12em]">MATCHED GROUND-TRUTH FAULT</span>
                <span className="font-bold text-[#E2E8EE]">{submission.matched_bug_code}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#2A3B50]">
                <span className="text-[#718294] uppercase tracking-[0.12em]">POINTS ANCHORED</span>
                <span className="font-bold text-[#3F7A68]">{submission.points ?? 0} PTS</span>
              </div>
            </div>
          ) : (
            <div className="py-2 text-[#718294]">
              <span className="font-bold text-[#E2E8EE] uppercase tracking-[0.12em]">
                EVALUATION SEALED:
              </span>{' '}
              Findings stay sealed until the command post releases stage feedback. The HMAC seal
              remains immutable proof that your filing reached the desk in time.
            </div>
          )}
        </div>
      </TopoPanel>

      {/* Dispute */}
      {submission.matched_bug_code && submission.status !== 'disputed' && (
        <TopoPanel sector="FD-03" coords="REF: CONTESTATION" title="Contest this evaluation">
          {disputeSuccess ? (
            <div className="border border-[#3F7A68] bg-[#3F7A68]/10 p-4 font-mono text-xs text-[#3F7A68]">
              Dispute filed. The verification panel has been notified for secondary arbitration.
            </div>
          ) : (
            <form onSubmit={handleDispute} className="space-y-3 font-mono text-xs">
              {disputeError ? <ErrorBanner error={disputeError} /> : null}
              <div>
                <label htmlFor="dispute-statement" className="coordinate block mb-1">
                  Dispute statement (10..1000 chars)
                </label>
                <textarea
                  id="dispute-statement"
                  required
                  rows={3}
                  minLength={10}
                  maxLength={1000}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="State precisely why this evaluation should be re-surveyed..."
                  className="w-full bg-[#0C1220] border border-[#22303F] p-2 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={disputing || statement.trim().length < 10}
                className="px-4 py-2 bg-[#CF824B] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#B87040] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
              >
                {disputing ? 'Filing dispute...' : 'File the dispute'}
              </button>
            </form>
          )}
        </TopoPanel>
      )}
    </div>
  );
};
