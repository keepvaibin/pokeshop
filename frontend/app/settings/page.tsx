"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Link2, LogOut, Save, ShieldAlert, UserCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { startDiscordLink } from '../lib/discord';

export default function SettingsPage() {
  const { user, loading: authLoading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [updatingDiscordPreference, setUpdatingDiscordPreference] = useState(false);
  const [activeTab, setActiveTab] = useState('personal');

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

  const handleNoDiscord = async () => {
    setUpdatingDiscordPreference(true);
    try {
      const token = localStorage.getItem('access_token');
      await axios.patch('http://localhost:8000/api/auth/profile/', {
        no_discord: true,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshUser();
      toast.success(user?.discord_id ? 'Discord link removed.' : 'Saved your no-Discord preference.');
    } catch {
      toast.error('Failed to update your Discord preference.');
    } finally {
      setUpdatingDiscordPreference(false);
    }
  };

  const handleSignOut = () => {
    logout();
    router.push('/login');
  };

  if (authLoading || !user) return null;

  const inputClass = "w-full border border-pkmn-border rounded-lg px-4 py-2.5 text-sm text-pkmn-text bg-white placeholder:text-pkmn-gray focus:ring-2 focus:ring-pkmn-blue focus:border-pkmn-blue outline-none";

  const sidebarItems = [
    { key: 'personal', label: 'Personal Info', icon: UserCircle },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-pkmn-bg">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-pkmn-text mb-1">Settings</h1>
          <p className="text-sm text-pkmn-gray mb-6">{user.email}</p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Sidebar */}
            <div className="md:col-span-1">
              <div className="bg-white border border-pkmn-border rounded-xl p-2 md:p-3 md:sticky md:top-24 flex flex-col gap-3 h-full">
                <nav className="flex md:flex-col flex-row overflow-x-auto md:overflow-x-visible gap-1">
              {sidebarItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === item.key
                      ? 'bg-pkmn-blue/10 text-pkmn-blue'
                      : 'text-pkmn-gray hover:bg-pkmn-bg'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
                </nav>
                <div className="hidden md:block mt-auto pt-3">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center justify-center gap-2 border border-pkmn-red/20 text-pkmn-red rounded-lg py-2.5 text-sm font-medium hover:bg-pkmn-red/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="md:col-span-3">
            {activeTab === 'personal' && (
              <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm space-y-4">
                <h2 className="text-lg font-semibold text-pkmn-text mb-2">Personal Info</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-pkmn-gray mb-1">First Name</label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-pkmn-gray mb-1">Last Name</label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-pkmn-gray mb-1">Nickname</label>
                  <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Optional" className={inputClass} />
                </div>

                <div className="border-t border-pkmn-border pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <label className="block text-xs font-medium text-pkmn-gray mb-1">Discord Account</label>
                      <p className="text-sm text-pkmn-gray">
                        Link your actual Discord account so the standalone bot can identify you by Discord user ID, not just a typed handle.
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08rem] ${user.discord_id ? 'bg-green-600/10 text-green-700' : user.no_discord ? 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' : 'bg-pkmn-blue/10 text-pkmn-blue'}`}>
                      {user.discord_id ? 'Linked' : user.no_discord ? 'No Discord' : 'Action needed'}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl border border-pkmn-border bg-pkmn-bg p-4 space-y-3">
                    {user.discord_id ? (
                      <>
                        <p className="text-sm font-medium text-pkmn-text">
                          {user.discord_handle || 'Discord account connected'}
                        </p>
                        <p className="text-xs text-pkmn-gray">Discord ID: {user.discord_id}</p>
                        <p className="text-xs text-pkmn-gray">
                          Re-link if you want to refresh the account association, or switch to no-Discord mode to clear the link.
                        </p>
                      </>
                    ) : user.no_discord ? (
                      <>
                        <p className="text-sm font-medium text-pkmn-text">No Discord on file</p>
                        <p className="text-xs text-pkmn-gray">
                          You can still browse and order, but you may miss Discord-based ticketing and pickup coordination.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-pkmn-text">Discord not linked yet</p>
                        {user.discord_handle && (
                          <p className="text-xs text-pkmn-gray">
                            Existing handle on file: {user.discord_handle}. You still need to link the real Discord account for bot support.
                          </p>
                        )}
                      </>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={handleDiscordLink}
                        disabled={linkingDiscord || updatingDiscordPreference}
                        className="pkc-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Link2 className="w-4 h-4" />
                        {linkingDiscord ? 'Opening Discord...' : user.discord_id ? 'Re-Link Discord' : 'Link Discord Account'}
                      </button>
                      <button
                        type="button"
                        onClick={handleNoDiscord}
                        disabled={linkingDiscord || updatingDiscordPreference}
                        className="pkc-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ShieldAlert className="w-4 h-4" />
                        {updatingDiscordPreference ? 'Saving...' : 'I Don\'t Have Discord'}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-pkmn-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-pkmn-blue-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}


            </div>
          </div>

          {/* Mobile sign-out */}
          <div className="md:hidden mt-6">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 border border-pkmn-red/20 text-pkmn-red rounded-lg py-2.5 text-sm font-medium hover:bg-pkmn-red/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
