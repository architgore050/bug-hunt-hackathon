import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Wordmark } from '../../components/chrome'
import { Panel, Button, Field } from '../../ui/components'
import { api, ApiRequestError } from '../../lib/api'

export default function AdminPasswordReset() {
  const [params] = useSearchParams()
  const initialToken = params.get('token') ?? ''
  const [token, setToken] = useState(initialToken)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 12) { setError('Password must be at least 12 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      await api<{ ok: boolean }>('/v1/auth/password/reset', {
        method: 'POST',
        body: { token: token.trim(), password },
      })
      setDone(true)
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.serverMessage : 'Password reset failed. Try again.'
      setError(msg || 'Invalid or expired reset token.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap page" style={{ display: 'grid', justifyContent: 'center', alignContent: 'start' }}>
      <div style={{ width: 'min(100%, 440px)', display: 'grid', gap: 16, paddingTop: '7vh' }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <Wordmark to="/admin" />
          <span className="exhibit-num">ACCESS</span>
          <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', margin: 0 }}>Reset password</h1>
          <p className="muted small">Enter the single-use reset token issued by the platform. No email is sent. On success your password is updated, a password change flag is cleared server-side, and all of your sessions are revoked.</p>
        </header>
        {done ? (
          <Panel><p>Password reset complete. You can now <Link to="/admin/login">sign in</Link> with your new password.</p></Panel>
        ) : (
          <Panel ariaLabel="Password reset form">
            <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
              <Field label="One-time token" htmlFor="reset-token" required><input id="reset-token" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} required /></Field>
              <Field label="New password" htmlFor="reset-pw" required hint="At least 12 characters."><input id="reset-pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} /></Field>
              <Field label="Confirm new password" htmlFor="reset-pw2" required><input id="reset-pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} /></Field>
              {error && <div className="field-error" role="alert">{error}</div>}
              <Button type="submit" variant="primary" disabled={busy || !token || !password || !confirm}>{busy ? 'Resetting' : 'Set new password'}</Button>
            </form>
          </Panel>
        )}
        <p className="muted small"><Link to="/admin/login">Back to admin login</Link></p>
      </div>
    </div>
  )
}
