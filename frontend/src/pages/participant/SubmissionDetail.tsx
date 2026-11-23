import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SubmissionDetail } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { InstrumentRack } from '../../components/InstrumentRack';
import { AnnunciatorBar } from '../../components/AnnunciatorBar';
import { ErrorBanner } from '../../components/ErrorBanner';

export const SubmissionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 text-center font-mono text-xs text-[#7F8896]">
        Unlocking telemetry envelope...
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <ErrorBanner error={error || new Error('Telemetry log entry not found or inaccessible.')} />
        <Link
          to="/app/submissions"
          className="inline-block px-3 py-1.5 border border-[#3D4654] text-xs font-mono text-[#EAECE8] uppercase font-bold"
        >
          &larr; Return to Telemetry Bus
        </Link>
      </div>
    );
  }

  const payload = submission.payload || {};

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-[#2D333D] pb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              TELEMETRY LOG // RECEIPT: {submission.receipt_code}
            </span>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-[#EAECE8] mt-1">
            {submission.title || 'CTF Flag Transceiver'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <AnnunciatorBar label={`STATE: ${submission.status}`} tone="cyan" />
          <Link
            to="/app/submissions"
            className="px-2.5 py-1 border border-[#3D4654] text-xs font-mono text-[#7F8896] hover:text-[#EAECE8] uppercase"
          >
            &larr; Logs
          </Link>
        </div>
      </div>

      <InstrumentRack
        channel="LOG-01"
        title="Recorded Diagnostic Payload"
        telemetryTag="STATION MEMORY"
      >
        <div className="space-y-3 font-mono text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-[#2D333D]">
            <div>
              <span className="text-[#7F8896] block text-[10px]">CLASS:</span>
              <span className="font-bold text-[#EAECE8] uppercase">{submission.kind}</span>
            </div>
            <div>
              <span className="text-[#7F8896] block text-[10px]">TIMESTAMP:</span>
              <span className="text-[#EAECE8]">{formatIST(submission.received_at)}</span>
            </div>
            {submission.file_path && (
              <div>
                <span className="text-[#7F8896] block text-[10px]">MODULE:</span>
                <span className="text-[#E5A83B] font-bold">
                  {submission.file_path} (L{submission.line_range?.[0]}..{submission.line_range?.[1]})
                </span>
              </div>
            )}
            {submission.category && (
              <div>
                <span className="text-[#7F8896] block text-[10px]">TAXONOMY:</span>
                <span className="text-[#EAECE8] font-bold uppercase">{submission.category}</span>
              </div>
            )}
          </div>

          {payload.description ? (
            <div>
              <span className="text-[#7F8896] block uppercase text-[10px] mb-1">Root Cause Explanation:</span>
              <div className="instr-bezel p-3 font-sans text-xs text-[#EAECE8] leading-relaxed whitespace-pre-wrap">
                {String(payload.description)}
              </div>
            </div>
          ) : null}

          {payload.evidence ? (
            <div>
              <span className="text-[#7F8896] block uppercase text-[10px] mb-1">Evidence Proof:</span>
              <div className="instr-bezel p-3 text-xs text-[#EAECE8] whitespace-pre-wrap">
                {String(payload.evidence)}
              </div>
            </div>
          ) : null}

          {payload.suggested_fix ? (
            <div>
              <span className="text-[#7F8896] block uppercase text-[10px] mb-1">Remediation Patch:</span>
              <div className="instr-bezel p-3 text-xs text-[#EAECE8] whitespace-pre-wrap">
                {String(payload.suggested_fix)}
              </div>
            </div>
          ) : null}

          {submission.flag_code && (
            <div>
              <span className="text-[#7F8896] block uppercase text-[10px] mb-1">Flag Payload:</span>
              <div className="instr-bezel p-2 text-[#437A55] font-bold">
                {submission.flag_code}
              </div>
            </div>
          )}
        </div>
      </InstrumentRack>

      {/* Determination Outcome */}
      <InstrumentRack
        channel="LOG-02"
        title="Ledger Scoring Outcome"
        telemetryTag="CERTIFIED LEDGER"
      >
        <div className="space-y-2 font-mono text-xs">
          {submission.matched_bug_code ? (
            <div className="space-y-1.5">
              <div className="flex justify-between py-1 border-b border-[#2D333D]">
                <span className="text-[#7F8896]">MATCHED BUG IDENTIFIER</span>
                <span className="font-bold text-[#EAECE8]">{submission.matched_bug_code}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#2D333D]">
                <span className="text-[#7F8896]">POINTS ASSIGNED</span>
                <span className="font-bold text-[#437A55]">+{submission.points ?? 0} PTS</span>
              </div>
            </div>
          ) : (
            <div className="text-[#7F8896]">
              STATUS: SEALED. Findings masked until stage release per INT-01 protocol. Receipt code guarantees tamper-evident timestamp.
            </div>
          )}
        </div>
      </InstrumentRack>

      {/* Dispute Section */}
      {submission.matched_bug_code && submission.status !== 'disputed' && (
        <InstrumentRack
          channel="LOG-03"
          title="File Telemetry Dispute"
          telemetryTag="ARBITRATION"
        >
          {disputeSuccess ? (
            <div className="instr-bezel p-3 border border-[#437A55] text-[#437A55] font-bold text-xs">
              Dispute successfully queued. Examiner escalation pending.
            </div>
          ) : (
            <form onSubmit={handleDispute} className="space-y-3 font-mono text-xs">
              {disputeError ? <ErrorBanner error={disputeError} /> : null}
              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                  Dispute Statement (10..1000 characters)
                </label>
                <textarea
                  required
                  rows={3}
                  minLength={10}
                  maxLength={1000}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="Detail grounds for re-calibration..."
                  className="w-full bg-[#101216] border border-[#2D333D] p-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={disputing || statement.trim().length < 10}
                className="px-4 py-1.5 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B] disabled:opacity-40 transition-colors"
              >
                {disputing ? 'Transmitting Dispute...' : 'Dispatch Dispute'}
              </button>
            </form>
          )}
        </InstrumentRack>
      )}
    </div>
  );
};
