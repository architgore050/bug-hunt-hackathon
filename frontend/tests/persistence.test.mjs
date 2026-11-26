// Unit tests for src/lib/persistence.ts, loaded through the Vite SSR pipeline
// the same way tests/submission_payload.test.mjs does it. The IndexedDB guard
// case relies on Node not providing a global indexedDB, which holds in this
// environment and keeps the module's browser-only path unreachable under SSR.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

const BASE_MS = Date.parse('2026-11-26T10:00:00.000Z')

const FLAG = {
  title: 'Off-by-one in the row validator',
  category: 'input_validation',
  description: 'The loop stops one row early, so the last record is never checked.',
  evidence: 'row < len(rows) - 1',
  claimed_severity: 'low',
  locations: [{ file_path: 'src/app.py', line_start: 12, line_end: 14 }],
}

const FLAG_ALT = {
  title: 'Unescaped output in the report view',
  category: 'xss',
  description: 'User supplied text is rendered without escaping.',
  evidence: '<div>{comment}</div>',
  claimed_severity: 'medium',
  locations: [{ file_path: 'src/report.html', line_start: 40, line_end: 42 }],
}

function iso(ms) {
  return new Date(ms).toISOString()
}

function serverDraft(payload, updatedAtMs) {
  return {
    payload,
    version: 4,
    updated_at: updatedAtMs === null ? null : iso(updatedAtMs),
  }
}

function localState(overrides = {}) {
  return {
    schemaVersion: 1,
    userId: 'user-1',
    levelNo: 1,
    tabs: ['src/app.py'],
    activePath: 'src/app.py',
    scrollPositions: { 'src/app.py': 120 },
    selection: { path: 'src/app.py', start: 3, end: 9 },
    flags: [FLAG],
    files: null,
    updatedAt: BASE_MS,
    ...overrides,
  }
}

async function withPersistenceModule(run) {
  const server = await createServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const persistence = await server.ssrLoadModule('/src/lib/persistence.ts')
    return await run(persistence)
  } finally {
    await server.close()
  }
}

test('reconcile with no local state and no server draft yields a fresh local state', async () => {
  await withPersistenceModule((persistence) => {
    const outcome = persistence.reconcileWorkspace(null, null)
    assert.equal(outcome.chosen, 'local')
    assert.equal(outcome.state.schemaVersion, 1)
    assert.deepEqual(outcome.state.tabs, [])
    assert.equal(outcome.state.activePath, null)
    assert.deepEqual(outcome.state.scrollPositions, {})
    assert.equal(outcome.state.selection, null)
    assert.equal(outcome.state.flags, null)
    assert.equal(outcome.state.files, null)
    assert.equal(outcome.state.updatedAt, 0)
  })
})

test('missing local state adopts the server draft and maps flags and files', async () => {
  await withPersistenceModule((persistence) => {
    const draft = serverDraft({ flags: [FLAG], files: { 'notes/README.md': 'edited contents' } }, BASE_MS)
    const outcome = persistence.reconcileWorkspace(null, draft)
    assert.equal(outcome.chosen, 'server')
    assert.deepEqual(outcome.state.flags, [FLAG])
    assert.deepEqual(outcome.state.files, { 'notes/README.md': 'edited contents' })
    assert.equal(outcome.state.updatedAt, BASE_MS)
    assert.equal(outcome.state.schemaVersion, 1)
  })
})

test('local state newer by 10 s wins outright even with differing content', async () => {
  await withPersistenceModule((persistence) => {
    const local = localState({ updatedAt: BASE_MS + 10000, flags: [FLAG_ALT] })
    const draft = serverDraft({ flags: [FLAG] }, BASE_MS)
    const outcome = persistence.reconcileWorkspace(local, draft)
    assert.equal(outcome.chosen, 'local')
    assert.equal(outcome.state, local)
    assert.deepEqual(outcome.state.flags, [FLAG_ALT])
  })
})

test('server draft newer by 10 s wins outright', async () => {
  await withPersistenceModule((persistence) => {
    const local = localState({ updatedAt: BASE_MS })
    const draft = serverDraft({ flags: [FLAG_ALT], __workspace: { tabs: ['src/report.html'] } }, BASE_MS + 10000)
    const outcome = persistence.reconcileWorkspace(local, draft)
    assert.equal(outcome.chosen, 'server')
    assert.deepEqual(outcome.state.flags, [FLAG_ALT])
    assert.deepEqual(outcome.state.tabs, ['src/report.html'])
    assert.equal(outcome.state.updatedAt, BASE_MS + 10000)
  })
})

test('drafts written within 5 s with differing flags produce a conflict carrying the newer state', async () => {
  await withPersistenceModule((persistence) => {
    const local = localState({ updatedAt: BASE_MS + 2000, flags: [FLAG_ALT] })
    const draft = serverDraft({ flags: [FLAG] }, BASE_MS)
    const outcome = persistence.reconcileWorkspace(local, draft)
    assert.equal(outcome.chosen, 'conflict')
    assert.equal(outcome.state, local)
    assert.deepEqual(outcome.state.flags, [FLAG_ALT])
  })
})

test('drafts within 5 s with identical content do not conflict; the newer side wins', async () => {
  await withPersistenceModule((persistence) => {
    const local = localState({ updatedAt: BASE_MS + 3000 })
    const draft = serverDraft({ flags: [FLAG] }, BASE_MS)
    const outcome = persistence.reconcileWorkspace(local, draft)
    assert.equal(outcome.chosen, 'local')
    assert.equal(outcome.state, local)

    const staleLocal = localState({ updatedAt: BASE_MS })
    const newerDraft = serverDraft({ flags: [FLAG] }, BASE_MS + 3000)
    const serverOutcome = persistence.reconcileWorkspace(staleLocal, newerDraft)
    assert.equal(serverOutcome.chosen, 'server')
    assert.equal(serverOutcome.state.updatedAt, BASE_MS + 3000)
    assert.deepEqual(serverOutcome.state.flags, [FLAG])
  })
})

test('reconcile keeps a local-only state untouched', async () => {
  await withPersistenceModule((persistence) => {
    const local = localState()
    const outcome = persistence.reconcileWorkspace(local, null)
    assert.equal(outcome.chosen, 'local')
    assert.equal(outcome.state, local)
  })
})

test('serverDraftToWorkspace maps missing pieces to sensible empties', async () => {
  await withPersistenceModule((persistence) => {
    const state = persistence.serverDraftToWorkspace(serverDraft({}, null), 'user-9', 3)
    assert.equal(state.schemaVersion, 1)
    assert.equal(state.userId, 'user-9')
    assert.equal(state.levelNo, 3)
    assert.deepEqual(state.tabs, [])
    assert.equal(state.activePath, null)
    assert.deepEqual(state.scrollPositions, {})
    assert.equal(state.selection, null)
    assert.equal(state.flags, null)
    assert.equal(state.files, null)
    assert.equal(state.updatedAt, 0)
  })
})

test('serverDraftToWorkspace maps __workspace fields onto the state', async () => {
  await withPersistenceModule((persistence) => {
    const state = persistence.serverDraftToWorkspace(
      serverDraft(
        {
          __workspace: {
            tabs: ['src/app.py', 'src/report.html'],
            activePath: 'src/report.html',
            scrollPositions: { 'src/app.py': 240 },
            selection: { path: 'src/app.py', start: 1, end: 7 },
          },
        },
        BASE_MS,
      ),
      'user-2',
      2,
    )
    assert.deepEqual(state.tabs, ['src/app.py', 'src/report.html'])
    assert.equal(state.activePath, 'src/report.html')
    assert.deepEqual(state.scrollPositions, { 'src/app.py': 240 })
    assert.deepEqual(state.selection, { path: 'src/app.py', start: 1, end: 7 })
    assert.equal(state.updatedAt, BASE_MS)
    assert.equal(state.schemaVersion, 1)
  })
})

test('every IndexedDB entry point rejects clearly when the API is absent (SSR)', async () => {
  await withPersistenceModule(async (persistence) => {
    await assert.rejects(() => persistence.loadWorkspaceState('user-1', 1), /IndexedDB unavailable/)
    await assert.rejects(() => persistence.saveWorkspaceState(localState()), /IndexedDB unavailable/)
    await assert.rejects(() => persistence.clearWorkspaceState('user-1', 1), /IndexedDB unavailable/)
    await assert.rejects(() => persistence.clearAllForUser('user-1'), /IndexedDB unavailable/)
  })
})
