import { forwardRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Language } from '../types'

const surface = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#12171c', color: '#d5dce3', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", lineHeight: '1.55' },
  '.cm-content': { padding: '10px 0', caretColor: '#e8a13d' },
  '.cm-gutters': { backgroundColor: '#141a20', color: '#5c6671', borderRight: '1px solid #2a313a' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 10px', minWidth: '38px' },
  '.cm-activeLine': { backgroundColor: '#19212a' },
  '.cm-activeLineGutter': { backgroundColor: '#19212a', color: '#e8a13d' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#31404d' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e8a13d', borderLeftWidth: '2px' },
  '.cm-matchingBracket': { backgroundColor: '#2b3944', outline: '1px solid #3a434e' },
  '.cm-foldGutter .cm-gutterElement': { color: '#5c6671' },
}, { dark: true })

const highlightStyle = HighlightStyle.define([
  { tag: t.comment, color: '#6e7a86', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: '#b7c98d' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: '#e8a13d' },
  { tag: [t.number, t.bool, t.null], color: '#c990b3' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#8fbdd8' },
  { tag: [t.variableName, t.propertyName], color: '#d5dce3' },
  { tag: [t.typeName, t.className, t.definition(t.variableName)], color: '#8dc9b6' },
  { tag: [t.operator, t.operatorKeyword], color: '#9aa3ad' },
  { tag: t.punctuation, color: '#7e8994' },
  { tag: t.tagName, color: '#8fbdd8' },
  { tag: t.attributeName, color: '#e8a13d' },
])

const languageExtension = (language: Language) => {
  switch (language) {
    case 'javascript': return javascript({ jsx: true })
    case 'python': return python()
    case 'json': return json()
    case 'css': return css()
    case 'html': return html()
    default: return []
  }
}

interface Props {
  value: string
  language: Language
  onChange: (value: string) => void
  readOnly?: boolean
}

export const CodeMirrorPane = forwardRef<ReactCodeMirrorRef, Props>(function CodeMirrorPane(
  { value, language, onChange, readOnly = false }, ref,
) {
  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      theme={surface}
      extensions={[languageExtension(language), syntaxHighlighting(highlightStyle), EditorView.lineWrapping]}
      basicSetup={{ foldGutter: false, autocompletion: false, highlightSelectionMatches: true, searchKeymap: false }}
      editable={!readOnly}
      readOnly={readOnly}
      onChange={onChange}
    />
  )
})
