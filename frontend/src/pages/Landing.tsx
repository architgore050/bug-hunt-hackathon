import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PublicEvent, TimeResponse } from '../lib/types'
import { clockOffset, fmtDateTime, proposedDateLabel } from '../lib/format'
import { Chip, CountdownTimer, ErrorBanner, LoadingLine, Panel, SectionHeading, StatusChip, useNowTick } from '../ui/components'
import { FlagIcon, ShieldIcon, TerminalCaretIcon } from '../ui/icons'

const EVENT_DATE_LINE = 'Proposed date: 6 December 2026, Asia/Kolkata (IST)'

function useServerOffset(): number | null {
  const q = useQuery({
    queryKey: ['public-time'],
    queryFn: () => api<TimeResponse>('/v1/time'),
    refetchInterval: 60_000,
  })
  if (q.data) return clockOffset(q.data.server_time)
  return null
}

function EventStatusStrip() {
  const timeQ = useQuery({
    queryKey: ['public-time'],
    queryFn: () => api<TimeResponse>('/v1/time'),
    refetchInterval: 60_000,
  })
  const eventQ = useQuery({
    queryKey: ['public-event'],
    queryFn: () => api<{ event: PublicEvent | null }>('/v1/public/event'),
    refetchInterval: 60_000,
  })
  const nowMs = useNowTick()
  const offset = timeQ.data ? clockOffset(timeQ.data.server_time) : null

  return (
    <Panel exhibit="EX-00" title="Event status" className="panel" ariaLabel="Live event status">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          {eventQ.isLoading && <LoadingLine label="Loading event record" />}
          {eventQ.isError && <ErrorBanner error={eventQ.error} onRetry={() => void eventQ.refetch()} />}
          {eventQ.data?.event === null && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusChip value="pending" />
                <span className="mono small">Proposed date: {proposedDateLabel()}</span>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Event details pending publication. The organizers publish the final schedule, rules version and
                assignments here once the event record goes live.
              </p>
            </>
          )}
          {eventQ.data?.event && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 15 }}>{eventQ.data.event.name}</span>
                <StatusChip value={eventQ.data.event.status} size="lg" />
              </div>
              <div className="muted small mono">
                {eventQ.data.event.starts_at
                  ? `Starts ${fmtDateTime(eventQ.data.event.starts_at)}`
                  : 'Start time not announced'}{' '}
                {'·'} {eventQ.data.event.duration_minutes} minutes {'·'} team cap {eventQ.data.event.max_teams}{' '}
                {'·'} participant cap {eventQ.data.event.max_participants}
              </div>
            </>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {eventQ.data?.event?.starts_at && !timeQ.isError && (
            <CountdownTimer
              targetMs={new Date(eventQ.data.event.starts_at).getTime()}
              nowMs={nowMs + (offset ?? 0)}
              label="Starts in"
            />
          )}
          {(!eventQ.data || !eventQ.data.event?.starts_at) && (
            <div style={{ display: 'grid', gap: 4 }}>
              <span className="overline">Server clock</span>
              <span className="countdown" style={{ fontSize: 18 }}>
                {timeQ.data ? fmtDateTime(new Date(timeQ.data.server_time).toISOString()) : '--'}
              </span>
            </div>
          )}
          <div className="muted small mono" style={{ marginTop: 6 }}>
            Time source: platform server, rendered in IST
          </div>
        </div>
      </div>
    </Panel>
  )
}

function TheBrief() {
  return (
    <section aria-labelledby="brief-h" style={{ display: 'grid', gap: 18 }}>
      <SectionHeading num="01" title="The brief" note="data sheet" />
      <div className="grid-2">
        <div>
          <p className="serif-quote">
            One full-stack application. Ten planted defects across backend routes, database access and front-end
            logic. One hundred and eighty minutes to trace every failure to its root cause, repair the code, and
            file evidence that convinces the reviewers.
          </p>
          <p>
            Fall Back is an offline debugging competition. Every team works on the same seeded codebase at its own
            machine. Reports are structured: a file, a line range, a category, and an explanation of the root cause.
            A set of optional CTF flags hidden in the challenge pays capped bonus points.
          </p>
        </div>
        <dl className="dsheet panel" style={{ padding: '4px 16px' }}>
          <dt>Mode</dt>
          <dd>Offline, on campus, own laptop</dd>
          <dt>Date</dt>
          <dd>{EVENT_DATE_LINE}</dd>
          <dt>Duration</dt>
          <dd>180 minutes, server-timed</dd>
          <dt>Team size</dt>
          <dd>4 to 5 participants</dd>
          <dt>Domain</dt>
          <dd>Full-stack debugging (Node.js, SQLite, browser front end)</dd>
          <dt>Scoring</dt>
          <dd>Functional tests, code review, evidence quality</dd>
          <dt>Bonus</dt>
          <dd>Optional CTF flags, capped</dd>
          <dt>Organizer</dt>
          <dd>Software Development Club, VIT Bhopal University</dd>
        </dl>
      </div>
    </section>
  )
}

const FORMAT_PARTS = [
  { num: 'P1', title: 'Setup and bug reconnaissance', minutes: 30, note: 'Run the app, map the codebase, log first symptoms.' },
  { num: 'P2', title: 'Debugging and root-cause analysis', minutes: 35, note: 'Reproduce failures, trace causes, file structured reports.' },
  { num: 'P3', title: 'Full-stack repair and CTF side quests', minutes: 60, note: 'Fix the defects end to end; chase the optional flags.' },
  { num: 'P4', title: 'Testing, verification and demonstration', minutes: 25, note: 'Verify fixes against the expected behavior and demonstrate.' },
]

function TheFormat() {
  return (
    <section aria-labelledby="format-h" style={{ display: 'grid', gap: 18 }}>
      <SectionHeading num="02" title="The format" note="180 working minutes" />
      <div className="timeline">
        {FORMAT_PARTS.map((p, i) => (
          <div className="timeline-item" key={p.num}>
            <div className="timeline-num">{p.num}</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div>
                <div className="timeline-title">{p.title}</div>
                <div className="muted small" style={{ marginTop: 4 }}>{p.note}</div>
              </div>
              <span className="chip chip-tone-signal">{p.minutes} MIN</span>
            </div>
            {i === FORMAT_PARTS.length - 1 && (
              <div className="overline" style={{ gridColumn: '2', paddingTop: 6 }}>
                Plus registration, briefing and final evaluation windows managed by the organizers
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

const SCORE_SEGMENTS = [
  { label: 'Functional tests', pct: 50, bg: 'var(--signal)' },
  { label: 'Code review', pct: 30, bg: 'var(--info)', fg: 'var(--ink)' },
  { label: 'Evidence and report quality', pct: 20, bg: 'var(--ok)' },
]

function Scoring() {
  return (
    <section aria-labelledby="scoring-h" style={{ display: 'grid', gap: 18 }}>
      <SectionHeading num="03" title="Scoring" note="provisional, frozen before the event" />
      <div className="scorebar" role="img" aria-label="Score split: functional tests 50 percent, code review 30 percent, evidence and report quality 20 percent">
        {SCORE_SEGMENTS.map((s) => (
          <div
            key={s.label}
            className="scorebar-seg"
            style={{ width: `${s.pct}%`, background: s.bg, color: s.fg ?? 'var(--ink)' }}
          >
            {s.pct}%
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {SCORE_SEGMENTS.map((s) => (
          <span key={s.label} className="chip" style={{ borderColor: s.bg, color: 'var(--paper)' }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, background: s.bg, display: 'inline-block' }} />
            {s.label} {s.pct}%
          </span>
        ))}
      </div>
      <p className="muted small">
        Verified CTF flags add bonus points on top of the main score, capped at 100 points per team. Claimed
        severity is informational; awarded points come from the hidden ground truth. Definitively invalid reports
        may carry a small capped penalty, applied only at finalization. Tie-break order: total score, then fewer
        invalid reports, then the earlier last accepted finding.
      </p>
    </section>
  )
}

const SIDE_ITEMS = [
  {
    n: '1',
    title: 'Flags live inside the challenge app',
    body: 'Hidden strings and endpoints sit in the seeded codebase: broken access control paths, encoded comments, artifacts the app should never have shipped. Investigating them is in scope.',
  },
  {
    n: '2',
    title: 'Submit the exact code',
    body: 'Capture the flag string and submit it through the platform. Each verified flag pays bonus points; duplicate or wrong codes return nothing.',
  },
  {
    n: '3',
    title: 'Bonus, never a substitute',
    body: 'The total CTF bonus is capped (100 points, provisional). Flags pad a strong debugging score; they do not replace bug reports or repairs.',
  },
]

function SideQuests() {
  return (
    <section aria-labelledby="sidequests-h" style={{ display: 'grid', gap: 18 }}>
      <SectionHeading num="04" title="Side quests" note="optional CTF track" />
      <div className="grid-split">
        <p>
          The challenge app ships with a short CTF layer. Solving it is optional: main scoring stays on the bug
          reports and repairs, while verified flags pay capped bonus points. Flags reward the same instincts the
          main task does, reading code carefully and questioning what a route really does.
        </p>
        <div className="ruled panel">
          {SIDE_ITEMS.map((item) => (
            <div key={item.n} style={{ padding: '14px 16px', display: 'flex', gap: 14 }}>
              <span className="timeline-num" style={{ fontSize: 16 }}>{item.n}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div className="muted small" style={{ marginTop: 4 }}>{item.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const CONDUCT_POINTS = [
  'Attack only the provided challenge application, on your own machine, inside the event window.',
  'The platform, venue network, other teams and any external system are out of bounds. Attacking them is grounds for disqualification.',
  'Verdicts on reports stay hidden until results are released. Probing the evaluation with template reports is a violation.',
  'Do not share findings, code or flags between teams. Screenshots of the challenge and external AI tools are prohibited for the main task.',
  'After release, teams may dispute results through the platform within the announced window. Resolutions are final.',
]

function Conduct() {
  return (
    <section aria-labelledby="conduct-h" style={{ display: 'grid', gap: 18 }}>
      <SectionHeading num="05" title="Conduct" note="scope and fair play" />
      <div className="grid-2">
        <div className="ruled panel">
          {CONDUCT_POINTS.map((p) => (
            <p key={p.slice(0, 24)} style={{ padding: '12px 16px', margin: 0 }}>
              {p}
            </p>
          ))}
        </div>
        <div className="stack">
          <div className="banner banner-tone-signal">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ShieldIcon size={15} />
              <span className="banner-title">Platform safe harbor</span>
            </div>
            <div className="small">
              Found a weakness in the competition platform itself? Report it privately to the organizers
              immediately. Good-faith reports are welcomed and will not be penalized.
            </div>
          </div>
          <div className="banner banner-tone-info">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <FlagIcon size={15} />
              <span className="banner-title">Accounts are personal</span>
            </div>
            <div className="small">
              One account per person, activated through the invite the organizers send to your registered email.
              Account sharing is prohibited.
            </div>
          </div>
          <div>
            <Link to="/rules" className="btn btn-ghost" style={{ width: '100%' }}>
              Read the full rules
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Who can participate and how do we register?',
    a: 'Teams of 4 to 5 participants, registered by the Software Development Club, VIT Bhopal University. On first sign-in with your email id, your account is created automatically if it does not exist yet. Accounts are personal and sharing them is prohibited.',
  },
  {
    q: 'What exactly do we receive at the start?',
    a: 'Every team gets the same preconfigured full-stack application with intentionally planted defects, plus repository access through the platform. You inspect it, reproduce failures, fix them and submit structured bug reports before the deadline.',
  },
  {
    q: 'What does a valid bug report need?',
    a: 'A target file, a line range of at most 25 lines, a category from the taxonomy, a title, and an explanation of the root cause. Evidence is required for borderline matches. The server enforces per-file and per-round report caps.',
  },
  {
    q: 'Does claiming high severity earn more points?',
    a: 'No. Claimed severity is informational. Points come from the hidden ground truth: functional tests, reviewer judgment on the fix, and evidence quality.',
  },
  {
    q: 'When do we see feedback and results?',
    a: 'Feedback on individual reports stays hidden until the organizers release results. The leaderboard visibility follows the stage configuration: hidden, delayed snapshots, or public.',
  },
  {
    q: 'What if we find a vulnerability in the platform itself?',
    a: 'Report it privately to the organizers immediately. Good-faith platform security reports are welcomed under the safe harbor and will not be penalized.',
  },
]

function Faq() {
  return (
    <section aria-labelledby="faq-h" style={{ display: 'grid', gap: 12 }}>
      <SectionHeading num="06" title="Questions" note="from the rules" />
      <div>
        {FAQ.map((item) => (
          <div className="faq-item" key={item.q}>
            <h3 className="faq-q">{item.q}</h3>
            <p className="muted small" style={{ maxWidth: '72ch' }}>{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Landing() {
  useServerOffset()

  return (
    <div className="wrap page stack-lg">
      {/* Hero */}
      <section aria-labelledby="hero-h" style={{ display: 'grid', gap: 22, paddingTop: 26 }}>
        <div className="hero-meta">
          <Chip tone="signal" size="lg">6 December 2026</Chip>
          <Chip tone="muted" size="lg">VIT Bhopal University</Chip>
          <Chip tone="muted" size="lg">Asia/Kolkata</Chip>
          <Chip tone="muted" size="lg">Offline</Chip>
        </div>
        <div>
          <p className="overline-strong">Case file: Fall Back {'·'} a full-stack debugging challenge</p>
          <h1 className="display" id="hero-h" style={{ maxWidth: '20ch' }}>
            The app arrives broken. Your team closes the case.
          </h1>
          <p style={{ maxWidth: '62ch', fontSize: 16.5 }}>
            On event day, every team receives the same seeded full-stack application with defects planted across
            backend routes, database access and front-end logic. Reproduce the failures, trace each one to its root
            cause, repair the code, and file evidence-backed reports before the server clock runs out. Verified CTF
            flags along the way pay capped bonus points.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
            <Link to="/login" className="btn btn-primary">
              Sign in
            </Link>
            <Link to="/rules" className="btn btn-ghost">
              Read the rules
            </Link>
          </div>
        </div>
        <EventStatusStrip />
      </section>

      <TheBrief />
      <TheFormat />
      <Scoring />
      <SideQuests />
      <Conduct />
      <Faq />

      {/* Final call line */}
      <Panel exhibit="EX-END" title="How to enter" className="panel">
        <div className="grid-split">
          <div>
            <p className="serif-quote">
              Registrations run through the club. On first sign-in with your email id, your account is created
              automatically if it does not exist yet. Accept the rules and you are in. On event day, sign in and the
              lobby takes over: round state, announcements and your assignment.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
              <Link to="/login" className="btn btn-primary">Sign in</Link>
            </div>
          </div>
          <div className="ruled panel-2" style={{ padding: '6px 16px' }}>
            <div className="kv-row">
              <span className="kv-key">Round flow</span>
              <span className="stage-flow">draft {'>'} sealed {'>'} armed {'>'} active {'>'} ended {'>'} evaluating {'>'} released</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Surface</span>
              <span className="stage-flow">editor {'+'} report desk {'+'} receipts</span>
            </div>
            <div className="kv-row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="kv-key">Bring</span>
              <span className="stage-flow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <TerminalCaretIcon size={13} /> your laptop, charger, student ID
              </span>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
