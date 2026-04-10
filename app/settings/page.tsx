"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { LogOut, Save, UserCircle, Palette } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { useTheme } from 'next-themes';

export default function SettingsPage() {
  const { user, loading: authLoading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('personal');
  const { theme, setTheme } = useTheme();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [discordHandle, setDiscordHandle] = useState('');
  const [noDiscord, setNoDiscord] = useState(false);

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
      setDiscordHandle(user.discord_handle || '');
      setNoDiscord(user.no_discord || false);
    }
  }, [user]);

  const handleSave = async () => {
    if (!noDiscord && !discordHandle.trim()) {
      toast.error('Please enter your Discord username or check "I don\'t have Discord".');
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('access_token');
      await axios.patch('http://localhost:8000/api/auth/profile/', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        nickname: nickname.trim(),
        discord_handle: noDiscord ? '' : discordHandle.trim(),
        no_discord: noDiscord,
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

  const handleSignOut = () => {
    logout();
    router.push('/login');
  };

  if (authLoading || !user) return null;

  const inputClass = "w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  const sidebarItems = [
    { key: 'personal', label: 'Personal Info', icon: UserCircle },
    { key: 'preferences', label: 'Preferences', icon: Palette },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-1">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">{user.email}</p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Sidebar */}
            <div className="md:col-span-1">
              <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-2 md:p-3 md:sticky md:top-24 flex flex-col gap-3 h-full">
                <nav className="flex md:flex-col flex-row overflow-x-auto md:overflow-x-visible gap-1">
              {sidebarItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === item.key
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700'
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
                    className="w-full flex items-center justify-center gap-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
              <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-2">Personal Info</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">First Name</label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Last Name</label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Nickname</label>
                  <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Optional" className={inputClass} />
                </div>

                <div className="border-t border-gray-100 dark:border-zinc-800 pt-4">
                  <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Discord Username</label>
                  {!noDiscord && (
                    <input
                      type="text"
                      value={discordHandle}
                      onChange={(e) => setDiscordHandle(e.target.value)}
                      placeholder="e.g. username#1234"
                      className={inputClass}
                    />
                  )}
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noDiscord}
                      onChange={(e) => {
                        setNoDiscord(e.target.checked);
                        if (e.target.checked) setDiscordHandle('');
                      }}
                      className="rounded border-gray-300 dark:border-zinc-600"
                    />
                    <span className="text-sm text-gray-600 dark:text-zinc-400">I don&apos;t have Discord</span>
                  </label>
                  {noDiscord && (
                    <p className="mt-1 text-xs text-amber-600">You may miss important pickup/trade updates without Discord.</p>
                  )}
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}

            {activeTab === 'preferences' && (
              <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-2">Preferences</h2>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-3">Theme</label>
                  <div className="flex gap-2">
                    {(['light', 'dark', 'system'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          theme === t
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>

          {/* Mobile sign-out */}
          <div className="md:hidden mt-6">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
