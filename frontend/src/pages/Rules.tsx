import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PublicRules } from '../lib/types';
import { useAuth } from '../lib/auth';
import { formatIST } from '../lib/time';
import { AnnunciatorBar } from '../components/AnnunciatorBar';
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="border-b border-[#2D333D] pb-4 space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
          OPERATING SPECIFICATION // SECTION 01
        </span>
        <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight">
          Competition Charter & Testing Protocols
        </h1>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-mono text-[#7F8896]">
          <AnnunciatorBar
            label={rules?.version ? `SPEC VER: ${rules.version}` : 'UNFROZEN SPEC'}
            tone="cyan"
          />
          {rules?.frozen_at && <span>FROZEN AT: {formatIST(rules.frozen_at)}</span>}
          {isAuthenticated && (
            <AnnunciatorBar
              label={rulesAccepted ? 'CHARTER RATIFIED' : 'RATIFICATION REQUIRED'}
              tone={rulesAccepted ? 'sage' : 'crimson'}
            />
          )}
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchRules} /> : null}

      <div className="instr-bezel p-6 space-y-6 text-xs text-[#B4B9C4] font-mono leading-relaxed">
        {loading ? (
          <div className="text-[#7F8896] text-center py-6 animate-pulse">
            Reading operating charter from platform memory bus...
          </div>
        ) : rules?.body_markdown ? (
          <div className="whitespace-pre-wrap font-sans text-sm text-[#EAECE8] leading-relaxed">
            {rules.body_markdown}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-[#EAECE8] uppercase">1. Sanctioned Diagnostic Scope</h2>
            <p className="font-sans text-xs">
              Operators are authorized to analyze, test, and patch designated challenge application repositories. Attacks against platform telemetry or university networks result in immediate disconnection.
            </p>
            <h2 className="text-base font-bold text-[#EAECE8] uppercase">2. Reporting Discipline & Penalties</h2>
            <p className="font-sans text-xs">
              Findings must target specific line spans (max 25 lines) with complete root-cause documentation. Spammed or invalid filings incur a strict -5 point deduction.
            </p>
            <h2 className="text-base font-bold text-[#EAECE8] uppercase">3. Independent Operator Integrity</h2>
            <p className="font-sans text-xs">
              All findings must originate within the registered team. Collusion or flag sharing across teams triggers instant disqualification.
            </p>
          </div>
        )}
      </div>

      {isAuthenticated && !rulesAccepted && (
        <div className="border border-[#E5A83B] bg-[#E5A83B]/10 p-5 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
          <div>
            <div className="text-[#EAECE8] font-bold">Mandatory Protocol Ratification</div>
            <p className="text-[#E5A83B] text-[11px] font-sans mt-0.5">
              You must confirm adherence to these operating terms before accessing target repositories.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="px-5 py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B] disabled:opacity-50 transition-colors"
          >
            {accepting ? 'Ratifying...' : 'Ratify Protocols'}
          </button>
        </div>
      )}
    </div>
  );
};
