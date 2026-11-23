import React, { useEffect, useState, useRef } from 'react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type {
  Assignment,
  BugCategory,
  FileContentResponse,
  SubmissionIn,
  SubmissionReceipt,
} from '../../lib/types';
import { ErrorBanner } from '../../components/ErrorBanner';
import { TopoPanel } from '../../components/TopoPanel';

const CATEGORIES: { value: BugCategory; label: string }[] = [
  { value: 'authentication', label: 'Authentication & Session Handling' },
  { value: 'authorization', label: 'Authorization & Access Control (IDOR)' },
  { value: 'injection', label: 'Injection (SQL, Command, Traversal)' },
  { value: 'data_handling', label: 'Data Handling & Validation' },
  { value: 'business_logic', label: 'Business Logic & Workflow Bypass' },
  { value: 'cryptography', label: 'Cryptographic Weakness' },
  { value: 'error_handling', label: 'Error Handling & Info Disclosure' },
  { value: 'api_design', label: 'API Design & Verb Misuse' },
  { value: 'rate_limiting', label: 'Rate Limiting & DoS Vector' },
  { value: 'concurrency', label: 'Concurrency & Race Conditions' },
  { value: 'configuration', label: 'Insecure Defaults & Configuration' },
  { value: 'integrity', label: 'Data & State Integrity' },
];

const inputCls =
  'w-full bg-[#0C1220] border border-[#22303F] px-2.5 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none';

export const Workspace: React.FC = () => {
  const { rulesAccepted } = useAuth();

  // Assignment & file state
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [loadingAssignment, setLoadingAssignment] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [assignmentError, setAssignmentError] = useState<unknown>(null);

  // Terrain search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ path: string; line_number: number; text: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  // Docket tab: fracture report vs CTF flag
  const [activeTab, setActiveTab] = useState<'report' | 'flag'>('report');

  // Report form state
  const [lineStart, setLineStart] = useState<number>(1);
  const [lineEnd, setLineEnd] = useState<number>(1);
  const [category, setCategory] = useState<BugCategory>('authorization');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState('');
  const [evidence, setEvidence] = useState('');
  const [suggestedFix, setSuggestedFix] = useState('');

  // Flag form state
  const [flagCode, setFlagCode] = useState('');

  // Submission & draft status
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'dirty' | 'conflict'>('saved');
  const [draftVersion, setDraftVersion] = useState<number>(1);
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAssignments = async () => {
    try {
      setLoadingAssignment(true);
      setAssignmentError(null);
      const res = await api.getAssignments();
      if (res.assignments && res.assignments.length > 0) {
        const asgn = res.assignments[0];
        setAssignment(asgn);
        if (asgn.files && asgn.files.length > 0) {
          const defaultFile = asgn.files[0].path;
          setSelectedFile(defaultFile);
          loadFile(asgn.challenge_id, defaultFile);
        }
      }
    } catch (err) {
      setAssignmentError(err);
    } finally {
      setLoadingAssignment(false);
    }
  };

  const loadFile = async (challengeId: string, path: string) => {
    try {
      setLoadingFile(true);
      setSelectedFile(path);
      const data = await api.getFileContent(challengeId, path);
      setFileContent(data);
    } catch {
      // file load fault: viewer keeps previous content
    } finally {
      setLoadingFile(false);
    }
  };

  useEffect(() => {
    loadAssignments();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignment || searchQuery.trim().length < 2) return;
    try {
      setSearching(true);
      const res = await api.searchChallenge(assignment.challenge_id, searchQuery.trim());
      setSearchResults(res);
    } catch {
      // search faults are non-blocking
    } finally {
      setSearching(false);
    }
  };

  // Draft autosave: 3s debounce while dirty, optimistic version conflict detection
  useEffect(() => {
    if (!assignment) return;
    setDraftStatus('dirty');

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(async () => {
      try {
        setDraftStatus('saving');
        const res = await api.saveDraft(
          assignment.challenge_id,
          {
            file_path: selectedFile,
            line_start: lineStart,
            line_end: lineEnd,
            category,
            claimed_severity: severity,
            title,
            description,
            impact,
            evidence,
            suggested_fix: suggestedFix,
          },
          draftVersion
        );
        setDraftVersion(res.version);
        setDraftStatus('saved');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DRAFT_VERSION_CONFLICT') {
          setDraftStatus('conflict');
        } else {
          setDraftStatus('dirty');
        }
      }
    }, 3000);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
    // draftVersion and assignment are deliberately excluded: the effect must
    // re-arm only when filed content changes, not when a save bumps the version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, lineStart, lineEnd, category, severity, title, description, impact, evidence, suggestedFix]);

  // Line coordinate selection: click sets start, shift-click extends end
  const handleLineClick = (lineNum: number, shiftKey: boolean) => {
    if (shiftKey) {
      if (lineNum >= lineStart) {
        setLineEnd(lineNum);
      } else {
        setLineStart(lineNum);
      }
    } else {
      setLineStart(lineNum);
      setLineEnd(lineNum);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignment) return;

    const span = Math.abs(lineEnd - lineStart) + 1;
    if (span > 25) {
      setSubmitError(new Error('Selected line span exceeds the maximum allowed 25 lines.'));
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const idempotencyKey = 'idemp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
      const payload: SubmissionIn = {
        kind: 'bug_report',
        file_path: selectedFile,
        line_start: Math.min(lineStart, lineEnd),
        line_end: Math.max(lineStart, lineEnd),
        category,
        claimed_severity: severity,
        title,
        description,
        impact,
        evidence,
        suggested_fix: suggestedFix,
      };

      const res = await api.submitReport(payload, idempotencyKey);
      setReceipt(res);
      setTitle('');
      setDescription('');
      setEvidence('');
      setImpact('');
      setSuggestedFix('');
    } catch (err: unknown) {
      setSubmitError(err);
      if (err instanceof ApiError && err.code === 'SUBMISSION_COOLDOWN' && err.details?.n) {
        const secs = Number(err.details.n);
        setCooldownRemaining(secs);
        const cd = setInterval(() => {
          setCooldownRemaining((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(cd);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignment || !flagCode.trim()) return;

    try {
      setSubmitting(true);
      setSubmitError(null);
      const idempotencyKey = 'flag-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
      const payload: SubmissionIn = {
        kind: 'ctf_flag',
        flag_code: flagCode.trim(),
      };
      const res = await api.submitReport(payload, idempotencyKey);
      setReceipt(res);
      setFlagCode('');
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const draftTone =
    draftStatus === 'saved'
      ? 'text-[#63A98D] font-bold'
      : draftStatus === 'saving'
      ? 'text-[#E2A56B] font-bold'
      : draftStatus === 'conflict'
      ? 'text-[#E0836F] font-bold'
      : 'text-[#7E8FA1]';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Desk header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#22303F]">
        <div>
          <p className="coordinate">FIELD DESK // QUADRANT WS-01</p>
          <h1 className="text-2xl font-serif font-black text-[#E2E8EE]">
            Strata explorer & fault filing docket
          </h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="topo-panel bg-[#0C1220] px-3 py-1.5">
            <span className="text-[#7E8FA1]">DRAFT:</span>
            <span className={`ml-1.5 uppercase tracking-[0.12em] ${draftTone}`} aria-live="polite">
              {draftStatus.toUpperCase()}
            </span>
          </div>
          {cooldownRemaining !== null && (
            <div className="px-3 py-1.5 border border-[#C44D3F] bg-[#C44D3F]/10 text-[#E0836F] font-bold uppercase tracking-[0.12em]">
              COOLDOWN: {cooldownRemaining}s
            </div>
          )}
        </div>
      </div>

      {assignmentError ? <ErrorBanner error={assignmentError} onRetry={loadAssignments} /> : null}

      {!rulesAccepted && (
        <div className="border border-[#CF824B] bg-[#CF824B]/10 p-4 text-xs font-mono text-[#E2E8EE] flex flex-wrap items-center justify-between gap-3">
          <span>The survey protocol must be ratified before challenge terrain becomes accessible.</span>
          <a href="/app" className="underline font-bold text-[#E2A56B]">
            Ratify at base camp &rarr;
          </a>
        </div>
      )}

      {/* Three-quadrant field desk */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Quadrant 1: Strata Explorer */}
        <div className="lg:col-span-3 space-y-4">
          <TopoPanel
            sector="Q1 // STRATA EXPLORER"
            coords={`${assignment?.files?.length || 0} LAYERS`}
            title="Terrain layers"
          >
            <form onSubmit={handleSearch} className="space-y-1.5 font-mono text-xs">
              <label htmlFor="ws-search" className="coordinate block">
                Deep search
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="ws-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search lines..."
                  className={inputCls}
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="px-2.5 py-1.5 bg-[#1A273A] border border-[#22303F] text-[#E2E8EE] hover:bg-[#22334A] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  {searching ? '...' : 'Probe'}
                </button>
              </div>
            </form>

            {searchResults.length > 0 && (
              <div className="mt-3 border border-[#22303F] bg-[#0C1220] p-2 max-h-40 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                <div className="coordinate text-[#E2A56B]">
                  STRIKE POINTS ({searchResults.length})
                </div>
                {searchResults.map((hit, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      if (assignment) {
                        loadFile(assignment.challenge_id, hit.path);
                        setLineStart(hit.line_number);
                        setLineEnd(hit.line_number);
                      }
                    }}
                    className="w-full text-left truncate block text-[#7E8FA1] hover:text-[#E2E8EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                  >
                    <span className="text-[#E2A56B]">L{hit.line_number}:</span> {hit.text}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1 pt-3 max-h-[500px] overflow-y-auto font-mono text-xs">
              {loadingAssignment ? (
                <div className="text-[#7E8FA1] py-4 text-center" role="status">
                  Charting terrain...
                </div>
              ) : assignment?.files?.length ? (
                assignment.files.map((file) => {
                  const isSelected = selectedFile === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => {
                        if (assignment) loadFile(assignment.challenge_id, file.path);
                      }}
                      aria-current={isSelected ? 'true' : undefined}
                      className={`w-full text-left px-2.5 py-2 flex items-center justify-between border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                        isSelected
                          ? 'border-[#4A8FA8] bg-[#4A8FA8]/10 text-[#E2E8EE] font-bold'
                          : 'border-transparent text-[#7E8FA1] hover:text-[#E2E8EE] hover:bg-[#1A273A]'
                      }`}
                    >
                      <span className="truncate">{file.path}</span>
                      <span className="text-[10px] text-[#7E8FA1]">{file.line_count}L</span>
                    </button>
                  );
                })
              ) : (
                <div className="text-[#7E8FA1] py-4 text-center">
                  No terrain delivered yet. Layers appear once the stratum arms.
                </div>
              )}
            </div>
          </TopoPanel>
        </div>

        {/* Quadrant 2: Fracture Inspection Viewer */}
        <div className="lg:col-span-5 space-y-4">
          <TopoPanel
            sector="Q2 // FRACTURE VIEWER"
            coords={selectedFile ? `FILE: ${selectedFile}` : 'NO FILE LOADED'}
            title="Inspection view"
            action={
              <span className="font-mono text-[11px] text-[#7E8FA1]">
                SELECTED: L{lineStart} - L{lineEnd} ({Math.abs(lineEnd - lineStart) + 1} lines)
              </span>
            }
          >
            <div className="max-h-[600px] overflow-y-auto font-mono text-xs leading-relaxed border border-[#22303F] bg-[#0C1220] select-text">
              {loadingFile ? (
                <div className="p-8 text-center text-[#7E8FA1]" role="status">
                  Reading stratum...
                </div>
              ) : fileContent?.content ? (
                <table className="w-full border-collapse">
                  <caption className="sr-only">
                    Source file with line coordinates. Click a line to set the fault start, hold
                    shift to extend the span.
                  </caption>
                  <tbody>
                    {fileContent.content.split('\n').map((line, idx) => {
                      const lineNum = idx + 1;
                      const isSelected =
                        lineNum >= Math.min(lineStart, lineEnd) &&
                        lineNum <= Math.max(lineStart, lineEnd);
                      return (
                        <tr
                          key={lineNum}
                          onClick={(e) => handleLineClick(lineNum, e.shiftKey)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#C44D3F]/20 text-[#E2E8EE]'
                              : 'hover:bg-[#131C2B] text-[#C6D2DC]'
                          }`}
                        >
                          <td
                            className={`w-14 px-3 py-0.5 text-right text-[11px] select-none border-r border-[#22303F] bg-[#090E16] ${
                              isSelected ? 'text-[#E0836F] font-bold' : 'text-[#7E8FA1]'
                            }`}
                          >
                            {lineNum}
                          </td>
                          <td className="px-4 py-0.5 whitespace-pre font-mono text-xs">
                            {line || ' '}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-[#7E8FA1]">
                  Select a terrain layer to inspect its strata. Click a line to set the fault
                  start; shift-click to extend the span.
                </div>
              )}
            </div>
          </TopoPanel>
        </div>

        {/* Quadrant 3: Fault Filing Docket */}
        <div className="lg:col-span-4 space-y-4">
          <TopoPanel
            sector="Q3 // FILING DOCKET"
            coords="REF: FAULT-REPORT"
            title="File the fracture"
          >
            <div className="flex border-b border-[#22303F] pb-2 gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('report')}
                aria-pressed={activeTab === 'report'}
                className={`px-3 py-1.5 uppercase font-bold text-xs border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                  activeTab === 'report'
                    ? 'border-[#C44D3F] bg-[#C44D3F]/10 text-[#E2E8EE]'
                    : 'border-transparent text-[#7E8FA1] hover:text-[#E2E8EE]'
                }`}
              >
                Fault report
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('flag')}
                aria-pressed={activeTab === 'flag'}
                className={`px-3 py-1.5 uppercase font-bold text-xs border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                  activeTab === 'flag'
                    ? 'border-[#3F7A68] bg-[#3F7A68]/10 text-[#E2E8EE]'
                    : 'border-transparent text-[#7E8FA1] hover:text-[#E2E8EE]'
                }`}
              >
                Flag (bonus)
              </button>
            </div>

            {submitError ? <ErrorBanner error={submitError} className="mt-3" /> : null}

            {receipt && (
              <div className="mt-3 border border-[#3F7A68] bg-[#3F7A68]/10 p-3 space-y-1.5 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#63A98D] uppercase tracking-[0.12em]">
                    FILING SEALED
                  </span>
                  {receipt.replay && (
                    <span className="text-[10px] text-[#E2A56B] font-bold uppercase">
                      [REPLAY ACK]
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#E2E8EE]">
                  HMAC SEAL:{' '}
                  <code className="font-bold text-[#63A98D]">{receipt.receipt_code}</code>
                </div>
                <div className="text-[10px] text-[#7E8FA1]">
                  RECEIVED AT: {receipt.received_at}
                </div>
              </div>
            )}

            {activeTab === 'report' ? (
              <form onSubmit={handleSubmitReport} className="mt-3 space-y-3 font-mono text-xs">
                <div>
                  <span className="coordinate block mb-1">Fault coordinate</span>
                  <div className="px-3 py-1.5 bg-[#0C1220] border border-[#22303F] text-[#E2E8EE] font-bold truncate">
                    {selectedFile || 'None'} : L{lineStart} - L{lineEnd}
                  </div>
                </div>

                <div>
                  <label htmlFor="ws-category" className="coordinate block mb-1">
                    Taxonomy vector
                  </label>
                  <select
                    id="ws-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as BugCategory)}
                    className={inputCls}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="coordinate block mb-1">Claimed stress level</span>
                  <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Claimed severity">
                    {(['low', 'medium', 'high', 'critical'] as const).map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        role="radio"
                        aria-checked={severity === sev}
                        onClick={() => setSeverity(sev)}
                        className={`py-1 text-center uppercase text-[10px] font-bold border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                          severity === sev
                            ? 'border-[#C44D3F] bg-[#C44D3F] text-white'
                            : 'border-[#22303F] text-[#7E8FA1] hover:bg-[#1A273A]'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="ws-title" className="coordinate block mb-1">
                    Title (5..120 chars)
                  </label>
                  <input
                    id="ws-title"
                    type="text"
                    required
                    minLength={5}
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Unauthenticated note access in /notes/:id"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label htmlFor="ws-desc" className="coordinate block mb-1">
                    Root cause (min 20 chars)
                  </label>
                  <textarea
                    id="ws-desc"
                    required
                    rows={4}
                    minLength={20}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explain the structural flaw beneath the symptom..."
                    className={inputCls}
                  />
                </div>

                <div>
                  <label htmlFor="ws-impact" className="coordinate block mb-1">
                    Impact radius
                  </label>
                  <textarea
                    id="ws-impact"
                    rows={2}
                    maxLength={2000}
                    value={impact}
                    onChange={(e) => setImpact(e.target.value)}
                    placeholder="What shakes when this fault moves..."
                    className={inputCls}
                  />
                </div>

                <div>
                  <label htmlFor="ws-evidence" className="coordinate block mb-1">
                    Reproduction proof
                  </label>
                  <textarea
                    id="ws-evidence"
                    rows={2}
                    maxLength={2000}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="HTTP request or proof curl command..."
                    className={inputCls}
                  />
                </div>

                <div>
                  <label htmlFor="ws-fix" className="coordinate block mb-1">
                    Proposed anchor (fix)
                  </label>
                  <textarea
                    id="ws-fix"
                    rows={2}
                    maxLength={500}
                    value={suggestedFix}
                    onChange={(e) => setSuggestedFix(e.target.value)}
                    placeholder="Recommended stabilization..."
                    className={inputCls}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || cooldownRemaining !== null}
                  className="w-full py-2.5 bg-[#C44D3F] text-white font-bold uppercase tracking-[0.14em] hover:bg-[#A83E32] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
                >
                  {submitting
                    ? 'Sealing filing...'
                    : cooldownRemaining !== null
                    ? `Cooldown (${cooldownRemaining}s)`
                    : 'File the finding'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmitFlag} className="mt-3 space-y-4 font-mono text-xs">
                <p className="text-xs text-[#7E8FA1] font-sans leading-relaxed">
                  Recovered a bonus flag from a deep crevice? Enter the exact code below. Verified
                  flags add capped bonus points to the ledger.
                </p>

                <div>
                  <label htmlFor="ws-flag" className="coordinate block mb-1">
                    Flag code (4..200 chars)
                  </label>
                  <input
                    id="ws-flag"
                    type="text"
                    required
                    minLength={4}
                    maxLength={200}
                    value={flagCode}
                    onChange={(e) => setFlagCode(e.target.value)}
                    placeholder="bhctf{...}"
                    className="w-full bg-[#0C1220] border border-[#22303F] px-2.5 py-2 text-xs text-[#E2E8EE] focus:border-[#3F7A68] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !flagCode.trim()}
                  className="w-full py-2.5 bg-[#3F7A68] text-white font-bold uppercase tracking-[0.14em] hover:bg-[#356B5C] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  {submitting ? 'Verifying flag...' : 'Submit the flag'}
                </button>
              </form>
            )}
          </TopoPanel>
        </div>
      </div>
    </div>
  );
};
