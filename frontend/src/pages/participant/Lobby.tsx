import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Announcement, StateResponse } from '../../lib/types';
import { DetentCounter } from '../../components/DetentCounter';
import { InstrumentRack } from '../../components/InstrumentRack';
import { AnnunciatorBar } from '../../components/AnnunciatorBar';
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
    const interval = setInterval(pollData, 5000);
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Station Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2D333D]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CHANNEL CH-01 // STATION LOBBY
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Diagnostic Station Console
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {team && (
            <div className="instr-bezel px-3 py-1 font-mono text-xs">
              <span className="text-[#7F8896]">JOIN CODE: </span>
              <span className="font-bold text-[#E5A83B]">{team.join_code}</span>
            </div>
          )}
          <AnnunciatorBar
            label={round ? `STAGE: ${round.status}` : 'STANDBY'}
            tone={round?.status === 'active' ? 'crimson' : round?.status === 'armed' ? 'amber' : 'neutral'}
          />
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={pollData} /> : null}

      {/* Grid: Master Clock, Checklist, Broadcasts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Clocks & Relays (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <DetentCounter
            targetIsoDate={round?.ends_at_effective || round?.starts_at}
            isPaused={round?.paused}
            label={
              round?.paused
                ? 'CLOCK SUSPENDED (ORGANIZER PAUSE)'
                : round?.status === 'active'
                ? 'STAGE WINDOW TERMINATION (GRACE INCLUDED)'
                : 'COUNTDOWN TO STAGE INITIATION'
            }
            size="lg"
          />

          {/* 4-Channel Relay Matrix */}
          <InstrumentRack
            channel="RELAY-MATRIX"
            title="Pre-Flight Relay Connectivity"
            telemetryTag="HARDWARE GATES"
          >
            <div className="space-y-2.5 font-mono text-xs">
              <div className="flex items-center justify-between p-2.5 bg-[#14161A] border border-[#2D333D]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#437A55]" />
                  <span className="text-[#EAECE8]">FastAPI Platform Backbone</span>
                </div>
                <span className="text-[#437A55] font-bold">TRANSMITTING</span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-[#14161A] border border-[#2D333D]">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      team ? 'bg-[#437A55]' : 'bg-[#BD3A3A]'
                    }`}
                  />
                  <span className="text-[#EAECE8]">
                    Assigned Unit: <strong>{team ? team.name : 'Unassigned'}</strong>
                  </span>
                </div>
                <span className={team ? 'text-[#437A55] font-bold' : 'text-[#BD3A3A] font-bold'}>
                  {team ? 'LOCKED' : 'PENDING'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-[#14161A] border border-[#2D333D]">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      rulesAccepted ? 'bg-[#437A55]' : 'bg-[#BD3A3A]'
                    }`}
                  />
                  <span className="text-[#EAECE8]">Charter Ratification</span>
                </div>
                {rulesAccepted ? (
                  <span className="text-[#437A55] font-bold">RATIFIED</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAcceptRules}
                    disabled={accepting}
                    className="px-2.5 py-0.5 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B]"
                  >
                    {accepting ? 'Ratifying...' : 'Ratify Now'}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between p-2.5 bg-[#14161A] border border-[#2D333D]">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      round?.status === 'active' ? 'bg-[#437A55]' : 'bg-[#E5A83B]'
                    }`}
                  />
                  <span className="text-[#EAECE8]">Challenge Binary Delivery</span>
                </div>
                <span
                  className={
                    round?.status === 'active'
                      ? 'text-[#437A55] font-bold'
                      : 'text-[#E5A83B] font-bold'
                  }
                >
                  {round?.status === 'active' ? 'ONLINE' : 'ARMED / PENDING'}
                </span>
              </div>
            </div>
          </InstrumentRack>

          {/* Quick Actuators */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
            <Link
              to="/app/workspace"
              className="instr-bezel p-3.5 hover:border-[#E5A83B] transition-colors block"
            >
              <span className="text-[10px] text-[#E5A83B] font-bold block mb-1">
                CH-02 // WORKBENCH
              </span>
              <span className="text-[#EAECE8] font-bold">Inspect & Patch &rarr;</span>
            </Link>
            <Link
              to="/app/submissions"
              className="instr-bezel p-3.5 hover:border-[#E5A83B] transition-colors block"
            >
              <span className="text-[10px] text-[#437A55] font-bold block mb-1">
                CH-03 // TRANSMISSIONS
              </span>
              <span className="text-[#EAECE8] font-bold">HMAC Receipts &rarr;</span>
            </Link>
            <Link
              to="/app/leaderboard"
              className="instr-bezel p-3.5 hover:border-[#E5A83B] transition-colors block"
            >
              <span className="text-[10px] text-[#467499] font-bold block mb-1">
                CH-05 // BOARD
              </span>
              <span className="text-[#EAECE8] font-bold">Live Standings &rarr;</span>
            </Link>
          </div>
        </div>

        {/* Right Column: Telemetry Log & Identity (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <InstrumentRack
            channel="BROADCAST-BUS"
            title="Operational Dispatches"
            telemetryTag="ACTIVE RECEIVER"
          >
            <div className="space-y-2.5 font-mono text-xs max-h-[380px] overflow-y-auto">
              {announcements.length === 0 ? (
                <div className="text-center py-8 text-[#7F8896]">
                  No dispatches on current broadcast bus.
                </div>
              ) : (
                announcements.map((ann) => (
                  <div
                    key={ann.id}
                    className="instr-bezel p-3 space-y-1.5 border border-[#2D333D]"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <AnnunciatorBar
                        label={ann.severity}
                        tone={
                          ann.severity === 'critical'
                            ? 'crimson'
                            : ann.severity === 'warning'
                            ? 'amber'
                            : 'cyan'
                        }
                      />
                      <span className="text-[#7F8896]">DISPATCH: {ann.author}</span>
                    </div>
                    <p className="text-xs font-sans text-[#EAECE8] pt-1 leading-relaxed">
                      {ann.body}
                    </p>
                  </div>
                ))
              )}
            </div>
          </InstrumentRack>

          {/* Operator Profile Register */}
          <InstrumentRack
            channel="OPERATOR-ID"
            title="Hardware Register"
            telemetryTag="NODE PROFILE"
          >
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex justify-between py-1 border-b border-[#2D333D]">
                <span className="text-[#7F8896]">OPERATOR</span>
                <span className="text-[#EAECE8] font-bold">{user?.name || '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#2D333D]">
                <span className="text-[#7F8896]">EMAIL</span>
                <span className="text-[#EAECE8]">{user?.email}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#2D333D]">
                <span className="text-[#7F8896]">UNIT</span>
                <span className="text-[#E5A83B] font-bold">{team?.name || 'Unassigned'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#7F8896]">LEVEL</span>
                <span className="text-[#437A55] font-bold uppercase">{user?.role}</span>
              </div>
            </div>
          </InstrumentRack>
        </div>
      </div>
    </div>
  );
};
