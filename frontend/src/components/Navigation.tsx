import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatIST, getServerNow } from '../lib/time';
import { StampBadge } from './StampBadge';

export const Navigation: React.FC = () => {
  const { user, role, team, logout, isAuthenticated } = useAuth();
  const location = useLocation();
  const [clockStr, setClockStr] = useState<string>('');

  useEffect(() => {
    const tick = () => {
      setClockStr(formatIST(getServerNow()));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="border-b border-[#2B2E35] bg-[#141519]/90 backdrop-blur-md sticky top-0 z-50">
      {/* Top Telemetry Strip */}
      <div className="border-b border-[#2B2E35]/60 px-4 py-1 flex items-center justify-between text-[11px] font-mono text-[#868A94]">
        <div className="flex items-center gap-3">
          <span className="text-[#ECEEF2] font-semibold">EVENT: FALL BACK</span>
          <span className="hidden sm:inline text-[#2B2E35]">|</span>
          <span className="hidden sm:inline">SDC @ VIT BHOPAL</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3E7259]" />
            <span className="tabular-nums">{clockStr}</span>
          </div>
        </div>
      </div>

      {/* Main Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3 group text-decoration-none">
          <div className="w-7 h-7 bg-[#C04A36] text-white font-mono font-bold flex items-center justify-center text-xs tracking-tighter">
            BH
          </div>
          <div>
            <span className="font-serif font-bold text-lg text-[#ECEEF2] tracking-tight group-hover:text-[#CF8B38] transition-colors">
              Bug Hunt CTF
            </span>
            <span className="block text-[10px] font-mono text-[#868A94] uppercase tracking-wider">
              Incident Archive // Fall Back
            </span>
          </div>
        </Link>

        {/* Dynamic Navigation Links based on role */}
        <nav className="flex items-center gap-1 font-mono text-xs overflow-x-auto">
          {!isAuthenticated ? (
            <>
              <Link
                to="/"
                className={`px-3 py-1.5 border ${
                  isActive('/') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Briefing
              </Link>
              <Link
                to="/rules"
                className={`px-3 py-1.5 border ${
                  isActive('/rules') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Rules
              </Link>
              <Link
                to="/activate"
                className={`px-3 py-1.5 border ${
                  isActive('/activate') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Activate
              </Link>
              <Link
                to="/login"
                className="ml-2 px-3.5 py-1.5 bg-[#C04A36] text-white font-semibold border border-[#C04A36] hover:bg-[#A83827] transition-colors"
              >
                Sign In
              </Link>
            </>
          ) : role === 'participant' ? (
            <>
              <Link
                to="/app"
                className={`px-3 py-1.5 border ${
                  isActive('/app') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Lobby
              </Link>
              <Link
                to="/app/workspace"
                className={`px-3 py-1.5 border ${
                  isActive('/app/workspace') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Workspace
              </Link>
              <Link
                to="/app/submissions"
                className={`px-3 py-1.5 border ${
                  location.pathname.startsWith('/app/submissions')
                    ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10'
                    : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Submissions
              </Link>
              <Link
                to="/app/results"
                className={`px-3 py-1.5 border ${
                  isActive('/app/results') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Results
              </Link>
              <Link
                to="/app/leaderboard"
                className={`px-3 py-1.5 border ${
                  isActive('/app/leaderboard') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Board
              </Link>
            </>
          ) : role === 'reviewer' ? (
            <>
              <Link
                to="/review"
                className={`px-3 py-1.5 border ${
                  location.pathname.startsWith('/review')
                    ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10'
                    : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Review Desk
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/admin"
                className={`px-3 py-1.5 border ${
                  isActive('/admin') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Operations
              </Link>
              <Link
                to="/admin/challenges"
                className={`px-3 py-1.5 border ${
                  isActive('/admin/challenges') ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10' : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Challenges
              </Link>
              <Link
                to="/review"
                className={`px-3 py-1.5 border ${
                  location.pathname.startsWith('/review')
                    ? 'border-[#C04A36] text-[#ECEEF2] bg-[#C04A36]/10'
                    : 'border-transparent text-[#868A94] hover:text-[#ECEEF2]'
                }`}
              >
                Review
              </Link>
            </>
          )}
        </nav>

        {/* User Session Info & Action */}
        {isAuthenticated && user && (
          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-[#ECEEF2] font-medium">{user.name || user.email}</span>
              {team && <span className="text-[10px] text-[#CF8B38]">TEAM: {team.name}</span>}
            </div>
            <StampBadge
              label={role || 'user'}
              tone={role === 'admin' ? 'danger' : role === 'reviewer' ? 'warning' : 'info'}
            />
            <button
              type="button"
              onClick={logout}
              className="border border-[#2B2E35] px-2.5 py-1 text-[11px] text-[#868A94] hover:text-[#ECEEF2] hover:border-[#868A94] transition-colors uppercase"
            >
              Exit
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
