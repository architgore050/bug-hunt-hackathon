// Event session state: server-anchored clock, polling hooks for the
// four-level flow, and the pure Continue/Resume derivation.
//
// Rules encoded here:
// - GET /v1/progress and GET /v1/levels are the only sources for the current
//   node; the browser never decides progression locally.
// - Polling follows the documented defaults: 5 s while a level window is
//   armed/active, 30 s otherwise.
// - Wall-clock display uses a server-clock offset estimate (display only).

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api'
import {
  fetchLevels,
  fetchProgress,
  fetchTeam,
  fetchTeamPoints,
  isDoneStatus,
} from './api-levels'
import type {
  LevelStatus,
  LevelsResponse,
  ProgressResponse,
  TeamPointsResponse,
  TeamResponse,
} from './api-levels'
import type { Announcement, TimeResponse } from './types'
import { clockOffset } from './format'

/* ---------- server clock ---------- */

const OFFSET_KEY = ['server-clock-offset'] as const
const OFFSET_STORE = 'bhctf.clock_offset_ms'

function readCachedOffset(): number | null {
  try {
    const raw = window.sessionStorage.getItem(OFFSET_STORE)
    if (raw !== null) return Number(raw)
  } catch {
    // Session storage may be unavailable; fall through to the live estimate.
  }
  return null
}

/**
 * Estimates the browser-to-server clock offset from GET /v1/time and keeps a
 * 1 Hz server-anchored "now". Display only; every server decision re-reads
 * server state.
 */
export function useServerNow(): number | null {
  const offsetQuery = useQuery({
    queryKey: OFFSET_KEY,
    queryFn: async (): Promise<number> => {
      const t = await api<TimeResponse>('/v1/time')
      return clockOffset(t.server_time)
    },
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const [now, setNow] = useState<number | null>(null)
  const offset = offsetQuery.data ?? readCachedOffset()

  useEffect(() => {
    if (offsetQuery.data !== undefined) {
      try {
        window.sessionStorage.setItem(OFFSET_STORE, String(offsetQuery.data))
      } catch {
        // Non-fatal: the in-memory estimate still covers this session.
      }
    }
  }, [offsetQuery.data])

  useEffect(() => {
    if (offset === null) return
    setNow(Date.now() + offset)
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000)
    return () => window.clearInterval(id)
  }, [offset])

  return now
}

/* ---------- polling hooks ---------- */

/** True while any level stage is armed/active (the "during levels" mode). */
export function isDuringLevels(levels: LevelsResponse | null | undefined): boolean {
  if (!levels) return false
  return levels.levels.some((l) => l.status === 'armed' || l.status === 'active')
}

export function useLevelsQuery() {
  return useQuery({
    queryKey: ['levels'],
    queryFn: fetchLevels,
    refetchInterval: (query) => {
      const data = query.state.data as LevelsResponse | undefined
      return isDuringLevels(data) ? 5000 : 30000
    },
    staleTime: 4000,
  })
}

export function useProgressQuery() {
  return useQuery({
    queryKey: ['progress'],
    queryFn: fetchProgress,
    refetchInterval: (query) => {
      const data = query.state.data as ProgressResponse | undefined
      const current = data?.levels.find((l) => data.pointer !== null && l.level_no === data.pointer.level_no)
      const busy =
        data !== undefined &&
        data.pointer !== null &&
        data.pointer.node !== 'done' &&
        (current === undefined || !isDoneStatus(current.status))
      return busy ? 5000 : 30000
    },
    staleTime: 4000,
  })
}

export function useTeamQuery() {
  return useQuery({
    queryKey: ['team'],
    queryFn: fetchTeam,
    refetchInterval: 30000,
    staleTime: 5000,
  })
}

export function useTeamPointsQuery() {
  return useQuery({
    queryKey: ['team-points'],
    queryFn: fetchTeamPoints,
    refetchInterval: (query) => {
      const data = query.state.data as TeamPointsResponse | undefined
      return data && !data.released ? 5000 : 30000
    },
    staleTime: 4000,
  })
}

export function useAnnouncementsQuery() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<{ announcements: Announcement[] }>('/v1/announcements?limit=50'),
    refetchInterval: 30000,
    staleTime: 10000,
  })
}

/* ---------- Continue / Resume derivation (pure) ---------- */

export interface ResumeTarget {
  kind: 'pre_event' | 'explain' | 'exec' | 'completed' | 'unknown'
  /** Human label for the single primary dashboard action. */
  label: string
  /** Route target, or null when the action is not navigable yet. */
  target: string | null
  level_no: number | null
  node: 'explain' | 'exec' | null
  /** Server-provided explanation for a non-navigable action. */
  note: string | null
}

/**
 * Derives the single primary Continue/Resume action from server state only.
 * The dashboard renders exactly what this returns; no local completion flags,
 * no URL history, no hard-coded sequence.
 */
export function deriveResume(progress: ProgressResponse | null | undefined, levels: LevelsResponse | null | undefined): ResumeTarget {
  if (!progress || !levels) {
    return { kind: 'unknown', label: 'Loading progress', target: null, level_no: null, node: null, note: null }
  }
  const pointer = progress.pointer
  if (!pointer) {
    return { kind: 'unknown', label: 'Loading progress', target: null, level_no: null, node: null, note: null }
  }
  if (pointer.node === 'done') {
    return {
      kind: 'completed',
      label: 'Event complete',
      target: null,
      level_no: 4,
      node: null,
      note: 'All four levels are submitted. Results appear here as evaluations finish.',
    }
  }

  const summary = levels.levels.find((l) => l.level_no === pointer.level_no)
  const levelNo = pointer.level_no

  // Pre-event: the pointer exists but the level window is not armed/active yet.
  const stageNotOpen = summary ? summary.status === 'draft' || summary.status === 'sealed' : false
  if (stageNotOpen) {
    const opens = summary?.starts_at ? `The level opens at ${summary.starts_at}.` : 'The schedule has not been published yet.'
    return { kind: 'pre_event', label: 'Waiting for the event to start', target: null, level_no: levelNo, node: pointer.node, note: opens }
  }

  if (pointer.node === 'explain') {
    const fresh = summary?.participant_status === 'available'
    const label = fresh ? `Continue to Level ${levelNo}` : `Resume Level ${levelNo} explanation`
    return { kind: 'explain', label, target: `/level/${levelNo}/explain`, level_no: levelNo, node: 'explain', note: null }
  }

  // exec node
  return {
    kind: 'exec',
    label: `Resume Level ${levelNo} workspace`,
    target: `/level/${levelNo}/run`,
    level_no: levelNo,
    node: 'exec',
    note: null,
  }
}

/** Per-level status -> short participant-facing description (server statuses verbatim). */
export function levelStatusLabel(status: LevelStatus | string | null | undefined): string {
  switch (status) {
    case 'locked':
      return 'Locked'
    case 'available':
      return 'Available'
    case 'in_progress':
      return 'In progress'
    case 'submitted':
      return 'Submitted'
    case 'auto_submitted':
      return 'Auto-submitted'
    case 'missed':
      return 'Missed'
    default:
      return status ? String(status).replaceAll('_', ' ') : 'Unknown'
  }
}

// Re-export for dashboard convenience.
export type { TeamResponse }
