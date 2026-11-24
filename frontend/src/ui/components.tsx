import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiRequestError } from '../lib/api'
import { countdownPhase, fmtCountdown, type CountdownPhase } from '../lib/format'
import { AlertTriangleIcon, CheckIcon, ClockIcon, CrossIcon, MagnifierIcon } from './icons'

/* ---------------- chips and stamps ---------------- */

export type Tone = 'muted' | 'signal' | 'ok' | 'warn' | 'danger' | 'info'

const TONE_CLASS: Record<Tone, string> = {
  muted: 'chip-tone-muted',
  signal: 'chip-tone-signal',
  ok: 'chip-tone-ok',
  warn: 'chip-tone-warn',
  danger: 'chip-tone-danger',
  info: 'chip-tone-info',
}

export function Chip({
  tone = 'muted',
  size = 'sm',
  children,
  title,
}: {
  tone?: Tone
  size?: 'sm' | 'lg'
  children: ReactNode
  title?: string
}) {
  return (
    <span className={`chip ${TONE_CLASS[tone]} ${size === 'lg' ? 'chip-lg' : ''}`} title={title}>
      {children}
    </span>
  )
}

/** Status word -> tone map used everywhere so the same status never changes color. */
const STATUS_TONES: Record<string, Tone> = {
  draft: 'muted',
  sealed: 'info',
  armed: 'signal',
  active: 'signal',
  live: 'signal',
  ready: 'ok',
  configured: 'info',
  paused: 'warn',
  ended: 'info',
  evaluating: 'info',
  released: 'ok',
  final: 'ok',
  closed: 'muted',
  finalized: 'muted',
  archived: 'muted',
  hidden: 'muted',
  frozen: 'info',
  public: 'ok',
  received: 'info',
  pending: 'warn',
  open: 'signal',
  claimed: 'info',
  decided: 'ok',
  checked: 'ok',
  unchecked: 'warn',
  na: 'muted',
  up: 'ok',
  down: 'danger',
  ok: 'ok',
  failed: 'danger',
  disabled: 'muted',
  enabled: 'ok',
  upheld: 'ok',
  rejected: 'danger',
  disputed: 'warn',
  rejected_auto: 'danger',
  duplicate: 'muted',
  in_review: 'info',
  needs_review: 'warn',
  matched_auto: 'ok',
  disqualified: 'danger',
}

export function StatusChip({ value, size = 'sm' }: { value: string | null | undefined; size?: 'sm' | 'lg' }) {
  if (!value) return <Chip tone="muted" size={size}>UNKNOWN</Chip>
  return (
    <Chip tone={STATUS_TONES[value] ?? 'muted'} size={size} title={`Status: ${value}`}>
      {value.replaceAll('_', ' ')}
    </Chip>
  )
}

/* ---------------- panel ---------------- */

export function Panel({
  exhibit,
  title,
  actions,
  children,
  className = '',
  bodyClassName = 'panel-body',
  as = 'section',
  ariaLabel,
}: {
  exhibit?: string
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'section' | 'div' | 'article' | 'aside'
  ariaLabel?: string
}) {
  const Tag = as
  return (
    <Tag className={`panel ${className}`} aria-label={ariaLabel}>
      {(title !== undefined || actions !== undefined || exhibit !== undefined) && (
        <div className="panel-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            {exhibit && <span className="exhibit-num">{exhibit}</span>}
            {title !== undefined && <span className="overline" style={{ color: 'var(--paper)' }}>{title}</span>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Tag>
  )
}

/* ---------------- buttons ---------------- */

export function Button({
  variant = 'ghost',
  size = 'md',
  type = 'button',
  disabled,
  onClick,
  children,
  title,
  ariaLabel,
  style,
}: {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  title?: string
  ariaLabel?: string
  style?: React.CSSProperties
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      style={style}
      className={`btn ${variant === 'primary' ? 'btn-primary' : ''} ${variant === 'danger' ? 'btn-danger' : ''} ${size === 'sm' ? 'btn-sm' : ''}`}
    >
      {children}
    </button>
  )
}

/** Two-step inline confirm: first click arms, second click fires. */
export function ConfirmButton({
  label,
  confirmLabel = 'Confirm',
  onConfirm,
  variant = 'ghost',
  disabled,
  title,
}: {
  label: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 6000)
    return () => window.clearTimeout(t)
  }, [armed])
  if (!armed) {
    return (
      <Button variant={variant} size="sm" disabled={disabled} title={title} onClick={() => setArmed(true)}>
        {label}
      </Button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Button variant={variant === 'ghost' ? 'primary' : variant} size="sm" onClick={() => { setArmed(false); onConfirm() }}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  )
}

/* ---------------- fields ---------------- */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label} {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  )
}

/* ---------------- states ---------------- */

export function EmptyState({ title, note, action }: { title: string; note?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <MagnifierIcon size={22} strokeWidth={1.25} />
      <div className="mono">{title}</div>
      {note && <div className="small" style={{ maxWidth: '52ch' }}>{note}</div>}
      {action}
    </div>
  )
}

export function LoadingShell({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading-shell" role="status">
      <span>{label}</span>
    </div>
  )
}

export function LoadingLine({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="loading-inline" role="status">
      {label}
    </span>
  )
}

export function ErrorBanner({
  error,
  title = 'Request failed',
  onRetry,
}: {
  error: unknown
  title?: string
  onRetry?: () => void
}) {
  const isErr = error instanceof ApiRequestError
  const network = isErr && error.network
  const code = isErr ? error.code : 'UNKNOWN'
  const message = isErr ? error.serverMessage : 'Something went wrong while loading this view.'
  const requestId = isErr ? error.requestId : ''
  return (
    <div className={`banner ${network ? 'banner-tone-warn' : 'banner-tone-danger'}`} role="alert">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <AlertTriangleIcon size={15} />
        <span className="banner-title">{network ? 'Connection problem' : title}</span>
      </div>
      <div className="small">{message}</div>
      <div className="banner-code">
        code: {code}
        {requestId ? ` · request: ${requestId}` : ''}
      </div>
      {onRetry && (
        <div>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------------- countdown ---------------- */

/** 1 Hz tick; consumers compute from a stored server-clock offset. */
export function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function CountdownTimer({
  targetMs,
  nowMs,
  label,
  prefix,
}: {
  targetMs: number | null
  nowMs: number
  label?: string
  prefix?: string
}) {
  const msLeft = targetMs === null ? null : targetMs - nowMs
  const phase: CountdownPhase = countdownPhase(msLeft)
  const text = phase === 'expired' ? '00:00:00' : fmtCountdown(msLeft)
  const announced = useRef<CountdownPhase>('idle')
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    if (phase === 'warning' && announced.current !== 'warning') {
      announced.current = 'warning'
      setAnnounce('10 minutes remaining')
    } else if (phase === 'critical' && announced.current !== 'critical') {
      announced.current = 'critical'
      setAnnounce('2 minutes remaining')
    } else if (phase === 'expired' && announced.current !== 'expired') {
      announced.current = 'expired'
      setAnnounce('Time is up')
    }
  }, [phase])

  const cls = phase === 'critical' ? 'countdown-critical pulse' : phase === 'warning' ? 'countdown-warn pulse' : ''

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {label && <span className="overline">{label}</span>}
      <span className={`countdown ${cls}`} style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>
        {prefix}
        {text}
      </span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  )
}

/* ---------------- plain markdown-as-text renderer ---------------- */

/**
 * Renders the rules document as styled PLAIN text: headings, bullet lists,
 * numbered lines and paragraphs. Never builds HTML from the source string.
 */
export function PlainMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.replaceAll('\r\n', '\n').split('\n')
    type Block =
      | { type: 'h1' | 'h2' | 'p'; text: string }
      | { type: 'ul'; items: string[] }
    const out: Block[] = []
    let bullets: string[] = []
    const flushBullets = () => {
      if (bullets.length > 0) {
        out.push({ type: 'ul', items: bullets })
        bullets = []
      }
    }
    for (const raw of lines) {
      const line = raw.trimEnd()
      const trimmed = line.trim()
      if (trimmed.startsWith('# ')) {
        flushBullets()
        out.push({ type: 'h1', text: trimmed.slice(2).trim() })
      } else if (trimmed.startsWith('## ')) {
        flushBullets()
        out.push({ type: 'h2', text: trimmed.slice(3).trim() })
      } else if (trimmed.startsWith('### ')) {
        flushBullets()
        out.push({ type: 'h2', text: trimmed.slice(4).trim() })
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        bullets.push(trimmed.slice(2).trim())
      } else if (trimmed.length === 0) {
        flushBullets()
      } else {
        flushBullets()
        out.push({ type: 'p', text: trimmed })
      }
    }
    flushBullets()
    return out
  }, [text])

  return (
    <div className="rules-text">
      {blocks.map((b, i) => {
        if (b.type === 'h1') return <h1 key={i}>{b.text}</h1>
        if (b.type === 'h2') return <h2 key={i}>{b.text}</h2>
        if (b.type === 'ul')
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )
        return <p key={i}>{b.text}</p>
      })}
    </div>
  )
}

/* ---------------- data rows ---------------- */

export function KVRow({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val" style={mono ? undefined : { fontFamily: 'var(--font-ui)' }}>
        {v}
      </span>
    </div>
  )
}

/** Numbered case-file section heading: "01 / THE BRIEF". */
export function SectionHeading({ num, title, note, id }: { num: string; title: string; note?: ReactNode; id?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <span className="exhibit-num" style={{ fontSize: 13 }}>{num}</span>
      <h2 className="display" id={id} style={{ margin: 0 }}>{title}</h2>
      {note && <span className="overline">{note}</span>}
    </div>
  )
}

/** Readiness row with a plain check or cross mark, never color alone. */
export function CheckRow({
  ok,
  label,
  detail,
  action,
}: {
  ok: boolean | null
  label: string
  detail?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="kv-row" style={{ alignItems: 'flex-start' }}>
      <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
        {ok === null ? (
          <ClockIcon size={15} className="muted" />
        ) : ok ? (
          <CheckIcon size={15} style={{ color: 'var(--ok)', marginTop: 3 }} />
        ) : (
          <CrossIcon size={15} style={{ color: 'var(--danger)', marginTop: 3 }} />
        )}
        <span>
          <span style={{ display: 'block' }}>{label}</span>
          {detail && <span className="muted small" style={{ display: 'block' }}>{detail}</span>}
        </span>
      </span>
      {action && <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{action}</span>}
    </div>
  )
}
