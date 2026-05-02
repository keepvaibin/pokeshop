"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import ConfirmModal from '../../components/ConfirmModal';
import UnsavedChangesBar from '../../components/UnsavedChangesBar';
import { CheckCircle2, Save, Settings, Calendar, Plus, Trash2, Clock, LogOut, Sliders, MapPin, Link2, Link as LinkIcon, Unlink, Webhook, UserCircle, AlertTriangle, Ban, ToggleLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { startDiscordLink } from '../../lib/discord';
import PokemonIconPicker from '../../components/PokemonIconPicker';

interface PokeshopSettings {
  trade_credit_percentage: number;
  trade_cash_percentage: number;
  store_announcement: string;
  announcement_expires_at: string | null;
  show_footer_newsletter: boolean;
  max_trade_cards_per_order: number;
  discord_webhook_url: string;
  ucsc_discord_invite: string | null;
  public_discord_invite: string | null;
  pay_venmo_enabled: boolean;
  pay_zelle_enabled: boolean;
  pay_paypal_enabled: boolean;
  pay_cash_enabled: boolean;
  pay_trade_enabled: boolean;
  trade_ins_enabled: boolean;
  is_ooo: boolean;
  ooo_until: string | null;
  orders_disabled: boolean;
  standard_legal_marks: string[];
  standard_illegal_marks: string[];
  regulation_mark_options: string[];
  standard_legal_sets: string[];
  standard_illegal_sets: string[];
  tcg_set_options: string[];
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
  pickup_date: string;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_PICKUP_WINDOW_MINUTES = 30;
const PICKUP_TIME_INCREMENT_MINUTES = 15;
const CUSTOMER_PICKUP_EARLIEST_MINUTES = 8 * 60;
const CUSTOMER_PICKUP_LATEST_MINUTES = 22 * 60;

function formatTime12(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function formatPickupDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function pickupWindowMinutes(startTime: string, endTime: string): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

function isPickupWindowTooShort(startTime: string, endTime: string): boolean {
  return pickupWindowMinutes(startTime, endTime) < MIN_PICKUP_WINDOW_MINUTES;
}

function isPickupTimeOnIncrement(timeStr: string): boolean {
  return timeToMinutes(timeStr) % PICKUP_TIME_INCREMENT_MINUTES === 0;
}

function isPickupWindowOutsideCustomerHours(startTime: string, endTime: string): boolean {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  return startMinutes < CUSTOMER_PICKUP_EARLIEST_MINUTES || endMinutes > CUSTOMER_PICKUP_LATEST_MINUTES;
}

export default function AdminSettingsPage() {
  return (
    <Suspense>
      <AdminSettingsInner />
    </Suspense>
  );
}

function AdminSettingsInner() {
  const { user } = useRequireAuth({ adminOnly: true });
  const { logout, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<PokeshopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('store');
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false);
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);

  // Timeslot state
  const [timeslots, setTimeslots] = useState<Timeslot[]>([]);
  const [tsLoading, setTsLoading] = useState(true);
  const [newDay, setNewDay] = useState('0');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newMaxBookings, setNewMaxBookings] = useState('5');
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [tsCreating, setTsCreating] = useState(false);

  // OOO / Order-availability state (local working copy)
  const [isOoo, setIsOoo] = useState(false);
  const [oooUntil, setOooUntil] = useState('');
  const [ordersDisabled, setOrdersDisabled] = useState(false);
  // Snapshot of server state for dirty detection + cancel revert
  const savedOoo = useRef({ is_ooo: false, ooo_until: '', orders_disabled: false });
  const [oooSaving, setOooSaving] = useState(false);

  // Dirty detection for OOO section
  const oooIsDirty = isOoo !== savedOoo.current.is_ooo
    || oooUntil !== savedOoo.current.ooo_until
    || ordersDisabled !== savedOoo.current.orders_disabled;

  // Payment method toggle state (local working copy)
  const [payToggles, setPayToggles] = useState({ venmo: true, zelle: true, paypal: true, cash: true, trade: true });
  const savedPayToggles = useRef({ venmo: true, zelle: true, paypal: true, cash: true, trade: true });
  const [payToggleSaving, setPayToggleSaving] = useState(false);
  const payTogglesDirty = payToggles.venmo !== savedPayToggles.current.venmo
    || payToggles.zelle !== savedPayToggles.current.zelle
    || payToggles.paypal !== savedPayToggles.current.paypal
    || payToggles.cash !== savedPayToggles.current.cash
    || payToggles.trade !== savedPayToggles.current.trade;

  // Trade-in submissions toggle
  const [tradeInsEnabled, setTradeInsEnabled] = useState(true);
  const savedTradeInsEnabled = useRef(true);
  const [tradeInsSaving, setTradeInsSaving] = useState(false);
  const tradeInsDirty = tradeInsEnabled !== savedTradeInsEnabled.current;

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
      .get(`${API}/api/inventory/settings/`, { headers })
      .then((r) => {
        setSettings(r.data);
        // Sync OOO local state from server
        const s = r.data as PokeshopSettings;
        setIsOoo(!!s.is_ooo);
        setOooUntil(s.ooo_until || '');
        setOrdersDisabled(!!s.orders_disabled);
        savedOoo.current = { is_ooo: !!s.is_ooo, ooo_until: s.ooo_until || '', orders_disabled: !!s.orders_disabled };
        const pt = { venmo: s.pay_venmo_enabled !== false, zelle: s.pay_zelle_enabled !== false, paypal: s.pay_paypal_enabled !== false, cash: s.pay_cash_enabled !== false, trade: s.pay_trade_enabled !== false };
        setPayToggles(pt);
        savedPayToggles.current = { ...pt };
        const ti = s.trade_ins_enabled !== false;
        setTradeInsEnabled(ti);
        savedTradeInsEnabled.current = ti;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin, headers]);

  const fetchTimeslots = useCallback(() => {
    setTsLoading(true);
    axios
      .get(`${API}/api/inventory/recurring-timeslots/`, { headers })
      .then((r) => setTimeslots(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setTsLoading(false));
  }, [headers]);

  useEffect(() => {
    if (isAdmin) fetchTimeslots();
  }, [isAdmin, fetchTimeslots]);

  const resetTimeslotForm = useCallback(() => {
    setEditingSlotId(null);
    setNewDay('0');
    setNewStartTime('');
    setNewEndTime('');
    setNewLocation('');
    setNewMaxBookings('5');
  }, []);

  const handleEditTimeslot = useCallback((slot: Timeslot) => {
    setEditingSlotId(slot.id);
    setNewDay(String(slot.day_of_week));
    setNewStartTime(slot.start_time.slice(0, 5));
    setNewEndTime(slot.end_time.slice(0, 5));
    setNewLocation(slot.location || '');
    setNewMaxBookings(String(slot.max_bookings));
  }, []);

  const handleTimeslotSubmit = useCallback(async () => {
    if (!newStartTime || !newEndTime) {
      toast.error('Start and end times are required.');
      return;
    }

    const windowMinutes = pickupWindowMinutes(newStartTime, newEndTime);
    if (windowMinutes <= 0) {
      toast.error('End time must be after start time.');
      return;
    }
    if (windowMinutes < MIN_PICKUP_WINDOW_MINUTES) {
      toast.error(`Pickup windows must be at least ${MIN_PICKUP_WINDOW_MINUTES} minutes.`);
      return;
    }
    if (!isPickupTimeOnIncrement(newStartTime) || !isPickupTimeOnIncrement(newEndTime)) {
      toast.error(`Pickup times must use ${PICKUP_TIME_INCREMENT_MINUTES}-minute increments.`);
      return;
    }
    if (isPickupWindowOutsideCustomerHours(newStartTime, newEndTime)) {
      toast.error('Customer pickup windows must be between 8:00 AM and 10:00 PM.');
      return;
    }

    const maxBookings = parseInt(newMaxBookings, 10);
    if (!Number.isFinite(maxBookings) || maxBookings < 1) {
      toast.error('Max bookings must be at least 1.');
      return;
    }

    setTsCreating(true);
    try {
      const payload = {
        day_of_week: parseInt(newDay, 10),
        start_time: newStartTime,
        end_time: newEndTime,
        location: newLocation.trim(),
        max_bookings: maxBookings,
      };

      if (editingSlotId === null) {
        await axios.post(`${API}/api/inventory/recurring-timeslots/`, payload, { headers });
        toast.success('Weekly timeslot created!');
      } else {
        await axios.patch(`${API}/api/inventory/recurring-timeslots/${editingSlotId}/`, payload, { headers });
        toast.success('Weekly timeslot updated!');
      }

      resetTimeslotForm();
      fetchTimeslots();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const msgs = Object.values(err.response.data).flat().join(', ');
        toast.error(msgs || 'Failed to save timeslot.');
      } else {
        toast.error('Failed to save timeslot.');
      }
    } finally {
      setTsCreating(false);
    }
  }, [editingSlotId, fetchTimeslots, headers, newDay, newEndTime, newLocation, newMaxBookings, newStartTime, resetTimeslotForm]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await axios.patch(`${API}/api/inventory/settings/1/`, settings, { headers });
      setSettings(res.data);
      toast.success('Settings saved!');
    } catch {
      toast.error('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleOooSave = useCallback(async () => {
    setOooSaving(true);
    try {
      const payload: Partial<PokeshopSettings> = {
        is_ooo: isOoo,
        ooo_until: isOoo ? oooUntil || null : null,
        orders_disabled: ordersDisabled,
      };
      const res = await axios.patch(`${API}/api/inventory/settings/1/`, payload, { headers });
      const s = res.data as PokeshopSettings;
      setSettings(res.data);
      setIsOoo(!!s.is_ooo);
      setOooUntil(s.ooo_until || '');
      setOrdersDisabled(!!s.orders_disabled);
      savedOoo.current = { is_ooo: !!s.is_ooo, ooo_until: s.ooo_until || '', orders_disabled: !!s.orders_disabled };
      toast.success('Availability settings saved!');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const d = err.response.data;
        const msg = typeof d === 'string' ? d : Object.values(d).flat().join(', ');
        toast.error(msg || 'Failed to save availability settings.');
      } else {
        toast.error('Failed to save availability settings.');
      }
    } finally {
      setOooSaving(false);
    }
  }, [headers, isOoo, oooUntil, ordersDisabled]);

  const handleOooCancel = useCallback(() => {
    setIsOoo(savedOoo.current.is_ooo);
    setOooUntil(savedOoo.current.ooo_until);
    setOrdersDisabled(savedOoo.current.orders_disabled);
  }, []);

  const handlePayToggleSave = useCallback(async () => {
    setPayToggleSaving(true);
    try {
      const payload = {
        pay_venmo_enabled: payToggles.venmo,
        pay_zelle_enabled: payToggles.zelle,
        pay_paypal_enabled: payToggles.paypal,
        pay_cash_enabled: payToggles.cash,
        pay_trade_enabled: payToggles.trade,
      };
      const res = await axios.patch(`${API}/api/inventory/settings/1/`, payload, { headers });
      const s = res.data as PokeshopSettings;
      setSettings(res.data);
      const pt = { venmo: s.pay_venmo_enabled !== false, zelle: s.pay_zelle_enabled !== false, paypal: s.pay_paypal_enabled !== false, cash: s.pay_cash_enabled !== false, trade: s.pay_trade_enabled !== false };
      setPayToggles(pt);
      savedPayToggles.current = { ...pt };
      toast.success('Payment method settings saved!');
    } catch {
      toast.error('Failed to save payment method settings.');
    } finally {
      setPayToggleSaving(false);
    }
  }, [headers, payToggles]);

  const handlePayToggleCancel = useCallback(() => {
    setPayToggles({ ...savedPayToggles.current });
  }, []);

  const handleTradeInsSave = useCallback(async () => {
    setTradeInsSaving(true);
    try {
      const res = await axios.patch(`${API}/api/inventory/settings/1/`, { trade_ins_enabled: tradeInsEnabled }, { headers });
      const ti = (res.data as PokeshopSettings).trade_ins_enabled !== false;
      setTradeInsEnabled(ti);
      savedTradeInsEnabled.current = ti;
      toast.success('Trade-in settings saved!');
    } catch {
      toast.error('Failed to save trade-in settings.');
    } finally {
      setTradeInsSaving(false);
    }
  }, [headers, tradeInsEnabled]);

  const handleTradeInsCancel = useCallback(() => {
    setTradeInsEnabled(savedTradeInsEnabled.current);
  }, []);

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

  const handleDiscordUnlink = async () => {
    if (!token) {
      toast.error('Please sign in again before unlinking Discord.');
      return;
    }

    setUnlinkingDiscord(true);
    try {
      await axios.patch(`${API}/api/auth/profile/`, {
        disconnect_discord: true,
      }, {
        headers,
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

  const inputClass = 'w-full border border-pkmn-border bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-pkmn-gray focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/15';
  const sectionClass = 'bg-white border border-pkmn-border p-6 shadow-sm';
  const isLinked = Boolean(user?.discord_id);
  const regulationMarkOptions = useMemo(() => {
    const marks = new Set([...(settings?.regulation_mark_options || []), 'G', 'H', 'I', 'J'].map(mark => mark.trim().toUpperCase()).filter(Boolean));
    return Array.from(marks).sort();
  }, [settings?.regulation_mark_options]);
  const markLegalityState = useCallback((mark: string) => {
    const key = mark.trim().toUpperCase();
    if ((settings?.standard_illegal_marks || []).some(value => value.trim().toUpperCase() === key)) return 'illegal';
    if ((settings?.standard_legal_marks || []).some(value => value.trim().toUpperCase() === key)) return 'legal';
    return 'default';
  }, [settings?.standard_illegal_marks, settings?.standard_legal_marks]);
  const updateMarkLegality = useCallback((mark: string, nextState: 'legal' | 'illegal' | 'default') => {
    const key = mark.trim().toUpperCase();
    setSettings(previous => {
      if (!previous) return previous;
      const legalMarks = (previous.standard_legal_marks || []).filter(value => value.trim().toUpperCase() !== key);
      const illegalMarks = (previous.standard_illegal_marks || []).filter(value => value.trim().toUpperCase() !== key);
      if (nextState === 'legal') legalMarks.push(key);
      if (nextState === 'illegal') illegalMarks.push(key);
      return { ...previous, standard_legal_marks: legalMarks, standard_illegal_marks: illegalMarks };
    });
  }, []);

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
    { key: 'toggles', label: 'Enable / Disable', icon: ToggleLeft },
    { key: 'timeslots', label: 'Timeslots', icon: Calendar },
    { key: 'profile', label: 'My Profile', icon: UserCircle },
  ];

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-8 h-8 text-pkmn-blue" />
          <h1 className="text-3xl font-black text-pkmn-text">Store Settings</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="md:col-span-1">
            <div className="bg-white border border-pkmn-border p-2 md:p-3 md:sticky md:top-24 flex flex-col gap-3 h-full">
              <nav className="flex md:flex-col flex-row overflow-x-auto md:overflow-x-visible gap-1">
              {sidebarItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
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
                  className="w-full flex items-center justify-center gap-2 border border-pkmn-red/20 text-pkmn-red py-2.5 text-sm font-medium hover:bg-pkmn-red/10 transition-colors"
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
                    <div className={sectionClass}>
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Trade-In Settings</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Trade Credit Percentage</label>
                          <div className="flex items-center gap-3">
                            <input type="number" min="0" max="100" step="0.01" value={settings.trade_credit_percentage} onChange={(e) => setSettings({ ...settings, trade_credit_percentage: parseFloat(e.target.value) || 0 })} className={`${inputClass} w-32`} />
                            <span className="text-pkmn-gray font-medium">%</span>
                          </div>
                          <p className="text-xs text-pkmn-gray mt-1">Customers receive this percentage of their card&apos;s estimated value as trade credit.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Cash Trade Percentage</label>
                          <div className="flex items-center gap-3">
                            <input type="number" min="0" max="100" step="0.01" value={settings.trade_cash_percentage} onChange={(e) => setSettings({ ...settings, trade_cash_percentage: parseFloat(e.target.value) || 0 })} className={`${inputClass} w-32`} />
                            <span className="text-pkmn-gray font-medium">%</span>
                          </div>
                          <p className="text-xs text-pkmn-gray mt-1">Customers choosing cash receive this percentage of their card&apos;s estimated value.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Max Trade Cards Per Order</label>
                          <input type="number" min="1" max="20" value={settings.max_trade_cards_per_order} onChange={(e) => setSettings({ ...settings, max_trade_cards_per_order: parseInt(e.target.value) || 1 })} className={`${inputClass} w-32`} />
                        </div>
                      </div>
                    </div>

                    <div className={sectionClass}>
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Store Announcement</h2>
                      <textarea value={settings.store_announcement} onChange={(e) => setSettings({ ...settings, store_announcement: e.target.value })} rows={3} className={`${inputClass} resize-none`} placeholder="Enter a store-wide announcement..." />
                      <p className="text-xs text-pkmn-gray mt-1">Leave empty to hide the announcement banner.</p>
                      {settings.store_announcement.trim() && (
                        <div className="mt-3">
                          <label className="block text-sm font-semibold text-pkmn-text mb-1">Expires on</label>
                          <input
                            type="datetime-local"
                            value={settings.announcement_expires_at ?? ''}
                            onChange={(e) => setSettings({ ...settings, announcement_expires_at: e.target.value || null })}
                            className={`${inputClass} w-64`}
                          />
                          <p className="text-xs text-pkmn-gray mt-1">Banner will auto-clear after this date. Leave empty for no expiration.</p>
                        </div>
                      )}
                    </div>

                    <div className={sectionClass}>
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-lg font-bold text-pkmn-text">Standard Format Regulation Marks</h2>
                          <p className="mt-1 text-sm text-pkmn-gray">Choose the regulation letters that count as Standard legal for storefront playability.</p>
                        </div>
                        <div className="flex gap-2 text-xs font-heading font-bold uppercase">
                          <span className="bg-green-500/10 px-3 py-1.5 text-green-700">{settings.standard_legal_marks?.join(', ') || 'None'} Legal</span>
                          <span className="bg-pkmn-red/10 px-3 py-1.5 text-pkmn-red">{settings.standard_illegal_marks?.join(', ') || 'None'} Not Legal</span>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {regulationMarkOptions.map((mark) => {
                          const state = markLegalityState(mark);
                          return (
                            <div key={mark} className="border border-pkmn-border bg-pkmn-bg p-3">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="font-heading text-xl font-black text-pkmn-text">{mark}</p>
                                <span className={`px-2 py-1 text-[10px] font-heading font-bold uppercase ${state === 'legal' ? 'bg-green-500/10 text-green-700' : state === 'illegal' ? 'bg-pkmn-red/10 text-pkmn-red' : 'bg-white text-pkmn-gray-dark'}`}>
                                  {state === 'default' ? 'Card Mark' : state === 'legal' ? 'Legal' : 'Not Legal'}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 overflow-hidden border border-pkmn-border bg-white text-xs font-heading font-bold uppercase">
                                <button
                                  type="button"
                                  onClick={() => updateMarkLegality(mark, 'legal')}
                                  className={`px-3 py-2 transition-colors ${state === 'legal' ? 'bg-green-600 text-white' : 'bg-white text-pkmn-gray-dark hover:bg-green-50 hover:text-green-700'}`}
                                >
                                  Legal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateMarkLegality(mark, 'illegal')}
                                  className={`border-x border-pkmn-border px-3 py-2 transition-colors ${state === 'illegal' ? 'bg-pkmn-red text-white' : 'bg-white text-pkmn-gray-dark hover:bg-pkmn-red/5 hover:text-pkmn-red'}`}
                                >
                                  Not Legal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateMarkLegality(mark, 'default')}
                                  className={`px-3 py-2 transition-colors ${state === 'default' ? 'bg-pkmn-blue text-white' : 'bg-white text-pkmn-gray-dark hover:bg-pkmn-blue/5 hover:text-pkmn-blue'}`}
                                >
                                  Card Mark
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className={sectionClass}>
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Footer Signup Block</h2>
                      <button
                        type="button"
                        onClick={async () => {
                          const newVal = !settings.show_footer_newsletter;
                          setSettings({ ...settings, show_footer_newsletter: newVal });
                          try {
                            await axios.patch(`${API}/api/inventory/settings/1/`, { show_footer_newsletter: newVal }, { headers });
                            toast.success(newVal ? 'Footer signup visible' : 'Footer signup hidden');
                          } catch {
                            setSettings({ ...settings, show_footer_newsletter: !newVal });
                            toast.error('Failed to update footer setting.');
                          }
                        }}
                        className="w-full flex items-center justify-between gap-4 border border-pkmn-border bg-pkmn-bg px-4 py-4 text-left transition-colors hover:border-pkmn-blue"
                      >
                        <div>
                          <p className="text-sm font-semibold text-pkmn-text">Show the footer signup section</p>
                          <p className="mt-1 text-xs text-pkmn-gray">Controls the email signup block above the main footer links.</p>
                        </div>
                        <span className={`inline-flex min-w-[5.5rem] items-center justify-center px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-[0.08rem] ${settings.show_footer_newsletter ? 'bg-green-500/15 text-green-600' : 'bg-pkmn-red/10 text-pkmn-red'}`}>
                          {settings.show_footer_newsletter ? 'Visible' : 'Hidden'}
                        </span>
                      </button>
                    </div>

                    <div className={sectionClass}>
                      <h2 className="text-lg font-bold text-pkmn-text mb-4">Discord Account</h2>
                      <div className="border border-pkmn-border bg-[#f8fbff] p-5">
                        {isLinked ? (
                          <>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="inline-flex items-center gap-2 border border-green-200 bg-green-50 px-4 py-3 text-sm font-heading font-bold text-green-700">
                                <CheckCircle2 className="w-4 h-4" />
                                Discord Linked
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowUnlinkModal(true)}
                                className="inline-flex items-center gap-1.5 border border-red-200 bg-red-50 px-3 py-2 text-xs font-heading font-bold text-red-600 transition-colors hover:bg-red-100"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                                Unlink
                              </button>
                            </div>
                            <p className="mt-3 text-sm font-semibold text-pkmn-text">Your admin account is linked to Discord.</p>
                            <p className="mt-2 text-sm text-pkmn-gray">
                              Connected as {user?.discord_handle || 'Discord account'}{user?.discord_id ? ` (${user.discord_id})` : ''}.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-pkmn-text">Link your admin account to unlock the Discord bot workflow.</p>
                            <p className="mt-2 text-sm text-pkmn-gray">
                              Use the secure Discord OAuth flow to connect the real Discord account behind this admin profile.
                            </p>
                            {user?.discord_handle && (
                              <p className="mt-2 text-xs text-pkmn-gray">
                                Existing typed handle: {user.discord_handle}
                              </p>
                            )}

                            <button
                              type="button"
                              onClick={handleDiscordLink}
                              disabled={linkingDiscord}
                              className="mt-5 inline-flex w-full sm:w-auto items-center justify-center gap-2 bg-pkmn-blue px-6 py-3 text-sm font-heading font-bold text-white transition-colors hover:bg-pkmn-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Link2 className="w-4 h-4" />
                              {linkingDiscord ? 'Opening Discord...' : 'Link Discord Account'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className={sectionClass}>
                      <div className="flex items-center gap-2 mb-4">
                        <LinkIcon className="w-5 h-5 text-pkmn-blue" />
                        <h2 className="text-lg font-bold text-pkmn-text">Discord Server Invites</h2>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">UCSC Server Invite URL</label>
                          <input
                            type="url"
                            value={settings.ucsc_discord_invite || ''}
                            onChange={(e) => setSettings({ ...settings, ucsc_discord_invite: e.target.value || null })}
                            className={inputClass}
                            placeholder="https://discord.gg/ucsc-slugs"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Public Server Invite URL</label>
                          <input
                            type="url"
                            value={settings.public_discord_invite || ''}
                            onChange={(e) => setSettings({ ...settings, public_discord_invite: e.target.value || null })}
                            className={inputClass}
                            placeholder="https://discord.gg/public-sctcg"
                          />
                        </div>
                      </div>
                    </div>

                    <div className={sectionClass}>
                      <div className="flex items-center gap-2 mb-4">
                        <Webhook className="w-5 h-5 text-pkmn-blue" />
                        <h2 className="text-lg font-bold text-pkmn-text">Discord Notifications</h2>
                      </div>
                      <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Audit Webhook URL</label>
                      <input type="url" value={settings.discord_webhook_url || ''} onChange={(e) => setSettings({ ...settings, discord_webhook_url: e.target.value })} className={inputClass} placeholder="https://discord.com/api/webhooks/..." />
                      <p className="text-xs text-pkmn-gray mt-1">Paste the Discord webhook URL used for high-level admin audit alerts.</p>
                    </div>

                    <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 bg-pkmn-blue px-6 py-3 text-sm font-heading font-bold text-white transition-colors hover:bg-pkmn-blue-dark disabled:opacity-50">
                      <Save size={18} />
                      {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                )}

                {activeTab === 'toggles' && (
                  <div className="space-y-6">
                    <div className={sectionClass}>
                      <h2 className="text-lg font-bold text-pkmn-text mb-2">Payment Methods</h2>
                      <p className="text-sm text-pkmn-gray mb-5">Toggle which payment options customers see at checkout. Click a card to enable or disable it.</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {([
                          { key: 'venmo' as const, label: 'Venmo', activeBg: 'bg-[#008CFF]/10', activeBorder: 'border-[#008CFF]', activeText: 'text-[#008CFF]' },
                          { key: 'zelle' as const, label: 'Zelle', activeBg: 'bg-[#6D1ED4]/10', activeBorder: 'border-[#6D1ED4]', activeText: 'text-[#6D1ED4]' },
                          { key: 'paypal' as const, label: 'PayPal', activeBg: 'bg-[#003087]/10', activeBorder: 'border-[#003087]', activeText: 'text-[#003087]' },
                          { key: 'cash' as const, label: 'Cash', activeBg: 'bg-green-500/10', activeBorder: 'border-green-500', activeText: 'text-green-600' },
                          { key: 'trade' as const, label: 'Trade-In', activeBg: 'bg-amber-500/10', activeBorder: 'border-amber-500', activeText: 'text-amber-600' },
                        ]).map((pm) => {
                          const active = payToggles[pm.key];
                          return (
                            <button
                              key={pm.key}
                              type="button"
                              onClick={() => setPayToggles(prev => ({ ...prev, [pm.key]: !prev[pm.key] }))}
                              className={`p-4 border-2 text-center font-heading font-bold transition-all duration-[120ms] ease-out ${
                                active
                                  ? `${pm.activeBg} ${pm.activeBorder} ${pm.activeText}`
                                  : 'bg-gray-100 border-gray-200 text-gray-400'
                              }`}
                            >
                              <p className="text-sm">{pm.label}</p>
                              <p className={`text-[10px] mt-1 font-medium uppercase tracking-wider ${active ? 'opacity-70' : 'opacity-50'}`}>
                                {active ? 'Enabled' : 'Disabled'}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <UnsavedChangesBar
                      show={payTogglesDirty}
                      saving={payToggleSaving}
                      onSave={handlePayToggleSave}
                      onCancel={handlePayToggleCancel}
                    />

                    {/* Trade-In Submissions */}
                    <div className={sectionClass}>
                      <h2 className="text-lg font-bold text-pkmn-text mb-2">Trade-In Submissions</h2>
                      <p className="text-sm text-pkmn-gray mb-5">
                        When disabled, customers cannot submit new trade-in requests. Existing requests and wallet balances are unaffected.
                      </p>
                      <button
                        type="button"
                        onClick={() => setTradeInsEnabled(prev => !prev)}
                        className={`p-4 border-2 text-center font-heading font-bold w-40 transition-all duration-[120ms] ease-out ${
                          tradeInsEnabled
                            ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue'
                            : 'bg-gray-100 border-gray-200 text-gray-400'
                        }`}
                      >
                        <p className="text-sm">Trade-Ins</p>
                        <p className={`text-[10px] mt-1 font-medium uppercase tracking-wider ${tradeInsEnabled ? 'opacity-70' : 'opacity-50'}`}>
                          {tradeInsEnabled ? 'Open' : 'Closed'}
                        </p>
                      </button>
                    </div>

                    <UnsavedChangesBar
                      show={tradeInsDirty}
                      saving={tradeInsSaving}
                      onSave={handleTradeInsSave}
                      onCancel={handleTradeInsCancel}
                    />
                  </div>
                )}

                {activeTab === 'timeslots' && (
                  <div className="space-y-6">
                    {/* Weekly Pickup Timeslots */}
                    <div className={`bg-white border border-pkmn-border p-6 shadow-sm ${ordersDisabled || isOoo ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-pkmn-blue" />
                      <h2 className="text-lg font-bold text-pkmn-text">Weekly Pickup Timeslots</h2>
                    </div>
                    <p className="mb-4 text-sm text-pkmn-gray">
                      These are weekly templates. Checkout shows the next customer-eligible pickup date for each template.
                    </p>

                    {/* Add new recurring timeslot */}
                    <div className="bg-pkmn-bg border border-pkmn-border rounded-md p-4 mb-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-pkmn-gray-dark">{editingSlotId === null ? 'Create New Weekly Timeslot' : 'Edit Weekly Timeslot'}</p>
                        {editingSlotId !== null && (
                          <button
                            type="button"
                            onClick={resetTimeslotForm}
                            className="text-xs font-semibold text-pkmn-gray transition-colors hover:text-pkmn-text"
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Day of Week</label>
                          <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-md text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200">
                            {DAY_NAMES.map((name, i) => (<option key={i} value={i}>{name}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Start Time</label>
                          <input type="time" min="08:00" max="22:00" step={PICKUP_TIME_INCREMENT_MINUTES * 60} value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-md text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">End Time</label>
                          <input type="time" min="08:00" max="22:00" step={PICKUP_TIME_INCREMENT_MINUTES * 60} value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-md text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Location</label>
                          <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Crown courtyard" className="w-full p-2.5 border border-pkmn-border rounded-md text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-pkmn-gray mb-1">Max Bookings</label>
                          <input type="number" min="1" value={newMaxBookings} onChange={(e) => setNewMaxBookings(e.target.value)} className="w-full p-2.5 border border-pkmn-border rounded-md text-pkmn-text bg-white text-sm focus:ring-2 focus:ring-pkmn-blue focus:border-transparent" />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleTimeslotSubmit}
                          disabled={tsCreating}
                          className="flex items-center gap-2 rounded-md bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-green-700 active:scale-95 disabled:opacity-50"
                        >
                          <Plus size={16} />
                          {tsCreating ? (editingSlotId === null ? 'Creating...' : 'Saving...') : (editingSlotId === null ? 'Add Weekly Timeslot' : 'Save Changes')}
                        </button>
                        {editingSlotId !== null && (
                          <button
                            type="button"
                            onClick={resetTimeslotForm}
                            disabled={tsCreating}
                            className="rounded-md border border-pkmn-border px-4 py-2.5 text-sm font-semibold text-pkmn-text transition-colors hover:bg-white disabled:opacity-50"
                          >
                            Clear Form
                          </button>
                        )}
                      </div>
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
                        {timeslots.map((ts) => {
                          const tooShort = isPickupWindowTooShort(ts.start_time, ts.end_time);
                          const offIncrement = !isPickupTimeOnIncrement(ts.start_time) || !isPickupTimeOnIncrement(ts.end_time);
                          const outsideCustomerHours = isPickupWindowOutsideCustomerHours(ts.start_time, ts.end_time);
                          const hasProblem = !ts.is_active || tooShort || offIncrement || outsideCustomerHours;
                          const cannotActivate = !ts.is_active && (tooShort || offIncrement || outsideCustomerHours);

                          return (
                          <div key={ts.id} className={`flex items-center justify-between p-3 rounded-md border ${hasProblem ? 'bg-pkmn-red/10 border-pkmn-red/20' : 'bg-white border-pkmn-border'}`}>
                            <div className="flex items-center gap-3">
                              <Clock size={16} className={hasProblem ? 'text-pkmn-red' : 'text-pkmn-blue'} />
                              <div>
                                <p className="text-sm font-medium text-pkmn-text">{DAY_NAMES[ts.day_of_week]}</p>
                                <p className="text-xs font-semibold uppercase tracking-[0.05rem] text-pkmn-blue">
                                  Next pickup: {formatPickupDate(ts.pickup_date)}
                                </p>
                                <p className="text-xs text-pkmn-gray">{formatTime12(ts.start_time)} - {formatTime12(ts.end_time)}</p>
                                {tooShort && (
                                  <p className="mt-1 text-xs font-semibold text-pkmn-red">
                                    Too short; edit to at least {MIN_PICKUP_WINDOW_MINUTES} minutes.
                                  </p>
                                )}
                                {offIncrement && (
                                  <p className="mt-1 text-xs font-semibold text-pkmn-red">
                                    Use {PICKUP_TIME_INCREMENT_MINUTES}-minute increments.
                                  </p>
                                )}
                                {outsideCustomerHours && (
                                  <p className="mt-1 text-xs font-semibold text-pkmn-red">
                                    Customer pickup must be between 8:00 AM and 10:00 PM.
                                  </p>
                                )}
                                {ts.location && (
                                  <p className="mt-1 flex items-center gap-1 text-xs text-pkmn-gray">
                                    <MapPin size={12} /> {ts.location}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-pkmn-gray">{ts.bookings_this_week}/{ts.max_bookings} booked</span>
                              <button
                                type="button"
                                onClick={() => handleEditTimeslot(ts)}
                                className="text-xs font-semibold text-pkmn-blue transition-colors hover:text-pkmn-blue-dark"
                              >
                                Edit
                              </button>
                              <button
                                onClick={async () => {
                                  if (cannotActivate) {
                                    toast.error('Fix this slot before activating it.');
                                    return;
                                  }
                                  try {
                                    await axios.patch(`${API}/api/inventory/recurring-timeslots/${ts.id}/`, { is_active: !ts.is_active }, { headers });
                                    fetchTimeslots();
                                    toast.success(ts.is_active ? 'Timeslot deactivated' : 'Timeslot activated');
                                  } catch { toast.error('Failed to update timeslot.'); }
                                }}
                                disabled={cannotActivate}
                                className={`text-xs font-semibold px-3 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ts.is_active ? 'bg-orange-500/15 text-orange-600 hover:bg-orange-500/20' : 'bg-green-500/15 text-green-600 hover:bg-green-500/20'}`}
                              >
                                {ts.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    if (editingSlotId === ts.id) {
                                      resetTimeslotForm();
                                    }
                                    await axios.delete(`${API}/api/inventory/recurring-timeslots/${ts.id}/`, { headers });
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
                          );
                        })}
                      </div>
                    )}
                    </div>

                    {/* Out of Office */}
                    <div className={`bg-white border p-6 shadow-sm ${ordersDisabled ? 'border-pkmn-border opacity-50 pointer-events-none' : isOoo ? 'border-orange-400' : 'border-pkmn-border'}`}>
                      <div className="flex items-center gap-2 mb-4">
                        <AlertTriangle className={`w-5 h-5 ${isOoo ? 'text-orange-500' : 'text-pkmn-gray'}`} />
                        <h2 className="text-lg font-bold text-pkmn-text">Out of Office</h2>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!isOoo) {
                            setIsOoo(true);
                            setOrdersDisabled(false);
                          } else {
                            setIsOoo(false);
                            setOooUntil('');
                          }
                        }}
                        className="w-full flex items-center justify-between gap-4 border border-pkmn-border bg-pkmn-bg px-4 py-4 text-left transition-colors hover:border-pkmn-blue"
                      >
                        <div>
                          <p className="text-sm font-semibold text-pkmn-text">Enable Out of Office</p>
                          <p className="mt-1 text-xs text-pkmn-gray">
                            ASAP pickup will be hidden. Scheduled pickups will only show dates after your return.
                          </p>
                        </div>
                        <span className={`inline-flex min-w-[4.5rem] items-center justify-center px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-[0.08rem] ${isOoo ? 'bg-orange-500/15 text-orange-600' : 'bg-pkmn-bg text-pkmn-gray border border-pkmn-border'}`}>
                          {isOoo ? 'ON' : 'OFF'}
                        </span>
                      </button>

                      {isOoo && (
                        <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-4">
                          <label className="block text-sm font-semibold text-orange-800 mb-2">Out until (return date)</label>
                          <input
                            type="date"
                            value={oooUntil}
                            onChange={(e) => setOooUntil(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full max-w-xs rounded-md border border-orange-300 bg-white px-3 py-2 text-sm text-pkmn-text focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                          />
                          <p className="mt-2 text-xs text-orange-700">
                            Customers will only see pickup timeslots for days after this date.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Disable Orders */}
                    <div className={`bg-white border p-6 shadow-sm ${isOoo ? 'border-pkmn-border opacity-50 pointer-events-none' : ordersDisabled ? 'border-pkmn-red' : 'border-pkmn-border'}`}>
                      <div className="flex items-center gap-2 mb-4">
                        <Ban className={`w-5 h-5 ${ordersDisabled ? 'text-pkmn-red' : 'text-pkmn-gray'}`} />
                        <h2 className="text-lg font-bold text-pkmn-text">Disable Orders</h2>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!ordersDisabled) {
                            setOrdersDisabled(true);
                            setIsOoo(false);
                            setOooUntil('');
                          } else {
                            setOrdersDisabled(false);
                          }
                        }}
                        className="w-full flex items-center justify-between gap-4 border border-pkmn-border bg-pkmn-bg px-4 py-4 text-left transition-colors hover:border-pkmn-blue"
                      >
                        <div>
                          <p className="text-sm font-semibold text-pkmn-text">Disable all orders (indefinite)</p>
                          <p className="mt-1 text-xs text-pkmn-gray">
                            Both ASAP and scheduled pickups will be hidden. Customers will see a &quot;not accepting orders&quot; message.
                          </p>
                        </div>
                        <span className={`inline-flex min-w-[4.5rem] items-center justify-center px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-[0.08rem] ${ordersDisabled ? 'bg-pkmn-red/15 text-pkmn-red' : 'bg-pkmn-bg text-pkmn-gray border border-pkmn-border'}`}>
                          {ordersDisabled ? 'ON' : 'OFF'}
                        </span>
                      </button>

                      {ordersDisabled && (
                        <div className="mt-4 rounded-md border border-pkmn-red/20 bg-pkmn-red/5 p-4">
                          <p className="text-sm font-semibold text-pkmn-red">Not accepting orders for now.</p>
                          <p className="mt-1 text-xs text-pkmn-red/80">
                            Customers will not be able to place any orders until this is turned off.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Unsaved Changes Bar */}
                    <UnsavedChangesBar
                      show={oooIsDirty}
                      saving={oooSaving}
                      onSave={handleOooSave}
                      onCancel={handleOooCancel}
                    />
                  </div>
                )}


                {activeTab === 'profile' && (
                  <div className="space-y-6">
                    <div className={sectionClass}>
                      <div className="flex items-center gap-2 mb-4">
                        <UserCircle className="h-5 w-5 text-pkmn-blue" />
                        <h2 className="text-lg font-bold text-pkmn-text">Pokémon Icon</h2>
                      </div>
                      <p className="text-sm text-pkmn-gray mb-4">Choose a Pokémon to represent you in the navbar and on receipts.</p>
                      <PokemonIconPicker
                        currentIcon={user?.pokemon_icon || null}
                        onSelect={async (filename, iconId) => {
                          try {
                            await axios.patch(`${API}/api/auth/profile/`, { pokemon_icon_id: iconId ?? null }, { headers });
                            await refreshUser();
                            toast.success(filename ? 'Icon updated' : 'Icon removed');
                          } catch {
                            toast.error('Failed to update icon.');
                          }
                        }}
                      />
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
            className="w-full flex items-center justify-center gap-2 border border-pkmn-red/20 text-pkmn-red rounded-md py-2.5 text-sm font-medium hover:bg-pkmn-red/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
      <ConfirmModal
        open={showUnlinkModal}
        title="Unlink Discord account?"
        description="This will disconnect the Discord account from this admin profile. You can link it again later through Discord OAuth."
        confirmLabel="Yes, unlink"
        confirmDisabled={unlinkingDiscord}
        onConfirm={handleDiscordUnlink}
        onClose={() => setShowUnlinkModal(false)}
      />
    </div>
  );
}
