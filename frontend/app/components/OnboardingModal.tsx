"use client";

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Link2, ShieldAlert } from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';

import { startDiscordLink } from '../lib/discord';

export default function OnboardingModal() {
  const { user, loading, refreshUser } = useAuth();
  const pathname = usePathname();
  const [linking, setLinking] = useState(false);
  const [savingNoDiscord, setSavingNoDiscord] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  // Don't show on login/access/admin pages, or while loading
  const skipPaths = ['/login', '/access'];
  if (loading || !user) return null;
  if (skipPaths.some(p => pathname.startsWith(p))) return null;
  if (user.is_admin) return null;

  // Show follow-up even after user.no_discord is set
  if (showFollowUp) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white border border-pkmn-border rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-bold text-pkmn-text mb-1">No worries!</h2>
        <p className="text-sm text-pkmn-gray mb-4">
          Discord is used to provide updates and notifications so that you don&apos;t always have to be on the website to get order updates. To connect your Discord later, go to your settings.
        </p>
        <button
          onClick={() => setShowFollowUp(false)}
          className="pkc-button-primary w-full"
        >
          Okay
        </button>
      </div>
    </div>
  );

  // Only show if discord info is not yet set
  const needsOnboarding = !user.discord_id && !user.no_discord;
  if (!needsOnboarding) return null;

  const handleDiscordLink = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      toast.error('Please sign in again before linking Discord.');
      return;
    }

    setLinking(true);
    try {
      await startDiscordLink(token, pathname || '/');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Failed to start Discord linking.');
      }
      setLinking(false);
    }
  };

  const handleNoDiscord = async () => {
    setSavingNoDiscord(true);
    try {
      const token = localStorage.getItem('access_token');
      await axios.patch(`${API}/api/auth/profile/`, {
        no_discord: true,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshUser();
      setShowFollowUp(true);
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSavingNoDiscord(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white border border-pkmn-border shadow-2xl p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-bold text-pkmn-text mb-1">Welcome! One quick thing...</h2>
        <p className="text-sm text-pkmn-gray mb-4">
          We use Discord to coordinate pickups, support tickets, and trade questions. Link the real Discord account now, or tell us you do not use Discord.
        </p>

        {user.discord_handle && (
          <p className="mb-4 rounded-lg border border-pkmn-border bg-pkmn-bg px-3 py-2 text-xs text-pkmn-gray">
            Existing handle on file: {user.discord_handle}. This still needs a real Discord account link for bot-based support.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={handleDiscordLink}
            disabled={linking || savingNoDiscord}
            className="pkc-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            {linking ? 'Opening Discord...' : 'Link Discord Account'}
          </button>
          <button
            onClick={handleNoDiscord}
            disabled={linking || savingNoDiscord}
            className="pkc-button-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldAlert className="w-4 h-4" />
            {savingNoDiscord ? 'Saving...' : 'I Don\'t Have Discord'}
          </button>
        </div>

        <p className="mt-3 text-xs text-pkmn-yellow-dark">
          Without Discord, you may miss faster ticket updates and pickup coordination messages.
        </p>
      </div>
    </div>
  );
}
