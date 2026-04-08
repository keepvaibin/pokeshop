"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface User {
  email: string;
  is_admin: boolean;
  username?: string;
}

interface AuthContextType {
  user: User | null;
  login: (googleToken: string) => Promise<void>;
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
        console.log('User data fetched:', response.data);
        setUser(response.data);
      } catch (error) {
        console.error('Token validation failed', error);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, []);

  const login = async (googleToken: string) => {
    try {
      console.log('Attempting login with Google token...');
      const response = await axios.post('http://localhost:8000/api/auth/google/', { credential: googleToken });
      console.log('Login response:', response.data);
      const { access, refresh, user: userData } = response.data;
      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);
      console.log('User data set:', userData);
      setUser({
        email: userData.email,
        username: userData.username,
        is_admin: !!userData.is_admin,
      });
    } catch (error) {
      console.error('Login failed', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
        console.error('Response status:', error.response?.status);
      }
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    console.log('User logged out');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};