import { Route, Routes, Navigate, Outlet } from 'react-router-dom'
import { PublicLayout, RequireRole, ConsoleShell } from './components/chrome'
import Landing from './pages/Landing'
import Rules from './pages/Rules'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import EventDetails from './pages/EventDetails'
import LevelExplain from './pages/participant/LevelExplain'
import LevelRules from './pages/participant/LevelRules'
import LevelGuide from './pages/participant/LevelGuide'
import LevelKnowMore from './pages/participant/LevelKnowMore'
import LevelWorkspace from './pages/participant/LevelWorkspace'
import Submissions from './pages/participant/Submissions'
import SubmissionDetail from './pages/participant/SubmissionDetail'
import Results from './pages/participant/Results'
import Leaderboard from './pages/participant/Leaderboard'
import Account from './pages/participant/Account'
import ReviewQueue from './pages/review/Queue'
import ReviewItem from './pages/review/ItemDetail'
import AdminDashboard from './pages/admin/Dashboard'
import AdminChallenges from './pages/admin/Challenges'
import { AdminShell } from './admin/AdminShell'
import AdminOverview from './pages/admin/Overview'
import AdminParticipantsTeams from './pages/admin/ParticipantsTeams'
import AdminEvaluations from './pages/admin/Evaluations'
import AdminScoreboard from './pages/admin/Scoreboard'
import AdminMalpractice from './pages/admin/Malpractice'
import AdminInfrastructure from './pages/admin/Infrastructure'
import AdminEventConfig from './pages/admin/EventConfig'
import AdminAccounts from './pages/admin/AdminAccounts'
import AdminNotificationCentre from './pages/admin/NotificationCentre'
import AdminLogin from './pages/admin/AdminLogin'
import AdminPasswordReset from './pages/admin/AdminPasswordReset'
import ArenaApp from './arena/ArenaApp'

function AdminResetWrapper() {
  return <AdminPasswordReset />
}

export default function App() {
  return (
    <Routes>
      {/* Public case file */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/event" element={<EventDetails />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>

      <Route path="/login" element={<Login />} />

      {/* Self-contained participant prototype with a swappable mock provider.
          No auth or backend is required until DEMO_MODE is disabled. */}
      <Route path="/arena/*" element={<ArenaApp />} />

      {/* Participant four-level experience */}
      {/* Legacy dashboard URL now forwards participants to the arena UI. */}
      <Route
        path="/dashboard"
        element={
          <RequireRole roles={['participant']}>
            <Navigate to="/arena/overview" replace />
          </RequireRole>
        }
      />

      {/* Level workspace: own chrome, guarded by RequireRole + the page-level
          server-derived guard. */}
      <Route
        path="/level/:levelNo/run"
        element={
          <RequireRole roles={['participant']}>
            <LevelWorkspace />
          </RequireRole>
        }
      />

      {/* Level routes: guards inside each page redirect to the server's
          current node; guards are UX only, the backend re-checks everything. */}
      <Route
        path="/level/:levelNo"
        element={
          <RequireRole roles={['participant']}>
            <ConsoleShell area="/app">
              <Routes>
                <Route path="explain" element={<LevelExplain />} />
                <Route path="rules" element={<LevelRules />} />
                <Route path="guide" element={<LevelGuide />} />
                <Route path="repo/:optionKey" element={<LevelKnowMore />} />
              </Routes>
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
                <Route index element={<Navigate to="/arena/overview" replace />} />
                <Route path="workspace" element={<Navigate to="/arena/overview" replace />} />
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

      {/* Admin authentication: single shared admin login entry point */}
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* Password reset works without email and without an existing session */}
      <Route path="/admin/admins/reset" element={<AdminResetWrapper />} />

      {/* Organizer / admin console with persistent sidebar */}
      <Route
        path="/admin"
        element={
          <RequireRole roles={['organizer', 'admin']}>
            <AdminShell>
              <Outlet />
            </AdminShell>
          </RequireRole>
        }
      >
        <Route index element={<AdminOverview />} />
        <Route path="participants" element={<AdminParticipantsTeams />} />
        <Route path="evaluations" element={<AdminEvaluations />} />
        <Route path="scoreboard" element={<AdminScoreboard />} />
        <Route path="malpractice" element={<AdminMalpractice />} />
        <Route path="infrastructure" element={<AdminInfrastructure />} />
        <Route path="event-config" element={<AdminEventConfig />} />
        <Route path="admins" element={<AdminAccounts />} />
        <Route path="notifications" element={<AdminNotificationCentre />} />
        <Route path="operations" element={<AdminDashboard />} />
        <Route path="challenges" element={<AdminChallenges />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
