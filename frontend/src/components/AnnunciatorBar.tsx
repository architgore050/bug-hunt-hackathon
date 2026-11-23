import React from 'react';

export type AnnunciatorTone = 'amber' | 'sage' | 'crimson' | 'cyan' | 'neutral';

interface AnnunciatorBarProps {
  label: string;
  tone?: AnnunciatorTone;
  active?: boolean;
  className?: string;
}

export const AnnunciatorBar: React.FC<AnnunciatorBarProps> = ({
  label,
  tone = 'amber',
  active = true,
  className = '',
}) => {
  const activeStyles: Record<AnnunciatorTone, string> = {
    amber: 'bg-[#E5A83B] text-[#0E1013] border-[#E5A83B]',
    sage: 'bg-[#437A55] text-[#FFFFFF] border-[#437A55]',
    crimson: 'bg-[#BD3A3A] text-[#FFFFFF] border-[#BD3A3A]',
    cyan: 'bg-[#467499] text-[#FFFFFF] border-[#467499]',
    neutral: 'bg-[#2D333D] text-[#EAECE8] border-[#3D4654]',
  };

  const inactiveStyle = 'bg-[#14161A] text-[#555C68] border-[#2D333D]';

  return (
    <div
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono tracking-widest uppercase border ${
        active ? activeStyles[tone] : inactiveStyle
      } ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-80" />
      {label}
    </div>
  );
};
