import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatIST, getServerNow } from '../lib/time';
import { SectorBadge } from './SectorBadge';

const linkBase =
  'px-3 py-1.5 border text-[#7E8FA1] hover:text-[#E2E8EE] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]';
const linkActive = 'border-[#4A8FA8] text-[#E2E8EE] bg-[#4A8FA8]/10';
const linkIdle = 'border-transparent';

export const Navigation: React.FC = () => {
  const { user, role, team, logout, isAuthenticated } = useAuth();
  const location = useLocation();
  const [clockStr, setClockStr] = useState<string>('');

  useEffect(() => {
    const tick = () => setClockStr(formatIST(getServerNow()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="border-b border-[#22303F] bg-[#0C1220]/95 backdrop-blur-md sticky top-0 z-50">
      {/* Coordinate ruler strip */}
      <div
        className="border-b border-[#22303F]/70 px-4 py-1 flex items-center justify-between text-[10px] font-mono tracking-[0.14em] uppercase text-[#7E8FA1]"
        aria-label="Survey telemetry strip"
      >
        <div className="flex items-center gap-3">
          <span className="text-[#E2E8EE] font-semibold tracking-[0.18em]">
            LAT 23.078° N / LON 77.001° E
          </span>
          <span className="hidden sm:inline text-[#22303F]" aria-hidden="true">|</span>
          <span className="hidden sm:inline">VIT BHOPAL UNIVERSITY</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3F7A68] beacon-pulse" aria-hidden="true" />
          <span className="tabular-nums">{clockStr}</span>
        </div>
      </div>

      {/* Main bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3 group text-decoration-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]">
          <span
            aria-hidden="true"
            className="w-7 h-7 flex items-center justify-center border border-[#4A8FA8] text-[#7FBBD1] font-mono font-bold text-[10px] tracking-tighter"
          >
            FA
          </span>
          <span>
            <span className="font-serif font-bold text-lg text-[#E2E8EE] tracking-tight group-hover:text-[#7FBBD1] transition-colors block leading-tight">
              Bug Hunt CTF
            </span>
            <span className="block text-[10px] font-mono text-[#7E8FA1] uppercase tracking-[0.18em]">
              Failure Atlas // Fall Back
            </span>
          </span>
        </Link>

        <nav aria-label="Primary survey navigation" className="flex items-center gap-1 font-mono text-xs overflow-x-auto">
          {!isAuthenticated ? (
            <>
              <Link to="/" className={`${linkBase} ${isActive('/') ? linkActive : linkIdle}`}>
                Survey
              </Link>
              <Link to="/rules" className={`${linkBase} ${isActive('/rules') ? linkActive : linkIdle}`}>
                Protocol
              </Link>
              <Link to="/activate" className={`${linkBase} ${isActive('/activate') ? linkActive : linkIdle}`}>
                Activate
              </Link>
              <Link
                to="/login"
                className="ml-2 px-3.5 py-1.5 bg-[#4A8FA8] text-[#090E16] font-semibold border border-[#4A8FA8] hover:bg-[#5BA3BC] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
              >
                Sign In
              </Link>
            </>
          ) : role === 'participant' ? (
            <>
              <Link to="/app" className={`${linkBase} ${isActive('/app') ? linkActive : linkIdle}`}>
                Base Camp
              </Link>
              <Link to="/app/workspace" className={`${linkBase} ${isActive('/app/workspace') ? linkActive : linkIdle}`}>
                Field Desk
              </Link>
              <Link
                to="/app/submissions"
                className={`${linkBase} ${location.pathname.startsWith('/app/submissions') ? linkActive : linkIdle}`}
              >
                Filings
              </Link>
              <Link to="/app/results" className={`${linkBase} ${isActive('/app/results') ? linkActive : linkIdle}`}>
                Ledger
              </Link>
              <Link to="/app/leaderboard" className={`${linkBase} ${isActive('/app/leaderboard') ? linkActive : linkIdle}`}>
                Peaks
              </Link>
            </>
          ) : role === 'reviewer' ? (
            <>
              <Link
                to="/review"
                className={`${linkBase} ${location.pathname.startsWith('/review') ? linkActive : linkIdle}`}
              >
                Verification Ledger
              </Link>
            </>
          ) : (
            <>
              <Link to="/admin" className={`${linkBase} ${isActive('/admin') ? linkActive : linkIdle}`}>
                Command Post
              </Link>
              <Link to="/admin/challenges" className={`${linkBase} ${isActive('/admin/challenges') ? linkActive : linkIdle}`}>
                Ground Truth
              </Link>
              <Link
                to="/review"
                className={`${linkBase} ${location.pathname.startsWith('/review') ? linkActive : linkIdle}`}
              >
                Verification
              </Link>
            </>
          )}
        </nav>

        {isAuthenticated && user && (
          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-[#E2E8EE] font-medium">{user.name || user.email}</span>
              {team && <span className="text-[10px] text-[#E2A56B]">TEAM: {team.name}</span>}
            </div>
            <SectorBadge
              label={role || 'user'}
              tone={role === 'admin' ? 'shear' : role === 'reviewer' ? 'strain' : 'elevation'}
            />
            <button
              type="button"
              onClick={logout}
              className="border border-[#22303F] px-2.5 py-1 text-[11px] text-[#7E8FA1] hover:text-[#E2E8EE] hover:border-[#718294] transition-colors uppercase tracking-widest focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
            >
              Strike Camp
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
