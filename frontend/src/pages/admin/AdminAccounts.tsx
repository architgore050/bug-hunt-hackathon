import { useState } from 'react'
import { Panel, Button, Field, Chip, EmptyState, StatusChip } from '../../ui/components'
import { fmtDateTime } from '../../lib/format'
import { useAdmin } from '../../admin/store'
import { Modal, ConfirmDialog, useToast } from '../../admin/ui'
import { PlusIcon } from '../../admin/icons'
import { api } from '../../lib/api'
import type { AdminAccount, AdminRole, AdminStatus } from '../../admin/types'

const ROLES: AdminRole[] = ['super_admin', 'admin', 'organizer', 'viewer']
const STATUSES: AdminStatus[] = ['active', 'pending', 'suspended', 'revoked']

function sampleResetToken(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'sample-reset-token'
}

export default function AdminAccounts() {
  const { state, addAdmin, updateAdmin, revokeAdmin, revokeSession } = useAdmin()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<AdminAccount | null>(null)
  const [revoking, setRevoking] = useState<AdminAccount | null>(null)
  const [resetFor, setResetFor] = useState<AdminAccount | null>(null)
  const [issuedToken, setIssuedToken] = useState<string | null>(null)

  async function issueReset(acct: AdminAccount) {
    setResetFor(acct)
    try {
      const result = await api<{ ok: boolean; token?: string }>('/v1/auth/password/reset-request', {
        method: 'POST',
        body: { email: acct.email },
      })
      setIssuedToken(result?.token ?? sampleResetToken())
      toast.push({ kind: 'info', title: 'Reset requested', body: 'Single-use token shown once. Hand it to the admin securely.' })
    } catch {
      setIssuedToken(sampleResetToken())
      toast.push({ kind: 'warning', title: 'Sample reset token issued', body: 'Platform API unavailable. This token is demo only.' })
    }
  }

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">ACCESS</span>
          <h1 className="display admin-page-title">Admin Accounts</h1>
          <p className="muted small" style={{ marginTop: 6, maxWidth: '74ch' }}>
            Single shared admin login; individual identities. Role-based permissions, protected routes, session management,
            login-attempt monitoring, admin-initiated password reset (no email), forced change after reset, and revocation.
            Sample local directory; real credentials live in the platform backend.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}><PlusIcon size={15} /> Register admin</Button>
      </div>

      <Panel title="Administrators">
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Admin accounts</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last login</th><th scope="col">Reset</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {state.admins.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td className="small">{a.email}</td>
                  <td><Chip tone="info">{a.role.replaceAll('_', ' ')}</Chip></td>
                  <td><StatusChip value={a.status} /></td>
                  <td className="mono small">{a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : 'never'}</td>
                  <td>{a.resetRequired ? <Chip tone="warn">change required</Chip> : <span className="muted small">-</span>}</td>
                  <td><span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button size="sm" onClick={() => setEditing(a)}>Edit</Button>
                    <Button size="sm" onClick={() => issueReset(a)}>Reset password</Button>
                    {a.status !== 'revoked' && <Button size="sm" variant="danger" onClick={() => setRevoking(a)}>Revoke</Button>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {state.admins.length === 0 && <EmptyState title="No admins" note="Register an admin." />}
      </Panel>

      <div className="grid-split">
        <Panel title="Login attempt monitoring">
          <div className="ruled" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {state.loginAttempts.map((l) => (
              <div key={l.id} className="kv-row">
                <span className="small"><span className="mono">{l.email}</span><span className="muted small" style={{ display: 'block' }}>{l.reason}</span></span>
                <span className="mono small muted">{fmtDateTime(l.timestamp)} {'·'} <Chip tone={l.success ? 'ok' : 'danger'}>{l.success ? 'success' : 'failed'}</Chip></span>
              </div>
            ))}
            {state.loginAttempts.length === 0 && <p className="muted small">No attempts recorded.</p>}
          </div>
        </Panel>
        <Panel title="Active sessions">
          <div className="ruled" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {state.sessions.map((s) => (
              <div key={s.id} className="kv-row" style={{ alignItems: 'center' }}>
                <span className="small"><span style={{ fontWeight: 600 }}>{s.adminName}</span><span className="muted small mono" style={{ display: 'block' }}>{fmtDateTime(s.lastSeenAt)}</span></span>
                {s.revoked ? <Chip tone="muted">revoked</Chip> : <Button size="sm" variant="danger" onClick={() => { revokeSession(s.id, 'admin'); toast.push({ kind: 'warning', title: 'Session revoked' }) }}>Revoke</Button>}
              </div>
            ))}
            {state.sessions.length === 0 && <p className="muted small">No sessions.</p>}
          </div>
        </Panel>
      </div>

      {adding && <AdminForm onClose={() => setAdding(false)} onSubmit={(data) => { addAdmin(data); toast.push({ kind: 'success', title: 'Admin registered', body: data.email }); setAdding(false) }} />}
      {editing && <AdminForm initial={editing} onClose={() => setEditing(null)} onSubmit={(data) => { updateAdmin(editing.id, data); toast.push({ kind: 'success', title: 'Admin updated' }); setEditing(null) }} />}
      {revoking && <ConfirmDialog title="Revoke admin access" danger confirmLabel="Revoke" message={`Revoke ${revoking.name}? Sessions are terminated and the account can no longer access administration. Recorded in the activity log.`} onCancel={() => setRevoking(null)} onConfirm={() => { revokeAdmin(revoking.id, 'admin'); toast.push({ kind: 'warning', title: 'Access revoked', body: revoking.name }); setRevoking(null) }} />}

      {resetFor && issuedToken && (
        <Modal title="Password reset token" onClose={() => { setResetFor(null); setIssuedToken(null) }} actions={<Button onClick={() => { setResetFor(null); setIssuedToken(null) }}>Done</Button>}>
          <p className="muted small" style={{ marginTop: 0 }}>No email is sent. Hand this one-time token to {resetFor.name} securely. They complete reset at the password reset page; a password change is forced after reset. Shown once.</p>
          <div className="panel-2" style={{ padding: 12 }}>
            <span className="overline">One-time token</span>
            <div className="mono" style={{ fontSize: 18, wordBreak: 'break-all', marginTop: 6, color: 'var(--signal)' }}>{issuedToken}</div>
            <div className="muted small mono" style={{ marginTop: 6 }}>account id: {resetFor.id}</div>
          </div>
          <p className="muted small">Reset link: <span className="mono">/admin/admins/reset?id={resetFor.id}&token={issuedToken}</span></p>
        </Modal>
      )}
    </div>
  )
}

function AdminForm({ initial, onClose, onSubmit }: { initial?: AdminAccount; onClose: () => void; onSubmit: (data: Partial<AdminAccount> & { name: string; email: string }) => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', email: initial?.email ?? '', role: initial?.role ?? 'organizer', status: initial?.status ?? 'pending' })
  return (
    <Modal title={initial ? 'Edit admin' : 'Register admin'} onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Save' : 'Register'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="stack" style={{ gap: 12 }}>
        <Field label="Name" htmlFor="adm-name" required><input id="adm-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Email" htmlFor="adm-email" required><input id="adm-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <div className="grid-split">
          <Field label="Role" htmlFor="adm-role"><div className="select-wrap"><select id="adm-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}>{ROLES.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select></div></Field>
          <Field label="Status" htmlFor="adm-status"><div className="select-wrap"><select id="adm-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AdminStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div></Field>
        </div>
        <p className="muted small">A password is set during secure reset; no password is collected here. Only an admin can register admin or organizer accounts.</p>
      </form>
    </Modal>
  )
  function submit() { onSubmit({ name: form.name.trim(), email: form.email.trim(), role: form.role, status: form.status }) }
}
