"use client";

import { SWRConfig } from 'swr';
import { AuthProvider } from '../contexts/AuthContext';
import { CartProvider } from '../contexts/CartContext';
import OnboardingModal from './OnboardingModal';
import StrikeWarningModal from './StrikeWarningModal';

export function Providers({ children, serverAuthHint }: { children: React.ReactNode; serverAuthHint?: 'admin' | 'user' | null }) {
  return (
    <SWRConfig value={{ revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 30000, focusThrottleInterval: 60000 }}>
      <AuthProvider serverAuthHint={serverAuthHint}>
        <CartProvider>
          <OnboardingModal />
          <StrikeWarningModal />
          {children}
        </CartProvider>
      </AuthProvider>
    </SWRConfig>
  );
}