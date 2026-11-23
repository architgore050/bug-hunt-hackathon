import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PublicRules } from '../lib/types';
import { useAuth } from '../lib/auth';
import { formatIST } from '../lib/time';
import { SectorBadge } from '../components/SectorBadge';
import { ErrorBanner } from '../components/ErrorBanner';

export const Rules: React.FC = () => {
  const [rules, setRules] = useState<PublicRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const { isAuthenticated, rulesAccepted, acceptRules } = useAuth();
  const [accepting, setAccepting] = useState(false);

  const fetchRules = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getPublicRules();
      setRules(data.rules);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleAccept = async () => {
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="border-b border-[#22303F] pb-6 space-y-3">
        <p className="coordinate">OFFICIAL CHART // SURVEY PROTOCOL</p>
        <h1 className="text-3xl sm:text-4xl font-serif font-black text-[#E2E8EE]">
          Rules of the survey
        </h1>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-mono text-[#718294] uppercase tracking-[0.12em]">
          <SectorBadge
            label={rules?.version ? `VERSION: ${rules.version}` : 'UNFROZEN DRAFT'}
            tone="elevation"
          />
          {rules?.frozen_at && <span>FROZEN: {formatIST(rules.frozen_at)}</span>}
          {isAuthenticated && (
            <SectorBadge
              label={rulesAccepted ? 'RATIFIED BY YOU' : 'RATIFICATION REQUIRED'}
              tone={rulesAccepted ? 'stabilized' : 'shear'}
            />
          )}
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchRules} /> : null}

      <div className="topo-panel bg-[#111A27] p-6 sm:p-8 space-y-6 text-sm text-[#B6C2CE] font-sans leading-relaxed">
        {loading ? (
          <div className="font-mono text-xs text-[#718294]" role="status">
            Retrieving the authoritative protocol document from the server ledger...
          </div>
        ) : rules?.body_markdown ? (
          <div className="whitespace-pre-wrap font-sans text-sm">{rules.body_markdown}</div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-xl font-serif font-bold text-[#E2E8EE]">
                1. Authorized ground
              </h2>
              <p>
                Participants are authorized to audit, reverse-engineer, and test the designated
                challenge repositories hosted during Fall Back. Probing platform control
                infrastructure, university networks, or fellow participants' devices is outside the
                map and strictly prohibited.
              </p>
            </section>
            <section className="space-y-2">
              <h2 className="text-xl font-serif font-bold text-[#E2E8EE]">
                2. Finding quality & penalties
              </h2>
              <p>
                Every filed fracture must carry an exact file path, a line span of at most 25
                lines, a root-cause explanation, and reproducible evidence. Spammed or invalid
                filings destabilize the ledger: each rejected report costs 5 points.
              </p>
            </section>
            <section className="space-y-2">
              <h2 className="text-xl font-serif font-bold text-[#E2E8EE]">
                3. Independent surveys
              </h2>
              <p>
                All work originates solely from registered team members. Sharing fault
                coordinates, exploit proofs, or CTF flags across team boundaries constitutes
                immediate disqualification.
              </p>
            </section>
            <section className="space-y-2">
              <h2 className="text-xl font-serif font-bold text-[#E2E8EE]">
                4. Server-clock authority
              </h2>
              <p>
                All rounds are server-authoritative. The server clock (Asia/Kolkata, IST) governs
                deadlines, grace periods, and stage transitions. Submissions after window closure
                are rejected by the API regardless of local time.
              </p>
            </section>
          </div>
        )}
      </div>

      {isAuthenticated && !rulesAccepted && (
        <div className="border border-[#CF824B] bg-[#CF824B]/10 p-6 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
          <div>
            <div className="text-[#E2E8EE] font-bold text-sm">Mandatory ratification</div>
            <p className="text-[#CF824B] font-sans text-xs mt-1">
              The survey protocol must be ratified before challenge files open or findings can be filed.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="px-6 py-2.5 bg-[#CF824B] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#B87040] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
          >
            {accepting ? 'Recording ratification...' : 'Ratify the protocol'}
          </button>
        </div>
      )}
    </div>
  );
};
