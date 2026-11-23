import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { PublicEvent } from '../lib/types';
import { DetentCounter } from '../components/DetentCounter';
import { InstrumentRack } from '../components/InstrumentRack';
import { AnnunciatorBar } from '../components/AnnunciatorBar';
import { ErrorBanner } from '../components/ErrorBanner';

export const Landing: React.FC = () => {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState<unknown>(null);

  const fetchEvent = async () => {
    try {
      setError(null);
      const data = await api.getPublicEvent();
      setEvent(data.event);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    fetchEvent();
  }, []);

  return (
    <div className="space-y-12 pb-20">
      {/* SECTION 01: MASTER TEST BENCH HEADER */}
      <section className="relative pt-6 pb-10 border-b border-[#2D333D]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
          {/* Hardware Header Rail */}
          <div className="border border-[#2D333D] bg-[#14161A] p-3 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
              <span className="text-[#E5A83B] font-bold">BENCH-ID: RI-VITB-2026</span>
              <span className="text-[#7F8896]">SECTOR: SURGICAL CODE DIAGNOSTICS</span>
            </div>
            <div className="flex items-center gap-2">
              <AnnunciatorBar
                label={event?.status ? `STATUS: ${event.status}` : 'STATUS: CALIBRATING'}
                tone={event?.status === 'live' ? 'crimson' : 'amber'}
              />
              <AnnunciatorBar label="ISOLATION: VERIFIED" tone="sage" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Industrial Callout & Actuators (7 cols) */}
            <div className="lg:col-span-7 space-y-5">
              <div className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] border border-[#E5A83B]/40 bg-[#E5A83B]/10">
                LABORATORY SPECIFICATION // APPARATUS RI-01
              </div>

              <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tight text-[#EAECE8] leading-none">
                Surgical Fault Isolation. <br />
                <span className="text-[#E5A83B]">Precision Recovery.</span>
              </h1>

              <p className="text-sm sm:text-base text-[#B4B9C4] font-sans leading-relaxed max-w-xl">
                The target production firmware has exhibited severe behavioral anomalies. Operate the calibrated diagnostic console, trace critical fault lines, and deploy verified fixes before system collapse.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-3 font-mono text-xs">
                <Link
                  to="/activate"
                  className="px-5 py-2.5 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] transition-colors"
                >
                  Engage Workspace
                </Link>
                <Link
                  to="/rules"
                  className="px-5 py-2.5 border border-[#3D4654] text-[#EAECE8] font-bold uppercase hover:bg-[#20242B] transition-colors"
                >
                  Read Operating Charter
                </Link>
              </div>
            </div>

            {/* Right: Master Clock & Telemetry Bay (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <DetentCounter
                targetIsoDate={event?.starts_at}
                label={event?.status === 'live' ? 'TIME UNTIL CUTOFF' : 'COUNTDOWN TO ENGAGEMENT'}
                size="lg"
              />

              <InstrumentRack
                channel="RACK-00"
                title="Telemetry Register"
                telemetryTag="CALIBRATED SPEC"
              >
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex justify-between py-1 border-b border-[#2D333D]">
                    <span className="text-[#7F8896]">COMPETITION ID</span>
                    <span className="font-bold text-[#EAECE8]">FALL BACK 2026</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#2D333D]">
                    <span className="text-[#7F8896]">STATION LOCATION</span>
                    <span className="font-bold text-[#EAECE8]">VIT BHOPAL UNIVERSITY</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#2D333D]">
                    <span className="text-[#7F8896]">ALLOCATED WINDOW</span>
                    <span className="font-bold text-[#E5A83B]">{event?.duration_minutes ?? 180} MIN</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-[#7F8896]">MAX OPERATORS</span>
                    <span className="font-bold text-[#EAECE8]">{event?.max_teams ?? 12} TEAMS / {event?.max_participants ?? 50} OPERATORS</span>
                  </div>
                </div>
              </InstrumentRack>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <ErrorBanner error={error} onRetry={fetchEvent} />
        </div>
      ) : null}

      {/* SECTION 02: OSCILLOSCOPE TIMELINE TRACK */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border-b border-[#2D333D] pb-3 mb-6 flex items-baseline justify-between">
          <div>
            <span className="text-[10px] font-mono text-[#E5A83B] uppercase tracking-widest">
              DIAGNOSTIC SEQUENCE // CH-01..04
            </span>
            <h2 className="text-xl sm:text-2xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
              Timing Track & Phase Synchronization
            </h2>
          </div>
          <span className="hidden sm:inline text-xs font-mono text-[#7F8896]">
            CHRONOLOGICAL TRACE
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
          <div className="instr-bezel p-4 space-y-2.5">
            <div className="flex justify-between items-center text-[10px]">
              <AnnunciatorBar label="STAGE 01" tone="amber" />
              <span className="text-[#7F8896]">30 MIN</span>
            </div>
            <div className="font-bold text-sm uppercase text-[#EAECE8]">Recon & Baseline</div>
            <p className="text-xs font-sans text-[#7F8896] leading-relaxed">
              Verify network relays, ratify operating rules, pull assigned target repositories, and map endpoints.
            </p>
          </div>

          <div className="instr-bezel p-4 space-y-2.5">
            <div className="flex justify-between items-center text-[10px]">
              <AnnunciatorBar label="STAGE 02" tone="amber" />
              <span className="text-[#7F8896]">35 MIN</span>
            </div>
            <div className="font-bold text-sm uppercase text-[#EAECE8]">Diagnostic Analysis</div>
            <p className="text-xs font-sans text-[#7F8896] leading-relaxed">
              Identify race conditions, unauthenticated endpoints, and data leakage vectors across controller modules.
            </p>
          </div>

          <div className="instr-bezel p-4 space-y-2.5">
            <div className="flex justify-between items-center text-[10px]">
              <AnnunciatorBar label="STAGE 03" tone="sage" />
              <span className="text-[#7F8896]">60 MIN</span>
            </div>
            <div className="font-bold text-sm uppercase text-[#EAECE8]">Repair & Flag Quests</div>
            <p className="text-xs font-sans text-[#7F8896] leading-relaxed">
              Formulate surgical patches, capture bonus CTF flags from hidden subsystem registers, and file telemetry.
            </p>
          </div>

          <div className="instr-bezel p-4 space-y-2.5">
            <div className="flex justify-between items-center text-[10px]">
              <AnnunciatorBar label="STAGE 04" tone="cyan" />
              <span className="text-[#7F8896]">25 MIN</span>
            </div>
            <div className="font-bold text-sm uppercase text-[#EAECE8]">Certification</div>
            <p className="text-xs font-sans text-[#7F8896] leading-relaxed">
              Automated test suite validation and human reviewer evaluation determine the immutable ledger balances.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 03: GAUGES & WEIGHTS (50/30/20) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border-b border-[#2D333D] pb-3 mb-6">
          <span className="text-[10px] font-mono text-[#E5A83B] uppercase tracking-widest">
            SCORING DYNAMICS // CALIBRATION MATRIX
          </span>
          <h2 className="text-xl sm:text-2xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            50% / 30% / 20% Evaluation Weighting
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          <InstrumentRack
            channel="METRIC-A"
            title="Automated Test Harness"
            telemetryTag="50% WEIGHT"
          >
            <div className="space-y-3">
              <div className="text-3xl font-black text-[#E5A83B]">50%</div>
              <p className="font-sans text-xs text-[#B4B9C4] leading-relaxed">
                Offline test suite executions measuring functional fix correctness and regression containment.
              </p>
              <div className="text-[10px] text-[#7F8896] border-t border-[#2D333D] pt-2">
                DISCIPLINE: ZERO TOLERANCE FOR BROKEN SUITES
              </div>
            </div>
          </InstrumentRack>

          <InstrumentRack
            channel="METRIC-B"
            title="Human Expert Review"
            telemetryTag="30% WEIGHT"
          >
            <div className="space-y-3">
              <div className="text-3xl font-black text-[#5FA57F]">30%</div>
              <p className="font-sans text-xs text-[#B4B9C4] leading-relaxed">
                5-metric rubric assessing root cause depth, code craftsmanship, and architectural stability.
              </p>
              <div className="text-[10px] text-[#D96A5F] font-bold border-t border-[#2D333D] pt-2">
                PENALTY: -5 PTS PER INVALID REPORT
              </div>
            </div>
          </InstrumentRack>

          <InstrumentRack
            channel="METRIC-C"
            title="Evidence & Reproduction"
            telemetryTag="20% WEIGHT"
          >
            <div className="space-y-3">
              <div className="text-3xl font-black text-[#6FA3C6]">20%</div>
              <p className="font-sans text-xs text-[#B4B9C4] leading-relaxed">
                Accuracy of line range pinpointing (max 25 lines) and exploit demonstration proofs.
              </p>
              <div className="text-[10px] text-[#5FA57F] font-bold border-t border-[#2D333D] pt-2">
                BONUS: UP TO 150 PTS VIA CTF FLAGS
              </div>
            </div>
          </InstrumentRack>
        </div>
      </section>

      {/* SECTION 04: ACTUATOR GATE */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border border-[#3D4654] bg-[#14161A] p-6 sm:p-10 flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <span className="text-[10px] font-mono text-[#E5A83B] uppercase tracking-widest font-bold">
              OPERATIONAL READY STATE
            </span>
            <h2 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8]">
              Ready to initialize diagnostic station?
            </h2>
            <p className="text-xs font-sans text-[#7F8896] leading-relaxed">
              Ensure you hold a valid single-use invitation token issued by the Software Development Club. Review the operating charter before engagement.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 font-mono text-xs">
            <Link
              to="/activate"
              className="px-6 py-3 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] transition-colors"
            >
              Activate Clearance
            </Link>
            <Link
              to="/login"
              className="px-6 py-3 border border-[#3D4654] text-[#EAECE8] font-bold uppercase hover:bg-[#20242B] transition-colors"
            >
              Engage Console
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
