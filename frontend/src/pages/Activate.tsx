import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorBanner } from '../components/ErrorBanner';

export const Activate: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get('invite') || '';

  const [inviteToken, setInviteToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [acceptRules, setAcceptRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [activatedEmail, setActivatedEmail] = useState<string | null>(null);

  // Password checks
  const checks = [
    { label: 'Minimum 12 characters', pass: password.length >= 12 },
    { label: 'Uppercase letter (A-Z)', pass: /[A-Z]/.test(password) },
    { label: 'Lowercase letter (a-z)', pass: /[a-z]/.test(password) },
    { label: 'Numeric digit (0-9)', pass: /[0-9]/.test(password) },
    { label: 'Special symbol (!@#$%^&*)', pass: /[^A-Za-z0-9]/.test(password) },
  ];

  const allChecksPass = checks.every((c) => c.pass);
  const canSubmit = inviteToken.trim().length > 0 && allChecksPass && acceptRules;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      setLoading(true);
      setError(null);
      const res = await api.activate({
        invite_token: inviteToken.trim(),
        password,
        accept_rules: acceptRules,
      });
      setActivatedEmail(res.email);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full border border-[#2B2E35] bg-[#181A1F] p-8 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#3E7259]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              CREDENTIAL ACTIVATION // ATH-02
            </span>
          </div>
          <h1 className="text-2xl font-serif font-black text-[#ECEEF2]">
            Activate Participant Clearance
          </h1>
          <p className="text-xs text-[#868A94] font-sans">
            Redeem single-use invitation token, establish passphrase, and ratify event charter.
          </p>
        </div>

        {activatedEmail ? (
          <div className="border border-[#3E7259] bg-[#3E7259]/10 p-6 space-y-4 font-mono text-xs">
            <div className="text-sm font-bold text-[#5EA57E]">
              ACCOUNT ACTIVATED SUCCESSFULLY
            </div>
            <p className="text-[#C4C8D2] font-sans text-xs">
              Clearance has been established for <span className="font-bold text-[#ECEEF2]">{activatedEmail}</span>. Your rules acceptance is recorded in the permanent ledger.
            </p>
            <div className="pt-2">
              <Link
                to="/login"
                className="inline-block px-5 py-2.5 bg-[#C04A36] text-white font-bold uppercase tracking-wider hover:bg-[#A83827] transition-colors"
              >
                Proceed to Sign In
              </Link>
            </div>
          </div>
        ) : (
          <>
            {error ? <ErrorBanner error={error} /> : null}

            <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
              <div className="space-y-1.5">
                <label className="block text-[#ECEEF2] uppercase tracking-wider">
                  Invitation Token
                </label>
                <input
                  type="text"
                  required
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste token or raw URL"
                  className="w-full bg-[#111215] border border-[#2B2E35] px-3.5 py-2.5 text-sm text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[#ECEEF2] uppercase tracking-wider">
                  New Secure Passphrase
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  className="w-full bg-[#111215] border border-[#2B2E35] px-3.5 py-2.5 text-sm text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
                />
              </div>

              {/* Password complexity checklist */}
              <div className="border border-[#2B2E35] bg-[#141519] p-3 space-y-1.5">
                <span className="text-[10px] uppercase text-[#868A94] font-bold block mb-1">
                  Complexity Verification
                </span>
                {checks.map((chk, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`w-3.5 h-3.5 flex items-center justify-center font-bold text-[10px] ${
                        chk.pass ? 'bg-[#3E7259] text-[#ECEEF2]' : 'bg-[#2B2E35] text-[#868A94]'
                      }`}
                    >
                      {chk.pass ? '✓' : '—'}
                    </span>
                    <span className={chk.pass ? 'text-[#ECEEF2]' : 'text-[#868A94]'}>
                      {chk.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Rules acceptance checkbox */}
              <label className="flex items-start gap-2.5 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={acceptRules}
                  onChange={(e) => setAcceptRules(e.target.checked)}
                  className="mt-0.5 accent-[#C04A36]"
                />
                <span className="text-xs font-sans text-[#C4C8D2] leading-tight">
                  I have read and hereby ratify the{' '}
                  <Link to="/rules" target="_blank" className="text-[#CF8B38] underline">
                    Competition Rules of Engagement
                  </Link>{' '}
                  and agree to adhere to safe harbor protocols.
                </span>
              </label>

              <button
                type="submit"
                disabled={!canSubmit || loading}
                className="w-full py-3 bg-[#C04A36] text-white font-bold uppercase tracking-wider hover:bg-[#A83827] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Activating Clearance...' : 'Ratify & Activate'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
