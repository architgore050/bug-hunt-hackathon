import React from 'react';

interface TopoPanelProps {
  sector?: string;
  coords?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'strata' | 'chart' | 'ridge';
  className?: string;
}

/**
 * TopoPanel: the core atlas primitive. A bounded coordinate panel labelled with
 * a sector designation and optional coordinate inscription along the header rule.
 * variant 'chart' renders the lighter chart-paper strata; 'ridge' the deepest level.
 */
export const TopoPanel: React.FC<TopoPanelProps> = ({
  sector,
  coords,
  title,
  subtitle,
  action,
  children,
  variant = 'strata',
  className = '',
}) => {
  const bg =
    variant === 'chart'
      ? 'atlas-chart'
      : variant === 'ridge'
      ? 'bg-[#0C1220] border-[#22303F]'
      : 'bg-[#111A27] border-[#22303F]';

  return (
    <section className={`topo-panel ${bg} ${className}`}>
      {(sector || coords || title || action) && (
        <header className="px-5 py-3.5 border-b border-[#22303F] flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              {sector && (
                <span className="px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase bg-[#4A8FA8]/20 text-[#7FBBD1] border border-[#4A8FA8]/40">
                  {sector}
                </span>
              )}
              {coords && <span className="coordinate">{coords}</span>}
            </div>
            {title && (
              <h2 className="text-base font-serif font-bold tracking-tight text-[#E2E8EE]">
                {title}
              </h2>
            )}
            {subtitle && <p className="text-xs text-[#7E8FA1]">{subtitle}</p>}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
};
