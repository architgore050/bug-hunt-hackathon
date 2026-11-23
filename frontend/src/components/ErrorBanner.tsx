import React from 'react';
import { ApiError } from '../lib/api';

interface ErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onRetry, className = '' }) => {
  if (!error) return null;

  let code = 'FAULT';
  let message = 'An unexpected instrument fault occurred.';
  let requestId = 'unknown';

  if (error instanceof ApiError) {
    code = error.code;
    message = error.message;
    requestId = error.requestId;
  } else if (error instanceof Error) {
    message = error.message;
  }

  const isNetwork = code === 'NETWORK';

  return (
    <div
      role="alert"
      className={`border ${
        isNetwork
          ? 'border-[#E5A83B] bg-[#E5A83B]/10 text-[#E5A83B]'
          : 'border-[#BD3A3A] bg-[#BD3A3A]/10 text-[#EAECE8]'
      } p-3.5 space-y-2 font-mono text-xs ${className}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-bold px-1.5 py-0.5 bg-[#BD3A3A] text-white text-[10px] tracking-wider uppercase">
            FAULT: {code}
          </span>
          <span className="text-[#7F8896]">TRACE: {requestId}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="border border-current px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-wider hover:bg-white/10"
          >
            Reset & Retry
          </button>
        )}
      </div>
      <p className="text-xs font-sans text-[#EAECE8] leading-relaxed">{message}</p>
    </div>
  );
};
