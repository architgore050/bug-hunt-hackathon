import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiRequestError } from '../../lib/api'
import type { AdminEvent, Severity } from '../../lib/types'
import { CATEGORIES, SEVERITIES } from '../../lib/types'
import { Button, EmptyState, ErrorBanner, Field, LoadingShell, Panel } from '../../ui/components'
import { adminErrorText, StepUpGateHint, StepUpPanel } from '../../components/StepUp'

interface ChallengeVersion {
  id: string
  slug: string
  title: string
  version: number
  status: string
}

const initial = {
  code: '',
  title: '',
  severity: 'medium' as Severity,
  category: 'logic',
  points: '50',
  root_cause_group: '',
  explanation: '',
  fix_guidance: '',
  file_path: '',
  line_start: '',
  line_end: '',
}

export default function GroundTruthBugs() {
  const eventsQ = useQuery({
    queryKey: ['admin-events'],
    queryFn: () => api<{ events: AdminEvent[] }>('/v1/admin/events'),
  })
  const [eventId, setEventId] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [stepUpUntil, setStepUpUntil] = useState<number | null>(null)
  const elevated = stepUpUntil !== null && stepUpUntil > Date.now()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const challengesQ = useQuery({
    queryKey: ['admin-challenges', eventId],
    queryFn: () => api<{ challenges: ChallengeVersion[] }>(`/v1/admin/events/${eventId}/challenges`),
    enabled: !!eventId,
  })
  const challenges = challengesQ.data?.challenges ?? []

  useEffect(() => {
    if (!eventId && eventsQ.data?.events.length) setEventId(eventsQ.data.events[0].id)
  }, [eventsQ.data, eventId])

  useEffect(() => {
    if (!eventId || challengesQ.isLoading) return
    if (challenges.some((challenge) => challenge.id === challengeId)) return
    setChallengeId(challenges[0]?.id ?? '')
  }, [eventId, challengesQ.isLoading, challengesQ.data, challengeId])

  useEffect(() => {
    setForm(initial)
  }, [challengeId])

  async function createBug(e: React.FormEvent) {
    e.preventDefault()
    if (!challengeId || !elevated) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const hasFile = form.file_path.trim().length > 0
      if (hasFile && (
        !form.line_start || !form.line_end ||
        Number(form.line_start) < 1 ||
        Number(form.line_end) < Number(form.line_start)
      )) {
        throw new Error('Provide a valid line range with the file path, or leave all location fields empty.')
      }
      const locations = hasFile
        ? [{
            file_path: form.file_path.trim(),
            line_start: Number(form.line_start),
            line_end: Number(form.line_end),
            is_primary: true,
          }]
        : []
      await api(`/v1/admin/challenges/${challengeId}/ground-truth/bugs`, {
        method: 'POST',
        body: {
          code: form.code.trim(),
          title: form.title.trim(),
          severity: form.severity,
          category: form.category,
          points: Number(form.points),
          root_cause_group: form.root_cause_group.trim(),
          explanation: form.explanation.trim(),
          fix_guidance: form.fix_guidance.trim() || null,
          locations,
          aliases: [],
        },
      })
      setNotice('Ground-truth bug created in the isolated evaluation database.')
      setForm(initial)
    } catch (err) {
      setError(err instanceof ApiRequestError ? adminErrorText(err) : err instanceof Error ? err.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-lg">
      <header className="stack">
        <span className="exhibit-num">EVALUATION DATA</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Ground-truth bugs</h1>
        <p className="muted small" style={{ maxWidth: '80ch' }}>
          Author expected bug matches for a challenge version. The backend stores evaluation records through the
          isolated ground-truth database role and rejects changes after the challenge is sealed.
        </p>
      </header>

      {eventsQ.isLoading && <LoadingShell label="Loading events" />}
      {eventsQ.isError && <ErrorBanner error={eventsQ.error} onRetry={() => void eventsQ.refetch()} />}

      <div className="grid-2">
        <Field label="Event" htmlFor="bug-event" required>
          <select id="bug-event" className="select" value={eventId} onChange={(e) => { setEventId(e.target.value); setChallengeId('') }}>
            <option value="">Select event</option>
            {(eventsQ.data?.events ?? []).map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </Field>
        <Field label="Challenge version" htmlFor="bug-challenge" required>
          <select id="bug-challenge" className="select" value={challengeId} onChange={(e) => setChallengeId(e.target.value)} disabled={!eventId || challenges.length === 0}>
            <option value="">Select challenge</option>
            {challenges.map((challenge) => (
              <option key={challenge.id} value={challenge.id}>{challenge.title} · v{challenge.version} · {challenge.status}</option>
            ))}
          </select>
        </Field>
      </div>

      {challengesQ.isLoading && <LoadingShell label="Loading challenge versions" />}
      {challengesQ.isError && <ErrorBanner error={challengesQ.error} onRetry={() => void challengesQ.refetch()} />}
      {challengesQ.data && challenges.length === 0 && <EmptyState title="No challenge versions" note="Create a challenge version before authoring ground truth." />}

      <StepUpPanel
        stepUpUntil={stepUpUntil}
        onStepUp={setStepUpUntil}
        note="Ground-truth bug creation changes evaluation data. Confirm your password before authoring."
      />
      {error && <div className="banner banner-tone-danger" role="alert">{error}</div>}
      {notice && <div className="banner banner-tone-ok" role="status">{notice}</div>}

      {challengeId && (
        <Panel exhibit="01" title="Create ground-truth bug" actions={!elevated ? <StepUpGateHint /> : undefined}>
          <form onSubmit={createBug} className="stack" style={{ gap: 12 }}>
            <div className="grid-2">
              <Field label="Bug code" htmlFor="bug-code" required>
                <input id="bug-code" className="input mono-input" maxLength={40} required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!elevated} />
              </Field>
              <Field label="Points" htmlFor="bug-points" required>
                <input id="bug-points" className="input mono-input" type="number" min={0.01} max={1000} step="0.01" required value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} disabled={!elevated} />
              </Field>
            </div>
            <Field label="Bug title" htmlFor="bug-title" required>
              <input id="bug-title" className="input" minLength={2} maxLength={200} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={!elevated} />
            </Field>
            <div className="grid-2">
              <Field label="Severity" htmlFor="bug-severity" required>
                <select id="bug-severity" className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })} disabled={!elevated}>
                  {SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}
                </select>
              </Field>
              <Field label="Category" htmlFor="bug-category" required>
                <select id="bug-category" className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={!elevated}>
                  {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Root cause group" htmlFor="bug-root" required>
              <input id="bug-root" className="input" required value={form.root_cause_group} onChange={(e) => setForm({ ...form, root_cause_group: e.target.value })} disabled={!elevated} />
            </Field>
            <Field label="Expected root cause / explanation" htmlFor="bug-explanation" required>
              <textarea id="bug-explanation" className="textarea" rows={4} required value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} disabled={!elevated} />
            </Field>
            <Field label="Fix guidance" htmlFor="bug-guidance">
              <textarea id="bug-guidance" className="textarea" rows={3} value={form.fix_guidance} onChange={(e) => setForm({ ...form, fix_guidance: e.target.value })} disabled={!elevated} />
            </Field>
            <div className="overline">Primary source location (optional)</div>
            <Field label="File path" htmlFor="bug-file">
              <input id="bug-file" className="input mono-input" value={form.file_path} onChange={(e) => setForm({ ...form, file_path: e.target.value })} disabled={!elevated} placeholder="backend/app/service.py" />
            </Field>
            <div className="grid-2">
              <Field label="Line start" htmlFor="bug-line-start">
                <input id="bug-line-start" className="input mono-input" type="number" min={1} value={form.line_start} onChange={(e) => setForm({ ...form, line_start: e.target.value })} disabled={!elevated} />
              </Field>
              <Field label="Line end" htmlFor="bug-line-end">
                <input id="bug-line-end" className="input mono-input" type="number" min={1} value={form.line_end} onChange={(e) => setForm({ ...form, line_end: e.target.value })} disabled={!elevated} />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={busy || !elevated || !form.code.trim() || !form.title.trim() || !form.root_cause_group.trim() || !form.explanation.trim()}>
              {busy ? 'Creating' : 'Create ground-truth bug'}
            </Button>
          </form>
        </Panel>
      )}
    </div>
  )
}
