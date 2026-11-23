import React from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-[#22303F] bg-[#0C1220] text-[#718294] text-xs font-mono py-12 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-[#22303F]/70">
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#4A8FA8]" aria-hidden="true" />
              <span className="font-serif font-bold text-sm text-[#E2E8EE] tracking-wider uppercase">
                Bug Hunt CTF // Failure Atlas
              </span>
            </div>
            <p className="text-xs text-[#718294] max-w-md leading-relaxed font-sans">
              Organized by the Software Development Club at VIT Bhopal University. A structural
              survey of failing software: locate the fracture, file its coordinates, anchor the repair.
            </p>
            <div className="coordinate">
              SURVEY WINDOW: 06 DEC 2026 • ASIA/KOLKATA [IST]
            </div>
          </div>

          <nav aria-label="Legal documents" className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#E2E8EE] font-bold">
              Protocol & Legal
            </div>
            <ul className="space-y-1.5 text-xs">
              <li>
                <Link to="/rules" className="hover:text-[#E2E8EE] transition-colors">
                  Survey Protocol (Rules)
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-[#E2E8EE] transition-colors">
                  Privacy Notice
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-[#E2E8EE] transition-colors">
                  Terms of Engagement
                </Link>
              </li>
            </ul>
          </nav>

          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#E2E8EE] font-bold">
              Survey Instruments
            </div>
            <div className="text-[11px] text-[#5A6B7C] space-y-1">
              <div>TIME AUTHORITY: SERVER CLOCK</div>
              <div>RECEIPTS: HMAC SEALED</div>
              <div>AUDIT CHAIN: SHA-256</div>
              <div>SESSIONS: DUAL-KEY ROTATION</div>
            </div>
          </div>
        </div>

        <div className="pt-6 flex flex-wrap items-center justify-between gap-4 text-[11px] text-[#5A6B7C]">
          <span>© 2026 Software Development Club, VIT Bhopal University. All rights reserved.</span>
          <span className="coordinate">SURVEY CHART 03 // FAILURE ATLAS</span>
        </div>
      </div>
    </footer>
  );
};
