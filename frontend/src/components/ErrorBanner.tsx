import React from 'react';
import { ApiError } from '../lib/api';

interface ErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onRetry, className = '' }) => {
  if (!error) return null;

  let code = 'ERROR';
  let message = 'An unexpected failure occurred.';
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
        isNetwork ? 'border-[#CF8B38] bg-[#CF8B38]/10 text-[#CF8B38]' : 'border-[#C04A36] bg-[#C04A36]/10 text-[#ECEEF2]'
      } p-4 space-y-2 font-mono text-xs ${className}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-bold px-1.5 py-0.5 bg-[#C04A36] text-[#ECEEF2] text-[10px] uppercase">
            {code}
          </span>
          <span className="text-[#868A94]">REF: {requestId}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="border border-current px-2.5 py-1 text-[11px] uppercase tracking-wider hover:bg-white/10 transition-colors"
          >
            Retry Request
          </button>
        )}
      </div>
      <p className="text-sm font-sans text-[#ECEEF2] leading-relaxed">{message}</p>
    </div>
  );
};
