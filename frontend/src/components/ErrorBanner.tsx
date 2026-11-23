import React from 'react';
import { ApiError } from '../lib/api';

interface ErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Survey fault banner: renders the ApiError envelope (code, message, request id)
 * in stress tones. Network failures render in copper (degraded) rather than shear red.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onRetry, className = '' }) => {
  if (!error) return null;

  let code = 'ERROR';
  let message = 'An unexpected survey fault occurred.';
  let requestId = 'unknown';

  if (error instanceof ApiError) {
    code = error.code;
    message = error.message;
    requestId = error.requestId;
  } else if (error instanceof Error) {
    message = error.message;
  }

  const isNetwork = code === 'NETWORK';
  const tone = isNetwork
    ? 'border-[#CF824B] bg-[#CF824B]/10'
    : 'border-[#C44D3F] bg-[#C44D3F]/10';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`border ${tone} p-4 space-y-2 font-mono text-xs ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`font-bold px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-[#E2E8EE] ${
              isNetwork ? 'bg-[#CF824B]' : 'bg-[#C44D3F]'
            }`}
          >
            {code}
          </span>
          <span className="coordinate">FAULT REF: {requestId}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="border border-current px-2.5 py-1 text-[11px] uppercase tracking-widest text-[#E2E8EE] hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
          >
            Re-run Survey
          </button>
        )}
      </div>
      <p className="text-sm font-sans text-[#E2E8EE] leading-relaxed">{message}</p>
    </div>
  );
};
