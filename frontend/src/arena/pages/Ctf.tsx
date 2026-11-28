import { useState } from 'react'
import { useArena } from '../state/ArenaProvider'
import { Icon } from '../ui/Icons'
import { Button, Chip, Field, Panel, Stat } from '../ui/primitives'

export default function Ctf() {
  const { quests, submitFlag, pushToast, team } = useArena()
  const [selectedId, setSelectedId] = useState(quests[0]?.id ?? '')
  const [flag, setFlag] = useState('')
  const [hintOpen, setHintOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = quests.find((quest) => quest.id === selectedId) ?? quests[0]
  const completed = quests.filter((quest) => quest.completed)

  const submit = async () => {
    if (!selected) return
    setError('')
    if (!flag.trim()) { setError('Enter a flag value.'); return }
    setBusy(true)
    const result = await submitFlag(selected.id, flag.trim())
    setBusy(false)
    pushToast(result.message, result.ok ? 'ok' : 'warn')
    if (result.ok) setFlag('')
    else setError(result.message)
  }

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Side quests / bonus</div>
          <h1>Flag submissions</h1>
          <p>Optional CTF tasks. Bonus points are tracked separately from the core competition score.</p>
        </div>
        <Chip tone="info">Bonus only</Chip>
      </header>

      <Panel eyebrow="Bonus standing" title="CTF points">
        <div className="ar-stat-grid">
          <Stat label="Bonus earned" value={`+${team?.ctfBonus ?? 0}`} tone="info" sub="separate from core" />
          <Stat label="Quests completed" value={completed.length} sub={`of ${quests.length} available`} tone="ok" />
          <Stat label="Remaining" value={quests.length - completed.length} sub="side quests open" />
          <Stat label="Core score" value={team?.score ?? 0} sub="not affected by these flags" />
        </div>
      </Panel>

      <div className="ar-ctf-layout">
        <Panel eyebrow="Available quests" title="Side quest catalogue">
          <div className="ar-ctf-list">
            {quests.map((quest) => (
              <button key={quest.id} className={`ar-ctf-item ${quest.id === selected?.id ? 'is-active' : ''} ${quest.completed ? 'is-done' : ''}`}
                onClick={() => { setSelectedId(quest.id); setHintOpen(false); setFlag(''); setError('') }}>
                <span className="ar-ctf-item__icon"><Icon name={quest.completed ? 'check' : 'flag'} size={15} /></span>
                <span><strong>{quest.name}</strong><small>{quest.category} · {quest.difficulty}</small></span>
                <span className="ar-ctf-item__pts">+{quest.points}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel eyebrow={selected ? `Quest ${selected.id}` : 'Quest'} title={selected?.name ?? 'No quest selected'}>
          {selected && (
            <div className="ar-ctf-detail">
              <div className="ar-ctf-detail__tags">
                <Chip tone={selected.difficulty === 'Hard' ? 'danger' : selected.difficulty === 'Medium' ? 'warn' : 'neutral'}>{selected.difficulty}</Chip>
                <Chip tone="neutral">{selected.category}</Chip>
                <Chip tone={selected.completed ? 'ok' : 'info'}>{selected.completed ? 'Completed' : 'Open'}</Chip>
              </div>
              <p>{selected.description}</p>
              {selected.hintAvailable && (
                <div className="ar-hint">
                  <button onClick={() => setHintOpen(!hintOpen)}><Icon name="warning" size={13} />{hintOpen ? 'Hide hint' : 'Reveal hint'}</button>
                  {hintOpen && <div>{selected.hint}</div>}
                </div>
              )}
              <div className="ar-divider" />
              <Field label="Flag value" required error={error} htmlFor="flag-value" hint="Values are never shown in sample data.">
                <input id="flag-value" className="ar-mono" value={flag} onChange={(event) => { setFlag(event.target.value); setError('') }} placeholder="FB{...}" disabled={selected.completed} />
              </Field>
              <div className="ar-form-actions">
                <Button variant="primary" icon="flag" disabled={busy || selected.completed} onClick={submit}>
                  {selected.completed ? 'Quest completed' : busy ? 'Checking...' : 'Submit flag'}
                </Button>
              </div>
              <div className="ar-ctf-note"><Icon name="shield" size={13} /> Flags add bonus points only. They do not change your core repair score.</div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
