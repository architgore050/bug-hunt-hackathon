// Repository lock section for Level 1.
//
// Renders the canonical server state for everyone: once team.repo_option is
// locked (from either the team or the level content response) every member,
// lead or not, sees the same locked banner and no controls. While unlocked,
// only the lead gets selectable option cards, a permanence checkbox and the
// cooldown confirm modal. Locking is idempotent: one key is generated when
// the modal opens and every retry reuses it, so a lost response replays the
// same attempt instead of creating a second one.

import { useCallback, useId, useRef, useState } from 'react'
import { ApiRequestError, newIdempotencyKey } from '../../lib/api'
import { lockRepoWithKey } from '../../lib/api-levels'
import type { LevelContentResponse, TeamResponse } from '../../lib/api-levels'
import { Button, Chip, ErrorBanner } from '../../ui/components'
import { ConfirmModal, REPO_LOCK_COOLDOWN_S } from '../event/ConfirmModal'
import './lock.css'

export interface RepoLockSectionProps {
  levelContent: LevelContentResponse
  team: TeamResponse | null
  /** Parent refetches team + level content after any server-side change. */
  onServerChange: () => void
}

type LockFailure =
  | { kind: 'already-locked'; option: string | null }
  | { kind: 'conflict' }
  | { kind: 'forbidden'; error: ApiRequestError }
  | { kind: 'retryable'; error: unknown; option: string }

/** details.option from the REPO_ALREADY_LOCKED envelope, when present. */
function lockedOptionFromDetails(details: Record<string, unknown>): string | null {
  const raw = details['option']
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

export function RepoLockSection({ levelContent, team, onServerChange }: RepoLockSectionProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<LockFailure | null>(null)

  // One idempotency key per modal opening; retries on network failure and
  // unknown server errors reuse it so the server can replay the attempt.
  const keyRef = useRef<string | null>(null)

  const checkboxId = useId()
  const radioGroupName = useId()

  const options = levelContent.repo_options
  const isLead = levelContent.is_lead

  const teamLock = team?.repo_option ?? null
  const contentLock = levelContent.repo_option ?? null
  const lockedKey = teamLock?.option_key ?? contentLock?.option_key ?? null
  const lockedTitle = teamLock?.title ?? contentLock?.title ?? null
  const lockedByName = teamLock?.locked_by_name ?? null

  const selectedLabel = options.find((o) => o.option_key === selected)?.label ?? null

  const attemptLock = useCallback(
    async (option: string) => {
      const key = keyRef.current
      if (!key) return
      setBusy(true)
      setFailure(null)
      try {
        await lockRepoWithKey(option, key)
        setBusy(false)
        setModalOpen(false)
        setSelected(null)
        setConfirmed(false)
        onServerChange()
      } catch (err) {
        setBusy(false)
        setModalOpen(false)
        if (err instanceof ApiRequestError && err.code === 'REPO_ALREADY_LOCKED') {
          setFailure({ kind: 'already-locked', option: lockedOptionFromDetails(err.details) })
          onServerChange()
        } else if (err instanceof ApiRequestError && err.code === 'IDEMPOTENCY_CONFLICT') {
          setFailure({ kind: 'conflict' })
        } else if (err instanceof ApiRequestError && err.code === 'AUTH_FORBIDDEN') {
          setFailure({ kind: 'forbidden', error: err })
        } else {
          setFailure({ kind: 'retryable', error: err, option })
        }
      }
    },
    [onServerChange],
  )

  const openModal = () => {
    if (!selected) return
    keyRef.current = newIdempotencyKey()
    setFailure(null)
    setModalOpen(true)
  }

  const selectOption = (key: string) => {
    setSelected(key)
    setFailure(null)
  }

  /* ---------- locked: one canonical view for everyone ---------- */
  if (lockedKey !== null) {
    return (
      <div className="banner banner-tone-ok" role="status">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="banner-title">Locked: Option {lockedKey}</span>
          <Chip tone="ok">Locked</Chip>
        </div>
        {lockedTitle && <div className="small">{lockedTitle}</div>}
        {lockedByName && <div className="small">Locked by {lockedByName}</div>}
      </div>
    )
  }

  /* ---------- unlocked, non-lead: read-only ---------- */
  if (!isLead) {
    return (
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>
          Your team lead will choose the repository. Levels unlock for everyone once it is locked.
        </p>
        <div className="repo-options">
          {options.map((o) => (
            <div key={o.option_key} className="repo-card repo-card-disabled" aria-disabled="true">
              <span className="repo-card-body">
                <span className="repo-card-title">Option {o.option_key}: {o.label}</span>
                <span className="repo-card-desc">{o.description}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  /* ---------- unlocked, lead: selection + confirmation ---------- */
  return (
    <div className="stack">
      <div role="group" aria-label="Repository options" className="repo-options">
        {options.map((o) => (
          <label
            key={o.option_key}
            className={`repo-card${selected === o.option_key ? ' repo-card-selected' : ''}`}
          >
            <input
              type="radio"
              name={radioGroupName}
              className="repo-radio"
              value={o.option_key}
              checked={selected === o.option_key}
              disabled={busy}
              onChange={() => selectOption(o.option_key)}
            />
            <span className="repo-card-body">
              <span className="repo-card-title">Option {o.option_key}: {o.label}</span>
              <span className="repo-card-desc">{o.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="banner banner-tone-warn" role="note">
        <span className="banner-title">Caution</span>
        <div className="small">Choose one repo to work with throughout this entire event. It can't be changed at any cost!</div>
      </div>

      <div className="checkbox-row">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <label htmlFor={checkboxId}>I understand this choice is permanent</label>
      </div>

      {failure?.kind === 'already-locked' && (
        <div className="banner banner-tone-info" role="status">
          <span className="banner-title">Already locked</span>
          <div className="small">
            {failure.option
              ? `The repository was already locked to Option ${failure.option}. Showing the locked choice.`
              : 'The repository was already locked by a teammate lead. Showing the locked choice.'}
          </div>
        </div>
      )}
      {failure?.kind === 'conflict' && (
        <div className="banner banner-tone-danger" role="alert">
          <span className="banner-title">Attempt conflict</span>
          <div className="small">A different option was already submitted with this attempt. Refresh the page to see the current state.</div>
        </div>
      )}
      {failure?.kind === 'forbidden' && <ErrorBanner error={failure.error} title="Not allowed" />}
      {failure?.kind === 'retryable' && (
        <ErrorBanner
          error={failure.error}
          title="Lock failed"
          onRetry={() => void attemptLock(failure.option)}
        />
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" disabled={!selected || !confirmed || busy} onClick={openModal}>
          Lock the repository
        </Button>
        {busy && <span className="loading-inline" role="status">Locking...</span>}
      </div>

      <ConfirmModal
        open={modalOpen}
        title="Lock your repository?"
        confirmLabel="Yes, confirm"
        cancelLabel="No, wait"
        cooldownSeconds={REPO_LOCK_COOLDOWN_S}
        busy={busy}
        onConfirm={() => {
          if (selected) void attemptLock(selected)
        }}
        onCancel={() => {
          if (!busy) setModalOpen(false)
        }}
      >
        <p style={{ margin: 0 }}>
          You are locking <strong>Option {selected}</strong>
          {selectedLabel ? `: ${selectedLabel}` : ''}. This choice applies to your whole team for
          the rest of the event and cannot be changed later.
        </p>
      </ConfirmModal>
    </div>
  )
}
