import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../ui/components'
import { CrossIcon } from '../ui/icons'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'signal' | 'muted'

export function StatusDot({ tone = 'muted', label }: { tone?: Tone; label: string }) {
  return (
    <span className={`status-dot ${tone}`}>
      <span>{label}</span>
    </span>
  )
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: `var(--${tone === 'muted' ? 'muted' : tone === 'signal' ? 'signal' : tone})` } : undefined}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  actions,
  wide,
  labelledBy,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
  labelledBy?: string
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <Button size="sm" ariaLabel="Close dialog" onClick={onClose}><CrossIcon size={14} /></Button>
        </div>
        <div>{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={(
        <>
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {message && <p className="muted small" style={{ margin: 0 }}>{message}</p>}
      {children}
    </Modal>
  )
}

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize?: (n: number) => void
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pages)
  return (
    <div className="admin-pagination">
      <span className="muted small mono">
        {total === 0 ? '0' : `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, total)}`} of {total}
      </span>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" disabled={safePage <= 1} onClick={() => onPage(1)}>First</Button>
        <Button size="sm" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>Prev</Button>
        <span className="mono small">page {safePage} / {pages}</span>
        <Button size="sm" disabled={safePage >= pages} onClick={() => onPage(safePage + 1)}>Next</Button>
        <Button size="sm" disabled={safePage >= pages} onClick={() => onPage(pages)}>Last</Button>
        {onPageSize && (
          <select className="select" style={{ width: 'auto' }} aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        )}
      </span>
    </div>
  )
}

export function Sparkline({ data, width = 120, height = 32, tone = 'var(--signal)' }: { data: number[]; width?: number; height?: number; tone?: string }) {
  if (data.length === 0) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = data.length > 1 ? width / (data.length - 1) : width
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`).join(' ')
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" stroke={tone} strokeWidth={1.25} strokeLinejoin="miter" strokeLinecap="square" />
    </svg>
  )
}

export interface Toast {
  id: number
  title: string
  body?: string
  kind: 'info' | 'success' | 'warning' | 'critical'
}

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

let toastSeq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastSeq
    setToasts((cur) => [...cur, { ...t, id }])
    window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 4500)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role="status">
            <span className="toast-title">{t.title}</span>
            {t.body && <span>{t.body}</span>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

export function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  numeric,
}: {
  label: string
  sortKey: string
  current: string
  dir: 'asc' | 'desc'
  onSort: (key: string) => void
  numeric?: boolean
}) {
  const active = current === sortKey
  return (
    <th scope="col" className={numeric ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden="true" className="muted">{active ? (dir === 'asc' ? '^' : 'v') : ''}</span>
      </button>
    </th>
  )
}
