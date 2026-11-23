import React from 'react';
import { InstrumentRack } from '../components/InstrumentRack';

export const Terms: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="border-b border-[#2D333D] pb-4 space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
          OPERATING ACCORD // TERMS OF USE
        </span>
        <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight">
          Safe Harbor & Engagement Boundaries
        </h1>
        <p className="text-xs font-mono text-[#7F8896]">
          Authorized testing envelope, university safe harbor, and liability parameters.
        </p>
      </div>

      <InstrumentRack
        channel="TRM-01"
        title="Sanctioned Research Safe Harbor"
        telemetryTag="LEGAL COVENANT"
      >
        <div className="space-y-4 text-xs font-mono text-[#B4B9C4] leading-relaxed">
          <p className="font-sans text-sm text-[#EAECE8]">
            Testing activities conducted within designated challenge parameters during Fall Back constitute authorized diagnostic research. Good faith security exploration is fully indemnified under university guidelines.
          </p>
        </div>
      </InstrumentRack>
    </div>
  );
};
