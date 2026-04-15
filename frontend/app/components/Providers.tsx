"use client";

import { SWRConfig } from 'swr';
import { AuthProvider } from '../contexts/AuthContext';
import { CartProvider } from '../contexts/CartContext';
import OnboardingModal from './OnboardingModal';

export function Providers({ children, serverAuthHint }: { children: React.ReactNode; serverAuthHint?: 'admin' | 'user' | null }) {
  return (
    <SWRConfig value={{ revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 5000 }}>
      <AuthProvider serverAuthHint={serverAuthHint}>
        <CartProvider>
          <OnboardingModal />
          {children}
        </CartProvider>
      </AuthProvider>
    </SWRConfig>
  );
}