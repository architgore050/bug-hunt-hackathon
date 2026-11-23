import React from 'react';
import { useCountdown } from '../lib/time';

interface CountdownDisplayProps {
  targetIsoDate: string | null | undefined;
  isPaused?: boolean;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CountdownDisplay: React.FC<CountdownDisplayProps> = ({
  targetIsoDate,
  isPaused = false,
  label = 'TIME REMAINING',
  size = 'md',
  className = '',
}) => {
  const { secondsRemaining, formatted, isExpired } = useCountdown(targetIsoDate, isPaused);

  let toneColor = 'text-[#ECEEF2]';
  if (isPaused) {
    toneColor = 'text-[#CF8B38]';
  } else if (isExpired) {
    toneColor = 'text-[#E2715A]';
  } else if (secondsRemaining !== null) {
    if (secondsRemaining <= 120) {
      toneColor = 'text-[#E2715A]';
    } else if (secondsRemaining <= 600) {
      toneColor = 'text-[#CF8B38]';
    }
  }

  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl md:text-5xl',
  };

  return (
    <div className={`font-mono border border-[#2B2E35] bg-[#141519] p-4 ${className}`}>
      <div className="flex items-center justify-between text-xs text-[#868A94] uppercase tracking-widest pb-1 border-b border-[#2B2E35]/60 mb-2">
        <span>{label}</span>
        {isPaused ? (
          <span className="text-[#CF8B38] font-bold">[TIMER PAUSED]</span>
        ) : isExpired ? (
          <span className="text-[#E2715A] font-bold">[WINDOW CLOSED]</span>
        ) : (
          <span className="text-[#5EA57E] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3E7259] animate-pulse" />
            SYNCHRONIZED
          </span>
        )}
      </div>
      <div
        className={`font-mono font-bold tracking-tight tabular-nums ${toneColor} ${sizeClasses[size]}`}
        aria-live="polite"
      >
        {isPaused ? (
          <span className="text-[#CF8B38]">PAUSED</span>
        ) : targetIsoDate ? (
          formatted
        ) : (
          'PENDING'
        )}
      </div>
    </div>
  );
};
