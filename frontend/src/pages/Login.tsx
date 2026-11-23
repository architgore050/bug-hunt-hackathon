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
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-12 atlas-grid-bg">
      <div className="topo-panel bg-[#111A27] max-w-md w-full p-8 space-y-6">
        <div className="space-y-1.5">
          <p className="coordinate">ACTIVATION GATE // CREDENTIAL CHECK</p>
          <h1 className="text-2xl font-serif font-black text-[#E2E8EE]">
            Sign in to base camp
          </h1>
          <p className="text-xs text-[#7E8FA1] font-sans leading-relaxed">
            Enter your event email and passphrase to resume your survey.
          </p>
        </div>

        {error ? <ErrorBanner error={error} /> : null}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="block text-[#E2E8EE] uppercase tracking-[0.14em] text-[11px]">
              Surveyor email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="surveyor@vitbhopal.ac.in"
              className="w-full bg-[#0C1220] border border-[#22303F] px-3.5 py-2.5 text-sm text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none focus-visible:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block text-[#E2E8EE] uppercase tracking-[0.14em] text-[11px]">
              Passphrase
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="************"
              className="w-full bg-[#0C1220] border border-[#22303F] px-3.5 py-2.5 text-sm text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#4A8FA8] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#5BA3BC] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
          >
            {loading ? 'Triangulating...' : 'Sign in'}
          </button>
        </form>

        <div className="pt-4 border-t border-[#22303F]/70 flex items-center justify-between text-xs font-mono text-[#7E8FA1]">
          <Link to="/activate" className="hover:text-[#E2E8EE] transition-colors">
            Have an invite token? Activate
          </Link>
          <Link to="/rules" className="hover:text-[#E2E8EE] transition-colors">
            Survey protocol
          </Link>
        </div>
      </div>
    </div>
  );
};
