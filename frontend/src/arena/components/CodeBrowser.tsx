import { useEffect, useMemo, useState } from 'react'
import type { Language, RepoFile, RepoTreeNode } from '../types'
import { Icon } from '../ui/Icons'

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'class',
  'export', 'import', 'from', 'default', 'async', 'await', 'def', 'self', 'None', 'True', 'False',
  'try', 'except', 'raise', 'with', 'as', 'in', 'is', 'not', 'and', 'or', 'lambda', 'yield',
  'module', 'exports', 'require', 'throw', 'null', 'undefined', 'true', 'false', 'this',
])

type Token = { text: string; kind: string }

function tokenize(line: string, language: Language): Token[] {
  const pattern = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$|\/\*.*?\*\/|#.*$|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b)/g
  const tokens: Token[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) tokens.push({ text: line.slice(last, match.index), kind: 'plain' })
    const text = match[0]
    let kind = 'plain'
    if (text.startsWith('//') || text.startsWith('/*') || text.startsWith('#')) kind = 'comment'
    else if (/^["'`]/.test(text)) kind = 'string'
    else if (/^\d/.test(text)) kind = 'number'
    else if (KEYWORDS.has(text)) kind = 'keyword'
    else if (language === 'json' && /^"/.test(text)) kind = 'string'
    tokens.push({ text, kind })
    last = match.index + text.length
  }
  if (last < line.length) tokens.push({ text: line.slice(last), kind: 'plain' })
  return tokens
}

export function HighlightedLine({ text, language }: { text: string; language: Language }) {
  return <>{tokenize(text, language).map((token, index) =>
    token.kind === 'plain' ? <span key={index}>{token.text}</span>
      : <span key={index} className={`ar-tok ar-tok--${token.kind}`}>{token.text}</span>,
  )}</>
}

function TreeNodeView({ node, depth, activePath, onOpen }: {
  node: RepoTreeNode
  depth: number
  activePath: string
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  if (node.type === 'folder') {
    return (
      <div className="ar-tree-group">
        <button className="ar-tree__row is-folder" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <Icon name="folder" size={13} />
          <span>{node.name}</span>
        </button>
        {open && node.children.map((child) => (
          <TreeNodeView key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
        ))}
      </div>
    )
  }
  return (
    <button className={`ar-tree__row is-file ${activePath === node.path ? 'is-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }} onClick={() => onOpen(node.path)}>
      <Icon name="file" size={13} />
      <span>{node.name}</span>
      {node.modified && <i className="ar-tree__dirty" title="Modified">M</i>}
    </button>
  )
}

export function FileTree({ tree, activePath, onOpen }: {
  tree: RepoTreeNode[]
  activePath: string
  onOpen: (path: string) => void
}) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return tree
    const match = (node: RepoTreeNode): RepoTreeNode | null => {
      if (node.type === 'file') return node.path.toLowerCase().includes(filter.toLowerCase()) ? node : null
      const children = node.children.map(match).filter((child): child is RepoTreeNode => child !== null)
      return children.length ? { ...node, children } : null
    }
    return tree.map(match).filter((node): node is RepoTreeNode => node !== null)
  }, [tree, filter])

  return (
    <div className="ar-tree">
      <div className="ar-tree__search"><Icon name="search" size={13} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search files" aria-label="Search files" />
      </div>
      <div className="ar-tree__list">
        {filtered.map((node) => <TreeNodeView key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

export function ReadOnlyCode({ file, selectedLine, onSelectLine, highlightLines = [] }: {
  file: RepoFile
  selectedLine?: number | null
  onSelectLine?: (line: number) => void
  highlightLines?: number[]
}) {
  const [query, setQuery] = useState('')
  const lines = file.content.split('\n')
  const matches = useMemo(() => {
    if (!query.trim()) return [] as number[]
    const needle = query.toLowerCase()
    return lines.map((line, index) => line.toLowerCase().includes(needle) ? index + 1 : 0).filter(Boolean)
  }, [lines, query])

  useEffect(() => setQuery(''), [file.path])

  return (
    <div className="ar-codeview">
      <div className="ar-codeview__bar">
        <span className="ar-codeview__path">{file.path}</span>
        <div className="ar-search ar-search--compact"><Icon name="search" size={12} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in file" aria-label="Find in file" />
          {query && <small>{matches.length} match{matches.length === 1 ? '' : 'es'}</small>}
        </div>
      </div>
      <div className="ar-codeview__scroll">
        {lines.map((line, index) => {
          const lineNo = index + 1
          const isMatch = matches.includes(lineNo)
          const isSelected = selectedLine === lineNo
          const isHighlighted = highlightLines.includes(lineNo)
          return (
            <div key={lineNo} className={`ar-codeview__line ${isSelected ? 'is-selected' : ''} ${isMatch ? 'is-match' : ''} ${isHighlighted ? 'is-flagged' : ''}`}>
              <button className="ar-codeview__gutter" onClick={() => onSelectLine?.(lineNo)}
                title={onSelectLine ? `Reference line ${lineNo}` : `Line ${lineNo}`}>
                {lineNo}
              </button>
              <code><HighlightedLine text={line} language={file.language} /></code>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function FileTabs({ paths, activePath, onOpen, onClose }: {
  paths: string[]
  activePath: string
  onOpen: (path: string) => void
  onClose: (path: string) => void
}) {
  return (
    <div className="ar-filetabs">
      {paths.map((path) => (
        <div key={path} className={`ar-filetab ${activePath === path ? 'is-active' : ''}`}>
          <button onClick={() => onOpen(path)}><Icon name="file" size={12} />{path.split('/').pop()}</button>
          <button className="ar-filetab__close" onClick={() => onClose(path)} aria-label={`Close ${path}`}><Icon name="close" size={10} /></button>
        </div>
      ))}
    </div>
  )
}
