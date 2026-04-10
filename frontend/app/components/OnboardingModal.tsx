"use client";

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import toast from 'react-hot-toast';

export default function OnboardingModal() {
  const { user, loading, refreshUser } = useAuth();
  const pathname = usePathname();
  const [discordHandle, setDiscordHandle] = useState('');
  const [noDiscord, setNoDiscord] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Don't show on login/access/admin pages, or while loading
  const skipPaths = ['/login', '/access'];
  if (loading || !user) return null;
  if (skipPaths.some(p => pathname.startsWith(p))) return null;
  if (user.is_admin) return null;

  // Only show if discord info is not yet set
  const needsOnboarding = !user.discord_handle && !user.no_discord;
  if (!needsOnboarding) return null;

  const handleSubmit = async () => {
    if (!noDiscord && !discordHandle.trim()) {
      toast.error('Please enter your Discord username or check "I don\'t have Discord".');
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      await axios.patch('http://localhost:8000/api/auth/profile/', {
        discord_handle: noDiscord ? '' : discordHandle.trim(),
        no_discord: noDiscord,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshUser();
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-1">Welcome! One quick thing...</h2>
        <p className="text-sm text-gray-500 mb-4">
          We use Discord to coordinate pickups and trades. Please provide your Discord username so we can reach you.
        </p>

        {!noDiscord && (
          <input
            type="text"
            value={discordHandle}
            onChange={(e) => setDiscordHandle(e.target.value)}
            placeholder="e.g. username#1234"
            className={inputClass}
          />
        )}

        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={noDiscord}
            onChange={(e) => {
              setNoDiscord(e.target.checked);
              if (e.target.checked) setDiscordHandle('');
            }}
            className="rounded border-gray-300 dark:border-zinc-600"
          />
          <span className="text-sm text-gray-600">I don&apos;t have Discord</span>
        </label>

        {noDiscord && (
          <p className="mt-2 text-xs text-amber-600">
            You may miss important updates about your orders without Discord.
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full mt-4 bg-blue-600 text-zinc-50 dark:text-zinc-100 rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
