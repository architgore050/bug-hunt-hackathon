import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wordmark } from '../../components/chrome'
import { Panel, Button, Field, ErrorBanner } from '../../ui/components'
import { useAuth } from '../../lib/auth'
import { ApiRequestError } from '../../lib/api'
import { ShieldIcon } from '../../ui/icons'

export default function AdminLogin() {
  const { login, user, status } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await login(email.trim(), password)
      if (res.user.role !== 'admin' && res.user.role !== 'organizer') {
        setError(new ApiRequestError({ code: 'AUTH_FORBIDDEN', serverMessage: 'This account does not have administrator access.' }))
        return
      }
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : new ApiRequestError({ code: 'UNKNOWN', serverMessage: 'Sign in failed. Try again.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap page" style={{ display: 'grid', justifyContent: 'center', alignContent: 'start' }}>
      <div style={{ width: 'min(100%, 440px)', display: 'grid', gap: 16, paddingTop: '7vh' }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <Wordmark to="/admin" />
          <span className="exhibit-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldIcon size={13} /> ADMIN ACCESS</span>
          <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', margin: 0 }}>Administrator sign in</h1>
          <p className="muted small">Single shared admin login for all administrators; individual credentials. Administrative routes are protected. Wrong credentials return one generic message; account existence is never revealed.</p>
        </header>

        {error && <ErrorBanner error={error} title="Sign in failed" />}

        <Panel as="section" ariaLabel="Admin sign in form">
          <form onSubmit={onSubmit} className="stack" style={{ gap: 14 }}>
            <Field label="Admin email" htmlFor="admin-login-email" required>
              <input id="admin-login-email" className="input mono" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@sdc.vitbhopal.ac.in" />
            </Field>
            <Field label="Password" htmlFor="admin-login-password" required>
              <input id="admin-login-password" className="input mono" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" disabled={busy || !email || !password}>{busy ? 'Signing in' : 'Sign in'}</Button>
          </form>
        </Panel>

        <p className="muted small">Forgot your password? Ask an authorized admin to issue a secure reset token, then <Link to="/admin/admins/reset">complete reset</Link>. No email infrastructure is required.</p>
        <p className="muted small">{status === 'authed' && user ? `Currently signed in as ${user.email}.` : 'Participant sign-in is separate at /login.'}</p>
      </div>
    </div>
  )
}
