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
  let stateTone = 'text-[#63A98D]';

  if (isPaused) {
    toneClass = 'text-[#E2A56B]';
    stateLabel = 'TIMER HALTED';
    stateTone = 'text-[#E2A56B]';
  } else if (isExpired) {
    toneClass = 'text-[#E0836F]';
    stateLabel = 'WINDOW CLOSED';
    stateTone = 'text-[#E0836F]';
  } else if (secondsRemaining !== null && secondsRemaining <= 120) {
    toneClass = 'text-[#E0836F]';
    stateLabel = 'FINAL APPROACH';
    stateTone = 'text-[#E0836F]';
  } else if (secondsRemaining !== null && secondsRemaining <= 600) {
    toneClass = 'text-[#E2A56B]';
    stateLabel = 'CLOSING STRATA';
    stateTone = 'text-[#E2A56B]';
  }

  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl md:text-5xl',
  };

  return (
    <div className={`topo-panel font-mono p-4 ${className}`}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[#7E8FA1] pb-1.5 border-b border-[#22303F] mb-3">
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
          <span className="text-[#E2A56B]">PAUSED</span>
        ) : targetIsoDate ? (
          formatted
        ) : (
          'AWAITING START'
        )}
      </div>
      <div className="mt-2 flex justify-between coordinate">
        <span>REF: SERVER CLOCK</span>
        <span>TZ: ASIA/KOLKATA</span>
      </div>
    </div>
  );
};
