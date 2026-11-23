import React from 'react';
import { Link } from 'react-router-dom';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6 font-mono">
      <div className="max-w-md w-full border border-[#2B2E35] bg-[#181A1F] p-8 space-y-6 flex flex-col justify-between min-h-[340px]">
        <div className="space-y-4">
          <div className="inline-block px-2 py-0.5 text-xs font-bold bg-[#C04A36]/20 text-[#E2715A] border border-[#C04A36]">
            EX-404: FILE NOT LOCATED
          </div>
          <h1 className="text-3xl font-serif font-black text-[#ECEEF2]">
            Unmapped Sector
          </h1>
          <p className="text-sm font-sans text-[#868A94] leading-relaxed">
            The target route does not correspond to any published case exhibit, operational desk, or audit ledger entry in the Fall Back platform.
          </p>
        </div>

        <div className="pt-6 border-t border-[#2B2E35] mt-auto">
          <Link
            to="/"
            className="inline-block px-4 py-2 bg-[#C04A36] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#A83827] transition-colors"
          >
            &larr; Return to Public Docket
          </Link>
        </div>
      </div>
    </div>
  );
};
