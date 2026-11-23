import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ErrorBanner } from '../components/ErrorBanner';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/app';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    try {
      setLoading(true);
      setError(null);
      const user = await login(email, password);
      if (user.role === 'admin' || user.role === 'organizer') {
        navigate('/admin');
      } else if (user.role === 'reviewer') {
        navigate('/review');
      } else {
        navigate(from === '/login' ? '/app' : from);
      }
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
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              CREDENTIAL ACCESS // AUTH-01
            </span>
          </div>
          <h1 className="text-2xl font-serif font-black text-[#ECEEF2]">
            Sign In to Incident Console
          </h1>
          <p className="text-xs text-[#868A94] font-sans">
            Enter authorized event email and passphrase to retrieve clearance tokens.
          </p>
        </div>

        {error ? <ErrorBanner error={error} /> : null}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          <div className="space-y-1.5">
            <label className="block text-[#ECEEF2] uppercase tracking-wider">
              Operator Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="investigator@vitbhopal.ac.in"
              className="w-full bg-[#111215] border border-[#2B2E35] px-3.5 py-2.5 text-sm text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[#ECEEF2] uppercase tracking-wider">
              Secret Passphrase
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-[#111215] border border-[#2B2E35] px-3.5 py-2.5 text-sm text-[#ECEEF2] focus:border-[#C04A36] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#C04A36] text-white font-bold uppercase tracking-wider hover:bg-[#A83827] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="pt-4 border-t border-[#2B2E35]/60 flex items-center justify-between text-xs font-mono text-[#868A94]">
          <Link to="/activate" className="hover:text-[#ECEEF2] transition-colors">
            Have an invite token? Activate
          </Link>
          <Link to="/rules" className="hover:text-[#ECEEF2] transition-colors">
            Rules
          </Link>
        </div>
      </div>
    </div>
  );
};
