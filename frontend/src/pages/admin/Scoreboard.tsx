import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Panel, Button, Field, Chip, EmptyState } from '../../ui/components'
import { fmtDateTime, fmtPoints } from '../../lib/format'
import { useAdmin, penaltiesFor, manualPositiveFor, teamTotal } from '../../admin/store'
import { Modal, Pagination, ConfirmDialog, useToast } from '../../admin/ui'
import type { ScoreAdjustment } from '../../admin/types'
import type { ScoreCategory } from '../../admin/store'
import { participantsForTeam } from '../../admin/helpers'
import { useAuth } from '../../lib/auth'

const CATEGORIES: { value: ScoreCategory; label: string }[] = [
  { value: 'malpractice', label: 'Malpractice' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'scoring_error', label: 'Scoring error' },
  { value: 'evaluation_correction', label: 'Evaluation correction' },
  { value: 'administrative', label: 'Administrative decision' },
]

export default function Scoreboard() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'board' | 'adjustments'>('board')
  const { state } = useAdmin()
  const [adjustTeam, setAdjustTeam] = useState<string | null>(params.get('adjust') === '1' ? (state.teams[0]?.id ?? null) : null)

  const ranked = useMemo(() => {
    const active = state.teams.filter((t) => t.status !== 'disqualified')
    return [...active].sort((a, b) => teamTotal(b, state.adjustments) - teamTotal(a, state.adjustments))
  }, [state])

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">SCORING</span>
          <h1 className="display admin-page-title">Scoreboard</h1>
          <p className="muted small" style={{ marginTop: 6 }}>Functional repair is primary. CTF bonus is separate and never outweighs the main competition. Append-only audit trail. This preview uses a local sample store; on the connected platform scores are authoritative server-side and adjustments write to the append-only ledger.</p>
        </div>
        <Button variant="primary" onClick={() => setAdjustTeam(state.teams[0]?.id ?? null)}>Adjust team score</Button>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'board'} className={`tab ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>Live rankings</button>
        <button role="tab" aria-selected={tab === 'adjustments'} className={`tab ${tab === 'adjustments' ? 'active' : ''}`} onClick={() => setTab('adjustments')}>Adjustment history ({state.adjustments.length})</button>
      </div>

      {tab === 'board' && (
        <Panel title="Team rankings">
          {ranked.length === 0 ? <EmptyState title="No teams" note="Create teams to see rankings." /> : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Team rankings</caption>
                <thead><tr><th scope="col" className="num">Rank</th><th scope="col">Team</th><th scope="col">Members</th><th scope="col" className="num">Functional repair</th><th scope="col" className="num">Evaluation</th><th scope="col" className="num">CTF bonus</th><th scope="col" className="num">Penalties</th><th scope="col" className="num">Adjustments</th><th scope="col" className="num">Total</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {ranked.map((t, i) => {
                    const members = participantsForTeam(t.id, state.participants)
                    const penalties = penaltiesFor(t, state.adjustments)
                    const additional = manualPositiveFor(t.id, state.adjustments)
                    return (
                      <tr key={t.id}>
                        <td className="num mono" style={{ fontWeight: 600 }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{t.name}<div className="muted small">{t.status}</div></td>
                        <td className="small">{members.length}</td>
                        <td className="num mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--paper)' }}>{fmtPoints(t.functionalScore)}</td>
                        <td className="num mono">{fmtPoints(t.evaluationScore)}</td>
                        <td className="num mono" style={{ color: 'var(--signal)' }}>{fmtPoints(t.ctfBonus)}</td>
                        <td className="num mono" style={{ color: penalties > 0 ? 'var(--danger)' : 'var(--muted)' }}>-{fmtPoints(penalties)}</td>
                        <td className="num mono" style={{ color: additional !== 0 ? 'var(--warn)' : 'var(--muted)' }}>{additional > 0 ? '+' : ''}{fmtPoints(additional)}</td>
                        <td className="num mono" style={{ fontSize: 17, fontWeight: 700 }}>{fmtPoints(teamTotal(t, state.adjustments))}</td>
                        <td><Button size="sm" onClick={() => setAdjustTeam(t.id)}>Adjust</Button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>Total = functional + evaluation + CTF bonus - penalties + additional adjustments. Penalties include applied malpractice. Scores are never silently overwritten; every change appends an audit record.</p>
        </Panel>
      )}

      {tab === 'adjustments' && <AdjustmentHistory />}

      {adjustTeam && <AdjustScoreModal teamId={adjustTeam} onClose={() => { setAdjustTeam(null); setParams((p) => { p.delete('adjust'); return p }) }} />}
    </div>
  )
}

function AdjustScoreModal({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { state, applyAdjustment } = useAdmin()
  const { user } = useAuth()
  const toast = useToast()
  const [selected, setSelected] = useState(teamId)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState<ScoreCategory>('administrative')
  const [confirming, setConfirming] = useState(false)
  const [nowLabel] = useState(() => fmtDateTime(new Date().toISOString()))

  const team = state.teams.find((t) => t.id === selected)
  const current = team ? teamTotal(team, state.adjustments) : 0
  const amt = Number(amount)
  const valid = !!team && amount.trim() !== '' && !Number.isNaN(amt) && amt !== 0 && reason.trim().length > 0
  const updated = current + (Number.isNaN(amt) ? 0 : amt)
  const adminIdentity = user?.name || user?.email || 'admin'

  function apply() {
    if (!valid || !team) return
    applyAdjustment({ teamId: selected, amount: amt, reason: reason.trim(), category, adminIdentity })
    toast.push({ kind: 'warning', title: 'Score adjusted', body: `${team.name}: ${amt >= 0 ? '+' : ''}${amt}` })
    setConfirming(false)
    onClose()
  }

  return (
    <Modal title="Manual score adjustment" onClose={onClose} wide actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>Review change</Button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Team" htmlFor="adj-team" required>
          <div className="select-wrap"><select id="adj-team" className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>{state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        </Field>
        <div className="grid-split">
          <Field label="Adjustment amount" htmlFor="adj-amount" required hint="Positive adds, negative subtracts. Non-zero."><input id="adj-amount" className="input mono" type="number" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          <Field label="Category" htmlFor="adj-cat"><div className="select-wrap"><select id="adj-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as ScoreCategory)}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div></Field>
        </div>
        <Field label="Reason" htmlFor="adj-reason" required hint="Recorded permanently in the audit trail."><textarea id="adj-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
        <div className="panel-2" style={{ padding: 12 }}>
          <div className="kv-row"><span className="kv-key">Admin identity</span><span className="kv-val">{adminIdentity}</span></div>
          <div className="kv-row"><span className="kv-key">Timestamp</span><span className="kv-val">{nowLabel}</span></div>
          <div className="kv-row"><span className="kv-key">Previous score</span><span className="kv-val">{fmtPoints(current)}</span></div>
          <div className="kv-row"><span className="kv-key">Updated score</span><span className="kv-val" style={{ color: valid ? 'var(--signal)' : 'var(--muted)' }}>{fmtPoints(updated)}</span></div>
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Confirm score adjustment"
          danger={amt < 0}
          confirmLabel="Apply adjustment"
          message={`Apply ${amt >= 0 ? '+' : ''}${amt} to ${team?.name}? Previous ${fmtPoints(current)} -> updated ${fmtPoints(updated)}. This appends a permanent audit record and cannot be silently overwritten.`}
          onCancel={() => setConfirming(false)}
          onConfirm={apply}
        />
      )}
    </Modal>
  )
}

function AdjustmentHistory() {
  const { state } = useAdmin()
  const [teamFilter, setTeamFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const rows = useMemo(() => {
    let r = [...state.adjustments].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    if (teamFilter) r = r.filter((a) => a.teamId === teamFilter)
    if (categoryFilter) r = r.filter((a) => a.category === categoryFilter)
    return r
  }, [state.adjustments, teamFilter, categoryFilter])

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Panel title="Adjustment history" actions={<Chip tone="muted">append-only</Chip>}>
      <div className="admin-toolbar">
        <div className="select-wrap"><select className="select" aria-label="Filter by team" value={teamFilter} onChange={(e) => { setTeamFilter(e.target.value); setPage(1) }}><option value="">All teams</option>{state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="select-wrap"><select className="select" aria-label="Filter by category" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}<option value="malpractice_reversal">Malpractice reversal</option></select></div>
      </div>
      {pageRows.length === 0 ? <EmptyState title="No adjustments" note="Manual score changes and malpractice penalties appear here." /> : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Score adjustments</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Team</th><th scope="col" className="num">Amount</th><th scope="col">Category</th><th scope="col">Reason</th><th scope="col">Admin</th><th scope="col" className="num">Previous</th><th scope="col" className="num">Updated</th></tr></thead>
            <tbody>
              {pageRows.map((a: ScoreAdjustment) => (
                <tr key={a.id}>
                  <td className="mono small">{fmtDateTime(a.timestamp)}</td>
                  <td className="small">{a.teamName}</td>
                  <td className="num mono" style={{ color: a.amount < 0 ? 'var(--danger)' : 'var(--ok)' }}>{a.amount >= 0 ? '+' : ''}{fmtPoints(a.amount)}</td>
                  <td><Chip tone="muted">{a.category.replaceAll('_', ' ')}</Chip></td>
                  <td className="small">{a.reason}</td>
                  <td className="small mono">{a.adminIdentity}</td>
                  <td className="num mono">{fmtPoints(a.previousScore)}</td>
                  <td className="num mono">{fmtPoints(a.updatedScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
    </Panel>
  )
}
