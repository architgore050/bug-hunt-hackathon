import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ReviewDecision, ReviewItemDetail, Rubric } from '../../lib/types';
import { formatIST } from '../../lib/time';
import { TopoPanel } from '../../components/TopoPanel';
import { SectorBadge } from '../../components/SectorBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const ReviewItemDetailPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<ReviewItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Decision form state
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center font-mono text-xs text-[#7E8FA1]" role="status">
        Unrolling the survey chart for this filing...
      </div>
    );
  }

  if (error && !item) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <ErrorBanner error={error} onRetry={fetchItem} />
        <Link
          to="/review"
          className="inline-block px-4 py-2 border border-[#22303F] text-xs font-mono text-[#E2E8EE] uppercase tracking-[0.12em]"
        >
          &larr; Verification ledger
        </Link>
      </div>
    );
  }

  if (!item) return null;

  const sub = item.submission;
  const payload = sub.payload || {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="border-b border-[#22303F] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="coordinate">VERIFICATION DESK // FILING: {item.review_item_id}</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            {sub.title || 'Submitted finding'}
          </h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="topo-panel bg-[#0C1220] px-3 py-1.5 text-[#7E8FA1]">
            TEAM FILINGS: <strong className="text-[#E2E8EE]">{item.team_total_reports}</strong>
          </div>
          <SectorBadge label={`LOCK: ${item.status.toUpperCase()}`} tone="strain" />
          <Link
            to="/review"
            className="px-3 py-1.5 border border-[#22303F] text-xs font-mono text-[#7E8FA1] hover:text-[#E2E8EE] uppercase tracking-[0.12em]"
          >
            &larr; Ledger
          </Link>
        </div>
      </div>

      {decisionSuccess && (
        <div
          className="border border-[#3F7A68] bg-[#3F7A68]/10 p-4 font-mono text-xs text-[#63A98D] font-bold uppercase tracking-[0.12em]"
          role="status"
        >
          VERDICT INSCRIBED IN THE LEDGER. Returning to the queue...
        </div>
      )}

      {error ? <ErrorBanner error={error} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Evidence column */}
        <div className="lg:col-span-7 space-y-6">
          <TopoPanel sector="VD-01" coords="REF: FILING AS SUBMITTED" title="The claim under verification">
            <div className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-3 gap-4 pb-3 border-b border-[#22303F]">
                <div>
                  <span className="coordinate block">TAXONOMY</span>
                  <span className="text-[#E2E8EE] font-bold uppercase">{sub.category || '—'}</span>
                </div>
                <div>
                  <span className="coordinate block">HMAC SEAL</span>
                  <span className="text-[#E2A56B] font-bold">{sub.receipt_code}</span>
                </div>
                <div>
                  <span className="coordinate block">FILED</span>
                  <span className="text-[#E2E8EE]">{formatIST(sub.received_at)}</span>
                </div>
              </div>

              {payload.description ? (
                <div>
                  <span className="coordinate block mb-1">Claimed root cause</span>
                  <div className="p-3 bg-[#0C1220] border border-[#22303F] font-sans text-sm text-[#E2E8EE] leading-relaxed whitespace-pre-wrap">
                    {String(payload.description)}
                  </div>
                </div>
              ) : null}

              {payload.impact ? (
                <div>
                  <span className="coordinate block mb-1">Claimed impact</span>
                  <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] whitespace-pre-wrap">
                    {String(payload.impact)}
                  </div>
                </div>
              ) : null}

              {payload.evidence ? (
                <div>
                  <span className="coordinate block mb-1">Submitted reproduction</span>
                  <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] whitespace-pre-wrap">
                    {String(payload.evidence)}
                  </div>
                </div>
              ) : null}

              {payload.suggested_fix ? (
                <div>
                  <span className="coordinate block mb-1">Proposed anchor</span>
                  <div className="p-3 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] whitespace-pre-wrap">
                    {String(payload.suggested_fix)}
                  </div>
                </div>
              ) : null}
            </div>
          </TopoPanel>

          {item.file && (
            <TopoPanel
              sector="VD-02"
              coords={sub.file_path ? `COORD:${sub.file_path}` : 'SOURCE CONTEXT'}
              title="Ground-truth source chart"
              subtitle="Marked band is the claimed fault span."
            >
              <div className="max-h-96 overflow-y-auto font-mono text-xs bg-[#0C1220] border border-[#22303F]">
                <table className="w-full border-collapse">
                  <tbody>
                    {item.file.content.split('\n').map((line, idx) => {
                      const lineNum = idx + 1;
                      const isTarget =
                        sub.line_range &&
                        lineNum >= sub.line_range[0] &&
                        lineNum <= sub.line_range[1];
                      return (
                        <tr key={lineNum} className={isTarget ? 'bg-[#C44D3F]/25 font-bold' : ''}>
                          <td
                            className={`w-12 px-2 py-0.5 text-right text-[10px] border-r border-[#22303F] ${
                              isTarget ? 'text-[#E0836F]' : 'text-[#7E8FA1]'
                            }`}
                          >
                            {lineNum}
                          </td>
                          <td className="px-3 py-0.5 whitespace-pre font-mono text-[11px] text-[#C6D2DC]">
                            {line || ' '}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TopoPanel>
          )}
        </div>

        {/* Decision column */}
        <div className="lg:col-span-5 space-y-6">
          <TopoPanel
            sector="VD-03"
            coords="REF: VERDICT DOCKET"
            title="Inscribe the verdict"
            variant="chart"
          >
            <form onSubmit={handleDecision} className="space-y-4 font-mono text-xs">
              <div>
                <label htmlFor="rv-decision" className="block text-[#E2E8EE] font-bold uppercase tracking-[0.12em] mb-1">
                  Verdict
                </label>
                <select
                  id="rv-decision"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as ReviewDecision)}
                  className="w-full bg-[#131C2B] border border-[#2A3B50] px-3 py-2 text-xs text-[#E2E8EE] font-bold focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  <option value="accept_full">ACCEPT FULL: full points</option>
                  <option value="accept_partial">ACCEPT PARTIAL: minor inaccuracies</option>
                  <option value="duplicate">DUPLICATE: already reported</option>
                  <option value="reject_invalid">REJECT INVALID: out of scope (-5 pts)</option>
                  <option value="unplanned_valid">UNPLANNED VALID: novel finding</option>
                  <option value="needs_second_review">SECOND REVIEW: escalate to lead</option>
                </select>
              </div>

              <div className="space-y-3 pt-2 border-t border-[#2A3B50]">
                <span className="block text-[11px] font-bold text-[#E2E8EE] uppercase tracking-[0.12em]">
                  Five-metric rubric (0.0 to 1.0)
                </span>
                {(
                  [
                    ['functionality', 'Functionality impact'],
                    ['root_cause', 'Root cause depth'],
                    ['code_quality', 'Code quality & diagnosis'],
                    ['testing', 'Test rigor'],
                    ['evidence', 'Evidence reproducibility'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#C6D2DC]">
                      <span>{label}</span>
                      <strong className="font-bold tabular-nums">{rubric[key].toFixed(2)}</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={rubric[key]}
                      aria-label={`Rubric score for ${label}`}
                      onChange={(e) =>
                        setRubric((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))
                      }
                      className="w-full accent-[#4A8FA8]"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label htmlFor="rv-notes" className="block text-[#E2E8EE] font-bold uppercase tracking-[0.12em] mb-1">
                  Verification notes (audit record)
                </label>
                <textarea
                  id="rv-notes"
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Justification for the rubric scores or rejection..."
                  className="w-full bg-[#131C2B] border border-[#2A3B50] p-2 text-xs text-[#E2E8EE] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[#C44D3F] text-white font-bold uppercase tracking-[0.14em] hover:bg-[#A83E32] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
              >
                {submitting ? 'Inscribing verdict...' : 'Inscribe verdict & update ledger'}
              </button>
            </form>
          </TopoPanel>
        </div>
      </div>
    </div>
  );
};
