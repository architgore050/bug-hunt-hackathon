import { Chip, Panel } from '../ui/components'

export default function Privacy() {
  return (
    <div className="wrap page stack" style={{ maxWidth: 'min(100%, 800px)' }}>
      <header style={{ display: 'grid', gap: 10, paddingTop: 10 }}>
        <span className="exhibit-num">EX-PRIVACY</span>
        <h1 className="display" style={{ margin: 0 }}>Privacy notice</h1>
        <Chip tone="muted">v1 draft {'·'} local development deployment</Chip>
      </header>

      <Panel exhibit="EX-01" title="What the platform stores">
        <p>
          The platform keeps only the records the competition needs to run and to stay auditable. Accounts carry
          your email, your name as provided at registration and your role. Sessions are
          recorded with a hashed IP, the browser user agent, creation time and last-seen time; you can list and
          revoke your own sessions from the API at any time.
        </p>
        <p>
          Competition records include your team membership, the submissions you file (report text, file path, line
          range, category, flag codes), per-team score ledger entries, and any disputes you raise. Every
          privileged action on the platform writes an entry to a hash-chained audit log: actor, action, entity,
          request id, timestamp.
        </p>
        <p>
          Passwords are stored only as salted hashes. Password resets are performed by administrators; no invite,
          activation or public password-reset tokens are generated. Report content is used for scoring and review and is not published to other
          participants at any point before results are released.
        </p>
      </Panel>

      <Panel exhibit="EX-02" title="What the platform does not do">
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
          <li>No third-party analytics, trackers or advertising of any kind.</li>
          <li>No cookies beyond the first-party, HttpOnly refresh session cookie scoped to the refresh endpoint path.</li>
          <li>No email marketing or account-activation email flow. Administrators distribute initial and reset passwords privately.</li>
          <li>No sale or sharing of data. Records stay inside the event deployment.</li>
        </ul>
      </Panel>

      <Panel exhibit="EX-03" title="Deployment context and retention">
        <p>
          This deployment runs as a local development instance for the Fall Back event. Database backups and CSV
          exports (results, submissions, score ledger) are controlled by the organizers. After the event is
          finalized, challenge ground truth and personal records may be retained for the dispute window and club
          record-keeping, then reduced or archived.
        </p>
        <p className="muted small">
          Questions or corrections: contact the coordinators listed in the footer. Good-faith reports about how
          this platform handles data are covered by the same safe harbor as security reports.
        </p>
      </Panel>
    </div>
  )
}
