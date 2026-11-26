import { Route, Routes, Navigate } from 'react-router-dom'
import { PublicLayout, RequireRole, ConsoleShell } from './components/chrome'
import Landing from './pages/Landing'
import Rules from './pages/Rules'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Dashboard from './pages/participant/Dashboard'
import Submissions from './pages/participant/Submissions'
import SubmissionDetail from './pages/participant/SubmissionDetail'
import Results from './pages/participant/Results'
import Leaderboard from './pages/participant/Leaderboard'
import Account from './pages/participant/Account'
import ReviewQueue from './pages/review/Queue'
import ReviewItem from './pages/review/ItemDetail'
import AdminDashboard from './pages/admin/Dashboard'
import AdminChallenges from './pages/admin/Challenges'

export default function App() {
  return (
    <Routes>
      {/* Public case file */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>

      <Route path="/login" element={<Login />} />

      {/* Participant four-level experience */}
      <Route
        path="/dashboard"
        element={
          <RequireRole roles={['participant']}>
            <ConsoleShell area="/app">
              <Dashboard />
            </ConsoleShell>
          </RequireRole>
        }
      />

      {/* Participant console: v1 compatibility routes. The Lobby and the v1
          single-round workspace are superseded by the four-level flow; their
          URLs redirect to the dashboard. */}
      <Route
        path="/app"
        element={
          <RequireRole roles={['participant']}>
            <ConsoleShell area="/app">
              <Routes>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="workspace" element={<Navigate to="/dashboard" replace />} />
                <Route path="submissions" element={<Submissions />} />
                <Route path="submissions/:submissionId" element={<SubmissionDetail />} />
                <Route path="results" element={<Results />} />
                <Route path="leaderboard" element={<Leaderboard />} />
                <Route path="account" element={<Account />} />
              </Routes>
            </ConsoleShell>
          </RequireRole>
        }
      />

      {/* Reviewer console */}
      <Route
        path="/review"
        element={
          <RequireRole roles={['reviewer']}>
            <ConsoleShell area="/review">
              <Routes>
                <Route index element={<ReviewQueue />} />
                <Route path="items/:itemId" element={<ReviewItem />} />
              </Routes>
            </ConsoleShell>
          </RequireRole>
        }
      />

      {/* Organizer / admin console */}
      <Route
        path="/admin"
        element={
          <RequireRole roles={['organizer', 'admin']}>
            <ConsoleShell area="/admin">
              <Routes>
                <Route index element={<AdminDashboard />} />
                <Route path="challenges" element={<AdminChallenges />} />
              </Routes>
            </ConsoleShell>
          </RequireRole>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
