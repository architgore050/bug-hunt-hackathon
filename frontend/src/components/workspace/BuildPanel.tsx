// Build and run panel for the levels 3 and 4 workspace.
//
// Honesty rules: when the runner is disabled the panel says so plainly and
// never borrows danger styling (an unavailable runner is an expected state,
// not an error). Output is rendered as plain text nodes inside a <pre> only,
// never as HTML.

import { Chip, LoadingLine, Panel } from '../../ui/components'
import './editable.css'
import type { JSX } from 'react'
import type { ReactNode } from 'react'
import type { Tone } from '../../ui/components'

export type RunState = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unavailable'

/** Chip tone per run state; absent means no chip is shown. */
const RUN_TONES: Partial<Record<RunState, Tone>> = {
  queued: 'info',
  running: 'signal',
  succeeded: 'ok',
  failed: 'danger',
  cancelled: 'muted',
  unavailable: 'muted',
}

/** sr-only polite announcements for state transitions. */
const RUN_ANNOUNCEMENTS: Partial<Record<RunState, string>> = {
  queued: 'Run queued',
  running: 'Run started',
  succeeded: 'Run succeeded',
  failed: 'Run failed',
  cancelled: 'Run cancelled',
  unavailable: 'Running code is unavailable',
}

export function BuildPanel(props: {
  runnerEnabled: boolean | null
  runState?: RunState
  runOutput?: string | null
  onRun?: () => void
  notice?: string | null
}): JSX.Element {
  const { runnerEnabled, runState = 'idle', runOutput = null, onRun, notice = null } = props

  let body: ReactNode
  let actions: ReactNode = null

  if (runnerEnabled === null) {
    body = <LoadingLine label="Checking runner availability" />
  } else if (runnerEnabled === false) {
    body = (
      <div className="bpan-disabled">
        <span>Running code is unavailable right now.</span>
        {notice && <span className="small muted">{notice}</span>}
      </div>
    )
    actions = (
      <Chip tone="muted" title="Runner disabled for this workspace">
        disabled
      </Chip>
    )
  } else {
    const tone = RUN_TONES[runState]
    actions = (
      <>
        {runState !== 'idle' && tone && <Chip tone={tone}>{runState}</Chip>}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onRun}
          disabled={typeof onRun !== 'function'}
        >
          Run
        </button>
      </>
    )
    body = runOutput ? (
      <pre className="bpan-output">{runOutput}</pre>
    ) : (
      <span className="small muted">No output yet. Run the workspace code to see stdout and stderr here.</span>
    )
  }

  return (
    <Panel
      ariaLabel="Build output"
      title="Build and run"
      actions={actions}
      bodyClassName="panel-body"
      as="section"
    >
      {body}
      <span className="sr-only" aria-live="polite">
        {RUN_ANNOUNCEMENTS[runState] ?? ''}
      </span>
    </Panel>
  )
}
