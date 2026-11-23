import React from 'react';

/**
 * ContourField: a lightweight decorative SVG of bathymetric contour lines with
 * a marked fault coordinate. Pure vector, no canvas, no animation loops, so it
 * paints once and costs nothing at runtime. Used behind hero compositions.
 */
export const ContourField: React.FC<{ className?: string; marked?: boolean }> = ({
  className = '',
  marked = true,
}) => {
  return (
    <svg
      viewBox="0 0 800 320"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g fill="none" strokeWidth="1.1">
        <path d="M0 286 Q120 250 260 272 T520 246 T800 262" stroke="#22303F" />
        <path d="M0 252 Q140 214 300 240 T560 210 T800 232" stroke="#22303F" />
        <path d="M0 216 Q110 180 270 206 T540 176 T800 200" stroke="#2A3B50" />
        <path d="M0 182 Q130 148 290 172 T550 144 T800 168" stroke="#2A3B50" />
        <path d="M0 148 Q120 116 280 140 T540 112 T800 136" stroke="#34495F" />
        <path d="M0 114 Q140 84 300 108 T560 82 T800 104" stroke="#22303F" />
        <path d="M0 80 Q110 54 270 76 T530 52 T800 72" stroke="#22303F" />
      </g>
      {marked && (
        <g>
          <line x1="296" y1="40" x2="366" y2="292" stroke="#C44D3F" strokeWidth="1.8" />
          <circle cx="330" cy="160" r="14" fill="none" stroke="#CF824B" strokeWidth="1.4" />
          <line x1="330" y1="140" x2="330" y2="180" stroke="#CF824B" strokeWidth="0.8" />
          <line x1="310" y1="160" x2="350" y2="160" stroke="#CF824B" strokeWidth="0.8" />
          <text
            x="344"
            y="196"
            fill="#CF824B"
            fontFamily="IBM Plex Mono, monospace"
            fontSize="10"
            letterSpacing="2"
          >
            FAULT C-01
          </text>
        </g>
      )}
    </svg>
  );
};
