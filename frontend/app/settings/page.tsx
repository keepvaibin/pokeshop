"use client";

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Link2, LogOut, Save, Unlink, UserCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import ConfirmModal from '../components/ConfirmModal';
import { startDiscordLink } from '../lib/discord';

interface ShopSettings {
  ucsc_discord_invite: string | null;
  public_discord_invite: string | null;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const { user, loading: authLoading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false);
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      setNickname(user.nickname || '');
    }
  }, [user]);

  useEffect(() => {
    axios
      .get('http://localhost:8000/api/inventory/settings/')
      .then((response) => {
        setShopSettings({
          ucsc_discord_invite: response.data?.ucsc_discord_invite || null,
          public_discord_invite: response.data?.public_discord_invite || null,
        });
      })
      .catch(() => {});
  }, []);

  const discordStatus = searchParams.get('discord');
  const discordDetail = searchParams.get('detail');

  useEffect(() => {
    if (!discordStatus) return;

    refreshUser()
      .catch(() => {})
      .finally(() => {
        if (discordStatus === 'linked') {
          toast.success('Discord account linked.');
        } else if (discordStatus === 'cancelled') {
          toast('Discord linking cancelled.');
        } else {
          toast.error(discordDetail || 'Discord linking failed.');
        }
        router.replace('/settings');
      });
  }, [discordDetail, discordStatus, refreshUser, router]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('access_token');
      await axios.patch('http://localhost:8000/api/auth/profile/', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        nickname: nickname.trim(),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshUser();
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscordLink = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      toast.error('Please sign in again before linking Discord.');
      return;
    }

    setLinkingDiscord(true);
    try {
      await startDiscordLink(token, '/settings');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Failed to start Discord linking.');
      }
      setLinkingDiscord(false);
    }
  };

  const handleDiscordUnlink = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      toast.error('Please sign in again before unlinking Discord.');
      return;
    }

    setUnlinkingDiscord(true);
    try {
      await axios.patch('http://localhost:8000/api/auth/profile/', {
        disconnect_discord: true,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshUser();
      setShowUnlinkModal(false);
      toast.success('Discord account unlinked.');
    } catch {
      toast.error('Failed to unlink Discord.');
    } finally {
      setUnlinkingDiscord(false);
    }
  };

  const handleSignOut = () => {
    logout();
    router.push('/login');
  };

  if (authLoading || !user) return null;

  const inputClass = 'w-full rounded-xl border border-pkmn-border bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-pkmn-gray focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/15';
  const cardClass = 'rounded-2xl border border-pkmn-border bg-white p-6 shadow-sm';
  const isUcscStudent = user.email.toLowerCase().endsWith('@ucsc.edu');
  const inviteLink = (isUcscStudent ? shopSettings?.ucsc_discord_invite : shopSettings?.public_discord_invite) || '';

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-pkmn-bg">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-pkmn-text">Settings</h1>
              <p className="mt-2 text-sm text-pkmn-gray">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-xl border border-pkmn-red/20 px-4 py-2.5 text-sm font-heading font-bold text-pkmn-red transition-colors hover:bg-pkmn-red/10"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>

          <div className="space-y-6">
            <section className={cardClass}>
              <div className="flex items-center gap-2 mb-4">
                <UserCircle className="h-5 w-5 text-pkmn-blue" />
                <h2 className="text-xl font-bold text-pkmn-text">Personal Information</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-pkmn-text">First Name</label>
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-pkmn-text">Last Name</label>
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-pkmn-text">Preferred Name</label>
                <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Optional" className={inputClass} />
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-pkmn-blue px-6 py-3 text-sm font-heading font-bold text-white transition-colors hover:bg-pkmn-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </section>

            <section className={cardClass}>
              <h2 className="text-xl font-bold text-pkmn-text">Discord Account</h2>
              <p className="mt-3 text-sm text-pkmn-gray">
                Link your real Discord account to unlock the support bot, direct admin follow-up, and the right server invite for your campus status.
              </p>

              <div className="mt-5 rounded-2xl border border-pkmn-border bg-[#f8fbff] p-5">
                {user.discord_id ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-heading font-bold text-green-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Discord Linked
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowUnlinkModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-heading font-bold text-red-600 transition-colors hover:bg-red-100"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        Unlink
                      </button>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-pkmn-text">
                      {user.discord_handle || 'Your Discord account is connected.'}
                    </p>
                    <p className="mt-1 text-xs text-pkmn-gray">Discord ID: {user.discord_id}</p>
                    {inviteLink && (
                      <a
                        href={inviteLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-pkmn-blue px-6 py-4 text-base font-heading font-bold !text-white no-underline transition-colors hover:bg-pkmn-blue-dark hover:!text-white"
                      >
                        <Link2 className="h-5 w-5" />
                        Join the Discord Server
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-pkmn-text">Discord not linked yet</p>
                    {user.discord_handle && (
                      <p className="mt-2 text-xs text-pkmn-gray">Existing typed handle on file: {user.discord_handle}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleDiscordLink}
                      disabled={linkingDiscord}
                      className="mt-5 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-pkmn-blue px-6 py-3 text-sm font-heading font-bold text-white transition-colors hover:bg-pkmn-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Link2 className="w-4 h-4" />
                      {linkingDiscord ? 'Opening Discord...' : 'Link Discord Account'}
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      <ConfirmModal
        open={showUnlinkModal}
        title="Unlink Discord account?"
        description="This will disconnect your Discord account from your Pokeshop profile. You can link it again later if you want."
        confirmLabel="Yes, unlink"
        confirmDisabled={unlinkingDiscord}
        onConfirm={handleDiscordUnlink}
        onClose={() => setShowUnlinkModal(false)}
      />
    </>
  );
}
