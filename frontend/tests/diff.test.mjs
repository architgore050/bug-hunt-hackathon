// Unit tests for src/lib/diff.ts, loaded through the Vite SSR pipeline the
// same way tests/submission_payload.test.mjs does it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

async function withDiffModule(run) {
  const server = await createServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const diff = await server.ssrLoadModule('/src/lib/diff.ts')
    return await run(diff)
  } finally {
    await server.close()
  }
}

test('identical content produces an empty diff', async () => {
  await withDiffModule((diff) => {
    assert.equal(diff.unifiedDiff('src/app.py', 'a\nb\nc\n', 'a\nb\nc\n'), '')
    assert.equal(diff.unifiedDiff('src/app.py', 'a\nb', 'a\nb'), '')
    assert.equal(diff.unifiedDiff('src/app.py', '', ''), '')
    assert.equal(diff.unifiedDiff('src/app.py', 'a\r\nb\r\n', 'a\r\nb\r\n'), '')
    assert.equal(diff.buildMultiFileDiff([{ path: 'src/app.py', base: 'x\n', next: 'x\n' }]), '')
  })
})

test('single-line change yields one hunk with context and a correct header', async () => {
  await withDiffModule((diff) => {
    const out = diff.unifiedDiff(
      'src/app.py',
      'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n',
      'one\ntwo\nthree\nfour\nFIVE\nsix\nseven\neight\n',
    )
    const expected = [
      '--- a/src/app.py',
      '+++ b/src/app.py',
      '@@ -2,7 +2,7 @@',
      ' two',
      ' three',
      ' four',
      '-five',
      '+FIVE',
      ' six',
      ' seven',
      ' eight',
      '',
    ].join('\n')
    assert.equal(out, expected)
    assert.equal((out.match(/@@ -/g) || []).length, 1)
  })
})

test('new file diff uses /dev/null and marks every line added', async () => {
  await withDiffModule((diff) => {
    assert.equal(
      diff.unifiedDiff('src/new.py', null, 'alpha\nbeta\n'),
      ['--- /dev/null', '+++ b/src/new.py', '@@ -0,0 +1,2 @@', '+alpha', '+beta', ''].join('\n'),
    )
  })
})

test('deleted file keeps the path and marks every line removed', async () => {
  await withDiffModule((diff) => {
    assert.equal(
      diff.unifiedDiff('src/old.py', 'alpha\nbeta\n', ''),
      ['--- a/src/old.py', '+++ b/src/old.py', '@@ -1,2 +0,0 @@', '-alpha', '-beta', ''].join('\n'),
    )
  })
})

test('missing trailing newline emits the marker exactly once for the side lacking it', async () => {
  await withDiffModule((diff) => {
    const noFinalNewline = diff.unifiedDiff('src/last.py', 'a\nb\nc\n', 'a\nb\nc')
    assert.equal(
      noFinalNewline,
      [
        '--- a/src/last.py',
        '+++ b/src/last.py',
        '@@ -1,3 +1,3 @@',
        ' a',
        ' b',
        '-c',
        '+c',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    )
    assert.equal((noFinalNewline.match(/No newline at end of file/g) || []).length, 1)

    const baseLacksIt = diff.unifiedDiff('src/last.py', 'a\nb\nc', 'a\nb\nc\n')
    assert.equal(
      baseLacksIt,
      [
        '--- a/src/last.py',
        '+++ b/src/last.py',
        '@@ -1,3 +1,3 @@',
        ' a',
        ' b',
        '-c',
        '\\ No newline at end of file',
        '+c',
        '',
      ].join('\n'),
    )
    assert.equal((baseLacksIt.match(/No newline at end of file/g) || []).length, 1)
  })
})

test('multi-file diff sorts by path, omits unchanged files and concatenates blocks', async () => {
  await withDiffModule((diff) => {
    const out = diff.buildMultiFileDiff([
      { path: 'src/b.py', base: 'same\n', next: 'same\n' },
      { path: 'src/d.py', base: 'gone\n', next: '' },
      { path: 'src/c.py', base: null, next: 'new\n' },
      { path: 'src/a.py', base: 'old\n', next: 'newer\n' },
    ])
    const expected = [
      '--- a/src/a.py',
      '+++ b/src/a.py',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+newer',
      '--- /dev/null',
      '+++ b/src/c.py',
      '@@ -0,0 +1,1 @@',
      '+new',
      '--- a/src/d.py',
      '+++ b/src/d.py',
      '@@ -1,1 +0,0 @@',
      '-gone',
      '',
    ].join('\n')
    assert.equal(out, expected)
    assert.ok(out.indexOf('src/a.py') < out.indexOf('src/c.py'))
    assert.ok(out.indexOf('src/c.py') < out.indexOf('src/d.py'))
    assert.ok(!out.includes('src/b.py'))
  })
})

test('CRLF content is normalized so equal logical content diffs as empty', async () => {
  await withDiffModule((diff) => {
    assert.equal(diff.unifiedDiff('src/app.py', 'a\r\nb\r\nc\r\n', 'a\nb\nc\n'), '')
    assert.equal(diff.unifiedDiff('src/app.py', 'a\nb\nc\n', 'a\r\nb\r\nc\r\n'), '')
    const crlfChange = diff.unifiedDiff('src/app.py', 'x\r\ny\r\nz\r\n', 'x\nY\nz\n')
    assert.equal(
      crlfChange,
      ['--- a/src/app.py', '+++ b/src/app.py', '@@ -1,3 +1,3 @@', ' x', '-y', '+Y', ' z', ''].join('\n'),
    )
    assert.ok(!crlfChange.includes('\r'))
  })
})

test('inputs beyond the LCS cell budget fall back to a bounded line diff', async () => {
  await withDiffModule((diff) => {
    // 2001 * 2001 cells is just over the 4,000,000 budget, so this takes the
    // guarded fallback path instead of the LCS table.
    const count = 2001
    const lines = Array.from({ length: count }, (_, k) => `line ${k + 1}`)
    const base = lines.join('\n') + '\n'
    const changed = lines.slice()
    changed[1500] = 'line 1501 CHANGED'
    const next = changed.join('\n') + '\n'
    const out = diff.unifiedDiff('src/big.py', base, next)
    const expected = [
      '--- a/src/big.py',
      '+++ b/src/big.py',
      '@@ -1498,7 +1498,7 @@',
      ' line 1498',
      ' line 1499',
      ' line 1500',
      '-line 1501',
      '+line 1501 CHANGED',
      ' line 1502',
      ' line 1503',
      ' line 1504',
      '',
    ].join('\n')
    assert.equal(out, expected)
    assert.equal((out.match(/@@ -/g) || []).length, 1)
  })
})
