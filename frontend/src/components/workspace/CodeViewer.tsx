import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { fmtBytes } from '../../lib/format'
import { Button, Chip, EmptyState } from '../../ui/components'
import { FileIcon, FolderIcon, MagnifierIcon } from '../../ui/icons'
import './viewer.css'

/* Shared selection model: 1-based inclusive line range bound to one file. */

export interface CodeSelection {
  path: string
  start: number
  end: number
}

const MIN_FONT = 12
const MAX_FONT = 20

/* ---------------- CodeViewer ---------------- */

export function CodeViewer(props: {
  path: string
  content: string
  lang?: string
  selection: CodeSelection | null
  onSelectionChange: (sel: CodeSelection | null) => void
  /** Scroll this line into view when the value changes (e.g. search hit). */
  jumpToLine?: number | null
}): JSX.Element {
  const { path, content, lang, selection, onSelectionChange, jumpToLine } = props

  const [fontSize, setFontSize] = useState(14)
  const [find, setFind] = useState('')
  const [cursorLine, setCursorLine] = useState(1)

  const dragAnchor = useRef<number | null>(null)
  const matchIdx = useRef(0)

  const lines = useMemo(() => content.replaceAll('\r\n', '\n').split('\n'), [content])
  const totalLines = lines.length
  const byteCount = useMemo(() => new TextEncoder().encode(content).length, [content])

  const findLower = find.trim().toLowerCase()
  const matchLines = useMemo(() => {
    if (!findLower) return []
    const out: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(findLower)) out.push(i + 1)
    }
    return out
  }, [lines, findLower])

  /* Reset the cursor when the file switches, then clear a selection that
     belongs to another path; the parent decides what to do with it. */
  useEffect(() => {
    setCursorLine(1)
  }, [path])
  useEffect(() => {
    if (selection && selection.path !== path) onSelectionChange(null)
  }, [path, selection, onSelectionChange])

  /* Keep the local cursor in sync with a controlled selection for this file. */
  useEffect(() => {
    if (selection && selection.path === path) setCursorLine(Math.max(1, Math.min(selection.end, totalLines || 1)))
  }, [selection, path, totalLines])

  /* Clamp the cursor when the line count shrinks after a refresh. */
  useEffect(() => {
    setCursorLine((c) => Math.max(1, Math.min(c, Math.max(totalLines, 1))))
  }, [totalLines])

  /* Reset match cycling when the search term changes. */
  useEffect(() => {
    matchIdx.current = 0
  }, [findLower])

  /* Scroll the requested line into view when the jump target changes. */
  useEffect(() => {
    if (jumpToLine === null || jumpToLine === undefined) return
    document.getElementById(`code-L${jumpToLine}`)?.scrollIntoView({ block: 'center' })
    setCursorLine(jumpToLine)
  }, [jumpToLine])

  const activeSel = selection && selection.path === path ? selection : null

  const commit = useCallback(
    (start: number, end: number) => {
      const lo = Math.max(1, Math.min(start, end))
      const hi = Math.min(Math.max(totalLines, 1), Math.max(start, end))
      onSelectionChange({ path, start: lo, end: hi })
      setCursorLine(hi)
    },
    [path, totalLines, onSelectionChange],
  )

  const onLineMouseDown = useCallback(
    (n: number, shift: boolean) => {
      if (shift) {
        const base = activeSel?.start ?? cursorLine ?? n
        commit(base, n)
        return
      }
      dragAnchor.current = n
      commit(n, n)
    },
    [activeSel, cursorLine, commit],
  )

  const onLineMouseMove = useCallback(
    (n: number) => {
      if (dragAnchor.current === null) return
      commit(dragAnchor.current, n)
    },
    [commit],
  )

  const onViewerMouseUp = useCallback(() => {
    dragAnchor.current = null
  }, [])

  function moveCursor(n: number) {
    setCursorLine(n)
    document.getElementById(`code-L${n}`)?.scrollIntoView({ block: 'nearest' })
  }

  function onViewerKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const max = totalLines
    if (max === 0) return
    const cur = cursorLine ?? 1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveCursor(Math.min(max, cur + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveCursor(Math.max(1, cur - 1))
    } else if (e.key === 'Home' && !e.ctrlKey) {
      e.preventDefault()
      moveCursor(1)
    } else if (e.key === 'End' && !e.ctrlKey) {
      e.preventDefault()
      moveCursor(max)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) commit(activeSel?.start ?? cur, cur)
      else commit(cur, cur)
    }
  }

  function jumpToNextMatch() {
    if (matchLines.length === 0) return
    const target = matchLines[matchIdx.current % matchLines.length]
    matchIdx.current = (matchIdx.current + 1) % matchLines.length
    setCursorLine(target)
    document.getElementById(`code-L${target}`)?.scrollIntoView({ block: 'center' })
  }

  const matchCount = matchLines.length

  if (content === '') {
    return (
      <EmptyState
        title="Empty file"
        note="This file exists in the repository but has no content to display."
      />
    )
  }

  return (
    <div className="viewer-root">
      <div className="code-toolbar">
        <div className="viewer-find">
          <input
            className="input mono-input"
            type="search"
            aria-label="Find in file"
            placeholder="Find in file"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') jumpToNextMatch()
            }}
          />
          <Button size="sm" onClick={jumpToNextMatch} disabled={matchCount === 0} ariaLabel="Jump to next match">
            <MagnifierIcon size={13} />
          </Button>
          <span className="muted small" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {findLower ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : ''}
          </span>
        </div>
        <div className="viewer-meta">
          <span className="mono small viewer-live" aria-live="polite">{fontSize}px</span>
          <Button size="sm" onClick={() => setFontSize((s) => Math.max(MIN_FONT, s - 1))} ariaLabel="Decrease font size">
            A-
          </Button>
          <Button size="sm" onClick={() => setFontSize((s) => Math.min(MAX_FONT, s + 1))} ariaLabel="Increase font size">
            A+
          </Button>
          {lang && <Chip tone="muted">{lang}</Chip>}
          <span className="muted small mono">{totalLines} lines {'·'} {fmtBytes(byteCount)}</span>
        </div>
      </div>

      <div
        className="codeview"
        tabIndex={0}
        role="application"
        aria-label={`Code, ${totalLines} lines. Click a line to set the report start, shift-click or press shift-Enter to set the range end.`}
        onMouseUp={onViewerMouseUp}
        onKeyDown={onViewerKeyDown}
        style={{ fontSize }}
      >
        {lines.map((line, i) => {
          const n = i + 1
          const inSel = activeSel !== null && n >= activeSel.start && n <= activeSel.end
          const isCursor = cursorLine === n
          const isHit = findLower !== '' && line.toLowerCase().includes(findLower)
          const cls = `codeline${inSel ? ' sel' : ''}${isCursor && !inSel ? ' cursor' : ''}${isHit && !inSel ? ' hl' : ''}`
          return (
            <div
              key={n}
              id={`code-L${n}`}
              className={cls}
              onMouseDown={(e) => onLineMouseDown(n, e.shiftKey)}
              onMouseMove={() => onLineMouseMove(n)}
            >
              <span className="line-no">{n}</span>
              <span className="line-code">{line === '' ? ' ' : line}</span>
            </div>
          )
        })}
      </div>

      <div className="viewer-footer muted small mono">
        Selection: {activeSel ? `lines ${activeSel.start}-${activeSel.end}` : 'none'} {'·'} Click sets the start line,
        shift-click or drag sets the range, keyboard: arrows to move, Enter to set, Shift+Enter to extend.
      </div>
    </div>
  )
}

/* ---------------- FileTree ---------------- */

interface FileTreeFile {
  path: string
  lang: string
  size_bytes: number
  line_count: number
}

/* Group paths into root files plus directories, preserving server order. */
function buildTree(paths: string[]): { dirs: Map<string, string[]>; roots: string[] } {
  const dirs = new Map<string, string[]>()
  const roots: string[] = []
  for (const p of paths) {
    const idx = p.lastIndexOf('/')
    if (idx === -1) {
      roots.push(p)
    } else {
      const dir = p.slice(0, idx)
      const bucket = dirs.get(dir)
      if (bucket) bucket.push(p)
      else dirs.set(dir, [p])
    }
  }
  return { dirs, roots }
}

export function FileTree(props: {
  files: FileTreeFile[]
  activePath: string | null
  onSelect: (path: string) => void
}): JSX.Element {
  const { files, activePath, onSelect } = props
  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files])
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])

  if (files.length === 0) {
    return <p className="muted small">No files in this repository.</p>
  }

  return (
    <div className="filetree" role="tree" aria-label="Repository files">
      {tree.roots.length > 0 && (
        <div role="group" aria-label="(root)">
          <div className="filetree-dir"><FolderIcon size={13} /> (root)</div>
          {tree.roots.map((p) => (
            <TreeRow key={p} path={p} file={byPath.get(p)} active={p === activePath} onSelect={onSelect} />
          ))}
        </div>
      )}
      {[...tree.dirs.entries()].map(([dir, paths]) => (
        <div key={dir} role="group" aria-label={`${dir}/`}>
          <div className="filetree-dir"><FolderIcon size={13} /> {dir}/</div>
          {paths.map((p) => (
            <TreeRow key={p} path={p} file={byPath.get(p)} short={p.slice(dir.length + 1)} active={p === activePath} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </div>
  )
}

function TreeRow({
  path,
  file,
  short,
  active,
  onSelect,
}: {
  path: string
  file: FileTreeFile | undefined
  short?: string
  active: boolean
  onSelect: (p: string) => void
}) {
  return (
    <button
      type="button"
      className={`filetree-row${active ? ' active' : ''}`}
      role="treeitem"
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(path)}
      title={file ? `${path} · ${file.lang} · ${file.line_count} lines` : path}
    >
      <FileIcon size={13} />
      <span className="filetree-name">{short ?? path}</span>
      {file && <span className="filetree-size mono">{fmtBytes(file.size_bytes)}</span>}
    </button>
  )
}
