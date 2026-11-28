import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icons'

export type Tone = 'neutral' | 'signal' | 'ok' | 'warn' | 'danger' | 'info'

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`ar-chip ar-chip--${tone}`}>{children}</span>
}

const statusTone: Record<string, Tone> = {
  draft: 'neutral', submitted: 'info', 'under-review': 'warn', accepted: 'ok',
  rejected: 'danger', duplicate: 'neutral',
  completed: 'ok', active: 'signal', upcoming: 'info', locked: 'neutral',
  answered: 'ok', 'under-review-question': 'warn', sample: 'info',
}

const statusLabel: Record<string, string> = {
  'under-review': 'Under review',
}

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={statusTone[status] || 'neutral'}>{statusLabel[status] || status}</Chip>
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  children: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`ar-btn ar-btn--${variant} ar-btn--${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  )
}

export function Panel({ eyebrow, title, action, children, className = '' }: {
  eyebrow?: string
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`ar-panel ${className}`}>
      {(eyebrow || title || action) && (
        <header className="ar-panel__head">
          <div>
            {eyebrow && <div className="ar-overline">{eyebrow}</div>}
            {title && <h2 className="ar-panel__title">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className="ar-panel__body">{children}</div>
    </section>
  )
}

export function Field({ label, hint, required, error, children, htmlFor }: {
  label: string
  hint?: string
  required?: boolean
  error?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label className="ar-field" htmlFor={htmlFor}>
      <span className="ar-field__label">
        {label}{required && <span className="ar-field__req">required</span>}
      </span>
      {children}
      {error ? <span className="ar-field__error">{error}</span> : hint && <span className="ar-field__hint">{hint}</span>}
    </label>
  )
}

export function Progress({ value, total, tone = 'signal' }: { value: number; total: number; tone?: Tone }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="ar-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={total}>
      <div className={`ar-progress__fill ar-progress__fill--${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: Array<{ id: T; label: string; icon?: IconName; disabled?: boolean }>
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="ar-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={active === tab.id}
          className={`ar-tab ${active === tab.id ? 'is-active' : ''}`}
          disabled={tab.disabled} onClick={() => onChange(tab.id)}>
          {tab.icon && <Icon name={tab.icon} size={13} />}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({ title, eyebrow, onClose, children, footer, wide = false }: {
  title: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="ar-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className={`ar-modal ${wide ? 'ar-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}>
        <header className="ar-modal__head">
          <div>
            {eyebrow && <div className="ar-overline">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button className="ar-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="ar-modal__body">{children}</div>
        {footer && <footer className="ar-modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

/** Participant content is rendered as text nodes only, never as HTML. */
export function PlainText({ text }: { text: string }) {
  return <div className="ar-plaintext">{text.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</div>
}

export function Empty({ icon = 'inbox', title, body }: { icon?: IconName; title: string; body: string }) {
  return (
    <div className="ar-empty">
      <Icon name={icon} size={22} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: Tone }) {
  return (
    <div className="ar-stat">
      <span className="ar-stat__label">{label}</span>
      <span className={`ar-stat__value ${tone ? `is-${tone}` : ''}`}>{value}</span>
      {sub && <span className="ar-stat__sub">{sub}</span>}
    </div>
  )
}

export function Movement({ value }: { value: 'up' | 'down' | 'flat' }) {
  const icon = value === 'up' ? 'arrow-up' : value === 'down' ? 'arrow-down' : 'dash'
  const tone = value === 'up' ? 'ok' : value === 'down' ? 'danger' : 'neutral'
  return <span className={`ar-movement is-${tone}`}><Icon name={icon} size={13} />{value === 'flat' ? 'steady' : value}</span>
}
