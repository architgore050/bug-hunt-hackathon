import { useState } from 'react'
import { api, ApiRequestError } from '../lib/api'
import { Button, Chip, useNowTick } from '../ui/components'
import { ShieldIcon } from '../ui/icons'

/**
 * Step-up gate for privileged admin operations (ADR: ground-truth guard).
 * The server records the confirmation on the session for 5 minutes.
 */
export function StepUpPanel({
  stepUpUntil,
  onStepUp,
  note,
  nowMs,
}: {
  stepUpUntil: number | null
  onStepUp: (validUntilMs: number) => void
  nowMs: number
  note?: string
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const elevated = stepUpUntil !== null && stepUpUntil > nowMs

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ ok: boolean; valid_until: string }>('/v1/auth/step-up', {
        method: 'POST',
        body: { password },
      })
      onStepUp(new Date(res.valid_until).getTime())
      setPassword('')
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.serverMessage)
      else setError('Confirmation failed.')
    } finally {
      setBusy(false)
    }
  }

  if (elevated) {
    const mins = Math.max(0, Math.round(((stepUpUntil as number) - nowMs) / 60000))
    return (
      <div className="banner banner-tone-ok" role="status" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShieldIcon size={15} />
          <span className="banner-title">Identity confirmed</span>
          <Chip tone="ok">valid ~{mins} min</Chip>
        </div>
        <div className="small">
          Privileged operations are enabled for this session window. The server re-asks after it lapses or after the
          session ends.
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="banner banner-tone-warn" style={{ marginBottom: 16 }} aria-label="Step-up confirmation">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ShieldIcon size={15} />
        <span className="banner-title">Confirm identity for privileged operations</span>
      </div>
      <div className="small">{note ?? 'Ground-truth and challenge-content operations require a fresh password confirmation, valid for 5 minutes.'}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label className="field-label" htmlFor="stepup-pw">Your password</label>
          <input
            id="stepup-pw"
            className="input mono-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" variant="primary" disabled={busy || !password}>
          {busy ? 'Confirming' : 'Confirm'}
        </Button>
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}
    </form>
  )
}

export function useStepUpWindow(stepUpUntil: number | null) {
  const nowMs = useNowTick(1000)
  return { nowMs, elevated: stepUpUntil !== null && stepUpUntil > nowMs }
}

/** Shared helper: does this admin error demand a step-up prompt? */
export function needsStepUp(err: unknown): boolean {
  return err instanceof ApiRequestError && err.code === 'ADMIN_STEP_UP_REQUIRED'
}

/** Small inline marker shown next to controls that are gated on step-up. */
export function StepUpGateHint() {
  return <Chip tone="warn" title="Requires identity confirmation above">step-up required</Chip>
}

export function adminErrorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const firstDetail = Object.entries(err.details)[0]
    if (firstDetail) return `${err.serverMessage} (${String(firstDetail[1])})`
    return err.serverMessage
  }
  return 'Operation failed.'
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
