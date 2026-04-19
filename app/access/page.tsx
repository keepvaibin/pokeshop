"use client";

import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { API_BASE_URL as API } from '@/app/lib/api';

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

  const validateCode = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.post(`${API}/api/auth/validate-access-code/`, { code: accessCode });
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
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/api/auth/register/`, {
        access_code: accessCode,
        email,
        username,
        password,
        first_name: firstName,
        last_name: lastName,
        nickname,
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

  const inputClass = "pkc-input w-full text-sm text-pkmn-text placeholder:text-pkmn-gray outline-none";

  return (
    <div className="pkc-shell min-h-screen bg-pkmn-bg flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="pkc-panel p-8">
          <div className="mb-4">
            <Link href="/login" className="inline-flex items-center gap-1 text-sm text-pkmn-gray hover:text-pkmn-gray-dark">
              <ArrowLeft className="w-4 h-4" /> Back to login
            </Link>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-pkmn-text mb-1">Register with Access Code</h1>
            <p className="text-pkmn-gray text-sm">Create a non-UCSC account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-pkmn-red/10 border border-pkmn-red/20 rounded-md flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-pkmn-red flex-shrink-0 mt-0.5" />
              <p className="text-pkmn-red text-sm">{error}</p>
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
                className="pkc-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Validating...' : 'Validate Code'}
              </button>
            </div>
          )}

          {/* Step 2: Registration form */}
          {codeValidated && (
            <form onSubmit={handleRegister} className="space-y-3">
              <p className="text-sm text-green-600 font-medium mb-1">Code accepted - create your account</p>

              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" required className={inputClass} />
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" required className={inputClass} />
              </div>

              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname (optional)" className={inputClass} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required className={inputClass} />
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required className={inputClass} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8 characters)" required className={inputClass} />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" required className={inputClass} />

              <p className="rounded-md border border-pkmn-border bg-pkmn-bg px-3 py-2 text-xs text-pkmn-gray">
                After signup, you will link your Discord account from the app or mark that you do not use Discord.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="pkc-button-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50"
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
