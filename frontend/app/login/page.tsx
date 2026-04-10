"use client";

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, Mail } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Link from 'next/link';

type LoginMode = 'google' | 'email_login';

export default function Login() {
  const { login, loginWithTokens } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('google');

  // Email login flow
  const [emailLogin, setEmailLogin] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  const switchMode = (m: LoginMode) => {
    setMode(m);
    setError('');
    setEmailLogin('');
    setEmailPassword('');
  };

  const handleGoogleSuccess = async (response: { credential?: string }) => {
    setLoading(true);
    setError('');
    try {
      if (!response.credential) throw new Error('No credential returned');
      await login(response.credential);
      router.push('/');
    } catch {
      setError('Login failed. Please ensure you are using a @ucsc.edu email address.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google login error. Please try again.');
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:8000/api/auth/login/', {
        email: emailLogin,
        password: emailPassword,
      });
      loginWithTokens(res.data.access, res.data.refresh, res.data.user);
      toast.success('Signed in!');
      router.push('/');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: LoginMode; label: string; icon: React.ReactNode }[] = [
    { key: 'google', label: 'UCSC Google', icon: null },
    { key: 'email_login', label: 'Email Login', icon: <Mail className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg p-8">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Sign In / Register</h1>
            <p className="text-zinc-600 dark:text-zinc-400">Access your Pokeshop account</p>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-gray-200 dark:border-zinc-700 mb-6">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => switchMode(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  mode === t.key
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
            </div>
          )}

          {/* Google tab */}
          {mode === 'google' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Sign in with your UCSC Google account
              </p>
              <div className="flex justify-center">
                <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}>
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme="outline"
                    size="large"
                    shape="rectangular"
                    text="signin_with"
                    hosted_domain="ucsc.edu"
                  />
                </GoogleOAuthProvider>
              </div>
              {loading && <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2">Signing you in...</p>}
            </div>
          )}

          {/* Email Login tab */}
          {mode === 'email_login' && (
            <form onSubmit={handleEmailLogin} className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Sign in with your email and password
              </p>
              <input
                type="email"
                value={emailLogin}
                onChange={(e) => setEmailLogin(e.target.value)}
                placeholder="Email address"
                required
                className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center pt-1">
                Not from UCSC?{' '}
                <Link href="/access" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300">
                  Have a code?
                </Link>
              </p>
            </form>
          )}

          <div className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
            By signing in, you agree to our terms and conditions
          </div>
        </div>
      </div>
    </div>
  );
}