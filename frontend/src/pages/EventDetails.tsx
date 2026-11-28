import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { PublicEvent, PublicRules } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import {
  Chip,
  EmptyState,
  ErrorBanner,
  KVRow,
  LoadingShell,
  Panel,
  PlainMarkdown,
  SectionHeading,
  StatusChip,
} from '../ui/components'
import '../styles/event-details.css'

// Public event details page (/event). Everything on this page is rendered
// from the two public endpoints below; nothing about the event is invented
// or hard-coded here. Section copy describing the flow is factual and matches
// docs/EVENT_FLOW.md.

const RULES_EXCERPT_CHARS = 600

const FLOW_LINE =
  'Dashboard -> L1 explain -> L1 run -> L2 explain -> L2 run -> L3 explain -> L3 run -> L4 explain -> L4 run -> Dashboard'

const SCORING_KEY_RE = /scor|weight|point|bonus|penalt|leaderboard|cap/i

interface FormatEntry {
  key: string
  label: string
  text: string
}

/** Only primitives become format highlights; unknown shapes are skipped. */
function formatEntryValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'number') return Number.isNaN(value) ? null : String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return null
}

function formatEntryLabel(key: string): string {
  const label = key.replaceAll('_', ' ').trim()
  return label === '' ? key : label
}

/** Human phase line next to the canonical status chip. */
function EventPhaseChip({ status }: { status: string }) {
  if (status === 'live') return <Chip tone="signal" size="lg">Happening now</Chip>
  if (status === 'closed') return <Chip tone="muted" size="lg">Event closed</Chip>
  if (status === 'finalized') return <Chip tone="muted" size="lg">Results finalized</Chip>
  return null
}

export default function EventDetails() {
  const eventQ = useQuery({
    queryKey: ['public-event'],
    queryFn: () => api<{ event: PublicEvent | null }>('/v1/public/event'),
    staleTime: 60_000,
  })
  const rulesQ = useQuery({
    queryKey: ['public-rules'],
    queryFn: () => api<{ rules: PublicRules | null }>('/v1/public/rules'),
    staleTime: 60_000,
  })

  const loading = eventQ.isLoading || rulesQ.isLoading
  const loadError = eventQ.error ?? rulesQ.error
  const event = eventQ.data?.event ?? null
  const rules = rulesQ.data?.rules ?? null

  const retry = () => {
    void eventQ.refetch()
    void rulesQ.refetch()
  }

  const formatEntries: FormatEntry[] = []
  if (event) {
    for (const [key, value] of Object.entries(event.format)) {
      const text = formatEntryValue(value)
      if (text !== null) formatEntries.push({ key, label: formatEntryLabel(key), text })
    }
  }

  const scoringEntries = event
    ? Object.entries(event.format).filter(
        ([key, value]) => SCORING_KEY_RE.test(key) && typeof value === 'string' && value.trim() !== '',
      )
    : []

  const rulesExcerpt = rules === null ? '' : rules.body_markdown.slice(0, RULES_EXCERPT_CHARS)
  const rulesTruncated = rules !== null && rules.body_markdown.length > RULES_EXCERPT_CHARS

  return (
    <div className="wrap page stack-lg">
      <header style={{ display: 'grid', gap: 10, paddingTop: 10 }}>
        <span className="exhibit-num">EX-EVENT</span>
        <h1 className="display" style={{ margin: 0 }}>
          Event details
        </h1>
        <p className="muted small" style={{ maxWidth: '72ch', margin: 0 }}>
          This page is rendered from the platform public endpoints only. When the organizers publish the event
          record, the overview, schedule and rules summary below fill in from the server; nothing here is
          hard-coded.
        </p>
      </header>

      {loading && <LoadingShell label="Loading event details" />}

      {!loading && loadError !== null && (
        <ErrorBanner error={loadError} title="Event details unavailable" onRetry={retry} />
      )}

      {!loading && loadError === null && (
        <>
          {/* 01 - Overview */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="01" title="Overview" note="from the published event record" />
            {event === null ? (
              <EmptyState title="Event details are not published yet" />
            ) : (
              <Panel exhibit="EX-01" ariaLabel="Event overview">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  <span className="mono" style={{ fontSize: 17 }}>
                    {event.name}
                  </span>
                  <StatusChip value={event.status} size="lg" />
                  <EventPhaseChip status={event.status} />
                </div>
                <KVRow k="Timezone" v={event.timezone} />
                <KVRow k="Duration" v={`${event.duration_minutes} minutes`} />
                <KVRow k="Team size" v={`${event.max_participants} participants across up to ${event.max_teams} teams`} />
                <KVRow k="Rules version" v={`v${event.rules_version}`} />
                {formatEntries.length > 0 ? (
                  <div className="ed-format">
                    {formatEntries.map((entry) => (
                      <div className="ed-format-item" key={entry.key}>
                        <div className="overline">{entry.label}</div>
                        <div className="ed-format-value">{entry.text}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted small" style={{ marginTop: 14 }}>
                    The published event record carries no format highlights yet.
                  </p>
                )}
              </Panel>
            )}
          </section>

          {/* 02 - How the event works */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="02" title="How the event works" note="four levels, server-owned timers" />
            <Panel exhibit="EX-02" ariaLabel="How the event works">
              <p>
                The competition runs as four levels, and every level has the same shape: an explanation step that
                briefs the team, followed by an execution workspace where the team does the work and submits. Teams
                are 4 to 5 participants with exactly one team lead. The server owns all timers and progression: it
                opens and closes each level, checks every gate, and advances your team pointer once a level is
                submitted.
              </p>
              <p>
                Level 1 starts with a repository lock that only the team lead can set: the lead chooses one of two
                repository options, once, and the choice applies to everyone on the team for all four levels.
                Levels 1 and 2 are read-only bug hunting: you read the codebase and file structured flags. A
                Level 1 flag points at a single file and line location; a Level 2 flag can cover several ordered
                locations.
              </p>
              <p>
                Levels 3 and 4 move into editable workspaces: you change the code in place, then submit your work
                as a zip, diff or patch upload, or submit the saved server draft. The platform computes the diff
                against the frozen base itself, so what the reviewers evaluate is exactly what the server holds.
              </p>
              <div className="overline ed-flow-label">Flow at a glance</div>
              <pre className="ed-flow">{FLOW_LINE}</pre>
            </Panel>
          </section>

          {/* 03 - How to take part */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="03" title="How to take part" note="organizer-issued accounts" />
            <Panel exhibit="EX-03" ariaLabel="How to take part">
              <div className="ed-steps">
                <div className="ed-step">
                  <span className="ed-step-num">1</span>
                  <span className="ed-step-body">
                    Accounts are created by administrators, who assign each participant to a team. At first sign-in,
                    participants set their initial password. Accounts are personal and sharing one is prohibited.
                  </span>
                </div>
                <div className="ed-step">
                  <span className="ed-step-num">2</span>
                  <span className="ed-step-body">
                    Sign in at the /login page and accept the published rules before the event window opens.
                  </span>
                </div>
                <div className="ed-step">
                  <span className="ed-step-num">3</span>
                  <span className="ed-step-body">You belong to exactly one team for the event.</span>
                </div>
                <div className="ed-step">
                  <span className="ed-step-num">4</span>
                  <span className="ed-step-body">
                    At the start of Level 1 your team lead locks the repository option for everyone. Talk to your
                    team before the lock: it is immutable for participants once set.
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                <Link to="/login" className="btn btn-primary">
                  Sign in
                </Link>
              </div>
            </Panel>
          </section>

          {/* 04 - Scoring */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="04" title="Scoring" note="configured by the organizers" />
            <Panel exhibit="EX-04" ariaLabel="Scoring">
              <p>
                Scoring weights, caps and the leaderboard mode are configured by the organizers before the event.
                The dashboard shows your team score live once the event starts.
              </p>
              {scoringEntries.length > 0 && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--line)' }}>
                  {scoringEntries.map(([key, value]) => (
                    <KVRow key={key} k={formatEntryLabel(key)} v={String(value)} />
                  ))}
                </div>
              )}
            </Panel>
          </section>

          {/* 05 - How to win */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="05" title="How to win" note="rankings" />
            <Panel exhibit="EX-05" ariaLabel="How to win">
              <p>
                Your rank comes from the leaderboard snapshots the server publishes; there is no client-side score.
                Tie-breaks follow the tie-break order in the published rules.
              </p>
            </Panel>
          </section>

          {/* 06 - Roadmap */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="06" title="Roadmap" note="event window" />
            {event !== null && event.starts_at !== null && event.ends_at !== null ? (
              <Panel exhibit="EX-06" ariaLabel="Event window">
                <KVRow k="Opens" v={fmtDateTime(event.starts_at)} />
                <KVRow k="Closes" v={fmtDateTime(event.ends_at)} />
                <KVRow k="Duration" v={`${event.duration_minutes} minutes`} />
                <KVRow k="Timezone" v={event.timezone} />
              </Panel>
            ) : (
              <EmptyState title="Schedule not published" />
            )}
          </section>

          {/* 07 - Rules */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="07" title="Rules" note="frozen before the event" />
            <div style={{ display: 'grid', gap: 14 }}>
              <p style={{ margin: 0 }}>
                The rules page serves the frozen document the platform holds: submission formats, report caps,
                conduct, disputes and how results are released. What that page renders is the server text, word
                for word.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Link to="/rules" className="btn btn-ghost">
                  Read the full rules
                </Link>
              </div>
            </div>
            {rules !== null ? (
              <Panel exhibit="EX-07" title={`Rules document, v${rules.version}`} ariaLabel="Published rules excerpt">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                  <Chip tone="muted">Version {rules.version}</Chip>
                  <Chip tone="muted">
                    {rules.frozen_at !== null ? `Frozen ${fmtDateTime(rules.frozen_at)}` : 'Draft, not frozen'}
                  </Chip>
                </div>
                <PlainMarkdown text={rulesExcerpt} />
                <p className="muted small" style={{ marginTop: 14 }}>
                  {rulesTruncated
                    ? `Showing the first ${RULES_EXCERPT_CHARS} characters of the published document; the full text lives on the rules page.`
                    : 'The full published document is shown above; the rules page always serves the authoritative text.'}
                </p>
              </Panel>
            ) : (
              <Panel exhibit="EX-07" ariaLabel="Published rules">
                <p className="muted" style={{ margin: 0 }}>
                  The organizers have not published a rules document yet. This section fills in automatically once
                  publication happens.
                </p>
              </Panel>
            )}
          </section>

          {/* 08 - FAQ and support */}
          <section style={{ display: 'grid', gap: 18 }}>
            <SectionHeading num="08" title="FAQ and support" note="published closer to the event" />
            <EmptyState
              title="Support details are published closer to the event"
              note="No FAQ or support contacts are listed on this page yet. When the organizers publish support details they will appear here."
            />
          </section>
        </>
      )}
    </div>
  )
}
