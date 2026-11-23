import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { AuditVerification, DisputeItem, ReadinessItem } from '../../lib/types';
import { ExhibitCard } from '../../components/ExhibitCard';
import { StampBadge } from '../../components/StampBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const AdminDashboard: React.FC = () => {
  const [events, setEvents] = useState<Array<{ id: string; name: string; slug: string; status: string }>>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [liveData, setLiveData] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<ReadinessItem[]>([]);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [auditVerify, setAuditVerify] = useState<AuditVerification | null>(null);

  const [error, setError] = useState<unknown>(null);

  // Announcement State
  const [annBody, setAnnBody] = useState('');
  const [annSev, setAnnSev] = useState<'info' | 'warning' | 'critical'>('info');
  const [postingAnn, setPostingAnn] = useState(false);

  // Stage Control State
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
      await api.resolveDispute(id, outcome, `Resolved as ${outcome} by organizer`, outcome === 'upheld' ? 10 : 0);
      loadEventDetails(selectedEventId);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#2B2E35]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36] animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              CENTRAL COMMAND // OPERATIONS DESK
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            Platform Operations & Live Telemetry
          </h1>
        </div>

        {events.length > 0 && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-[#868A94]">EVENT:</span>
            <select
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                loadEventDetails(e.target.value);
              }}
              className="bg-[#141519] border border-[#2B2E35] px-3 py-1.5 text-[#ECEEF2] font-bold focus:outline-none"
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

      {/* Grid: Telemetry, Readiness, Broadcasts, Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Operational Telemetry & Readiness Gate (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <ExhibitCard
            exhibitNumber="EX-01"
            category="LIVE METRICS"
            title="Real-Time Competition Telemetry"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="border border-[#2B2E35] bg-[#111215] p-3">
                <span className="text-[#868A94] block text-[10px] uppercase">Review Backlog</span>
                <span className="text-xl font-bold text-[#CF8B38]">
                  {String(liveData?.review_backlog ?? '0')}
                </span>
              </div>
              <div className="border border-[#2B2E35] bg-[#111215] p-3">
                <span className="text-[#868A94] block text-[10px] uppercase">Active Teams</span>
                <span className="text-xl font-bold text-[#3E7259]">
                  {String(liveData?.teams_count ?? '—')}
                </span>
              </div>
              <div className="border border-[#2B2E35] bg-[#111215] p-3">
                <span className="text-[#868A94] block text-[10px] uppercase">DB App State</span>
                <span className="text-xl font-bold text-[#3E7259]">
                  {String(liveData?.db_app ?? 'UP')}
                </span>
              </div>
              <div className="border border-[#2B2E35] bg-[#111215] p-3">
                <span className="text-[#868A94] block text-[10px] uppercase">DB GT Isolation</span>
                <span className="text-xl font-bold text-[#3E7259]">
                  {String(liveData?.db_gt ?? 'ISOLATED')}
                </span>
              </div>
            </div>
          </ExhibitCard>

          {/* Readiness Gate Checklist */}
          <ExhibitCard
            exhibitNumber="EX-02"
            category="READINESS GATE (ADM-EV-05)"
            title="Pre-Live Verification Matrix"
            variant="buff"
          >
            <div className="space-y-2 font-mono text-xs">
              <p className="text-xs font-sans text-[#6A665D] pb-1">
                All 8 operational gates must be certified before transitioning event status to live:
              </p>
              {readiness.map((item) => (
                <div
                  key={item.key}
                  onClick={() => handleToggleReadiness(item.key, item.state)}
                  className="flex items-center justify-between p-2.5 border border-[#DDD7CA] bg-[#EBE6DB] cursor-pointer hover:bg-[#E3DDCF] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 flex items-center justify-center font-bold text-[10px] ${
                        item.state === 'checked'
                          ? 'bg-[#3E7259] text-white'
                          : 'bg-[#DDD7CA] text-[#6A665D]'
                      }`}
                    >
                      {item.state === 'checked' ? '✓' : '•'}
                    </span>
                    <span className="text-[#181A1F] font-bold">{item.label}</span>
                  </div>
                  <span
                    className={`font-bold ${
                      item.state === 'checked' ? 'text-[#3E7259]' : 'text-[#C04A36]'
                    }`}
                  >
                    {item.state.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </ExhibitCard>

          {/* Audit Verification */}
          <ExhibitCard
            exhibitNumber="EX-03"
            category="CRYPTOGRAPHIC INTEGRITY"
            title="SHA-256 Audit Chain Verification"
          >
            <div className="space-y-3 font-mono text-xs">
              <button
                type="button"
                onClick={handleVerifyAudit}
                className="px-4 py-2 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase hover:bg-[#A83827] transition-colors"
              >
                Execute Cryptographic Hash-Chain Audit
              </button>

              {auditVerify && (
                <div
                  className={`border p-3 space-y-1 ${
                    auditVerify.intact
                      ? 'border-[#3E7259] bg-[#3E7259]/10 text-[#3E7259]'
                      : 'border-[#C04A36] bg-[#C04A36]/10 text-[#C04A36]'
                  }`}
                >
                  <div className="font-bold">
                    {auditVerify.intact ? 'HASH CHAIN INTACT — NO TAMPERING DETECTED' : 'CHAIN COMPROMISED'}
                  </div>
                  <div className="text-[11px] text-[#868A94]">
                    SCOPE: {auditVerify.scope} • ENTRIES VERIFIED: {auditVerify.verified} / {auditVerify.entries}
                  </div>
                </div>
              )}
            </div>
          </ExhibitCard>
        </div>

        {/* Right: Broadcasts, CSV Exports & Disputes (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Stage Control Card */}
          <ExhibitCard
            exhibitNumber="EX-STAGE"
            category="ROUND CONTROL"
            title="Stage State Transitions"
          >
            <form onSubmit={handleControlStage} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[#868A94] uppercase mb-1">Action</label>
                <select
                  value={stageAction}
                  onChange={(e) => setStageAction(e.target.value)}
                  className="w-full bg-[#111215] border border-[#2B2E35] px-2.5 py-1.5 text-xs text-[#ECEEF2] focus:outline-none"
                >
                  <option value="arm">ARM — Prepare challenge delivery</option>
                  <option value="start">START — Open round window</option>
                  <option value="pause">PAUSE — Stop timers</option>
                  <option value="resume">RESUME — Restart timers</option>
                  <option value="extend">EXTEND — Add time</option>
                  <option value="end">END — Close submissions</option>
                  <option value="release">RELEASE — Publish scores</option>
                </select>
              </div>

              <div>
                <label className="block text-[#868A94] uppercase mb-1">Reason / Justification</label>
                <input
                  type="text"
                  required
                  value={stageReason}
                  onChange={(e) => setStageReason(e.target.value)}
                  placeholder="e.g. Scheduled start"
                  className="w-full bg-[#111215] border border-[#2B2E35] px-2.5 py-1.5 text-xs text-[#ECEEF2]"
                />
              </div>

              <button
                type="submit"
                disabled={controllingStage}
                className="w-full py-2 bg-[#CF8B38] text-[#181A1F] font-bold uppercase hover:bg-[#B87528] transition-colors"
              >
                {controllingStage ? 'Transmitting...' : 'Apply Stage Action'}
              </button>
            </form>
          </ExhibitCard>

          {/* Announcement Dispatch */}
          <ExhibitCard
            exhibitNumber="EX-04"
            category="TRANSMITTER"
            title="Dispatch Broadcast to Consoles"
          >
            <form onSubmit={handlePostAnnouncement} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[#868A94] uppercase mb-1">Severity Tone</label>
                <div className="grid grid-cols-3 gap-1">
                  {(['info', 'warning', 'critical'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAnnSev(s)}
                      className={`py-1 text-center uppercase text-[10px] font-bold border ${
                        annSev === s
                          ? s === 'critical'
                            ? 'border-[#C04A36] bg-[#C04A36] text-[#ECEEF2]'
                            : s === 'warning'
                            ? 'border-[#CF8B38] bg-[#CF8B38] text-[#ECEEF2]'
                            : 'border-[#4B7B9A] bg-[#4B7B9A] text-[#ECEEF2]'
                          : 'border-[#2B2E35] text-[#868A94]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[#868A94] uppercase mb-1">Broadcast Message</label>
                <textarea
                  required
                  rows={3}
                  maxLength={1000}
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder="Official message dispatched to all participants..."
                  className="w-full bg-[#111215] border border-[#2B2E35] p-2 text-xs text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={postingAnn || !annBody.trim()}
                className="w-full py-2 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase hover:bg-[#A83827] disabled:opacity-40 transition-colors"
              >
                {postingAnn ? 'Broadcasting...' : 'Broadcast Telegram'}
              </button>
            </form>
          </ExhibitCard>

          {/* Export Records */}
          <ExhibitCard
            exhibitNumber="EX-05"
            category="EXPORTS"
            title="Download CSV Dossiers"
          >
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => handleExport('results')}
                className="p-2.5 border border-[#2B2E35] hover:border-[#ECEEF2] text-center"
              >
                <span className="text-[#CF8B38] font-bold block">RESULTS</span>
                <span className="text-[10px] text-[#868A94]">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('submissions')}
                className="p-2.5 border border-[#2B2E35] hover:border-[#ECEEF2] text-center"
              >
                <span className="text-[#3E7259] font-bold block">SUBMISSIONS</span>
                <span className="text-[10px] text-[#868A94]">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('ledger')}
                className="p-2.5 border border-[#2B2E35] hover:border-[#ECEEF2] text-center"
              >
                <span className="text-[#4B7B9A] font-bold block">LEDGER</span>
                <span className="text-[10px] text-[#868A94]">CSV</span>
              </button>
            </div>
          </ExhibitCard>

          {/* Disputes Queue */}
          <ExhibitCard
            exhibitNumber="EX-06"
            category="ARBITRATION"
            title="Pending Participant Disputes"
          >
            <div className="space-y-3 font-mono text-xs max-h-60 overflow-y-auto">
              {disputes.length === 0 ? (
                <div className="text-center py-4 text-[#868A94]">No active disputes filed.</div>
              ) : (
                disputes.map((disp) => (
                  <div key={disp.id} className="border border-[#2B2E35] p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[#CF8B38] font-bold">{disp.receipt_code}</span>
                      <StampBadge label={disp.status} tone={disp.status === 'pending' ? 'warning' : 'neutral'} />
                    </div>
                    <p className="text-xs font-sans text-[#C4C8D2]">{disp.statement}</p>
                    {disp.status === 'pending' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(disp.id, 'upheld')}
                          className="px-2 py-1 bg-[#3E7259] text-white text-[10px] font-bold uppercase"
                        >
                          Uphold (+10 pts)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(disp.id, 'rejected')}
                          className="px-2 py-1 bg-[#C04A36] text-white text-[10px] font-bold uppercase"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ExhibitCard>
        </div>
      </div>
    </div>
  );
};
