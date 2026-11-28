import { useNavigate } from 'react-router-dom'
import { LEVEL_POLICY } from '../config'
import { useArena } from '../state/ArenaProvider'
import { Icon } from '../ui/Icons'
import { Button, Chip, Panel } from '../ui/primitives'
import RepairWorkspace from './RepairWorkspace'

export default function Workspace() {
  const { currentLevel } = useArena()
  const navigate = useNavigate()
  const policy = LEVEL_POLICY[currentLevel]

  if (currentLevel >= 3) return <RepairWorkspace level={currentLevel} />

  return (
    <div className="ar-page">
      <header className="ar-page-head">
        <div>
          <div className="ar-overline">Code workspace</div>
          <h1>Repair workspace is locked</h1>
          <p>Editing unlocks at Level 3. Use the repository viewer to investigate the assigned code for now.</p>
        </div>
        <Chip tone="neutral"><Icon name="lock" size={12} /> Level 3 required</Chip>
      </header>
      <Panel eyebrow="Current policy" title={policy.label}>
        <p className="ar-muted">{policy.summary}</p>
        <div className="ar-lock-actions">
          <Button variant="primary" icon="repo" onClick={() => navigate('/arena/repository')}>Open repository viewer</Button>
          <Button icon="flag" onClick={() => navigate('/arena/level')}>Return to issue workspace</Button>
        </div>
      </Panel>
    </div>
  )
}
