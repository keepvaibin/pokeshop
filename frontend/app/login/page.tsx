"use client";

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, Key, Mail } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';

type LoginMode = 'google' | 'access_code' | 'email_login';

export default function Login() {
  const { login, loginWithTokens } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('google');

  // Access code flow
  const [accessCode, setAccessCode] = useState('');
  const [codeValidated, setCodeValidated] = useState(false);
  const [regEmail, setRegEmail] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  // Email login flow
  const [emailLogin, setEmailLogin] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  const switchMode = (m: LoginMode) => {
    setMode(m);
    setError('');
    setAccessCode('');
    setCodeValidated(false);
    setRegEmail('');
    setRegUsername('');
    setRegPassword('');
    setRegConfirm('');
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

  const validateAccessCode = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.post('http://localhost:8000/api/auth/validate-access-code/', { code: accessCode });
      setCodeValidated(true);
      toast.success('Access code accepted');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Invalid or expired access code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword !== regConfirm) {
      setError('Passwords do not match.');
      return;
    }
    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:8000/api/auth/register/', {
        code: accessCode,
        email: regEmail,
        username: regUsername,
        password: regPassword,
      });
      loginWithTokens(res.data.access, res.data.refresh, res.data.user);
      toast.success('Account created!');
      router.push('/');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
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
    { key: 'access_code', label: 'Access Code', icon: <Key className="w-4 h-4" /> },
    { key: 'email_login', label: 'Email Login', icon: <Mail className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Sign In / Register</h1>
            <p className="text-gray-600">Access your Pokeshop account</p>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-gray-200 mb-6">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => switchMode(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  mode === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Google tab */}
          {mode === 'google' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-gray-500">
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
              {loading && <p className="text-gray-500 text-sm mt-2">Signing you in...</p>}
            </div>
          )}

          {/* Access Code tab */}
          {mode === 'access_code' && !codeValidated && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Enter an access code to create a non-UCSC account
              </p>
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Enter access code"
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                onClick={validateAccessCode}
                disabled={loading || !accessCode.trim()}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Validating...' : 'Validate Code'}
              </button>
            </div>
          )}

          {mode === 'access_code' && codeValidated && (
            <form onSubmit={handleRegister} className="space-y-3">
              <p className="text-sm text-green-600 font-medium">Code accepted — create your account</p>
              <input
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="Email address"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <input
                type="text"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                placeholder="Username"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <input
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Password (min 8 characters)"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <input
                type="password"
                value={regConfirm}
                onChange={(e) => setRegConfirm(e.target.value)}
                placeholder="Confirm password"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}

          {/* Email Login tab */}
          {mode === 'email_login' && (
            <form onSubmit={handleEmailLogin} className="space-y-3">
              <p className="text-sm text-gray-500">
                Sign in with your email and password
              </p>
              <input
                type="email"
                value={emailLogin}
                onChange={(e) => setEmailLogin(e.target.value)}
                placeholder="Email address"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-xs text-gray-400">
            By signing in, you agree to our terms and conditions
          </div>
        </div>
      </div>
    </div>
  );
}