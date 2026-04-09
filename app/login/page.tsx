"use client";

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSuccess = async (response: { credential?: string }) => {
    setLoading(true);
    setError('');
    try {
      if (!response.credential) throw new Error('No credential returned');
      await login(response.credential);
      router.push('/');
    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed. Please ensure you are using a @ucsc.edu email address.');
    } finally {
      setLoading(false);
    }
  };

  const handleError = () => {
    console.error('Google Login failed');
    setError('Google login error. Please try again.');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Sign In / Register</h1>
            <p className="text-gray-600">Access your UCSC Pokeshop account</p>
          </div>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
          
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-4">
                Sign in with your UCSC Google account to continue
              </p>
              <div className="flex justify-center">
                <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}>
                  <GoogleLogin
                    onSuccess={handleSuccess}
                    onError={handleError}
                    theme="outline"
                    size="large"
                    shape="rectangular"
                    text="signin_with"
                    hosted_domain="ucsc.edu"
                  />
                </GoogleOAuthProvider>
              </div>
              {loading && <p className="text-gray-500 text-sm mt-4">Signing you in...</p>}
            </div>
            
            <div className="text-center text-xs text-gray-400">
              By signing in, you agree to our terms and conditions
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}