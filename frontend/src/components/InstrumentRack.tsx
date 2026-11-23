import React from 'react';

interface InstrumentRackProps {
  channel?: string;
  title?: string;
  telemetryTag?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const InstrumentRack: React.FC<InstrumentRackProps> = ({
  channel,
  title,
  telemetryTag,
  action,
  children,
  className = '',
}) => {
  return (
    <div className={`instr-rack border border-[#2D333D] bg-[#181B20] text-[#EAECE8] ${className}`}>
      {(channel || title || telemetryTag || action) && (
        <div className="px-4 py-2.5 bg-[#14161A] border-b border-[#2D333D] flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-2.5">
            {channel && (
              <span className="px-1.5 py-0.5 bg-[#E5A83B] text-[#0E1013] font-bold text-[10px] tracking-wider uppercase">
                {channel}
              </span>
            )}
            {title && (
              <span className="font-sans font-bold text-sm tracking-wide uppercase text-[#EAECE8]">
                {title}
              </span>
            )}
            {telemetryTag && (
              <span className="text-[10px] text-[#7F8896]">
                // {telemetryTag}
              </span>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
};
