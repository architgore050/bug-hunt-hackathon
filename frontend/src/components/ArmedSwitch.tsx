import React, { useState, useEffect } from 'react';

interface ArmedSwitchProps {
  label: string;
  armedLabel?: string;
  onConfirm: () => void;
  tone?: 'crimson' | 'amber';
  disabled?: boolean;
  className?: string;
}

export const ArmedSwitch: React.FC<ArmedSwitchProps> = ({
  label,
  armedLabel = 'ARMED // CLICK TO FIRE',
  onConfirm,
  tone = 'crimson',
  disabled = false,
  className = '',
}) => {
  const [isArmed, setIsArmed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(5);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (isArmed) {
      setSecondsLeft(5);
      timer = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            setIsArmed(false);
            return 5;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isArmed]);

  const handleClick = () => {
    if (disabled) return;
    if (!isArmed) {
      setIsArmed(true);
    } else {
      setIsArmed(false);
      onConfirm();
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 font-mono text-xs ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        className={`px-3.5 py-1.5 uppercase font-bold tracking-wider border transition-colors ${
          disabled
            ? 'opacity-40 border-[#2D333D] bg-[#14161A] text-[#7F8896] cursor-not-allowed'
            : isArmed
            ? tone === 'crimson'
              ? 'bg-[#BD3A3A] text-white border-[#BD3A3A] animate-pulse'
              : 'bg-[#E5A83B] text-[#0E1013] border-[#E5A83B] animate-pulse'
            : 'border-[#3D4654] bg-[#20242B] text-[#EAECE8] hover:border-[#EAECE8]'
        }`}
      >
        {isArmed ? `${armedLabel} (${secondsLeft}s)` : label}
      </button>
      {isArmed && (
        <button
          type="button"
          onClick={() => setIsArmed(false)}
          className="px-2 py-1.5 border border-[#2D333D] bg-[#14161A] text-[#7F8896] hover:text-[#EAECE8] uppercase text-[10px]"
        >
          Disarm
        </button>
      )}
    </div>
  );
};
