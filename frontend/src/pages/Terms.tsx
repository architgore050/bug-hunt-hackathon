import { Chip, Panel } from '../ui/components'

export default function Terms() {
  return (
    <div className="wrap page stack" style={{ maxWidth: 'min(100%, 800px)' }}>
      <header style={{ display: 'grid', gap: 10, paddingTop: 10 }}>
        <span className="exhibit-num">EX-TERMS</span>
        <h1 className="display" style={{ margin: 0 }}>Terms of use</h1>
        <Chip tone="muted">v1 draft language</Chip>
      </header>

      <Panel exhibit="EX-01" title="1. Accounts">
        <p>
          Access to the console requires an account activated through an organizer-issued invite. Accounts are
          personal: one person per account, no sharing, no transfer. You are responsible for activity performed
          with your credentials. The organizers may suspend or disqualify accounts that break these terms or the
          competition rules.
        </p>
      </Panel>

      <Panel exhibit="EX-02" title="2. Acceptable use">
        <p>
          You use the platform to receive your challenge assignment, inspect challenge files, file bug reports and
          flag submissions, and read released results. You attack only the provided challenge application, inside
          the event window. You do not attack the platform, the venue network, other teams, or any external
          system. Automated scraping of challenge content, probing the evaluation pipeline with template reports,
          and attempts to read ground truth or other teams' work are prohibited.
        </p>
      </Panel>

      <Panel exhibit="EX-03" title="3. Content and scoring">
        <p>
          Reports and flags you submit become part of the competition record. Scoring is applied by the platform
          from hidden ground truth and reviewer decisions; verdicts stay hidden until the organizers release
          results. Disputes must be raised through the platform within the announced window after release, and
          dispute resolutions are final. The scoring configuration is versioned and frozen before the round
          starts; changes are recorded with reasons in the audit log.
        </p>
      </Panel>

      <Panel exhibit="EX-04" title="4. Availability and liability">
        <p>
          The platform is provided for the Fall Back event as-is. Organizers keep the competition fair and
          time-accurate (server-owned clocks, transactional receipts, audited controls), but they do not
          guarantee uninterrupted operation. Verified platform outages are handled through the announced
          time-adjustment process, not through ad hoc extensions. To the extent permitted by law, the club is not
          liable for indirect damages arising from use of the platform.
        </p>
      </Panel>

      <Panel exhibit="EX-05" title="5. Safe harbor">
        <p>
          A good-faith security report about the platform itself, delivered privately to the organizers without
          exploitation beyond the minimum needed to demonstrate the issue, will not lead to disqualification or
          legal action from the club. See the conduct section of the competition rules for the full statement.
        </p>
        <p className="muted small">
          These terms are v1 draft language prepared for the event. Where they overlap with the competition rules,
          the rules document published through the platform is authoritative.
        </p>
      </Panel>
    </div>
  )
}
