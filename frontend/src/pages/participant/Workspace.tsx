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

export const Workspace: React.FC = () => {
  const { rulesAccepted } = useAuth();

  // Assignment & File State
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [loadingAssignment, setLoadingAssignment] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [assignmentError, setAssignmentError] = useState<unknown>(null);

  // Search in challenge files
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ path: string; line_number: number; text: string }>>([]);
  const [searching, setSearching] = useState(false);

  // Workspace Tab: 'report' vs 'flag'
  const [activeTab, setActiveTab] = useState<'report' | 'flag'>('report');

  // Report Form State
  const [lineStart, setLineStart] = useState<number>(1);
  const [lineEnd, setLineEnd] = useState<number>(1);
  const [category, setCategory] = useState<BugCategory>('authorization');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState('');
  const [evidence, setEvidence] = useState('');
  const [suggestedFix, setSuggestedFix] = useState('');

  // Flag Form State
  const [flagCode, setFlagCode] = useState('');

  // Submission & Draft Status
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'dirty' | 'conflict'>('saved');
  const [draftVersion, setDraftVersion] = useState<number>(1);
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load Assignments
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
    } catch (err) {
      // file load error
    } finally {
      setLoadingFile(false);
    }
  };

  useEffect(() => {
    loadAssignments();
  }, []);

  // Search handler
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignment || searchQuery.trim().length < 2) return;
    try {
      setSearching(true);
      const res = await api.searchChallenge(assignment.challenge_id, searchQuery.trim());
      setSearchResults(res);
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  // Draft autosave logic (every 3s when dirty)
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
  }, [selectedFile, lineStart, lineEnd, category, severity, title, description, impact, evidence, suggestedFix]);

  // Code selection handlers
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

  // Submit Report
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
      // Reset form on success
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

  // Submit CTF Flag
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2B2E35]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36] animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              INVESTIGATION WORKBENCH // SECTOR WS-01
            </span>
          </div>
          <h1 className="text-2xl font-serif font-black text-[#ECEEF2]">
            Evidence Repository & Filing Desk
          </h1>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 border border-[#2B2E35] bg-[#141519]">
            <span className="text-[#868A94]">AUTOSAVE:</span>
            <span
              className={
                draftStatus === 'saved'
                  ? 'text-[#5EA57E] font-bold'
                  : draftStatus === 'saving'
                  ? 'text-[#CF8B38] font-bold'
                  : draftStatus === 'conflict'
                  ? 'text-[#E2715A] font-bold'
                  : 'text-[#868A94]'
              }
            >
              {draftStatus.toUpperCase()}
            </span>
          </div>
          {cooldownRemaining !== null && (
            <div className="px-3 py-1 border border-[#C04A36] bg-[#C04A36]/10 text-[#E2715A] font-bold">
              COOLDOWN: {cooldownRemaining}s
            </div>
          )}
        </div>
      </div>

      {assignmentError ? <ErrorBanner error={assignmentError} onRetry={loadAssignments} /> : null}

      {!rulesAccepted && (
        <div className="border border-[#C04A36] bg-[#C04A36]/10 p-4 text-xs font-mono text-[#ECEEF2] flex items-center justify-between">
          <span>You must accept official competition rules before challenge files become accessible.</span>
          <a href="/app" className="underline font-bold text-[#E2715A]">
            Go to Lobby & Ratify Rules &rarr;
          </a>
        </div>
      )}

      {/* Three Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: File Tree & Regex Search (Width: 3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="border border-[#2B2E35] bg-[#181A1F] p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#2B2E35] pb-2">
              <span className="font-bold text-[#ECEEF2] uppercase tracking-wider">
                Target Files
              </span>
              <span className="text-[11px] text-[#868A94]">
                {assignment?.files?.length || 0} ITEMS
              </span>
            </div>

            {/* Search Box */}
            <form onSubmit={handleSearch} className="space-y-1.5">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Regex / line search..."
                  className="w-full bg-[#111215] border border-[#2B2E35] px-2.5 py-1.5 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="px-2.5 py-1.5 bg-[#2B2E35] text-[#ECEEF2] hover:bg-[#3C404A]"
                >
                  {searching ? '...' : 'Go'}
                </button>
              </div>
            </form>

            {/* Search Hit List */}
            {searchResults.length > 0 && (
              <div className="border border-[#2B2E35] bg-[#111215] p-2 max-h-40 overflow-y-auto space-y-1.5 text-[11px]">
                <div className="text-[10px] uppercase text-[#CF8B38] font-bold">
                  Matches ({searchResults.length}):
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
                    className="w-full text-left truncate block text-[#868A94] hover:text-[#ECEEF2]"
                  >
                    <span className="text-[#CF8B38]">L{hit.line_number}:</span> {hit.text}
                  </button>
                ))}
              </div>
            )}

            {/* File List */}
            <div className="space-y-1 pt-2 max-h-[500px] overflow-y-auto">
              {loadingAssignment ? (
                <div className="text-[#868A94] py-4 text-center">Loading tree...</div>
              ) : assignment?.files?.map((file) => {
                const isSelected = selectedFile === file.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      if (assignment) loadFile(assignment.challenge_id, file.path);
                    }}
                    className={`w-full text-left px-2.5 py-2 flex items-center justify-between border ${
                      isSelected
                        ? 'border-[#C04A36] bg-[#C04A36]/10 text-[#ECEEF2] font-bold'
                        : 'border-transparent text-[#868A94] hover:text-[#ECEEF2] hover:bg-[#20232A]'
                    }`}
                  >
                    <span className="truncate">{file.path}</span>
                    <span className="text-[10px] text-[#868A94]">{file.line_count}L</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Column 2: Code Viewer (Width: 5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="border border-[#2B2E35] bg-[#141519] overflow-hidden">
            <div className="border-b border-[#2B2E35] bg-[#181A1F] px-4 py-2.5 flex items-center justify-between font-mono text-xs">
              <span className="font-bold text-[#ECEEF2]">{selectedFile || 'No file loaded'}</span>
              <span className="text-[11px] text-[#868A94]">
                SELECTED: L{lineStart} - L{lineEnd} ({Math.abs(lineEnd - lineStart) + 1} lines)
              </span>
            </div>

            <div className="p-0 max-h-[600px] overflow-y-auto font-mono text-xs leading-relaxed select-text">
              {loadingFile ? (
                <div className="p-8 text-center text-[#868A94]">Reading file stream...</div>
              ) : fileContent?.content ? (
                <table className="w-full border-collapse">
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
                              ? 'bg-[#C04A36]/20 text-[#ECEEF2]'
                              : 'hover:bg-[#1E2026] text-[#C4C8D2]'
                          }`}
                        >
                          <td className="w-12 px-3 py-0.5 text-right text-[11px] text-[#868A94] select-none border-r border-[#2B2E35]/60 bg-[#111215]">
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
                <div className="p-8 text-center text-[#868A94]">
                  Select a challenge file from the left to inspect source code.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Column 3: Report & Flag Filing Desk (Width: 4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="border border-[#2B2E35] bg-[#181A1F] p-5 space-y-4 font-mono text-xs">
            {/* Tab switch: Bug Report vs CTF Flag */}
            <div className="flex border-b border-[#2B2E35] pb-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('report')}
                className={`px-3 py-1.5 uppercase font-bold text-xs border ${
                  activeTab === 'report'
                    ? 'border-[#C04A36] bg-[#C04A36]/10 text-[#ECEEF2]'
                    : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Vulnerability Report
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('flag')}
                className={`px-3 py-1.5 uppercase font-bold text-xs border ${
                  activeTab === 'flag'
                    ? 'border-[#3E7259] bg-[#3E7259]/10 text-[#ECEEF2]'
                    : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Submit Flag (Bonus)
              </button>
            </div>

            {submitError ? <ErrorBanner error={submitError} /> : null}

            {receipt && (
              <div className="border border-[#3E7259] bg-[#3E7259]/10 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#5EA57E]">SUBMISSION RECEIVED</span>
                  {receipt.replay && (
                    <span className="text-[10px] text-[#CF8B38] font-bold">[REPLAY ACK]</span>
                  )}
                </div>
                <div className="text-[11px] text-[#ECEEF2]">
                  RECEIPT: <code className="font-bold text-[#5EA57E]">{receipt.receipt_code}</code>
                </div>
              </div>
            )}

            {activeTab === 'report' ? (
              <form onSubmit={handleSubmitReport} className="space-y-3 font-mono text-xs">
                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Target Location
                  </label>
                  <div className="px-3 py-1.5 bg-[#111215] border border-[#2B2E35] text-[#ECEEF2] font-bold truncate">
                    {selectedFile || 'None'} : L{lineStart} - L{lineEnd}
                  </div>
                </div>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Taxonomy Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as BugCategory)}
                    className="w-full bg-[#111215] border border-[#2B2E35] px-2.5 py-1.5 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Claimed Severity
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['low', 'medium', 'high', 'critical'] as const).map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setSeverity(sev)}
                        className={`py-1 text-center uppercase text-[10px] font-bold border ${
                          severity === sev
                            ? 'border-[#C04A36] bg-[#C04A36] text-white'
                            : 'border-[#2B2E35] text-[#868A94] hover:bg-[#20232A]'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Title (5..120 chars)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={5}
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Unauthenticated access in notes route"
                    className="w-full bg-[#111215] border border-[#2B2E35] px-2.5 py-1.5 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Root Cause Description (&gt;=20 chars)
                  </label>
                  <textarea
                    required
                    rows={4}
                    minLength={20}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explain the underlying architectural or logical flaw in detail..."
                    className="w-full bg-[#111215] border border-[#2B2E35] p-2 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Exploit Proof / Evidence
                  </label>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="HTTP request or proof curl command..."
                    className="w-full bg-[#111215] border border-[#2B2E35] p-2 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Suggested Remediation
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={suggestedFix}
                    onChange={(e) => setSuggestedFix(e.target.value)}
                    placeholder="Recommended fix or patch..."
                    className="w-full bg-[#111215] border border-[#2B2E35] p-2 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || cooldownRemaining !== null}
                  className="w-full py-2.5 bg-[#C04A36] text-white font-bold uppercase tracking-wider hover:bg-[#A83827] disabled:opacity-40 transition-colors"
                >
                  {submitting
                    ? 'Transmitting Finding...'
                    : cooldownRemaining !== null
                    ? `Wait Cooldown (${cooldownRemaining}s)`
                    : 'File Formal Finding'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmitFlag} className="space-y-4 font-mono text-xs">
                <p className="text-xs text-[#868A94] font-sans">
                  Captured a CTF bonus flag? Enter the exact flag code below. Verified flags contribute to the capped CTF bonus points.
                </p>

                <div>
                  <label className="block text-[#868A94] uppercase tracking-wider mb-1">
                    Flag Code (4..200 chars)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={4}
                    maxLength={200}
                    value={flagCode}
                    onChange={(e) => setFlagCode(e.target.value)}
                    placeholder="bhctf{...}"
                    className="w-full bg-[#111215] border border-[#2B2E35] px-2.5 py-2 text-xs text-[#ECEEF2] focus:border-[#3E7259] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !flagCode.trim()}
                  className="w-full py-2.5 bg-[#3E7259] text-[#ECEEF2] font-bold uppercase tracking-wider hover:bg-[#34614A] disabled:opacity-40 transition-colors"
                >
                  {submitting ? 'Verifying Flag...' : 'Submit CTF Flag'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
