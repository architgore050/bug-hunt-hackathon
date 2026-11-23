import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Announcement, StateResponse } from '../../lib/types';
import { SeismicClock } from '../../components/SeismicClock';
import { TopoPanel } from '../../components/TopoPanel';
import { SectorBadge } from '../../components/SectorBadge';
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
    const interval = setInterval(pollData, 5000); // /v1/state cadence per contract
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

  const stageTone =
    round?.status === 'active' ? 'shear' : round?.status === 'armed' ? 'strain' : 'legend';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#22303F]">
        <div className="space-y-1">
          <p className="coordinate">BASE CAMP // SURVEYOR STAGING</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE]">
            Field conditions
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {team && (
            <div className="topo-panel bg-[#0C1220] px-3.5 py-1.5 font-mono text-xs">
              <span className="text-[#718294]">BEACON CODE: </span>
              <span className="font-bold text-[#CF824B]">{team.join_code}</span>
            </div>
          )}
          <SectorBadge
            label={round ? `STRATUM: ${round.status.toUpperCase()}` : 'NO ACTIVE STRATUM'}
            tone={stageTone}
          />
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={pollData} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-6">
          <SeismicClock
            targetIsoDate={round?.ends_at_effective || round?.starts_at}
            isPaused={round?.paused}
            label={
              round?.paused
                ? 'ROUND PAUSED: TIMER HALTED'
                : round?.status === 'active'
                ? 'STRATUM CLOSES (GRACE INCLUDED)'
                : 'COUNTDOWN TO STRATUM START'
            }
            size="lg"
          />

          <TopoPanel
            sector="READINESS MATRIX"
            coords="REF: PRE-SURVEY CHECKS"
            title="Surveyor readiness"
            subtitle="All rows must stabilize before the field desk opens."
          >
            <div className="space-y-0 font-mono text-xs">
              <div className="flex items-center justify-between py-2.5 border-b border-[#22303F]">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className={`w-2 h-2 ${true ? 'bg-[#3F7A68]' : ''}`} />
                  <span className="text-[#E2E8EE]">Platform survey channel</span>
                </div>
                <span className="text-[#3F7A68] font-bold">CONNECTED</span>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-[#22303F]">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 ${team ? 'bg-[#3F7A68]' : 'bg-[#C44D3F]'}`}
                  />
                  <span className="text-[#E2E8EE]">
                    Team beacon:{' '}
                    <strong className="font-bold">{team ? team.name : 'Unassigned'}</strong>
                  </span>
                </div>
                <span className={team ? 'text-[#3F7A68] font-bold' : 'text-[#C44D3F] font-bold'}>
                  {team ? 'TRIANGULATED' : 'PENDING'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-[#22303F]">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 ${rulesAccepted ? 'bg-[#3F7A68]' : 'bg-[#C44D3F]'}`}
                  />
                  <span className="text-[#E2E8EE]">Survey protocol ratification</span>
                </div>
                {rulesAccepted ? (
                  <span className="text-[#3F7A68] font-bold">RATIFIED</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAcceptRules}
                    disabled={accepting}
                    className="px-2.5 py-1 bg-[#CF824B] text-[#090E16] font-bold uppercase tracking-[0.12em] hover:bg-[#B87040] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                  >
                    {accepting ? 'Recording...' : 'Ratify now'}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 ${
                      round?.status === 'active' || round?.status === 'armed'
                        ? 'bg-[#3F7A68]'
                        : 'bg-[#CF824B]'
                    }`}
                  />
                  <span className="text-[#E2E8EE]">Challenge terrain delivery</span>
                </div>
                <span
                  className={
                    round?.status === 'active'
                      ? 'text-[#3F7A68] font-bold'
                      : 'text-[#CF824B] font-bold'
                  }
                >
                  {round?.status === 'active' ? 'OPEN' : 'AWAITS STRATUM ARM'}
                </span>
              </div>
            </div>
          </TopoPanel>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
            <Link
              to="/app/workspace"
              className="topo-panel bg-[#111A27] p-4 hover:border-[#4A8FA8] transition-colors block focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
            >
              <span className="text-[#4A8FA8] font-bold block mb-1 uppercase tracking-[0.12em]">01 // Field desk</span>
              <span className="text-[#E2E8EE] font-bold">Survey & file &rarr;</span>
            </Link>
            <Link
              to="/app/submissions"
              className="topo-panel bg-[#111A27] p-4 hover:border-[#4A8FA8] transition-colors block focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
            >
              <span className="text-[#CF824B] font-bold block mb-1 uppercase tracking-[0.12em]">02 // Filings</span>
              <span className="text-[#E2E8EE] font-bold">Receipts & seals &rarr;</span>
            </Link>
            <Link
              to="/app/leaderboard"
              className="topo-panel bg-[#111A27] p-4 hover:border-[#4A8FA8] transition-colors block focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
            >
              <span className="text-[#3F7A68] font-bold block mb-1 uppercase tracking-[0.12em]">03 // Peaks</span>
              <span className="text-[#E2E8EE] font-bold">Elevation table &rarr;</span>
            </Link>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <TopoPanel
            sector="TELEGRAMS"
            coords="REF: OPERATIONS BROADCAST"
            title="Field telegrams"
            subtitle="Dispatches from the command post."
          >
            <div className="space-y-3 font-mono text-xs">
              {announcements.length === 0 ? (
                <div className="text-center py-8 text-[#718294]">
                  No telegrams dispatched by the command post yet.
                </div>
              ) : (
                announcements.map((ann) => (
                  <div
                    key={ann.id}
                    className={`border p-3 space-y-1.5 ${
                      ann.severity === 'critical'
                        ? 'border-[#C44D3F] bg-[#C44D3F]/10'
                        : ann.severity === 'warning'
                        ? 'border-[#CF824B] bg-[#CF824B]/10'
                        : 'border-[#22303F] bg-[#0C1220]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <SectorBadge
                        label={ann.severity}
                        tone={
                          ann.severity === 'critical'
                            ? 'shear'
                            : ann.severity === 'warning'
                            ? 'strain'
                            : 'elevation'
                        }
                      />
                      <span className="coordinate">FROM: {ann.author}</span>
                    </div>
                    <p className="text-sm font-sans text-[#E2E8EE] leading-relaxed pt-1">
                      {ann.body}
                    </p>
                  </div>
                ))
              )}
            </div>
          </TopoPanel>

          <TopoPanel sector="IDENTITY" coords="REF: SURVEYOR DOSSIER" title="Surveyor dossier">
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between py-1.5 border-b border-[#22303F]">
                <span className="text-[#718294] uppercase tracking-[0.12em]">Surveyor</span>
                <span className="text-[#E2E8EE] font-bold">{user?.name || '—'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#22303F]">
                <span className="text-[#718294] uppercase tracking-[0.12em]">Email</span>
                <span className="text-[#E2E8EE]">{user?.email}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#22303F]">
                <span className="text-[#718294] uppercase tracking-[0.12em]">Team</span>
                <span className="text-[#CF824B] font-bold">{team?.name || 'Unassigned'}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-[#718294] uppercase tracking-[0.12em]">Clearance</span>
                <span className="text-[#3F7A68] font-bold uppercase">{user?.role}</span>
              </div>
            </div>
          </TopoPanel>
        </div>
      </div>
    </div>
  );
};
