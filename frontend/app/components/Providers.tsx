"use client";

import { AuthProvider } from '../contexts/AuthContext';
import { CartProvider } from '../contexts/CartContext';
import OnboardingModal from './OnboardingModal';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CartProvider>
        <OnboardingModal />
        {children}
      </CartProvider>
    </AuthProvider>
  );
}