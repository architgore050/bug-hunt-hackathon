import React from 'react';
import { TopoPanel } from '../components/TopoPanel';

export const Terms: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="border-b border-[#22303F] pb-6 space-y-3">
        <p className="coordinate">OFFICIAL TERMS // ENGAGEMENT ACCORD</p>
        <h1 className="text-3xl sm:text-4xl font-serif font-black text-[#E2E8EE]">
          Terms of engagement & safe harbor
        </h1>
        <p className="text-sm font-sans text-[#7E8FA1]">
          Authorization boundaries, liability, and the obligations of every survey party.
        </p>
      </div>

      <TopoPanel sector="TRM-01" coords="REF: SAFE-HARBOR" title="Sanctioned research & safe harbor">
        <div className="space-y-4 text-sm text-[#B6C2CE] font-sans leading-relaxed">
          <p>
            Activities conducted within the mapped scope of Fall Back against the designated
            challenge applications constitute authorized security testing under university
            guidelines. Participants acting in good faith, without intent to disrupt
            infrastructure or harm data, are protected by this safe harbor agreement.
          </p>
        </div>
      </TopoPanel>

      <TopoPanel sector="TRM-02" coords="REF: DISPUTES" title="Dispute resolution & ledger adjustments">
        <div className="space-y-4 text-sm text-[#B6C2CE] font-sans leading-relaxed">
          <p>
            Where an evaluation is ambiguous, a formal dispute statement may be filed within the
            designated post-round window. Every resolution is permanently inscribed in the
            cryptographic ledger by an authorized organizer.
          </p>
        </div>
      </TopoPanel>
    </div>
  );
};
