import React from 'react';
import { ExhibitCard } from '../components/ExhibitCard';

export const Privacy: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="border-b border-[#2B2E35] pb-6 space-y-3">
        <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
          OFFICIAL NOTICE // PRIVACY CHARTER
        </span>
        <h1 className="text-3xl sm:text-4xl font-serif font-black text-[#ECEEF2]">
          Platform Privacy Notice
        </h1>
        <p className="text-sm font-sans text-[#868A94]">
          How participant telemetry, credentials, and forensic submissions are handled by the platform.
        </p>
      </div>

      <ExhibitCard
        exhibitNumber="PRV-01"
        category="DATA COLLECTION"
        title="Zero-Tracking Architecture"
      >
        <div className="space-y-4 text-sm text-[#C4C8D2] font-sans leading-relaxed">
          <p>
            The Bug Hunt CTF platform operates on a strict zero-tracking principle. We do not load third-party scripts, advertising pixels, analytics trackers, or commercial telemetry engines.
          </p>
          <ul className="list-disc pl-5 space-y-2 font-mono text-xs text-[#868A94]">
            <li>Authentication cookies are First-Party HttpOnly cookies scoped to /v1/auth/refresh.</li>
            <li>In-memory bearer tokens expire rapidly and are never stored in localStorage.</li>
            <li>Every API transaction is tagged with a trace identifier (X-Request-Id) to allow deterministic error resolution.</li>
          </ul>
        </div>
      </ExhibitCard>

      <ExhibitCard
        exhibitNumber="PRV-02"
        category="RETENTION SCHEDULE"
        title="Forensic Record & Audit Log Retention"
      >
        <div className="space-y-4 text-sm text-[#C4C8D2] font-sans leading-relaxed">
          <p>
            Submission timestamps, cryptographic hash chains, and review decisions are maintained in an immutable SHA-256 audit ledger throughout the event and appeals period. Post-competition, participant email linkages are de-identified after certificate issuance.
          </p>
        </div>
      </ExhibitCard>
    </div>
  );
};
