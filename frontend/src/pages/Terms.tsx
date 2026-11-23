import React from 'react';
import { ExhibitCard } from '../components/ExhibitCard';

export const Terms: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="border-b border-[#2B2E35] pb-6 space-y-3">
        <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
          OFFICIAL TERMS // ENGAGEMENT ACCORD
        </span>
        <h1 className="text-3xl sm:text-4xl font-serif font-black text-[#ECEEF2]">
          Terms of Engagement & Safe Harbor
        </h1>
        <p className="text-sm font-sans text-[#868A94]">
          Legal authorization, liability boundaries, and ethical containment obligations.
        </p>
      </div>

      <ExhibitCard
        exhibitNumber="TRM-01"
        category="SAFE HARBOR"
        title="Sanctioned Security Research & Safe Harbor"
      >
        <div className="space-y-4 text-sm text-[#C4C8D2] font-sans leading-relaxed">
          <p>
            Activities conducted within the scope of Fall Back against designated challenge applications are authorized security testing under university guidelines. Participants acting in good faith without intent to disrupt infrastructure or harm data are protected under this safe harbor agreement.
          </p>
        </div>
      </ExhibitCard>

      <ExhibitCard
        exhibitNumber="TRM-02"
        category="DISPUTES & APPEALS"
        title="Dispute Resolution & Ledger Adjustments"
      >
        <div className="space-y-4 text-sm text-[#C4C8D2] font-sans leading-relaxed">
          <p>
            In the event of an evaluation ambiguity, participants may file a formal dispute statement within the designated post-round window. All dispute resolutions are permanently recorded in the cryptographic ledger by authorized organizers.
          </p>
        </div>
      </ExhibitCard>
    </div>
  );
};
