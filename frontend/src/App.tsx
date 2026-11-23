import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, RequireRole } from './lib/auth';
import { Navigation } from './components/Navigation';
import { Footer } from './components/Footer';

// Pages
import { Landing } from './pages/Landing';
import { Rules } from './pages/Rules';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { Login } from './pages/Login';
import { Activate } from './pages/Activate';
import { NotFound } from './pages/NotFound';

// Participant
import { Lobby } from './pages/participant/Lobby';
import { Workspace } from './pages/participant/Workspace';
import { Submissions } from './pages/participant/Submissions';
import { SubmissionDetailPage } from './pages/participant/SubmissionDetail';
import { Results } from './pages/participant/Results';
import { Leaderboard } from './pages/participant/Leaderboard';

// Reviewer
import { ReviewQueue } from './pages/review/Queue';
import { ReviewItemDetailPage } from './pages/review/ItemDetail';

// Admin
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminChallenges } from './pages/admin/Challenges';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen flex flex-col bg-[#0E1013] text-[#EAECE8]">
          <Navigation />
          <main className="flex-1">
            <Routes>
              {/* Public */}
              <Route path="/" element={<Landing />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/login" element={<Login />} />
              <Route path="/activate" element={<Activate />} />

              {/* Participant */}
              <Route
                path="/app"
                element={
                  <RequireRole roles={['participant']}>
                    <Lobby />
                  </RequireRole>
                }
              />
              <Route
                path="/app/workspace"
                element={
                  <RequireRole roles={['participant']}>
                    <Workspace />
                  </RequireRole>
                }
              />
              <Route
                path="/app/submissions"
                element={
                  <RequireRole roles={['participant']}>
                    <Submissions />
                  </RequireRole>
                }
              />
              <Route
                path="/app/submissions/:id"
                element={
                  <RequireRole roles={['participant']}>
                    <SubmissionDetailPage />
                  </RequireRole>
                }
              />
              <Route
                path="/app/results"
                element={
                  <RequireRole roles={['participant']}>
                    <Results />
                  </RequireRole>
                }
              />
              <Route
                path="/app/leaderboard"
                element={
                  <RequireRole roles={['participant']}>
                    <Leaderboard />
                  </RequireRole>
                }
              />

              {/* Reviewer */}
              <Route
                path="/review"
                element={
                  <RequireRole roles={['reviewer', 'organizer', 'admin']}>
                    <ReviewQueue />
                  </RequireRole>
                }
              />
              <Route
                path="/review/items/:itemId"
                element={
                  <RequireRole roles={['reviewer', 'organizer', 'admin']}>
                    <ReviewItemDetailPage />
                  </RequireRole>
                }
              />

              {/* Admin */}
              <Route
                path="/admin"
                element={
                  <RequireRole roles={['organizer', 'admin']}>
                    <AdminDashboard />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/challenges"
                element={
                  <RequireRole roles={['organizer', 'admin']}>
                    <AdminChallenges />
                  </RequireRole>
                }
              />

              {/* 404 Not Found */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
};
