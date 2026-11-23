import React from 'react';

interface ExhibitCardProps {
  exhibitNumber?: string;
  category?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'slate' | 'buff' | 'bordered';
  className?: string;
}

export const ExhibitCard: React.FC<ExhibitCardProps> = ({
  exhibitNumber,
  category,
  title,
  subtitle,
  action,
  children,
  variant = 'slate',
  className = '',
}) => {
  const isBuff = variant === 'buff';

  return (
    <section
      className={`relative border ${
        isBuff
          ? 'bg-[#F3EFE6] text-[#181A1F] border-[#DDD7CA]'
          : 'bg-[#181A1F] text-[#ECEEF2] border-[#2B2E35]'
      } ${className}`}
    >
      {(exhibitNumber || category || title || action) && (
        <header
          className={`px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${
            isBuff ? 'border-[#DDD7CA] bg-[#EBE6DB]/70' : 'border-[#2B2E35] bg-[#141519]/70'
          }`}
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-mono tracking-widest uppercase">
              {exhibitNumber && (
                <span
                  className={`px-1.5 py-0.5 font-bold ${
                    isBuff ? 'bg-[#181A1F] text-[#F3EFE6]' : 'bg-[#C04A36] text-[#ECEEF2]'
                  }`}
                >
                  {exhibitNumber}
                </span>
              )}
              {category && (
                <span className={isBuff ? 'text-[#6A665D]' : 'text-[#868A94]'}>
                  // {category}
                </span>
              )}
            </div>
            {title && (
              <h2 className="text-base font-serif font-bold tracking-tight">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className={`text-xs ${isBuff ? 'text-[#6A665D]' : 'text-[#868A94]'}`}>
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
};
