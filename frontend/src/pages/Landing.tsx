import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PublicEvent, TimeResponse } from '../lib/types'
import { clockOffset, fmtDateTime, proposedDateLabel } from '../lib/format'
import { CountdownTimer, ErrorBanner, LoadingLine, Panel, SectionHeading, StatusChip, useNowTick } from '../ui/components'
import { CaptureFlagMark } from '../ui/icons'
import { KineticWords, RevealBlock } from '../ui/motion'

const HOW_IT_WORKS = [
  'Participants will register in teams of 4 to 5 members.',
  'Each team will receive access to the same preconfigured full-stack application with documented setup instructions and seeded issues.',
  'The application source code will be provided so teams can inspect and debug the frontend, backend, API routes, and configuration.',
  'Teams will run the application, reproduce failures, inspect error messages, and trace bugs to their causes.',
  'Participants will fix functional issues such as broken UI behaviour, API errors, validation problems, and database or configuration faults.',
  'Teams may also investigate optional CTF clues hidden in code comments, Git history, encoded strings, or designated challenge endpoints.',
  'The repaired application will be tested against predefined and hidden functional test cases; submitted CTF flags will be verified separately.',
  'Teams will submit their updated source code, a brief explanation of fixes, test evidence, and any flags they have discovered.',
  'Evaluation will prioritize application functionality, correctness, handling of edge cases, code quality, and testing. Verified CTF flags will contribute bonus points.',
]

const SCORE_SEGMENTS = [
  { label: 'Functional tests', pct: 50, bg: 'var(--signal)', fg: 'var(--ink)' },
  { label: 'Code review', pct: 30, bg: 'var(--info)', fg: 'var(--ink)' },
  { label: 'Evidence and tests', pct: 20, bg: 'var(--ok)', fg: 'var(--ink)' },
]

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
    <Panel exhibit="LIVE" title="Event clock" className="panel" ariaLabel="Live event status">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
          {eventQ.isLoading && <LoadingLine label="Syncing event state" />}
          {eventQ.isError && <ErrorBanner error={eventQ.error} onRetry={() => void eventQ.refetch()} />}
          {eventQ.data?.event === null && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusChip value="pending" />
              <span className="mono small">Proposed date: {proposedDateLabel()}</span>
            </div>
          )}
          {eventQ.data?.event && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 14.5 }}>{eventQ.data.event.name}</span>
                <StatusChip value={eventQ.data.event.status} />
              </div>
              <div className="muted small mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {eventQ.data.event.starts_at
                  ? `Starts ${fmtDateTime(eventQ.data.event.starts_at)}`
                  : 'Start time pending'}{' '}
                {'·'} {eventQ.data.event.duration_minutes} min {'·'} {eventQ.data.event.max_teams} teams max
              </div>
            </>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {eventQ.data?.event?.starts_at && !timeQ.isError ? (
            <CountdownTimer
              targetMs={new Date(eventQ.data.event.starts_at).getTime()}
              nowMs={nowMs + (offset ?? 0)}
              label={
                new Date(eventQ.data.event.starts_at).getTime() > nowMs + (offset ?? 0)
                  ? 'Starts in (6 Dec)'
                  : 'Started'
              }
            />
          ) : (
            <div style={{ display: 'grid', gap: 2 }}>
              <span className="overline">Server clock</span>
              <span className="countdown" style={{ fontSize: 16 }}>
                {timeQ.data ? fmtDateTime(new Date(timeQ.data.server_time).toISOString()) : '--'}
              </span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

export default function Landing() {
  useServerOffset()

  return (
    <div className="wrap page stack-lg" style={{ gap: 36 }}>
      {/* Hero */}
      <section aria-labelledby="hero-h" style={{ display: 'grid', gap: 24 }}>
        <div className="hero-split">
          <div style={{ display: 'grid', gap: 16 }}>
            <RevealBlock immediate delayMs={0}>
              <div className="hero-meta-line">
                <span className="meta-accent">SDC, VIT Bhopal</span>
                <span aria-hidden="true">{'·'}</span>
                <span>6 December 2026</span>
                <span aria-hidden="true">{'·'}</span>
                <span>Offline</span>
                <span aria-hidden="true">{'·'}</span>
                <span>Teams of 4 to 5</span>
              </div>
            </RevealBlock>

            <div>
              <h1 className="display" id="hero-h" style={{ marginBottom: 10 }}>
                <KineticWords text="The Fall Back" stepMs={55} baseDelayMs={40} />
              </h1>
              <RevealBlock immediate delayMs={140} as="p" className="serif-quote" style={{ color: 'var(--signal)', margin: '0 0 12px' }}>
                A broken full-stack app. Your team. A working build.
              </RevealBlock>
              <RevealBlock immediate delayMs={200} as="p" style={{ maxWidth: '58ch', margin: 0 }}>
                Inspect the codebase, diagnose frontend and backend failures, restore expected functionality, and
                capture optional CTF flags for bonus points.
              </RevealBlock>
            </div>

            <RevealBlock immediate delayMs={260}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <Link to="/login" className="btn btn-primary">
                  Sign in
                </Link>
                <a href="#how-it-works" className="btn btn-ghost">
                  How it works
                </a>
                <Link to="/activate" className="small muted mono" style={{ marginLeft: 4 }}>
                  Activate invite
                </Link>
              </div>
            </RevealBlock>
          </div>

          <RevealBlock immediate delayMs={160}>
            <CaptureFlagMark />
          </RevealBlock>
        </div>

        <EventStatusStrip />
      </section>

      {/* 01 / Event overview */}
      <section aria-labelledby="overview-h" style={{ display: 'grid', gap: 18 }}>
        <RevealBlock>
          <SectionHeading id="overview-h" num="01" title="Event overview" note="SDC · full-stack debugging" />
        </RevealBlock>
        <div className="grid-2">
          <RevealBlock delayMs={50}>
            <div style={{ display: 'grid', gap: 12 }}>
              <p>
                The Fall Back is a technical competition organized by SDC in which participants receive an existing
                full-stack software application containing functional bugs, broken features, and selected security
                weaknesses in a controlled environment. Teams will inspect the codebase, identify the causes of
                failures, repair frontend and backend issues, and restore the application&apos;s expected functionality.
              </p>
              <p>
                Alongside the core development tasks, optional Capture The Flag (CTF) side quests will reward
                participants for discovering hidden tokens through code analysis, configuration review, API auditing,
                and safe investigation of intentionally planted vulnerabilities.
              </p>
              <p className="muted">
                The event will progress through application setup, debugging and repair, CTF exploration, and final
                testing and demonstration. It assesses practical full-stack development skills, debugging methods,
                logical reasoning, security awareness, and teamwork.
              </p>
            </div>
          </RevealBlock>
          <RevealBlock delayMs={100}>
            <dl className="dsheet panel" style={{ padding: '4px 16px' }}>
              <dt>Organizer</dt>
              <dd>Software Development Club</dd>
              <dt>Team size</dt>
              <dd>4 to 5 members</dd>
              <dt>Main score</dt>
              <dd>Restoring app functionality</dd>
              <dt>Side quests</dt>
              <dd>Optional CTF flags (bonus points)</dd>
            </dl>
          </RevealBlock>
        </div>
      </section>

      {/* 02 / How it works */}
      <section id="how-it-works" aria-labelledby="how-h" style={{ display: 'grid', gap: 18 }}>
        <RevealBlock>
          <SectionHeading id="how-h" num="02" title="How it works" note="from setup to evaluation" />
        </RevealBlock>
        <ol className="steps-list">
          {HOW_IT_WORKS.map((step, i) => (
            <RevealBlock key={step.slice(0, 28)} as="li" className="step-row" delayMs={i * 35}>
              <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
              <span>{step}</span>
            </RevealBlock>
          ))}
        </ol>
      </section>

      {/* 03 / Scoring & entry */}
      <section aria-labelledby="eval-h" style={{ display: 'grid', gap: 18 }}>
        <RevealBlock>
          <SectionHeading id="eval-h" num="03" title="Evaluation" note="repairs first, flags as bonus" />
        </RevealBlock>
        <RevealBlock delayMs={60}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div
                className="scorebar"
                role="img"
                aria-label="Score split: functional tests 50 percent, code review 30 percent, evidence and tests 20 percent"
              >
                {SCORE_SEGMENTS.map((s) => (
                  <div
                    key={s.label}
                    className="scorebar-seg"
                    style={{ width: `${s.pct}%`, background: s.bg, color: s.fg }}
                  >
                    {s.pct}%
                  </div>
                ))}
              </div>
              <div className="hero-meta-line" style={{ fontSize: 11.5 }}>
                <span>Functional tests 50%</span>
                <span aria-hidden="true">{'·'}</span>
                <span>Code review 30%</span>
                <span aria-hidden="true">{'·'}</span>
                <span>Evidence &amp; tests 20%</span>
                <span aria-hidden="true">{'·'}</span>
                <span className="meta-accent">CTF flags bonus</span>
              </div>
            </div>

            <div
              className="panel"
              style={{
                padding: '16px 18px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <p className="small muted" style={{ margin: 0, maxWidth: '64ch' }}>
                Main score comes from restoring functionality, edge-case handling, code quality, and tests. Verified
                CTF flags add capped bonus points.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
                <Link to="/activate" className="btn btn-ghost btn-sm">Activate invite</Link>
                <Link to="/rules" className="btn btn-ghost btn-sm">Read rules</Link>
              </div>
            </div>
          </div>
        </RevealBlock>
      </section>
    </div>
  )
}
