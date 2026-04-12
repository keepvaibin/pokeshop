"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import { Save, Settings, Calendar, Plus, Trash2, Clock, LogOut, Sliders, MapPin, Link2, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { startDiscordLink } from '../../lib/discord';

interface PokeshopSettings {
  trade_credit_percentage: number;
  store_announcement: string;
  show_footer_newsletter: boolean;
  max_trade_cards_per_order: number;
  discord_webhook_url: string;
}

interface Timeslot {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  is_active: boolean;
  max_bookings: number;
  bookings_this_week: number;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function AdminSettingsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const { logout, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<PokeshopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('store');
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [updatingDiscordPreference, setUpdatingDiscordPreference] = useState(false);

  // Timeslot state
  const [timeslots, setTimeslots] = useState<Timeslot[]>([]);
  const [tsLoading, setTsLoading] = useState(true);
  const [newDay, setNewDay] = useState('0');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newMaxBookings, setNewMaxBookings] = useState('5');
  const [tsCreating, setTsCreating] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
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
        router.replace('/admin/settings');
      });
  }, [discordDetail, discordStatus, refreshUser, router]);

  useEffect(() => {
    if (!isAdmin) return;
    axios
      .get('http://localhost:8000/api/inventory/settings/', { headers })
      .then((r) => setSettings(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin, headers]);

  const fetchTimeslots = useCallback(() => {
    setTsLoading(true);
    axios
      .get('http://localhost:8000/api/inventory/recurring-timeslots/', { headers })
      .then((r) => setTimeslots(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setTsLoading(false));
  }, [headers]);

  useEffect(() => {
    if (isAdmin) fetchTimeslots();
  }, [isAdmin, fetchTimeslots]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await axios.patch('http://localhost:8000/api/inventory/settings/1/', settings, { headers });
      setSettings(res.data);
      toast.success('Settings saved!');
    } catch {
      toast.error('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscordLink = async () => {
    const authToken = localStorage.getItem('access_token');
    if (!authToken) {
      toast.error('Please sign in again before linking Discord.');
      return;
    }

    setLinkingDiscord(true);
    try {
      await startDiscordLink(authToken, '/admin/settings');
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
      const authToken = localStorage.getItem('access_token');
      await axios.patch('http://localhost:8000/api/auth/profile/', {
        no_discord: true,
      }, {
        headers: { Authorization: `Bearer ${authToken}` },
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

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  const sidebarItems = [
    { key: 'store', label: 'Store Config', icon: Sliders },
    { key: 'timeslots', label: 'Timeslots', icon: Calendar },
  ];

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-8 h-8 text-pkmn-blue" />
          <h1 className="text-3xl font-black text-pkmn-text">Store Settings</h1>
        </div>

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
            {loading || !settings ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
              </div>
            ) : (
              <>
                {activeTab === 'store' && (
                  <div className="space-y-6">
                    {/* Trade Credit */}
                    <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Trade-In Settings</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Trade Credit Percentage</label>
                          <div className="flex items-center gap-3">
                            <input type="number" min="0" max="100" step="0.01" value={settings.trade_credit_percentage} onChange={(e) => setSettings({ ...settings, trade_credit_percentage: parseFloat(e.target.value) || 0 })} className="w-32 p-3 border border-pkmn-border rounded-lg text-pkmn-text bg-white placeholder:text-pkmn-gray focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                            <span className="text-pkmn-gray font-medium">%</span>
                          </div>
                          <p className="text-xs text-pkmn-gray mt-1">Customers receive this percentage of their card&apos;s estimated value as trade credit.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Max Trade Cards Per Order</label>
                          <input type="number" min="1" max="20" value={settings.max_trade_cards_per_order} onChange={(e) => setSettings({ ...settings, max_trade_cards_per_order: parseInt(e.target.value) || 1 })} className="w-32 p-3 border border-pkmn-border rounded-lg text-pkmn-text bg-white placeholder:text-pkmn-gray focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                      </div>
                    </div>

                    {/* Announcement */}
                    <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Store Announcement</h2>
                      <textarea value={settings.store_announcement} onChange={(e) => setSettings({ ...settings, store_announcement: e.target.value })} rows={3} className="w-full p-3 border border-pkmn-border rounded-lg text-pkmn-text bg-white placeholder:text-pkmn-gray focus:ring-2 focus:ring-pkmn-blue focus:border-transparent resize-none" placeholder="Enter a store-wide announcement..." />
                      <p className="text-xs text-pkmn-gray mt-1">Leave empty to hide the announcement banner.</p>
                    </div>

                    <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Footer Signup Block</h2>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, show_footer_newsletter: !settings.show_footer_newsletter })}
                        className="w-full flex items-center justify-between gap-4 rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-4 text-left transition-colors hover:border-pkmn-blue"
                      >
                        <div>
                          <p className="text-sm font-semibold text-pkmn-text">Show the footer signup section</p>
                          <p className="mt-1 text-xs text-pkmn-gray">Controls the email signup block above the main footer links.</p>
                        </div>
                        <span className={`inline-flex min-w-[5.5rem] items-center justify-center rounded-full px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-[0.08rem] ${settings.show_footer_newsletter ? 'bg-green-500/100/100/100/15 text-green-600' : 'bg-pkmn-red/10 text-pkmn-red'}`}>
                          {settings.show_footer_newsletter ? 'Visible' : 'Hidden'}
                        </span>
                      </button>
                    </div>

                    <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Discord Account</h2>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <label className="block text-xs font-medium text-pkmn-gray mb-1">Discord Account</label>
                          <p className="text-sm text-pkmn-gray">
                            Link your actual Discord account so the standalone bot can identify you by Discord user ID, not just a typed handle.
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08rem] ${user?.discord_id ? 'bg-green-600/10 text-green-700' : user?.no_discord ? 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' : 'bg-pkmn-blue/10 text-pkmn-blue'}`}>
                          {user?.discord_id ? 'Linked' : user?.no_discord ? 'No Discord' : 'Action needed'}
                        </span>
                      </div>

                      <div className="mt-4 rounded-xl border border-pkmn-border bg-pkmn-bg p-4 space-y-3">
                        {user?.discord_id ? (
                          <>
                            <p className="text-sm font-medium text-pkmn-text">
                              {user.discord_handle || 'Discord account connected'}
                            </p>
                            <p className="text-xs text-pkmn-gray">Discord ID: {user.discord_id}</p>
                            <p className="text-xs text-pkmn-gray">
                              Your admin account is already linked and ready for Discord bot workflows.
                            </p>
                          </>
                        ) : user?.no_discord ? (
                          <>
                            <p className="text-sm font-medium text-pkmn-text">No Discord on file</p>
                            <p className="text-xs text-pkmn-gray">
                              You can still manage the shop, but Discord bot features and direct ticket routing will stay disconnected.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-pkmn-text">Discord not linked yet</p>
                            {user?.discord_handle && (
                              <p className="text-xs text-pkmn-gray">
                                Existing handle on file: {user.discord_handle}. You still need to link the real Discord account for bot support.
                              </p>
                            )}
                          </>
                        )}

                        <div className="flex flex-col gap-2 sm:flex-row">
                          {user?.discord_id ? (
                            <button
                              type="button"
                              disabled
                              className="pkc-button-primary !bg-green-600 hover:!bg-green-600 disabled:cursor-not-allowed disabled:opacity-100"
                            >
                              <Link2 className="w-4 h-4" />
                              Discord Linked
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleDiscordLink}
                              disabled={linkingDiscord || updatingDiscordPreference}
                              className="pkc-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Link2 className="w-4 h-4" />
                              {linkingDiscord ? 'Opening Discord...' : 'Link Discord Account'}
                            </button>
                          )}
                          {!user?.discord_id && (
                            <button
                              type="button"
                              onClick={handleNoDiscord}
                              disabled={linkingDiscord || updatingDiscordPreference}
                              className="pkc-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ShieldAlert className="w-4 h-4" />
                              {updatingDiscordPreference ? 'Saving...' : 'I Don\'t Have Discord'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Discord */}
                    <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Discord Notifications</h2>
                      <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Webhook URL</label>
                      <input type="url" value={settings.discord_webhook_url || ''} onChange={(e) => setSettings({ ...settings, discord_webhook_url: e.target.value })} className="w-full p-3 border border-pkmn-border rounded-lg text-pkmn-text bg-white placeholder:text-pkmn-gray focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" placeholder="https://discord.com/api/webhooks/..." />
                      <p className="text-xs text-pkmn-gray mt-1">Paste a Discord webhook URL to receive notifications.</p>
                    </div>

                    <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-pkmn-blue text-white font-bold py-3 px-6 rounded-xl hover:bg-pkmn-blue-dark transition-all active:scale-95 disabled:opacity-50">
                      <Save size={18} />
                      {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                )}

                {activeTab === 'timeslots' && (
                  <div className="bg-white border border-pkmn-border rounded-xl p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-pkmn-blue" />
                      <h2 className="text-lg font-bold text-pkmn-text">Weekly Pickup Timeslots</h2>
                    </div>

                    {/* Add new recurring timeslot */}
                    <div className="bg-pkmn-bg border border-pkmn-border rounded-lg p-4 mb-4">
                      <p className="text-sm font-semibold text-pkmn-gray-dark mb-3">Create New Weekly Timeslot</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Day of Week</label>
                          <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-lg text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200">
                            {DAY_NAMES.map((name, i) => (<option key={i} value={i}>{name}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Start Time</label>
                          <input type="time" value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-lg text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">End Time</label>
                          <input type="time" value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-lg text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Location</label>
                          <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Crown courtyard" className="w-full p-2.5 border border-pkmn-border rounded-lg text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Max Bookings</label>
                          <input type="number" min="1" value={newMaxBookings} onChange={(e) => setNewMaxBookings(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-lg text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!newStartTime || !newEndTime) { toast.error('Start and end times are required.'); return; }
                          setTsCreating(true);
                          try {
                            await axios.post('http://localhost:8000/api/inventory/recurring-timeslots/', {
                              day_of_week: parseInt(newDay), start_time: newStartTime, end_time: newEndTime, location: newLocation.trim(), max_bookings: parseInt(newMaxBookings) || 5,
                            }, { headers });
                            toast.success('Weekly timeslot created!');
                            setNewDay('0'); setNewStartTime(''); setNewEndTime(''); setNewLocation(''); setNewMaxBookings('5');
                            fetchTimeslots();
                          } catch (err) {
                            if (axios.isAxiosError(err) && err.response?.data) {
                              const msgs = Object.values(err.response.data).flat().join(', ');
                              toast.error(msgs || 'Failed to create timeslot.');
                            } else { toast.error('Failed to create timeslot.'); }
                          } finally { setTsCreating(false); }
                        }}
                        disabled={tsCreating}
                        className="mt-3 flex items-center gap-2 bg-green-600 text-white font-semibold py-2.5 px-5 rounded-lg hover:bg-green-700 transition-all active:scale-95 disabled:opacity-50 text-sm"
                      >
                        <Plus size={16} />
                        {tsCreating ? 'Creating...' : 'Add Weekly Timeslot'}
                      </button>
                    </div>

                    {/* Existing timeslots */}
                    {tsLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-pkmn-blue"></div>
                      </div>
                    ) : timeslots.length === 0 ? (
                      <p className="text-pkmn-gray text-sm text-center py-4">No weekly timeslots created yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {timeslots.map((ts) => (
                          <div key={ts.id} className={`flex items-center justify-between p-3 rounded-lg border ${ts.is_active ? 'bg-white border-pkmn-border' : 'bg-pkmn-red/10 border-pkmn-red/20'}`}>
                            <div className="flex items-center gap-3">
                              <Clock size={16} className={ts.is_active ? 'text-pkmn-blue' : 'text-pkmn-red'} />
                              <div>
                                <p className="text-sm font-medium text-pkmn-text">{DAY_NAMES[ts.day_of_week]}</p>
                                <p className="text-xs text-pkmn-gray">{ts.start_time.slice(0, 5)} - {ts.end_time.slice(0, 5)}</p>
                                {ts.location && (
                                  <p className="mt-1 flex items-center gap-1 text-xs text-pkmn-gray">
                                    <MapPin size={12} /> {ts.location}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-pkmn-gray">{ts.bookings_this_week}/{ts.max_bookings} this week</span>
                              <button
                                onClick={async () => {
                                  try {
                                    await axios.patch(`http://localhost:8000/api/inventory/recurring-timeslots/${ts.id}/`, { is_active: !ts.is_active }, { headers });
                                    fetchTimeslots();
                                    toast.success(ts.is_active ? 'Timeslot deactivated' : 'Timeslot activated');
                                  } catch { toast.error('Failed to update timeslot.'); }
                                }}
                                className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${ts.is_active ? 'bg-orange-500/100/100/100/15 text-orange-600 hover:bg-orange-500/100/100/20' : 'bg-green-500/100/100/100/15 text-green-600 hover:bg-green-500/100/100/20'}`}
                              >
                                {ts.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await axios.delete(`http://localhost:8000/api/inventory/recurring-timeslots/${ts.id}/`, { headers });
                                    fetchTimeslots();
                                    toast.success('Timeslot deleted');
                                  } catch { toast.error('Failed to delete timeslot.'); }
                                }}
                                className="p-1 text-pkmn-red hover:bg-pkmn-red/10 rounded transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}


              </>
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
  );
}
