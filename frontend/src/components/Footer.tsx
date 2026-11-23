import React from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-[#2D333D] bg-[#0E1013] text-[#7F8896] text-xs font-mono py-10 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-[#2D333D]/60">
          <div className="md:col-span-2 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-[#E5A83B]" />
              <span className="font-sans font-black text-sm text-[#EAECE8] tracking-widest uppercase">
                Bug Hunt CTF // Recovery Instrument
              </span>
            </div>
            <p className="text-xs text-[#7F8896] max-w-md font-sans leading-relaxed">
              Precision software diagnostic platform designed for Fall Back 2026. Certified by the Software Development Club, VIT Bhopal University.
            </p>
            <div className="text-[10px] text-[#555C68] tracking-wider uppercase">
              SPEC CALIBRATION: IEC-61508 HARNESS • CLOCK: ASIA/KOLKATA [IST]
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-[#EAECE8] font-bold">
              Protocols & Charter
            </div>
            <ul className="space-y-1.5 text-xs">
              <li>
                <Link to="/rules" className="hover:text-[#EAECE8] transition-colors">
                  01 // Operating Charter
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-[#EAECE8] transition-colors">
                  02 // Data Isolation Notice
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-[#EAECE8] transition-colors">
                  03 // Safe Harbor Agreement
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-[#EAECE8] font-bold">
              Instrument Telemetry
            </div>
            <div className="text-[10px] text-[#555C68] space-y-1">
              <div>CLOCK TOLERANCE: ±5ms NTP</div>
              <div>IDEMPOTENCY: STRICT HASH REPLAY</div>
              <div>LEDGER: CRYPTOGRAPHIC OUTBOX</div>
            </div>
          </div>
        </div>

        <div className="pt-6 flex flex-wrap items-center justify-between gap-4 text-[10px] text-[#555C68]">
          <span>© 2026 Software Development Club, VIT Bhopal University.</span>
          <span className="tracking-widest uppercase">DIAGNOSTIC BENCH RI-2026</span>
        </div>
      </div>
    </footer>
  );
};
