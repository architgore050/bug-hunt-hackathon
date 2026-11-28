import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Panel, Button, Field, Chip, EmptyState, StatusChip } from '../../ui/components'
import { fmtDateTime } from '../../lib/format'
import { useAdmin } from '../../admin/store'
import { Modal, ConfirmDialog, useToast } from '../../admin/ui'
import { PlusIcon } from '../../admin/icons'
import type { Criterion, Difficulty, Evaluation, Question, QuestionStatus, Repository, RepositoryStatus, Round, RoundStatus } from '../../admin/types'

export default function Evaluations() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'rounds' | 'evaluations' | 'questions' | 'repositories'>(
    params.get('newEval') === '1' ? 'evaluations' : params.get('newQuestion') === '1' ? 'questions' : params.get('assignRepo') === '1' ? 'repositories' : 'evaluations',
  )
  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">COMPETITION</span>
          <h1 className="display admin-page-title">Evaluations</h1>
          <p className="muted small" style={{ marginTop: 6 }}>Rounds, evaluations, questions and repositories. Drafts are distinct from published/live. Sample local store.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(['rounds', 'evaluations', 'questions', 'repositories'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'rounds' && <RoundsTab />}
      {tab === 'evaluations' && <EvaluationsTab autoNew={params.get('newEval') === '1'} />}
      {tab === 'questions' && <QuestionsTab autoNew={params.get('newQuestion') === '1'} />}
      {tab === 'repositories' && <RepositoriesTab autoNew={params.get('assignRepo') === '1'} />}
    </div>
  )
}

/* ---------------- rounds ---------------- */

function RoundsTab() {
  const { state, addRound, updateRound, removeRound, setCurrentRound } = useAdmin()
  const toast = useToast()
  const [editing, setEditing] = useState<Round | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Round | null>(null)
  const rounds = [...state.rounds].sort((a, b) => a.order - b.order)

  return (
    <Panel title="Rounds" actions={<Button size="sm" onClick={() => setAdding(true)}><PlusIcon size={14} /> New round</Button>}>
      {rounds.length === 0 ? <EmptyState title="No rounds" note="Create a round to attach evaluations and questions." /> : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Rounds</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Name</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Active</th><th scope="col">Current</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{r.order}</td>
                  <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="muted small">{r.description}</div></td>
                  <td className="mono small">{r.durationMinutes} min</td>
                  <td><StatusChip value={r.status} /></td>
                  <td><Button size="sm" onClick={() => updateRound(r.id, { active: !r.active })}>{r.active ? 'active' : 'inactive'}</Button></td>
                  <td>{state.event.currentRoundId === r.id ? <Chip tone="signal">current</Chip> : <Button size="sm" onClick={() => setCurrentRound(r.id)}>Set current</Button>}</td>
                  <td><span style={{ display: 'inline-flex', gap: 6 }}>
                    <Button size="sm" onClick={() => setEditing(r)}>Edit</Button>
                    <Button size="sm" onClick={() => updateRound(r.id, { status: r.status === 'active' ? 'draft' : 'active' })}>{r.status === 'active' ? 'Deactivate' : 'Activate'}</Button>
                    <Button size="sm" variant="danger" onClick={() => setRemoving(r)}>Remove</Button>
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(adding || editing) && (
        <RoundForm
          initial={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSubmit={(data) => {
            if (editing) { updateRound(editing.id, data); toast.push({ kind: 'success', title: 'Round updated' }) }
            else { addRound(data); toast.push({ kind: 'success', title: 'Round created' }) }
            setAdding(false); setEditing(null)
          }}
        />
      )}
      {removing && <ConfirmDialog title="Remove round" danger confirmLabel="Remove" message={`Remove ${removing.name}? Evaluations stay but are unlinked from this round.`} onCancel={() => setRemoving(null)} onConfirm={() => { removeRound(removing.id); toast.push({ kind: 'warning', title: 'Round removed' }); setRemoving(null) }} />}
    </Panel>
  )
}

function RoundForm({ initial, onClose, onSubmit }: { initial?: Round; onClose: () => void; onSubmit: (data: Partial<Round> & { name: string }) => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', durationMinutes: String(initial?.durationMinutes ?? 60), instructions: initial?.instructions ?? '', status: initial?.status ?? 'draft', active: initial?.active ?? true, order: String(initial?.order ?? 1) })
  return (
    <Modal title={initial ? 'Edit round' : 'New round'} onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Save' : 'Create'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="stack" style={{ gap: 12 }}>
        <Field label="Name" htmlFor="r-name" required><input id="r-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Description" htmlFor="r-desc"><textarea id="r-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid-split">
          <Field label="Duration (minutes)" htmlFor="r-dur"><input id="r-dur" className="input mono" type="number" min={1} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></Field>
          <Field label="Order" htmlFor="r-order"><input id="r-order" className="input mono" type="number" min={1} value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} /></Field>
        </div>
        <Field label="Round-specific instructions" htmlFor="r-inst"><textarea id="r-inst" className="textarea" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
        <div className="grid-split">
          <Field label="Status" htmlFor="r-status"><div className="select-wrap"><select id="r-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RoundStatus })}>{(['draft', 'active', 'completed'] as const).map((s) => <option key={s} value={s}>{s}</option>)}</select></div></Field>
          <label className="checkbox-row" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /><span>Active</span></label>
        </div>
      </form>
    </Modal>
  )
  function submit() { onSubmit({ name: form.name.trim(), description: form.description, durationMinutes: Number(form.durationMinutes) || 60, instructions: form.instructions, status: form.status, active: form.active, order: Number(form.order) || 1 }) }
}

/* ---------------- evaluations ---------------- */

function EvaluationsTab({ autoNew }: { autoNew: boolean }) {
  const { state, addEvaluation, updateEvaluation, removeEvaluation, setEvaluationStatus, attachQuestion, detachQuestion, reorderQuestion } = useAdmin()
  const toast = useToast()
  const [editing, setEditing] = useState<Evaluation | null>(null)
  const [adding, setAdding] = useState(autoNew)
  const [removing, setRemoving] = useState<Evaluation | null>(null)
  const [preview, setPreview] = useState<Evaluation | null>(null)


  return (
    <Panel title="Evaluations" actions={<Button size="sm" onClick={() => setAdding(true)}><PlusIcon size={14} /> New evaluation</Button>}>
      {state.evaluations.length === 0 ? <EmptyState title="No evaluations" note="Create an evaluation and link questions." /> : (
        <div className="stack" style={{ gap: 12 }}>
          {state.evaluations.map((ev) => {
            const questions = ev.questionIds.map((id) => state.questions.find((q) => q.id === id)).filter(Boolean) as Question[]
            return (
              <div key={ev.id} className="panel-2" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span><span style={{ fontWeight: 600 }}>{ev.title}</span> <Chip tone={ev.status === 'published' ? 'ok' : 'muted'}>{ev.status}</Chip></span>
                  <span className="muted small mono">max {ev.maxScore} {'·'} bonus {ev.bonusPoints} {'·'} {fmtDateTime(ev.updatedAt)}</span>
                </div>
                <p className="muted small" style={{ margin: '6px 0' }}>{ev.description}</p>
                <div className="small muted">Round: {state.rounds.find((r) => r.id === ev.roundId)?.name ?? 'unassigned'} {'·'} Repo: {state.repositories.find((r) => r.id === ev.repositoryId)?.name ?? 'none'} {'·'} Questions: {questions.length}</div>
                <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <Button size="sm" onClick={() => setEditing(ev)}>Edit</Button>
                  <Button size="sm" onClick={() => setPreview(ev)}>Preview</Button>
                  <Button size="sm" onClick={() => { setEvaluationStatus(ev.id, ev.status === 'published' ? 'draft' : 'published'); toast.push({ kind: 'info', title: ev.status === 'published' ? 'Moved to draft' : 'Published' }) }}>{ev.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
                  <Button size="sm" variant="danger" onClick={() => setRemoving(ev)}>Remove</Button>
                </div>

                <div style={{ marginTop: 12 }}>
                  <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Questions ({questions.length})</span>
                  {questions.length === 0 ? <p className="muted small">No questions linked.</p> : (
                    <div className="ruled">
                      {questions.map((q, i) => (
                        <div key={q.id} className="kv-row" style={{ alignItems: 'center' }}>
                          <span className="small"><span className="mono muted">{i + 1}</span> {q.title} <span className="muted small mono">{q.maxPoints} pts {'·'} {q.difficulty}</span></span>
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <Button size="sm" ariaLabel="Move up" disabled={i === 0} onClick={() => reorderQuestion(ev.id, q.id, -1)}>^</Button>
                            <Button size="sm" ariaLabel="Move down" disabled={i === questions.length - 1} onClick={() => reorderQuestion(ev.id, q.id, 1)}>v</Button>
                            <Button size="sm" onClick={() => detachQuestion(ev.id, q.id)}>Remove</Button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <AddQuestionToEval evalId={ev.id} existing={ev.questionIds} questions={state.questions} onAttach={attachQuestion} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(adding || editing) && (
        <EvaluationForm
          state={state}
          initial={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSubmit={(data) => { if (editing) { updateEvaluation(editing.id, data); toast.push({ kind: 'success', title: 'Evaluation updated' }) } else { addEvaluation(data); toast.push({ kind: 'success', title: 'Evaluation created' }) } setAdding(false); setEditing(null) }}
        />
      )}
      {removing && <ConfirmDialog title="Remove evaluation" danger confirmLabel="Remove" message={`Remove ${removing.title}?`} onCancel={() => setRemoving(null)} onConfirm={() => { removeEvaluation(removing.id); toast.push({ kind: 'warning', title: 'Evaluation removed' }); setRemoving(null) }} />}
      {preview && <EvaluationPreview ev={preview} state={state} onClose={() => setPreview(null)} />}
    </Panel>
  )
}

function AddQuestionToEval({ evalId, existing, questions, onAttach }: { evalId: string; existing: string[]; questions: Question[]; onAttach: (e: string, q: string) => void }) {
  const [qid, setQid] = useState('')
  const available = questions.filter((q) => !existing.includes(q.id))
  if (available.length === 0) return null
  return (
    <div style={{ display: 'inline-flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <div className="select-wrap" style={{ width: 240 }}>
        <select className="select" aria-label="Add question" value={qid} onChange={(e) => setQid(e.target.value)}>
          <option value="">Add a question...</option>
          {available.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
        </select>
      </div>
      <Button size="sm" disabled={!qid} onClick={() => { if (qid) { onAttach(evalId, qid); setQid('') } }}>Attach</Button>
    </div>
  )
}

function EvaluationForm({ state, initial, onClose, onSubmit }: { state: ReturnType<typeof useAdmin>['state']; initial?: Evaluation; onClose: () => void; onSubmit: (data: Partial<Evaluation> & { title: string }) => void }) {
  const [form, setForm] = useState({ title: initial?.title ?? '', description: initial?.description ?? '', instructions: initial?.instructions ?? '', roundId: initial?.roundId ?? '', repositoryId: initial?.repositoryId ?? '', maxScore: String(initial?.maxScore ?? 0), bonusPoints: String(initial?.bonusPoints ?? 0), status: initial?.status ?? 'draft' })
  const [criteria, setCriteria] = useState<Criterion[]>(initial?.criteria ?? [])
  return (
    <Modal title={initial ? 'Edit evaluation' : 'New evaluation'} onClose={onClose} wide actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Save' : 'Create'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="stack" style={{ gap: 12 }}>
        <Field label="Title" htmlFor="ev-title" required><input id="ev-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
        <Field label="Description" htmlFor="ev-desc"><textarea id="ev-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Instructions" htmlFor="ev-inst"><textarea id="ev-inst" className="textarea" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
        <div className="grid-split">
          <Field label="Round" htmlFor="ev-round"><div className="select-wrap"><select id="ev-round" className="select" value={form.roundId} onChange={(e) => setForm({ ...form, roundId: e.target.value })}><option value="">Unassigned</option>{state.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></Field>
          <Field label="Repository" htmlFor="ev-repo"><div className="select-wrap"><select id="ev-repo" className="select" value={form.repositoryId} onChange={(e) => setForm({ ...form, repositoryId: e.target.value })}><option value="">None</option>{state.repositories.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></Field>
        </div>
        <div className="grid-split">
          <Field label="Maximum score" htmlFor="ev-max"><input id="ev-max" className="input mono" type="number" min={0} value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} /></Field>
          <Field label="Bonus points" htmlFor="ev-bonus"><input id="ev-bonus" className="input mono" type="number" min={0} value={form.bonusPoints} onChange={(e) => setForm({ ...form, bonusPoints: e.target.value })} /></Field>
        </div>
        <div>
          <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Scoring criteria</span>
          {criteria.map((c, i) => (
            <div key={c.id} className="grid-split" style={{ marginBottom: 8, alignItems: 'end' }}>
              <Field label="Criterion" htmlFor={`c-name-${i}`}><input id={`c-name-${i}`} className="input" value={c.name} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
              <Field label="Max points" htmlFor={`c-pts-${i}`}><input id={`c-pts-${i}`} className="input mono" type="number" min={0} value={c.maxPoints} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, maxPoints: Number(e.target.value) } : x)))} /></Field>
              <Button size="sm" variant="danger" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setCriteria([...criteria, { id: `c-${Date.now()}`, name: '', description: '', maxPoints: 1 }])}><PlusIcon size={13} /> Add criterion</Button>
        </div>
        <Field label="Status" htmlFor="ev-status"><div className="select-wrap"><select id="ev-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Evaluation['status'] })}>{(['draft', 'published'] as const).map((s) => <option key={s} value={s}>{s}</option>)}</select></div></Field>
      </form>
    </Modal>
  )
  function submit() {
    onSubmit({ title: form.title.trim(), description: form.description, instructions: form.instructions, roundId: form.roundId || null, repositoryId: form.repositoryId || null, maxScore: Number(form.maxScore) || 0, bonusPoints: Number(form.bonusPoints) || 0, criteria: criteria.filter((c) => c.name.trim()), status: form.status })
  }
}

function EvaluationPreview({ ev, state, onClose }: { ev: Evaluation; state: ReturnType<typeof useAdmin>['state']; onClose: () => void }) {
  const questions = ev.questionIds.map((id) => state.questions.find((q) => q.id === id)).filter(Boolean) as Question[]
  return (
    <Modal title={`Preview: ${ev.title}`} onClose={onClose} wide actions={<Button onClick={onClose}>Close</Button>}>
      <span className={`chip ${ev.status === 'published' ? 'chip-tone-ok' : 'chip-tone-muted'}`}>{ev.status}</span>
      <p style={{ marginTop: 10 }}>{ev.description}</p>
      {ev.instructions && <p className="muted small">{ev.instructions}</p>}
      <span className="overline" style={{ display: 'block', margin: '10px 0 6px' }}>Criteria</span>
      {ev.criteria.length === 0 ? <p className="muted small">No criteria.</p> : ev.criteria.map((c) => <div key={c.id} className="kv-row"><span>{c.name}</span><span className="kv-val">{c.maxPoints}</span></div>)}
      <span className="overline" style={{ display: 'block', margin: '10px 0 6px' }}>Questions</span>
      {questions.length === 0 ? <p className="muted small">No questions.</p> : questions.map((q, i) => <div key={q.id} className="kv-row"><span><span className="mono muted">{i + 1}</span> {q.title}</span><span className="kv-val">{q.maxPoints}</span></div>)}
      <p className="muted small" style={{ marginTop: 10 }}>Maximum {ev.maxScore} {'·'} bonus {ev.bonusPoints} {'·'} repo {state.repositories.find((r) => r.id === ev.repositoryId)?.name ?? 'none'}</p>
    </Modal>
  )
}

/* ---------------- questions ---------------- */

function QuestionsTab({ autoNew }: { autoNew: boolean }) {
  const { state, addQuestion, updateQuestion, removeQuestion } = useAdmin()
  const toast = useToast()
  const [editing, setEditing] = useState<Question | null>(null)
  const [adding, setAdding] = useState(autoNew)
  const [removing, setRemoving] = useState<Question | null>(null)
  const [roundFilter, setRoundFilter] = useState('')
  const questions = state.questions.filter((q) => !roundFilter || q.roundId === roundFilter)


  return (
    <Panel title="Questions" actions={<Button size="sm" onClick={() => setAdding(true)}><PlusIcon size={14} /> New question</Button>}>
      <div className="admin-toolbar">
        <div className="select-wrap"><select className="select" aria-label="Filter by round" value={roundFilter} onChange={(e) => setRoundFilter(e.target.value)}><option value="">All rounds</option>{state.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      </div>
      {questions.length === 0 ? <EmptyState title="No questions" note="Questions are managed independently and linked to a round or evaluation." /> : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Questions</caption>
            <thead><tr><th scope="col">Title</th><th scope="col">Max points</th><th scope="col">Difficulty</th><th scope="col">Status</th><th scope="col">Round</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id}>
                  <td><div style={{ fontWeight: 600 }}>{q.title}</div><div className="muted small">{q.expectedTask || q.description}</div></td>
                  <td className="mono small num">{q.maxPoints}</td>
                  <td><Chip tone={q.difficulty === 'hard' ? 'danger' : q.difficulty === 'medium' ? 'warn' : 'ok'}>{q.difficulty}</Chip></td>
                  <td><StatusChip value={q.status} /></td>
                  <td className="small">{state.rounds.find((r) => r.id === q.roundId)?.name ?? '-'}</td>
                  <td><span style={{ display: 'inline-flex', gap: 6 }}><Button size="sm" onClick={() => setEditing(q)}>Edit</Button><Button size="sm" onClick={() => updateQuestion(q.id, { status: q.status === 'published' ? 'draft' : 'published' })}>{q.status === 'published' ? 'Unpublish' : 'Publish'}</Button><Button size="sm" variant="danger" onClick={() => setRemoving(q)}>Remove</Button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(adding || editing) && (
        <QuestionForm
          state={state}
          initial={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSubmit={(data) => { if (editing) { updateQuestion(editing.id, data); toast.push({ kind: 'success', title: 'Question updated' }) } else { addQuestion(data); toast.push({ kind: 'success', title: 'Question created' }) } setAdding(false); setEditing(null) }}
        />
      )}
      {removing && <ConfirmDialog title="Remove question" danger confirmLabel="Remove" message={`Remove ${removing.title}? It will be detached from any evaluation.`} onCancel={() => setRemoving(null)} onConfirm={() => { removeQuestion(removing.id); toast.push({ kind: 'warning', title: 'Question removed' }); setRemoving(null) }} />}
    </Panel>
  )
}

function QuestionForm({ state, initial, onClose, onSubmit }: { state: ReturnType<typeof useAdmin>['state']; initial?: Question; onClose: () => void; onSubmit: (data: Partial<Question> & { title: string }) => void }) {
  const [form, setForm] = useState({ title: initial?.title ?? '', description: initial?.description ?? '', instructions: initial?.instructions ?? '', expectedTask: initial?.expectedTask ?? '', scoringCriteria: initial?.scoringCriteria ?? '', maxPoints: String(initial?.maxPoints ?? 1), difficulty: initial?.difficulty ?? 'medium', status: initial?.status ?? 'draft', roundId: initial?.roundId ?? '' })
  return (
    <Modal title={initial ? 'Edit question' : 'New question'} onClose={onClose} wide actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Save' : 'Create'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="stack" style={{ gap: 12 }}>
        <Field label="Title" htmlFor="q-title" required><input id="q-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
        <Field label="Description" htmlFor="q-desc"><textarea id="q-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Instructions" htmlFor="q-inst"><textarea id="q-inst" className="textarea" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
        <Field label="Expected task" htmlFor="q-task"><textarea id="q-task" className="textarea" value={form.expectedTask} onChange={(e) => setForm({ ...form, expectedTask: e.target.value })} /></Field>
        <Field label="Scoring criteria" htmlFor="q-scoring"><textarea id="q-scoring" className="textarea" value={form.scoringCriteria} onChange={(e) => setForm({ ...form, scoringCriteria: e.target.value })} /></Field>
        <div className="grid-split">
          <Field label="Maximum points" htmlFor="q-max"><input id="q-max" className="input mono" type="number" min={0} value={form.maxPoints} onChange={(e) => setForm({ ...form, maxPoints: e.target.value })} /></Field>
          <Field label="Difficulty" htmlFor="q-diff"><div className="select-wrap"><select id="q-diff" className="select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>{(['easy', 'medium', 'hard'] as const).map((d) => <option key={d} value={d}>{d}</option>)}</select></div></Field>
        </div>
        <div className="grid-split">
          <Field label="Round" htmlFor="q-round"><div className="select-wrap"><select id="q-round" className="select" value={form.roundId} onChange={(e) => setForm({ ...form, roundId: e.target.value })}><option value="">Unassigned</option>{state.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></Field>
          <Field label="Status" htmlFor="q-status"><div className="select-wrap"><select id="q-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as QuestionStatus })}>{(['draft', 'published'] as const).map((s) => <option key={s} value={s}>{s}</option>)}</select></div></Field>
        </div>
      </form>
    </Modal>
  )
  function submit() { onSubmit({ title: form.title.trim(), description: form.description, instructions: form.instructions, expectedTask: form.expectedTask, scoringCriteria: form.scoringCriteria, maxPoints: Number(form.maxPoints) || 0, difficulty: form.difficulty, status: form.status, roundId: form.roundId || null }) }
}

/* ---------------- repositories ---------------- */

function RepositoriesTab({ autoNew }: { autoNew: boolean }) {
  const { state, addRepository, updateRepository, removeRepository } = useAdmin()
  const toast = useToast()
  const [editing, setEditing] = useState<Repository | null>(null)
  const [adding, setAdding] = useState(autoNew)
  const [removing, setRemoving] = useState<Repository | null>(null)


  return (
    <Panel title="Repositories and codebases" actions={<Button size="sm" onClick={() => setAdding(true)}><PlusIcon size={14} /> Add repository</Button>}>
      {state.repositories.length === 0 ? <EmptyState title="No repositories" note="Add a repository or codebase to assign to rounds and evaluations." /> : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Repositories</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Identifier</th><th scope="col">Round</th><th scope="col">Evaluation</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {state.repositories.map((r) => (
                <tr key={r.id}>
                  <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="muted small mono" style={{ wordBreak: 'break-all' }}>{r.url || 'no url'}</div></td>
                  <td className="mono small">{r.identifier}</td>
                  <td className="small">{state.rounds.find((x) => x.id === r.roundId)?.name ?? '-'}</td>
                  <td className="small">{state.evaluations.find((x) => x.id === r.evaluationId)?.title ?? '-'}</td>
                  <td><StatusChip value={r.status} /></td>
                  <td className="mono small">{fmtDateTime(r.lastUpdated)}</td>
                  <td><span style={{ display: 'inline-flex', gap: 6 }}><Button size="sm" onClick={() => setEditing(r)}>Edit</Button><Button size="sm" variant="danger" onClick={() => setRemoving(r)}>Remove</Button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(adding || editing) && (
        <RepositoryForm
          state={state}
          initial={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSubmit={(data) => { if (editing) { updateRepository(editing.id, data); toast.push({ kind: 'success', title: 'Repository updated' }) } else { addRepository(data); toast.push({ kind: 'success', title: 'Repository added' }) } setAdding(false); setEditing(null) }}
        />
      )}
      {removing && <ConfirmDialog title="Remove repository" danger confirmLabel="Remove" message={`Remove ${removing.name}? Evaluations referencing it will be unlinked.`} onCancel={() => setRemoving(null)} onConfirm={() => { removeRepository(removing.id); toast.push({ kind: 'warning', title: 'Repository removed' }); setRemoving(null) }} />}
    </Panel>
  )
}

function RepositoryForm({ state, initial, onClose, onSubmit }: { state: ReturnType<typeof useAdmin>['state']; initial?: Repository; onClose: () => void; onSubmit: (data: Partial<Repository> & { name: string }) => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', identifier: initial?.identifier ?? '', url: initial?.url ?? '', roundId: initial?.roundId ?? '', evaluationId: initial?.evaluationId ?? '', status: initial?.status ?? 'draft', configuration: initial?.configuration ?? '' })
  return (
    <Modal title={initial ? 'Edit repository' : 'Add repository'} onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Save' : 'Add'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="stack" style={{ gap: 12 }}>
        <Field label="Name" htmlFor="repo-name" required><input id="repo-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <div className="grid-split">
          <Field label="Identifier" htmlFor="repo-id"><input id="repo-id" className="input mono" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></Field>
          <Field label="URL" htmlFor="repo-url"><input id="repo-url" className="input mono" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
        </div>
        <div className="grid-split">
          <Field label="Assigned round" htmlFor="repo-round"><div className="select-wrap"><select id="repo-round" className="select" value={form.roundId} onChange={(e) => setForm({ ...form, roundId: e.target.value })}><option value="">Unassigned</option>{state.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></Field>
          <Field label="Assigned evaluation" htmlFor="repo-eval"><div className="select-wrap"><select id="repo-eval" className="select" value={form.evaluationId} onChange={(e) => setForm({ ...form, evaluationId: e.target.value })}><option value="">None</option>{state.evaluations.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></div></Field>
        </div>
        <Field label="Status" htmlFor="repo-status"><div className="select-wrap"><select id="repo-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RepositoryStatus })}>{(['draft', 'active', 'archived'] as const).map((s) => <option key={s} value={s}>{s}</option>)}</select></div></Field>
        <Field label="Configuration details" htmlFor="repo-config"><textarea id="repo-config" className="textarea" value={form.configuration} onChange={(e) => setForm({ ...form, configuration: e.target.value })} /></Field>
      </form>
    </Modal>
  )
  function submit() { onSubmit({ name: form.name.trim(), identifier: form.identifier, url: form.url, roundId: form.roundId || null, evaluationId: form.evaluationId || null, status: form.status, configuration: form.configuration }) }
}
