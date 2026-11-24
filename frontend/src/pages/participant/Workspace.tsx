import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError, newIdempotencyKey } from '../../lib/api'
import type {
  Assignment,
  DraftState,
  FileContent,
  Receipt,
  SearchHit,
  StateResponse,
  SubmissionRow,
  Severity,
} from '../../lib/types'
import { CATEGORIES, SEVERITIES } from '../../lib/types'
import { clockOffset, fmtBytes, fmtDateTime } from '../../lib/format'
import {
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingShell,
  Panel,
  StatusChip,
  useNowTick,
} from '../../ui/components'
import { FileIcon, FlagIcon, FolderIcon, MagnifierIcon, SubmitArrowIcon } from '../../ui/icons'

/* ---------------- report form model ---------------- */

interface ReportForm {
  file_path: string
  line_start: string
  line_end: string
  category: string
  claimed_severity: string
  title: string
  description: string
  impact: string
  evidence: string
  suggested_fix: string
}

const EMPTY_REPORT: ReportForm = {
  file_path: '',
  line_start: '',
  line_end: '',
  category: '',
  claimed_severity: '',
  title: '',
  description: '',
  impact: '',
  evidence: '',
  suggested_fix: '',
}

/* ---------------- file tree ---------------- */

function buildTree(paths: string[]): { dirs: Map<string, string[]>; roots: string[] } {
  const dirs = new Map<string, string[]>()
  const roots: string[] = []
  for (const p of paths) {
    const idx = p.lastIndexOf('/')
    if (idx === -1) {
      roots.push(p)
    } else {
      const dir = p.slice(0, idx)
      if (!dirs.has(dir)) dirs.set(dir, [])
      dirs.get(dir)!.push(p)
    }
  }
  return { dirs, roots }
}

/* ---------------- main component ---------------- */

export default function Workspace() {
  const queryClient = useQueryClient()
  const nowMs = useNowTick()

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(14)
  const [find, setFind] = useState('')
  const [cursorLine, setCursorLine] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [tab, setTab] = useState<'report' | 'flag' | 'submissions'>('report')
  const [form, setForm] = useState<ReportForm>(EMPTY_REPORT)
  const [flagCode, setFlagCode] = useState('')
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<ApiRequestError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null)

  const dragging = useRef(false)
  const dragAnchor = useRef<number | null>(null)
  const dirty = useRef(false)
  const draftVersion = useRef(0)
  const idemKey = useRef<string>('')
  const formRef = useRef<ReportForm>(form)
  const hydrating = useRef(false)

  formRef.current = form

  const assignmentsQ = useQuery({
    queryKey: ['assignments'],
    queryFn: () => api<{ assignments: Assignment[] }>('/v1/assignments'),
    refetchInterval: 15_000,
  })
  const stateQ = useQuery({
    queryKey: ['state'],
    queryFn: () => api<StateResponse>('/v1/state'),
    refetchInterval: 5_000,
  })

  const assignment: Assignment | null = assignmentsQ.data?.assignments[0] ?? null
  const challengeId = assignment?.challenge_id ?? null
  const round = stateQ.data?.round ?? null
  const stageActive = round?.status === 'active'

  /* file content */
  const contentQ = useQuery({
    queryKey: ['file', challengeId, selectedPath],
    queryFn: () => api<FileContent>(`/v1/challenges/${challengeId}/files/content?path=${encodeURIComponent(selectedPath ?? '')}`),
    enabled: !!challengeId && !!selectedPath,
    staleTime: 30_000,
  })

  const codeLines = useMemo(() => (contentQ.data ? contentQ.data.content.replaceAll('\r\n', '\n').split('\n') : []), [contentQ.data])

  const findLower = find.trim().toLowerCase()
  const matchCount = useMemo(() => {
    if (!findLower) return 0
    return codeLines.filter((l) => l.toLowerCase().includes(findLower)).length
  }, [codeLines, findLower])

  /* default file selection */
  useEffect(() => {
    if (!selectedPath && assignment && assignment.files.length > 0) {
      setSelectedPath(assignment.files[0].path)
    }
  }, [assignment, selectedPath])

  /* restore draft on challenge load */
  useEffect(() => {
    if (!challengeId) return
    let cancelled = false
    async function loadDraft() {
      try {
        const d = await api<DraftState>(`/v1/drafts/${challengeId}`)
        if (cancelled) return
        draftVersion.current = d.version
        const p = d.payload as (Partial<ReportForm> & { selected_path?: string })
        if (p && Object.keys(p).length > 0) {
          hydrating.current = true
          setForm((f) => ({
            ...f,
            file_path: typeof p.file_path === 'string' ? p.file_path : f.file_path,
            line_start: p.line_start !== undefined && p.line_start !== null ? String(p.line_start) : f.line_start,
            line_end: p.line_end !== undefined && p.line_end !== null ? String(p.line_end) : f.line_end,
            category: typeof p.category === 'string' ? p.category : f.category,
            claimed_severity: typeof p.claimed_severity === 'string' ? p.claimed_severity : f.claimed_severity,
            title: typeof p.title === 'string' ? p.title : f.title,
            description: typeof p.description === 'string' ? p.description : f.description,
            impact: typeof p.impact === 'string' ? p.impact : f.impact,
            evidence: typeof p.evidence === 'string' ? p.evidence : f.evidence,
            suggested_fix: typeof p.suggested_fix === 'string' ? p.suggested_fix : f.suggested_fix,
          }))
          if (typeof p.selected_path === 'string') setSelectedPath(p.selected_path)
          setDraftSavedAt(d.updated_at)
          hydrating.current = false
        }
      } catch {
        // A missing draft is fine; a failing draft endpoint must not block the workspace.
      }
    }
    void loadDraft()
    return () => {
      cancelled = true
    }
  }, [challengeId])

  /* autosave every 3s when dirty */
  useEffect(() => {
    if (!challengeId) return
    const id = window.setInterval(async () => {
      if (!dirty.current || hydrating.current) return
      const f = formRef.current
      const payload: Record<string, unknown> = {
        ...f,
        line_start: f.line_start === '' ? null : Number(f.line_start),
        line_end: f.line_end === '' ? null : Number(f.line_end),
        selected_path: selectedPath,
      }
      try {
        const res = await api<{ version: number }>(`/v1/drafts/${challengeId}`, {
          method: 'PUT',
          body: { payload, version: draftVersion.current },
        })
        draftVersion.current = res.version
        dirty.current = false
        setDraftSavedAt(new Date().toISOString())
        setDraftNotice(null)
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'DRAFT_VERSION_CONFLICT') {
          try {
            const d = await api<DraftState>(`/v1/drafts/${challengeId}`)
            draftVersion.current = d.version
            const p = d.payload as (Partial<ReportForm> & { selected_path?: string })
            hydrating.current = true
            setForm((f2) => ({
              ...f2,
              file_path: typeof p.file_path === 'string' ? p.file_path : f2.file_path,
              line_start: p.line_start !== undefined && p.line_start !== null ? String(p.line_start) : f2.line_start,
              line_end: p.line_end !== undefined && p.line_end !== null ? String(p.line_end) : f2.line_end,
              category: typeof p.category === 'string' ? p.category : f2.category,
              claimed_severity: typeof p.claimed_severity === 'string' ? p.claimed_severity : f2.claimed_severity,
              title: typeof p.title === 'string' ? p.title : f2.title,
              description: typeof p.description === 'string' ? p.description : f2.description,
              impact: typeof p.impact === 'string' ? p.impact : f2.impact,
              evidence: typeof p.evidence === 'string' ? p.evidence : f2.evidence,
              suggested_fix: typeof p.suggested_fix === 'string' ? p.suggested_fix : f2.suggested_fix,
            }))
            hydrating.current = false
            dirty.current = false
            setDraftNotice('This draft changed in another tab. The latest saved version is now loaded; re-apply your newest edits.')
          } catch {
            // keep local state; the next interval will try again
          }
        }
        // Other failures (round ended, network) are retried on the next tick.
      }
    }, 3000)
    return () => window.clearInterval(id)
  }, [challengeId, selectedPath])

  function updateForm(patch: Partial<ReportForm>) {
    if (hydrating.current) return
    dirty.current = true
    setForm((f) => ({ ...f, ...patch }))
  }

  function selectLines(start: number, end: number) {
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    setSelection({ start: lo, end: hi })
    setCursorLine(hi)
    if (selectedPath) {
      dirty.current = true
      setForm((f) => ({ ...f, file_path: selectedPath, line_start: String(lo), line_end: String(hi) }))
    }
  }

  const onLineMouseDown = useCallback(
    (n: number, shift: boolean) => {
      if (shift) {
        const base = selection?.start ?? cursorLine ?? n
        selectLines(base, n)
        return
      }
      dragAnchor.current = n
      dragging.current = false
      selectLines(n, n)
    },
    [selection, cursorLine, selectedPath],
  )

  const onLineMouseMove = useCallback(
    (n: number) => {
      if (dragAnchor.current === null) return
      dragging.current = true
      selectLines(dragAnchor.current, n)
    },
    [selectedPath],
  )

  const onViewerMouseUp = useCallback(() => {
    dragAnchor.current = null
    dragging.current = false
  }, [])

  function onViewerKeyDown(e: React.KeyboardEvent) {
    const max = codeLines.length
    if (max === 0) return
    const cur = cursorLine ?? 1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursorLine(Math.min(max, cur + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursorLine(Math.max(1, cur - 1))
    } else if (e.key === 'Home' && !e.ctrlKey) {
      e.preventDefault()
      setCursorLine(1)
    } else if (e.key === 'End' && !e.ctrlKey) {
      e.preventDefault()
      setCursorLine(max)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        const base = selection?.start ?? cur
        selectLines(base, cur)
      } else {
        selectLines(cur, cur)
      }
    }
  }

  function jumpToMatch() {
    if (!findLower) return
    const n = codeLines.findIndex((l) => l.toLowerCase().includes(findLower))
    if (n === -1) return
    const target = document.getElementById(`code-L${n + 1}`)
    target?.scrollIntoView({ block: 'center' })
    setCursorLine(n + 1)
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault()
    if (!challengeId || searchTerm.trim().length < 2) return
    try {
      const res = await api<{ results: SearchHit[] }>(
        `/v1/challenges/${challengeId}/search?q=${encodeURIComponent(searchTerm.trim())}`,
      )
      setSearchHits(res.results)
    } catch {
      setSearchHits([])
    }
  }

  function openHit(hit: SearchHit) {
    setSelectedPath(hit.path)
    setCursorLine(hit.line_number)
    window.setTimeout(() => {
      document.getElementById(`code-L${hit.line_number}`)?.scrollIntoView({ block: 'center' })
    }, 250)
  }

  /* ---------------- submit ---------------- */

  function validateReport(): boolean {
    const errs: Record<string, string> = {}
    if (!form.file_path) errs.file_path = 'Pick the target file from the explorer or type its path.'
    const ls = Number(form.line_start)
    const le = Number(form.line_end)
    if (!form.line_start || !form.line_end || Number.isNaN(ls) || Number.isNaN(le) || ls < 1 || le < ls) {
      errs.line_start = 'Set a valid line range: click a line, or type both numbers.'
    } else if (le - ls + 1 > 25) {
      errs.line_start = 'Span exceeds 25 lines. Narrow the range to the defect.'
    }
    if (!form.category) errs.category = 'Pick a category from the taxonomy.'
    if (form.title.trim().length < 5 || form.title.trim().length > 120) {
      errs.title = 'Required: 5 to 120 characters.'
    }
    if (form.description.trim().length < 20) {
      errs.description = 'Required: at least 20 characters explaining the root cause.'
    }
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  function applyServerValidation(details: Record<string, unknown>) {
    const errs: Record<string, string> = {}
    for (const [k, v] of Object.entries(details)) {
      errs[k] = String(v)
    }
    setFormErrors(errs)
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (!validateReport()) return
    if (!idemKey.current) idemKey.current = newIdempotencyKey()
    setSubmitting(true)
    try {
      const res = await api<Receipt>('/v1/submissions', {
        method: 'POST',
        idempotencyKey: idemKey.current,
        body: {
          kind: 'bug_report',
          file_path: form.file_path,
          line_start: Number(form.line_start),
          line_end: Number(form.line_end),
          category: form.category,
          claimed_severity: form.claimed_severity || undefined,
          title: form.title.trim(),
          description: form.description.trim(),
          impact: form.impact.trim() || undefined,
          evidence: form.evidence.trim() || undefined,
          suggested_fix: form.suggested_fix.trim() || undefined,
        },
      })
      setReceipt(res)
      idemKey.current = ''
      setForm((f) => ({ ...EMPTY_REPORT, file_path: f.file_path, category: f.category, claimed_severity: f.claimed_severity }))
      setSelection(null)
      dirty.current = true
      void queryClient.invalidateQueries({ queryKey: ['submissions'] })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'VALIDATION_ERROR' || err.code === 'SUBMISSION_INVALID') applyServerValidation(err.details)
        if (err.code === 'SUBMISSION_COOLDOWN' && typeof err.details.n === 'number') {
          err.serverMessage = `Per-file cooldown: wait ${err.details.n}s before the next report on this file.`
        }
        if (err.code === 'SUBMISSION_CAP_REACHED') {
          err.serverMessage = err.details.round
            ? `Round cap reached (${err.details.limit} reports this round for you).`
            : `Report cap reached for ${String(err.details.file ?? 'this file')} (limit ${String(err.details.limit ?? '')}).`
        }
        setSubmitError(err)
        idemKey.current = ''
      } else {
        setSubmitError(new ApiRequestError({ code: 'UNKNOWN', serverMessage: 'Submission failed unexpectedly.' }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function submitFlag(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setFormErrors({})
    if (flagCode.trim().length < 4) {
      setFormErrors({ flag_code: 'Flag codes are at least 4 characters.' })
      return
    }
    if (!idemKey.current) idemKey.current = newIdempotencyKey()
    setSubmitting(true)
    try {
      const res = await api<Receipt>('/v1/submissions', {
        method: 'POST',
        idempotencyKey: idemKey.current,
        body: { kind: 'ctf_flag', flag_code: flagCode.trim() },
      })
      setReceipt(res)
      idemKey.current = ''
      setFlagCode('')
      void queryClient.invalidateQueries({ queryKey: ['submissions'] })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setSubmitError(err)
        idemKey.current = ''
      } else {
        setSubmitError(new ApiRequestError({ code: 'UNKNOWN', serverMessage: 'Flag submission failed unexpectedly.' }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------------- render ---------------- */

  const tree = useMemo(
    () => buildTree(assignment ? assignment.files.map((f) => f.path) : []),
    [assignment],
  )
  const offset = stateQ.data ? clockOffset(stateQ.data.server_time, stateQ.dataUpdatedAt) : 0

  return (
    <div className="stack">
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="exhibit-num">WORKSPACE</span>
          {assignment && <span className="mono small">{assignment.title} (v{assignment.version})</span>}
          <StatusChip value={round?.status ?? null} />
          {round?.paused && <Chip tone="warn">Timer stopped</Chip>}
        </div>
        {round && (round.status === 'active' || round.status === 'paused') && round.ends_at_effective && (
          <div className="countdown" style={{ fontSize: 20 }}>
            <span className={round.status === 'paused' ? '' : countdownCls(round.ends_at_effective, nowMs + offset)}>
              {countdownText(round.ends_at_effective, nowMs + offset)}
            </span>
          </div>
        )}
      </header>

      {assignmentsQ.isError && <ErrorBanner error={assignmentsQ.error} onRetry={() => void assignmentsQ.refetch()} />}
      {assignmentsQ.isLoading && <LoadingShell label="Loading assignment" />}

      {assignmentsQ.data && assignmentsQ.data.assignments.length === 0 && (
        <EmptyState
          title="No challenge assigned yet"
          note={
            round
              ? `Stage status is ${round.status}. Challenge materials are released when the stage is armed or active. This page refreshes automatically.`
              : 'No round is configured. Wait in the lobby for the organizers to publish the stage.'
          }
          action={<Link to="/app" className="btn btn-sm">Back to lobby</Link>}
        />
      )}

      {assignment && (
        <div className="workspace">
          {/* LEFT: explorer */}
          <Panel
            exhibit="EX-F"
            title="Evidence files"
            className="ws-files"
            bodyClassName="panel-body"
            ariaLabel="File explorer"
          >
            <div className="filetree" role="tree" aria-label="Challenge files">
              {tree.roots.length > 0 && (
                <div>
                  <div className="filetree-dir"><FolderIcon size={13} /> (root)</div>
                  {tree.roots.map((p) => (
                    <FileRow key={p} path={p} active={p === selectedPath} onSelect={setSelectedPath} />
                  ))}
                </div>
              )}
              {[...tree.dirs.entries()].map(([dir, files]) => (
                <div key={dir}>
                  <div className="filetree-dir"><FolderIcon size={13} /> {dir}/</div>
                  {files.map((p) => (
                    <FileRow key={p} path={p} short={p.slice(dir.length + 1)} active={p === selectedPath} onSelect={setSelectedPath} />
                  ))}
                </div>
              ))}
            </div>

            <hr className="hairline" style={{ margin: '12px 0' }} />
            <form onSubmit={runSearch} className="field" style={{ gap: 6 }}>
              <label className="field-label" htmlFor="ws-search">Search all files</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  id="ws-search"
                  className="input mono-input"
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="min 2 characters"
                  style={{ minWidth: 0 }}
                />
                <Button size="sm" type="submit" disabled={searchTerm.trim().length < 2} ariaLabel="Run server-side search">
                  <MagnifierIcon size={13} />
                </Button>
              </div>
            </form>
            {searchHits && (
              <div style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}>
                {searchHits.length === 0 && <p className="muted small">No matches in the indexed files.</p>}
                {searchHits.map((h, i) => (
                  <button key={`${h.path}:${h.line_number}:${i}`} className="filetree-row" onClick={() => openHit(h)}>
                    <span className="muted small mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.path}:{h.line_number}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {/* CENTER: code viewer */}
          <Panel
            exhibit="EX-C"
            title={selectedPath ?? 'Code'}
            actions={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button size="sm" onClick={() => setFontSize((s) => Math.max(12, s - 1))} ariaLabel="Decrease font size">
                  A-
                </Button>
                <span className="mono small" aria-live="polite" style={{ minWidth: 40, textAlign: 'center' }}>{fontSize}px</span>
                <Button size="sm" onClick={() => setFontSize((s) => Math.min(20, s + 1))} ariaLabel="Increase font size">
                  A+
                </Button>
              </div>
            }
            bodyClassName="panel-body"
            ariaLabel="Code viewer"
          >
            <div className="code-toolbar">
              <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 160 }}>
                <input
                  className="input mono-input"
                  type="search"
                  aria-label="Find in file"
                  placeholder="Find in file"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') jumpToMatch()
                  }}
                />
                <Button size="sm" onClick={jumpToMatch} disabled={!findLower} ariaLabel="Jump to next match">
                  <MagnifierIcon size={13} />
                </Button>
                <span className="muted small" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
                  {findLower ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : ''}
                </span>
              </div>
              {contentQ.data && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip tone="muted">{contentQ.data.lang}</Chip>
                  <span className="muted small mono">{contentQ.data.line_count} lines {'·'} {fmtBytes(contentQ.data.content.length)}</span>
                </div>
              )}
            </div>

            {contentQ.isLoading && <LoadingShell label="Loading file" />}
            {contentQ.isError && <ErrorBanner error={contentQ.error} onRetry={() => void contentQ.refetch()} />}

            {contentQ.data && (
              <div
                className="codeview"
                tabIndex={0}
                role="application"
                aria-label={`Code, ${codeLines.length} lines. Click a line to set the report start, shift-click or press shift-Enter to set the range end.`}
                onMouseUp={onViewerMouseUp}
                onKeyDown={onViewerKeyDown}
                style={{ fontSize }}
              >
                {codeLines.map((line, i) => {
                  const n = i + 1
                  const inSel = selection !== null && n >= selection.start && n <= selection.end
                  const isCursor = cursorLine === n
                  const isHit = findLower !== '' && line.toLowerCase().includes(findLower)
                  const cls = `codeline${inSel ? ' sel' : ''}${isHit && !inSel ? ' hl' : ''}`
                  return (
                    <div
                      key={n}
                      id={`code-L${n}`}
                      className={cls}
                      style={isCursor && !inSel ? { borderLeftColor: 'var(--muted)' } : undefined}
                      onMouseDown={(e) => onLineMouseDown(n, e.shiftKey)}
                      onMouseMove={() => onLineMouseMove(n)}
                    >
                      <span className="line-no">{n}</span>
                      <span className="line-code">{line === '' ? ' ' : line}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {contentQ.data && (
              <div className="muted small mono" style={{ padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
                Selection: {selection ? `lines ${selection.start}-${selection.end}` : 'none'} {'·'} Click sets the start line,
                shift-click or drag sets the range, keyboard: arrows to move, Enter to set, Shift+Enter to extend.
              </div>
            )}
          </Panel>

          {/* RIGHT: report desk */}
          <Panel exhibit="EX-R" title="Report desk" bodyClassName="panel-body" ariaLabel="Report desk">
            <div className="report-tabs" role="tablist" aria-label="Report desk tabs">
              <button role="tab" aria-selected={tab === 'report'} className={`report-tab ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>
                Bug report
              </button>
              <button role="tab" aria-selected={tab === 'flag'} className={`report-tab ${tab === 'flag' ? 'active' : ''}`} onClick={() => setTab('flag')}>
                CTF flag
              </button>
              <button role="tab" aria-selected={tab === 'submissions'} className={`report-tab ${tab === 'submissions' ? 'active' : ''}`} onClick={() => setTab('submissions')}>
                Submissions
              </button>
            </div>

            {receipt && (
              <div className="receipt" style={{ marginTop: 14 }} role="status">
                <div className="overline-strong">{receipt.replay ? 'Receipt (replay of earlier submission)' : 'Receipt issued'}</div>
                <div className="receipt-code">{receipt.receipt_code}</div>
                <div className="muted small mono">
                  received {fmtDateTime(receipt.received_at)} {'·'} status {receipt.status} {'·'} id {receipt.submission_id.slice(0, 8)}
                </div>
                <div className="small">The report stays in your history under Submissions. Save this receipt code for disputes.</div>
                <div>
                  <Button size="sm" onClick={() => setReceipt(null)}>Dismiss</Button>
                </div>
              </div>
            )}

            {submitError && (
              <div style={{ marginTop: 14 }}>
                <ErrorBanner error={submitError} title={`Submission rejected (${submitError.code})`} />
              </div>
            )}
            {draftNotice && (
              <div className="banner banner-tone-warn" role="status" style={{ marginTop: 14 }}>
                <span className="banner-title">Draft conflict</span>
                <div className="small">{draftNotice}</div>
              </div>
            )}

            {tab === 'report' && (
              <form onSubmit={submitReport} className="stack" style={{ gap: 13, marginTop: 14 }} aria-label="Bug report form">
                {!stageActive && round && (
                  <div className="notice-inline" role="status">
                    Stage is <strong>{round.status}</strong>. Reports are accepted only while the stage is active.
                    {round.status === 'paused' && ' The round is paused: your timer is stopped and submissions reopen when organizers resume.'}
                    {['ended', 'evaluating', 'released', 'final'].includes(round.status) && ' The round has ended; the desk stays open read-only for your history.'}
                  </div>
                )}
                <Field label="Target file" htmlFor="rf-file" required error={formErrors.file_path}>
                  <input
                    id="rf-file"
                    className="input mono-input"
                    list="ws-file-list"
                    value={form.file_path}
                    onChange={(e) => updateForm({ file_path: e.target.value })}
                    placeholder="routes/notes.js"
                  />
                  <datalist id="ws-file-list">
                    {assignment.files.map((f) => (
                      <option key={f.path} value={f.path} />
                    ))}
                  </datalist>
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Line start" htmlFor="rf-ls" required error={formErrors.line_start}>
                    <input
                      id="rf-ls"
                      className="input mono-input"
                      type="number"
                      min={1}
                      value={form.line_start}
                      onChange={(e) => updateForm({ line_start: e.target.value })}
                    />
                  </Field>
                  <Field label="Line end" htmlFor="rf-le" required error={formErrors.line_end}>
                    <input
                      id="rf-le"
                      className="input mono-input"
                      type="number"
                      min={1}
                      value={form.line_end}
                      onChange={(e) => updateForm({ line_end: e.target.value })}
                    />
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Category" htmlFor="rf-cat" required error={formErrors.category}>
                    <div className="select-wrap">
                      <select id="rf-cat" className="select" value={form.category} onChange={(e) => updateForm({ category: e.target.value })}>
                        <option value="">Select category</option>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="Claimed severity" htmlFor="rf-sev" hint="Informational; scoring uses ground truth.">
                    <div className="select-wrap">
                      <select id="rf-sev" className="select" value={form.claimed_severity} onChange={(e) => updateForm({ claimed_severity: e.target.value })}>
                        <option value="">Not claimed</option>
                        {SEVERITIES.map((s: Severity) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                </div>
                <Field label="Title" htmlFor="rf-title" required error={formErrors.title} hint={`${form.title.trim().length}/120`}>
                  <input
                    id="rf-title"
                    className="input"
                    maxLength={120}
                    value={form.title}
                    onChange={(e) => updateForm({ title: e.target.value })}
                    placeholder="What fails, in one line"
                  />
                </Field>
                <Field label="Root cause description" htmlFor="rf-desc" required error={formErrors.description} hint={`${form.description.trim().length}/2000, min 20`}>
                  <textarea
                    id="rf-desc"
                    className="textarea"
                    maxLength={2000}
                    value={form.description}
                    onChange={(e) => updateForm({ description: e.target.value })}
                    placeholder="Reproduce the failure, then explain the code-level cause."
                  />
                </Field>
                <Field label="Impact" htmlFor="rf-impact" hint={`${form.impact.trim().length}/500`}>
                  <textarea
                    id="rf-impact"
                    className="textarea"
                    maxLength={500}
                    style={{ minHeight: 56 }}
                    value={form.impact}
                    onChange={(e) => updateForm({ impact: e.target.value })}
                    placeholder="What breaks for users or data if this stays unfixed."
                  />
                </Field>
                <Field label="Evidence" htmlFor="rf-evidence" hint={`${form.evidence.trim().length}/2000`}>
                  <textarea
                    id="rf-evidence"
                    className="textarea mono"
                    maxLength={2000}
                    style={{ minHeight: 56 }}
                    value={form.evidence}
                    onChange={(e) => updateForm({ evidence: e.target.value })}
                    placeholder="Log lines, request/output snippets, exact values observed."
                  />
                </Field>
                <Field label="Suggested fix" htmlFor="rf-fix" hint={`${form.suggested_fix.trim().length}/500`}>
                  <textarea
                    id="rf-fix"
                    className="textarea"
                    maxLength={500}
                    style={{ minHeight: 56 }}
                    value={form.suggested_fix}
                    onChange={(e) => updateForm({ suggested_fix: e.target.value })}
                    placeholder="Concrete change you would apply."
                  />
                </Field>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button type="submit" variant="primary" disabled={submitting || !stageActive}>
                    <SubmitArrowIcon size={14} />
                    {submitting ? 'Filing' : 'File report'}
                  </Button>
                  <span className="muted small mono">
                    draft {draftSavedAt ? `saved ${fmtDateTime(draftSavedAt)}` : 'autosaves every 3s'}
                  </span>
                </div>
              </form>
            )}

            {tab === 'flag' && (
              <form onSubmit={submitFlag} className="stack" style={{ gap: 13, marginTop: 14 }} aria-label="CTF flag form">
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <FlagIcon size={16} />
                  <p className="muted small">
                    Submit the exact flag string found in the challenge app. Verified flags pay bonus points, capped
                    for the team. Wrong or duplicate codes earn nothing; the server records every attempt.
                  </p>
                </div>
                <Field label="Flag code" htmlFor="rf-flag" required error={formErrors.flag_code}>
                  <input
                    id="rf-flag"
                    className="input mono-input"
                    type="text"
                    value={flagCode}
                    onChange={(e) => setFlagCode(e.target.value)}
                    placeholder="FLAG{...}"
                    spellCheck={false}
                  />
                </Field>
                <div>
                  <Button type="submit" variant="primary" disabled={submitting || !stageActive}>
                    <SubmitArrowIcon size={14} />
                    {submitting ? 'Filing' : 'Submit flag'}
                  </Button>
                </div>
                {!stageActive && round && (
                  <div className="notice-inline" role="status">
                    Flags are accepted only while the stage is active (current: {round.status}).
                  </div>
                )}
              </form>
            )}

            {tab === 'submissions' && <SubmissionsDrawer />}
          </Panel>
        </div>
      )}
    </div>
  )
}

function countdownText(endsAtIso: string, nowMs: number): string {
  const ms = new Date(endsAtIso).getTime() - nowMs
  if (ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

function countdownCls(endsAtIso: string, nowMs: number): string {
  const ms = new Date(endsAtIso).getTime() - nowMs
  if (ms <= 2 * 60_000) return 'countdown-critical pulse'
  if (ms <= 10 * 60_000) return 'countdown-warn pulse'
  return ''
}

function FileRow({
  path,
  short,
  active,
  onSelect,
}: {
  path: string
  short?: string
  active: boolean
  onSelect: (p: string) => void
}) {
  return (
    <button
      className={`filetree-row ${active ? 'active' : ''}`}
      role="treeitem"
      aria-selected={active}
      onClick={() => onSelect(path)}
      title={path}
    >
      <FileIcon size={13} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{short ?? path}</span>
    </button>
  )
}

function SubmissionsDrawer() {
  const q = useQuery({
    queryKey: ['submissions'],
    queryFn: () => api<{ submissions: SubmissionRow[] }>('/v1/submissions'),
    refetchInterval: 10_000,
  })

  if (q.isLoading) return <LoadingShell label="Loading submissions" />
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />

  const rows = q.data?.submissions ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing filed yet"
        note="Receipts appear here the moment the server accepts a report or flag. Feedback on each verdict stays hidden until results are released."
      />
    )
  }

  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
      <div className="muted small">
        The server acknowledges every acceptance with an immutable receipt. Statuses stay coarse before release.
      </div>
      <div className="ruled panel-2" style={{ maxHeight: 420, overflow: 'auto' }}>
        {rows.map((s) => (
          <Link
            key={s.id}
            to={`/app/submissions/${s.id}`}
            style={{ display: 'block', padding: '10px 12px', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span className="mono small" style={{ color: 'var(--signal)' }}>{s.receipt_code}</span>
              <StatusChip value={s.status} />
            </div>
            <div className="small" style={{ marginTop: 3, color: 'var(--paper)' }}>
              {s.kind === 'ctf_flag' ? (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <FlagIcon size={12} /> flag {s.flag_code?.slice(0, 18)}
                </span>
              ) : (
                <>
                  {s.title}
                  {s.file_path && <span className="muted mono"> {'·'} {s.file_path}:{s.line_start}-{s.line_end}</span>}
                </>
              )}
            </div>
            <div className="muted small mono">{fmtDateTime(s.received_at)}</div>
          </Link>
        ))}
      </div>
      <Link to="/app/submissions" className="btn btn-sm" style={{ justifySelf: 'start' }}>
        Open full history
      </Link>
    </div>
  )
}
