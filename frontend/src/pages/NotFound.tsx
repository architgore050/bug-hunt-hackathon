import React from 'react';
import { Link } from 'react-router-dom';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6 font-mono">
      <div className="max-w-md w-full border border-[#2D333D] bg-[#14161A] p-7 space-y-6 flex flex-col justify-between min-h-[320px]">
        <div className="space-y-3">
          <div className="inline-block px-2 py-0.5 text-[10px] font-bold bg-[#BD3A3A]/20 text-[#D96A5F] border border-[#BD3A3A] uppercase tracking-wider">
            EX-404 // INVALID CHANNEL DETECTED
          </div>
          <h1 className="text-2xl font-black uppercase text-[#EAECE8] tracking-tight">
            Unmapped Instrument Channel
          </h1>
          <p className="text-xs text-[#7F8896] leading-relaxed font-sans">
            The requested station bus address or module vector does not correspond to any calibrated instrument rack, operational relay, or verified ledger register in the Fall Back platform.
          </p>
        </div>

        <div className="pt-4 border-t border-[#2D333D] mt-auto">
          <Link
            to="/"
            className="inline-block px-4 py-2 bg-[#E5A83B] text-[#0E1013] text-xs font-bold uppercase tracking-wider hover:bg-[#D4982B] transition-colors"
          >
            &larr; Return to Master Console
          </Link>
        </div>
      </div>
    </div>
  );
};
