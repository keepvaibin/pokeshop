"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { CheckCircle, XCircle, AlertCircle, Ban, Search, Filter, ThumbsUp, Star, ChevronDown, MoreVertical, ExternalLink, MessageSquare, Package, Send, Clock, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import PickupTimeslotSelector, { type TimeslotSelection } from '../../components/PickupTimeslotSelector';

interface TradeCardItem {
  id: number;
  card_name: string;
  estimated_value: string;
  condition: string;
  rarity: string;
  is_wanted_card: boolean;
  approved: boolean | null;
  is_accepted: boolean | null;
  tcg_product_id: number | null;
  tcg_sub_type: string;
  base_market_price: string | null;
  image_url: string;
  tcgplayer_url: string;
  custom_price: string | null;
  admin_override_value: string | null;
}

interface TradeOffer {
  id: number;
  total_credit: string;
  credit_percentage: string;
  trade_mode?: string;
  cards: TradeCardItem[];
}

interface OrderItemDetail {
  id: number;
  item_title: string;
  item_price: string;
  quantity: number;
  price_at_purchase: string;
}

interface Order {
  id: number;
  order_id: string;
  item_title: string;
  item_price: string;
  quantity: number;
  order_items?: OrderItemDetail[];
  user_email: string;
  user: number;
  discord_handle: string;
  payment_method: string;
  delivery_method: string;
  status: string;
  buy_if_trade_denied: boolean;
  trade_card_name?: string;
  trade_card_value?: string;
  trade_offer?: TradeOffer;
  preferred_pickup_time?: string;
  pickup_timeslot?: string | null;
  recurring_timeslot?: string | null;
  delivery_details?: string | null;
  is_acknowledged: boolean;
  created_at: string;
  pickup_date?: string | null;
  pickup_rescheduled_by_user?: boolean;
}

function orderItemsLabel(order: Order): string {
  return (order.order_items ?? []).map(oi => `${oi.item_title} x${oi.quantity}`).join(', ');
}

function orderSalePrice(order: Order): number {
  return (order.order_items ?? []).reduce((sum, oi) => sum + Number(oi.price_at_purchase) * oi.quantity, 0);
}

export default function AdminDispatch() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ orderId: number; action: string; label: string } | null>(null);
  const [cardDecisions, setCardDecisions] = useState<Record<number, Record<string, 'accept' | 'reject'>>>({});
  const [cardOverrides, setCardOverrides] = useState<Record<number, Record<string, string>>>({});
  const [counterofferMsg, setCounterofferMsg] = useState<Record<number, string>>({});
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'TRADES' | 'FULFILLMENT' | 'OVERDUE'>('FULFILLMENT');
  const [expandedSlots, setExpandedSlots] = useState<Record<string, boolean>>({});
  const [actionMenu, setActionMenu] = useState<number | null>(null);
  const [overdueOrders, setOverdueOrders] = useState<Order[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(false);
  const [rescheduleOrderId, setRescheduleOrderId] = useState<number | null>(null);
  const [rescheduleTimeslot, setRescheduleTimeslot] = useState<TimeslotSelection | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const fetchOrders = (signal?: AbortSignal) => {
    if (!isAdmin) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (paymentFilter) params.set('payment_method', paymentFilter);
    if (searchQuery) params.set('search', searchQuery);
    axios.get(`${API}/api/orders/dispatch/?${params.toString()}`, { headers, signal })
      .then(r => { if (!signal?.aborted) setOrders(r.data.results ?? r.data); })
      .catch(() => { /* network errors handled by empty state */ })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchOrders(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, statusFilter, paymentFilter]);

  const handleSearch = () => fetchOrders();

  // Fetch overdue orders
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    setOverdueLoading(true);
    axios.get(`${API}/api/orders/overdue/`, { headers, signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setOverdueOrders(r.data.results ?? r.data); })
      .catch(() => { /* handled by empty state */ })
      .finally(() => { if (!controller.signal.aborted) setOverdueLoading(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Close action menu on outside click
  useEffect(() => {
    if (actionMenu === null) return;
    const close = () => setActionMenu(null);
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [actionMenu]);

  const handleAction = async (orderId: number, action: string) => {
    setIsProcessing(orderId);
    try {
      const res = await axios.post(`${API}/api/orders/dispatch/`, { order_id: orderId, action }, { headers });
      const updated = res.data;
      // Remove from list if it left the active statuses
      if (['fulfilled', 'cancelled'].includes(updated.status)) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
      }
      const labels: Record<string, string> = {
        fulfill: 'fulfilled',
        cancel: 'cancelled',
        deny_trade: 'trade denied',
        approve_trade: 'trade approved',
        acknowledge_asap: 'acknowledged and moved into dispatch handling',
      };
      toast.success(`Order ${labels[action] || action} successfully`);
    } catch {
      toast.error('Failed to process order.');
    } finally {
      setIsProcessing(null);
    }
  };

  const handlePartialTradeReview = async (orderId: number) => {
    const decisions = cardDecisions[orderId];
    if (!decisions || Object.keys(decisions).length === 0) {
      toast.error('Please accept or reject at least one card.');
      return;
    }
    setIsProcessing(orderId);
    try {
      // Build nested card_decisions: { cardId: { decision, overridden_value } }
      const overrides = cardOverrides[orderId] || {};
      const nestedDecisions: Record<string, { decision: string; overridden_value: number | null }> = {};
      for (const [cardId, decision] of Object.entries(decisions)) {
        const overrideStr = overrides[cardId];
        nestedDecisions[cardId] = {
          decision,
          overridden_value: (decision === 'accept' && overrideStr !== undefined && overrideStr !== '')
            ? parseFloat(overrideStr)
            : null,
        };
      }
      const res = await axios.post(`${API}/api/orders/dispatch/`, {
        order_id: orderId,
        action: 'review_partial_trade',
        card_decisions: nestedDecisions,
      }, { headers });
      const updated = res.data;
      if (['fulfilled', 'cancelled'].includes(updated.status)) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
      }
      setCardDecisions(prev => { const copy = { ...prev }; delete copy[orderId]; return copy; });
      setCardOverrides(prev => { const copy = { ...prev }; delete copy[orderId]; return copy; });
      toast.success('Partial trade reviewed successfully');
    } catch {
      toast.error('Failed to review partial trade.');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleSendCounteroffer = async (orderId: number) => {
    const order = orders.find(o => o.id === orderId);
    const isSingleCard = order?.trade_offer?.cards.length === 1;
    let decisions = cardDecisions[orderId] || {};

    // For single-card trades, auto-accept the card
    if (isSingleCard && order?.trade_offer?.cards[0]) {
      const cardId = String(order.trade_offer.cards[0].id);
      decisions = { [cardId]: 'accept' };
    }

    if (!decisions || Object.keys(decisions).length === 0) {
      toast.error('Please accept or reject at least one card.');
      return;
    }
    setIsProcessing(orderId);
    try {
      const overrides = cardOverrides[orderId] || {};
      const nestedDecisions: Record<string, { decision: string; overridden_value: number | null }> = {};
      for (const [cardId, decision] of Object.entries(decisions)) {
        const overrideStr = overrides[cardId];
        nestedDecisions[cardId] = {
          decision,
          overridden_value: (decision === 'accept' && overrideStr !== undefined && overrideStr !== '')
            ? parseFloat(overrideStr)
            : null,
        };
      }
      const res = await axios.post(`${API}/api/orders/dispatch/`, {
        order_id: orderId,
        action: 'send_counteroffer',
        card_decisions: nestedDecisions,
        counteroffer_message: counterofferMsg[orderId] || '',
      }, { headers });
      const updated = res.data;
      setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
      setCardDecisions(prev => { const copy = { ...prev }; delete copy[orderId]; return copy; });
      setCardOverrides(prev => { const copy = { ...prev }; delete copy[orderId]; return copy; });
      setCounterofferMsg(prev => { const copy = { ...prev }; delete copy[orderId]; return copy; });
      toast.success('Counteroffer sent to customer');
    } catch {
      toast.error('Failed to send counteroffer.');
    } finally {
      setIsProcessing(null);
    }
  };

  const toggleCardDecision = (orderId: number, cardId: string, decision: 'accept' | 'reject') => {
    setCardDecisions(prev => {
      const orderDecisions = { ...(prev[orderId] || {}) };
      if (orderDecisions[cardId] === decision) {
        delete orderDecisions[cardId];
      } else {
        orderDecisions[cardId] = decision;
      }
      return { ...prev, [orderId]: orderDecisions };
    });
  };

  const CONDITION_MULTIPLIERS: Record<string, number> = {
    near_mint: 1.00, lightly_played: 0.85, moderately_played: 0.70, heavily_played: 0.50, damaged: 0.30,
  };

  const getDefaultCardCredit = (card: TradeCardItem, creditPct: number): number => {
    if (card.base_market_price) {
      // Oracle card - apply condition multiplier to NM base price
      const basePrice = Number(card.base_market_price);
      const condMul = CONDITION_MULTIPLIERS[card.condition] ?? 0.85;
      return parseFloat((basePrice * condMul * creditPct).toFixed(2));
    } else {
      // Manual card - estimated_value already condition-adjusted
      return parseFloat((Number(card.estimated_value) * creditPct).toFixed(2));
    }
  };

  const setCardOverride = (orderId: number, cardId: string, value: string) => {
    setCardOverrides(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || {}), [cardId]: value },
    }));
  };

  const hasPriceOverrides = (orderId: number): boolean => {
    const overrides = cardOverrides[orderId];
    if (!overrides) return false;
    return Object.values(overrides).some(v => v !== undefined && v !== '');
  };

  const handleAdminReschedule = async () => {
    if (!rescheduleOrderId || !rescheduleTimeslot) return;
    setRescheduling(true);
    try {
      const res = await axios.post(`${API}/api/orders/reschedule/`, {
        order_id: rescheduleOrderId,
        recurring_timeslot_id: rescheduleTimeslot.recurring_timeslot_id,
        pickup_date: rescheduleTimeslot.pickup_date,
        admin: true,
      }, { headers });
      const updated = res.data;
      setOrders(prev => prev.map(o => o.id === rescheduleOrderId ? updated : o));
      setOverdueOrders(prev => prev.map(o => o.id === rescheduleOrderId ? updated : o));
      toast.success('Order rescheduled');
      setRescheduleOrderId(null);
      setRescheduleTimeslot(null);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to reschedule');
      }
    } finally {
      setRescheduling(false);
    }
  };

  const getPartialCreditCalc = (order: Order) => {
    if (!order.trade_offer) return null;
    const decisions = cardDecisions[order.id] || {};
    const overrides = cardOverrides[order.id] || {};
    const creditPct = Number(order.trade_offer.credit_percentage) / 100;
    let newCredit = 0;
    for (const card of order.trade_offer.cards) {
      if (decisions[String(card.id)] === 'accept') {
        const overrideStr = overrides[String(card.id)];
        if (overrideStr !== undefined && overrideStr !== '') {
          newCredit += parseFloat(overrideStr) || 0;
        } else {
          newCredit += getDefaultCardCredit(card, creditPct);
        }
      }
    }
    const salePrice = orderSalePrice(order);
    const cashDue = Math.max(0, salePrice - newCredit);
    return { newCredit, salePrice, cashDue };
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: 'bg-pkmn-blue/15 text-pkmn-blue',
      trade_review: 'bg-purple-500/15 text-purple-600',
      cash_needed: 'bg-pkmn-blue/15 text-pkmn-blue',
      pending_counteroffer: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark',
    };
    return map[s] || 'bg-pkmn-bg text-pkmn-text';
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      pending: 'PENDING',
      trade_review: 'TRADE REVIEW',
      cash_needed: 'BALANCE DUE',
      pending_counteroffer: 'COUNTEROFFER',
    };
    return map[s] || s.replace('_', ' ').toUpperCase();
  };

  const paymentLabel = (value: string) => {
    const map: Record<string, string> = {
      trade: 'Trade-In',
      cash_plus_trade: 'Trade + Balance',
      venmo: 'Venmo',
      zelle: 'Zelle',
      paypal: 'PayPal',
      cash: 'Cash',
    };
    return map[value] || value.replace('_', ' ');
  };

  // Derived lists for dual tabs
  const urgentAsapOrders = [...orders]
    .filter(order => order.delivery_method === 'asap' && !order.is_acknowledged)
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

  const standardOrders = orders.filter(order => !(order.delivery_method === 'asap' && !order.is_acknowledged));

  const tradeOrders = [...standardOrders]
    .filter(order => ['trade_review', 'pending_counteroffer'].includes(order.status))
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  const fulfillmentOrders = [...standardOrders]
    .filter(order => ['pending', 'cash_needed'].includes(order.status))
    .sort((left, right) => {
      if (left.delivery_method === 'asap' && right.delivery_method !== 'asap') return -1;
      if (left.delivery_method !== 'asap' && right.delivery_method === 'asap') return 1;
      return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    });

  // Group fulfillment orders into 3-tier hierarchy: Day -> Timeslot -> User -> Orders
  interface UserGroup { email: string; discord: string; orders: Order[] }
  interface SlotGroup { timeRange: string; users: UserGroup[]; totalOrders: number }
  interface DayGroup { day: string; slots: SlotGroup[]; totalOrders: number }

  const fulfillmentDays: DayGroup[] = (() => {
    // Nested map: day -> timeRange -> userEmail -> { discord, orders }
    const dayMap = new Map<string, Map<string, Map<string, { discord: string; orders: Order[] }>>>();

    for (const o of fulfillmentOrders) {
      let day: string;
      let timeRange: string;

      if (o.delivery_method === 'asap') {
        day = 'ASAP / Downtown';
        timeRange = '';
      } else if (o.recurring_timeslot) {
        // recurring_timeslot is like "Monday 08:07 PM - 10:07 PM"
        const parts = o.recurring_timeslot.match(/^(\w+)\s+(.+)$/);
        if (parts) {
          day = parts[1];
          timeRange = parts[2];
        } else {
          day = 'Scheduled';
          timeRange = o.recurring_timeslot;
        }
      } else {
        day = 'Scheduled';
        timeRange = o.delivery_details || o.pickup_timeslot || 'Pickup';
      }

      if (!dayMap.has(day)) dayMap.set(day, new Map());
      const slotMap = dayMap.get(day)!;
      if (!slotMap.has(timeRange)) slotMap.set(timeRange, new Map());
      const userMap = slotMap.get(timeRange)!;
      const uKey = o.user_email;
      if (!userMap.has(uKey)) userMap.set(uKey, { discord: o.discord_handle || '', orders: [] });
      userMap.get(uKey)!.orders.push(o);
    }

    const dayOrder = ['ASAP / Downtown', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Scheduled'];

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => {
        const ai = dayOrder.indexOf(a);
        const bi = dayOrder.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([day, slotMap]) => {
        const slots: SlotGroup[] = Array.from(slotMap.entries()).map(([timeRange, userMap]) => {
          const users: UserGroup[] = Array.from(userMap.entries()).map(([email, u]) => ({ email, ...u }));
          return { timeRange, users, totalOrders: users.reduce((s, u) => s + u.orders.length, 0) };
        });
        return { day, slots, totalOrders: slots.reduce((s, sl) => s + sl.totalOrders, 0) };
      });
  })();

  const toggleSlot = (key: string) => setExpandedSlots(prev => ({ ...prev, [key]: !prev[key] }));

  if (!user?.is_admin) return (
    <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
        <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
      </div>
    </div>
  );

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-pkmn-text">Dispatch</h1>
          </div>
          <div className="bg-white px-4 py-2 rounded-md border-2 border-pkmn-blue">
            <p className="text-2xl font-bold text-pkmn-blue">{orders.length}</p>
            <p className="text-xs text-pkmn-gray">Orders</p>
          </div>
        </div>

        {urgentAsapOrders.length > 0 && (
          <section className="mb-6 overflow-hidden border border-red-200 bg-white shadow-sm">
            <div className="border-b border-red-100 bg-red-50 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-red-600">Urgent ASAP Requests</p>
                  <h2 className="mt-1 text-xl font-black text-gray-900">These orders still need a first admin response.</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Acknowledge an ASAP request here to stop the 24-hour expiry timer and move it into normal dispatch handling.
                  </p>
                </div>
                <div className="inline-flex h-14 min-w-[3.5rem] items-center justify-center border border-red-200 bg-white px-4 text-2xl font-black text-red-600">
                  {urgentAsapOrders.length}
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              {urgentAsapOrders.map((order) => {
                const orderTotal = orderSalePrice(order).toFixed(2);

                return (
                  <div key={order.id} className="border border-red-100 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="bg-red-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-red-600">
                            ASAP Pickup
                          </span>
                          <span className={`px-3 py-1 text-[11px] font-bold ${statusBadge(order.status)}`}>
                            {statusLabel(order.status)}
                          </span>
                          <span className="bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-700">
                            {paymentLabel(order.payment_method)}
                          </span>
                        </div>

                        <h3 className="mt-3 text-xl font-black text-gray-900">{orderItemsLabel(order)}</h3>
                        <p className="mt-1 text-sm font-medium text-gray-600">Order #{order.id} • {new Date(order.created_at).toLocaleString()}</p>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="border border-gray-200 bg-gray-50 p-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">Customer</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900 break-words">{order.user_email}</p>
                          </div>
                          <div className="border border-gray-200 bg-gray-50 p-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">Discord</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900 break-words">{order.discord_handle || 'Not provided'}</p>
                          </div>
                          <div className="border border-gray-200 bg-gray-50 p-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">Pickup</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">ASAP / Downtown</p>
                          </div>
                          <div className="border border-gray-200 bg-gray-50 p-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">Order Total</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">${orderTotal}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid w-full gap-3 lg:w-[320px]">
                        <button
                          type="button"
                          onClick={() => handleAction(order.id, 'acknowledge_asap')}
                          disabled={isProcessing === order.id}
                          className="inline-flex min-h-[56px] items-center justify-center gap-2 bg-blue-600 px-5 py-4 text-base font-black text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CheckCircle size={18} /> Acknowledge
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmAction({ orderId: order.id, action: 'cancel', label: 'Cancel' })}
                          disabled={isProcessing === order.id}
                          className="inline-flex min-h-[56px] items-center justify-center gap-2 bg-red-600 px-5 py-4 text-base font-black text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <XCircle size={18} /> Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tab Switcher */}
        <div className="flex gap-1 mb-6 bg-white border border-pkmn-border p-1 shadow-sm">
          <button
            onClick={() => setActiveTab('FULFILLMENT')}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'FULFILLMENT'
                ? 'bg-pkmn-blue text-white shadow-md'
                : 'text-pkmn-gray hover:bg-pkmn-bg'
            }`}
          >
            <Package size={16} /> Fulfillment Queue
            {fulfillmentOrders.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 ${activeTab === 'FULFILLMENT' ? 'bg-white/20' : 'bg-pkmn-blue/15 text-pkmn-blue'}`}>{fulfillmentOrders.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('TRADES')}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'TRADES'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-pkmn-gray hover:bg-pkmn-bg'
            }`}
          >
            <Star size={16} /> Trade Desk
            {tradeOrders.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 ${activeTab === 'TRADES' ? 'bg-white/20' : 'bg-purple-500/15 text-purple-700'}`}>{tradeOrders.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('OVERDUE')}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'OVERDUE'
                ? 'bg-pkmn-red text-white shadow-md'
                : 'text-pkmn-gray hover:bg-pkmn-bg'
            }`}
          >
            <Clock size={16} /> Overdue
            {overdueOrders.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 ${activeTab === 'OVERDUE' ? 'bg-white/20' : 'bg-pkmn-red/15 text-pkmn-red'}`}>{overdueOrders.length}</span>
            )}
          </button>
        </div>

        {/* ===== TRADES TAB ===== */}
        {activeTab === 'TRADES' && (<>
        {/* Filters */}
        <div className="bg-white border border-pkmn-border p-4 mb-6 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-pkmn-gray mb-1">Search</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Email, Discord, item..."
                  className="w-full pl-9 pr-4 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-pkmn-gray mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text bg-white focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="trade_review">Trade Review</option>
                <option value="cash_needed">Balance Due</option>
                <option value="pending_counteroffer">Counteroffer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-pkmn-gray mb-1">Payment</label>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text bg-white focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200"
              >
                <option value="">All Methods</option>
                <option value="trade">Trade-In</option>
                <option value="cash_plus_trade">Trade + Balance</option>
                <option value="venmo">Venmo</option>
                <option value="zelle">Zelle</option>
                <option value="paypal">PayPal</option>
              </select>
            </div>
            <button onClick={handleSearch} className="px-4 py-2 bg-pkmn-blue text-white rounded-md text-sm font-semibold hover:bg-pkmn-blue-dark transition-colors flex items-center gap-1">
              <Filter size={14} /> Filter
            </button>
          </div>
        </div>

        {/* Orders */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
            <span className="ml-3 text-pkmn-gray">Loading orders...</span>
          </div>
        ) : tradeOrders.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-pkmn-border p-8 sm:p-12 text-center">
            <div className="text-5xl mb-4"><CheckCircle className="w-12 h-12 text-green-500 mx-auto" /></div>
            <h3 className="text-xl sm:text-2xl font-bold text-pkmn-text mb-2">All Caught Up!</h3>
            <p className="text-pkmn-gray">No trade orders need review.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tradeOrders.map(order => (
              <div key={order.id} className="bg-white border border-pkmn-border overflow-hidden shadow hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="bg-linear-to-r from-blue-50 to-indigo-50 px-4 sm:px-6 py-4 border-b border-pkmn-border">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-pkmn-text">Order #{order.id}</h3>
                      <p className="text-xs text-pkmn-gray-dark font-mono">{order.order_id}</p>
                      <p className="text-sm text-pkmn-gray">{orderItemsLabel(order)} - ${orderSalePrice(order).toFixed(2)}</p>
                      <p className="text-xs text-pkmn-gray-dark mt-0.5">{new Date(order.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-3 py-1 text-xs font-semibold ${statusBadge(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                      {order.payment_method === 'trade' && (
                        <span className="bg-pkmn-yellow/15 text-pkmn-yellow-dark px-3 py-1 text-xs font-semibold">Trade-In</span>
                      )}
                      {order.payment_method === 'cash_plus_trade' && (
                        <span className="bg-pkmn-blue/15 text-pkmn-blue px-3 py-1 text-xs font-semibold">Trade + Balance</span>
                      )}
                      {!['trade', 'cash_plus_trade'].includes(order.payment_method) && (
                        <span className="bg-green-500/15 text-green-600 px-3 py-1 text-xs font-semibold">{paymentLabel(order.payment_method).toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="px-4 sm:px-6 py-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-pkmn-border">
                    <div>
                      <p className="text-xs font-semibold text-pkmn-gray uppercase">Customer</p>
                      <p className="text-pkmn-text font-medium text-sm">{order.user_email}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-pkmn-gray uppercase">Discord</p>
                      <p className="text-pkmn-text font-medium text-sm">{order.discord_handle}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-pkmn-gray uppercase">Pickup / Delivery</p>
                      <p className="text-pkmn-text font-medium text-sm">
                        {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                      </p>
                    </div>
                  </div>

                  {/* Multi-card trade offer */}
                  {order.trade_offer && order.trade_offer.cards.length > 0 && (
                    <div className="bg-pkmn-yellow/10 border border-pkmn-yellow/20 rounded-md p-4">
                      <h4 className="font-semibold text-pkmn-text mb-3 flex items-center gap-2">
                        Trade Offer - {order.trade_offer.cards.length} card{order.trade_offer.cards.length > 1 ? 's' : ''}
                        <span className="text-xs bg-amber-200 text-pkmn-yellow-dark px-2 py-0.5">
                          {order.trade_offer.credit_percentage}% rate - ${(Number(order.trade_offer.total_credit) || 0).toFixed(2)} credit
                        </span>
                        {order.trade_offer.trade_mode === 'allow_partial' && (
                          <span className="text-xs bg-purple-500/15 text-purple-600 px-2 py-0.5">Partial OK</span>
                        )}
                      </h4>
                      <div className="space-y-2">
                        {order.trade_offer.cards.map((card) => {
                          const decisions = cardDecisions[order.id] || {};
                          const overrides = cardOverrides[order.id] || {};
                          const cardDecision = decisions[String(card.id)];
                          const isPartial = order.trade_offer?.trade_mode === 'allow_partial' && order.status === 'trade_review';
                          const isSingleCard = order.trade_offer?.cards.length === 1 && order.status === 'trade_review';
                          const creditPct = Number(order.trade_offer?.credit_percentage || 85) / 100;
                          const defaultCredit = getDefaultCardCredit(card, creditPct);
                          return (
                            <div key={card.id} className={`rounded-md px-3 py-2 ${
                              card.is_accepted === true ? 'bg-green-500/10 border border-green-500/20' :
                              card.is_accepted === false ? 'bg-pkmn-red/10 border border-pkmn-red/20' :
                              'bg-white border border-amber-100'
                            }`}>
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  {card.image_url && (
                                    <img src={card.image_url} alt={card.card_name} className="h-14 w-10 flex-shrink-0 rounded border border-pkmn-border object-cover bg-white" />
                                  )}
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="font-medium text-pkmn-text text-sm break-words">{card.card_name}</span>
                                  {card.is_wanted_card && (
                                    <span className="bg-pkmn-yellow/15 text-pkmn-yellow-dark text-[10px] font-bold px-1.5 py-0.5 flex items-center gap-0.5">
                                      <Star size={10} /> WANTED
                                    </span>
                                  )}
                                  <span className="text-xs text-pkmn-gray capitalize">{card.condition?.replace('_', ' ')}</span>
                                  {card.rarity && <span className="text-xs text-purple-600">{card.rarity}</span>}
                                  {card.is_accepted === true && <span className="text-xs text-green-600 font-semibold">Accepted</span>}
                                  {card.is_accepted === false && <span className="text-xs text-pkmn-red font-semibold">Rejected</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  {card.base_market_price && (
                                    <span className="text-xs text-pkmn-gray-dark">Oracle NM: ${Number(card.base_market_price).toFixed(2)}</span>
                                  )}
                                  {card.custom_price && (
                                    <span className="text-xs text-pkmn-blue font-semibold">User: ${Number(card.custom_price).toFixed(2)}</span>
                                  )}
                                  <span className="text-xs text-pkmn-gray">Used: ${(Number(card.estimated_value) || 0).toFixed(2)}</span>
                                  {(card.tcgplayer_url || card.card_name) && (
                                    <a
                                      href={card.tcgplayer_url || `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(card.card_name)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-pkmn-blue hover:underline whitespace-nowrap"
                                    >
                                      View on TCGPlayer
                                    </a>
                                  )}
                                  {isPartial && (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => toggleCardDecision(order.id, String(card.id), 'accept')}
                                        className={`px-2 py-1 rounded text-xs font-semibold transition-all ${cardDecision === 'accept' ? 'bg-green-600 text-white' : 'bg-pkmn-bg text-pkmn-gray hover:bg-green-500/15 hover:text-green-600'}`}
                                      >
                                        <CheckCircle size={12} className="inline mr-0.5" />Accept
                                      </button>
                                      <button
                                        onClick={() => toggleCardDecision(order.id, String(card.id), 'reject')}
                                        className={`px-2 py-1 rounded text-xs font-semibold transition-all ${cardDecision === 'reject' ? 'bg-pkmn-red/100 text-white' : 'bg-pkmn-bg text-pkmn-gray hover:bg-pkmn-red/15 hover:text-pkmn-red'}`}
                                      >
                                        <XCircle size={12} className="inline mr-0.5" />Reject
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {/* Price override input - visible for single-card trades or when accepted in partial mode */}
                              {((isPartial && cardDecision === 'accept') || isSingleCard) && (
                                <div className="mt-2 flex items-center gap-2 text-sm">
                                  <label className="text-xs text-pkmn-gray whitespace-nowrap">Final Net Credit Offer ($):</label>
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-pkmn-gray-dark text-xs">$</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder={defaultCredit.toFixed(2)}
                                      value={overrides[String(card.id)] ?? ''}
                                      onChange={(e) => setCardOverride(order.id, String(card.id), e.target.value)}
                                      className="w-28 pl-5 pr-2 py-1 border border-pkmn-border rounded text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
                                    />
                                  </div>
                                  <span className="text-xs text-pkmn-gray-dark">auto: ${defaultCredit.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Dynamic partial trade calculator */}
                      {order.trade_offer.trade_mode === 'allow_partial' && order.status === 'trade_review' && (() => {
                        const calc = getPartialCreditCalc(order);
                        if (!calc) return null;
                        const hasDecisions = Object.keys(cardDecisions[order.id] || {}).length > 0;
                        return hasDecisions ? (
                          <div className="mt-3 bg-white border border-pkmn-blue/20 rounded-md p-3 space-y-1 text-sm">
                            <div className="flex justify-between"><span className="text-pkmn-gray">Final net trade credit:</span><span className="font-semibold text-green-600">${calc.newCredit.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-pkmn-gray">Sale price:</span><span className="font-semibold">${calc.salePrice.toFixed(2)}</span></div>
                            <div className="flex justify-between border-t border-pkmn-blue/10 pt-1"><span className="text-pkmn-text font-semibold">Cash due:</span><span className={`font-bold ${calc.cashDue > 0 ? 'text-orange-600' : 'text-green-600'}`}>${calc.cashDue.toFixed(2)}</span></div>
                          </div>
                        ) : null;
                      })()}

                      {order.buy_if_trade_denied && (
                        <p className="text-xs text-pkmn-blue mt-2 font-medium">Buyer opted to purchase with cash if trade is denied.</p>
                      )}
                    </div>
                  )}

                  {/* Legacy single-card trade */}
                  {!order.trade_offer && (order.payment_method === 'trade' || order.payment_method === 'cash_plus_trade') && order.trade_card_name && (
                    <div className="bg-pkmn-yellow/10 border border-pkmn-yellow/20 rounded-md p-4">
                      <h4 className="font-semibold text-pkmn-text mb-2">Trade-In Card</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-pkmn-yellow-dark">Card Name</p>
                          <p className="text-yellow-900 font-bold">{order.trade_card_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-pkmn-yellow-dark">Value</p>
                          <p className="text-yellow-900 font-bold">${order.trade_card_value || '0.00'}</p>
                        </div>
                      </div>
                      {order.buy_if_trade_denied && (
                        <p className="text-xs text-pkmn-blue mt-2 font-medium">Buyer opted to purchase with cash if trade is denied.</p>
                      )}
                    </div>
                  )}

                  {order.preferred_pickup_time && (
                    <p className="text-xs text-pkmn-gray">Preferred: {order.preferred_pickup_time}</p>
                  )}

                  {order.status === 'cash_needed' && (
                    <div className="bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-md p-3 text-sm text-pkmn-blue font-medium">
                      Balance due - the order stays active and just needs the remaining payment before fulfillment.
                    </div>
                  )}
                </div>

                {/* Actions - strict contextual state machine */}
                {(() => {
                  const isActionable = ['pending', 'trade_review', 'cash_needed', 'pending_counteroffer'].includes(order.status);
                  if (!isActionable) return (
                    <div className="bg-pkmn-bg px-4 sm:px-6 py-4 border-t border-pkmn-border">
                      <div className="flex items-center gap-2 text-pkmn-gray">
                        <Ban size={16} />
                        <span className="text-sm font-semibold">Order is locked. Current Status: <span className="uppercase">{order.status.replace('_', ' ')}</span></span>
                      </div>
                    </div>
                  );

                  // --- Derived booleans ---
                  const hasTrade = order.payment_method === 'trade' || order.payment_method === 'cash_plus_trade';
                  const isPureCash = !hasTrade;
                  const needsTradeReview = order.status === 'trade_review';
                  const isPendingCounteroffer = order.status === 'pending_counteroffer';
                  const isResolved = ['cash_needed', 'pending'].includes(order.status);
                  const hasOverrides = hasPriceOverrides(order.id);
                  const isPartialAllowed = order.trade_offer?.trade_mode === 'allow_partial';
                  const isSingleCard = (order.trade_offer?.cards.length || 0) === 1;
                  const singleCardOverride = isSingleCard && hasOverrides;
                  const decisions = cardDecisions[order.id] || {};
                  const totalCards = order.trade_offer?.cards.length || 0;
                  const decidedCardsCount = Object.keys(decisions).length;
                  const allDecided = totalCards > 0 && decidedCardsCount === totalCards;
                  const isAllAccepted = allDecided && Object.values(decisions).every(d => d === 'accept');
                  const isAllRejected = allDecided && Object.values(decisions).every(d => d === 'reject');
                  const processing = isProcessing === order.id;

                  const btnVariants = {
                    initial: { opacity: 0, scale: 0.9, y: 8 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    exit: { opacity: 0, scale: 0.9, y: -8 },
                  };

                  return (
                    <div className="bg-pkmn-bg px-4 sm:px-6 py-4 space-y-3">
                      {/* Counteroffer message - for State 2B (all decided + overrides) or single-card override */}
                      <AnimatePresence>
                        {needsTradeReview && order.trade_offer && ((allDecided && hasOverrides) || singleCardOverride) && (
                          <motion.div
                            key="counteroffer-textarea"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <label className="block text-xs font-semibold text-pkmn-gray mb-1">Counteroffer Message (optional)</label>
                            <textarea
                              value={counterofferMsg[order.id] || ''}
                              onChange={(e) => setCounterofferMsg(prev => ({ ...prev, [order.id]: e.target.value }))}
                              placeholder="Explain your offer to the customer..."
                              rows={2}
                              className="w-full p-2 border border-pkmn-border rounded-md text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Override warning banner */}
                      <AnimatePresence>
                        {hasOverrides && (
                          <motion.p
                            key="override-warning"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-xs text-pkmn-yellow-dark bg-pkmn-yellow/10 px-3 py-2 rounded-md border border-pkmn-yellow/20"
                          >
                            Price overrides detected - please send a counteroffer for customer consent.
                          </motion.p>
                        )}
                      </AnimatePresence>

                      {/* Partial trade progress */}
                      {needsTradeReview && isPartialAllowed && totalCards > 1 && (
                        <p className="text-xs text-pkmn-gray">
                          {decidedCardsCount}/{totalCards} cards decided
                        </p>
                      )}

                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                        <AnimatePresence mode="popLayout">
                          {/* === PURE CASH - Fulfill + Cancel only === */}
                          {isPureCash && isResolved && (
                            <motion.button
                              key="fulfill"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => handleAction(order.id, 'fulfill')}
                              disabled={processing}
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <CheckCircle size={18} /> Fulfill
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 0 - Accept Trade (bulk approve) === */}
                          {needsTradeReview && hasTrade && decidedCardsCount === 0 && !singleCardOverride && (
                            <motion.button
                              key="accept-trade"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => handleAction(order.id, 'approve_trade')}
                              disabled={processing}
                              className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <ThumbsUp size={18} /> Accept Trade
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 0 - Deny Trade (bulk deny) === */}
                          {needsTradeReview && hasTrade && decidedCardsCount === 0 && !singleCardOverride && (
                            <motion.button
                              key="deny-trade-s0"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => setConfirmAction({ orderId: order.id, action: 'deny_trade', label: 'Deny Trade' })}
                              disabled={processing}
                              className="flex-1 bg-pkmn-yellow hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Ban size={18} /> Deny Trade
                            </motion.button>
                          )}

                          {/* === SINGLE-CARD COUNTEROFFER - Send Counteroffer === */}
                          {needsTradeReview && hasTrade && singleCardOverride && (
                            <motion.button
                              key="single-send-counter"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => handleSendCounteroffer(order.id)}
                              disabled={processing}
                              className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Send size={18} /> Send Counteroffer
                            </motion.button>
                          )}

                          {/* === SINGLE-CARD COUNTEROFFER - Deny Trade === */}
                          {needsTradeReview && hasTrade && singleCardOverride && (
                            <motion.button
                              key="single-deny-trade"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => setConfirmAction({ orderId: order.id, action: 'deny_trade', label: 'Deny Trade' })}
                              disabled={processing}
                              className="flex-1 bg-pkmn-yellow hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Ban size={18} /> Deny Trade
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 1 - Accept Trade (disabled) === */}
                          {needsTradeReview && hasTrade && decidedCardsCount > 0 && !allDecided && (
                            <motion.button
                              key="accept-trade-disabled"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              disabled={true}
                              className="flex-1 opacity-50 cursor-not-allowed bg-pkmn-gray-dark text-pkmn-gray-dark pointer-events-none font-bold py-3 px-4 rounded-md flex items-center justify-center gap-2"
                            >
                              <ThumbsUp size={18} /> Accept Trade
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 1 - Deny Trade (disabled) === */}
                          {needsTradeReview && hasTrade && decidedCardsCount > 0 && !allDecided && (
                            <motion.button
                              key="deny-trade-disabled"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              disabled={true}
                              className="flex-1 opacity-50 cursor-not-allowed bg-pkmn-gray-dark text-pkmn-gray-dark pointer-events-none font-bold py-3 px-4 rounded-md flex items-center justify-center gap-2"
                            >
                              <Ban size={18} /> Deny Trade
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 2A - Accept Trade / Accept Partial Trade (all decided, no overrides) === */}
                          {needsTradeReview && hasTrade && allDecided && !hasOverrides && (
                            <motion.button
                              key="accept-trade-2a"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => (isAllAccepted || isAllRejected)
                                ? handleAction(order.id, 'approve_trade')
                                : handlePartialTradeReview(order.id)
                              }
                              disabled={processing}
                              className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <ThumbsUp size={18} /> {(isAllAccepted || isAllRejected) ? 'Accept Trade' : 'Accept Partial Trade'}
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 2A - Deny Trade (all decided, no overrides) === */}
                          {needsTradeReview && hasTrade && allDecided && !hasOverrides && (
                            <motion.button
                              key="deny-trade-2a"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => setConfirmAction({ orderId: order.id, action: 'deny_trade', label: 'Deny Trade' })}
                              disabled={processing}
                              className="flex-1 bg-pkmn-yellow hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Ban size={18} /> Deny Trade
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 2B - Send Counteroffer (all decided, overrides present) === */}
                          {needsTradeReview && hasTrade && allDecided && hasOverrides && (
                            <motion.button
                              key="counteroffer-2b"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => handleSendCounteroffer(order.id)}
                              disabled={processing}
                              className="flex-1 bg-pkmn-yellow/100 hover:bg-amber-600 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <AlertCircle size={18} /> Send Counteroffer
                            </motion.button>
                          )}

                          {/* === TRADE REVIEW: STATE 2B - Deny Trade (all decided, overrides present) === */}
                          {needsTradeReview && hasTrade && allDecided && hasOverrides && (
                            <motion.button
                              key="deny-trade-2b"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => setConfirmAction({ orderId: order.id, action: 'deny_trade', label: 'Deny Trade' })}
                              disabled={processing}
                              className="flex-1 bg-pkmn-yellow hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Ban size={18} /> Deny Trade
                            </motion.button>
                          )}

                          {/* === Deny Trade - pending_counteroffer === */}
                          {hasTrade && isPendingCounteroffer && (
                            <motion.button
                              key="deny-trade-co"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => setConfirmAction({ orderId: order.id, action: 'deny_trade', label: 'Deny Trade' })}
                              disabled={processing}
                              className="flex-1 bg-pkmn-yellow hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Ban size={18} /> Deny Trade
                            </motion.button>
                          )}

                          {/* === Fulfill - resolved (pending/cash_needed) === */}
                          {hasTrade && isResolved && (
                            <motion.button
                              key="fulfill-trade"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => handleAction(order.id, 'fulfill')}
                              disabled={processing}
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <CheckCircle size={18} /> Fulfill
                            </motion.button>
                          )}

                          {/* === Cancel / No-Show - only outside trade_review state === */}
                          {isResolved && (
                            <motion.button
                              key="cancel"
                              variants={btnVariants} initial="initial" animate="animate" exit="exit"
                              layout
                              onClick={() => setConfirmAction({ orderId: order.id, action: 'cancel', label: 'Cancel / No-Show' })}
                              disabled={processing}
                              className="flex-1 bg-pkmn-red hover:bg-pkmn-red-dark text-white font-bold py-3 px-4 rounded-md transition-colors duration-300 ease-in-out active:scale-95 flex items-center justify-center gap-2"
                            >
                              <XCircle size={18} /> No-Show
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
        </>)}

        {/* ===== FULFILLMENT TAB ===== */}
        {activeTab === 'FULFILLMENT' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
                <span className="ml-3 text-pkmn-gray">Loading orders...</span>
              </div>
            ) : fulfillmentDays.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-pkmn-border p-8 sm:p-12 text-center">
                <div className="text-5xl mb-4"><CheckCircle className="w-12 h-12 text-green-500 mx-auto" /></div>
                <h3 className="text-xl sm:text-2xl font-bold text-pkmn-text mb-2">All Fulfilled!</h3>
                <p className="text-pkmn-gray">No orders awaiting fulfillment.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {fulfillmentDays.map((dayGroup) => {
                  const dayKey = `day-${dayGroup.day}`;
                  const isDayExpanded = expandedSlots[dayKey] !== false;
                  return (
                    <div key={dayKey} className="overflow-visible bg-white shadow-sm border border-pkmn-border">
                      {/* Tier 1: Day Header */}
                      <button
                        onClick={() => toggleSlot(dayKey)}
                        className="w-full flex items-center justify-between rounded-t-xl bg-pkmn-bg px-4 sm:px-6 py-4 hover:bg-pkmn-bg transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-pkmn-blue/15 text-pkmn-blue w-8 h-8 flex items-center justify-center text-sm font-bold">{dayGroup.totalOrders}</div>
                          <p className="font-bold text-pkmn-text text-lg">{dayGroup.day}</p>
                        </div>
                        <ChevronDown size={18} className={`text-pkmn-gray transition-transform ${isDayExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {isDayExpanded && dayGroup.slots.map((slotGroup) => {
                        const slotKey = `slot-${dayGroup.day}-${slotGroup.timeRange}`;
                        const isSlotExpanded = expandedSlots[slotKey] !== false;
                        return (
                          <div key={slotKey}>
                            {/* Tier 2: Time Slot Sub-header */}
                            {slotGroup.timeRange && (
                              <button
                                onClick={() => toggleSlot(slotKey)}
                                className="w-full flex items-center justify-between bg-zinc-100 px-6 sm:px-8 py-3 border-y border-pkmn-border hover:bg-pkmn-bg transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-pkmn-text text-sm">{slotGroup.timeRange}</p>
                                  <span className="text-xs text-pkmn-gray">{slotGroup.totalOrders} order{slotGroup.totalOrders !== 1 ? 's' : ''}</span>
                                </div>
                                <ChevronDown size={14} className={`text-pkmn-gray-dark transition-transform ${isSlotExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            )}

                            {(isSlotExpanded || !slotGroup.timeRange) && slotGroup.users.map((userGroup) => (
                              <div key={userGroup.email}>
                                {/* Tier 3: User Row */}
                                <div className="flex items-center justify-between px-8 sm:px-10 py-2 bg-pkmn-bg border-b border-pkmn-border">
                                  <p className="text-xs font-semibold text-pkmn-gray">
                                    {userGroup.discord ? `${userGroup.discord} · ` : ''}{userGroup.email}
                                  </p>
                                  <span className="text-[10px] text-pkmn-gray-dark">{userGroup.orders.length} item{userGroup.orders.length !== 1 ? 's' : ''}</span>
                                </div>

                                {/* Tier 4: Order Rows */}
                                {userGroup.orders.map((order) => (
                                  <div key={order.id} className="flex items-center justify-between pl-10 pr-4 sm:pl-12 sm:pr-6 py-3 border-b last:border-b-0 border-pkmn-border bg-white hover:bg-pkmn-bg transition-colors">
                                    <div className="flex items-center gap-4 min-w-0 flex-1">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-pkmn-text text-sm">{orderItemsLabel(order)}</span>
                                          <span className={`px-2 py-0.5 text-[10px] font-semibold ${statusBadge(order.status)}`}>
                                            {statusLabel(order.status)}
                                          </span>
                                          {!['trade', 'cash_plus_trade'].includes(order.payment_method) && (
                                            <span className="text-[10px] text-pkmn-gray-dark uppercase">{paymentLabel(order.payment_method)}</span>
                                          )}
                                          {order.payment_method === 'cash_plus_trade' && (
                                            <span className="text-[10px] text-pkmn-blue font-semibold">TRADE + BALANCE</span>
                                          )}
                                        </div>
                                      </div>
                                      <span className="text-sm font-semibold text-pkmn-text whitespace-nowrap">${orderSalePrice(order).toFixed(2)}</span>
                                    </div>

                                    {/* 3-dot action menu */}
                                    <div className="relative ml-3 shrink-0">
                                      <button
                                        onClick={() => setActionMenu(actionMenu === order.id ? null : order.id)}
                                        className="p-2 rounded-md hover:bg-pkmn-bg transition-colors text-pkmn-gray"
                                      >
                                        <MoreVertical size={16} />
                                      </button>
                                      {actionMenu === order.id && (
                                        <div className="absolute right-0 top-full mt-1 z-[100] bg-white border border-pkmn-border rounded-md shadow-xl py-1 w-44">
                                          <button
                                            onClick={() => { handleAction(order.id, 'fulfill'); setActionMenu(null); }}
                                            disabled={isProcessing === order.id}
                                            className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-green-500/10 flex items-center gap-2"
                                          >
                                            <CheckCircle size={14} /> Fulfill
                                          </button>
                                          <button
                                            onClick={() => { setConfirmAction({ orderId: order.id, action: 'cancel', label: 'Cancel / No-Show' }); setActionMenu(null); }}
                                            disabled={isProcessing === order.id}
                                            className="w-full text-left px-4 py-2 text-sm text-pkmn-red hover:bg-pkmn-red/10 flex items-center gap-2"
                                          >
                                            <XCircle size={14} /> No-Show
                                          </button>
                                          {order.delivery_method === 'scheduled' && (
                                            <button
                                              onClick={() => { setRescheduleOrderId(order.id); setRescheduleTimeslot(null); setActionMenu(null); }}
                                              className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-2"
                                            >
                                              <Calendar size={14} /> Reschedule
                                            </button>
                                          )}
                                          {order.discord_handle && (
                                            <button
                                              onClick={() => { navigator.clipboard.writeText(order.discord_handle); toast.success('Discord copied'); setActionMenu(null); }}
                                              className="w-full text-left px-4 py-2 text-sm text-pkmn-gray-dark hover:bg-pkmn-bg flex items-center gap-2"
                                            >
                                              <MessageSquare size={14} /> Copy Discord
                                            </button>
                                          )}
                                          <a
                                            href={`/orders/${order.order_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={() => setActionMenu(null)}
                                            className="w-full text-left px-4 py-2 text-sm text-pkmn-gray-dark hover:bg-pkmn-bg flex items-center gap-2"
                                          >
                                            <ExternalLink size={14} /> View Receipt
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ===== OVERDUE TAB ===== */}
        {activeTab === 'OVERDUE' && (
          <>
            {overdueLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-red"></div>
                <span className="ml-3 text-pkmn-gray">Loading overdue orders...</span>
              </div>
            ) : overdueOrders.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-pkmn-border p-8 sm:p-12 text-center">
                <div className="text-5xl mb-4"><CheckCircle className="w-12 h-12 text-green-500 mx-auto" /></div>
                <h3 className="text-xl sm:text-2xl font-bold text-pkmn-text mb-2">No Overdue Orders</h3>
                <p className="text-pkmn-gray">All scheduled orders are on track.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {overdueOrders.map(order => {
                  const daysOverdue = order.pickup_date
                    ? Math.floor((Date.now() - new Date(order.pickup_date + 'T00:00:00').getTime()) / 86400000)
                    : 0;
                  return (
                    <div key={order.id} className="bg-white border border-pkmn-border p-4 hover:border-pkmn-red/30 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-semibold text-pkmn-text text-sm">{orderItemsLabel(order)}</p>
                          <p className="text-xs text-pkmn-gray">{order.user_email} {order.discord_handle ? `· ${order.discord_handle}` : ''}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold text-pkmn-red bg-pkmn-red/10 px-2 py-0.5">
                            {daysOverdue} day{daysOverdue !== 1 ? 's' : ''} overdue
                          </span>
                          <p className="text-[10px] text-pkmn-gray mt-0.5">
                            Pickup: {order.pickup_date ? new Date(order.pickup_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-pkmn-gray">
                        <span>{order.delivery_details || order.recurring_timeslot || 'Scheduled'}</span>
                        <span>·</span>
                        <span className="font-medium">${orderSalePrice(order).toFixed(2)}</span>
                        <span>·</span>
                        <span className="uppercase">{paymentLabel(order.payment_method)}</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => handleAction(order.id, 'fulfill')}
                          disabled={isProcessing === order.id}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-green-600 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle size={14} /> Fulfill
                        </button>
                        <button
                          onClick={() => { setRescheduleOrderId(order.id); setRescheduleTimeslot(null); }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors"
                        >
                          <Calendar size={14} /> Reschedule
                        </button>
                        <button
                          onClick={() => setConfirmAction({ orderId: order.id, action: 'cancel', label: 'Cancel / No-Show' })}
                          disabled={isProcessing === order.id}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-pkmn-red bg-pkmn-red/5 border border-pkmn-red/20 rounded-md hover:bg-pkmn-red/10 transition-colors disabled:opacity-50"
                        >
                          <XCircle size={14} /> No-Show
                        </button>
                        {order.discord_handle && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(order.discord_handle); toast.success('Discord copied'); }}
                            className="px-3 py-2 text-sm text-pkmn-gray-dark bg-pkmn-bg border border-pkmn-border rounded-md hover:bg-white transition-colors"
                          >
                            <MessageSquare size={14} />
                          </button>
                        )}
                        <a
                          href={`/orders/${order.order_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 text-sm text-pkmn-gray-dark bg-pkmn-bg border border-pkmn-border rounded-md hover:bg-white transition-colors"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Confirmation Dialog */}
        {confirmAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-sm w-full p-6 text-center">
              <div className="text-4xl mb-3"><AlertCircle className="w-10 h-10 text-pkmn-yellow mx-auto" /></div>
              <h3 className="text-lg font-bold text-pkmn-text mb-2">{confirmAction.label}?</h3>
              <p className="text-pkmn-gray text-sm mb-6">
                {confirmAction.action === 'deny_trade'
                  ? 'This will deny the trade offer. If the buyer opted in, the order will switch to cash payment.'
                  : 'This will cancel the order and restock the item.'}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmAction(null)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-md hover:bg-pkmn-bg transition-colors">Go Back</button>
                <button
                  onClick={() => { handleAction(confirmAction.orderId, confirmAction.action); setConfirmAction(null); }}
                  className={`flex-1 text-white font-semibold py-2 rounded-md transition-colors ${confirmAction.action === 'cancel' ? 'bg-pkmn-red hover:bg-pkmn-red-dark' : 'bg-pkmn-yellow hover:bg-yellow-600'}`}
                >Confirm</button>
              </div>
            </div>
          </div>
        )}

        {/* Admin Reschedule Modal */}
        {rescheduleOrderId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={20} className="text-amber-600" />
                <h3 className="text-lg font-bold text-pkmn-text">Reschedule Order</h3>
              </div>
              <p className="text-sm text-pkmn-gray mb-4">
                Select a new pickup timeslot for this order. The customer will be notified via Discord.
              </p>
              <PickupTimeslotSelector
                value={rescheduleTimeslot}
                onChange={setRescheduleTimeslot}
              />
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => { setRescheduleOrderId(null); setRescheduleTimeslot(null); }}
                  className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2.5 rounded-md hover:bg-pkmn-bg transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdminReschedule}
                  disabled={!rescheduleTimeslot || rescheduling}
                  className="flex-1 bg-amber-600 text-white font-semibold py-2.5 rounded-md hover:bg-amber-700 transition-colors disabled:opacity-50 text-sm"
                >
                  {rescheduling ? 'Rescheduling...' : 'Confirm Reschedule'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}