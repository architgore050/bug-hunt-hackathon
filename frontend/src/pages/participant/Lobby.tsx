import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Announcement, StateResponse } from '../../lib/types';
import { CountdownDisplay } from '../../components/CountdownDisplay';
import { ExhibitCard } from '../../components/ExhibitCard';
import { StampBadge } from '../../components/StampBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const Lobby: React.FC = () => {
  const { user, team, rulesAccepted, acceptRules } = useAuth();

  const [stateData, setStateData] = useState<StateResponse | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [accepting, setAccepting] = useState(false);

  const pollData = async () => {
    try {
      setError(null);
      const [sRes, aRes] = await Promise.all([
        api.getState(),
        api.getAnnouncements(10),
      ]);
      setStateData(sRes);
      setAnnouncements(aRes);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    pollData();
    const interval = setInterval(pollData, 5000); // Poll every 5s per spec
    return () => clearInterval(interval);
  }, []);

  const round = stateData?.round;

  const handleAcceptRules = async () => {
    try {
      setAccepting(true);
      await acceptRules();
    } catch (err) {
      setError(err);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2B2E35]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36] animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              OPERATIONS DESK // PARTICIPANT LOBBY
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2]">
            Active Incident Command
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {team && (
            <div className="border border-[#2B2E35] bg-[#141519] px-3.5 py-1.5 font-mono text-xs">
              <span className="text-[#868A94]">JOIN CODE: </span>
              <span className="font-bold text-[#ECEEF2]">{team.join_code}</span>
            </div>
          )}
          <StampBadge
            label={round ? `STAGE: ${round.status}` : 'NO ACTIVE STAGE'}
            tone={round?.status === 'active' ? 'danger' : round?.status === 'armed' ? 'warning' : 'neutral'}
          />
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={pollData} /> : null}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Clock & Readiness */}
        <div className="lg:col-span-7 space-y-6">
          <CountdownDisplay
            targetIsoDate={round?.ends_at_effective || round?.starts_at}
            isPaused={round?.paused}
            label={
              round?.paused
                ? 'ROUND PAUSED — TIMER HALTED'
                : round?.status === 'active'
                ? 'STAGE CLOSES (INCLUDING GRACE PERIOD)'
                : 'COUNTDOWN TO STAGE START'
            }
            size="lg"
          />

          {/* Readiness Checklist */}
          <ExhibitCard
            exhibitNumber="EX-01"
            category="READINESS VERIFICATION"
            title="Pre-Flight System Clearance Checklist"
            variant="buff"
          >
            <div className="space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between py-2 border-b border-[#DDD7CA]">
                <div className="flex items-center gap-2">
                  <span className="text-[#5EA57E] font-bold">✓</span>
                  <span className="text-[#181A1F]">Platform Backend Interface</span>
                </div>
                <span className="text-[#5EA57E] font-bold">CONNECTED</span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[#DDD7CA]">
                <div className="flex items-center gap-2">
                  <span className={team ? 'text-[#5EA57E] font-bold' : 'text-[#E2715A] font-bold'}>
                    {team ? '✓' : '✗'}
                  </span>
                  <span className="text-[#181A1F]">
                    Team Assignment: <strong className="font-bold">{team ? team.name : 'Unassigned'}</strong>
                  </span>
                </div>
                <span className={team ? 'text-[#5EA57E] font-bold' : 'text-[#E2715A] font-bold'}>
                  {team ? 'VERIFIED' : 'PENDING'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[#DDD7CA]">
                <div className="flex items-center gap-2">
                  <span className={rulesAccepted ? 'text-[#5EA57E] font-bold' : 'text-[#E2715A] font-bold'}>
                    {rulesAccepted ? '✓' : '✗'}
                  </span>
                  <span className="text-[#181A1F]">Competition Rules Ratification</span>
                </div>
                {rulesAccepted ? (
                  <span className="text-[#5EA57E] font-bold">RATIFIED</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAcceptRules}
                    disabled={accepting}
                    className="px-2.5 py-1 bg-[#C04A36] text-white font-bold uppercase hover:bg-[#A83827]"
                  >
                    {accepting ? 'Accepting...' : 'Accept Rules Now'}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      round?.status === 'active' || round?.status === 'armed'
                        ? 'text-[#5EA57E] font-bold'
                        : 'text-[#CF8B38] font-bold'
                    }
                  >
                    {round?.status === 'active' ? '✓' : '•'}
                  </span>
                  <span className="text-[#181A1F]">Repository Challenge Delivery</span>
                </div>
                <span
                  className={
                    round?.status === 'active'
                      ? 'text-[#5EA57E] font-bold'
                      : 'text-[#CF8B38] font-bold'
                  }
                >
                  {round?.status === 'active' ? 'ACCESSIBLE' : 'PENDING STAGE ARM'}
                </span>
              </div>
            </div>
          </ExhibitCard>

          {/* Quick Shortcuts */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
            <Link
              to="/app/workspace"
              className="border border-[#2B2E35] bg-[#181A1F] p-4 hover:border-[#C04A36] transition-colors block"
            >
              <span className="text-[#E2715A] font-bold block mb-1">01 // CODE WORKSPACE</span>
              <span className="text-[#ECEEF2] font-bold">Investigate & File &rarr;</span>
            </Link>
            <Link
              to="/app/submissions"
              className="border border-[#2B2E35] bg-[#181A1F] p-4 hover:border-[#C04A36] transition-colors block"
            >
              <span className="text-[#CF8B38] font-bold block mb-1">02 // SUBMISSIONS</span>
              <span className="text-[#ECEEF2] font-bold">Receipts & Slips &rarr;</span>
            </Link>
            <Link
              to="/app/leaderboard"
              className="border border-[#2B2E35] bg-[#181A1F] p-4 hover:border-[#C04A36] transition-colors block"
            >
              <span className="text-[#5EA57E] font-bold block mb-1">03 // STANDINGS</span>
              <span className="text-[#ECEEF2] font-bold">Leaderboard &rarr;</span>
            </Link>
          </div>
        </div>

        {/* Right Column: Live Announcements */}
        <div className="lg:col-span-5 space-y-6">
          <ExhibitCard
            exhibitNumber="EX-02"
            category="DISPATCH TELEGRAMS"
            title="Live Operational Broadcasts"
          >
            <div className="space-y-3 font-mono text-xs">
              {announcements.length === 0 ? (
                <div className="text-center py-8 text-[#868A94]">
                  No broadcasts dispatched by organizers yet.
                </div>
              ) : (
                announcements.map((ann) => (
                  <div
                    key={ann.id}
                    className={`border p-3 space-y-1.5 ${
                      ann.severity === 'critical'
                        ? 'border-[#C04A36] bg-[#C04A36]/10'
                        : ann.severity === 'warning'
                        ? 'border-[#CF8B38] bg-[#CF8B38]/10'
                        : 'border-[#2B2E35] bg-[#141519]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <StampBadge
                        label={ann.severity}
                        tone={
                          ann.severity === 'critical'
                            ? 'danger'
                            : ann.severity === 'warning'
                            ? 'warning'
                            : 'info'
                        }
                      />
                      <span className="text-[#868A94]">BY {ann.author}</span>
                    </div>
                    <p className="text-sm font-sans text-[#ECEEF2] leading-relaxed pt-1">
                      {ann.body}
                    </p>
                  </div>
                ))
              )}
            </div>
          </ExhibitCard>

          {/* Team Roster Card */}
          <ExhibitCard
            exhibitNumber="EX-03"
            category="AUTHENTICATED IDENTITY"
            title="Investigator Dossier"
          >
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between py-1 border-b border-[#2B2E35]">
                <span className="text-[#868A94]">OPERATOR NAME</span>
                <span className="text-[#ECEEF2] font-bold">{user?.name || '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#2B2E35]">
                <span className="text-[#868A94]">OPERATOR EMAIL</span>
                <span className="text-[#ECEEF2]">{user?.email}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#2B2E35]">
                <span className="text-[#868A94]">ASSIGNED TEAM</span>
                <span className="text-[#CF8B38] font-bold">{team?.name || 'Unassigned'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#868A94]">ROLE CLEARANCE</span>
                <span className="text-[#5EA57E] font-bold uppercase">{user?.role}</span>
              </div>
            </div>
          </ExhibitCard>
        </div>
      </div>
    </div>
  );
};
