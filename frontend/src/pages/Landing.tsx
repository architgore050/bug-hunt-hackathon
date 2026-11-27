import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PublicEvent, TimeResponse } from '../lib/types'
import { clockOffset, fmtDateTime, proposedDateLabel } from '../lib/format'
import { CountdownTimer, ErrorBanner, LoadingLine, Panel, StatusChip, useNowTick } from '../ui/components'
import { CaptureFlagMark } from '../ui/icons'
import { KineticWords, RevealBlock } from '../ui/motion'

const EVENT_DATE_LINE = '6 December 2026, Asia/Kolkata (IST)'

const HOW_IT_WORKS_STEPS = [
  'Participants register in teams of 4 to 5 members.',
  'Each team receives access to the same preconfigured full-stack application with documented setup instructions and seeded issues.',
  'The application source code is provided so teams can inspect and debug the frontend, backend, API routes, and configuration.',
  'Teams run the application, reproduce failures, inspect error messages, and trace bugs to their causes.',
  'Participants fix functional issues such as broken UI behaviour, API errors, validation problems, and database or configuration faults.',
  'Teams may also investigate optional CTF clues hidden in code comments, Git history, encoded strings, or designated challenge endpoints.',
  'The repaired application is tested against predefined and hidden functional test cases; submitted CTF flags are verified separately.',
  'Teams submit their updated source code, a brief explanation of fixes, test evidence, and any flags they have discovered.',
  'Evaluation prioritizes application functionality, correctness, handling of edge cases, code quality, and testing. Verified CTF flags contribute bonus points.',
]

const SCORE_SEGMENTS = [
  { label: 'Functional tests', pct: 50, bg: 'var(--signal)' },
  { label: 'Code review', pct: 30, bg: 'var(--info)', fg: 'var(--ink)' },
  { label: 'Evidence and tests', pct: 20, bg: 'var(--ok)' },
]

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
  const offset = timeQ.data ? clockOffset(timeQ.data.server_time, timeQ.dataUpdatedAt) : null
  const syncedNowMs = nowMs + (offset ?? 0)

  return (
    <Panel exhibit="LIVE" title="EVENT CLOCK" className="panel" ariaLabel="Live event clock">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          {eventQ.isLoading && <LoadingLine label="Loading event record" />}
          {eventQ.isError && <ErrorBanner error={eventQ.error} onRetry={() => void eventQ.refetch()} />}
          {eventQ.data?.event === null && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusChip value="pending" />
                <span className="mono small">{proposedDateLabel()}</span>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Schedule pending publication. Teams of 4 to 5, offline on campus.
              </p>
            </>
          )}
          {eventQ.data?.event && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 15 }}>{eventQ.data.event.name}</span>
                <StatusChip value={eventQ.data.event.status} />
              </div>
              <div className="muted small mono">
                {eventQ.data.event.starts_at
                  ? `Starts ${fmtDateTime(eventQ.data.event.starts_at)}`
                  : EVENT_DATE_LINE}{' '}
                {'·'} {eventQ.data.event.duration_minutes} min {'·'} {eventQ.data.event.max_teams} teams max
              </div>
            </>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {eventQ.data?.event?.starts_at && !timeQ.isError ? (
            <CountdownTimer
              targetMs={new Date(eventQ.data.event.starts_at).getTime()}
              nowMs={syncedNowMs}
              label="STARTS IN (6 DEC)"
            />
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <span className="overline">Server clock</span>
              <span className="countdown" style={{ fontSize: 18 }}>
                {timeQ.data ? fmtDateTime(new Date(syncedNowMs).toISOString()) : '--'}
              </span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

export default function Landing() {
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return
    const target = document.getElementById(hash.slice(1))
    if (target) target.scrollIntoView({ behavior: 'smooth' })
  }, [hash])

  return (
    <div className="wrap page stack-lg">
      {/* Hero */}
      <section aria-labelledby="hero-h" style={{ display: 'grid', gap: 28, paddingTop: 26 }}>
        <div className="hero-split">
          <div style={{ display: 'grid', gap: 14 }}>
            <RevealBlock immediate>
              <p className="hero-meta-line">SDC, VIT BHOPAL · 6 DECEMBER 2026 · OFFLINE · TEAMS OF 4 TO 5</p>
            </RevealBlock>
            <KineticWords
              as="h1"
              id="hero-h"
              className="display hero-title-brand"
              immediate
              text="TheFallBack"
            />
            <RevealBlock immediate delayMs={90}>
              <p className="hero-tagline">
                A broken full-stack app. Your team. A working build.
              </p>
            </RevealBlock>
            <RevealBlock immediate delayMs={150}>
              <p className="muted" style={{ maxWidth: '54ch', fontSize: 15.5, margin: 0 }}>
                Inspect the codebase, diagnose frontend and backend failures, restore expected functionality, and
                capture optional CTF flags for bonus points.
              </p>
            </RevealBlock>
            <RevealBlock immediate delayMs={210}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                <Link to="/event" className="btn btn-primary">
                  Event details
                </Link>
              </div>
            </RevealBlock>
          </div>

          <RevealBlock immediate delayMs={140} className="hero-flag-wrap" aria-hidden="true">
            <CaptureFlagMark />
          </RevealBlock>
        </div>

        <RevealBlock immediate delayMs={240}>
          <EventStatusStrip />
        </RevealBlock>
      </section>

      {/* 01 Event overview */}
      <section aria-labelledby="overview-h" style={{ display: 'grid', gap: 18 }}>
        <div className="section-head">
          <span className="exhibit-num" style={{ fontSize: 13 }}>01</span>
          <KineticWords as="h2" id="overview-h" className="display" text="Event overview" style={{ margin: 0 }} />
          <span className="overline section-note-ruled">SDC · FULL-STACK DEBUGGING</span>
        </div>

        <div className="grid-2">
          <RevealBlock>
            <div style={{ display: 'grid', gap: 12 }}>
              <p className="serif-quote" style={{ margin: 0 }}>
                Participants receive an existing full-stack application containing functional bugs, broken features, and
                selected security weaknesses in a controlled environment. Teams inspect the codebase, identify root
                causes, repair frontend and backend issues, and restore expected functionality.
              </p>
              <p className="muted small" style={{ margin: 0 }}>
                The event progresses through application setup, debugging and repair, optional CTF exploration, and final
                testing and demonstration. Main score comes from restoring functionality; verified CTF flags add bonus
                points.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delayMs={90}>
            <dl className="dsheet panel" style={{ padding: '4px 16px' }}>
              <dt>Date</dt>
              <dd>{EVENT_DATE_LINE}</dd>
              <dt>Format</dt>
              <dd>Offline, on campus, 180 minutes</dd>
              <dt>Team size</dt>
              <dd>4 to 5 members</dd>
              <dt>Organizer</dt>
              <dd>Software Development Club, VIT Bhopal University</dd>
            </dl>
          </RevealBlock>
        </div>
      </section>

      {/* 02 How it works */}
      <section id="how-it-works" aria-labelledby="how-h" style={{ display: 'grid', gap: 18 }}>
        <div className="section-head">
          <span className="exhibit-num" style={{ fontSize: 13 }}>02</span>
          <KineticWords as="h2" id="how-h" className="display" text="How it works" style={{ margin: 0 }} />
          <span className="overline section-note-ruled">9 STEPS · SETUP TO DEMO</span>
        </div>

        <div className="steps-list">
          {HOW_IT_WORKS_STEPS.map((step, i) => (
            <RevealBlock key={step.slice(0, 24)} delayMs={i * 35} className="step-row">
              <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
              <span>{step}</span>
            </RevealBlock>
          ))}
        </div>
      </section>

      {/* 03 Evaluation */}
      <section aria-labelledby="eval-h" style={{ display: 'grid', gap: 18 }}>
        <div className="section-head">
          <span className="exhibit-num" style={{ fontSize: 13 }}>03</span>
          <KineticWords as="h2" id="eval-h" className="display" text="Evaluation" style={{ margin: 0 }} />
          <span className="overline section-note-ruled">REPAIRS FIRST, FLAGS AS BONUS</span>
        </div>

        <RevealBlock>
          <div style={{ display: 'grid', gap: 12 }}>
            <div
              className="scorebar"
              role="img"
              aria-label="Evaluation split: functional tests 50 percent, code review 30 percent, evidence and tests 20 percent"
            >
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }} className="mono small muted">
              {SCORE_SEGMENTS.map((s) => (
                <span key={s.label} style={{ color: 'var(--paper)' }}>
                  {s.label} {s.pct}%
                </span>
              ))}
              <span style={{ color: 'var(--signal)' }}>CTF flags bonus</span>
            </div>
          </div>
        </RevealBlock>

        <RevealBlock delayMs={90}>
          <Panel className="panel">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="muted small" style={{ margin: 0, maxWidth: '64ch' }}>
                Main score comes from restoring functionality, edge-case handling, code quality, and test evidence.
                Verified CTF flags add bonus points on top.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link to="/login" className="btn btn-primary">
                  Sign in
                </Link>
                <Link to="/rules" className="btn btn-ghost">
                  Read rules
                </Link>
              </div>
            </div>
          </Panel>
        </RevealBlock>
      </section>
    </div>
  )
}
