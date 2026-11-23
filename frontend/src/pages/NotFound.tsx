import React from 'react';
import { Link } from 'react-router-dom';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6 atlas-grid-bg">
      <div className="topo-panel bg-[#111A27] max-w-md w-full p-8 space-y-6 flex flex-col justify-between min-h-[340px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-block px-2 py-0.5 text-[11px] font-mono tracking-[0.14em] uppercase border border-[#C44D3F] bg-[#C44D3F]/10 text-[#E0836F]">
              FAULT: UNMAPPED TERRAIN
            </span>
            <span className="coordinate">ERR 404</span>
          </div>
          <h1 className="text-4xl font-serif font-black text-[#E2E8EE]">
            Off the chart.
          </h1>
          <p className="text-sm font-sans text-[#7E8FA1] leading-relaxed">
            This route corresponds to no published sector, survey desk, or ledger entry on the
            Failure Atlas. The terrain here is unmapped; return to the main chart.
          </p>
          <div className="font-mono text-[10px] text-[#7E8FA1] uppercase tracking-[0.14em]">
            COORD: UNKNOWN // QUADRANT: NULL
          </div>
        </div>

        <div className="pt-6 border-t border-[#22303F] mt-auto flex gap-3">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="px-4 py-2 border border-[#34495F] text-[#E2E8EE] text-xs font-mono font-bold uppercase tracking-[0.14em] hover:bg-[#1A273A] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
          >
            &larr; Previous page
          </button>
          <Link
            to="/"
            className="px-4 py-2 bg-[#4A8FA8] text-[#090E16] text-xs font-mono font-bold uppercase tracking-[0.14em] hover:bg-[#5BA3BC] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
          >
            Main chart
          </Link>
        </div>
      </div>
    </div>
  );
};
