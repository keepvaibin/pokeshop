"use client";

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import useSWR from 'swr';
import { publicFetcher } from '../lib/fetcher';

const DISMISS_KEY = 'sctcg_announcement_dismissed';

export default function AnnouncementBanner({ announcement: serverAnnouncement }: { announcement?: string | null }) {
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

  return (
    <div className="bg-pkmn-blue text-white px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-center relative">
        <p className="text-sm font-medium text-center px-8">
          {message}
        </p>
        <button
          onClick={handleDismiss}
          className="absolute right-0 p-1 hover:bg-white/15 transition-colors duration-[120ms] ease-out flex-shrink-0"
          aria-label="Dismiss announcement"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
