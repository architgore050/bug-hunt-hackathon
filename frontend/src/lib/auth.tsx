import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setAccessToken, refreshToken } from './api';
import type { Role, Team, User } from './types';
import { Navigate, useLocation } from 'react-router-dom';

interface AuthContextValue {
  user: User | null;
  team: Team | null;
  role: Role | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  rulesAccepted: boolean;
  rulesVersion: string;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  acceptRules: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [rulesVersion, setRulesVersion] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const refreshMe = async () => {
    try {
      const me = await api.getMe();
      setUser({
        id: me.id,
        email: me.email,
        name: me.name,
        role: me.role,
        status: me.status,
      });
      setTeam(me.team);
      setRulesAccepted(me.rules_accepted);
      setRulesVersion(me.rules_version);
    } catch {
      setUser(null);
      setTeam(null);
      setRulesAccepted(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await refreshToken();
        if (token && mounted) {
          await refreshMe();
        }
      } catch {
        // silent unauth
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setAccessToken(res.access_token);
    setUser(res.user);
    await refreshMe();
    return res.user;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    } finally {
      setAccessToken(null);
      setUser(null);
      setTeam(null);
      setRulesAccepted(false);
    }
  };

  const acceptRules = async () => {
    await api.acceptRules();
    setRulesAccepted(true);
    await refreshMe();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        team,
        role: user?.role || null,
        isAuthenticated: !!user,
        isLoading,
        rulesAccepted,
        rulesVersion,
        login,
        logout,
        acceptRules,
        refreshMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const RequireRole: React.FC<{
  roles: Role[];
  children: React.ReactNode;
}> = ({ roles, children }) => {
  const { user, role, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090E16] text-[#E2E8EE] flex items-center justify-center p-6">
        <div
          role="status"
          className="topo-panel bg-[#111A27] px-6 py-4 flex items-center gap-3 font-mono text-xs tracking-widest uppercase text-[#7E8FA1]"
        >
          <span className="w-2.5 h-2.5 bg-[#4A8FA8] beacon-pulse" aria-hidden="true" />
          <span>Triangulating credential...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (role && !roles.includes(role)) {
    return (
      <div className="min-h-screen bg-[#090E16] text-[#E2E8EE] flex items-center justify-center p-6">
        <div className="topo-panel bg-[#111A27] max-w-md w-full p-8 space-y-4">
          <span className="inline-block px-2 py-0.5 text-[11px] font-mono tracking-[0.14em] uppercase border border-[#C44D3F] bg-[#C44D3F]/10 text-[#E0836F]">
            SECTOR SEALED: ACCESS DENIED
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#E2E8EE]">
            Outside your survey quadrant
          </h1>
          <p className="text-sm text-[#7E8FA1] leading-relaxed">
            Your credential role{' '}
            <code className="text-[#E2A56B] font-mono">[{role}]</code> is not cleared for this
            sector. Required clearance:{' '}
            <code className="text-[#E2E8EE] font-mono">[{roles.join(', ')}]</code>.
          </p>
          <div className="pt-2">
            <a
              href="/"
              className="inline-block border border-[#22303F] px-4 py-2 text-xs font-mono uppercase tracking-widest text-[#E2E8EE] hover:bg-[#1A273A] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
            >
              Return to public chart
            </a>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
