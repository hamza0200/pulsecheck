import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as authApi from '../api/auth';
import { type SessionUser, refreshSession, setSessionLostHandler } from '../api/client';

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Update the cached user after account changes (e.g. alerts toggle). */
  updateUser: (patch: Partial<SessionUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const becomeGuest = useCallback(() => {
    setUser(null);
    setStatus('guest');
    queryClient.clear(); // never show one user's cached data to the next
  }, [queryClient]);

  const becomeUser = useCallback((next: SessionUser) => {
    setUser(next);
    setStatus('authenticated');
  }, []);

  // Restore the session on load: the access token was only in memory, but the httpOnly
  // refresh cookie survives reloads. refreshSession() is shared, so StrictMode's double
  // effect still makes one request.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      if (session) becomeUser(session.user);
      else becomeGuest();
    });
    return () => {
      cancelled = true;
    };
  }, [becomeGuest, becomeUser]);

  // If a refresh fails mid-session (expired, revoked, disabled), drop to guest; the route
  // guards then send the user to /login.
  useEffect(() => {
    setSessionLostHandler(becomeGuest);
    return () => setSessionLostHandler(null);
  }, [becomeGuest]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (email, password) => becomeUser((await authApi.login(email, password)).user),
      signup: async (email, password) => becomeUser((await authApi.signup(email, password)).user),
      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          becomeGuest();
        }
      },
      updateUser: (patch) => setUser((current) => (current ? { ...current, ...patch } : current)),
    }),
    [status, user, becomeGuest, becomeUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
