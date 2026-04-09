"use client";

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

/**
 * Redirects unauthenticated users to /login after a short delay.
 * Returns { user, loading } for rendering guards.
 *
 * @param options.adminOnly — If true, also redirects non-admin users.
 */
export function useRequireAuth(options?: { adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) return;

    const shouldRedirect =
      !user || (options?.adminOnly && !user.is_admin);

    if (shouldRedirect) {
      timerRef.current = setTimeout(() => router.push('/login'), 1000);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loading, user, options?.adminOnly, router]);

  return { user, loading };
}
