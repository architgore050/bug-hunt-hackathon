import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LEVEL_POLICY } from '../config'
import { useArena } from '../state/ArenaProvider'
import { FileTree, ReadOnlyCode } from '../components/CodeBrowser'
import { Icon } from '../ui/Icons'
import { Button, Chip, Panel } from '../ui/primitives'

export default function Repository() {
  const { repositories, currentLevel, pushToast } = useArena()
  const navigate = useNavigate()
  const location = useLocation()
  const repo = currentLevel === 4 ? repositories.marina : repositories.papyrus
  const [activePath, setActivePath] = useState(() => {
    const fromState = (location.state as { path?: string } | null)?.path
    return fromState && repo?.files.some((file) => file.path === fromState) ? fromState : repo?.recentPaths[0] ?? ''
  })
  const [reference, setReference] = useState<number | null>(null)

  const file = useMemo(() => repo?.files.find((entry) => entry.path === activePath) ?? repo?.files[0], [repo, activePath])

  useEffect(() => {
    if (repo && !activePath) setActivePath(repo.recentPaths[0] ?? repo.files[0]?.path ?? '')
  }, [repo, activePath])

  if (!repo || !file) return <div className="ar-page"><p>Loading repository...</p></div>

  const report = () => {
    if (!reference) { pushToast('Select a line number first', 'warn'); return }
    navigate('/arena/level', { state: { path: file.path, line: reference } })
  }

  return (
    <div className="ar-page ar-page--wide">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Repository viewer / assigned by admin</div>
          <h1>{repo.name}</h1>
          <p>{repo.description}</p>
          <div className="ar-tag-row">
            {repo.tags.map((tag) => <Chip key={tag} tone="neutral">{tag}</Chip>)}
          </div>
        </div>
        <div className="ar-head-chips">
          {currentLevel === 4 && <Chip tone="danger"><Icon name="lock" size={12} /> New final repository</Chip>}
          <Chip tone={currentLevel === 4 ? 'danger' : 'signal'}>{repo.assignedLevel}</Chip>
          <Chip tone="neutral"><Icon name="shield" size={12} />{LEVEL_POLICY[currentLevel].label}</Chip>
        </div>
      </header>

      {currentLevel === 4 && (
        <div className="ar-final-banner"><Icon name="warning" size={16} /><span>This is the Level 4 repository. It replaces the earlier assignment and runs without AI assistance.</span></div>
      )}

      <Panel eyebrow="Source" title="In-browser repository" action={<Chip tone="info"><Icon name="branch" size={12} />{repo.branch}</Chip>}>
        <div className="ar-explorer-split ar-explorer-split--tall">
          <div className="ar-repo-sidebar">
            <div className="ar-overline">Folder structure</div>
            <FileTree tree={repo.tree} activePath={file.path} onOpen={(path) => { setActivePath(path); setReference(null) }} />
            <div className="ar-repo-sidebar__foot">
              <div><Icon name="file" size={13} />{repo.files.length} files</div>
              <div><Icon name="branch" size={13} />{repo.branch}</div>
            </div>
          </div>
          <div className="ar-repo-viewer">
            <ReadOnlyCode file={file} selectedLine={reference} onSelectLine={(line) => { setReference(line); pushToast(`Selected ${file.path}:${line}`) }} />
            <div className="ar-repo-viewer__foot">
              <span><Icon name="code" size={13} /> Click a line number to reference it in a bug report.</span>
              {reference && <strong className="ar-mono">{file.path}:{reference}</strong>}
              <Button size="sm" variant="primary" icon="flag" disabled={!reference} onClick={report}>Report issue at line</Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
