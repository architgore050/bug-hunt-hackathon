import React from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-[#2B2E35] bg-[#0E1012] text-[#868A94] text-xs font-mono py-12 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-[#2B2E35]/60">
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#C04A36]" />
              <span className="font-serif font-bold text-sm text-[#ECEEF2] tracking-wider uppercase">
                Bug Hunt CTF // Fall Back
              </span>
            </div>
            <p className="text-xs text-[#868A94] max-w-md leading-relaxed font-sans">
              Organized by the Software Development Club at VIT Bhopal University. Dedicated to forensic code auditing, vulnerability containment, and systems reliability.
            </p>
            <div className="text-[11px] text-[#6A6E78]">
              SCHEDULED EVENT DATE: 06 DECEMBER 2026 • ASIA/KOLKATA [IST]
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-[#ECEEF2] font-bold">
              Legal & Conduct
            </div>
            <ul className="space-y-1.5 text-xs">
              <li>
                <Link to="/rules" className="hover:text-[#ECEEF2] transition-colors">
                  Competition Rules
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-[#ECEEF2] transition-colors">
                  Privacy Notice
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-[#ECEEF2] transition-colors">
                  Terms of Engagement
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-[#ECEEF2] font-bold">
              Docket Verification
            </div>
            <div className="text-[11px] text-[#6A6E78] space-y-1">
              <div>HASH-CHAIN: SHA-256 LEDGER</div>
              <div>AUTH MODEL: DUAL-KEY SESSION</div>
              <div>IDEMPOTENCY: STRICT REPLAY ENFORCED</div>
            </div>
          </div>
        </div>

        <div className="pt-6 flex flex-wrap items-center justify-between gap-4 text-[11px] text-[#6A6E78]">
          <span>© 2026 Software Development Club, VIT Bhopal University. All rights reserved.</span>
          <span className="tracking-widest uppercase">CLASSIFIED FOR COMPETITION USE ONLY</span>
        </div>
      </div>
    </footer>
  );
};
