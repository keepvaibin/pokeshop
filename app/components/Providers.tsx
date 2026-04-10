"use client";

import { AuthProvider } from '../contexts/AuthContext';
import { CartProvider } from '../contexts/CartContext';
import { ThemeProvider } from 'next-themes';
import OnboardingModal from './OnboardingModal';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AuthProvider>
        <CartProvider>
          <OnboardingModal />
          {children}
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}