// Route guard redirect matrix tests (pure logic, SSR-loaded like the other tests).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

let viteServer

test.before(async () => {
  viteServer = await createServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true, appType: 'custom', hmr: false },
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  })
})

test.after(async () => {
  if (viteServer) await viteServer.close()
})

async function loadGuards() {
  return viteServer.ssrLoadModule('/src/lib/guards.ts')
}

test('guard keeps the dashboard reachable and redirects a done pointer', async () => {
  const { guardRedirect } = await loadGuards()
  assert.equal(guardRedirect({ level_no: 4, node: 'done' }, 4, 'explain'), '/dashboard')
  assert.equal(guardRedirect({ level_no: 4, node: 'done' }, 1, 'run'), '/dashboard')
  assert.equal(guardRedirect(null, 1, 'explain'), null)
})

test('guard redirects submitted (older) levels forward to the current node', async () => {
  const { guardRedirect } = await loadGuards()
  // pointer L2 explain, someone pastes /level/1/explain or /level/1/run
  assert.equal(guardRedirect({ level_no: 2, node: 'explain' }, 1, 'explain'), '/level/2/explain')
  assert.equal(guardRedirect({ level_no: 2, node: 'exec' }, 1, 'run'), '/level/2/run')
})

test('guard redirects future or locked levels back to the current node', async () => {
  const { guardRedirect } = await loadGuards()
  // pointer L1 exec, someone pastes /level/3/explain
  assert.equal(guardRedirect({ level_no: 1, node: 'exec' }, 3, 'explain'), '/level/1/run')
  assert.equal(guardRedirect({ level_no: 1, node: 'explain' }, 4, 'run'), '/level/1/explain')
})

test('run route is reachable within the current level; the server gates entry', async () => {
  const { guardRedirect } = await loadGuards()
  // pointer L2 explain, /level/2/run is allowed: workspace entry performs the
  // explain -> exec pointer advance server-side and re-checks the gate.
  assert.equal(guardRedirect({ level_no: 2, node: 'explain' }, 2, 'run'), null)
  // pointer L2 exec, /level/2/run is allowed
  assert.equal(guardRedirect({ level_no: 2, node: 'exec' }, 2, 'run'), null)
  // pointer L2 exec, /level/2/explain stays readable (no redirect)
  assert.equal(guardRedirect({ level_no: 2, node: 'exec' }, 2, 'explain'), null)
})
