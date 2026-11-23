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
    { label: 'Uppercase character (A-Z)', pass: /[A-Z]/.test(password) },
    { label: 'Lowercase character (a-z)', pass: /[a-z]/.test(password) },
    { label: 'Numeric digit (0-9)', pass: /[0-9]/.test(password) },
    { label: 'Symbol delimiter (!@#$%^&*)', pass: /[^A-Za-z0-9]/.test(password) },
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
      <div className="max-w-md w-full border border-[#2D333D] bg-[#14161A] p-7 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#437A55]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              OPERATOR ENROLLMENT // ATH-02
            </span>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-[#EAECE8]">
            Activate Operator Clearance
          </h1>
          <p className="text-xs text-[#7F8896] font-mono">
            Validate invitation token, configure credentials, and ratify operating charter.
          </p>
        </div>

        {activatedEmail ? (
          <div className="border border-[#437A55] bg-[#437A55]/10 p-5 space-y-3 font-mono text-xs">
            <div className="text-xs font-bold text-[#5FA57F] uppercase">
              CLEARANCE VERIFIED FOR {activatedEmail}
            </div>
            <p className="text-[#B4B9C4] font-sans text-xs">
              Credentials committed to platform identity register. Charter acceptance permanently audited.
            </p>
            <div className="pt-2">
              <Link
                to="/login"
                className="inline-block px-4 py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] transition-colors"
              >
                Proceed to Console Sign In
              </Link>
            </div>
          </div>
        ) : (
          <>
            {error ? <ErrorBanner error={error} /> : null}

            <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
              <div className="space-y-1">
                <label className="block text-[#EAECE8] uppercase tracking-wider text-[11px] font-bold">
                  Single-Use Invitation Token
                </label>
                <input
                  type="text"
                  required
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste invite token"
                  className="w-full bg-[#101216] border border-[#2D333D] px-3 py-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[#EAECE8] uppercase tracking-wider text-[11px] font-bold">
                  Master Passphrase
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 12 characters"
                  className="w-full bg-[#101216] border border-[#2D333D] px-3 py-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
                />
              </div>

              {/* Complexity verification */}
              <div className="border border-[#2D333D] bg-[#101216] p-3 space-y-1.5">
                <span className="text-[9px] uppercase text-[#7F8896] font-bold block mb-1">
                  Complexity Register
                </span>
                {checks.map((chk, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`w-3.5 h-3.5 flex items-center justify-center font-bold text-[10px] ${
                        chk.pass ? 'bg-[#437A55] text-white' : 'bg-[#20242B] text-[#7F8896]'
                      }`}
                    >
                      {chk.pass ? '✓' : '•'}
                    </span>
                    <span className={chk.pass ? 'text-[#EAECE8]' : 'text-[#7F8896]'}>
                      {chk.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Rules acceptance checkbox */}
              <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={acceptRules}
                  onChange={(e) => setAcceptRules(e.target.checked)}
                  className="mt-0.5 accent-[#E5A83B]"
                />
                <span className="text-xs font-sans text-[#B4B9C4] leading-tight">
                  I accept and ratify the{' '}
                  <Link to="/rules" target="_blank" className="text-[#E5A83B] underline font-mono">
                    Operating Charter
                  </Link>{' '}
                  and university safe harbor protocol.
                </span>
              </label>

              <button
                type="submit"
                disabled={!canSubmit || loading}
                className="w-full py-2.5 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
