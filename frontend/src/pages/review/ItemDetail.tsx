import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ReviewDecision, ReviewItemDetail, Rubric } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { ExhibitCard } from '../../components/ExhibitCard';
import { StampBadge } from '../../components/StampBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const ReviewItemDetailPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<ReviewItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Decision Form State
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center font-mono text-xs text-[#868A94]">
        Unpacking submission evidence and source context...
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <ErrorBanner error={error || new Error('Review candidate not found or locked by another examiner.')} />
        <Link
          to="/review"
          className="inline-block px-4 py-2 border border-[#2B2E35] text-xs font-mono text-[#ECEEF2] uppercase"
        >
          &larr; Return to Review Queue
        </Link>
      </div>
    );
  }

  const sub = item.submission;
  const payload = sub.payload || {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-[#2B2E35] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              EXAMINER DESK // ITEM: {item.review_item_id}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            {sub.title || 'Submitted Finding'}
          </h1>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="border border-[#2B2E35] bg-[#141519] px-3 py-1 text-[#868A94]">
            TEAM TOTAL FILINGS: <strong className="text-[#ECEEF2]">{item.team_total_reports}</strong>
          </div>
          <StampBadge label={`STATUS: ${item.status}`} tone="warning" />
          <Link
            to="/review"
            className="px-3 py-1.5 border border-[#2B2E35] text-xs font-mono text-[#868A94] hover:text-[#ECEEF2] uppercase"
          >
            &larr; Queue
          </Link>
        </div>
      </div>

      {decisionSuccess && (
        <div className="border border-[#3E7259] bg-[#3E7259]/10 p-4 font-mono text-xs text-[#3E7259] font-bold">
          DECISION CERTIFIED. Returning to review queue...
        </div>
      )}

      {/* Two Column Layout: Evidence vs Grading Desk */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Finding Payload & Source Code */}
        <div className="lg:col-span-7 space-y-6">
          <ExhibitCard
            exhibitNumber="EX-01"
            category="PARTICIPANT EVIDENCE"
            title="Finding Details as Filed"
          >
            <div className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-3 gap-4 pb-3 border-b border-[#2B2E35]">
                <div>
                  <span className="text-[#868A94] block">CATEGORY:</span>
                  <span className="text-[#ECEEF2] font-bold uppercase">{sub.category || '—'}</span>
                </div>
                <div>
                  <span className="text-[#868A94] block">RECEIPT:</span>
                  <span className="text-[#CF8B38] font-bold">{sub.receipt_code}</span>
                </div>
                <div>
                  <span className="text-[#868A94] block">FILED:</span>
                  <span className="text-[#ECEEF2]">{formatIST(sub.received_at)}</span>
                </div>
              </div>

              {payload.description ? (
                <div>
                  <span className="text-[#868A94] block uppercase mb-1">Root Cause Explanation:</span>
                  <div className="p-3 bg-[#111215] border border-[#2B2E35] font-sans text-sm text-[#ECEEF2] leading-relaxed whitespace-pre-wrap">
                    {String(payload.description)}
                  </div>
                </div>
              ) : null}

              {payload.evidence ? (
                <div>
                  <span className="text-[#868A94] block uppercase mb-1">Reproduction Proof:</span>
                  <div className="p-3 bg-[#111215] border border-[#2B2E35] text-[#ECEEF2] whitespace-pre-wrap">
                    {String(payload.evidence)}
                  </div>
                </div>
              ) : null}
            </div>
          </ExhibitCard>

          {/* Source Code Context */}
          {item.file && (
            <ExhibitCard
              exhibitNumber="EX-02"
              category="SOURCE CONTEXT"
              title={`Target File: ${sub.file_path}`}
            >
              <div className="max-h-96 overflow-y-auto font-mono text-xs bg-[#111215] border border-[#2B2E35]">
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
                          className={isTarget ? 'bg-[#C04A36]/25 font-bold' : ''}
                        >
                          <td className="w-10 px-2 py-0.5 text-right text-[10px] text-[#6A6E78] border-r border-[#2B2E35]">
                            {lineNum}
                          </td>
                          <td className="px-3 py-0.5 whitespace-pre font-mono text-[11px] text-[#ECEEF2]">
                            {line || ' '}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ExhibitCard>
          )}
        </div>

        {/* Right Column: Decision Desk & Rubric Sliders */}
        <div className="lg:col-span-5 space-y-6">
          <ExhibitCard
            exhibitNumber="EX-03"
            category="EVALUATION RUBRIC"
            title="Record Reviewer Determination"
            variant="buff"
          >
            <form onSubmit={handleDecision} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[#181A1F] font-bold uppercase mb-1">
                  Primary Decision
                </label>
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as ReviewDecision)}
                  className="w-full bg-[#EBE6DB] border border-[#DDD7CA] px-3 py-2 text-xs text-[#181A1F] font-bold focus:outline-none"
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
              <div className="space-y-3 pt-2 border-t border-[#DDD7CA]">
                <span className="block text-[11px] font-bold text-[#181A1F] uppercase">
                  5-Metric Scoring Rubric (0.0 to 1.0)
                </span>

                {(
                  [
                    ['functionality', 'Functionality Impact'],
                    ['root_cause', 'Root Cause Depth'],
                    ['code_quality', 'Code Quality & Diagnosis'],
                    ['testing', 'Test Rigor'],
                    ['evidence', 'Evidence Reproducibility'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#181A1F]">
                      <span>{label}</span>
                      <strong className="font-bold">{rubric[key].toFixed(2)}</strong>
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
                      className="w-full accent-[#C04A36]"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-[#181A1F] font-bold uppercase mb-1">
                  Reviewer Notes (for audit record)
                </label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Justification for rubric scores or invalid rejection..."
                  className="w-full bg-[#EBE6DB] border border-[#DDD7CA] p-2 text-xs text-[#181A1F] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase tracking-wider hover:bg-[#A83827] disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Certifying Determination...' : 'Certify Decision & Update Ledger'}
              </button>
            </form>
          </ExhibitCard>
        </div>
      </div>
    </div>
  );
};
