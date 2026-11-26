// Event progress bar: collapsed 4px line + expanded node panel.
//
// State comes exclusively from GET /v1/levels + GET /v1/progress passed in by
// the page; the component never derives progression locally. Expansion works
// by hover, keyboard focus and tap, and can be pinned. Percentages are plain
// text for screen readers; motion respects the global reduced-motion switch.

import { useEffect, useRef, useState } from 'react'
import { isDoneStatus } from '../../lib/api-levels'
import type { LevelsResponse, ProgressResponse, LevelSummary } from '../../lib/api-levels'
import { Chip } from '../../ui/components'
import { CheckIcon, ClockIcon, CrossIcon, ShieldIcon } from '../../ui/icons'

function nodeStateFor(
  level: LevelSummary,
  pointer: { level_no: number; node: string } | null,
  node: 'explain' | 'exec',
): 'locked' | 'available' | 'current' | 'done' | 'missed' {
  const status = level.participant_status
  if (isDoneStatus(status)) return 'done'
  if (status === 'missed') return 'missed'
  if (pointer && pointer.level_no === level.level_no && pointer.node === node) return 'current'
  if (status === 'in_progress' || status === 'available') return 'available'
  return 'locked'
}

const NODE_LABEL: Record<ReturnType<typeof nodeStateFor>, string> = {
  locked: 'locked',
  available: 'open',
  current: 'you are here',
  done: 'done',
  missed: 'missed',
}

function NodeStateIcon({ state }: { state: ReturnType<typeof nodeStateFor> }) {
  if (state === 'done') return <CheckIcon size={12} style={{ color: 'var(--ok)' }} />
  if (state === 'missed') return <CrossIcon size={12} style={{ color: 'var(--danger)' }} />
  if (state === 'current') return <ClockIcon size={12} style={{ color: 'var(--signal)' }} />
  if (state === 'available') return <ShieldIcon size={12} className="muted" />
  return <ShieldIcon size={12} className="muted" />
}

/** Server-derived overall fraction across the eight flow nodes. */
export function overallFraction(levels: LevelsResponse, pointer: { level_no: number; node: string } | null): number {
  const total = Math.max(levels.levels.length, 1) * 2
  let done = 0
  for (const l of levels.levels) {
    if (isDoneStatus(l.participant_status)) done += 2
    else if (pointer && pointer.level_no === l.level_no && pointer.node === 'exec') done += 1
  }
  return Math.min(1, done / total)
}

interface Props {
  levels: LevelsResponse | undefined
  progress: ProgressResponse | undefined
  /** Server-anchored now (ms) from useServerNow(); null hides countdowns. */
  nowMs: number | null
}

export function EventProgressBar({ levels, progress, nowMs }: Props) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<number | null>(null)

  const pointer = progress?.pointer ?? null
  const frac = levels ? overallFraction(levels, pointer) : 0
  const percent = Math.round(frac * 100)

  const expand = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setOpen(true)
  }
  const scheduleCollapse = () => {
    if (pinned) return
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 800)
  }
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  const current = levels && pointer ? levels.levels.find((l) => l.level_no === pointer.level_no) ?? null : null
  const deadline = current?.ends_at ? new Date(current.ends_at).getTime() : null
  const msLeft = deadline !== null && nowMs !== null ? deadline - nowMs : null
  const showCountdownChip = msLeft !== null && msLeft > 0 && msLeft <= 5 * 60_000

  const countdownText =
    msLeft === null
      ? 'No deadline published'
      : msLeft <= 0
        ? 'Deadline reached'
        : `Time left: ${Math.floor(msLeft / 60000)}m ${Math.floor((msLeft % 60000) / 1000)}s`

  return (
    <nav
      className="eprogress"
      aria-label="Event progress"
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
    >
      <button
        type="button"
        className="eprogress-line"
        style={{ width: '100%', background: 'transparent', padding: 0, border: 'none', display: 'block' }}
        aria-expanded={open}
        aria-label={`Event progress: ${percent} percent complete. Expand for details.`}
        onFocus={expand}
        onBlur={scheduleCollapse}
        onClick={() => (open ? scheduleCollapse() : expand())}
      >
        <span
          className="eprogress-fill"
          style={{ width: `${frac * 100}%` }}
          aria-hidden="true"
        />
        {levels?.levels.map((l) => {
          const left = ((l.level_no - 0.5) / Math.max(levels.levels.length, 1)) * 100
          const done = isDoneStatus(l.participant_status)
          return (
            <span
              key={l.level_no}
              className={`eprogress-tick ${done ? 'done' : ''}`}
              style={{ left: `${left}%` }}
              aria-hidden="true"
            />
          )
        })}
      </button>
      <span className="sr-only" aria-live="polite">
        {`Event progress ${percent} percent. ${countdownText}.`}
      </span>
      {showCountdownChip && (
        <div className="eprogress-chipbar">
          <Chip tone={msLeft !== null && msLeft <= 2 * 60_000 ? 'danger' : 'warn'}>
            {`${Math.max(0, Math.ceil(msLeft / 1000))}s left`}
          </Chip>
        </div>
      )}
      {open && (
        <div className="eprogress-panel" onMouseEnter={expand} onMouseLeave={scheduleCollapse}>
          <div className="wrap-wide">
            <div className="eprogress-head">
              <span className="overline">Event progress</span>
              <span className="mono small muted">{percent}% complete</span>
              <span className="mono small">{countdownText}</span>
              <button
                type="button"
                className="eprogress-pin btn btn-sm"
                aria-pressed={pinned}
                onClick={() => {
                  setPinned((p) => !p)
                  if (pinned) scheduleCollapse()
                }}
              >
                {pinned ? 'Unpin' : 'Pin open'}
              </button>
            </div>
            <div className="eprogress-levels">
              {levels?.levels.map((l) => {
                const isCurrent = pointer !== null && pointer.level_no === l.level_no && pointer.node !== 'done'
                return (
                  <div key={l.level_no} className={`eprogress-level ${isCurrent ? 'current' : ''}`}>
                    <span className="exhibit-num">{`L${l.level_no}`}</span>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontWeight: 600 }}>{l.name}</span>
                      <div className="eprogress-nodes">
                        {(['explain', 'exec'] as const).map((node) => {
                          const state = nodeStateFor(l, pointer, node)
                          return (
                            <Chip key={node} tone={state === 'done' ? 'ok' : state === 'current' ? 'signal' : state === 'missed' ? 'danger' : 'muted'}>
                              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                <NodeStateIcon state={state} />
                                {node} {NODE_LABEL[state]}
                              </span>
                            </Chip>
                          )
                        })}
                      </div>
                    </div>
                    <span className="mono small muted">{isCurrent ? countdownText : isDoneStatus(l.participant_status) ? 'submitted' : ''}</span>
                    <span className={`eprogress-note small ${isCurrent ? '' : 'muted'}`}>
                      {isCurrent && pointer ? `Current node: ${pointer.node === 'exec' ? 'execution' : 'explanation'}. ${l.gate_reason}` : l.gate_reason}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
