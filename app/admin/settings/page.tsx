"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import { Save, Settings, Calendar, Plus, Trash2, Clock, Palette, LogOut, Sliders } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTheme } from 'next-themes';

interface PokeshopSettings {
  trade_credit_percentage: number;
  store_announcement: string;
  max_trade_cards_per_order: number;
  discord_webhook_url: string;
}

interface Timeslot {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  max_bookings: number;
  bookings_this_week: number;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function AdminSettingsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const { logout } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState<PokeshopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('store');
  const { theme, setTheme } = useTheme();

  // Timeslot state
  const [timeslots, setTimeslots] = useState<Timeslot[]>([]);
  const [tsLoading, setTsLoading] = useState(true);
  const [newDay, setNewDay] = useState('0');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newMaxBookings, setNewMaxBookings] = useState('5');
  const [tsCreating, setTsCreating] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

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

  const handleSignOut = () => {
    logout();
    router.push('/login');
  };

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  const sidebarItems = [
    { key: 'store', label: 'Store Config', icon: Sliders },
    { key: 'timeslots', label: 'Timeslots', icon: Calendar },
    { key: 'preferences', label: 'Preferences', icon: Palette },
  ];

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900 min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-black text-gray-900 dark:text-zinc-100">Store Settings</h1>
        </div>

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
            {loading || !settings ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                {activeTab === 'store' && (
                  <div className="space-y-6">
                    {/* Trade Credit */}
                    <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-4">Trade-In Settings</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Trade Credit Percentage</label>
                          <div className="flex items-center gap-3">
                            <input type="number" min="0" max="100" step="0.01" value={settings.trade_credit_percentage} onChange={(e) => setSettings({ ...settings, trade_credit_percentage: parseFloat(e.target.value) || 0 })} className="w-32 p-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                            <span className="text-gray-600 font-medium">%</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Customers receive this percentage of their card&apos;s estimated value as trade credit.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Max Trade Cards Per Order</label>
                          <input type="number" min="1" max="20" value={settings.max_trade_cards_per_order} onChange={(e) => setSettings({ ...settings, max_trade_cards_per_order: parseInt(e.target.value) || 1 })} className="w-32 p-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                        </div>
                      </div>
                    </div>

                    {/* Announcement */}
                    <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-4">Store Announcement</h2>
                      <textarea value={settings.store_announcement} onChange={(e) => setSettings({ ...settings, store_announcement: e.target.value })} rows={3} className="w-full p-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" placeholder="Enter a store-wide announcement..." />
                      <p className="text-xs text-gray-500 mt-1">Leave empty to hide the announcement banner.</p>
                    </div>

                    {/* Discord */}
                    <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-4">Discord Notifications</h2>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Webhook URL</label>
                      <input type="url" value={settings.discord_webhook_url || ''} onChange={(e) => setSettings({ ...settings, discord_webhook_url: e.target.value })} className="w-full p-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="https://discord.com/api/webhooks/..." />
                      <p className="text-xs text-gray-500 mt-1">Paste a Discord webhook URL to receive notifications.</p>
                    </div>

                    <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50">
                      <Save size={18} />
                      {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                )}

                {activeTab === 'timeslots' && (
                  <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-blue-600" />
                      <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100">Weekly Pickup Timeslots</h2>
                    </div>

                    {/* Add new recurring timeslot */}
                    <div className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 mb-4">
                      <p className="text-sm font-semibold text-gray-700 mb-3">Create New Weekly Timeslot</p>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Day of Week</label>
                          <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="w-full p-2.5 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                            {DAY_NAMES.map((name, i) => (<option key={i} value={i}>{name}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Start Time</label>
                          <input type="time" value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} className="w-full p-2.5 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">End Time</label>
                          <input type="time" value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)} className="w-full p-2.5 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Max Bookings</label>
                          <input type="number" min="1" value={newMaxBookings} onChange={(e) => setNewMaxBookings(e.target.value)} className="w-full p-2.5 border border-gray-300 dark:border-zinc-700 rounded-lg text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!newStartTime || !newEndTime) { toast.error('Start and end times are required.'); return; }
                          setTsCreating(true);
                          try {
                            await axios.post('http://localhost:8000/api/inventory/recurring-timeslots/', {
                              day_of_week: parseInt(newDay), start_time: newStartTime, end_time: newEndTime, max_bookings: parseInt(newMaxBookings) || 5,
                            }, { headers });
                            toast.success('Weekly timeslot created!');
                            setNewDay('0'); setNewStartTime(''); setNewEndTime(''); setNewMaxBookings('5');
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
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    ) : timeslots.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">No weekly timeslots created yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {timeslots.map((ts) => (
                          <div key={ts.id} className={`flex items-center justify-between p-3 rounded-lg border ${ts.is_active ? 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700' : 'bg-red-50 border-red-200'}`}>
                            <div className="flex items-center gap-3">
                              <Clock size={16} className={ts.is_active ? 'text-blue-600' : 'text-red-500'} />
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{DAY_NAMES[ts.day_of_week]}</p>
                                <p className="text-xs text-gray-500">{ts.start_time.slice(0, 5)} – {ts.end_time.slice(0, 5)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-600">{ts.bookings_this_week}/{ts.max_bookings} this week</span>
                              <button
                                onClick={async () => {
                                  try {
                                    await axios.patch(`http://localhost:8000/api/inventory/recurring-timeslots/${ts.id}/`, { is_active: !ts.is_active }, { headers });
                                    fetchTimeslots();
                                    toast.success(ts.is_active ? 'Timeslot deactivated' : 'Timeslot activated');
                                  } catch { toast.error('Failed to update timeslot.'); }
                                }}
                                className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${ts.is_active ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
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
                                className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
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
              </>
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
  );
}
