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
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-12 atlas-grid-bg">
      <div className="topo-panel bg-[#111A27] max-w-md w-full p-8 space-y-6">
        <div className="space-y-1.5">
          <p className="coordinate">ACTIVATION GATE // INVITE REDEMPTION</p>
          <h1 className="text-2xl font-serif font-black text-[#E2E8EE]">
            Claim your quadrant
          </h1>
          <p className="text-xs text-[#7E8FA1] font-sans leading-relaxed">
            Redeem your single-use invitation token, set a passphrase, and ratify the survey
            protocol.
          </p>
        </div>

        {activatedEmail ? (
          <div className="border border-[#3F7A68] bg-[#3F7A68]/10 p-6 space-y-4 font-mono text-xs">
            <div className="text-sm font-bold text-[#63A98D] uppercase tracking-[0.14em]">
              Quadrant secured
            </div>
            <p className="text-[#B6C2CE] font-sans text-xs leading-relaxed">
              Credentials are established for{' '}
              <span className="font-bold text-[#E2E8EE]">{activatedEmail}</span>. Your protocol
              ratification is recorded in the permanent ledger.
            </p>
            <div className="pt-2">
              <Link
                to="/login"
                className="inline-block px-5 py-2.5 bg-[#4A8FA8] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#5BA3BC] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
              >
                Proceed to sign in
              </Link>
            </div>
          </div>
        ) : (
          <>
            {error ? <ErrorBanner error={error} /> : null}

            <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
              <div className="space-y-1.5">
                <label htmlFor="act-token" className="block text-[#E2E8EE] uppercase tracking-[0.14em] text-[11px]">
                  Invitation token
                </label>
                <input
                  id="act-token"
                  type="text"
                  required
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste token or raw URL"
                  className="w-full bg-[#0C1220] border border-[#22303F] px-3.5 py-2.5 text-sm text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="act-password" className="block text-[#E2E8EE] uppercase tracking-[0.14em] text-[11px]">
                  New passphrase
                </label>
                <input
                  id="act-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  className="w-full bg-[#0C1220] border border-[#22303F] px-3.5 py-2.5 text-sm text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                />
              </div>

              <div className="border border-[#22303F] bg-[#0C1220] p-3 space-y-1.5">
                <span className="coordinate block pb-1">PASSPHRASE COMPLEXITY CHECKS</span>
                {checks.map((chk, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 flex items-center justify-center font-bold text-[10px] ${
                        chk.pass ? 'bg-[#3F7A68] text-white' : 'bg-[#22303F] text-[#7E8FA1]'
                      }`}
                    >
                      {chk.pass ? '+' : '-'}
                    </span>
                    <span className={chk.pass ? 'text-[#E2E8EE]' : 'text-[#7E8FA1]'}>
                      {chk.label}
                    </span>
                  </div>
                ))}
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={acceptRules}
                  onChange={(e) => setAcceptRules(e.target.checked)}
                  className="mt-0.5 accent-[#4A8FA8]"
                />
                <span className="text-xs font-sans text-[#B6C2CE] leading-tight">
                  I have read and ratify the{' '}
                  <Link to="/rules" target="_blank" className="text-[#7FBBD1] underline">
                    Survey Protocol (Rules)
                  </Link>{' '}
                  and agree to the safe harbor terms.
                </span>
              </label>

              <button
                type="submit"
                disabled={!canSubmit || loading}
                className="w-full py-3 bg-[#C44D3F] text-white font-bold uppercase tracking-[0.14em] hover:bg-[#A83E32] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
              >
                {loading ? 'Securing quadrant...' : 'Ratify & activate'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
