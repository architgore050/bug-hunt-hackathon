import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Panel, Button, Field, EmptyState, StatusChip } from '../../ui/components'
import { fmtDateTime } from '../../lib/format'
import { useAdmin } from '../../admin/store'
import { Pagination, Modal, ConfirmDialog, SortHeader, useToast } from '../../admin/ui'
import { PlusIcon, UploadIcon } from '../../admin/icons'
import { participantsForTeam } from '../../admin/helpers'
import type { Participant, ParticipationStatus, RegistrationStatus, Team } from '../../admin/types'
import { CsvImportWizard } from '../../admin/CsvImportWizard'

type SortKey = 'name' | 'id' | 'email' | 'team' | 'registrationStatus' | 'participationStatus' | 'registeredAt'

export default function ParticipantsTeams() {
  const { state, updateParticipant, assignTeam, removeParticipant, setParticipantStatus, setRegistrationStatus, addParticipant, addTeam, removeTeam } = useAdmin()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'participants' | 'teams'>(params.get('tab') === 'teams' || params.get('newTeam') === '1' ? 'teams' : 'participants')

  const [query, setQuery] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [regFilter, setRegFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState<SortKey>('registeredAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [showCsv, setShowCsv] = useState(params.get('csv') === '1')
  const [showNewTeam, setShowNewTeam] = useState(params.get('newTeam') === '1')
  const [editing, setEditing] = useState<Participant | null>(null)
  const [viewing, setViewing] = useState<Participant | null>(null)
  const [removing, setRemoving] = useState<Participant | null>(null)
  const [newParticipant, setNewParticipant] = useState(false)

  const teamName = (id: string | null) => (id ? state.teams.find((t) => t.id === id)?.name ?? 'unassigned' : 'unassigned')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const teamById = new Map(state.teams.map((t) => [t.id, t.name]))
    const nameOf = (id: string | null) => (id ? teamById.get(id) ?? 'unassigned' : 'unassigned')
    let rows = state.participants.filter((p) => p.participationStatus !== 'removed')
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || nameOf(p.teamId).toLowerCase().includes(q))
    if (teamFilter) rows = rows.filter((p) => (teamFilter === 'none' ? p.teamId === null : p.teamId === teamFilter))
    if (statusFilter) rows = rows.filter((p) => p.participationStatus === statusFilter)
    if (regFilter) rows = rows.filter((p) => p.registrationStatus === regFilter)
    if (dateFrom) rows = rows.filter((p) => new Date(p.registeredAt).getTime() >= new Date(dateFrom).getTime())
    if (dateTo) rows = rows.filter((p) => new Date(p.registeredAt).getTime() <= new Date(dateTo + 'T23:59:59').getTime())
    const sorted = [...rows].sort((a, b) => {
      const keyVal = (p: Participant): string => {
        if (sort === 'team') return nameOf(p.teamId)
        if (sort === 'registeredAt') return p.registeredAt
        if (sort === 'name') return p.name
        if (sort === 'id') return p.id
        if (sort === 'email') return p.email
        if (sort === 'registrationStatus') return p.registrationStatus
        return p.participationStatus
      }
      const cmp = keyVal(a).localeCompare(keyVal(b))
      return dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [state.participants, state.teams, query, teamFilter, statusFilter, regFilter, dateFrom, dateTo, sort, dir])

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  function onSort(key: string) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key as SortKey); setDir('asc') }
    setPage(1)
  }

  const participantActivity = viewing ? state.activity.filter((a) => a.targetId === viewing.id || a.targetLabel.includes(viewing.name)) : []

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">PEOPLE</span>
          <h1 className="display admin-page-title">Participants & Teams</h1>
          <p className="muted small" style={{ marginTop: 6 }}>{state.participants.filter((p) => p.participationStatus !== 'removed').length} participants {'·'} {state.teams.length} teams. Sample local store; structured for API hookup.</p>
        </div>
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => setShowCsv(true)}><UploadIcon size={15} /> Import CSV</Button>
          <Button variant="primary" onClick={() => setNewParticipant(true)}><PlusIcon size={15} /> Add participant</Button>
        </span>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'participants'} className={`tab ${tab === 'participants' ? 'active' : ''}`} onClick={() => { setTab('participants'); setParams((p) => { p.set('tab', 'participants'); return p }) }}>Participants</button>
        <button role="tab" aria-selected={tab === 'teams'} className={`tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => { setTab('teams'); setParams((p) => { p.set('tab', 'teams'); return p }) }}>Teams</button>
      </div>

      {tab === 'participants' && (
        <Panel title="Participant directory">
          <div className="admin-toolbar">
            <input className="input admin-search" placeholder="Search name, email, ID, team" aria-label="Search participants" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
            <div className="select-wrap">
              <select className="select" aria-label="Filter by team" value={teamFilter} onChange={(e) => { setTeamFilter(e.target.value); setPage(1) }}>
                <option value="">All teams</option>
                <option value="none">Unassigned</option>
                {state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="select-wrap">
              <select className="select" aria-label="Filter by participation status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
                <option value="">Any status</option>
                {(['active', 'inactive', 'disabled'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="select-wrap">
              <select className="select" aria-label="Filter by registration status" value={regFilter} onChange={(e) => { setRegFilter(e.target.value); setPage(1) }}>
                <option value="">Any registration</option>
                {(['registered', 'pending', 'invited', 'waitlisted'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              From <input className="input" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} style={{ width: 'auto' }} />
            </label>
            <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              To <input className="input" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} style={{ width: 'auto' }} />
            </label>
          </div>

          {pageRows.length === 0 ? (
            <EmptyState title="No participants match" note="Adjust filters or add a participant." action={<Button onClick={() => setNewParticipant(true)}>Add participant</Button>} />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Participants</caption>
                <thead>
                  <tr>
                    <SortHeader label="Name" sortKey="name" current={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Participant ID" sortKey="id" current={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Email" sortKey="email" current={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Team" sortKey="team" current={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Registration" sortKey="registrationStatus" current={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Participation" sortKey="participationStatus" current={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Registered" sortKey="registeredAt" current={sort} dir={dir} onSort={onSort} />
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td className="mono small">{p.id}</td>
                      <td className="small">{p.email}</td>
                      <td className="small">{teamName(p.teamId)}</td>
                      <td><StatusChip value={p.registrationStatus} /></td>
                      <td><StatusChip value={p.participationStatus} /></td>
                      <td className="mono small">{fmtDateTime(p.registeredAt)}</td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button size="sm" onClick={() => setViewing(p)}>View</Button>
                          <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                          <Button size="sm" variant="danger" onClick={() => setRemoving(p)}>Remove</Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
        </Panel>
      )}

      {tab === 'teams' && (
        <TeamsPanel
          teams={state.teams}
          participants={state.participants}
          showNewTeam={showNewTeam}
          onCloseNewTeam={() => setShowNewTeam(false)}
          onAddTeam={(name, capacity) => { addTeam(name, capacity); toast.push({ kind: 'success', title: 'Team created', body: name }); setShowNewTeam(false) }}
          onRemoveTeam={(id) => { removeTeam(id); toast.push({ kind: 'warning', title: 'Team removed' }) }}
          onAssign={assignTeam}
        />
      )}

      {showCsv && <CsvImportWizard onClose={() => { setShowCsv(false); setParams((p) => { p.delete('csv'); return p }) }} />}

      {newParticipant && (
        <ParticipantForm
          teams={state.teams}
          onClose={() => setNewParticipant(false)}
          onSubmit={(data) => { addParticipant(data); toast.push({ kind: 'success', title: 'Participant added', body: data.name }); setNewParticipant(false) }}
        />
      )}

      {editing && (
        <ParticipantForm
          teams={state.teams}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={(data) => { updateParticipant(editing.id, data); toast.push({ kind: 'success', title: 'Participant updated', body: editing.name }); setEditing(null) }}
        />
      )}

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)} wide actions={<Button onClick={() => setViewing(null)}>Close</Button>}>
          <div className="kv-grid">
            <KV k="Participant ID" v={viewing.id} />
            <KV k="Email" v={viewing.email} />
            <KV k="Team" v={teamName(viewing.teamId)} />
            <KV k="Registration" v={<StatusChip value={viewing.registrationStatus} />} />
            <KV k="Participation" v={<StatusChip value={viewing.participationStatus} />} />
            <KV k="Registered" v={fmtDateTime(viewing.registeredAt)} />
            <KV k="Last active" v={viewing.lastActiveAt ? fmtDateTime(viewing.lastActiveAt) : 'not recorded'} />
          </div>
          <div style={{ marginTop: 12, display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => { setParticipantStatus(viewing.id, viewing.participationStatus === 'disabled' ? 'active' : 'disabled'); toast.push({ kind: 'info', title: viewing.participationStatus === 'disabled' ? 'Participant enabled' : 'Participant disabled' }) }}>
              {viewing.participationStatus === 'disabled' ? 'Enable' : 'Disable'}
            </Button>
            <span className="small muted" style={{ alignSelf: 'center' }}>Registration:</span>
            {(['registered', 'pending', 'invited', 'waitlisted'] as RegistrationStatus[]).map((s) => (
              <Button key={s} size="sm" onClick={() => setRegistrationStatus(viewing.id, s)}>{s}</Button>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <span className="overline" style={{ display: 'block', marginBottom: 8 }}>Participant activity</span>
            {participantActivity.length === 0 ? <p className="muted small">No recorded activity for this participant.</p> : (
              <div className="ruled">
                {participantActivity.map((a) => (
                  <div key={a.id} className="kv-row"><span className="mono small">{a.action}</span><span className="muted small">{fmtDateTime(a.timestamp)}</span></div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove participant"
          danger
          confirmLabel="Remove"
          message={`Remove ${removing.name} (${removing.id})? They will be detached from their team and marked removed. This is recorded in the activity log.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => { removeParticipant(removing.id); toast.push({ kind: 'warning', title: 'Participant removed', body: removing.name }); setRemoving(null) }}
        />
      )}
    </div>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="panel-2" style={{ padding: 10 }}><span className="overline" style={{ display: 'block', marginBottom: 4 }}>{k}</span><span className="small">{v}</span></div>
}

function ParticipantForm({ teams, initial, onClose, onSubmit }: { teams: Team[]; initial?: Participant; onClose: () => void; onSubmit: (data: Omit<Participant, 'id'> & { id?: string }) => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    teamId: initial?.teamId ?? '',
    registrationStatus: initial?.registrationStatus ?? 'registered',
    participationStatus: initial?.participationStatus ?? 'active',
  })
  return (
    <Modal title={initial ? 'Edit participant' : 'Add participant'} onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Save' : 'Add'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="stack" style={{ gap: 12 }}>
        <div className="grid-split">
          <Field label="Name" htmlFor="pf-name" required><input id="pf-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Email" htmlFor="pf-email" required><input id="pf-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        </div>
        <div className="grid-split">
          <Field label="Team" htmlFor="pf-team">
            <div className="select-wrap"><select id="pf-team" className="select" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
              <option value="">Unassigned</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          </Field>
          <Field label="Registration status" htmlFor="pf-reg">
            <div className="select-wrap"><select id="pf-reg" className="select" value={form.registrationStatus} onChange={(e) => setForm({ ...form, registrationStatus: e.target.value as RegistrationStatus })}>
              {(['registered', 'pending', 'invited', 'waitlisted'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          </Field>
        </div>
        <Field label="Participation status" htmlFor="pf-part">
          <div className="select-wrap"><select id="pf-part" className="select" value={form.participationStatus} onChange={(e) => setForm({ ...form, participationStatus: e.target.value as ParticipationStatus })}>
            {(['active', 'inactive', 'disabled'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        </Field>
      </form>
    </Modal>
  )
  function submit() {
    onSubmit({
      name: form.name.trim(),
      email: form.email.trim(),
      teamId: form.teamId || null,
      registrationStatus: form.registrationStatus as RegistrationStatus,
      participationStatus: form.participationStatus as ParticipationStatus,
      registeredAt: initial?.registeredAt ?? new Date().toISOString(),
      lastActiveAt: initial?.lastActiveAt ?? null,
    })
  }
}

function TeamsPanel({ teams, participants, showNewTeam, onCloseNewTeam, onAddTeam, onRemoveTeam, onAssign }: {
  teams: Team[]
  participants: Participant[]
  showNewTeam: boolean
  onCloseNewTeam: () => void
  onAddTeam: (name: string, capacity: number) => void
  onRemoveTeam: (id: string) => void
  onAssign: (participantId: string, teamId: string | null) => void
}) {
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('5')
  const [removingTeam, setRemovingTeam] = useState<Team | null>(null)
  const [managing, setManaging] = useState<Team | null>(null)

  return (
    <Panel title="Teams" actions={<Button onClick={() => setManaging(null)} size="sm">{teams.length} teams</Button>}>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Teams</caption>
          <thead><tr><th scope="col">Team</th><th scope="col">Members</th><th scope="col">Join code</th><th scope="col">Capacity</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {teams.map((t) => {
              const members = participantsForTeam(t.id, participants)
              return (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="small">{members.length}</td>
                  <td className="mono small">{t.joinCode}</td>
                  <td className="mono small">{members.length} / {t.capacity}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button size="sm" onClick={() => setManaging(t)}>Members</Button>
                      <Button size="sm" variant="danger" onClick={() => setRemovingTeam(t)}>Remove</Button>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showNewTeam && (
        <Modal title="Add team" onClose={onCloseNewTeam} actions={<><Button onClick={onCloseNewTeam}>Cancel</Button><Button variant="primary" onClick={() => { if (name.trim()) onAddTeam(name.trim(), Number(capacity) || 5) }}>Create team</Button></>}>
          <div className="stack" style={{ gap: 12 }}>
            <Field label="Team name" htmlFor="team-name" required><input id="team-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Capacity" htmlFor="team-cap"><input id="team-cap" className="input mono" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
          </div>
        </Modal>
      )}

      {managing && (
        <Modal title={`Members: ${managing.name}`} onClose={() => setManaging(null)} wide actions={<Button onClick={() => setManaging(null)}>Done</Button>}>
          <span className="overline" style={{ display: 'block', marginBottom: 8 }}>Assign or reassign participants</span>
          <div className="ruled" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {participants.filter((p) => p.participationStatus !== 'removed').map((p) => (
              <div key={p.id} className="kv-row" style={{ alignItems: 'center' }}>
                <span className="small">{p.name} <span className="muted mono">{p.id}</span></span>
                <div className="select-wrap" style={{ width: 200 }}>
                  <select className="select" aria-label={`Team for ${p.name}`} value={p.teamId ?? ''} onChange={(e) => onAssign(p.id, e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {removingTeam && (
        <ConfirmDialog title="Remove team" danger confirmLabel="Remove" message={`Remove ${removingTeam.name}? Members will be detached.`} onCancel={() => setRemovingTeam(null)} onConfirm={() => { onRemoveTeam(removingTeam.id); setRemovingTeam(null) }} />
      )}

      {teams.length === 0 && <EmptyState title="No teams" note="Create a team to assign participants." />}
    </Panel>
  )
}
