import { useArena } from '../state/ArenaProvider'
import IssueWorkspace from './IssueWorkspace'
import RepairWorkspace from './RepairWorkspace'

export default function CurrentLevel() {
  const { currentLevel } = useArena()
  return currentLevel <= 2 ? <IssueWorkspace level={currentLevel} /> : <RepairWorkspace level={currentLevel} />
}
