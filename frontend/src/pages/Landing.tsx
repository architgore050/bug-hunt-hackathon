import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { PublicEvent } from '../lib/types';
import { SeismicClock } from '../components/SeismicClock';
import { SectorBadge } from '../components/SectorBadge';
import { TopoPanel } from '../components/TopoPanel';
import { ErrorBanner } from '../components/ErrorBanner';
import { ContourField } from '../components/ContourField';

/**
 * The topological system map: four survey quadrants of the Fall Back event,
 * joined by contour rules and crossed by an active shear line.
 */
const SystemMap: React.FC<{ status: string | undefined }> = ({ status }) => {
  const sectors = [
    { id: 'Q1', label: 'RECONNAISSANCE', depth: '0-30 MIN' },
    { id: 'Q2', label: 'FAULT ISOLATION', depth: '30-65 MIN' },
    { id: 'Q3', label: 'REPAIR & FLAGS', depth: '65-125 MIN' },
    { id: 'Q4', label: 'STABILIZATION', depth: '125-150 MIN' },
  ];

  return (
    <div className="topo-panel bg-[#111A27] p-4">
      <div className="flex items-center justify-between pb-3">
        <span className="coordinate">TOPOLOGICAL SYSTEM MAP</span>
        <SectorBadge label={status ? `EVENT: ${status.toUpperCase()}` : 'EVENT: STANDBY'} tone={status === 'live' ? 'shear' : 'strain'} />
      </div>
      <svg
        viewBox="0 0 420 240"
        role="img"
        aria-label="Topological map of the four competition quadrants crossed by an active fault line"
        className="w-full"
      >
        {/* contour rules */}
        <g fill="none" strokeWidth="1" opacity="0.7">
          <path d="M8 60 Q110 40 210 58 T412 44" stroke="#22303F" />
          <path d="M8 120 Q120 100 220 118 T412 104" stroke="#22303F" />
          <path d="M8 180 Q110 162 210 178 T412 164" stroke="#22303F" />
        </g>
        {/* shear line */}
        <line x1="60" y1="10" x2="330" y2="230" stroke="#C44D3F" strokeWidth="1.8" />
        <circle cx="196" cy="119" r="11" fill="none" stroke="#CF824B" strokeWidth="1.3" />
        <line x1="196" y1="104" x2="196" y2="134" stroke="#CF824B" strokeWidth="0.8" />
        <line x1="181" y1="119" x2="211" y2="119" stroke="#CF824B" strokeWidth="0.8" />
        <text x="214" y="140" fill="#CF824B" fontFamily="IBM Plex Mono, monospace" fontSize="9" letterSpacing="1.5">
          FAULT C-01
        </text>
        {/* quadrant nodes */}
        <g fontFamily="IBM Plex Mono, monospace" fontSize="10">
          <rect x="20" y="26" width="150" height="40" fill="#0C1220" stroke="#4A8FA8" strokeWidth="1.2" />
          <text x="30" y="43" fill="#4A8FA8" letterSpacing="1.5">Q1 // RECON</text>
          <text x="30" y="57" fill="#718294" fontSize="8.5">0-30 MIN</text>

          <rect x="250" y="26" width="150" height="40" fill="#0C1220" stroke="#CF824B" strokeWidth="1.2" />
          <text x="260" y="43" fill="#CF824B" letterSpacing="1.5">Q2 // ISOLATION</text>
          <text x="260" y="57" fill="#718294" fontSize="8.5">30-65 MIN</text>

          <rect x="20" y="150" width="150" height="40" fill="#0C1220" stroke="#C44D3F" strokeWidth="1.2" />
          <text x="30" y="167" fill="#C44D3F" letterSpacing="1.5">Q3 // REPAIR</text>
          <text x="30" y="181" fill="#718294" fontSize="8.5">65-125 MIN</text>

          <rect x="250" y="150" width="150" height="40" fill="#0C1220" stroke="#3F7A68" strokeWidth="1.2" />
          <text x="260" y="167" fill="#3F7A68" letterSpacing="1.5">Q4 // PROOF</text>
          <text x="260" y="181" fill="#718294" fontSize="8.5">125-150 MIN</text>
        </g>
        {/* connecting contour lines */}
        <g stroke="#34495F" strokeWidth="1" strokeDasharray="3 3">
          <line x1="170" y1="46" x2="250" y2="46" />
          <line x1="95" y1="66" x2="95" y2="150" />
          <line x1="325" y1="66" x2="325" y2="150" />
          <line x1="170" y1="170" x2="250" y2="170" />
        </g>
      </svg>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-[#22303F] font-mono text-[10px] text-[#7E8FA1] uppercase tracking-[0.12em]">
        {sectors.map((s) => (
          <div key={s.id} className="flex justify-between py-0.5">
            <span>{s.id}: {s.label}</span>
            <span>{s.depth}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const STRATA = [
  {
    band: 'S-01',
    phase: 'Reconnaissance & Setup',
    window: '30 MIN',
    depth: 'SURFACE LAYER',
    tone: 'text-[#7FBBD1]',
    bar: 'bg-[#4A8FA8]/25 border-[#4A8FA8]',
    body: 'Ratify the survey protocol, open the assigned challenge repository, run baseline tests and chart the exposed surface: routes, handlers, configuration.',
  },
  {
    band: 'S-02',
    phase: 'Fault-Line Isolation',
    window: '35 MIN',
    depth: 'UPPER STRATA',
    tone: 'text-[#E2A56B]',
    bar: 'bg-[#CF824B]/20 border-[#CF824B]',
    body: 'Trace execution flows toward the discontinuities. Pin exact line coordinates, classify each fracture against the 12-vector taxonomy, and draft your evidence.',
  },
  {
    band: 'S-03',
    phase: 'Structural Repair & CTF Expeditions',
    window: '60 MIN',
    depth: 'DEEP STRATA',
    tone: 'text-[#E0836F]',
    bar: 'bg-[#C44D3F]/20 border-[#C44D3F]',
    body: 'Anchor the repair: patch the root cause, not the symptom. Deep crevices hide bonus CTF flags for teams that survey past the obvious faults.',
  },
  {
    band: 'S-04',
    phase: 'Stabilization Proof',
    window: '25 MIN',
    depth: 'BEDROCK',
    tone: 'text-[#63A98D]',
    bar: 'bg-[#3F7A68]/20 border-[#3F7A68]',
    body: 'Reviewers verify each anchor: automated suites re-run, rubrics are scored, and the cryptographic ledger certifies the final stabilized map.',
  },
];

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
    <div className="pb-20">
      {/* HERO: elevation composition over survey grid */}
      <section className="atlas-grid-bg border-b border-[#22303F] relative overflow-hidden">
        <ContourField className="absolute inset-x-0 bottom-0 h-64 w-full opacity-60" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-[#22303F]/70 text-[10px] font-mono uppercase tracking-[0.14em] text-[#7E8FA1]">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-[#C44D3F]" aria-hidden="true" />
              <span className="text-[#E2A56B] font-bold">SURVEY REF: FB-2026-11</span>
              <span className="hidden sm:inline">STRUCTURAL INTEGRITY COMPETITION</span>
            </div>
            <SectorBadge
              label={event?.status ? `STATE: ${event.status.toUpperCase()}` : 'STATE: AWAITING SURVEY DATA'}
              tone={event?.status === 'live' ? 'shear' : 'strain'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-12 pb-16 items-start">
            <div className="lg:col-span-7 space-y-7">
              <p className="coordinate">FALL BACK // OFFICIAL FAILURE ATLAS EXPEDITION</p>
              <h1 className="font-serif text-[#E2E8EE] leading-[1.02] text-5xl sm:text-6xl lg:text-7xl tracking-tight">
                Survey the fractures.
                <span className="block elevation-callout font-normal text-[#7FBBD1] text-4xl sm:text-5xl lg:text-6xl mt-2">
                  Chart the recovery.
                </span>
              </h1>
              <p className="text-base sm:text-lg text-[#B6C2CE] font-sans leading-relaxed max-w-xl">
                A production cluster is failing along known and unknown fault lines. Your team maps
                its architecture, pins each defect to exact line coordinates, and anchors a verified
                repair before the survey window closes.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Link
                  to="/activate"
                  className="px-6 py-3 bg-[#C44D3F] text-white font-mono text-sm uppercase tracking-[0.14em] font-bold border border-[#C44D3F] hover:bg-[#A83E32] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  Begin the expedition
                </Link>
                <Link
                  to="/rules"
                  className="px-6 py-3 border border-[#34495F] text-[#E2E8EE] font-mono text-sm uppercase tracking-[0.14em] hover:bg-[#1A273A] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  Read the survey protocol
                </Link>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-2 pt-4 font-mono text-[11px] text-[#7E8FA1] uppercase tracking-[0.12em]">
                <span>HOST: SOFTWARE DEVELOPMENT CLUB</span>
                <span>SITE: VIT BHOPAL UNIVERSITY</span>
                <span>WINDOW: {event?.duration_minutes ?? 150} MIN</span>
              </div>
            </div>

            <div className="lg:col-span-5 space-y-5 relative">
              <SeismicClock
                targetIsoDate={event?.starts_at}
                label={event?.status === 'live' ? 'SURVEY WINDOW CLOSES' : 'SURVEY WINDOW OPENS'}
                size="lg"
              />
              <SystemMap status={event?.status} />
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
          <ErrorBanner error={error} onRetry={fetchEvent} />
        </div>
      ) : null}

      {/* SECTION 01: THE FRACTURE SPECIMEN */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-16">
        <div className="flex items-center gap-4 pb-6">
          <span className="coordinate shrink-0">SECTOR-01 // WHAT YOU SURVEY</span>
          <span className="h-px flex-1 bg-[#22303F]" aria-hidden="true" />
          <span className="crosshair-tick w-8 shrink-0 self-stretch" aria-hidden="true" />
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#E2E8EE] max-w-2xl">
          Every fault has a coordinate. Your job is to prove it.
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 items-start">
          {/* Fracture specimen with coordinate ruler */}
          <div className="lg:col-span-7">
            <TopoPanel
              sector="SPECIMEN C-01"
              coords="COORD:routes/notes.js#L44-46"
              title="An unresolved shear line"
              subtitle="A finding is only accepted when it carries exact coordinates, a root cause and reproducible proof."
            >
              <div className="font-mono text-[11px] leading-relaxed border border-[#22303F] bg-[#0C1220] overflow-x-auto">
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      { n: 42, code: "router.get('/notes/:id', async (req, res) => {", mark: false },
                      { n: 43, code: '  // fetch a single note for display', mark: false },
                      { n: 44, code: "  const note = await db.get('SELECT * FROM notes WHERE id = ?', [req.params.id]);", mark: true },
                      { n: 45, code: '  if (!note) return res.status(404).json({ error: "Not found" });', mark: true },
                      { n: 46, code: '  res.json(note); // shear: author ownership never verified', mark: true },
                      { n: 47, code: '});', mark: false },
                    ].map((row) => (
                      <tr key={row.n} className={row.mark ? 'bg-[#C44D3F]/15' : ''}>
                        <td
                          className={`w-12 px-2 py-0.5 text-right select-none border-r border-[#22303F] ${
                            row.mark ? 'text-[#E0836F] font-bold' : 'text-[#7E8FA1]'
                          }`}
                        >
                          {row.n}
                        </td>
                        <td className="px-3 py-0.5 whitespace-pre text-[#C6D2DC]">
                          {row.code}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 font-mono text-[11px] text-[#7E8FA1] uppercase tracking-[0.12em]">
                <span>TAXONOMY VECTOR: AUTHORIZATION</span>
                <span className="text-[#E0836F] font-bold">STRESS: HIGH</span>
              </div>
            </TopoPanel>
          </div>

          {/* Filing protocol */}
          <div className="lg:col-span-5 space-y-5">
            <TopoPanel sector="PROTOCOL" coords="REF: FILING-DOCKET" title="What anchors a valid finding">
              <ol className="space-y-4 font-sans text-sm text-[#B6C2CE] leading-relaxed list-none m-0 p-0">
                {[
                  ['Pin the fracture', 'Select the exact line span (up to 25 lines) in the assigned challenge files.'],
                  ['Classify the stress', 'File it under one of twelve taxonomy vectors, from authorization to integrity.'],
                  ['Anchor with proof', 'Root cause, impact, and a reproduction: the reviewer must be able to re-derive your fault.'],
                  ['Receive your seal', 'Every filing returns an HMAC receipt code: immutable proof your survey reached the desk.'],
                ].map(([head, body], i) => (
                  <li key={i} className="flex gap-3">
                    <span className="font-mono text-[#7FBBD1] font-bold shrink-0" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>
                      <strong className="text-[#E2E8EE] block">{head}.</strong>
                      {body}
                    </span>
                  </li>
                ))}
              </ol>
            </TopoPanel>
          </div>
        </div>
      </section>

      {/* SECTION 02: STRATA TIMELINE */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-16">
        <div className="flex items-center gap-4 pb-6">
          <span className="coordinate shrink-0">SECTOR-02 // DEPTH PROFILE</span>
          <span className="h-px flex-1 bg-[#22303F]" aria-hidden="true" />
          <span className="crosshair-tick w-8 shrink-0 self-stretch" aria-hidden="true" />
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#E2E8EE] max-w-2xl">
          The survey descends in four strata.
        </h2>
        <p className="text-sm text-[#7E8FA1] max-w-xl pt-3 font-sans leading-relaxed">
          150 minutes, server-clock governed. Each band closes on the round clock; the deepest
          faults only surface in the final hours.
        </p>

        <div className="pt-8 space-y-3">
          {STRATA.map((s) => (
            <div
              key={s.band}
              className={`border ${s.bar} p-5 flex flex-col md:flex-row md:items-start gap-4`}
            >
              <div className="md:w-36 shrink-0 font-mono">
                <div className={`text-sm font-bold ${s.tone}`}>{s.band}</div>
                <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#B6C2CE] mt-1">{s.depth}</div>
                <div className="text-[11px] text-[#B6C2CE] mt-0.5">{s.window}</div>
              </div>
              <div className="flex-1">
                <h3 className="font-serif font-bold text-lg text-[#E2E8EE]">{s.phase}</h3>
                <p className="text-sm text-[#B6C2CE] font-sans leading-relaxed pt-1.5 max-w-3xl">
                  {s.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 03: EQUILIBRIUM FORMULA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-16">
        <div className="flex items-center gap-4 pb-6">
          <span className="coordinate shrink-0">SECTOR-03 // EQUILIBRIUM FORMULA</span>
          <span className="h-px flex-1 bg-[#22303F]" aria-hidden="true" />
          <span className="crosshair-tick w-8 shrink-0 self-stretch" aria-hidden="true" />
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#E2E8EE] max-w-3xl">
          The ledger balances at 50 / 30 / 20.
        </h2>

        {/* Balance bar */}
        <div className="pt-8">
          <div
            role="img"
            aria-label="Score composition bar: 50 percent automated functional tests, 30 percent human review, 20 percent evidence quality, plus capped CTF flag bonus"
            className="flex h-14 w-full border border-[#34495F] overflow-hidden"
          >
            <div className="bg-[#4A8FA8]/35 border-r border-[#090E16] flex items-center justify-center font-mono text-xs text-[#E2E8EE] tracking-widest" style={{ width: '50%' }}>
              50
            </div>
            <div className="bg-[#CF824B]/30 border-r border-[#090E16] flex items-center justify-center font-mono text-xs text-[#E2E8EE] tracking-widest" style={{ width: '30%' }}>
              30
            </div>
            <div className="bg-[#3F7A68]/30 border-r border-[#090E16] flex items-center justify-center font-mono text-xs text-[#E2E8EE] tracking-widest" style={{ width: '20%' }}>
              20
            </div>
            <div className="bg-[#22303F]/50 flex items-center justify-center font-mono text-xs text-[#7E8FA1] tracking-widest flex-1">
              BONUS
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-6">
            {[
              {
                t: 'Automated functional tests',
                w: '50%',
                tone: 'text-[#7FBBD1]',
                body: 'Test suites execute against your repaired build. A broken suite anchors nothing.',
                p: 'No points while the suite fails',
              },
              {
                t: 'Human expert review',
                w: '30%',
                tone: 'text-[#E2A56B]',
                body: 'Reviewers score a five-metric rubric: functionality, root cause, code quality, testing, evidence.',
                p: '-5 points per invalid finding',
              },
              {
                t: 'Evidence & report quality',
                w: '20%',
                tone: 'text-[#63A98D]',
                body: 'Clarity of the root cause narrative, impact analysis and reproduction accuracy.',
                p: 'Capped rubric deduction',
              },
              {
                t: 'CTF flag bonus',
                w: 'CAP',
                tone: 'text-[#7E8FA1]',
                body: 'Flags recovered from deep crevices verify cryptographically and top up the ledger.',
                p: 'Capped at the configured bonus limit',
              },
            ].map((c) => (
              <div key={c.t} className="topo-panel bg-[#111A27] p-4 space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em]">
                  <span className={`${c.tone} font-bold`}>{c.w}</span>
                </div>
                <h3 className="font-serif font-bold text-[#E2E8EE]">{c.t}</h3>
                <p className="text-xs text-[#B6C2CE] font-sans leading-relaxed">{c.body}</p>
                <p className="text-[11px] font-mono text-[#7E8FA1] uppercase tracking-[0.1em] pt-1 border-t border-[#22303F]">
                  {c.p}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 04: TREATY */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-16">
        <div className="flex items-center gap-4 pb-6">
          <span className="coordinate shrink-0">SECTOR-04 // TREATY & SAFE HARBOR</span>
          <span className="h-px flex-1 bg-[#22303F]" aria-hidden="true" />
          <span className="crosshair-tick w-8 shrink-0 self-stretch" aria-hidden="true" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              s: 'T-01',
              h: 'Authorized ground',
              b: 'Auditing the designated challenge repositories is sanctioned research. Probing platform infrastructure, university networks or fellow teams is not.',
              link: { to: '/terms', label: 'Terms of engagement' },
            },
            {
              s: 'T-02',
              h: 'Independent surveys',
              b: 'Findings, exploit proofs and flags stay inside your registered team. Cross-team sharing is immediate disqualification.',
              link: { to: '/rules', label: 'Full survey protocol' },
            },
            {
              s: 'T-03',
              h: 'Server-clock authority',
              b: 'Every deadline, grace period and stage transition follows the server clock in Asia/Kolkata. Local watches carry no weight.',
              link: { to: '/privacy', label: 'Privacy notice' },
            },
          ].map((t) => (
            <TopoPanel key={t.s} sector={t.s} variant="ridge" className="h-full">
              <h3 className="font-serif font-bold text-lg text-[#E2E8EE] pb-2">{t.h}</h3>
              <p className="text-sm text-[#B6C2CE] font-sans leading-relaxed">{t.b}</p>
              <Link
                to={t.link.to}
                className="inline-block pt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#7FBBD1] hover:text-[#5BA3BC] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
              >
                {t.link.label} &rarr;
              </Link>
            </TopoPanel>
          ))}
        </div>
      </section>

      {/* SECTION 05: EXPEDITION ENTRY */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-16">
        <div className="topo-panel bg-[#111A27] border-[#C44D3F]/50 p-8 sm:p-12 relative overflow-hidden">
          <ContourField className="absolute inset-x-0 bottom-0 h-40 w-full opacity-40" marked={false} />
          <div className="max-w-2xl space-y-4 relative">
            <p className="coordinate">EXPEDITION ENTRY // ACTIVATION GATE</p>
            <h2 className="font-serif text-3xl sm:text-4xl font-black text-[#E2E8EE]">
              Join the survey party.
            </h2>
            <p className="text-sm text-[#B6C2CE] font-sans leading-relaxed">
              Team invitations arrive by email with a single-use activation token. Redeem it to
              establish your credentials, ratify the protocol, and claim your quadrant.
            </p>
            <div className="pt-4 flex flex-wrap gap-4 font-mono text-xs">
              <Link
                to="/activate"
                className="px-6 py-3 bg-[#C44D3F] text-white font-bold uppercase tracking-[0.14em] hover:bg-[#A83E32] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
              >
                Activate with invite token
              </Link>
              <Link
                to="/login"
                className="px-6 py-3 border border-[#34495F] text-[#E2E8EE] font-bold uppercase tracking-[0.14em] hover:bg-[#1A273A] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
              >
                Sign in to base camp
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
