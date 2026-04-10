"use client";

import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function AccessCodeRegistration() {
  const { loginWithTokens } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 1: Code validation
  const [accessCode, setAccessCode] = useState('');
  const [codeValidated, setCodeValidated] = useState(false);

  // Step 2: Registration fields
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [discordHandle, setDiscordHandle] = useState('');
  const [noDiscord, setNoDiscord] = useState(false);

  const validateCode = async () => {
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
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!noDiscord && !discordHandle.trim()) {
      setError('Please enter your Discord username or check "I don\'t have Discord".');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:8000/api/auth/register/', {
        access_code: accessCode,
        email,
        username,
        password,
        first_name: firstName,
        last_name: lastName,
        nickname,
        discord_handle: noDiscord ? '' : discordHandle,
        no_discord: noDiscord,
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

  const inputClass = "w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg p-8">
          <div className="mb-4">
            <Link href="/login" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-zinc-200">
              <ArrowLeft className="w-4 h-4" /> Back to login
            </Link>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Register with Access Code</h1>
            <p className="text-gray-500 text-sm">Create a non-UCSC account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Step 1: Validate code */}
          {!codeValidated && (
            <div className="space-y-4">
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Enter access code"
                className={inputClass}
              />
              <button
                onClick={validateCode}
                disabled={loading || !accessCode.trim()}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Validating...' : 'Validate Code'}
              </button>
            </div>
          )}

          {/* Step 2: Registration form */}
          {codeValidated && (
            <form onSubmit={handleRegister} className="space-y-3">
              <p className="text-sm text-green-600 font-medium mb-1">Code accepted — create your account</p>

              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" required className={inputClass} />
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" required className={inputClass} />
              </div>

              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname (optional)" className={inputClass} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required className={inputClass} />
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required className={inputClass} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8 characters)" required className={inputClass} />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" required className={inputClass} />

              {/* Discord section */}
              <div className="border-t border-gray-100 pt-3 mt-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Discord Username</label>
                {!noDiscord && (
                  <input
                    type="text"
                    value={discordHandle}
                    onChange={(e) => setDiscordHandle(e.target.value)}
                    placeholder="e.g. username#1234"
                    className={inputClass}
                  />
                )}
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noDiscord}
                    onChange={(e) => {
                      setNoDiscord(e.target.checked);
                      if (e.target.checked) setDiscordHandle('');
                    }}
                    className="rounded border-gray-300 dark:border-zinc-600"
                  />
                  <span className="text-sm text-gray-600">I don&apos;t have Discord</span>
                </label>
                {noDiscord && (
                  <p className="mt-2 text-xs text-amber-600">
                    We use Discord to coordinate pickups and trades. You may miss important updates without it.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
