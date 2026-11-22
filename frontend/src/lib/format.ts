// Formatting helpers. All wall-clock rendering uses Asia/Kolkata (IST).

const IST = 'Asia/Kolkata'

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const fullFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'not set'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'not set'
  return `${dateFmt.format(d)} IST`
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${timeFmt.format(d)} IST`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'not set'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'not set'
  return `${fullFmt.format(d)} IST`
}

/** Split a proposed date (no live event published) into IST parts. */
export function proposedDateLabel(): string {
  // 6 December 2026, morning session, Asia/Kolkata. Displayed as the
  // proposed date from the club proposal until the event record publishes.
  const d = new Date('2026-12-06T10:00:00+05:30')
  return `${fullFmt.format(d)} IST`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

export function fmtPoints(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '0'
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

/** Milliseconds between the server clock and this browser at fetch time. */
export function clockOffset(serverIso: string): number {
  return new Date(serverIso).getTime() - Date.now()
}

export function nowWithOffset(offsetMs: number): number {
  return Date.now() + offsetMs
}

export type CountdownPhase = 'idle' | 'normal' | 'warning' | 'critical' | 'expired'

export function countdownPhase(msLeft: number | null): CountdownPhase {
  if (msLeft === null) return 'idle'
  if (msLeft <= 0) return 'expired'
  if (msLeft <= 2 * 60_000) return 'critical'
  if (msLeft <= 10 * 60_000) return 'warning'
  return 'normal'
}

/** hh:mm:ss (or d hh:mm:ss beyond 24h), never negative. */
export function fmtCountdown(msLeft: number | null): string {
  if (msLeft === null) return '--:--:--'
  const s = Math.max(0, Math.floor(msLeft / 1000))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days > 0) return `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`
}
