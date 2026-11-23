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
      <div className="max-w-md w-full border border-[#2D333D] bg-[#14161A] p-7 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#E5A83B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              CONSOLE ENGAGEMENT // AUTH-01
            </span>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-[#EAECE8]">
            Operator Sign In
          </h1>
          <p className="text-xs text-[#7F8896] font-mono">
            Enter assigned station credentials to establish bus connection.
          </p>
        </div>

        {error ? <ErrorBanner error={error} /> : null}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          <div className="space-y-1">
            <label className="block text-[#EAECE8] uppercase tracking-wider text-[11px] font-bold">
              Operator Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@vitbhopal.ac.in"
              className="w-full bg-[#101216] border border-[#2D333D] px-3 py-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[#EAECE8] uppercase tracking-wider text-[11px] font-bold">
              Secret Passphrase
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-[#101216] border border-[#2D333D] px-3 py-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#E5A83B] text-[#0E1013] font-bold uppercase tracking-wider hover:bg-[#D4982B] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Authenticating...' : 'Engage Console Bus'}
          </button>
        </form>

        <div className="pt-3 border-t border-[#2D333D]/60 flex items-center justify-between text-xs font-mono text-[#7F8896]">
          <Link to="/activate" className="hover:text-[#EAECE8] transition-colors">
            Activate Invite Token &rarr;
          </Link>
          <Link to="/rules" className="hover:text-[#EAECE8] transition-colors">
            Operating Rules
          </Link>
        </div>
      </div>
    </div>
  );
};
