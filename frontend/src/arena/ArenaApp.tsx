import { Navigate, Route, Routes } from 'react-router-dom'
import './styles/arena.css'
import { ArenaProvider } from './state/ArenaProvider'
import Shell from './components/Shell'
import Overview from './pages/Overview'
import Leaderboard from './pages/Leaderboard'
import CurrentLevel from './pages/CurrentLevel'
import Workspace from './pages/Workspace'
import Repository from './pages/Repository'
import Questions from './pages/Questions'
import Ctf from './pages/Ctf'
import Team from './pages/Team'
import Notifications from './pages/Notifications'

export default function ArenaApp() {
  return (
    <ArenaProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="level" element={<CurrentLevel />} />
          <Route path="questions" element={<Questions />} />
          <Route path="repository" element={<Repository />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="flags" element={<Ctf />} />
          <Route path="team" element={<Team />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Route>
      </Routes>
    </ArenaProvider>
  )
}
