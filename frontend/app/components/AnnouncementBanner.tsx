"use client";

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { Info, X } from 'lucide-react';
import Link from 'next/link';

export default function AnnouncementBanner() {
  const pathname = usePathname();
  const [announcement, setAnnouncement] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('promoBannerDismissed') === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(true);
    }
  }, []);

  useEffect(() => {
    axios
      .get('http://localhost:8000/api/inventory/settings/')
      .then((r) => setAnnouncement(r.data?.store_announcement ?? ''))
      .catch(() => {});
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('promoBannerDismissed', 'true');
    setDismissed(true);
  };

  if (!announcement.trim() || dismissed || pathname !== '/') return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Info className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 line-clamp-2">
            {announcement}{' '}
            <Link href="/delivery-info" className="underline font-semibold whitespace-nowrap">Learn more &raquo;</Link>
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors flex-shrink-0"
          aria-label="Dismiss announcement"
        >
          <X className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </button>
      </div>
    </div>
  );
}
