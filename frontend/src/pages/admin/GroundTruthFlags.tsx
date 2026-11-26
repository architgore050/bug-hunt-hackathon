import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import type { AdminEvent } from '../../lib/types'
import { Button, Chip, EmptyState, ErrorBanner, Field, LoadingShell, Panel, StatusChip } from '../../ui/components'
import { adminErrorText, StepUpGateHint, StepUpPanel } from '../../components/StepUp'

interface ChallengeVersion {
  id: string
  slug: string
  title: string
  version: number
  status: string
}

interface GroundTruthFlag {
  id: string
  flag_key: string
  points: number
  max_awards: number
  position_label: string | null
  created_at: string
}

const emptyFlag = { flag_key: '', code: '', points: '25', max_awards: '99' }

export default function GroundTruthFlags() {
  const eventsQ = useQuery({
    queryKey: ['admin-events'],
    queryFn: () => api<{ events: AdminEvent[] }>('/v1/admin/events'),
  })
  const [eventId, setEventId] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [stepUpUntil, setStepUpUntil] = useState<number | null>(null)
  const elevated = stepUpUntil !== null && stepUpUntil > Date.now()
  const [flag, setFlag] = useState(emptyFlag)
  const [editingFlagId, setEditingFlagId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const challengesQ = useQuery({
    queryKey: ['admin-challenges', eventId],
    queryFn: () => api<{ challenges: ChallengeVersion[] }>(`/v1/admin/events/${eventId}/challenges`),
    enabled: !!eventId,
  })
  const flagsQ = useQuery({
    queryKey: ['ground-truth-flags', challengeId, elevated],
    queryFn: () => api<{ flags: GroundTruthFlag[] }>(`/v1/admin/challenges/${challengeId}/ground-truth/flags`),
    enabled: !!challengeId && elevated,
  })

  const challenges = challengesQ.data?.challenges ?? []

  useEffect(() => {
    if (!eventId && eventsQ.data?.events.length) setEventId(eventsQ.data.events[0].id)
  }, [eventsQ.data, eventId])

  useEffect(() => {
    if (!eventId || challengesQ.isLoading) return
    const exists = challenges.some((challenge) => challenge.id === challengeId)
    if (exists) return
    setChallengeId(challenges[0]?.id ?? '')
    setEditingFlagId(null)
    setFlag(emptyFlag)
  }, [eventId, challengesQ.isLoading, challengesQ.data, challengeId])

  useEffect(() => {
    setEditingFlagId(null)
    setFlag(emptyFlag)
  }, [challengeId])

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  function fail(err: unknown) {
    setError(err instanceof ApiRequestError ? adminErrorText(err) : err instanceof Error ? err.message : 'Operation failed.')
  }

  function beginEdit(existing: GroundTruthFlag) {
    setEditingFlagId(existing.id)
    setFlag({
      flag_key: existing.flag_key,
      code: '',
      points: String(existing.points),
      max_awards: String(existing.max_awards),
    })
    clearMessages()
  }

  async function saveFlag(e: React.FormEvent) {
    e.preventDefault()
    if (!challengeId || !elevated) return
    setBusy(true)
    clearMessages()
    try {
      const body: Record<string, string | number> = {
        flag_key: flag.flag_key.trim(),
        points: Number(flag.points),
        max_awards: Number(flag.max_awards),
      }
      if (flag.code.trim()) body.code = flag.code.trim()
      if (editingFlagId) {
        await api(`/v1/admin/challenges/${challengeId}/ground-truth/flags/${editingFlagId}`, {
          method: 'PATCH',
          body,
        })
        setNotice('Flag updated. The current code was preserved unless a replacement was entered.')
      } else {
        if (!flag.code.trim()) throw new Error('A new flag requires a code.')
        await api(`/v1/admin/challenges/${challengeId}/ground-truth/flags`, {
          method: 'POST',
          body,
        })
        setNotice('Flag created. The raw code is stored only as an HMAC hash.')
      }
      setEditingFlagId(null)
      setFlag(emptyFlag)
      await flagsQ.refetch()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-lg">
      <header className="stack">
        <span className="exhibit-num">EVALUATION DATA</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Ground-truth flags</h1>
        <p className="muted small" style={{ maxWidth: '80ch' }}>
          Create and edit flag keys, scoring and award limits. Existing flag codes and stored hashes are never
          returned by the API. Editing a flag without entering a replacement code preserves its current secret.
        </p>
      </header>

      {eventsQ.isLoading && <LoadingShell label="Loading events" />}
      {eventsQ.isError && <ErrorBanner error={eventsQ.error} onRetry={() => void eventsQ.refetch()} />}

      <div className="grid-2">
        <Field label="Event" htmlFor="flags-event" required>
          <select id="flags-event" className="select" value={eventId} onChange={(e) => { setEventId(e.target.value); setChallengeId('') }}>
            <option value="">Select event</option>
            {(eventsQ.data?.events ?? []).map((event) => (
              <option key={event.id} value={event.id}>{event.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Challenge version" htmlFor="flags-challenge" required>
          <select id="flags-challenge" className="select" value={challengeId} onChange={(e) => setChallengeId(e.target.value)} disabled={!eventId || challenges.length === 0}>
            <option value="">Select challenge</option>
            {challenges.map((challenge) => (
              <option key={challenge.id} value={challenge.id}>{challenge.title} · v{challenge.version} · {challenge.status}</option>
            ))}
          </select>
        </Field>
      </div>

      {challengesQ.isLoading && <LoadingShell label="Loading challenge versions" />}
      {challengesQ.isError && <ErrorBanner error={challengesQ.error} onRetry={() => void challengesQ.refetch()} />}
      {challengesQ.data && challenges.length === 0 && <EmptyState title="No challenge versions" note="Create a challenge in Challenge Tools before adding flags." />}

      <StepUpPanel
        stepUpUntil={stepUpUntil}
        onStepUp={setStepUpUntil}
        note="Ground-truth flag data changes scoring. Confirm your password to unlock flag listing and editing for five minutes."
      />
      {error && <div className="banner banner-tone-danger" role="alert">{error}</div>}
      {notice && <div className="banner banner-tone-ok" role="status">{notice}</div>}

      {challengeId && (
        <div className="grid-2">
          <Panel exhibit="01" title={editingFlagId ? 'Edit flag' : 'Create flag'} actions={!elevated ? <StepUpGateHint /> : undefined}>
            <form onSubmit={saveFlag} className="stack" style={{ gap: 12 }}>
              <Field label="Flag key" htmlFor="flag-key" required>
                <input id="flag-key" className="input mono-input" maxLength={40} required value={flag.flag_key} onChange={(e) => setFlag({ ...flag, flag_key: e.target.value })} disabled={!elevated} />
              </Field>
              <Field
                label="Flag code"
                htmlFor="flag-code"
                required={!editingFlagId}
                hint={editingFlagId ? 'Leave empty to preserve the current code; enter a new code to replace it.' : 'The code is sent once and stored as an HMAC hash.'}
              >
                <input id="flag-code" className="input mono-input" type="password" minLength={4} maxLength={200} required={!editingFlagId} value={flag.code} onChange={(e) => setFlag({ ...flag, code: e.target.value })} disabled={!elevated} autoComplete="off" />
              </Field>
              <div className="grid-2">
                <Field label="Points" htmlFor="flag-points" required>
                  <input id="flag-points" className="input mono-input" type="number" min={0.01} max={500} step="0.01" required value={flag.points} onChange={(e) => setFlag({ ...flag, points: e.target.value })} disabled={!elevated} />
                </Field>
                <Field label="Maximum awards" htmlFor="flag-awards" required>
                  <input id="flag-awards" className="input mono-input" type="number" min={1} max={10000} step={1} required value={flag.max_awards} onChange={(e) => setFlag({ ...flag, max_awards: e.target.value })} disabled={!elevated} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button type="submit" variant="primary" disabled={busy || !elevated || !flag.flag_key.trim() || (!editingFlagId && !flag.code.trim())}>
                  {editingFlagId ? 'Save flag changes' : 'Create flag'}
                </Button>
                {editingFlagId && (
                  <Button type="button" onClick={() => { setEditingFlagId(null); setFlag(emptyFlag) }} disabled={busy}>
                    Cancel edit
                  </Button>
                )}
              </div>
            </form>
            <p className="muted small" style={{ marginTop: 12 }}>
              Changes are allowed while the challenge version is draft or reviewed. Once sealed, create a new challenge revision.
            </p>
          </Panel>

          <Panel exhibit="02" title="Existing flags">
            {!elevated && <p className="muted small">Confirm your password above to load flag metadata.</p>}
            {elevated && flagsQ.isLoading && <LoadingShell label="Loading flags" />}
            {elevated && flagsQ.isError && <ErrorBanner error={flagsQ.error} onRetry={() => void flagsQ.refetch()} />}
            {elevated && flagsQ.data?.flags.length === 0 && <EmptyState title="No flags yet" note="Create the first flag for this challenge." />}
            {(elevated ? flagsQ.data?.flags ?? [] : []).map((existing) => (
              <div className="kv-row" key={existing.id} style={{ alignItems: 'center', gap: 10 }}>
                <div>
                  <strong className="mono">{existing.flag_key}</strong>
                  <div className="muted small">{existing.points} points · max {existing.max_awards} awards</div>
                  {existing.position_label && <div className="muted small">{existing.position_label}</div>}
                  <div className="muted small">{new Date(existing.created_at).toLocaleString()}</div>
                </div>
                <Button size="sm" disabled={!elevated || busy} onClick={() => beginEdit(existing)}>Edit</Button>
              </div>
            ))}
            <div className="banner banner-tone-warn" style={{ marginTop: 14 }}>
              <div className="banner-title">Secret handling</div>
              <div className="small">The list returns only metadata. Plaintext flag codes and stored hashes never leave the ground-truth database.</div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
