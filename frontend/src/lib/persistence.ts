// Durable workspace persistence per (user, level) and reconciliation with the
// server draft.
//
// Rules encoded here:
// - Local workspace state lives in IndexedDB only (database 'bhctf', store
//   'workspace', array key ['userId', 'levelNo']). Cookies are never used for
//   workspace state, and credentials or answer keys are never persisted here.
// - The module is SSR safe: browser globals are touched only inside
//   functions, so importing it under Node cannot crash, and every IndexedDB
//   entry point fails with a clear Error('IndexedDB unavailable') when the
//   API is absent.
// - Reconciliation is pure and never silently discards the newest draft: when
//   both sides are recent (within 5 s) but their content differs, the outcome
//   is a conflict carrying the newer state so the UI can ask the participant.

import type { FlagDraft } from './api-levels'

/* ---------- schema ---------- */

export const WORKSPACE_SCHEMA_VERSION = 1

export interface WorkspacePersistedState {
  schemaVersion: 1
  userId: string
  levelNo: number
  /** Open file paths in display order. */
  tabs: string[]
  activePath: string | null
  scrollPositions: Record<string, number>
  selection: { path: string; start: number; end: number } | null
  /** L1-2 structured flag drafts; null when the level does not use them. */
  flags: FlagDraft[] | null
  /** L3-4 edited file contents keyed by path; null when the level does not use them. */
  files: Record<string, string> | null
  /** Epoch ms of the last local write; 0 for a fresh state. */
  updatedAt: number
}

/** Shape of the draft payload served by GET /v1/levels/{n}/draft and WorkspaceResponse.draft. */
export interface ServerDraft {
  payload: Record<string, unknown>
  version: number
  updated_at: string | null
}

export type ReconcileOutcome =
  | { chosen: 'local' | 'server'; state: WorkspacePersistedState }
  | { chosen: 'conflict'; state: WorkspacePersistedState | null }

/* ---------- IndexedDB access (lazy, browser only) ---------- */

const DB_NAME = 'bhctf'
const DB_VERSION = 1
const STORE_NAME = 'workspace'
const STORE_KEY_PATH = ['userId', 'levelNo']

// Open connection cache; dropped on versionchange so the next access reopens
// at the current schema version.
let databasePromise: Promise<IDBDatabase> | null = null

function requireIndexedDB(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable')
  }
  return indexedDB
}

function openDatabase(): Promise<IDBDatabase> {
  const factory = requireIndexedDB()
  return new Promise((resolve, reject) => {
    const openRequest = factory.open(DB_NAME, DB_VERSION)
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: STORE_KEY_PATH })
      }
    }
    openRequest.onsuccess = () => {
      const db = openRequest.result
      // Another tab upgrading the schema closes this connection; drop the
      // cache so the next call reopens instead of reusing a closed handle.
      db.onversionchange = () => {
        db.close()
        databasePromise = null
      }
      resolve(db)
    }
    openRequest.onerror = () => {
      databasePromise = null
      reject(openRequest.error ?? new Error('Failed to open workspace database'))
    }
  })
}

function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise === null) {
    databasePromise = openDatabase()
  }
  return databasePromise
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Workspace request failed'))
  })
}

function transactionSettled(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Workspace transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Workspace transaction aborted'))
  })
}

/** Store the full workspace state for one (user, level); the keyPath fields must be present. */
export async function saveWorkspaceState(state: WorkspacePersistedState): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const settled = transactionSettled(tx)
  tx.objectStore(STORE_NAME).put(state)
  await settled
}

/** Read the persisted state for one (user, level), or null when absent or from an older schema. */
export async function loadWorkspaceState(userId: string, levelNo: number): Promise<WorkspacePersistedState | null> {
  const db = await getDatabase()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const stored: unknown = await requestValue(tx.objectStore(STORE_NAME).get([userId, levelNo]))
  return readPersistedState(stored)
}

/**
 * Discard the local copy for one (user, level). Callers must only do this
 * after the server acknowledged the submission (HTTP 202), so the local copy
 * is never destroyed before the server safely holds the final content.
 */
export async function clearWorkspaceState(userId: string, levelNo: number): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const settled = transactionSettled(tx)
  tx.objectStore(STORE_NAME).delete([userId, levelNo])
  await settled
}

/** Remove every level's local state for one user (for example on explicit sign-out). */
export async function clearAllForUser(userId: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const settled = transactionSettled(tx)
  const cursorRequest = tx.objectStore(STORE_NAME).openCursor()
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result
    if (cursor === null) return
    const key: unknown = cursor.key
    if (Array.isArray(key) && key[0] === userId) {
      cursor.delete()
    }
    cursor.continue()
  }
  await settled
}

/* ---------- stored shape guards ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const item of value) {
    if (typeof item === 'string') items.push(item)
  }
  return items
}

function readNumberRecord(value: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (!isRecord(value)) return result
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number') result[key] = entry
  }
  return result
}

function readStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

function readFlags(value: unknown): FlagDraft[] | null {
  return Array.isArray(value) ? (value as FlagDraft[]) : null
}

function readSelection(value: unknown): WorkspacePersistedState['selection'] {
  if (!isRecord(value)) return null
  const path = value['path']
  const start = value['start']
  const end = value['end']
  if (typeof path !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
    return null
  }
  return { path, start, end }
}

/** Normalize a stored record; anything from an older or corrupt schema reads as absent. */
function readPersistedState(value: unknown): WorkspacePersistedState | null {
  if (!isRecord(value) || value['schemaVersion'] !== WORKSPACE_SCHEMA_VERSION) {
    return null
  }
  if (typeof value['userId'] !== 'string' || typeof value['levelNo'] !== 'number') {
    return null
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    userId: value['userId'],
    levelNo: value['levelNo'],
    tabs: readStringArray(value['tabs']),
    activePath: typeof value['activePath'] === 'string' ? value['activePath'] : null,
    scrollPositions: readNumberRecord(value['scrollPositions']),
    selection: readSelection(value['selection']),
    flags: readFlags(value['flags']),
    files: readStringRecord(value['files']),
    updatedAt: typeof value['updatedAt'] === 'number' ? value['updatedAt'] : 0,
  }
}

/* ---------- server draft mapping ---------- */

function parseEpochMs(value: string | null): number {
  if (value === null) return 0
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Map a server draft payload to workspace state. payload.flags (array),
 * payload.files (object) and payload.__workspace (tabs, activePath,
 * scrollPositions, selection) map to their fields; anything missing or of the
 * wrong shape falls back to sensible empties. updatedAt is the server time.
 */
export function serverDraftToWorkspace(server: ServerDraft, userId: string, levelNo: number): WorkspacePersistedState {
  const payload = isRecord(server.payload) ? server.payload : {}
  const workspace = isRecord(payload['__workspace']) ? payload['__workspace'] : {}
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    userId,
    levelNo,
    tabs: readStringArray(workspace['tabs']),
    activePath: typeof workspace['activePath'] === 'string' ? workspace['activePath'] : null,
    scrollPositions: readNumberRecord(workspace['scrollPositions']),
    selection: readSelection(workspace['selection']),
    flags: readFlags(payload['flags']),
    files: readStringRecord(payload['files']),
    updatedAt: parseEpochMs(server.updated_at),
  }
}

/* ---------- reconciliation (pure) ---------- */

// Drafts written this close together are considered the same edit session;
// genuine content differences then surface as a conflict instead of one side
// silently winning.
const RECONCILE_TOLERANCE_MS = 5000

function canonicalFlags(flags: FlagDraft[] | null): string {
  return JSON.stringify(flags === null ? [] : flags)
}

function canonicalFiles(files: Record<string, string> | null): string {
  if (files === null) return '[]'
  const entries: Array<[string, string]> = []
  for (const key of Object.keys(files).sort()) {
    entries.push([key, files[key]])
  }
  return JSON.stringify(entries)
}

function contentDiffers(local: WorkspacePersistedState, serverState: WorkspacePersistedState): boolean {
  if (canonicalFlags(local.flags) !== canonicalFlags(serverState.flags)) return true
  return canonicalFiles(local.files) !== canonicalFiles(serverState.files)
}

function freshEmptyState(userId: string, levelNo: number): WorkspacePersistedState {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    userId,
    levelNo,
    tabs: [],
    activePath: null,
    scrollPositions: {},
    selection: null,
    flags: null,
    files: null,
    updatedAt: 0,
  }
}

/**
 * Pick the surviving workspace state from the local copy and the server draft.
 *
 * The newer side wins; when both timestamps sit within 5 s of each other and
 * their content differs, the outcome is 'conflict' carrying the newer state so
 * the participant can decide. With no local state the server draft is adopted;
 * with neither side the result is a fresh empty local state. Identity is only
 * known from the inputs, so a state derived with both sides missing carries
 * placeholder identity ('' / 0) that callers should rebind before saving.
 */
export function reconcileWorkspace(local: WorkspacePersistedState | null, server: ServerDraft | null): ReconcileOutcome {
  if (local === null) {
    if (server === null) {
      return { chosen: 'local', state: freshEmptyState('', 0) }
    }
    return { chosen: 'server', state: serverDraftToWorkspace(server, '', 0) }
  }
  if (server === null) {
    return { chosen: 'local', state: local }
  }

  const serverState = serverDraftToWorkspace(server, local.userId, local.levelNo)
  const serverTime = parseEpochMs(server.updated_at)
  const newerIsLocal = local.updatedAt > serverTime
  const withinTolerance = Math.abs(local.updatedAt - serverTime) <= RECONCILE_TOLERANCE_MS

  if (withinTolerance && contentDiffers(local, serverState)) {
    return { chosen: 'conflict', state: newerIsLocal ? local : serverState }
  }
  return newerIsLocal ? { chosen: 'local', state: local } : { chosen: 'server', state: serverState }
}
