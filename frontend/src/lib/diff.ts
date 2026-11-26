// Unified diff builder for the workspace diff export. Hand written LCS based
// line diff so the client bundle stays free of extra dependencies.

interface DiffLine {
  text: string
  // Set only for the final line of a file that lacks a trailing newline. Such
  // a line compares unequal to the same text WITH a trailing newline, and it
  // renders with the "No newline at end of file" marker after it.
  missingNewline: boolean
}

type DiffOp =
  | { kind: 'equal'; base: DiffLine; next: DiffLine; baseNo: number; nextNo: number }
  | { kind: 'del'; base: DiffLine; next: null; baseNo: number; nextNo: null }
  | { kind: 'add'; base: null; next: DiffLine; baseNo: null; nextNo: number }

interface Hunk {
  ops: DiffOp[]
  baseStart: number
  baseCount: number
  nextStart: number
  nextCount: number
}

const NO_NEWLINE_MARKER = '\\ No newline at end of file'
const MAX_DP_CELLS = 4_000_000

// Splits file content into lines. Both "\r\n" and "\n" count as line breaks,
// so CRLF and LF files with the same logical content produce identical lines.
// A final line left without its newline keeps missingNewline set.
function splitContent(text: string): DiffLine[] {
  if (text.length === 0) return []
  let body = text
  let trailingNewline = false
  if (body.endsWith('\n')) {
    trailingNewline = true
    body = body.slice(0, -1)
    if (body.endsWith('\r')) body = body.slice(0, -1)
  }
  const parts = body.length === 0 ? [''] : body.split(/\r\n|\n/)
  const last = parts.length - 1
  return parts.map((lineText, idx) => ({
    text: lineText,
    missingNewline: !trailingNewline && idx === last,
  }))
}

function sameLine(a: DiffLine, b: DiffLine): boolean {
  return a.text === b.text && a.missingNewline === b.missingNewline
}

// O(n*m) dynamic programming LCS over line records. Used while the cell count
// stays within the bounded budget. The walk prefers deletions over additions
// on ties so changed blocks render as one run of minus lines then plus lines.
function lcsOps(base: DiffLine[], next: DiffLine[]): DiffOp[] {
  const n = base.length
  const m = next.length
  const width = m + 1
  const table = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width
    const below = row + width
    for (let j = m - 1; j >= 0; j--) {
      if (sameLine(base[i], next[j])) {
        table[row + j] = table[below + j + 1] + 1
      } else {
        table[row + j] = Math.max(table[below + j], table[row + j + 1])
      }
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && sameLine(base[i], next[j])) {
      ops.push({ kind: 'equal', base: base[i], next: next[j], baseNo: i + 1, nextNo: j + 1 })
      i += 1
      j += 1
    } else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      ops.push({ kind: 'del', base: base[i], next: null, baseNo: i + 1, nextNo: null })
      i += 1
    } else {
      ops.push({ kind: 'add', base: null, next: next[j], baseNo: null, nextNo: j + 1 })
      j += 1
    }
  }
  return ops
}

// Line by line pass through diff for very large inputs where the LCS table
// would be too big. Equal lines pass through; stretches of differing lines
// become one run of deletions followed by one run of additions.
function fallbackOps(base: DiffLine[], next: DiffLine[]): DiffOp[] {
  const ops: DiffOp[] = []
  const shared = Math.min(base.length, next.length)
  let i = 0
  while (i < shared) {
    if (sameLine(base[i], next[i])) {
      ops.push({ kind: 'equal', base: base[i], next: next[i], baseNo: i + 1, nextNo: i + 1 })
      i += 1
      continue
    }
    const start = i
    while (i < shared && !sameLine(base[i], next[i])) i += 1
    for (let k = start; k < i; k++) {
      ops.push({ kind: 'del', base: base[k], next: null, baseNo: k + 1, nextNo: null })
    }
    for (let k = start; k < i; k++) {
      ops.push({ kind: 'add', base: null, next: next[k], baseNo: null, nextNo: k + 1 })
    }
  }
  for (let k = shared; k < base.length; k++) {
    ops.push({ kind: 'del', base: base[k], next: null, baseNo: k + 1, nextNo: null })
  }
  for (let k = shared; k < next.length; k++) {
    ops.push({ kind: 'add', base: null, next: next[k], baseNo: null, nextNo: k + 1 })
  }
  return ops
}

function diffOps(base: DiffLine[], next: DiffLine[]): DiffOp[] {
  if (base.length * next.length > MAX_DP_CELLS) return fallbackOps(base, next)
  return lcsOps(base, next)
}

// Groups the op list into hunks: every changed op plus up to contextLines of
// equal ops on each side; runs that touch merge into a single hunk.
function buildHunks(ops: DiffOp[], contextLines: number): Hunk[] {
  const included = new Uint8Array(ops.length)
  let after = 0
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind === 'equal') {
      if (after > 0) {
        included[i] = 1
        after -= 1
      }
    } else {
      included[i] = 1
      after = contextLines
    }
  }
  let before = 0
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].kind === 'equal') {
      if (before > 0) {
        included[i] = 1
        before -= 1
      }
    } else {
      included[i] = 1
      before = contextLines
    }
  }
  const hunks: Hunk[] = []
  let idx = 0
  while (idx < ops.length) {
    if (included[idx] === 0) {
      idx += 1
      continue
    }
    let end = idx
    while (end < ops.length && included[end] === 1) end += 1
    const run = ops.slice(idx, end)
    let baseCount = 0
    let nextCount = 0
    let baseStart = -1
    let nextStart = -1
    for (const op of run) {
      if (op.kind !== 'add') {
        baseCount += 1
        if (baseStart < 0) baseStart = op.baseNo
      }
      if (op.kind !== 'del') {
        nextCount += 1
        if (nextStart < 0) nextStart = op.nextNo
      }
    }
    const first = run[0]
    // A hunk that opens with added lines has no base line of its own, so it
    // starts just before the first added line (0 for a brand-new file).
    if (baseStart < 0) baseStart = (first.nextNo ?? 0) - 1
    if (nextStart < 0) nextStart = (first.baseNo ?? 0) - 1
    hunks.push({ ops: run, baseStart, baseCount, nextStart, nextCount })
    idx = end
  }
  return hunks
}

function renderHunkLines(hunk: Hunk, lines: string[]): void {
  lines.push(`@@ -${hunk.baseStart},${hunk.baseCount} +${hunk.nextStart},${hunk.nextCount} @@`)
  for (const op of hunk.ops) {
    if (op.kind === 'del') {
      lines.push(`-${op.base.text}`)
      if (op.base.missingNewline) lines.push(NO_NEWLINE_MARKER)
    } else if (op.kind === 'add') {
      lines.push(`+${op.next.text}`)
      if (op.next.missingNewline) lines.push(NO_NEWLINE_MARKER)
    } else {
      lines.push(` ${op.base.text}`)
      if (op.base.missingNewline) lines.push(NO_NEWLINE_MARKER)
    }
  }
}

/** Unified diff for one file. base null means a brand-new file. Returns '' when there are no changes. */
export function unifiedDiff(path: string, base: string | null, next: string, contextLines = 3): string {
  const baseLines: DiffLine[] = base === null ? [] : splitContent(base)
  const nextLines = splitContent(next)
  const ops = diffOps(baseLines, nextLines)
  const hasChanges = ops.some((op) => op.kind !== 'equal')
  if (!hasChanges) return ''
  const context = Math.max(0, Math.floor(contextLines))
  const lines: string[] = [base === null ? '--- /dev/null' : `--- a/${path}`, `+++ b/${path}`]
  for (const hunk of buildHunks(ops, context)) renderHunkLines(hunk, lines)
  return lines.join('\n') + '\n'
}

/** Multi-file diff with one header block per changed file (sorted by path). Returns '' when nothing changed. */
export function buildMultiFileDiff(files: { path: string; base: string | null; next: string }[]): string {
  const blocks: { path: string; diff: string }[] = []
  for (const file of files) {
    const diff = unifiedDiff(file.path, file.base, file.next)
    if (diff !== '') blocks.push({ path: file.path, diff })
  }
  blocks.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  let out = ''
  for (const block of blocks) out += block.diff
  return out
}
