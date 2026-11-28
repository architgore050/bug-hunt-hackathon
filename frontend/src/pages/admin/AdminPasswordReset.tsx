import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Wordmark } from '../../components/chrome'
import { Panel, Button, Field } from '../../ui/components'
import { useAdmin } from '../../admin/store'
import { useToast } from '../../admin/ui'

export default function AdminPasswordReset() {
  const [params] = useSearchParams()
  const { state, completePasswordReset } = useAdmin()
  const toast = useToast()
  const id = params.get('id') ?? ''
  const initialToken = params.get('token') ?? ''
  const acct = state.admins.find((a) => a.id === id)
  const [token, setToken] = useState(initialToken)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 12) { setError('Password must be at least 12 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    const ok = completePasswordReset(id, token.trim(), acct?.name ?? id)
    if (!ok) { setError('Invalid or expired reset token.'); return }
    setDone(true)
    toast.push({ kind: 'success', title: 'Password reset complete' })
  }

  return (
    <div className="wrap page" style={{ display: 'grid', justifyContent: 'center', alignContent: 'start' }}>
      <div style={{ width: 'min(100%, 440px)', display: 'grid', gap: 16, paddingTop: '7vh' }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <Wordmark to="/admin" />
          <span className="exhibit-num">ACCESS</span>
          <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', margin: 0 }}>Reset password</h1>
          <p className="muted small">No email is used. Enter the one-time token issued by an authorized admin. A password change is forced after reset. This preview reset runs on the local admin store.</p>
        </header>
        {acct ? <p className="small muted">Resetting account: <strong>{acct.name}</strong> ({acct.email})</p> : <p className="small" style={{ color: 'var(--warn)' }}>No matching admin account for this id.</p>}
        {done ? (
          <Panel><p>Password reset complete. You can now <Link to="/admin/login">sign in</Link> with your new password.</p></Panel>
        ) : (
          <Panel ariaLabel="Password reset form">
            <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
              <Field label="One-time token" htmlFor="reset-token" required><input id="reset-token" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} required /></Field>
              <Field label="New password" htmlFor="reset-pw" required hint="At least 12 characters."><input id="reset-pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} /></Field>
              <Field label="Confirm new password" htmlFor="reset-pw2" required><input id="reset-pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} /></Field>
              {error && <div className="field-error" role="alert">{error}</div>}
              <Button type="submit" variant="primary" disabled={!id || !token || !password || !confirm}>Set new password</Button>
            </form>
          </Panel>
        )}
        <p className="muted small"><Link to="/admin/login">Back to admin login</Link></p>
      </div>
    </div>
  )
}
