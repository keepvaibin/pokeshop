"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import axios from 'axios';

interface User {
  email: string;
  is_admin: boolean;
  username?: string;
  discord_handle?: string;
  no_discord?: boolean;
  first_name?: string;
  last_name?: string;
  nickname?: string;
}

interface AuthContextType {
  user: User | null;
  login: (googleToken: string) => Promise<void>;
  loginWithTokens: (access: string, refresh: string, userData: User) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const validateToken = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await axios.get('http://localhost:8000/api/auth/user/', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(response.data);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, []);

  const login = useCallback(async (googleToken: string) => {
    const response = await axios.post('http://localhost:8000/api/auth/google/', { token: googleToken });
    const { access, refresh, user: userData } = response.data;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    setUser({ ...userData, is_admin: !!userData.is_admin });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }, []);

  const loginWithTokens = useCallback((access: string, refresh: string, userData: User) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    setUser({ ...userData, is_admin: !!userData.is_admin });
  }, []);

  const value = useMemo(() => ({ user, login, loginWithTokens, logout, loading }), [user, login, loginWithTokens, logout, loading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};