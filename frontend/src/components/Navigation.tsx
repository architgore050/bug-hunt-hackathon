import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatIST, getServerNow } from '../lib/time';
import { AnnunciatorBar } from './AnnunciatorBar';

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
    <header className="border-b border-[#2D333D] bg-[#14161A] sticky top-0 z-50">
      {/* Avionics Bus Strip */}
      <div className="border-b border-[#2D333D]/60 px-4 py-1 flex items-center justify-between text-[10px] font-mono text-[#7F8896]">
        <div className="flex items-center gap-3">
          <span className="text-[#EAECE8] font-bold">APPARATUS: RI-2026-X1</span>
          <span className="text-[#2D333D]">|</span>
          <span>POWER BUS: NOMINAL (28V DC)</span>
          <span className="text-[#2D333D]">|</span>
          <span className="hidden sm:inline">SDC // VIT BHOPAL</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[#5FA57F] font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#437A55]" />
            CLK LOCKED:
          </span>
          <span className="tabular-nums text-[#EAECE8]">{clockStr}</span>
        </div>
      </div>

      {/* Main Console Rail */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5 group text-decoration-none">
          <div className="w-6 h-6 bg-[#20242B] border border-[#3D4654] text-[#E5A83B] font-mono font-bold flex items-center justify-center text-xs">
            RI
          </div>
          <div>
            <span className="font-sans font-black text-sm text-[#EAECE8] tracking-wider uppercase group-hover:text-[#E5A83B] transition-colors">
              Bug Hunt CTF
            </span>
            <span className="block text-[9px] font-mono text-[#7F8896] uppercase tracking-widest">
              Recovery Instrument // Fall Back
            </span>
          </div>
        </Link>

        {/* Channel Navigation */}
        <nav className="flex items-center gap-1 font-mono text-xs overflow-x-auto">
          {!isAuthenticated ? (
            <>
              <Link
                to="/"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  isActive('/')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                01 // Specs
              </Link>
              <Link
                to="/rules"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  isActive('/rules')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                02 // Rules
              </Link>
              <Link
                to="/activate"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  isActive('/activate')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                03 // Activate
              </Link>
              <Link
                to="/login"
                className="ml-2 px-3 py-1 uppercase text-[11px] font-bold bg-[#E5A83B] text-[#0E1013] hover:bg-[#D4982B] transition-colors"
              >
                Engage
              </Link>
            </>
          ) : role === 'participant' ? (
            <>
              <Link
                to="/app"
                className={`px-2.5 py-1 uppercase text-[11px] border ${
                  isActive('/app')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                CH-01 Lobby
              </Link>
              <Link
                to="/app/workspace"
                className={`px-2.5 py-1 uppercase text-[11px] border ${
                  isActive('/app/workspace')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                CH-02 Desk
              </Link>
              <Link
                to="/app/submissions"
                className={`px-2.5 py-1 uppercase text-[11px] border ${
                  location.pathname.startsWith('/app/submissions')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                CH-03 Logs
              </Link>
              <Link
                to="/app/results"
                className={`px-2.5 py-1 uppercase text-[11px] border ${
                  isActive('/app/results')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                CH-04 Metrics
              </Link>
              <Link
                to="/app/leaderboard"
                className={`px-2.5 py-1 uppercase text-[11px] border ${
                  isActive('/app/leaderboard')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                CH-05 Board
              </Link>
            </>
          ) : role === 'reviewer' ? (
            <>
              <Link
                to="/review"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  location.pathname.startsWith('/review')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                Triage Bay
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/admin"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  isActive('/admin')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                Ops Matrix
              </Link>
              <Link
                to="/admin/challenges"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  isActive('/admin/challenges')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                Ground Truth
              </Link>
              <Link
                to="/review"
                className={`px-3 py-1 uppercase text-[11px] border ${
                  location.pathname.startsWith('/review')
                    ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013] font-bold'
                    : 'border-[#2D333D] text-[#7F8896] hover:text-[#EAECE8]'
                }`}
              >
                Review Bay
              </Link>
            </>
          )}
        </nav>

        {/* Identity & Disengage Switch */}
        {isAuthenticated && user && (
          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-[#EAECE8] font-bold text-[11px]">{user.name || user.email}</span>
              {team && <span className="text-[10px] text-[#E5A83B]">TEAM: {team.name}</span>}
            </div>
            <AnnunciatorBar
              label={role || 'OPERATOR'}
              tone={role === 'admin' ? 'crimson' : role === 'reviewer' ? 'amber' : 'sage'}
            />
            <button
              type="button"
              onClick={logout}
              className="border border-[#3D4654] px-2 py-0.5 text-[10px] uppercase font-bold text-[#7F8896] hover:text-white hover:border-[#EAECE8] transition-colors"
            >
              Disengage
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
