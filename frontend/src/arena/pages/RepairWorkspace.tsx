import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { AI_NOTICE, LEVEL_POLICY } from '../config'
import { useArena } from '../state/ArenaProvider'
import type { Repository } from '../types'
import { CodeMirrorPane } from '../components/CodeMirrorPane'
import { FileTabs, FileTree } from '../components/CodeBrowser'
import { Icon } from '../ui/Icons'
import { Button, Chip, Field, Modal, StatusChip, Tabs } from '../ui/primitives'

type RightTab = 'task' | 'ai' | 'output' | 'tests'
type BottomTab = 'terminal' | 'tests' | 'logs' | 'problems' | 'status'

export default function RepairWorkspace({ level }: { level: number }) {
  const {
    repositories, questions, messages, askAssistant, submitRepair, pushToast,
    testResults, terminalLines, warnRestriction,
  } = useArena()
  const repo: Repository = level === 4 ? repositories.marina : repositories.papyrus
  const policy = LEVEL_POLICY[level]

  const [paths, setPaths] = useState<string[]>(() => repo ? repo.recentPaths.slice(0, 3) : [])
  const [activePath, setActivePath] = useState(() => paths[0] ?? '')
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries((repo?.files ?? []).map((file) => [file.path, file.content])),
  )
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [rightTab, setRightTab] = useState<RightTab>('task')
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [rightWidth, setRightWidth] = useState(320)
  const [bottomOpen, setBottomOpen] = useState(true)
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal')
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [aiInput, setAiInput] = useState('')
  const [aiContext, setAiContext] = useState('')
  const [asking, setAsking] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [running, setRunning] = useState(false)

  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  const activeFile = useMemo(() => repo?.files.find((file) => file.path === activePath) ?? repo?.files[0], [repo, activePath])
  const value = activeFile ? drafts[activeFile.path] ?? activeFile.content : ''
  const levelQuestions = questions.filter((question) => question.level === level)
  const isDirty = activeFile ? !saved[activeFile.path] && value !== activeFile.content : false

  useEffect(() => {
    if (rightTab === 'ai') chatEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, rightTab])

  useEffect(() => {
    if (!repo) return
    setPaths((prev) => prev.length ? prev : repo.recentPaths.slice(0, 3))
    setActivePath((prev) => prev || repo.recentPaths[0] || repo.files[0]?.path || '')
    setDrafts((prev) => Object.keys(prev).length ? prev : Object.fromEntries(repo.files.map((file) => [file.path, file.content])))
  }, [repo])

  if (!repo || !activeFile) return <div className="ar-page"><p>Loading repository...</p></div>

  const openFile = (path: string) => {
    setActivePath(path)
    setPaths((prev) => prev.includes(path) ? prev : [...prev, path])
  }

  const closeFile = (path: string) => {
    setPaths((prev) => {
      const next = prev.filter((item) => item !== path)
      if (path === activePath && next.length) setActivePath(next[next.length - 1])
      return next
    })
  }

  const changeValue = (next: string) => {
    setDrafts((prev) => ({ ...prev, [activeFile.path]: next }))
    setSaved((prev) => ({ ...prev, [activeFile.path]: false }))
  }

  const saveFile = () => {
    setSaved((prev) => ({ ...prev, [activeFile.path]: true }))
    pushToast(`${activeFile.path} saved locally`, 'ok')
  }

  const runTests = () => {
    setRunning(true)
    setBottomOpen(true)
    setBottomTab('tests')
    window.setTimeout(() => {
      setRunning(false)
      pushToast('Evaluation run finished: 3 passed, 2 failed', 'warn')
    }, 700)
  }

  const findNext = () => {
    const view = editorRef.current?.view
    if (!view || !findQuery.trim()) return
    const doc = view.state.doc.toString()
    const from = view.state.selection.main.head
    let index = doc.indexOf(findQuery, from)
    if (index === -1) index = doc.indexOf(findQuery)
    if (index === -1) { pushToast('No matches in this file', 'warn'); return }
    view.dispatch({ selection: { anchor: index, head: index + findQuery.length }, scrollIntoView: true })
    view.focus()
  }

  const replaceOne = () => {
    const view = editorRef.current?.view
    if (!view || !findQuery.trim()) return
    const selection = view.state.selection.main
    const selected = view.state.sliceDoc(selection.from, selection.to)
    if (selected === findQuery) {
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: replaceQuery } })
      pushToast('Replaced one match', 'ok')
    } else {
      findNext()
    }
  }

  const replaceAll = () => {
    const view = editorRef.current?.view
    if (!view || !findQuery.trim()) return
    const doc = view.state.doc.toString()
    const next = doc.split(findQuery).join(replaceQuery)
    view.dispatch({ changes: { from: 0, to: doc.length, insert: next } })
    pushToast('Replaced all matches', 'ok')
  }

  const attachSelection = () => {
    const view = editorRef.current?.view
    if (!view) return
    const selection = view.state.selection.main
    const text = selection.from !== selection.to ? view.state.sliceDoc(selection.from, selection.to) : value
    setAiContext(text.slice(0, 320))
    pushToast('Code context attached to assistant')
  }

  const sendAi = async () => {
    if (!aiInput.trim() || asking) return
    const prompt = aiInput.trim()
    setAiInput('')
    setAsking(true)
    await askAssistant(prompt, aiContext || activeFile.path)
    setAsking(false)
  }

  const submit = async () => {
    const result = await submitRepair(summary)
    if (!result.ok) { pushToast(result.message, 'warn'); return }
    setSubmitOpen(false)
    setSummary('')
    setBottomOpen(true)
    setBottomTab('status')
    pushToast(`${result.id} queued for evaluation`, 'ok')
  }

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      const width = window.innerWidth - moveEvent.clientX
      setRightWidth(Math.max(260, Math.min(520, width)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const rightTabs: Array<{ id: RightTab; label: string; icon: 'target' | 'chat' | 'terminal' | 'check'; disabled?: boolean }> = [
    { id: 'task', label: 'Task', icon: 'target' },
    ...(policy.aiAllowed ? [{ id: 'ai' as const, label: 'AI Assistant', icon: 'chat' as const }] : []),
    { id: 'output', label: 'Output', icon: 'terminal' },
    { id: 'tests', label: 'Tests', icon: 'check' },
  ]

  return (
    <div className="ar-ide">
      <header className="ar-ide__bar">
        <div className="ar-ide__bar-left">
          <div className="ar-overline">Level {String(level).padStart(2, '0')} / {level === 4 ? 'Final Challenge' : 'Repair'}</div>
          <strong>{repo.name}</strong>
          <Chip tone="neutral"><Icon name="branch" size={12} />{repo.branch}</Chip>
        </div>
        <div className="ar-ide__bar-right">
          <div className="ar-rule-indicator" title={policy.summary} onClick={() => warnRestriction('Shortcut')}>
            <Icon name="shield" size={13} />
            <span>{policy.label}</span>
            <small>{policy.copyRestricted ? 'Copy restricted' : policy.aiAllowed ? 'AI enabled' : 'Restricted'}</small>
          </div>
          {level === 4 && <Chip tone="danger">{AI_NOTICE}</Chip>}
          <Button size="sm" variant="ghost" icon="play" disabled={running} onClick={runTests}>{running ? 'Running...' : 'Run tests'}</Button>
          <Button size="sm" variant="primary" icon="send" onClick={() => setSubmitOpen(true)}>Submit repair</Button>
        </div>
      </header>

      <div className="ar-ide__body">
        <aside className="ar-ide__explorer">
          <div className="ar-ide__pane-head"><Icon name="repo" size={14} /><span>Explorer</span></div>
          <FileTree tree={repo.tree} activePath={activeFile.path} onOpen={openFile} />
          <div className="ar-ide__recent">
            <div className="ar-overline">Recently opened</div>
            {paths.slice(0, 5).map((path) => (
              <button key={path} onClick={() => openFile(path)}><Icon name="clock" size={12} />{path}</button>
            ))}
          </div>
        </aside>

        <section className="ar-ide__editor">
          <FileTabs paths={paths} activePath={activeFile.path} onOpen={openFile} onClose={closeFile} />
          <div className="ar-editor-toolbar">
            <span className="ar-breadcrumb">{activeFile.path.split('/').map((part, index) => <span key={index}>{part}</span>)}</span>
            <div className="ar-editor-toolbar__actions">
              {isDirty && <Chip tone="warn"><i className="ar-dot" />Unsaved</Chip>}
              <button className="ar-icon-btn" title="Find and replace" onClick={() => setFindOpen(!findOpen)}><Icon name="search" size={14} /></button>
              <button className="ar-icon-btn" title="Save file" onClick={saveFile}><Icon name="check" size={14} /></button>
              <button className="ar-icon-btn" title="Collapse right panel" onClick={() => setRightCollapsed(!rightCollapsed)}><Icon name="panel" size={14} /></button>
            </div>
          </div>
          {findOpen && (
            <div className="ar-findbar">
              <Icon name="search" size={13} />
              <input value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') findNext() }} placeholder="Find" aria-label="Find in file" />
              <Button size="sm" variant="ghost" onClick={findNext}>Next</Button>
              <input value={replaceQuery} onChange={(event) => setReplaceQuery(event.target.value)} placeholder="Replace" aria-label="Replace with" />
              <Button size="sm" variant="ghost" onClick={replaceOne}>Replace</Button>
              <Button size="sm" variant="ghost" onClick={replaceAll}>All</Button>
              <button className="ar-icon-btn" onClick={() => setFindOpen(false)} aria-label="Close find"><Icon name="close" size={12} /></button>
            </div>
          )}
          <div className="ar-editor-surface">
            <CodeMirrorPane ref={editorRef} value={value} language={activeFile.language} onChange={changeValue} />
          </div>
          <div className="ar-editor-status">
            <span>{activeFile.language}</span><span>UTF-8</span><span>{value.split('\n').length} lines</span>
            <span>{isDirty ? 'Modified' : 'Saved'}</span>
          </div>
        </section>

        {!rightCollapsed && (
          <>
            <div className="ar-resize-handle" onPointerDown={startResize} role="separator" aria-label="Resize panel" />
            <aside className="ar-ide__right" style={{ width: rightWidth }}>
              <div className="ar-ide__pane-head">
                <Tabs tabs={rightTabs} active={rightTab} onChange={(id) => setRightTab(id as RightTab)} />
                <button className="ar-icon-btn" onClick={() => setRightCollapsed(true)} aria-label="Close panel"><Icon name="close" size={13} /></button>
              </div>
              <div className="ar-ide__right-body">
                {rightTab === 'task' && <TaskPanel level={level} questions={levelQuestions} />}
                {rightTab === 'ai' && policy.aiAllowed && (
                  <div className="ar-ai">
                    <div className="ar-ai__status"><span className="ar-ai__dot" />AI assistant available in Level 3</div>
                    <div className="ar-ai__context">
                      <Icon name="code" size={13} />
                      <span>{aiContext ? aiContext.slice(0, 48) + (aiContext.length > 48 ? '...' : '') : `Context: ${activeFile.path}`}</span>
                      <button onClick={attachSelection}>Attach selection</button>
                    </div>
                    <div className="ar-ai__messages">
                      {messages.map((message) => (
                        <div key={message.id} className={`ar-ai__msg is-${message.role}`}>
                          <span className="ar-ai__who">{message.role === 'user' ? 'You' : 'Assistant'}</span>
                          <p>{message.text}</p>
                          {message.context && <small>Context: {message.context}</small>}
                        </div>
                      ))}
                      {asking && <div className="ar-ai__msg is-assistant is-loading"><span className="ar-ai__who">Assistant</span><p>Analysing the code context...</p></div>}
                      <div ref={chatEnd} />
                    </div>
                    <div className="ar-ai__suggestions">
                      {['Explain selected code', 'Help debug a failing test', 'Suggest a minimal fix'].map((suggestion) => (
                        <button key={suggestion} onClick={() => { setAiInput(suggestion); pushToast(`Prompt set: ${suggestion}`) }}>{suggestion}</button>
                      ))}
                    </div>
                    <div className="ar-ai__input">
                      <textarea rows={2} value={aiInput} onChange={(event) => setAiInput(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendAi() } }}
                        placeholder="Ask about this file or selection" aria-label="Ask the assistant" />
                      <Button size="sm" variant="primary" icon="send" disabled={asking || !aiInput.trim()} onClick={sendAi}>Send</Button>
                    </div>
                  </div>
                )}
                {rightTab === 'output' && (
                  <div className="ar-output"><div className="ar-overline">Last build output</div>
                    <pre>{['> papyrus build', '> compiling server modules', '  server/routes/notes.js  ok', '  src/components/NoteList.jsx  ok', 'Build complete with 0 errors'].join('\n')}</pre>
                  </div>
                )}
                {rightTab === 'tests' && <TestPanel />}
              </div>
            </aside>
          </>
        )}
        {rightCollapsed && (
          <button className="ar-ide__reopen" onClick={() => setRightCollapsed(false)} title="Open right panel"><Icon name="panel" size={14} /></button>
        )}
      </div>

      <section className={`ar-bottom ${bottomOpen ? 'is-open' : ''}`}>
        <div className="ar-bottom__bar">
          <button onClick={() => setBottomOpen(!bottomOpen)}><Icon name={bottomOpen ? 'chevron-down' : 'chevron-right'} size={13} />Panel</button>
          <Tabs<BottomTab> tabs={[
            { id: 'terminal', label: 'Terminal', icon: 'terminal' },
            { id: 'tests', label: 'Tests', icon: 'check' },
            { id: 'logs', label: 'Logs', icon: 'inbox' },
            { id: 'problems', label: 'Problems', icon: 'warning' },
            { id: 'status', label: 'Status', icon: 'clock' },
          ]} active={bottomTab} onChange={(id) => { setBottomTab(id); setBottomOpen(true) }} />
          <button className="ar-icon-btn" onClick={() => setBottomOpen(false)} aria-label="Close panel"><Icon name="close" size={13} /></button>
        </div>
        {bottomOpen && (
          <div className="ar-bottom__body">
            {bottomTab === 'terminal' && <pre>{terminalLines.join('\n')}</pre>}
            {bottomTab === 'tests' && <div className="ar-bottom-tests"><TestPanel compact /></div>}
            {bottomTab === 'logs' && <pre>{['12:04:11  request GET /api/u-1/notes  200', '12:04:12  request POST /api/vote/n1  200', '12:04:13  warning duplicate vote read detected', '12:04:14  evaluator heartbeat ok'].join('\n')}</pre>}
            {bottomTab === 'problems' && (
              <div className="ar-problems">
                {testResults.filter((result) => result.status === 'fail').map((result) => (
                  <div key={result.name}><Icon name="warning" size={13} /><strong>{result.name}</strong><span>{result.detail}</span></div>
                ))}
              </div>
            )}
            {bottomTab === 'status' && (
              <div className="ar-submit-status"><Icon name="check" size={18} /><div><strong>No active submission</strong><span>Submit a repair to queue it for evaluation. Results stay hidden until release.</span></div></div>
            )}
          </div>
        )}
      </section>

      {submitOpen && (
        <Modal eyebrow={`Level ${level} / ${repo.name}`} title="Submit repair" onClose={() => setSubmitOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setSubmitOpen(false)}>Cancel</Button><Button variant="primary" icon="send" onClick={submit}>Queue evaluation</Button></>}>
          <div className="ar-submit-modal">
            <p>The evaluator runs against the saved workspace state. Feedback stays hidden until release.</p>
            <Field label="Repair summary" required htmlFor="repair-summary" hint="Describe what changed and why">
              <textarea id="repair-summary" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Fixed the accumulator and restored atomic vote increments" />
            </Field>
            <div className="ar-submit-modal__files">
              <span>Changed files in this session</span>
              {Object.keys(drafts).filter((path) => drafts[path] !== repo.files.find((file) => file.path === path)?.content).slice(0, 6).map((path) => <code key={path}>{path}</code>)}
              {Object.keys(drafts).every((path) => drafts[path] === repo.files.find((file) => file.path === path)?.content) && <em>No changes yet</em>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TaskPanel({ level, questions }: { level: number; questions: ReturnType<typeof useArena>['questions'] }) {
  const sample = level !== 4
  return (
    <div className="ar-task-panel">
      {level === 4 && (
        <div className="ar-final-note"><Icon name="lock" size={15} /><div><strong>Final challenge rules</strong><p>This is a new repository. Work independently. AI assistance and AI controls are not available.</p></div></div>
      )}
      {sample && <div className="ar-sample-note"><Icon name="warning" size={13} /> Sample tasks for demonstration. Real tasks are set by admins.</div>}
      <div className="ar-task-progress"><span>Task progress</span><strong>{questions.filter((question) => question.status === 'answered').length} / {questions.length} answered</strong></div>
      {questions.map((question) => (
        <div key={question.id} className="ar-task-card">
          <div className="ar-task-card__head"><span className="ar-mono">{question.id}</span><StatusChip status={question.status} /></div>
          <strong>{question.title}</strong>
          <p>{question.prompt}</p>
          <div className="ar-task-card__foot"><span><Icon name="file" size={12} />{question.targetHint}</span><span>{question.points} pts</span></div>
        </div>
      ))}
      {!questions.length && <p className="ar-muted">Tasks for this level are not available yet.</p>}
    </div>
  )
}

function TestPanel({ compact = false }: { compact?: boolean }) {
  const { testResults } = useArena()
  const passed = testResults.filter((result) => result.status === 'pass').length
  return (
    <div className="ar-tests">
      <div className="ar-tests__summary"><strong>{passed} passed</strong><span>{testResults.length - passed} failed</span><small>Mock evaluation</small></div>
      {!compact && <pre>{'> python -m pytest -q'}</pre>}
      <div className="ar-tests__list">
        {testResults.map((result) => (
          <div key={result.name} className={`ar-tests__row is-${result.status}`}>
            <Icon name={result.status === 'pass' ? 'check' : result.status === 'fail' ? 'close' : 'dash'} size={13} />
            <span>{result.name}</span><small>{result.detail}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
