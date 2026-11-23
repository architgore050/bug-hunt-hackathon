import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SubmissionDetail } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { ExhibitCard } from '../../components/ExhibitCard';
import { StampBadge } from '../../components/StampBadge';
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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 text-center font-mono text-xs text-[#868A94]">
        Unsealing submission evidence envelope...
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <ErrorBanner error={error || new Error('Submission record not found or inaccessible.')} />
        <Link
          to="/app/submissions"
          className="inline-block px-4 py-2 border border-[#2B2E35] text-xs font-mono text-[#ECEEF2] uppercase"
        >
          &larr; Return to Submissions Docket
        </Link>
      </div>
    );
  }

  const payload = submission.payload || {};

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-[#2B2E35] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              FILING DOSSIER // REF: {submission.receipt_code}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            {submission.title || 'CTF Flag Submission'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <StampBadge label={`STATUS: ${submission.status}`} tone="info" />
          <Link
            to="/app/submissions"
            className="px-3 py-1.5 border border-[#2B2E35] text-xs font-mono text-[#868A94] hover:text-[#ECEEF2] uppercase"
          >
            &larr; Back
          </Link>
        </div>
      </div>

      {/* Exhibit 01: Report As Filed */}
      <ExhibitCard
        exhibitNumber="EX-01"
        category="ORIGINAL FILING RECORD"
        title="Filed Vulnerability Details"
      >
        <div className="space-y-4 font-mono text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-[#2B2E35]">
            <div>
              <span className="text-[#868A94] block">KIND:</span>
              <span className="font-bold text-[#ECEEF2] uppercase">{submission.kind}</span>
            </div>
            <div>
              <span className="text-[#868A94] block">RECEIVED AT:</span>
              <span className="text-[#ECEEF2]">{formatIST(submission.received_at)}</span>
            </div>
            {submission.file_path && (
              <div>
                <span className="text-[#868A94] block">LOCATION:</span>
                <span className="text-[#CF8B38] font-bold">
                  {submission.file_path} (L{submission.line_range?.[0]}..{submission.line_range?.[1]})
                </span>
              </div>
            )}
            {submission.category && (
              <div>
                <span className="text-[#868A94] block">TAXONOMY:</span>
                <span className="text-[#ECEEF2] font-bold uppercase">{submission.category}</span>
              </div>
            )}
          </div>

          {payload.description ? (
            <div className="space-y-1">
              <span className="text-[#868A94] block uppercase">Root Cause Description:</span>
              <div className="p-3 bg-[#111215] border border-[#2B2E35] text-[#ECEEF2] font-sans text-sm whitespace-pre-wrap leading-relaxed">
                {String(payload.description)}
              </div>
            </div>
          ) : null}

          {payload.evidence ? (
            <div className="space-y-1">
              <span className="text-[#868A94] block uppercase">Exploit Proof / Evidence:</span>
              <div className="p-3 bg-[#111215] border border-[#2B2E35] text-[#ECEEF2] whitespace-pre-wrap">
                {String(payload.evidence)}
              </div>
            </div>
          ) : null}

          {payload.suggested_fix ? (
            <div className="space-y-1">
              <span className="text-[#868A94] block uppercase">Suggested Fix:</span>
              <div className="p-3 bg-[#111215] border border-[#2B2E35] text-[#ECEEF2] whitespace-pre-wrap">
                {String(payload.suggested_fix)}
              </div>
            </div>
          ) : null}

          {submission.flag_code && (
            <div className="space-y-1">
              <span className="text-[#868A94] block uppercase">Captured Flag Code:</span>
              <div className="p-3 bg-[#111215] border border-[#3E7259] text-[#3E7259] font-bold">
                {submission.flag_code}
              </div>
            </div>
          )}
        </div>
      </ExhibitCard>

      {/* Exhibit 02: Evaluation Verdict & Ledger Outcome */}
      <ExhibitCard
        exhibitNumber="EX-02"
        category="EVALUATION VERDICT"
        title="Ledger Outcome & Matched Findings"
        variant="buff"
      >
        <div className="space-y-3 font-mono text-xs">
          {submission.matched_bug_code ? (
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-[#DDD7CA]">
                <span className="text-[#6A665D]">MATCHED BUG IDENTIFIER</span>
                <span className="font-bold text-[#181A1F]">{submission.matched_bug_code}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#DDD7CA]">
                <span className="text-[#6A665D]">POINTS AWARDED</span>
                <span className="font-bold text-[#3E7259]">{submission.points ?? 0} PTS</span>
              </div>
            </div>
          ) : (
            <div className="py-2 text-[#6A665D]">
              <span className="font-bold text-[#181A1F]">EVALUATION SEALED (INT-01):</span> Findings remain sealed until stage feedback release. Receipt code serves as immutable cryptographic proof of submission.
            </div>
          )}
        </div>
      </ExhibitCard>

      {/* Dispute Section */}
      {submission.matched_bug_code && submission.status !== 'disputed' && (
        <ExhibitCard
          exhibitNumber="EX-03"
          category="CONTESTATION PROTOCOL"
          title="File Formal Evaluation Dispute"
        >
          {disputeSuccess ? (
            <div className="border border-[#3E7259] bg-[#3E7259]/10 p-4 font-mono text-xs text-[#3E7259]">
              Dispute successfully filed. Review team has been notified for secondary arbitration.
            </div>
          ) : (
            <form onSubmit={handleDispute} className="space-y-3 font-mono text-xs">
              {disputeError ? <ErrorBanner error={disputeError} /> : null}
              <div>
                <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                  Dispute Statement (10..1000 characters)
                </label>
                <textarea
                  required
                  rows={3}
                  minLength={10}
                  maxLength={1000}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="Detail why this finding should be re-evaluated..."
                  className="w-full bg-[#111215] border border-[#2B2E35] p-2 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={disputing || statement.trim().length < 10}
                className="px-4 py-2 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase hover:bg-[#A83827] disabled:opacity-40 transition-colors"
              >
                {disputing ? 'Submitting Dispute...' : 'File Dispute'}
              </button>
            </form>
          )}
        </ExhibitCard>
      )}
    </div>
  );
};
