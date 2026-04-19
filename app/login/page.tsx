"use client";

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, Mail } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { API_BASE_URL as API } from '@/app/lib/api';

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
      const res = await axios.post(`${API}/api/auth/login/`, {
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
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}>
    <div className="pkc-shell min-h-screen bg-pkmn-bg flex items-center justify-center px-4 overflow-x-hidden">
      <div className="w-full max-w-md min-w-0">
        <div className="pkc-panel p-8">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-pkmn-text mb-2">Sign In / Register</h1>
            <p className="text-pkmn-gray">Access your SCTCG account</p>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-pkmn-border mb-6">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => switchMode(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  mode === t.key
                    ? 'border-pkmn-blue text-pkmn-blue'
                    : 'border-transparent text-pkmn-gray hover:text-pkmn-gray-dark'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-pkmn-red/10 border border-pkmn-red/20 rounded-md flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-pkmn-red flex-shrink-0 mt-0.5" />
              <p className="text-pkmn-red text-sm">{error}</p>
            </div>
          )}

          {/* Google tab */}
          {mode === 'google' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-pkmn-gray">
                Sign in with your UCSC Google account
              </p>
              <div className="flex justify-center">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme="outline"
                    size="large"
                    shape="rectangular"
                    text="signin_with"
                    hosted_domain="ucsc.edu"
                  />
              </div>
              {loading && <p className="text-pkmn-gray text-sm mt-2">Signing you in...</p>}
            </div>
          )}

          {/* Email Login tab */}
          {mode === 'email_login' && (
            <form onSubmit={handleEmailLogin} className="space-y-3">
              <p className="text-sm text-pkmn-gray">
                Sign in with your email and password
              </p>
              <input
                type="email"
                value={emailLogin}
                onChange={(e) => setEmailLogin(e.target.value)}
                placeholder="Email address"
                required
                className="pkc-input w-full text-sm text-pkmn-text placeholder:text-pkmn-gray outline-none"
              />
              <input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Password"
                required
                className="pkc-input w-full text-sm text-pkmn-text placeholder:text-pkmn-gray outline-none"
              />
              <button
                type="submit"
                disabled={loading}
                className="pkc-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <p className="text-sm text-pkmn-gray text-center pt-1">
                Not from UCSC?{' '}
                <Link href="/access" className="text-pkmn-blue underline hover:text-pkmn-blue">
                  Have a code?
                </Link>
              </p>
            </form>
          )}

          <div className="mt-6 text-center text-xs text-pkmn-gray-dark">
            By signing in, you agree to our terms and conditions
          </div>
        </div>
      </div>
    </div>
    </GoogleOAuthProvider>
  );
}