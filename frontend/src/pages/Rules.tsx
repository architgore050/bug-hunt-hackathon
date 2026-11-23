import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PublicRules } from '../lib/types';
import { useAuth } from '../lib/auth';
import { formatIST } from '../lib/time';
import { StampBadge } from '../components/StampBadge';
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
      {/* Header */}
      <div className="border-b border-[#2B2E35] pb-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-[#C04A36]" />
          <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
            OFFICIAL DOCKET // ARTICLE 01
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-serif font-black text-[#ECEEF2]">
          Rules of Engagement & Competition Charter
        </h1>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-mono text-[#868A94]">
          <StampBadge
            label={rules?.version ? `VERSION: ${rules.version}` : 'UNFROZEN DRAFT'}
            tone="info"
          />
          {rules?.frozen_at && (
            <span>FROZEN AT: {formatIST(rules.frozen_at)}</span>
          )}
          {isAuthenticated && (
            <StampBadge
              label={rulesAccepted ? 'RULES ACCEPTED BY YOU' : 'RULES ACCEPTANCE REQUIRED'}
              tone={rulesAccepted ? 'success' : 'danger'}
            />
          )}
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={fetchRules} /> : null}

      {/* Rules Content */}
      <div className="border border-[#2B2E35] bg-[#181A1F] p-6 sm:p-8 space-y-6 text-sm text-[#C4C8D2] font-sans leading-relaxed">
        {loading ? (
          <div className="font-mono text-xs text-[#868A94] animate-pulse">
            Retrieving authoritative rule document from server ledger...
          </div>
        ) : rules?.body_markdown ? (
          <div className="prose prose-invert max-w-none space-y-4 whitespace-pre-wrap font-sans text-sm">
            {rules.body_markdown}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl font-serif font-bold text-[#ECEEF2]">
              1. Scope & System Authorization
            </h2>
            <p>
              Participants are explicitly authorized to audit, reverse-engineer, and test the designated challenge application repositories hosted during the Fall Back event. Testing or probing against platform control infrastructure, university networks, or peer participants' devices is strictly prohibited.
            </p>

            <h2 className="text-xl font-serif font-bold text-[#ECEEF2]">
              2. Reporting Quality & Deductions
            </h2>
            <p>
              To maintain forensic fidelity, each filed finding must clearly document file path, line range (max 25 lines), root-cause explanation, and impact. Spammed or invalid filings incur a strict -5 point penalty per rejected report.
            </p>

            <h2 className="text-xl font-serif font-bold text-[#ECEEF2]">
              3. Independent Team Integrity
            </h2>
            <p>
              All work must originate solely from registered team members. Sharing vulnerability locations, exploit payloads, or CTF flags across team boundaries constitutes immediate disqualification.
            </p>

            <h2 className="text-xl font-serif font-bold text-[#ECEEF2]">
              4. Server Clock Authority
            </h2>
            <p>
              All rounds are strictly server-authoritative. The server clock (Asia/Kolkata IST) governs deadlines, grace periods, and stage transitions. Submissions after deadline expiration will be rejected by the API.
            </p>
          </div>
        )}
      </div>

      {/* Acceptance Action */}
      {isAuthenticated && !rulesAccepted && (
        <div className="border border-[#CF8B38] bg-[#CF8B38]/10 p-6 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
          <div>
            <div className="text-[#ECEEF2] font-bold text-sm">Mandatory Rules Ratification</div>
            <p className="text-[#CF8B38] font-sans text-xs mt-1">
              You must accept these competition terms before you can access challenge repositories or file reports.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="px-6 py-2.5 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase tracking-wider hover:bg-[#A83827] disabled:opacity-50 transition-colors"
          >
            {accepting ? 'Recording Acceptance...' : 'Accept Official Rules'}
          </button>
        </div>
      )}
    </div>
  );
};
