import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { LEVEL_POLICY } from '../config'
import { useArena } from '../state/ArenaProvider'
import type { Issue } from '../types'
import { FileTree, ReadOnlyCode } from '../components/CodeBrowser'
import { Icon } from '../ui/Icons'
import { Button, Chip, Field, Modal, Panel, StatusChip, Tabs } from '../ui/primitives'

type FormKey = 'title' | 'path' | 'line' | 'lineEnd' | 'category' | 'severity' | 'description' | 'reasoning' | 'expected' | 'actual'
type FormState = Record<FormKey, string>
type Errors = Partial<Record<FormKey, string>>

const emptyForm: FormState = {
  title: '', path: '', line: '', lineEnd: '', category: 'Logic', severity: 'Medium',
  description: '', reasoning: '', expected: '', actual: '',
}

const categories = ['Logic', 'Security', 'Concurrency', 'Configuration', 'Error handling', 'Performance']
const severities = ['Low', 'Medium', 'High', 'Critical']

export default function IssueWorkspace({ level }: { level: number }) {
  const { repositories, issues, questions, submitIssue, pushToast, warnRestriction } = useArena()
  const location = useLocation()
  const repo = repositories.papyrus
  const policy = LEVEL_POLICY[level]
  const levelQuestions = questions.filter((question) => question.level === level)

  const [activePath, setActivePath] = useState(repo?.recentPaths[0] ?? '')
  const [reference, setReference] = useState<{ path: string; line: number } | null>(null)
  const [tab, setTab] = useState<'report' | 'history' | 'questions'>('report')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Errors>({})
  const [sending, setSending] = useState(false)
  const [detail, setDetail] = useState<Issue | null>(null)

  const file = useMemo(() => repo?.files.find((entry) => entry.path === activePath) ?? repo?.files[0], [repo, activePath])

  useEffect(() => {
    if (repo && !activePath) setActivePath(repo.recentPaths[0] ?? repo.files[0]?.path ?? '')
  }, [repo, activePath])

  useEffect(() => {
    const incoming = location.state as { path?: string; line?: number } | null
    if (!incoming?.path || !incoming.line) return
    setActivePath(incoming.path)
    setReference({ path: incoming.path, line: incoming.line })
    setForm((prev) => ({ ...prev, path: incoming.path!, line: String(incoming.line) }))
    setTab('report')
  }, [location.state])

  if (!repo || !file) return <div className="ar-page"><p>Loading repository...</p></div>

  const set = (key: FormKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const selectLine = (line: number) => {
    setReference({ path: file.path, line })
    setForm((prev) => ({ ...prev, path: file.path, line: String(line), lineEnd: '' }))
    setErrors({})
    setTab('report')
    pushToast(`Referenced ${file.path}:${line}`)
  }

  const validate = (): Errors => {
    const next: Errors = {}
    if (form.title.trim().length < 6) next.title = 'Add a descriptive title, at least 6 characters.'
    if (!form.path.trim()) next.path = 'Select a file or enter a repository path.'
    if (!/^\d+$/.test(form.line.trim()) || Number(form.line) < 1) next.line = 'Enter a valid line number.'
    if (form.lineEnd && (!/^\d+$/.test(form.lineEnd) || Number(form.lineEnd) < Number(form.line))) next.lineEnd = 'End line must be at least the start line.'
    if (form.description.trim().length < 12) next.description = 'Describe the issue in at least 12 characters.'
    if (form.reasoning.trim().length < 12) next.reasoning = 'Explain why the code is faulty.'
    if (form.expected.trim().length < 6) next.expected = 'State the expected behaviour.'
    if (form.actual.trim().length < 6) next.actual = 'State what actually happens.'
    return next
  }

  const submit = async () => {
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      pushToast('Fix the highlighted fields before submitting', 'warn')
      return
    }
    setSending(true)
    const result = await submitIssue({
      ...form,
      line: Number(form.line),
      lineEnd: form.lineEnd ? Number(form.lineEnd) : undefined,
      level,
    })
    setSending(false)
    if (result.ok) {
      pushToast(`${result.id} queued for review`, 'ok')
      setForm(emptyForm)
      setReference(null)
      setTab('history')
    } else {
      pushToast(result.message, 'danger')
    }
  }

  const tabs = [
    { id: 'report' as const, label: 'Report issue', icon: 'plus' as const },
    { id: 'history' as const, label: `Submitted (${issues.length})`, icon: 'inbox' as const },
    ...(level === 2 ? [{ id: 'questions' as const, label: 'Questions', icon: 'questions' as const }] : []),
  ]

  return (
    <div className="ar-page ar-page--wide">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Level {String(level).padStart(2, '0')} / {level === 1 ? 'Reconnaissance' : 'Deep Inspection'}</div>
          <h1>{level === 1 ? 'Issue flagging workspace' : 'Advanced issue identification'}</h1>
          <p>Inspect the code, select a line, then file a report with evidence. No AI assistance at this level.</p>
        </div>
        <div className="ar-head-chips">
          <Chip tone="neutral"><Icon name="shield" size={12} /> {policy.label}</Chip>
          <Chip tone="warn">No AI</Chip>
        </div>
      </header>

      <div className="ar-issue-layout">
        <section className="ar-issue-left">
          <Panel eyebrow="Assigned repository" title={repo.name} action={<Chip tone="info">{repo.branch}</Chip>}>
            <div className="ar-explorer-split">
              <FileTree tree={repo.tree} activePath={file.path} onOpen={setActivePath} />
              <ReadOnlyCode file={file} selectedLine={reference?.path === file.path ? reference.line : null} onSelectLine={selectLine} />
            </div>
            <div className="ar-explorer-hint"><Icon name="target" size={13} /> Click a line number to attach that location to your report.</div>
          </Panel>
        </section>

        <section className="ar-issue-right">
          <div className="ar-panel">
            <Tabs tabs={tabs} active={tab} onChange={setTab} />
            <div className="ar-panel__body">
              {tab === 'report' && (
                <div className="ar-report-form">
                  {reference && (
                    <div className="ar-reference">
                      <Icon name="code" size={14} />
                      <span>Referencing <strong>{reference.path}:{reference.line}</strong></span>
                      <button onClick={() => { setReference(null); set('path', ''); set('line', '') }} aria-label="Clear reference"><Icon name="close" size={12} /></button>
                    </div>
                  )}
                  <Field label="Issue title" required error={errors.title} htmlFor="issue-title">
                    <input id="issue-title" value={form.title} onChange={(event) => set('title', event.target.value)} placeholder="Short, specific summary" />
                  </Field>
                  <div className="ar-form-row">
                    <Field label="Repository file path" required error={errors.path} htmlFor="issue-path">
                      <input id="issue-path" className="ar-mono" value={form.path} onChange={(event) => set('path', event.target.value)} placeholder="server/routes/notes.js" />
                    </Field>
                    <Field label="Line" required error={errors.line} htmlFor="issue-line">
                      <input id="issue-line" className="ar-mono" value={form.line} onChange={(event) => set('line', event.target.value)} placeholder="17" inputMode="numeric" />
                    </Field>
                    <Field label="Line range" hint="Optional" error={errors.lineEnd} htmlFor="issue-line-end">
                      <input id="issue-line-end" className="ar-mono" value={form.lineEnd} onChange={(event) => set('lineEnd', event.target.value)} placeholder="22" inputMode="numeric" />
                    </Field>
                  </div>
                  <div className="ar-form-row">
                    <Field label="Category" htmlFor="issue-category">
                      <select id="issue-category" value={form.category} onChange={(event) => set('category', event.target.value)}>
                        {categories.map((category) => <option key={category}>{category}</option>)}
                      </select>
                    </Field>
                    <Field label="Severity" htmlFor="issue-severity">
                      <select id="issue-severity" value={form.severity} onChange={(event) => set('severity', event.target.value)}>
                        {severities.map((severity) => <option key={severity}>{severity}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Description" required error={errors.description} htmlFor="issue-description">
                    <textarea id="issue-description" rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="What does this code do?" />
                  </Field>
                  <Field label="Why this is a bug" required error={errors.reasoning} htmlFor="issue-reasoning">
                    <textarea id="issue-reasoning" rows={3} value={form.reasoning} onChange={(event) => set('reasoning', event.target.value)} placeholder="Explain the faulty reasoning or assumption" />
                  </Field>
                  <div className="ar-form-row">
                    <Field label="Expected behaviour" required error={errors.expected} htmlFor="issue-expected">
                      <textarea id="issue-expected" rows={2} value={form.expected} onChange={(event) => set('expected', event.target.value)} placeholder="What should happen" />
                    </Field>
                    <Field label="Actual behaviour" required error={errors.actual} htmlFor="issue-actual">
                      <textarea id="issue-actual" rows={2} value={form.actual} onChange={(event) => set('actual', event.target.value)} placeholder="What happens instead" />
                    </Field>
                  </div>
                  <div className="ar-form-actions">
                    <Button variant="ghost" onClick={() => { setForm(emptyForm); setErrors({}); setReference(null) }}>Clear</Button>
                    <Button variant="primary" icon="send" disabled={sending} onClick={submit}>
                      {sending ? 'Submitting...' : 'Submit report'}
                    </Button>
                  </div>
                </div>
              )}

              {tab === 'history' && (
                <div className="ar-issue-history">
                  <div className="ar-list-head"><span>Issue</span><span>File and line</span><span>Status</span><span>Points</span></div>
                  {issues.map((issue) => (
                    <button key={issue.id} className="ar-issue-row" onClick={() => setDetail(issue)}>
                      <span><strong>{issue.title}</strong><small>{issue.id} · {issue.submittedAt}</small></span>
                      <span className="ar-mono">{issue.path}:{issue.line}</span>
                      <StatusChip status={issue.status} />
                      <span className={issue.points ? 'is-ok-text' : 'ar-muted'}>{issue.points ? `+${issue.points}` : '-'}</span>
                    </button>
                  ))}
                </div>
              )}

              {tab === 'questions' && (
                <div className="ar-question-list">
                  <div className="ar-sample-note"><Icon name="warning" size={13} /> Sample questions for interface demonstration. Real prompts are supplied by admins.</div>
                  {levelQuestions.map((question) => (
                    <div key={question.id} className="ar-question-card">
                      <div className="ar-question-card__head"><strong>{question.title}</strong><Chip tone={question.status === 'answered' ? 'ok' : question.status === 'under-review' ? 'warn' : 'info'}>{question.status.replace('-', ' ')}</Chip></div>
                      <p>{question.prompt}</p>
                      <div className="ar-question-card__foot"><span>Requirement: {question.requirement}</span><strong>{question.points} pts</strong></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="ar-restriction-footer" onClick={() => warnRestriction('Browser developer tools')}>
        <Icon name="shield" size={13} />
        <span>Restricted shortcuts: Ctrl+C, Ctrl+V, Ctrl+Shift+I. Frontend feedback only, enforcement belongs to the competition environment.</span>
        <Icon name="chevron-right" size={12} />
      </div>

      {detail && (
        <Modal eyebrow={detail.id} title={detail.title} onClose={() => setDetail(null)}
          footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
          <div className="ar-issue-detail">
            <div className="ar-issue-detail__meta">
              <span><small>Location</small><strong className="ar-mono">{detail.path}:{detail.line}{detail.lineEnd ? `-${detail.lineEnd}` : ''}</strong></span>
              <span><small>Category</small><strong>{detail.category}</strong></span>
              <span><small>Severity</small><strong>{detail.severity}</strong></span>
              <span><small>Status</small><StatusChip status={detail.status} /></span>
              <span><small>Points</small><strong>{detail.points || '-'}</strong></span>
              <span><small>Submitted</small><strong>{detail.submittedAt}</strong></span>
            </div>
            <h3>Description</h3><p>{detail.description}</p>
            <h3>Why this is a bug</h3><p>{detail.reasoning}</p>
            <div className="ar-issue-detail__pair">
              <div><h3>Expected</h3><p>{detail.expected}</p></div>
              <div><h3>Actual</h3><p>{detail.actual}</p></div>
            </div>
            {detail.feedback && <div className="ar-feedback"><Icon name="chat" size={14} /><div><strong>Reviewer feedback</strong><p>{detail.feedback}</p></div></div>}
          </div>
        </Modal>
      )}
    </div>
  )
}
