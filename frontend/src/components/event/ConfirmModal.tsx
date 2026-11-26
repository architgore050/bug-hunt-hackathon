// Accessible confirmation modal for irreversible actions (repo lock, level
// submit, destructive edits).
//
// - Focus is trapped; the SAFE action receives initial focus.
// - Escape and backdrop click map to the safe action.
// - Optional cooldown (repo lock uses 7 s): the confirm button stays disabled
//   and a polite live region announces the remaining seconds, then readiness.
// - Focus returns to the previously focused element on close.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export const REPO_LOCK_COOLDOWN_S = 7

interface ConfirmModalProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** Seconds before the confirm button enables (default 0). */
  cooldownSeconds?: number
  confirmVariant?: 'primary' | 'danger'
  /** While confirming the server action; keeps the dialog open, disables buttons. */
  busy?: boolean
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'No, wait',
  onConfirm,
  onCancel,
  cooldownSeconds = 0,
  confirmVariant = 'primary',
  busy = false,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(cooldownSeconds)
  const [announce, setAnnounce] = useState('')

  // Reset cooldown each time the dialog opens.
  useEffect(() => {
    if (open) setCooldownLeft(cooldownSeconds)
  }, [open, cooldownSeconds])

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.()
    }
  }, [open])

  // Cooldown ticker with polite announcements.
  useEffect(() => {
    if (!open || cooldownLeft <= 0) return
    const id = window.setTimeout(() => {
      setCooldownLeft((s) => s - 1)
    }, 1000)
    return () => window.clearTimeout(id)
  }, [open, cooldownLeft])

  useEffect(() => {
    if (!open) return
    if (cooldownSeconds > 0) {
      if (cooldownLeft > 0) setAnnounce(`${confirmLabel} available in ${cooldownLeft} seconds.`)
      else setAnnounce(`${confirmLabel} is available now.`)
    }
  }, [open, cooldownLeft, cooldownSeconds, confirmLabel])

  const trapFocus = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const container = dialogRef.current
    if (!container) return
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onCancel()
      return
    }
    trapFocus(e)
  }

  if (!open) return null

  return (
    <div
      className="cmodal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div ref={dialogRef} className="cmodal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <h2 className="cmodal-title">{title}</h2>
        <div className="cmodal-body">{children}</div>
        <div className="cmodal-actions">
          <button
            type="button"
            ref={cancelRef}
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || cooldownLeft > 0}
            aria-disabled={cooldownLeft > 0}
            title={cooldownLeft > 0 ? `Available in ${cooldownLeft}s` : undefined}
          >
            {cooldownLeft > 0 ? `${confirmLabel} (${cooldownLeft})` : confirmLabel}
          </button>
        </div>
        {cooldownSeconds > 0 && (
          <span className="sr-only" aria-live="polite">
            {announce}
          </span>
        )}
      </div>
    </div>
  )
}
