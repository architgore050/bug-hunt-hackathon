// Four-level participant workspace (/level/:n/run).
//
// Levels 1-2: read-only repository viewer + structured flag panel.
// Levels 3-4: editable editor, build panel (runner disabled by default),
// artifact upload and computed-diff submission.
//
// Persistence is two-layer: IndexedDB for instant restore, the versioned
// server draft for durability and server-owned auto-submit. Local data is
// cleared ONLY after the server acknowledges a submission with a 202 receipt;
// an ambiguous submit retries with the same idempotency key.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchWorkspace,
  fetchRepoFile,
  fetchLevelDraft,
  putLevelDraft,
  submitLevelWithKey,
  fetchProgress,
} from '../../lib/api-levels'
import type { FlagDraft } from '../../lib/api-levels'
import { guardRedirect, nodePath } from '../../lib/guards'
import { useLevelsQuery, useProgressQuery, useServerNow } from '../../lib/event-session'
import { api, ApiRequestError, newIdempotencyKey } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import {
  clearWorkspaceState,
  loadWorkspaceState,
  reconcileWorkspace,
  saveWorkspaceState,
  serverDraftToWorkspace,
} from '../../lib/persistence'
import type { WorkspacePersistedState } from '../../lib/persistence'
import { buildMultiFileDiff } from '../../lib/diff'
import { fmtCountdown } from '../../lib/format'
import { EventProgressBar } from '../../components/event/ProgressBar'
import { EventWarnings } from '../../components/event/Warnings'
import { ConfirmModal } from '../../components/event/ConfirmModal'
import { FlagPanel } from '../../components/workspace/FlagPanel'
import type { FlagSelection } from '../../components/workspace/FlagPanel'
import { CodeViewer, FileTree } from '../../components/workspace/CodeViewer'
import { EditableEditor } from '../../components/workspace/EditableEditor'
import { BuildPanel } from '../../components/workspace/BuildPanel'
import { UploadDialog } from '../../components/workspace/UploadDialog'
import type { StagedArtifact } from '../../components/workspace/UploadDialog'
import { Button, Chip, ErrorBanner, EmptyState, LoadingShell, Panel, StatusChip } from '../../ui/components'

type SaveStatus = 'idle' | 'saved-local' | 'saving-server' | 'saved-server' | 'submit-queued' | 'accepted' | 'save-failed'

const SAVE_CHIP: Record<SaveStatus, { label: string; tone: 'muted' | 'info' | 'ok' | 'warn' | 'signal' | 'danger' }> = {
  idle: { label: 'Draft empty', tone: 'muted' },
  'saved-local': { label: 'Saved locally', tone: 'info' },
  'saving-server': { label: 'Saving to server', tone: 'info' },
  'saved-server': { label: 'Saved to server', tone: 'ok' },
  'submit-queued': { label: 'Submit queued', tone: 'warn' },
  accepted: { label: 'Submission accepted', tone: 'ok' },
  'save-failed': { label: 'Save failed - retry', tone: 'danger' },
}

export default function LevelWorkspace() {
  const { levelNo } = useParams()
  const n = Number(levelNo)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const nowMs = useServerNow()
  const levelsQ = useLevelsQuery()
  const progressQ = useProgressQuery()

  const editable = n >= 3

  const workspaceQ = useQuery({
    queryKey: ['level-workspace', n],
    queryFn: () => fetchWorkspace(n),
    enabled: Number.isInteger(n) && n >= 1 && n <= 4,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

  const configQ = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      try {
        return await api<{ runner_enabled: boolean }>('/v1/config')
      } catch {
        return null
      }
    },
    staleTime: 60_000,
  })

  /* ---------- workspace state ---------- */
  const [flags, setFlags] = useState<FlagDraft[]>([])
  const [tabs, setTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [selection, setSelection] = useState<FlagSelection | null>(null)
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({})
  const [baseFiles, setBaseFiles] = useState<Record<string, string>>({})
  const [flagPanelOpen, setFlagPanelOpen] = useState(false)
  const [artifact, setArtifact] = useState<StagedArtifact | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitConfirmEmpty, setSubmitConfirmEmpty] = useState(false)
  const [submitMode, setSubmitMode] = useState<'compute_diff' | 'artifact'>('compute_diff')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<ApiRequestError | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ local: WorkspacePersistedState; serverState: WorkspacePersistedState } | null>(null)
  const [runState] = useState<'idle' | 'unavailable'>('idle')

  const draftVersionRef = useRef<number>(0)
  const restoredRef = useRef<number>(0)
  const idemKeyRef = useRef<string | null>(null)
  const localTimerRef = useRef<number | null>(null)
  const serverTimerRef = useRef<number | null>(null)

  const ws = workspaceQ.data ?? null
  const pointer = progressQ.data?.pointer ?? null
  const redirect = useMemo(() => guardRedirect(pointer, n, 'run'), [pointer, n])

  const files = ws?.files ?? []
  const limits = ws
    ? { maxFlags: ws.limits.max_flags, maxSpan: ws.limits.max_span, maxLocations: ws.limits.max_locations }
    : { maxFlags: 12, maxSpan: 25, maxLocations: n === 2 ? 5 : 1 }

  /* ---------- draft serialization ---------- */

  const toPersisted = useCallback(
    (updatedAt?: number): WorkspacePersistedState => ({
      schemaVersion: 1,
      userId: user?.id ?? '',
      levelNo: n,
      tabs,
      activePath,
      scrollPositions: {},
      selection: selection ? { path: selection.path, start: selection.start, end: selection.end } : null,
      flags: editable ? null : flags,
      files: editable ? editedFiles : null,
      updatedAt: updatedAt ?? Date.now(),
    }),
    [user, n, tabs, activePath, selection, editable, flags, editedFiles],
  )

  const draftPayload = useCallback(
    (state: WorkspacePersistedState): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        __workspace: {
          tabs: state.tabs,
          activePath: state.activePath,
          scrollPositions: state.scrollPositions,
          selection: state.selection,
        },
      }
      if (state.flags !== null) payload.flags = state.flags
      if (state.files !== null) payload.files = state.files
      return payload
    },
    [],
  )

  const flushServerSave = useCallback(
    async (state: WorkspacePersistedState): Promise<void> => {
      if (!ws) return
      setSaveStatus('saving-server')
      try {
        const res = await putLevelDraft(n, { payload: draftPayload(state), version: draftVersionRef.current })
        draftVersionRef.current = res.version
        setSaveStatus('saved-server')
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'DRAFT_VERSION_CONFLICT') {
          try {
            const latest = await fetchLevelDraft(n)
            draftVersionRef.current = latest.version
            const res = await putLevelDraft(n, { payload: draftPayload(state), version: latest.version })
            draftVersionRef.current = res.version
            setSaveStatus('saved-server')
            return
          } catch {
            setSaveStatus('save-failed')
            return
          }
        }
        setSaveStatus('save-failed')
      }
    },
    [ws, n, draftPayload],
  )

  const flushNow = useCallback(async (): Promise<void> => {
    if (localTimerRef.current !== null) window.clearTimeout(localTimerRef.current)
    if (serverTimerRef.current !== null) window.clearTimeout(serverTimerRef.current)
    localTimerRef.current = null
    serverTimerRef.current = null
    const state = toPersisted()
    const hasContent = (state.flags !== null && state.flags.length > 0) || (state.files !== null && Object.keys(state.files).length > 0)
    if (!hasContent) return
    try {
      await saveWorkspaceState(state)
      if (saveStatus === 'idle' || saveStatus === 'saved-local') setSaveStatus('saved-local')
    } catch {
      // Local quota or unavailability: the server draft remains the source.
    }
    await flushServerSave(state)
  }, [toPersisted, flushServerSave, saveStatus])

  // Debounced local save.
  useEffect(() => {
    if (localTimerRef.current !== null) window.clearTimeout(localTimerRef.current)
    localTimerRef.current = window.setTimeout(() => {
      void saveWorkspaceState(toPersisted()).then(() => {
        if (saveStatus === 'idle') setSaveStatus('saved-local')
      }).catch(() => undefined)
    }, 800)
    return () => {
      if (localTimerRef.current !== null) window.clearTimeout(localTimerRef.current)
    }
  }, [flags, editedFiles, tabs, activePath, selection, toPersisted, saveStatus])

  // Debounced server save.
  useEffect(() => {
    if (serverTimerRef.current !== null) window.clearTimeout(serverTimerRef.current)
    serverTimerRef.current = window.setTimeout(() => {
      void flushServerSave(toPersisted())
    }, 3000)
    return () => {
      if (serverTimerRef.current !== null) window.clearTimeout(serverTimerRef.current)
    }
  }, [flags, editedFiles, tabs, activePath, selection, toPersisted, flushServerSave])

  // Flush on hide.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flushNow()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [flushNow])

  /* ---------- restore on entry ---------- */

  useEffect(() => {
    if (!ws || restoredRef.current === n || !user) return
    restoredRef.current = n
    draftVersionRef.current = ws.draft.version
    void (async () => {
      const local = await loadWorkspaceState(user.id, n).catch(() => null)
      const outcome = reconcileWorkspace(local, ws.draft)
      if (outcome.chosen === 'conflict' && outcome.state) {
        setConflict({ local: outcome.state, serverState: outcome.state })
      }
      const chosen =
        outcome.chosen === 'server'
          ? serverDraftToWorkspace(ws.draft, user.id, n)
          : outcome.chosen === 'local'
            ? outcome.state
            : outcome.state
      if (!chosen) return
      const hasData =
        (chosen.flags !== null && chosen.flags.length > 0) ||
        (chosen.files !== null && Object.keys(chosen.files).length > 0) ||
        chosen.tabs.length > 0
      if (hasData) setRestoreNotice('Restored your latest work.')
      if (chosen.flags) setFlags(chosen.flags)
      if (chosen.files) setEditedFiles(chosen.files)
      if (chosen.tabs.length > 0) setTabs(chosen.tabs)
      if (chosen.activePath) setActivePath(chosen.activePath)
      else if (files.length > 0) setActivePath(files[0].path)
      if (chosen.selection) setSelection(chosen.selection)
      if (outcome.chosen === 'server') setSaveStatus('saved-server')
    })()
  }, [ws, n, user, files])

  /* ---------- file content ---------- */

  const fileQ = useQuery({
    queryKey: ['repo-file', n, activePath],
    queryFn: () => fetchRepoFile(activePath as string, n),
    enabled: Boolean(activePath),
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (fileQ.data && activePath) {
      setBaseFiles((prev) => (prev[activePath] === fileQ.data.content ? prev : { ...prev, [activePath]: fileQ.data.content }))
    }
  }, [fileQ.data, activePath])

  const displayContent = useMemo(() => {
    if (!activePath) return ''
    if (editable && activePath in editedFiles) return editedFiles[activePath]
    if (fileQ.data) return fileQ.data.content
    return ''
  }, [activePath, editable, editedFiles, fileQ.data])

  function openFile(path: string) {
    setActivePath(path)
    setTabs((t) => (t.includes(path) ? t : [...t, path].slice(-8)))
    if (fileQ.data && selection && selection.path !== path) setSelection(null)
    void flushNow()
  }

  function closeTab(path: string) {
    setTabs((t) => t.filter((p) => p !== path))
    if (activePath === path) {
      const next = tabs.filter((p) => p !== path)[0] ?? files[0]?.path ?? null
      setActivePath(next)
    }
    void flushNow()
  }

  /* ---------- deadline hooks ---------- */

  const onFinalMinute = useCallback(() => {
    void flushNow()
  }, [flushNow])
  const onDeadline = useCallback(() => {
    void flushNow()
  }, [flushNow])

  /* ---------- submission ---------- */

  function requestSubmit(confirmEmpty = false) {
    setSubmitConfirmEmpty(confirmEmpty)
    idemKeyRef.current = newIdempotencyKey()
    if (editable) setSubmitMode(artifact ? 'artifact' : 'compute_diff')
    setSubmitOpen(true)
  }

  async function doSubmit() {
    if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey()
    setSubmitting(true)
    setSubmitError(null)
    setSaveStatus('submit-queued')
    try {
      await flushNow()
      const body = editable
        ? submitMode === 'artifact' && artifact
          ? { artifact_id: artifact.artifact_id }
          : { compute_diff: true }
        : { flags, confirm_empty: submitConfirmEmpty }
      await submitLevelWithKey(n, body, idemKeyRef.current)
      // Acknowledged: only now clear local level data.
      await clearWorkspaceState(user?.id ?? '', n).catch(() => undefined)
      setSaveStatus('accepted')
      setSubmitOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['progress'] })
      void queryClient.invalidateQueries({ queryKey: ['levels'] })
      void queryClient.invalidateQueries({ queryKey: ['team-score'] })
      const progress = await fetchProgress().catch(() => null)
      const next = progress?.pointer ? nodePath(progress.pointer.level_no, progress.pointer.node) : '/dashboard'
      navigate(next, { replace: true })
    } catch (err) {
      setSaveStatus('save-failed')
      if (err instanceof ApiRequestError) {
        setSubmitError(err)
        if (err.code === 'LEVEL_ALREADY_SUBMITTED') {
          const progress = await fetchProgress().catch(() => null)
          const next = progress?.pointer ? nodePath(progress.pointer.level_no, progress.pointer.node) : '/dashboard'
          navigate(next, { replace: true })
          return
        }
        if (err.code === 'IDEMPOTENCY_CONFLICT' || err.network || err.status >= 500) {
          // Keep the same idempotency key so the retry replays this attempt.
        } else {
          idemKeyRef.current = null
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------- editable helpers ---------- */

  function onEdit(next: string) {
    if (!activePath) return
    setEditedFiles((prev) => ({ ...prev, [activePath]: next }))
  }

  async function exportDiff() {
    const changed = Object.keys(editedFiles)
    if (changed.length === 0) return
    const blocks: { path: string; base: string | null; next: string }[] = []
    for (const path of changed) {
      let base: string | null = baseFiles[path] ?? null
      if (base === null) {
        try {
          const res = await fetchRepoFile(path, n)
          base = res.content
        } catch {
          base = null
        }
      }
      blocks.push({ path, base, next: editedFiles[path] })
    }
    const text = buildMultiFileDiff(blocks)
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `level${n}-changes.diff`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---------- guard + lifecycle panels ---------- */

  if (!Number.isInteger(n) || n < 1 || n > 4) return <Navigate to="/dashboard" replace />
  if (redirect) return <Navigate to={redirect} replace />

  const wsError = workspaceQ.error instanceof ApiRequestError ? workspaceQ.error : null
  const gateBlocked =
    wsError && (wsError.code === 'TEAM_GATE_BLOCKED' || wsError.code === 'LEVEL_NOT_OPEN' || wsError.code === 'REPO_NOT_LOCKED')

  const deadlineMs = ws?.ends_at_effective ? new Date(ws.ends_at_effective).getTime() : null
  const msLeft = deadlineMs !== null && nowMs !== null ? deadlineMs - nowMs : null
  const chip = SAVE_CHIP[saveStatus]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <EventProgressBar levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} />
      <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
        <div className="wrap-wide" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0' }}>
          <span className="exhibit-num">WS-{n}</span>
          <span style={{ fontWeight: 600 }}>{`Level ${n} workspace`}</span>
          {ws?.repo_option && <Chip tone="info">{`Option ${ws.repo_option.option_key}`}</Chip>}
          <StatusChip value={levelsQ.data?.levels.find((l) => l.level_no === n)?.status ?? null} />
          {ws?.editable && <Chip tone="signal">editable</Chip>}
          {!ws?.editable && <Chip tone="muted">read only</Chip>}
          <span className="countdown" style={{ fontSize: 18 }} aria-live="off">
            {msLeft === null ? '--:--:--' : msLeft <= 0 ? "Time's up" : fmtCountdown(msLeft)}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip tone={chip.tone}>{chip.label}</Chip>
            <Button size="sm" onClick={() => navigate(`/level/${n}/explain`)}>Explain</Button>
            <Button size="sm" onClick={() => navigate(`/level/${n}/rules`)}>Rules</Button>
            <Button
              size="sm"
              onClick={() => {
                void flushNow()
                navigate('/dashboard')
              }}
            >
              Dashboard
            </Button>
            {!editable && (
              <Button size="sm" variant={flagPanelOpen ? 'primary' : 'ghost'} onClick={() => { setFlagPanelOpen((o) => !o); void flushNow() }}>
                Flag {flagPanelOpen ? '▼' : '▲'}
              </Button>
            )}
            {editable && (
              <>
                <Button size="sm" onClick={() => setUploadOpen(true)}>Upload artifact</Button>
                <Button size="sm" variant="primary" onClick={() => requestSubmit(false)}>Submit level</Button>
              </>
            )}
          </span>
        </div>
      </div>

      <EventWarnings levels={levelsQ.data} progress={progressQ.data} nowMs={nowMs} onFinalMinute={onFinalMinute} onDeadline={onDeadline} />

      <div className="wrap-wide" style={{ flex: 1, padding: '14px 0 24px' }}>
        {restoreNotice && (
          <div className="banner banner-tone-info" role="status">
            <span className="banner-title">{restoreNotice}</span>
          </div>
        )}
        {conflict && (
          <div className="banner banner-tone-warn" role="alert">
            <span className="banner-title">Two versions of your work</span>
            <div className="small">Your browser and the server hold different drafts. Pick which one to continue with; nothing is deleted.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button size="sm" onClick={() => { hydrateFrom(conflict.local); setConflict(null) }}>Use this browser's draft</Button>
              <Button size="sm" onClick={() => { hydrateFrom(conflict.serverState); setConflict(null) }}>Use the server draft</Button>
            </div>
          </div>
        )}

        {gateBlocked && wsError && (
          <div className="stack">
            <div className="banner banner-tone-warn" role="alert">
              <span className="banner-title">{wsError.serverMessage}</span>
              <div className="small">The server re-checks the gate on every entry. This page will work once the gate opens.</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Button size="sm" onClick={() => void workspaceQ.refetch()}>Check again</Button>
                <Button size="sm" onClick={() => navigate('/dashboard')}>Dashboard</Button>
              </div>
            </div>
            {wsError.code === 'REPO_NOT_LOCKED' && (
              <div className="small muted">Your team lead locks the repository on the Level 1 explanation page.</div>
            )}
          </div>
        )}

        {wsError && !gateBlocked && (
          <ErrorBanner error={wsError} title="Could not open the workspace" onRetry={() => void workspaceQ.refetch()} />
        )}

        {!workspaceQ.isError && !ws && workspaceQ.isPending && <LoadingShell label="Opening workspace" />}

        {ws && (
          <div className="workspace" style={{ marginTop: 12 }}>
            <Panel exhibit="EX-F" title="Repository files" className="ws-files" ariaLabel="File explorer">
              <FileTree files={files} activePath={activePath} onSelect={openFile} />
            </Panel>

            <Panel
              exhibit="EX-C"
              title={activePath ?? 'Code'}
              actions={
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {tabs.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {tabs.map((t) => (
                        <span key={t} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            className={`report-tab ${t === activePath ? 'report-tab-active' : ''}`}
                            onClick={() => openFile(t)}
                            aria-current={t === activePath || undefined}
                          >
                            {t.split('/').pop()}
                          </button>
                          <button type="button" className="btn btn-sm" aria-label={`Close tab ${t}`} onClick={() => closeTab(t)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              }
              ariaLabel="Code editor"
            >
              {!activePath && <EmptyState title="No file open" note="Choose a file from the repository tree." />}
              {activePath && !editable && (
                <CodeViewer
                  path={activePath}
                  content={displayContent}
                  lang={fileQ.data?.lang}
                  selection={selection}
                  onSelectionChange={setSelection}
                />
              )}
              {activePath && editable && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Chip tone={activePath in editedFiles ? 'signal' : 'muted'}>
                      {activePath in editedFiles ? 'edited' : 'unmodified'}
                    </Chip>
                    <Button size="sm" onClick={() => void exportDiff()} disabled={Object.keys(editedFiles).length === 0}>
                      Export my changes as .diff
                    </Button>
                  </div>
                  <EditableEditor path={activePath} content={displayContent} onChange={onEdit} />
                </div>
              )}
            </Panel>

            {!editable && flagPanelOpen && (
              <Panel exhibit="EX-R" title="Bug report flags" className="ws-report" ariaLabel="Flag panel">
                <FlagPanel
                  levelNo={n === 2 ? 2 : 1}
                  files={files}
                  activePath={activePath}
                  selection={selection}
                  limits={limits}
                  flags={flags}
                  onFlagsChange={setFlags}
                  onSubmit={(confirmEmpty) => requestSubmit(confirmEmpty)}
                  submitting={submitting}
                  submitError={submitError}
                />
              </Panel>
            )}

            {editable && (
              <Panel exhibit="EX-B" title="Build output and submission" className="ws-report" ariaLabel="Build panel">
                <div className="stack">
                  <BuildPanel
                    runnerEnabled={configQ.data ? configQ.data.runner_enabled : null}
                    runState={runState === 'unavailable' ? 'unavailable' : 'idle'}
                    notice={runState === 'unavailable' ? 'The runner answered RUNNER_UNAVAILABLE. Saving and submission are unaffected.' : null}
                  />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {artifact ? (
                      <Chip tone="ok">{`staged: ${artifact.filename} (${artifact.kind})`}</Chip>
                    ) : (
                      <span className="small muted">No artifact staged yet. Submitting uses the computed draft diff.</span>
                    )}
                    <Button size="sm" onClick={() => requestSubmit(false)}>Submit level</Button>
                  </div>
                  <div className="notice-inline small">
                    Submitting locks this level: the server takes the latest saved draft or your staged artifact and you
                    cannot return to this level afterwards.
                  </div>
                </div>
              </Panel>
            )}
          </div>
        )}
      </div>

      <UploadDialog open={uploadOpen} levelNo={n} onClose={() => setUploadOpen(false)} onStaged={setArtifact} />

      <ConfirmModal
        open={submitOpen}
        title={editable ? 'Submit this level?' : 'Submit your flags?'}
        confirmLabel={submitting ? 'Submitting...' : 'Submit'}
        cancelLabel="Not yet"
        onConfirm={() => void doSubmit()}
        onCancel={() => {
          if (!submitting) {
            setSubmitOpen(false)
            setSubmitError(null)
          }
        }}
        busy={submitting}
      >
        {editable ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}>You cannot return to this level after submitting.</p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name="bhctf-submit-mode"
                checked={submitMode === 'compute_diff'}
                onChange={() => setSubmitMode('compute_diff')}
              />
              Submit the computed diff of my saved edits (recommended)
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name="bhctf-submit-mode"
                checked={submitMode === 'artifact'}
                onChange={() => setSubmitMode('artifact')}
                disabled={!artifact}
              />
              Submit the staged artifact{artifact ? `: ${artifact.filename}` : ' (stage one via Upload artifact)'}
            </label>
          </div>
        ) : (
          <p style={{ margin: 0 }}>
            {submitConfirmEmpty
              ? 'You are submitting with zero flags. An empty submission is recorded exactly as it is; it is not filled in later.'
              : `You are submitting ${flags.length} flag${flags.length === 1 ? '' : 's'}. You cannot return to this level after submitting.`}
          </p>
        )}
        {submitError && <ErrorBanner error={submitError} title="Submission problem" />}
        {submitError && (submitError.network || submitError.status >= 500 || submitError.code === 'IDEMPOTENCY_CONFLICT') && (
          <div className="small muted">Retrying keeps the same attempt id, so the server cannot record it twice.</div>
        )}
      </ConfirmModal>

      <span className="sr-only" aria-live="polite">
        {chip.label}
      </span>
    </div>
  )

  function hydrateFrom(state: WorkspacePersistedState) {
    if (state.flags) setFlags(state.flags)
    if (state.files) setEditedFiles(state.files)
    if (state.tabs.length > 0) setTabs(state.tabs)
    if (state.activePath) setActivePath(state.activePath)
    if (state.selection) setSelection(state.selection)
  }
}
