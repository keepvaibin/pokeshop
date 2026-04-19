"use client";

import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useMemo, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import { tryRefreshToken } from '@/app/lib/auth-refresh';

interface User {
  email: string;
  is_admin: boolean;
  username?: string;
  discord_id?: string | null;
  discord_handle?: string;
  no_discord?: boolean;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  pokemon_icon?: string | null;
  strike_count?: number;
  is_restricted?: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (googleToken: string) => Promise<void>;
  loginWithTokens: (access: string, refresh: string, userData: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const CACHED_USER_KEY = 'cached_user';
const AUTH_HINT_COOKIE = 'auth_hint';

function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.email === 'string') return parsed;
  } catch { /* corrupted */ }
  return null;
}

function setCachedUser(u: User | null) {
  if (u) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(u));
  else localStorage.removeItem(CACHED_USER_KEY);
}

function setAuthHintCookie(u: User | null) {
  if (u) {
    const val = u.is_admin ? 'admin' : 'user';
    document.cookie = `${AUTH_HINT_COOKIE}=${val};path=/;max-age=${60 * 60 * 24 * 90};SameSite=Lax`;
  } else {
    document.cookie = `${AUTH_HINT_COOKIE}=;path=/;max-age=0`;
  }
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
  serverAuthHint?: 'admin' | 'user' | null;
}

export const AuthProvider = ({ children, serverAuthHint }: AuthProviderProps) => {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(() => {
    // On the server and during initial client hydration, use the cookie hint
    // to construct a minimal user object so SSR HTML is correct from the start.
    if (serverAuthHint) {
      return { email: '', is_admin: serverAuthHint === 'admin' } as User;
    }
    return null;
  });
  const [loading, setLoading] = useState(true);

  // Synchronously restore full cached user BEFORE the first browser paint.
  // This replaces the minimal hint-based user with the real cached data.
  useLayoutEffect(() => {
    const cached = getCachedUser();
    if (cached) {
      setUser(cached);
      setAuthHintCookie(cached);
    } else if (!localStorage.getItem('access_token')) {
      // No token and no cache — clear the hint cookie (stale)
      setUser(null);
      setAuthHintCookie(null);
    }
  }, []);

  const validateToken = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setUser(null);
      setCachedUser(null);
      setAuthHintCookie(null);
      setLoading(false);
      return;
    }
    // Immediately show cached user while we verify with the server
    const cached = getCachedUser();
    if (cached) setUser(cached);
    try {
      const response = await axios.get(`${API}/api/auth/user/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);
      setCachedUser(response.data);
      setAuthHintCookie(response.data);
    } catch {
      // Access token may be expired — try refreshing
      const newToken = await tryRefreshToken();
      if (newToken) {
        try {
          const response = await axios.get(`${API}/api/auth/user/`, {
            headers: { Authorization: `Bearer ${newToken}` }
          });
          setUser(response.data);
          setCachedUser(response.data);
          setAuthHintCookie(response.data);
          return;
        } catch { /* refresh succeeded but user fetch still failed */ }
      }
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      setUser(null);
      setCachedUser(null);
      setAuthHintCookie(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Validate on mount
  useEffect(() => { validateToken(); }, [validateToken]);

  // Re-sync from cache on route changes (covers Next.js soft nav + back button)
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      const cached = getCachedUser();
      if (cached && !user) setUser(cached);
    } else if (user) {
      setUser(null);
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // BFCache: re-validate when browser restores a frozen page (back/forward nav)
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) validateToken();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') validateToken();
    };
    const onFocus = () => validateToken();
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [validateToken]);

  const login = useCallback(async (googleToken: string) => {
    const response = await axios.post(`${API}/api/auth/google/`, { token: googleToken });
    const { access, refresh, user: userData } = response.data;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    const u = { ...userData, is_admin: !!userData.is_admin };
    setUser(u);
    setCachedUser(u);
    setAuthHintCookie(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    setCachedUser(null);
    setAuthHintCookie(null);
  }, []);

  const loginWithTokens = useCallback((access: string, refresh: string, userData: User) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    const u = { ...userData, is_admin: !!userData.is_admin };
    setUser(u);
    setCachedUser(u);
    setAuthHintCookie(u);
  }, []);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const response = await axios.get(`${API}/api/auth/user/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);
      setCachedUser(response.data);
      setAuthHintCookie(response.data);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ user, login, loginWithTokens, logout, refreshUser, loading }), [user, login, loginWithTokens, logout, refreshUser, loading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};