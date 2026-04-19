"use client";

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import useSWR from 'swr';
import { publicFetcher } from '../lib/fetcher';
import { useAuth } from '../contexts/AuthContext';

const DISMISS_KEY = 'sctcg_announcement_dismissed';

const SHOWN_PREFIXES = ['/', '/tcg', '/category/', '/product/', '/products/', '/search', '/new-releases', '/cart', '/delivery-info'];

export default function AnnouncementBanner({ announcement: serverAnnouncement }: { announcement?: string | null }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data: settings } = useSWR('/api/inventory/settings/', publicFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const message = (settings?.store_announcement ?? serverAnnouncement ?? '').trim();

  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!message) return;
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored === message) {
      setDismissed(true);
    } else {
      setDismissed(false);
    }
  }, [message]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, message);
    setDismissed(true);
  };

  if (!message || dismissed) return null;
  if (user?.is_admin) return null;
  const show = SHOWN_PREFIXES.some(p => p === '/' ? pathname === '/' : pathname.startsWith(p));
  if (!show) return null;

  return (
    <div className="bg-pkmn-blue text-white px-4 py-2.5 relative">
      <p className="text-sm font-medium text-center pr-8">
        {message}
      </p>
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/15 transition-colors duration-[120ms] ease-out"
        aria-label="Dismiss announcement"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
