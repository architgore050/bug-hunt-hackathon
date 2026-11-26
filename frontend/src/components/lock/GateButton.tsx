// Level gate entry button.
//
// The gate answer is authoritative at call time, so the component polls
// GET /v1/levels/{n}/gate every 5 seconds while mounted and always refetches
// on mount. The Start button is enabled only while gate.allowed is true; the
// server re-checks on entry, so a stale allowed poll is harmless. A polite
// live region announces the blocked to allowed transition.

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchGate } from '../../lib/api-levels'
import { Button, ErrorBanner } from '../../ui/components'

const GATE_POLL_MS = 5_000

export interface GateButtonProps {
  levelNo: number
  /** Button text when the gate allows entry (default "Start"). */
  label?: string
  /** Parent navigates to the run route; the server re-checks on entry. */
  onEnter: () => void
}

export function GateButton({ levelNo, label = 'Start', onEnter }: GateButtonProps) {
  const gateQ = useQuery({
    queryKey: ['level-gate', levelNo],
    queryFn: () => fetchGate(levelNo),
    refetchInterval: GATE_POLL_MS,
    refetchOnMount: 'always',
  })

  const prevAllowed = useRef<boolean | null>(null)
  const [announce, setAnnounce] = useState('')

  // Announce only a real blocked -> allowed transition, never the first load.
  useEffect(() => {
    const allowed = gateQ.data?.allowed
    if (typeof allowed !== 'boolean') return
    if (prevAllowed.current === false && allowed) setAnnounce('You can start now')
    prevAllowed.current = allowed
  }, [gateQ.data])

  const gate = gateQ.data ?? null
  const waiting = gate?.waiting_on ?? []
  const waitingLine = waiting.map((w) => `${w.name} (${w.status})`).join(', ')

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      {gateQ.isPending && (
        <Button variant="primary" disabled>
          Checking...
        </Button>
      )}

      {gate && gate.allowed && (
        <Button variant="primary" onClick={onEnter}>
          {label}
        </Button>
      )}

      {gate && !gate.allowed && waiting.length > 0 && (
        <>
          <Button variant="primary" disabled>
            Waiting for teammates
          </Button>
          <span className="small muted">
            Waiting for {waiting.length} teammate(s): {waitingLine}
          </span>
        </>
      )}

      {gate && !gate.allowed && waiting.length === 0 && (
        <>
          <Button variant="primary" disabled>
            Not available yet
          </Button>
          {gate.reason && (
            <span className="small muted">
              {gate.reason}
            </span>
          )}
        </>
      )}

      {gateQ.isError && (
        <ErrorBanner error={gateQ.error} title="Gate check failed" onRetry={() => void gateQ.refetch()} />
      )}

      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  )
}
