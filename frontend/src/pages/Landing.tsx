import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { PublicEvent } from '../lib/types';
import { CountdownDisplay } from '../components/CountdownDisplay';
import { ExhibitCard } from '../components/ExhibitCard';
import { StampBadge } from '../components/StampBadge';
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
    <div className="space-y-16 pb-20">
      {/* SECTION 01: THE HERO DOSSIER */}
      <section className="relative pt-8 pb-12 border-b border-[#2B2E35]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#2B2E35]/60 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 bg-[#C04A36] animate-pulse" />
              <span className="text-[#CF8B38] font-bold">CASE REF: FB-2026-11</span>
              <span className="text-[#868A94]">SECTOR: SECURITY AUDIT & VULNERABILITY CONTAINMENT</span>
            </div>
            <StampBadge
              label={event?.status ? `STATUS: ${event.status}` : 'STATUS: DRAFT // PENDING'}
              tone={event?.status === 'live' ? 'danger' : 'warning'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-10 items-start">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-block px-2.5 py-1 text-xs font-mono uppercase tracking-widest text-[#C04A36] border border-[#C04A36]/40 bg-[#C04A36]/5">
                Official Incident Inquiry
              </div>

              <h1 className="text-4xl sm:text-6xl font-serif font-black tracking-tight text-[#ECEEF2] leading-[1.08]">
                Systems fractured. <br />
                <span className="text-[#CF8B38] italic font-normal">Contain the fallout.</span>
              </h1>

              <p className="text-base sm:text-lg text-[#C4C8D2] font-sans leading-relaxed max-w-xl">
                A catastrophic security regression has compromised the core production cluster. Your team has been summoned by the Software Development Club to audit, locate, and document critical defects before complete failure.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <Link
                  to="/activate"
                  className="px-6 py-3 bg-[#C04A36] text-[#ECEEF2] font-mono text-sm uppercase tracking-wider font-bold border border-[#C04A36] hover:bg-[#A83827] transition-colors"
                >
                  Activate Clearance
                </Link>
                <Link
                  to="/rules"
                  className="px-6 py-3 border border-[#2B2E35] text-[#ECEEF2] font-mono text-sm uppercase tracking-wider hover:bg-[#20232A] transition-colors"
                >
                  Examine Rules of Engagement
                </Link>
              </div>
            </div>

            {/* Right: Telemetry Docket Panel */}
            <div className="lg:col-span-5 space-y-4">
              <CountdownDisplay
                targetIsoDate={event?.starts_at}
                label={event?.status === 'live' ? 'ROUND IN PROGRESS' : 'TIME TO DEPLOYMENT'}
                size="lg"
              />

              <ExhibitCard
                exhibitNumber="EX-00"
                category="AUDIT PARAMETERS"
                title="Operational Docket Summary"
                variant="buff"
              >
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between py-1 border-b border-[#DDD7CA]">
                    <span className="text-[#6A665D]">INCIDENT CODENAME</span>
                    <span className="font-bold text-[#181A1F]">FALL BACK 2026</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#DDD7CA]">
                    <span className="text-[#6A665D]">DATE & LOCATION</span>
                    <span className="font-bold text-[#181A1F]">06 DEC 2026 • VIT BHOPAL</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#DDD7CA]">
                    <span className="text-[#6A665D]">WINDOW DURATION</span>
                    <span className="font-bold text-[#181A1F]">{event?.duration_minutes ?? 180} MINUTES</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#DDD7CA]">
                    <span className="text-[#6A665D]">MAX TEAMS / HEADCOUNT</span>
                    <span className="font-bold text-[#181A1F]">{event?.max_teams ?? 12} TEAMS / {event?.max_participants ?? 50} INVESTIGATORS</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-[#6A665D]">HOST AUTHORITY</span>
                    <span className="font-bold text-[#181A1F]">SOFTWARE DEVELOPMENT CLUB</span>
                  </div>
                </div>
              </ExhibitCard>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <ErrorBanner error={error} onRetry={fetchEvent} />
        </div>
      ) : null}

      {/* SECTION 02: THE COMPROMISED SYSTEM ANATOMY */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border-b border-[#2B2E35] pb-4 mb-8 flex items-baseline justify-between">
          <div>
            <span className="text-xs font-mono text-[#C04A36] uppercase tracking-widest">
              01 // FORENSIC SCOPE
            </span>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#ECEEF2] mt-1">
              Anatomy of the Compromised Surface
            </h2>
          </div>
          <span className="hidden sm:inline text-xs font-mono text-[#868A94]">
            TARGET REPOSITORY: EXPRESS + SQLITE APP
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <ExhibitCard
            exhibitNumber="EX-01"
            category="EVIDENCE SPECIMEN"
            title="Sample Flaw Vector: Broken Authorization (IDOR)"
          >
            <div className="space-y-4 font-mono text-xs">
              <p className="text-sm font-sans text-[#868A94]">
                Target endpoint executes unsafe queries without validating author ownership across tenant contexts:
              </p>
              <div className="p-3 bg-[#0E1012] border border-[#2B2E35] text-[#ECEEF2] overflow-x-auto text-[11px] leading-relaxed">
                <span className="text-[#868A94]">// routes/notes.js - vulnerable handler</span>
                <br />
                <span className="text-[#C04A36]">router.get('/notes/:id', async (req, res) =&gt; &#123;</span>
                <br />
                <span className="text-[#C04A36]">&nbsp;&nbsp;const note = await db.get('SELECT * FROM notes WHERE id = ?', [req.params.id]);</span>
                <br />
                <span className="text-[#C04A36]">&nbsp;&nbsp;if (!note) return res.status(404).json(&#123; error: 'Not found' &#125;);</span>
                <br />
                <span className="text-[#C04A36]">&nbsp;&nbsp;res.json(note); // Missing author_id verification!</span>
                <br />
                <span className="text-[#C04A36]">&#125;);</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#868A94]">
                <span>TAXONOMY: AUTHORIZATION</span>
                <span className="text-[#C04A36] font-bold">SEVERITY: HIGH</span>
              </div>
            </div>
          </ExhibitCard>

          <ExhibitCard
            exhibitNumber="EX-02"
            category="INVESTIGATION PROTOCOL"
            title="Investigation & Evidence Requirements"
          >
            <div className="space-y-4 text-sm text-[#C4C8D2] font-sans">
              <p>
                Every finding submitted to the docket must be substantiated with precise file locations (up to 25 lines span), root-cause forensic explanations, and reproducible proof-of-concept evidence.
              </p>
              <div className="space-y-2 border-t border-[#2B2E35] pt-3 font-mono text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-[#C04A36] font-bold">[1]</span>
                  <span>Pinpoint exact vulnerable lines in the assigned challenge code.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#C04A36] font-bold">[2]</span>
                  <span>Categorize against the authoritative 12-value vulnerability taxonomy.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#C04A36] font-bold">[3]</span>
                  <span>Receive tamper-proof HMAC submission receipts for every filing.</span>
                </div>
              </div>
            </div>
          </ExhibitCard>
        </div>
      </section>

      {/* SECTION 03: COMPETITION TIMELINE (P1 TO P4) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border-b border-[#2B2E35] pb-4 mb-8">
          <span className="text-xs font-mono text-[#C04A36] uppercase tracking-widest">
            02 // CHRONOLOGY
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#ECEEF2] mt-1">
            The Four Investigation Phases
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-[#2B2E35] bg-[#181A1F] p-5 space-y-3">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#C04A36] font-bold">PHASE 01</span>
              <span className="text-[#868A94]">30 MIN</span>
            </div>
            <h3 className="font-serif font-bold text-lg text-[#ECEEF2]">Reconnaissance & Setup</h3>
            <p className="text-xs text-[#868A94] leading-relaxed">
              Accept official competition rules, inspect assigned challenge repositories, run baseline tests, and inventory surface endpoints.
            </p>
          </div>

          <div className="border border-[#2B2E35] bg-[#181A1F] p-5 space-y-3">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#CF8B38] font-bold">PHASE 02</span>
              <span className="text-[#868A94]">35 MIN</span>
            </div>
            <h3 className="font-serif font-bold text-lg text-[#ECEEF2]">Forensic Audit</h3>
            <p className="text-xs text-[#868A94] leading-relaxed">
              Trace execution flows, isolate security anomalies, identify root causes, and draft vulnerability reports with evidence.
            </p>
          </div>

          <div className="border border-[#2B2E35] bg-[#181A1F] p-5 space-y-3">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#3E7259] font-bold">PHASE 03</span>
              <span className="text-[#868A94]">60 MIN</span>
            </div>
            <h3 className="font-serif font-bold text-lg text-[#ECEEF2]">Remediation & CTF Quests</h3>
            <p className="text-xs text-[#868A94] leading-relaxed">
              Implement architectural fixes, capture bonus CTF flags from hidden system crevices, and submit structured findings.
            </p>
          </div>

          <div className="border border-[#2B2E35] bg-[#181A1F] p-5 space-y-3">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#4B7B9A] font-bold">PHASE 04</span>
              <span className="text-[#868A94]">25 MIN</span>
            </div>
            <h3 className="font-serif font-bold text-lg text-[#ECEEF2]">Verification & Review</h3>
            <p className="text-xs text-[#868A94] leading-relaxed">
              Human reviewer panel grades rubrics, automated tests verify regression fixes, and final tamper-proof ledgers are certified.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 04: SCORING BALANCE SHEET (50/30/20) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border-b border-[#2B2E35] pb-4 mb-8">
          <span className="text-xs font-mono text-[#C04A36] uppercase tracking-widest">
            03 // EVALUATION FORMULA
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#ECEEF2] mt-1">
            The 50 / 30 / 20 Scoring Ledger
          </h2>
        </div>

        <div className="border border-[#2B2E35] bg-[#181A1F] overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#141519] border-b border-[#2B2E35] text-[#868A94]">
              <tr>
                <th className="p-4 uppercase">Component</th>
                <th className="p-4 uppercase">Weight</th>
                <th className="p-4 uppercase">Evaluation Mechanism</th>
                <th className="p-4 uppercase">Penalty Discipline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2B2E35]">
              <tr>
                <td className="p-4 font-bold text-[#ECEEF2]">Automated Functional Tests</td>
                <td className="p-4 text-[#CF8B38] font-bold">50%</td>
                <td className="p-4 text-[#C4C8D2] font-sans">
                  Rigorous unit and integration test suites executed against submitted patches.
                </td>
                <td className="p-4 text-[#868A94]">0 points for broken suites</td>
              </tr>
              <tr>
                <td className="p-4 font-bold text-[#ECEEF2]">Human Expert Code Review</td>
                <td className="p-4 text-[#CF8B38] font-bold">30%</td>
                <td className="p-4 text-[#C4C8D2] font-sans">
                  5-metric rubric: functionality, root-cause depth, code quality, test rigor, and evidence.
                </td>
                <td className="p-4 text-[#C04A36] font-bold">-5 pts per invalid finding</td>
              </tr>
              <tr>
                <td className="p-4 font-bold text-[#ECEEF2]">Evidence & Report Quality</td>
                <td className="p-4 text-[#CF8B38] font-bold">20%</td>
                <td className="p-4 text-[#C4C8D2] font-sans">
                  Clarity of vulnerability description, impact analysis, and reproduction accuracy.
                </td>
                <td className="p-4 text-[#868A94]">Capped rubric deduction</td>
              </tr>
              <tr className="bg-[#141519]/50">
                <td className="p-4 font-bold text-[#3E7259]">CTF Flag Side Quests</td>
                <td className="p-4 text-[#3E7259] font-bold">Bonus (Capped)</td>
                <td className="p-4 text-[#C4C8D2] font-sans">
                  Cryptographic verification of system flags discovered during deep code review.
                </td>
                <td className="p-4 text-[#868A94]">Max 150 bonus points</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 05: ENTRY DOCKET CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border border-[#C04A36] bg-[#181A1F] p-8 sm:p-12 relative overflow-hidden">
          <div className="max-w-2xl space-y-4">
            <span className="text-xs font-mono text-[#C04A36] uppercase tracking-widest">
              CALL FOR INVESTIGATORS
            </span>
            <h2 className="text-3xl sm:text-4xl font-serif font-black text-[#ECEEF2]">
              Ready to take the investigation bench?
            </h2>
            <p className="text-sm text-[#C4C8D2] font-sans leading-relaxed">
              If your team has received an activation invitation token, proceed to activate your account. Review the authoritative competition rules and prepare your environment.
            </p>
            <div className="pt-4 flex flex-wrap gap-4 font-mono text-xs">
              <Link
                to="/activate"
                className="px-6 py-3 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase tracking-wider hover:bg-[#A83827] transition-colors"
              >
                Activate Account Now
              </Link>
              <Link
                to="/login"
                className="px-6 py-3 border border-[#2B2E35] text-[#ECEEF2] font-bold uppercase tracking-wider hover:bg-[#20232A] transition-colors"
              >
                Sign In to Console
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
