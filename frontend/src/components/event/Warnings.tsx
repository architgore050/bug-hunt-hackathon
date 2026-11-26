// Event warning system driven entirely by server-provided windows.
//
// Spec moments (Bug Hunt CTF Participant Website Spec section 2.3), mapped to
// the backend's single window per level (no separate explain/exec deadlines):
// - 2 minutes before a level starts: dismissible banner.
// - 5, 3 and 1 minute before an execution deadline: banner (1 min persistent).
// - Last minute with the pointer on explain: "head to the execution page".
// - Deadline reached: blocking "Time's up. Auto-submitting..." modal; the
//   browser never submits anything itself, it waits for server confirmation.
//
// Warnings are keyed per (level, moment) so they never repeat aggressively
// within a session, and all announcements use polite live regions.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LevelsResponse, ProgressResponse } from '../../lib/api-levels'
import { Button } from '../../ui/components'

export type WarningMoment = 'start_2min' | 'deadline_5min' | 'deadline_3min' | 'deadline_1min' | 'explain_lastmin' | 'deadline_passed'

const MOMENT_COPY: Record<WarningMoment, string> = {
  start_2min: 'A level starts in 2 minutes.',
  deadline_5min: 'Your work will auto-submit in 5 minutes.',
  deadline_3min: 'Your work will auto-submit in 3 minutes.',
  deadline_1min: 'Your work will auto-submit in 1 minute.',
  explain_lastmin: 'Time is almost up. Head to the execution page.',
  deadline_passed: "Time's up. Auto-submitting...",
}

export interface WarningHooks {
  /** Called once when the current level deadline is crossed. */
  onDeadline?: () => void
  /** Called once when the final-minute warning fires (last draft flush). */
  onFinalMinute?: () => void
}

interface Props extends WarningHooks {
  levels: LevelsResponse | undefined
  progress: ProgressResponse | undefined
  nowMs: number | null
  /** When false the deadline modal stays hidden (e.g. already on dashboard). */
  deadlineModal?: boolean
}

export function EventWarnings({ levels, progress, nowMs, onDeadline, onFinalMinute, deadlineModal = true }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false)
  const firedRef = useRef<Set<string>>(new Set())

  const pointer = progress?.pointer ?? null
  const current = levels && pointer ? levels.levels.find((l) => l.level_no === pointer.level_no) ?? null : null

  const active: { key: string; moment: WarningMoment; levelNo: number | null; persistent: boolean }[] = useMemo(() => {
    const out: { key: string; moment: WarningMoment; levelNo: number | null; persistent: boolean }[] = []
    if (!levels || nowMs === null) return out

    // 2 minutes before any level starts.
    for (const l of levels.levels) {
      if (!l.starts_at) continue
      const startsIn = new Date(l.starts_at).getTime() - nowMs
      if (startsIn > 0 && startsIn <= 2 * 60_000 && !isDoneLevel(l.participant_status) && l.status !== 'active') {
        out.push({ key: `${l.level_no}:start_2min`, moment: 'start_2min', levelNo: l.level_no, persistent: false })
      }
    }

    // Deadline warnings for the pointer's level.
    if (current && pointer && pointer.node !== 'done') {
      if (!current.ends_at) return out
      const msLeft = new Date(current.ends_at).getTime() - nowMs
      if (msLeft <= 0) {
        out.push({ key: `${current.level_no}:deadline_passed`, moment: 'deadline_passed', levelNo: current.level_no, persistent: true })
      } else if (msLeft <= 60_000) {
        out.push({ key: `${current.level_no}:deadline_1min`, moment: 'deadline_1min', levelNo: current.level_no, persistent: true })
        if (pointer.node === 'explain') {
          out.push({ key: `${current.level_no}:explain_lastmin`, moment: 'explain_lastmin', levelNo: current.level_no, persistent: true })
        }
      } else if (msLeft <= 3 * 60_000) {
        out.push({ key: `${current.level_no}:deadline_3min`, moment: 'deadline_3min', levelNo: current.level_no, persistent: false })
      } else if (msLeft <= 5 * 60_000) {
        out.push({ key: `${current.level_no}:deadline_5min`, moment: 'deadline_5min', levelNo: current.level_no, persistent: false })
      }
    }
    return out
  }, [levels, current, pointer, nowMs])

  // Fire side-effect hooks exactly once per moment per session.
  useEffect(() => {
    for (const w of active) {
      if (w.moment === 'deadline_1min' && !firedRef.current.has(w.key)) {
        firedRef.current.add(w.key)
        onFinalMinute?.()
      }
      if (w.moment === 'deadline_passed' && !firedRef.current.has(w.key)) {
        firedRef.current.add(w.key)
        onDeadline?.()
        if (deadlineModal) setDeadlineModalOpen(true)
      }
    }
  }, [active, onDeadline, onFinalMinute, deadlineModal])

  const visible = active.filter((w) => !dismissed.has(w.key))

  return (
    <>
      {visible.length > 0 && (
        <div className="wstack">
          {visible.map((w) => (
            <div
              key={w.key}
              className={`banner ${w.moment === 'deadline_passed' ? 'banner-tone-danger' : 'banner-tone-warn'}`}
              role={w.persistent ? 'alert' : 'status'}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="banner-title">
                  {w.levelNo !== null && w.moment === 'start_2min' ? `Level ${w.levelNo} starts in 2 minutes.` : MOMENT_COPY[w.moment]}
                </span>
                {!w.persistent && (
                  <Button
                    size="sm"
                    ariaLabel="Dismiss warning"
                    onClick={() => setDismissed((prev) => new Set(prev).add(w.key))}
                  >
                    Dismiss
                  </Button>
                )}
              </div>
              {w.moment === 'deadline_passed' && (
                <div className="small">The server is submitting your latest saved draft. Waiting for confirmation...</div>
              )}
            </div>
          ))}
        </div>
      )}
      {deadlineModalOpen && (
        <div className="cmodal-backdrop">
          <div className="cmodal" role="alertdialog" aria-modal="true" aria-label="Deadline reached">
            <h2 className="cmodal-title">Time's up</h2>
            <div className="cmodal-body">
              <p>The deadline passed. The server is submitting the latest draft saved for this level.</p>
              <p>You will be moved forward as soon as the server confirms. This cannot be dismissed.</p>
            </div>
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {visible.length > 0 ? MOMENT_COPY[visible[visible.length - 1].moment] : ''}
      </span>
    </>
  )
}

function isDoneLevel(status: string): boolean {
  return status === 'submitted' || status === 'auto_submitted'
}
