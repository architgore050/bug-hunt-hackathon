import React from 'react';

export type StampTone = 'danger' | 'success' | 'warning' | 'info' | 'neutral';

interface StampBadgeProps {
  label: string;
  tone?: StampTone;
  stampStyle?: boolean;
  className?: string;
}

export const StampBadge: React.FC<StampBadgeProps> = ({
  label,
  tone = 'neutral',
  stampStyle = true,
  className = '',
}) => {
  const toneClasses: Record<StampTone, string> = {
    danger: 'text-[#E2715A] border-[#C04A36] bg-[#C04A36]/10',
    success: 'text-[#5EA57E] border-[#3E7259] bg-[#3E7259]/10',
    warning: 'text-[#CF8B38] border-[#CF8B38] bg-[#CF8B38]/10',
    info: 'text-[#7BA6C4] border-[#4B7B9A] bg-[#4B7B9A]/10',
    neutral: 'text-[#868A94] border-[#3C404A] bg-[#1E2026]',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono tracking-wider uppercase border ${
        toneClasses[tone]
      } ${stampStyle ? 'rotate-[-1deg] shadow-[inset_0_0_0_1px_currentColor]' : ''} ${className}`}
    >
      {label}
    </span>
  );
};
