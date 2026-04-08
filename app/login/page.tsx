"use client";

import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();

  const handleSuccess = (response: any) => {
    login(response.credential);
    router.push('/');
  };

  const handleError = () => {
    console.error('Login failed');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Sign In / Register</h1>
            <p className="text-gray-600">Access your UCSC Pokeshop account</p>
          </div>
          
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