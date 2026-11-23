import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { AuditVerification, DisputeItem, ReadinessItem } from '../../lib/types';
import { TopoPanel } from '../../components/TopoPanel';
import { SectorBadge } from '../../components/SectorBadge';
import { ErrorBanner } from '../../components/ErrorBanner';

export const AdminDashboard: React.FC = () => {
  const [events, setEvents] = useState<Array<{ id: string; name: string; slug: string; status: string }>>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [liveData, setLiveData] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<ReadinessItem[]>([]);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [auditVerify, setAuditVerify] = useState<AuditVerification | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Announcement state
  const [annBody, setAnnBody] = useState('');
  const [annSev, setAnnSev] = useState<'info' | 'warning' | 'critical'>('info');
  const [postingAnn, setPostingAnn] = useState(false);

  // Stage control state
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
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#22303F]">
        <div>
          <p className="coordinate">COMMAND POST // OPERATIONS SECTOR</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            Event telemetry & stage control
          </h1>
        </div>
        {events.length > 0 && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <label htmlFor="adm-event" className="text-[#7E8FA1] uppercase tracking-[0.12em]">
              Event
            </label>
            <select
              id="adm-event"
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                loadEventDetails(e.target.value);
              }}
              className="bg-[#0C1220] border border-[#22303F] px-3 py-1.5 text-[#E2E8EE] font-bold focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: telemetry, readiness, audit */}
        <div className="lg:col-span-7 space-y-6">
          <TopoPanel sector="CP-01" coords="REF: LIVE TELEMETRY" title="Live survey telemetry">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="border border-[#22303F] bg-[#0C1220] p-3">
                <span className="coordinate block">Review backlog</span>
                <span className="text-xl font-bold text-[#E2A56B]">
                  {String(liveData?.review_backlog ?? '0')}
                </span>
              </div>
              <div className="border border-[#22303F] bg-[#0C1220] p-3">
                <span className="coordinate block">Teams online</span>
                <span className="text-xl font-bold text-[#63A98D]">
                  {String(liveData?.teams_count ?? '—')}
                </span>
              </div>
              <div className="border border-[#22303F] bg-[#0C1220] p-3">
                <span className="coordinate block">DB app</span>
                <span className="text-xl font-bold text-[#63A98D]">
                  {String(liveData?.db_app ?? 'UP')}
                </span>
              </div>
              <div className="border border-[#22303F] bg-[#0C1220] p-3">
                <span className="coordinate block">DB ground truth</span>
                <span className="text-xl font-bold text-[#63A98D]">
                  {String(liveData?.db_gt ?? 'ISOLATED')}
                </span>
              </div>
            </div>
          </TopoPanel>

          <TopoPanel
            sector="CP-02"
            coords="REF: LAUNCH GATE (8 ITEMS)"
            title="Readiness gate"
            subtitle="Every gate must be certified before the event goes live."
          >
            <div className="space-y-2 font-mono text-xs">
              {readiness.length === 0 ? (
                <div className="text-[#7E8FA1] py-2">No readiness items returned for this event.</div>
              ) : (
                readiness.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleToggleReadiness(item.key, item.state)}
                    aria-pressed={item.state === 'checked'}
                    className="w-full flex items-center justify-between p-2.5 border border-[#2A3B50] bg-[#131C2B] cursor-pointer hover:bg-[#1A273A] transition-colors text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={`w-4 h-4 flex items-center justify-center font-bold text-[10px] ${
                          item.state === 'checked'
                            ? 'bg-[#3F7A68] text-white'
                            : 'bg-[#22303F] text-[#7E8FA1]'
                        }`}
                      >
                        {item.state === 'checked' ? '+' : '-'}
                      </span>
                      <span className="text-[#E2E8EE] font-bold">{item.label}</span>
                    </div>
                    <span
                      className={`font-bold uppercase tracking-[0.12em] ${
                        item.state === 'checked' ? 'text-[#63A98D]' : 'text-[#E0836F]'
                      }`}
                    >
                      {item.state.toUpperCase()}
                    </span>
                  </button>
                ))
              )}
            </div>
          </TopoPanel>

          <TopoPanel sector="CP-03" coords="REF: SHA-256 CHAIN" title="Audit chain verification">
            <div className="space-y-3 font-mono text-xs">
              <button
                type="button"
                onClick={handleVerifyAudit}
                className="px-4 py-2 bg-[#4A8FA8] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#5BA3BC] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
              >
                Run hash-chain audit
              </button>

              {auditVerify && (
                <div
                  className={`border p-3 space-y-1 ${
                    auditVerify.intact
                      ? 'border-[#3F7A68] bg-[#3F7A68]/10 text-[#63A98D]'
                      : 'border-[#C44D3F] bg-[#C44D3F]/10 text-[#E0836F]'
                  }`}
                  role="status"
                >
                  <div className="font-bold uppercase tracking-[0.12em]">
                    {auditVerify.intact ? 'CHAIN INTACT: NO TAMPERING DETECTED' : 'CHAIN BROKEN'}
                  </div>
                  <div className="text-[11px] text-[#7E8FA1]">
                    SCOPE: {auditVerify.scope} • VERIFIED: {auditVerify.verified} / {auditVerify.entries}
                    {auditVerify.broken_at !== null ? ` • BROKEN AT: ${auditVerify.broken_at}` : ''}
                  </div>
                </div>
              )}
            </div>
          </TopoPanel>
        </div>

        {/* Right: stage control, broadcasts, exports, disputes */}
        <div className="lg:col-span-5 space-y-6">
          <TopoPanel sector="CP-04" coords="REF: STAGE TRANSITIONS" title="Stratum control">
            <form onSubmit={handleControlStage} className="space-y-3 font-mono text-xs">
              <div>
                <label htmlFor="adm-action" className="coordinate block mb-1">
                  Action
                </label>
                <select
                  id="adm-action"
                  value={stageAction}
                  onChange={(e) => setStageAction(e.target.value)}
                  className="w-full bg-[#0C1220] border border-[#22303F] px-2.5 py-1.5 text-xs text-[#E2E8EE] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  <option value="arm">ARM: prepare challenge delivery</option>
                  <option value="start">START: open round window</option>
                  <option value="pause">PAUSE: stop timers</option>
                  <option value="resume">RESUME: restart timers</option>
                  <option value="extend">EXTEND: add time</option>
                  <option value="end">END: close submissions</option>
                  <option value="release">RELEASE: publish scores</option>
                </select>
              </div>

              <div>
                <label htmlFor="adm-reason" className="coordinate block mb-1">
                  Reason (audit record)
                </label>
                <input
                  id="adm-reason"
                  type="text"
                  required
                  value={stageReason}
                  onChange={(e) => setStageReason(e.target.value)}
                  placeholder="e.g. Scheduled start"
                  className="w-full bg-[#0C1220] border border-[#22303F] px-2.5 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={controllingStage}
                className="w-full py-2 bg-[#CF824B] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#B87040] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
              >
                {controllingStage ? 'Transmitting...' : 'Apply stage action'}
              </button>
            </form>
          </TopoPanel>

          <TopoPanel sector="CP-05" coords="REF: BROADCAST" title="Dispatch telegram">
            <form onSubmit={handlePostAnnouncement} className="space-y-3 font-mono text-xs">
              <div>
                <span className="coordinate block mb-1">Severity tone</span>
                <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Announcement severity">
                  {(['info', 'warning', 'critical'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={annSev === s}
                      onClick={() => setAnnSev(s)}
                      className={`py-1 text-center uppercase text-[10px] font-bold border tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8] ${
                        annSev === s
                          ? s === 'critical'
                            ? 'border-[#C44D3F] bg-[#C44D3F] text-white'
                            : s === 'warning'
                            ? 'border-[#CF824B] bg-[#CF824B] text-[#090E16]'
                            : 'border-[#4A8FA8] bg-[#4A8FA8] text-[#090E16]'
                          : 'border-[#22303F] text-[#7E8FA1]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="adm-ann" className="coordinate block mb-1">
                  Telegram body
                </label>
                <textarea
                  id="adm-ann"
                  required
                  rows={3}
                  maxLength={1000}
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder="Official dispatch to every surveyor console..."
                  className="w-full bg-[#0C1220] border border-[#22303F] p-2 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={postingAnn || !annBody.trim()}
                className="w-full py-2 bg-[#C44D3F] text-white font-bold uppercase tracking-[0.14em] hover:bg-[#A83E32] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
              >
                {postingAnn ? 'Broadcasting...' : 'Dispatch telegram'}
              </button>
            </form>
          </TopoPanel>

          <TopoPanel sector="CP-06" coords="REF: CSV EXPORTS" title="Chart exports">
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              {(
                [
                  ['results', 'RESULTS', 'text-[#7FBBD1]'],
                  ['submissions', 'FILINGS', 'text-[#63A98D]'],
                  ['ledger', 'LEDGER', 'text-[#E2A56B]'],
                ] as const
              ).map(([kind, label, tone]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleExport(kind)}
                  className="p-2.5 border border-[#22303F] hover:border-[#718294] text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  <span className={`${tone} font-bold block`}>{label}</span>
                  <span className="text-[10px] text-[#7E8FA1]">CSV</span>
                </button>
              ))}
            </div>
          </TopoPanel>

          <TopoPanel sector="CP-07" coords="REF: ARBITRATION" title="Open disputes">
            <div className="space-y-3 font-mono text-xs max-h-60 overflow-y-auto">
              {disputes.length === 0 ? (
                <div className="text-center py-4 text-[#7E8FA1]">No disputes on the docket.</div>
              ) : (
                disputes.map((disp) => (
                  <div key={disp.id} className="border border-[#22303F] p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[#E2A56B] font-bold">{disp.receipt_code}</span>
                      <SectorBadge
                        label={disp.status}
                        tone={disp.status === 'pending' ? 'strain' : 'legend'}
                      />
                    </div>
                    <p className="text-xs font-sans text-[#C6D2DC]">{disp.statement}</p>
                    {disp.status === 'pending' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(disp.id, 'upheld')}
                          className="px-2 py-1 bg-[#3F7A68] text-white text-[10px] font-bold uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                        >
                          Uphold (+10 pts)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(disp.id, 'rejected')}
                          className="px-2 py-1 bg-[#C44D3F] text-white text-[10px] font-bold uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </TopoPanel>
        </div>
      </div>
    </div>
  );
};
