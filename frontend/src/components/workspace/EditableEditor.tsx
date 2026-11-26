// Controlled editable code editor for levels 3 and 4: a textarea bound to
// the workspace file content with a synchronized line-number gutter. The
// gutter is decoration (aria-hidden); the textarea carries the accessibility
// surface. Tab inserts two spaces instead of moving focus.

import { useEffect, useMemo, useRef } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import './editable.css'

export function EditableEditor(props: {
  path: string
  content: string
  onChange: (next: string) => void
  fontSize?: number
}): JSX.Element {
  const { path, content, onChange, fontSize = 14 } = props
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  // Caret position to restore after a controlled re-render (Tab insertion).
  const pendingCaret = useRef<number | null>(null)

  const lineCount = useMemo(() => content.split('\n').length, [content])
  const gutterLines = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount])

  // Keep the gutter pinned to the textarea scroll position.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const sync = () => {
      const gutter = gutterRef.current
      if (gutter) gutter.scrollTop = ta.scrollTop
    }
    ta.addEventListener('scroll', sync)
    return () => ta.removeEventListener('scroll', sync)
  }, [])

  // Apply a caret restored from an intercepted Tab once React has re-rendered.
  useEffect(() => {
    const ta = taRef.current
    if (pendingCaret.current === null || !ta) return
    const pos = pendingCaret.current
    pendingCaret.current = null
    ta.selectionStart = pos
    ta.selectionEnd = pos
  }, [content])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Only a bare Tab (no ctrl/meta/alt/shift) is turned into spaces.
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    e.preventDefault()
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    onChange(content.slice(0, start) + '  ' + content.slice(end))
    pendingCaret.current = start + 2
  }

  const syncScroll = () => {
    const ta = taRef.current
    const gutter = gutterRef.current
    if (ta && gutter) gutter.scrollTop = ta.scrollTop
  }

  return (
    <div className="ede">
      <div className="ede-gutter" aria-hidden="true" ref={gutterRef}>
        {gutterLines.map((n) => (
          <div key={n} className="ede-gutter-line">
            {n}
          </div>
        ))}
      </div>
      <textarea
        ref={taRef}
        className="ede-textarea"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-label={`Editing ${path}`}
        style={{ fontSize, whiteSpace: 'pre', overflowX: 'auto' }}
      />
    </div>
  )
}
