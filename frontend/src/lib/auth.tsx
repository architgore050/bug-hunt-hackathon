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
      <div className="min-h-screen bg-[#0E1013] text-[#EAECE8] flex items-center justify-center font-mono">
        <div className="flex items-center gap-3 border border-[#2D333D] bg-[#181B20] px-6 py-4">
          <div className="w-2.5 h-2.5 bg-[#E5A83B] animate-pulse" />
          <span className="text-sm tracking-wider uppercase">Authenticating Credential...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (role && !roles.includes(role)) {
    return (
      <div className="min-h-screen bg-[#0E1013] text-[#EAECE8] flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-[#BD3A3A] bg-[#181B20] p-8 space-y-4">
          <div className="inline-block px-2.5 py-0.5 text-xs font-mono bg-[#BD3A3A]/20 text-[#D96A5F] border border-[#BD3A3A]">
            EX-403: ACCESS DENIED
          </div>
          <h1 className="text-2xl font-serif font-bold text-[#EAECE8]">Authorization Deficit</h1>
          <p className="text-sm text-[#7F8896]">
            Your credential role <code className="text-[#E5A83B] font-mono">[{role}]</code> lacks clearance for this sector. Requires: <code className="text-[#EAECE8] font-mono">[{roles.join(', ')}]</code>.
          </p>
          <div className="pt-2">
            <a
              href="/"
              className="inline-block border border-[#2D333D] px-4 py-2 text-xs font-mono uppercase tracking-wider text-[#EAECE8] hover:bg-[#2D333D]"
            >
              Return to Public Docket
            </a>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
