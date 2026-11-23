import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ReviewDecision, ReviewItemDetail, Rubric } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { InstrumentRack } from '../../components/InstrumentRack';
import { AnnunciatorBar } from '../../components/AnnunciatorBar';
import { ErrorBanner } from '../../components/ErrorBanner';

export const ReviewItemDetailPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<ReviewItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [decision, setDecision] = useState<ReviewDecision>('accept_full');
  const [rubric, setRubric] = useState<Rubric>({
    functionality: 1.0,
    root_cause: 1.0,
    code_quality: 0.8,
    testing: 0.8,
    evidence: 1.0,
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [decisionSuccess, setDecisionSuccess] = useState(false);

  const fetchItem = async () => {
    if (!itemId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getReviewItem(itemId);
      setItem(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItem();
  }, [itemId]);

  const handleDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId) return;

    try {
      setSubmitting(true);
      setError(null);
      await api.decideReviewItem(itemId, decision, rubric, notes);
      setDecisionSuccess(true);
      setTimeout(() => {
        navigate('/review');
      }, 1500);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center font-mono text-xs text-[#7F8896]">
        Unpacking triage payload and source registers...
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <ErrorBanner error={error || new Error('Review candidate not found or locked by another examiner.')} />
        <Link
          to="/review"
          className="inline-block px-3 py-1.5 border border-[#3D4654] text-xs font-mono text-[#EAECE8] uppercase font-bold"
        >
          &larr; Return to Triage Queue
        </Link>
      </div>
    );
  }

  const sub = item.submission;
  const payload = sub.payload || {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-[#2D333D] pb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CALIBRATION DESK // CANDIDATE: {item.review_item_id}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            {sub.title || 'Submitted Finding'}
          </h1>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="instr-bezel px-3 py-1 text-[#7F8896]">
            TEAM FILINGS: <strong className="text-[#EAECE8]">{item.team_total_reports}</strong>
          </div>
          <AnnunciatorBar label={`STATE: ${item.status}`} tone="amber" />
          <Link
            to="/review"
            className="px-2.5 py-1 border border-[#3D4654] text-xs font-mono text-[#7F8896] hover:text-[#EAECE8] uppercase"
          >
            &larr; Queue
          </Link>
        </div>
      </div>

      {decisionSuccess && (
        <div className="instr-bezel p-3 border border-[#437A55] text-[#437A55] font-bold text-xs font-mono">
          DECISION RECORDED TO LEDGER. Returning to queue...
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Payload & Source (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <InstrumentRack
            channel="EVIDENCE-01"
            title="Finding Payload Analysis"
            telemetryTag="RAW TELEMETRY"
          >
            <div className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-3 gap-2 pb-2.5 border-b border-[#2D333D]">
                <div>
                  <span className="text-[#7F8896] block text-[10px]">CATEGORY:</span>
                  <span className="text-[#EAECE8] font-bold uppercase">{sub.category || '—'}</span>
                </div>
                <div>
                  <span className="text-[#7F8896] block text-[10px]">RECEIPT:</span>
                  <span className="text-[#E5A83B] font-bold">{sub.receipt_code}</span>
                </div>
                <div>
                  <span className="text-[#7F8896] block text-[10px]">TIMESTAMP:</span>
                  <span className="text-[#EAECE8]">{formatIST(sub.received_at)}</span>
                </div>
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
                  <span className="text-[#7F8896] block uppercase text-[10px] mb-1">Reproduction Proof:</span>
                  <div className="instr-bezel p-3 text-xs text-[#EAECE8] whitespace-pre-wrap">
                    {String(payload.evidence)}
                  </div>
                </div>
              ) : null}
            </div>
          </InstrumentRack>

          {item.file && (
            <InstrumentRack
              channel="SOURCE-01"
              title={`Module Source: ${sub.file_path}`}
              telemetryTag="SOURCE CONTEXT"
            >
              <div className="max-h-96 overflow-y-auto font-mono text-xs bg-[#101216] border border-[#2D333D]">
                <table className="w-full border-collapse">
                  <tbody>
                    {item.file.content.split('\n').map((line, idx) => {
                      const lineNum = idx + 1;
                      const isTarget =
                        sub.line_range &&
                        lineNum >= sub.line_range[0] &&
                        lineNum <= sub.line_range[1];
                      return (
                        <tr
                          key={lineNum}
                          className={isTarget ? 'bg-[#E5A83B]/25 font-bold' : ''}
                        >
                          <td className="w-10 px-2 py-0.5 text-right text-[10px] text-[#555C68] border-r border-[#2D333D]">
                            {lineNum}
                          </td>
                          <td className="px-3 py-0.5 whitespace-pre font-mono text-[11px] text-[#EAECE8]">
                            {line || ' '}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </InstrumentRack>
          )}
        </div>

        {/* Right: Scoring Rubric Potentiometers (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <InstrumentRack
            channel="RUBRIC-01"
            title="Examiner Rubric Determination"
            telemetryTag="CALIBRATION"
          >
            <form onSubmit={handleDecision} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[#EAECE8] font-bold uppercase text-[10px] mb-1">
                  Primary Classification
                </label>
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as ReviewDecision)}
                  className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1.5 text-xs text-[#EAECE8] font-bold focus:border-[#E5A83B] focus:outline-none"
                >
                  <option value="accept_full">ACCEPT FULL — Full points</option>
                  <option value="accept_partial">ACCEPT PARTIAL — Minor inaccuracies</option>
                  <option value="duplicate">DUPLICATE — Already reported</option>
                  <option value="reject_invalid">REJECT INVALID — Spammed / Working (-5 pts)</option>
                  <option value="unplanned_valid">UNPLANNED VALID — Novel vulnerability</option>
                  <option value="needs_second_review">NEEDS SECOND REVIEW — Escalate to lead</option>
                </select>
              </div>

              {/* Rubric Sliders */}
              <div className="space-y-2.5 pt-2 border-t border-[#2D333D]">
                <span className="block text-[10px] font-bold text-[#7F8896] uppercase">
                  5-Metric Calibration (0.0 to 1.0)
                </span>

                {(
                  [
                    ['functionality', 'Functionality Impact'],
                    ['root_cause', 'Root Cause Depth'],
                    ['code_quality', 'Code Quality & Diagnosis'],
                    ['testing', 'Test Suite Rigor'],
                    ['evidence', 'Evidence Reproducibility'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#EAECE8]">
                      <span>{label}</span>
                      <strong className="font-bold text-[#E5A83B]">{rubric[key].toFixed(2)}</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={rubric[key]}
                      onChange={(e) =>
                        setRubric((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))
                      }
                      className="w-full accent-[#E5A83B]"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                  Examiner Audit Notes
                </label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Justification for rubric marks..."
                  className="w-full bg-[#101216] border border-[#2D333D] p-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Committing...' : 'Commit Evaluation to Ledger'}
              </button>
            </form>
          </InstrumentRack>
        </div>
      </div>
    </div>
  );
};
