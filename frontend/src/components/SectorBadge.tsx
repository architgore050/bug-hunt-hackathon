import React from 'react';

export type SectorTone = 'shear' | 'strain' | 'stabilized' | 'elevation' | 'legend';

interface SectorBadgeProps {
  label: string;
  tone?: SectorTone;
  className?: string;
}

const toneClasses: Record<SectorTone, string> = {
  shear: 'text-[#C44D3F] border-[#C44D3F] bg-[#C44D3F]/10',
  strain: 'text-[#CF824B] border-[#CF824B] bg-[#CF824B]/10',
  stabilized: 'text-[#3F7A68] border-[#3F7A68] bg-[#3F7A68]/10',
  elevation: 'text-[#4A8FA8] border-[#4A8FA8] bg-[#4A8FA8]/10',
  legend: 'text-[#718294] border-[#22303F] bg-[#0C1220]',
};

/**
 * Sector inscription badge: the atlas equivalent of a map legend stamp.
 * Rectangular, hairline-bordered, all-caps coordinate typography.
 */
export const SectorBadge: React.FC<SectorBadgeProps> = ({
  label,
  tone = 'legend',
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono tracking-[0.14em] uppercase border ${
        toneClasses[tone]
      } ${className}`}
    >
      {label}
    </span>
  );
};
