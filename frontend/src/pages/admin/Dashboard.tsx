import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { AuditVerification, DisputeItem, ReadinessItem } from '../../lib/types';
import { InstrumentRack } from '../../components/InstrumentRack';
import { AnnunciatorBar } from '../../components/AnnunciatorBar';
import { ErrorBanner } from '../../components/ErrorBanner';

export const AdminDashboard: React.FC = () => {
  const [events, setEvents] = useState<Array<{ id: string; name: string; slug: string; status: string }>>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [liveData, setLiveData] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<ReadinessItem[]>([]);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [auditVerify, setAuditVerify] = useState<AuditVerification | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [annBody, setAnnBody] = useState('');
  const [annSev, setAnnSev] = useState<'info' | 'warning' | 'critical'>('info');
  const [postingAnn, setPostingAnn] = useState(false);

  const [stageAction, setStageAction] = useState('start');
  const [stageReason, setStageReason] = useState('Scheduled start');
  const [controllingStage, setControllingStage] = useState(false);

  const fetchInitial = async () => {
    try {
      setError(null);
      const evList = await api.getAdminEvents();
      setEvents(evList);
      if (evList.length > 0) {
        const firstId = evList[0].id;
        setSelectedEventId(firstId);
        loadEventDetails(firstId);
      }
    } catch (err) {
      setError(err);
    }
  };

  const loadEventDetails = async (eventId: string) => {
    try {
      const [liveRes, rdyRes, dispRes] = await Promise.all([
        api.getLiveOps(eventId).catch(() => null),
        api.getReadiness(eventId).catch(() => []),
        api.getDisputes().catch(() => []),
      ]);
      setLiveData(liveRes);
      setReadiness(rdyRes);
      setDisputes(dispRes);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    fetchInitial();
  }, []);

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !annBody.trim()) return;

    try {
      setPostingAnn(true);
      await api.postAnnouncement(selectedEventId, annSev, annBody.trim());
      setAnnBody('');
      loadEventDetails(selectedEventId);
    } catch (err) {
      setError(err);
    } finally {
      setPostingAnn(false);
    }
  };

  const handleControlStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;
    try {
      setControllingStage(true);
      await api.controlStage('stage-main', stageAction, stageReason);
      loadEventDetails(selectedEventId);
    } catch (err) {
      setError(err);
    } finally {
      setControllingStage(false);
    }
  };

  const handleToggleReadiness = async (key: string, currentState: string) => {
    if (!selectedEventId) return;
    const newState = currentState === 'checked' ? 'unchecked' : 'checked';
    try {
      await api.setReadinessItem(selectedEventId, key, newState);
      loadEventDetails(selectedEventId);
    } catch (err) {
      setError(err);
    }
  };

  const handleVerifyAudit = async () => {
    try {
      const res = await api.verifyAudit();
      setAuditVerify(res);
    } catch (err) {
      setError(err);
    }
  };

  const handleExport = async (kind: 'results' | 'submissions' | 'ledger') => {
    if (!selectedEventId) return;
    try {
      const data = await api.exportCsv(selectedEventId, kind);
      const blob = new Blob([data.content], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || `export-${kind}.csv`;
      a.click();
    } catch (err) {
      setError(err);
    }
  };

  const handleResolveDispute = async (id: string, outcome: 'upheld' | 'rejected') => {
    try {
      await api.resolveDispute(id, outcome, `Resolved as ${outcome} by operator`, outcome === 'upheld' ? 10 : 0);
      loadEventDetails(selectedEventId);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#2D333D]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              OPS MATRIX // CENTRAL RELAY
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Platform Master Operations Console
          </h1>
        </div>

        {events.length > 0 && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-[#7F8896]">TARGET:</span>
            <select
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                loadEventDetails(e.target.value);
              }}
              className="bg-[#101216] border border-[#2D333D] px-2.5 py-1 text-[#EAECE8] font-bold focus:outline-none"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error ? <ErrorBanner error={error} onRetry={() => loadEventDetails(selectedEventId)} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Telemetry & Readiness Matrix (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <InstrumentRack
            channel="TELEMETRY-BUS"
            title="Real-Time Station Diagnostics"
            telemetryTag="LIVE BUS"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
              <div className="instr-bezel p-3">
                <span className="text-[#7F8896] block text-[9px] uppercase">Review Backlog</span>
                <span className="text-xl font-black text-[#E5A83B]">
                  {String(liveData?.review_backlog ?? '0')}
                </span>
              </div>
              <div className="instr-bezel p-3">
                <span className="text-[#7F8896] block text-[9px] uppercase">Teams Online</span>
                <span className="text-xl font-black text-[#437A55]">
                  {String(liveData?.teams_count ?? '—')}
                </span>
              </div>
              <div className="instr-bezel p-3">
                <span className="text-[#7F8896] block text-[9px] uppercase">DB App Bus</span>
                <span className="text-xl font-black text-[#437A55]">
                  {String(liveData?.db_app ?? 'UP')}
                </span>
              </div>
              <div className="instr-bezel p-3">
                <span className="text-[#7F8896] block text-[9px] uppercase">GT Isolation</span>
                <span className="text-xl font-black text-[#437A55]">
                  {String(liveData?.db_gt ?? 'ISOLATED')}
                </span>
              </div>
            </div>
          </InstrumentRack>

          {/* Readiness Gate */}
          <InstrumentRack
            channel="READINESS-GATE"
            title="Pre-Live Certification Matrix"
            telemetryTag="ADM-EV-05"
          >
            <div className="space-y-2 font-mono text-xs">
              {readiness.map((item) => (
                <div
                  key={item.key}
                  onClick={() => handleToggleReadiness(item.key, item.state)}
                  className="flex items-center justify-between p-2.5 instr-bezel cursor-pointer hover:border-[#E5A83B] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-3.5 h-3.5 flex items-center justify-center font-bold text-[10px] ${
                        item.state === 'checked'
                          ? 'bg-[#437A55] text-white'
                          : 'bg-[#20242B] text-[#7F8896]'
                      }`}
                    >
                      {item.state === 'checked' ? '✓' : '•'}
                    </span>
                    <span className="text-[#EAECE8] font-bold">{item.label}</span>
                  </div>
                  <AnnunciatorBar
                    label={item.state}
                    tone={item.state === 'checked' ? 'sage' : 'crimson'}
                  />
                </div>
              ))}
            </div>
          </InstrumentRack>

          {/* Cryptographic Audit Chain */}
          <InstrumentRack
            channel="AUDIT-CHAIN"
            title="Cryptographic Hash Verification"
            telemetryTag="INTEGRITY ENGINE"
          >
            <div className="space-y-3 font-mono text-xs">
              <button
                type="button"
                onClick={handleVerifyAudit}
                className="px-4 py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B] transition-colors"
              >
                Execute Ledger Verification
              </button>

              {auditVerify && (
                <div
                  className={`instr-bezel p-3 space-y-1 ${
                    auditVerify.intact
                      ? 'border-[#437A55] text-[#437A55]'
                      : 'border-[#BD3A3A] text-[#BD3A3A]'
                  }`}
                >
                  <div className="font-bold">
                    {auditVerify.intact ? 'HASH CHAIN INTACT — VALIDATED' : 'INTEGRITY BREACH'}
                  </div>
                  <div className="text-[10px] text-[#7F8896]">
                    SCOPE: {auditVerify.scope} • ENTRIES: {auditVerify.verified} / {auditVerify.entries}
                  </div>
                </div>
              )}
            </div>
          </InstrumentRack>
        </div>

        {/* Right: Controls, Broadcasts & Exports (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Stage Control Card */}
          <InstrumentRack
            channel="STAGE-RELAY"
            title="Stage Transition Actuator"
            telemetryTag="STAGE GATES"
          >
            <form onSubmit={handleControlStage} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">State Transition</label>
                <select
                  value={stageAction}
                  onChange={(e) => setStageAction(e.target.value)}
                  className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1.5 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                >
                  <option value="arm">ARM — Prepare challenge delivery</option>
                  <option value="start">START — Open round window</option>
                  <option value="pause">PAUSE — Suspend timers</option>
                  <option value="resume">RESUME — Restart timers</option>
                  <option value="extend">EXTEND — Add time delta</option>
                  <option value="end">END — Close submissions</option>
                  <option value="release">RELEASE — Publish scores</option>
                </select>
              </div>

              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Audit Justification</label>
                <input
                  type="text"
                  required
                  value={stageReason}
                  onChange={(e) => setStageReason(e.target.value)}
                  placeholder="e.g. Scheduled start"
                  className="w-full bg-[#101216] border border-[#2D333D] px-2 py-1 text-xs text-[#EAECE8]"
                />
              </div>

              <button
                type="submit"
                disabled={controllingStage}
                className="w-full py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B] transition-colors"
              >
                {controllingStage ? 'Transmitting...' : 'Execute State Transition'}
              </button>
            </form>
          </InstrumentRack>

          {/* Announcement Transmitter */}
          <InstrumentRack
            channel="TRANSMITTER"
            title="Broadcast Telegram Transmitter"
            telemetryTag="LIVE BUS"
          >
            <form onSubmit={handlePostAnnouncement} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Severity Indicator</label>
                <div className="grid grid-cols-3 gap-1">
                  {(['info', 'warning', 'critical'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAnnSev(s)}
                      className={`py-1 text-center uppercase text-[10px] font-bold border ${
                        annSev === s
                          ? s === 'critical'
                            ? 'border-[#BD3A3A] bg-[#BD3A3A] text-white'
                            : s === 'warning'
                            ? 'border-[#E5A83B] bg-[#E5A83B] text-[#0E1013]'
                            : 'border-[#467499] bg-[#467499] text-white'
                          : 'border-[#2D333D] text-[#7F8896]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Broadcast Message</label>
                <textarea
                  required
                  rows={3}
                  maxLength={1000}
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder="Dispatch official advisory to all station nodes..."
                  className="w-full bg-[#101216] border border-[#2D333D] p-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={postingAnn || !annBody.trim()}
                className="w-full py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B] disabled:opacity-40 transition-colors"
              >
                {postingAnn ? 'Broadcasting...' : 'Transmit Broadcast'}
              </button>
            </form>
          </InstrumentRack>

          {/* CSV Exports */}
          <InstrumentRack
            channel="EXPORTS"
            title="Download CSV Dossiers"
            telemetryTag="STATION ARCHIVE"
          >
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => handleExport('results')}
                className="p-2.5 instr-bezel hover:border-[#E5A83B] text-center"
              >
                <span className="text-[#E5A83B] font-bold block text-[11px]">RESULTS</span>
                <span className="text-[9px] text-[#7F8896]">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('submissions')}
                className="p-2.5 instr-bezel hover:border-[#E5A83B] text-center"
              >
                <span className="text-[#437A55] font-bold block text-[11px]">SUBMISSIONS</span>
                <span className="text-[9px] text-[#7F8896]">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('ledger')}
                className="p-2.5 instr-bezel hover:border-[#E5A83B] text-center"
              >
                <span className="text-[#467499] font-bold block text-[11px]">LEDGER</span>
                <span className="text-[9px] text-[#7F8896]">CSV</span>
              </button>
            </div>
          </InstrumentRack>

          {/* Disputes Panel */}
          <InstrumentRack
            channel="DISPUTES"
            title="Pending Operator Disputes"
            telemetryTag="ARBITRATION"
          >
            <div className="space-y-2.5 font-mono text-xs max-h-56 overflow-y-auto">
              {disputes.length === 0 ? (
                <div className="text-center py-4 text-[#7F8896]">No unresolved disputes logged.</div>
              ) : (
                disputes.map((disp) => (
                  <div key={disp.id} className="instr-bezel p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[#E5A83B] font-bold">{disp.receipt_code}</span>
                      <AnnunciatorBar label={disp.status} tone={disp.status === 'pending' ? 'amber' : 'neutral'} />
                    </div>
                    <p className="text-xs font-sans text-[#B4B9C4]">{disp.statement}</p>
                    {disp.status === 'pending' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(disp.id, 'upheld')}
                          className="px-2 py-0.5 bg-[#437A55] text-white text-[10px] font-bold uppercase"
                        >
                          Uphold (+10 pts)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(disp.id, 'rejected')}
                          className="px-2 py-0.5 bg-[#BD3A3A] text-white text-[10px] font-bold uppercase"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </InstrumentRack>
        </div>
      </div>
    </div>
  );
};
