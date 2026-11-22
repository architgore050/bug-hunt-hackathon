import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiRequestError } from '../lib/api'
import { Button, CheckRow, ErrorBanner, Field, Panel } from '../ui/components'
import { CheckIcon } from '../ui/icons'

interface Requirement {
  label: string
  test: (pw: string) => boolean
}

const REQUIREMENTS: Requirement[] = [
  { label: 'At least 12 characters', test: (pw) => pw.length >= 12 },
  { label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { label: 'One digit', test: (pw) => /\d/.test(pw) },
  { label: 'One symbol', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

export default function Activate() {
  const [params] = useSearchParams()
  const [token, setToken] = useState(params.get('invite') ?? '')
  const [password, setPassword] = useState('')
  const [accept, setAccept] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [done, setDone] = useState<{ email: string } | null>(null)

  const checks = useMemo(() => REQUIREMENTS.map((r) => ({ label: r.label, ok: r.test(password) })), [password])
  const allOk = checks.every((c) => c.ok)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ ok: boolean; email: string }>('/v1/auth/activate', {
        method: 'POST',
        body: { invite_token: token.trim(), password, accept_rules: accept },
      })
      setDone({ email: res.email })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : new ApiRequestError({ code: 'UNKNOWN', serverMessage: 'Activation failed. Try again.' }))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="wrap page" style={{ display: 'grid', justifyContent: 'center' }}>
        <div style={{ width: 'min(100%, 480px)', display: 'grid', gap: 16, paddingTop: '9vh' }}>
          <div className="banner banner-tone-ok">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <CheckIcon size={15} />
              <span className="banner-title">Account activated</span>
            </div>
            <div className="small">
              The account for <span className="mono">{done.email}</span> is active and the current rules acceptance
              was recorded. Sign in to reach your console.
            </div>
          </div>
          <Link to="/login" className="btn btn-primary" style={{ justifySelf: 'start' }}>
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap page" style={{ display: 'grid', justifyContent: 'center' }}>
      <div style={{ width: 'min(100%, 480px)', display: 'grid', gap: 16, paddingTop: '7vh' }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <span className="exhibit-num">EX-ACTIVATE</span>
          <h1 className="display" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', margin: 0 }}>Activate your account</h1>
          <p className="muted small">
            Paste the invite token from the email the organizers sent you. Activation sets your password and
            records your acceptance of the competition rules in one step. Invites are single-use and expire after
            48 hours.
          </p>
        </header>

        {error && <ErrorBanner error={error} title="Activation failed" />}

        <Panel>
          <form onSubmit={onSubmit} className="stack" style={{ gap: 14 }}>
            <Field label="Invite token" htmlFor="act-token" required hint="Comes from the invite link: /activate?invite=... ">
              <input
                id="act-token"
                className="input mono"
                type="text"
                required
                minLength={20}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the token"
                spellCheck={false}
              />
            </Field>
            <Field label="New password" htmlFor="act-password" required>
              <input
                id="act-password"
                className="input mono"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 12 characters"
              />
            </Field>
            <div className="panel-2" style={{ padding: '10px 14px' }} aria-label="Password requirements">
              {checks.map((c) => (
                <CheckRow key={c.label} ok={password.length === 0 ? null : c.ok} label={c.label} />
              ))}
            </div>
            <div className="checkbox-row">
              <input
                id="act-accept"
                type="checkbox"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
                required
              />
              <label htmlFor="act-accept" className="small">
                I accept the <Link to="/rules">competition rules</Link>, including the conduct scope and the safe
                harbor notice. Acceptance is recorded with the rules version and cannot be withdrawn.
              </label>
            </div>
            <Button type="submit" variant="primary" disabled={busy || !token || !allOk || !accept}>
              {busy ? 'Activating' : 'Activate account'}
            </Button>
            {!allOk && password.length > 0 && (
              <p className="field-error" role="status">The password does not meet every requirement yet.</p>
            )}
          </form>
        </Panel>
      </div>
    </div>
  )
}
