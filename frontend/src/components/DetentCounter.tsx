import React from 'react';
import { useCountdown } from '../lib/time';

interface DetentCounterProps {
  targetIsoDate: string | null | undefined;
  isPaused?: boolean;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const DetentCounter: React.FC<DetentCounterProps> = ({
  targetIsoDate,
  isPaused = false,
  label = 'SYSTEM TIME REGISTER',
  size = 'md',
  className = '',
}) => {
  const { secondsRemaining, formatted, isExpired } = useCountdown(targetIsoDate, isPaused);

  let toneColor = 'text-[#E5A83B]'; // phosphor amber
  if (isPaused) {
    toneColor = 'text-[#7F8896]';
  } else if (isExpired) {
    toneColor = 'text-[#BD3A3A]';
  } else if (secondsRemaining !== null && secondsRemaining <= 300) {
    toneColor = 'text-[#BD3A3A]';
  }

  const sizeClasses = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-5xl md:text-6xl',
  };

  return (
    <div className={`instr-bezel border border-[#2D333D] bg-[#101216] p-4 font-mono ${className}`}>
      {/* Telemetry bus strip */}
      <div className="flex items-center justify-between text-[10px] text-[#7F8896] uppercase tracking-wider pb-1.5 border-b border-[#2D333D]/60 mb-2">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          <span className="text-[#3D4654]">|</span>
          <span>FREQ: 1.000 Hz</span>
        </div>
        <div>
          {isPaused ? (
            <span className="text-[#E5A83B] font-bold">[CLOCK HALTED]</span>
          ) : isExpired ? (
            <span className="text-[#BD3A3A] font-bold">[WINDOW TERMINATED]</span>
          ) : (
            <span className="text-[#437A55] font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#437A55]" />
              TIME SYNC LOCK
            </span>
          )}
        </div>
      </div>

      {/* Main segmented digital display */}
      <div
        className={`font-mono font-bold tracking-tight tabular-nums ${toneColor} ${sizeClasses[size]}`}
        aria-live="polite"
      >
        {isPaused ? (
          <span className="text-[#7F8896]">PAUSED</span>
        ) : targetIsoDate ? (
          formatted
        ) : (
          '00:00:00'
        )}
      </div>
    </div>
  );
};
