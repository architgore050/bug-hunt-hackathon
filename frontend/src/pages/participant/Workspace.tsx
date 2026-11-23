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
  { value: 'authentication', label: '01 // Authentication & Session Handshake' },
  { value: 'authorization', label: '02 // Authorization & Boundary Control (IDOR)' },
  { value: 'injection', label: '03 // Injection (SQL, Command, Traversal)' },
  { value: 'data_handling', label: '04 // Data Handling & Input Sanitation' },
  { value: 'business_logic', label: '05 // Business Logic & State Desynchronization' },
  { value: 'cryptography', label: '06 // Cryptographic & Key Weakness' },
  { value: 'error_handling', label: '07 // Error Handling & Stack Disclosure' },
  { value: 'api_design', label: '08 // API Verb & Routing Anomalies' },
  { value: 'rate_limiting', label: '09 // Rate Limiting & Bucket Depletion' },
  { value: 'concurrency', label: '10 // Concurrency & Race Conditions' },
  { value: 'configuration', label: '11 // Insecure Defaults & Deployment Flags' },
  { value: 'integrity', label: '12 // Unsigned Payloads & State Integrity' },
];

export const Workspace: React.FC = () => {
  const { rulesAccepted } = useAuth();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [loadingAssignment, setLoadingAssignment] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [assignmentError, setAssignmentError] = useState<unknown>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ path: string; line_number: number; text: string }>>([]);
  const [searching, setSearching] = useState(false);

  const [activeTab, setActiveTab] = useState<'report' | 'flag'>('report');

  const [lineStart, setLineStart] = useState<number>(1);
  const [lineEnd, setLineEnd] = useState<number>(1);
  const [category, setCategory] = useState<BugCategory>('authorization');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState('');
  const [evidence, setEvidence] = useState('');
  const [suggestedFix, setSuggestedFix] = useState('');

  const [flagCode, setFlagCode] = useState('');

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
      // ignore
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
      // ignore
    } finally {
      setSearching(false);
    }
  };

  // Draft autosave every 3s
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
      setSubmitError(new Error('Selected line span exceeds the maximum allowed 25 lines limit.'));
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Workspace Channel Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#2D333D]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CHANNEL CH-02 // WORKSTATION BENCH
            </span>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-[#EAECE8] mt-1">
            Diagnostic Code Analyzer & Transceiver
          </h1>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="instr-bezel px-3 py-1 flex items-center gap-1.5">
            <span className="text-[#7F8896]">AUTOSAVE:</span>
            <span
              className={
                draftStatus === 'saved'
                  ? 'text-[#437A55] font-bold'
                  : draftStatus === 'saving'
                  ? 'text-[#E5A83B] font-bold'
                  : draftStatus === 'conflict'
                  ? 'text-[#BD3A3A] font-bold'
                  : 'text-[#7F8896]'
              }
            >
              {draftStatus.toUpperCase()}
            </span>
          </div>
          {cooldownRemaining !== null && (
            <div className="px-3 py-1 bg-[#BD3A3A]/10 border border-[#BD3A3A] text-[#BD3A3A] font-bold">
              COOLDOWN: {cooldownRemaining}s
            </div>
          )}
        </div>
      </div>

      {assignmentError ? <ErrorBanner error={assignmentError} onRetry={loadAssignments} /> : null}

      {!rulesAccepted && (
        <div className="border border-[#BD3A3A] bg-[#BD3A3A]/10 p-3.5 text-xs font-mono text-[#EAECE8] flex items-center justify-between">
          <span>Target firmware binaries are locked pending Operating Charter ratification.</span>
          <a href="/app" className="underline font-bold text-[#E5A83B]">
            Ratify in Lobby &rarr;
          </a>
        </div>
      )}

      {/* 3-Bay Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Bay 1: Module Directory (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="instr-rack border border-[#2D333D] bg-[#181B20] p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#2D333D] pb-2">
              <span className="font-bold text-[#EAECE8] uppercase text-[11px]">
                Target Modules
              </span>
              <span className="text-[10px] text-[#7F8896]">
                {assignment?.files?.length || 0} FILES
              </span>
            </div>

            {/* Line Search Input */}
            <form onSubmit={handleSearch} className="flex gap-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol / line..."
                className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
              />
              <button
                type="submit"
                disabled={searching}
                className="px-2.5 py-1 bg-[#20242B] border border-[#3D4654] text-[#EAECE8] hover:bg-[#2A2F38] uppercase text-[10px] font-bold"
              >
                {searching ? '...' : 'Scan'}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="instr-bezel p-2 max-h-36 overflow-y-auto space-y-1 text-[11px]">
                <div className="text-[10px] uppercase text-[#E5A83B] font-bold">
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
                    className="w-full text-left truncate block text-[#7F8896] hover:text-[#EAECE8]"
                  >
                    <span className="text-[#E5A83B]">L{hit.line_number}:</span> {hit.text}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1 pt-2 max-h-[500px] overflow-y-auto">
              {loadingAssignment ? (
                <div className="text-[#7F8896] py-4 text-center">Loading modules...</div>
              ) : assignment?.files?.map((file) => {
                const isSelected = selectedFile === file.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      if (assignment) loadFile(assignment.challenge_id, file.path);
                    }}
                    className={`w-full text-left px-2 py-1.5 flex items-center justify-between border ${
                      isSelected
                        ? 'border-[#E5A83B] bg-[#E5A83B]/10 text-[#E5A83B] font-bold'
                        : 'border-transparent text-[#7F8896] hover:text-[#EAECE8] hover:bg-[#20242B]'
                    }`}
                  >
                    <span className="truncate">{file.path}</span>
                    <span className="text-[10px] text-[#555C68]">{file.line_count}L</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bay 2: Signal Code Viewer (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="instr-rack border border-[#2D333D] bg-[#101216] overflow-hidden">
            <div className="bg-[#181B20] border-b border-[#2D333D] px-3.5 py-2 flex items-center justify-between font-mono text-xs">
              <span className="font-bold text-[#EAECE8] truncate">{selectedFile || 'Standby'}</span>
              <span className="text-[10px] text-[#E5A83B] font-bold">
                RANGE: L{lineStart}..L{lineEnd} ({Math.abs(lineEnd - lineStart) + 1}L)
              </span>
            </div>

            <div className="p-0 max-h-[600px] overflow-y-auto font-mono text-xs leading-relaxed select-text">
              {loadingFile ? (
                <div className="p-8 text-center text-[#7F8896]">Analyzing byte stream...</div>
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
                              ? 'bg-[#E5A83B]/20 text-[#EAECE8] font-bold'
                              : 'hover:bg-[#181B20] text-[#B4B9C4]'
                          }`}
                        >
                          <td className="w-10 px-2 py-0.5 text-right text-[10px] text-[#555C68] select-none border-r border-[#2D333D]/60 bg-[#0E1013]">
                            {lineNum}
                          </td>
                          <td className="px-3 py-0.5 whitespace-pre font-mono text-xs">
                            {line || ' '}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-[#7F8896]">
                  Select module from left panel to begin signal inspection.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bay 3: Telemetry Transceiver Filing (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="instr-rack border border-[#2D333D] bg-[#181B20] p-4 space-y-3.5 font-mono text-xs">
            <div className="flex border-b border-[#2D333D] pb-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('report')}
                className={`px-3 py-1 uppercase font-bold text-xs border ${
                  activeTab === 'report'
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013]'
                    : 'border-transparent text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                Telemetry Filing
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('flag')}
                className={`px-3 py-1 uppercase font-bold text-xs border ${
                  activeTab === 'flag'
                    ? 'border-[#437A55] bg-[#437A55] text-white'
                    : 'border-transparent text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                Capture Flag
              </button>
            </div>

            {submitError ? <ErrorBanner error={submitError} /> : null}

            {receipt && (
              <div className="instr-bezel p-3 border border-[#437A55] bg-[#437A55]/10 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#437A55]">TRANSMISSION ACKNOWLEDGED</span>
                  {receipt.replay && (
                    <span className="text-[10px] text-[#E5A83B] font-bold">[REPLAY]</span>
                  )}
                </div>
                <div className="text-[11px] text-[#EAECE8]">
                  RECEIPT: <code className="font-bold text-[#437A55]">{receipt.receipt_code}</code>
                </div>
              </div>
            )}

            {activeTab === 'report' ? (
              <form onSubmit={handleSubmitReport} className="space-y-3 font-mono text-xs">
                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Channel Vector
                  </label>
                  <div className="px-2.5 py-1 bg-[#101216] border border-[#2D333D] text-[#EAECE8] font-bold truncate">
                    {selectedFile || 'Standby'} : L{lineStart}..L{lineEnd}
                  </div>
                </div>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Taxonomy Selector
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as BugCategory)}
                    className="w-full bg-[#101216] border border-[#2D333D] px-2 py-1.5 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Severity Potentiometer
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['low', 'medium', 'high', 'critical'] as const).map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setSeverity(sev)}
                        className={`py-1 text-center uppercase text-[10px] font-bold border ${
                          severity === sev
                            ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013]'
                            : 'border-[#2D333D] text-[#7F8896] hover:bg-[#20242B]'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Diagnosis Heading
                  </label>
                  <input
                    type="text"
                    required
                    minLength={5}
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Short finding title"
                    className="w-full bg-[#101216] border border-[#2D333D] px-2 py-1 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Root Cause Diagnosis (&gt;=20 chars)
                  </label>
                  <textarea
                    required
                    rows={4}
                    minLength={20}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Detailed technical diagnosis..."
                    className="w-full bg-[#101216] border border-[#2D333D] p-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Reproduction Proof
                  </label>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="Proof payload or curl command..."
                    className="w-full bg-[#101216] border border-[#2D333D] p-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
                    Surgical Remediation
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={suggestedFix}
                    onChange={(e) => setSuggestedFix(e.target.value)}
                    placeholder="Proposed patch..."
                    className="w-full bg-[#101216] border border-[#2D333D] p-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || cooldownRemaining !== null}
                  className="w-full py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] disabled:opacity-40 transition-colors"
                >
                  {submitting
                    ? 'Transmitting...'
                    : cooldownRemaining !== null
                    ? `Cooldown (${cooldownRemaining}s)`
                    : 'Dispatch Diagnosis'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmitFlag} className="space-y-4 font-mono text-xs">
                <p className="text-xs text-[#7F8896] font-sans">
                  Captured a CTF flag from hidden firmware registers? Submit the code below to credit bonus points.
                </p>

                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">
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
                    className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-2 text-xs text-[#EAECE8] focus:border-[#437A55] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !flagCode.trim()}
                  className="w-full py-2 bg-[#437A55] text-white font-bold uppercase tracking-wider hover:bg-[#366345] disabled:opacity-40 transition-colors"
                >
                  {submitting ? 'Authenticating Flag...' : 'Commit Flag Code'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
