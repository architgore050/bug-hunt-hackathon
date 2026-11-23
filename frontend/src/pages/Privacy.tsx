import React from 'react';
import { InstrumentRack } from '../components/InstrumentRack';

export const Privacy: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="border-b border-[#2D333D] pb-4 space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
          SECURITY PROTOCOL // PRIVACY SPECIFICATION
        </span>
        <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight">
          Telemetry & Data Isolation Notice
        </h1>
        <p className="text-xs font-mono text-[#7F8896]">
          Hardware telemetry, session tokens, and forensic audit boundaries.
        </p>
      </div>

      <InstrumentRack
        channel="PRV-01"
        title="Zero-Telemetry Architecture"
        telemetryTag="DATA SECURITY"
      >
        <div className="space-y-4 text-xs font-mono text-[#B4B9C4] leading-relaxed">
          <p className="font-sans text-sm text-[#EAECE8]">
            The Recovery Instrument platform enforces total client isolation. Zero commercial analytics scripts, ad trackers, or third-party pixels are loaded.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[#7F8896]">
            <li>Authentication is mediated via HttpOnly, SameSite=Strict cookies restricted to the refresh endpoint.</li>
            <li>In-memory bearer tokens expire on short timers and are never written to unencrypted storage.</li>
            <li>Audit records are cryptographically chained via SHA-256 for mathematical accountability.</li>
          </ul>
        </div>
      </InstrumentRack>
    </div>
  );
};
