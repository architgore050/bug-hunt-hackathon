import React from 'react';
import { useCountdown } from '../lib/time';

interface SeismicClockProps {
  targetIsoDate: string | null | undefined;
  isPaused?: boolean;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Server-synchronised survey clock. Ticks against corrected server time and
 * renders stress tones as the window closes. Announces state changes politely.
 */
export const SeismicClock: React.FC<SeismicClockProps> = ({
  targetIsoDate,
  isPaused = false,
  label = 'SURVEY WINDOW',
  size = 'md',
  className = '',
}) => {
  const { secondsRemaining, formatted, isExpired } = useCountdown(targetIsoDate, isPaused);

  let toneClass = 'text-[#E2E8EE]';
  let stateLabel = 'SYNCHRONIZED';
  let stateTone = 'text-[#3F7A68]';

  if (isPaused) {
    toneClass = 'text-[#CF824B]';
    stateLabel = 'TIMER HALTED';
    stateTone = 'text-[#CF824B]';
  } else if (isExpired) {
    toneClass = 'text-[#C44D3F]';
    stateLabel = 'WINDOW CLOSED';
    stateTone = 'text-[#C44D3F]';
  } else if (secondsRemaining !== null && secondsRemaining <= 120) {
    toneClass = 'text-[#C44D3F]';
    stateLabel = 'FINAL APPROACH';
    stateTone = 'text-[#C44D3F]';
  } else if (secondsRemaining !== null && secondsRemaining <= 600) {
    toneClass = 'text-[#CF824B]';
    stateLabel = 'CLOSING STRATA';
    stateTone = 'text-[#CF824B]';
  }

  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl md:text-5xl',
  };

  return (
    <div className={`topo-panel font-mono p-4 ${className}`}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[#718294] pb-1.5 border-b border-[#22303F] mb-3">
        <span>{label}</span>
        <span className={`${stateTone} flex items-center gap-1.5 font-bold`}>
          {!isPaused && !isExpired && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#3F7A68] beacon-pulse" aria-hidden="true" />
          )}
          {stateLabel}
        </span>
      </div>
      <div
        className={`font-mono font-bold tracking-tight tabular-nums ${toneClass} ${sizeClasses[size]}`}
        aria-live="polite"
      >
        {isPaused ? (
          <span className="text-[#CF824B]">PAUSED</span>
        ) : targetIsoDate ? (
          formatted
        ) : (
          'AWAITING SURVEY WINDOW'
        )}
      </div>
      <div className="mt-2 flex justify-between coordinate">
        <span>REF: SERVER CLOCK</span>
        <span>TZ: ASIA/KOLKATA</span>
      </div>
    </div>
  );
};
