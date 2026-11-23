import React from 'react';
import { TopoPanel } from '../components/TopoPanel';

export const Privacy: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="border-b border-[#22303F] pb-6 space-y-3">
        <p className="coordinate">OFFICIAL NOTICE // DATA CHART</p>
        <h1 className="text-3xl sm:text-4xl font-serif font-black text-[#E2E8EE]">
          Privacy notice
        </h1>
        <p className="text-sm font-sans text-[#7E8FA1]">
          How surveyor credentials, telemetry and filed evidence are handled on the platform.
        </p>
      </div>

      <TopoPanel sector="PRV-01" coords="REF: DATA-COLLECTION" title="Zero-tracking terrain">
        <div className="space-y-4 text-sm text-[#B6C2CE] font-sans leading-relaxed">
          <p>
            The Failure Atlas platform runs on a strict zero-tracking principle: no third-party
            scripts, advertising pixels, analytics trackers, or commercial telemetry engines are
            loaded at any point of the survey.
          </p>
          <ul className="space-y-2 font-mono text-xs text-[#7E8FA1] list-none p-0 m-0">
            <li className="border-l-2 border-[#22303F] pl-3">
              Authentication refresh cookies are first-party HttpOnly cookies scoped to
              /v1/auth/refresh.
            </li>
            <li className="border-l-2 border-[#22303F] pl-3">
              Bearer tokens live in memory only, expire rapidly, and never touch localStorage.
            </li>
            <li className="border-l-2 border-[#22303F] pl-3">
              Every transaction carries an X-Request-Id trace so faults can be resolved
              deterministically at the desk.
            </li>
          </ul>
        </div>
      </TopoPanel>

      <TopoPanel sector="PRV-02" coords="REF: RETENTION" title="Survey record retention">
        <div className="space-y-4 text-sm text-[#B6C2CE] font-sans leading-relaxed">
          <p>
            Submission timestamps, cryptographic receipts, and reviewer decisions persist in the
            immutable SHA-256 audit ledger for the duration of the event and the appeals window.
            After certificates are issued, participant email linkages are de-identified.
          </p>
        </div>
      </TopoPanel>
    </div>
  );
};
