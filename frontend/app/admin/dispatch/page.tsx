"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { CheckCircle, XCircle, AlertCircle, Ban, Search, Filter, ThumbsUp, Star } from 'lucide-react';
import toast from 'react-hot-toast';

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

interface Order {
  id: number;
  item_title: string;
  item_price: string;
  quantity: number;
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
  created_at: string;
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
    axios.get(`http://localhost:8000/api/orders/dispatch/?${params.toString()}`, { headers, signal })
      .then(r => { if (!signal?.aborted) setOrders(r.data); })
      .catch(err => { if (!axios.isCancel(err)) console.error(err); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchOrders(controller.signal);
    return () => controller.abort();
  }, [isAdmin, statusFilter, paymentFilter]);

  const handleSearch = () => fetchOrders();

  const handleAction = async (orderId: number, action: string) => {
    setIsProcessing(orderId);
    try {
      const res = await axios.post('http://localhost:8000/api/orders/dispatch/', { order_id: orderId, action }, { headers });
      const updated = res.data;
      // Remove from list if it left the active statuses
      if (['fulfilled', 'cancelled'].includes(updated.status)) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
      }
      const labels: Record<string, string> = { fulfill: 'fulfilled', cancel: 'cancelled', deny_trade: 'trade denied', approve_trade: 'trade approved' };
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
      const res = await axios.post('http://localhost:8000/api/orders/dispatch/', {
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
    const decisions = cardDecisions[orderId];
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
      const res = await axios.post('http://localhost:8000/api/orders/dispatch/', {
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
      // Oracle card — apply condition multiplier to NM base price
      const basePrice = Number(card.base_market_price);
      const condMul = CONDITION_MULTIPLIERS[card.condition] ?? 0.85;
      return parseFloat((basePrice * condMul * creditPct).toFixed(2));
    } else {
      // Manual card — estimated_value already condition-adjusted
      return parseFloat((Number(card.estimated_value) * creditPct).toFixed(2));
    }
  };

  const setCardOverride = (orderId: number, cardId: string, value: string) => {
    setCardOverrides(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || {}), [cardId]: value },
    }));
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
    const salePrice = (Number(order.item_price) || 0) * order.quantity;
    const cashDue = Math.max(0, salePrice - newCredit);
    return { newCredit, salePrice, cashDue };
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: 'bg-blue-100 text-blue-800',
      trade_review: 'bg-purple-100 text-purple-800',
      cash_needed: 'bg-orange-100 text-orange-800',
      pending_counteroffer: 'bg-amber-100 text-amber-800',
    };
    return map[s] || 'bg-gray-100 text-gray-800';
  };

  if (!user?.is_admin) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Redirecting to login&hellip;</p>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-100 min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900">Dispatch</h1>
            <p className="text-gray-600">Manage pending orders</p>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border-2 border-blue-500">
            <p className="text-2xl font-bold text-blue-600">{orders.length}</p>
            <p className="text-xs text-gray-600">Orders</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Search</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Email, Discord, item..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="trade_review">Trade Review</option>
                <option value="cash_needed">Cash Needed</option>
                <option value="pending_counteroffer">Counteroffer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Payment</label>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Methods</option>
                <option value="trade">Trade-In</option>
                <option value="cash_plus_trade">Cash + Trade</option>
                <option value="venmo">Venmo</option>
                <option value="zelle">Zelle</option>
                <option value="paypal">PayPal</option>
              </select>
            </div>
            <button onClick={handleSearch} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1">
              <Filter size={14} /> Filter
            </button>
          </div>
        </div>

        {/* Orders */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Loading orders...</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-8 sm:p-12 text-center">
            <div className="text-5xl mb-4"><CheckCircle className="w-12 h-12 text-green-500 mx-auto" /></div>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">All Caught Up!</h3>
            <p className="text-gray-600">No orders match your filters.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => (
              <div key={order.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 sm:px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Order #{order.id}</h3>
                      <p className="text-sm text-gray-600">{order.item_title} × {order.quantity} — ${(Number(order.item_price) || 0).toFixed(2)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(order.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(order.status)}`}>
                        {order.status.replace('_', ' ').toUpperCase()}
                      </span>
                      {order.payment_method === 'trade' && (
                        <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold">Trade</span>
                      )}
                      {order.payment_method === 'cash_plus_trade' && (
                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold">Cash+Trade</span>
                      )}
                      {!['trade', 'cash_plus_trade'].includes(order.payment_method) && (
                        <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-semibold">{order.payment_method.toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="px-4 sm:px-6 py-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Customer</p>
                      <p className="text-gray-900 font-medium text-sm">{order.user_email}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Discord</p>
                      <p className="text-gray-900 font-medium text-sm">{order.discord_handle}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Delivery</p>
                      <p className="text-gray-900 font-medium text-sm">{order.delivery_method === 'scheduled' ? 'Scheduled' : 'ASAP'}</p>
                    </div>
                  </div>

                  {/* Multi-card trade offer */}
                  {order.trade_offer && order.trade_offer.cards.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <h4 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                        Trade Offer — {order.trade_offer.cards.length} card{order.trade_offer.cards.length > 1 ? 's' : ''}
                        <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
                          {order.trade_offer.credit_percentage}% rate — ${(Number(order.trade_offer.total_credit) || 0).toFixed(2)} credit
                        </span>
                        {order.trade_offer.trade_mode === 'allow_partial' && (
                          <span className="text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">Partial OK</span>
                        )}
                      </h4>
                      <div className="space-y-2">
                        {order.trade_offer.cards.map((card) => {
                          const decisions = cardDecisions[order.id] || {};
                          const overrides = cardOverrides[order.id] || {};
                          const cardDecision = decisions[String(card.id)];
                          const isPartial = order.trade_offer?.trade_mode === 'allow_partial' && order.status === 'trade_review';
                          const creditPct = Number(order.trade_offer?.credit_percentage || 85) / 100;
                          const defaultCredit = getDefaultCardCredit(card, creditPct);
                          return (
                            <div key={card.id} className={`rounded-lg px-3 py-2 ${
                              card.is_accepted === true ? 'bg-green-50 border border-green-200' :
                              card.is_accepted === false ? 'bg-red-50 border border-red-200' :
                              'bg-white border border-yellow-100'
                            }`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900 text-sm">{card.card_name}</span>
                                  {card.is_wanted_card && (
                                    <span className="bg-yellow-100 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                      <Star size={10} /> WANTED
                                    </span>
                                  )}
                                  <span className="text-xs text-gray-500 capitalize">{card.condition?.replace('_', ' ')}</span>
                                  {card.rarity && <span className="text-xs text-purple-600">{card.rarity}</span>}
                                  {card.is_accepted === true && <span className="text-xs text-green-700 font-semibold">Accepted</span>}
                                  {card.is_accepted === false && <span className="text-xs text-red-700 font-semibold">Rejected</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  {card.base_market_price && (
                                    <span className="text-xs text-gray-400">Oracle NM: ${Number(card.base_market_price).toFixed(2)}</span>
                                  )}
                                  {card.custom_price && (
                                    <span className="text-xs text-blue-600 font-semibold">User: ${Number(card.custom_price).toFixed(2)}</span>
                                  )}
                                  <span className="text-xs text-gray-500">Used: ${(Number(card.estimated_value) || 0).toFixed(2)}</span>
                                  {card.card_name && (
                                    <a
                                      href={`https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(card.card_name)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-500 hover:underline whitespace-nowrap"
                                    >
                                      TCGPlayer ↗
                                    </a>
                                  )}
                                  {isPartial && (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => toggleCardDecision(order.id, String(card.id), 'accept')}
                                        className={`px-2 py-1 rounded text-xs font-semibold transition-all ${cardDecision === 'accept' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'}`}
                                      >
                                        <CheckCircle size={12} className="inline mr-0.5" />Accept
                                      </button>
                                      <button
                                        onClick={() => toggleCardDecision(order.id, String(card.id), 'reject')}
                                        className={`px-2 py-1 rounded text-xs font-semibold transition-all ${cardDecision === 'reject' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700'}`}
                                      >
                                        <XCircle size={12} className="inline mr-0.5" />Reject
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {/* Price override input — visible when card is accepted in partial mode */}
                              {isPartial && cardDecision === 'accept' && (
                                <div className="mt-2 flex items-center gap-2 text-sm">
                                  <label className="text-xs text-gray-500 whitespace-nowrap">Final Net Credit Offer ($):</label>
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder={defaultCredit.toFixed(2)}
                                      value={overrides[String(card.id)] ?? ''}
                                      onChange={(e) => setCardOverride(order.id, String(card.id), e.target.value)}
                                      className="w-28 pl-5 pr-2 py-1 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400">auto: ${defaultCredit.toFixed(2)}</span>
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
                          <div className="mt-3 bg-white border border-blue-200 rounded-lg p-3 space-y-1 text-sm">
                            <div className="flex justify-between"><span className="text-gray-600">Final net trade credit:</span><span className="font-semibold text-green-700">${calc.newCredit.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-600">Sale price:</span><span className="font-semibold">${calc.salePrice.toFixed(2)}</span></div>
                            <div className="flex justify-between border-t border-blue-100 pt-1"><span className="text-gray-800 font-semibold">Cash due:</span><span className={`font-bold ${calc.cashDue > 0 ? 'text-orange-600' : 'text-green-600'}`}>${calc.cashDue.toFixed(2)}</span></div>
                          </div>
                        ) : null;
                      })()}

                      {order.buy_if_trade_denied && (
                        <p className="text-xs text-blue-700 mt-2 font-medium">Buyer opted to purchase with cash if trade is denied.</p>
                      )}
                    </div>
                  )}

                  {/* Legacy single-card trade */}
                  {!order.trade_offer && (order.payment_method === 'trade' || order.payment_method === 'cash_plus_trade') && order.trade_card_name && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <h4 className="font-semibold text-yellow-900 mb-2">Trade-In Card</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-yellow-700">Card Name</p>
                          <p className="text-yellow-900 font-bold">{order.trade_card_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-yellow-700">Value</p>
                          <p className="text-yellow-900 font-bold">${order.trade_card_value || '0.00'}</p>
                        </div>
                      </div>
                      {order.buy_if_trade_denied && (
                        <p className="text-xs text-blue-700 mt-2 font-medium">Buyer opted to purchase with cash if trade is denied.</p>
                      )}
                    </div>
                  )}

                  {order.preferred_pickup_time && (
                    <p className="text-xs text-gray-500">Preferred: {order.preferred_pickup_time}</p>
                  )}

                  {order.status === 'cash_needed' && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800 font-medium">
                      Cash payment needed — trade was denied but buyer opted to pay cash.
                    </div>
                  )}
                </div>

                {/* Actions */}
                {['pending', 'trade_review', 'cash_needed', 'pending_counteroffer'].includes(order.status) ? (
                <div className="bg-gray-50 px-4 sm:px-6 py-4 space-y-3">
                  {/* Counteroffer message input — visible for trade_review orders */}
                  {order.status === 'trade_review' && order.trade_offer && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Counteroffer Message (optional)</label>
                      <textarea
                        value={counterofferMsg[order.id] || ''}
                        onChange={(e) => setCounterofferMsg(prev => ({ ...prev, [order.id]: e.target.value }))}
                        placeholder="Explain your offer to the customer..."
                        rows={2}
                        className="w-full p-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  {order.status === 'trade_review' && order.trade_offer?.trade_mode === 'allow_partial' && (
                    <>
                      <button
                        onClick={() => handlePartialTradeReview(order.id)}
                        disabled={isProcessing === order.id || !cardDecisions[order.id] || Object.keys(cardDecisions[order.id] || {}).length === 0}
                        className="flex-1 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={18} /> Submit Partial Review
                      </button>
                      <button
                        onClick={() => handleSendCounteroffer(order.id)}
                        disabled={isProcessing === order.id || !cardDecisions[order.id] || Object.keys(cardDecisions[order.id] || {}).length === 0}
                        className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <AlertCircle size={18} /> Send Counteroffer
                      </button>
                    </>
                  )}
                  {order.status === 'trade_review' && (
                    <button
                      onClick={() => handleAction(order.id, 'approve_trade')}
                      disabled={isProcessing === order.id}
                      className="flex-1 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <ThumbsUp size={18} /> Approve All
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(order.id, 'fulfill')}
                    disabled={isProcessing === order.id || order.status === 'trade_review'}
                    className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={18} /> Fulfill
                  </button>
                  {(order.payment_method === 'trade' || order.payment_method === 'cash_plus_trade') && (
                    <button
                      onClick={() => setConfirmAction({ orderId: order.id, action: 'deny_trade', label: 'Deny Trade' })}
                      disabled={isProcessing === order.id}
                      className="flex-1 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Ban size={18} /> Deny Trade
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmAction({ orderId: order.id, action: 'cancel', label: 'Cancel / No-Show' })}
                    disabled={isProcessing === order.id}
                    className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <XCircle size={18} /> No-Show
                  </button>
                  </div>
                </div>
                ) : (
                <div className="bg-gray-100 px-4 sm:px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Ban size={16} />
                    <span className="text-sm font-semibold">Order is locked. Current Status: <span className="uppercase">{order.status.replace('_', ' ')}</span></span>
                  </div>
                </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Confirmation Dialog */}
        {confirmAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
              <div className="text-4xl mb-3"><AlertCircle className="w-10 h-10 text-yellow-500 mx-auto" /></div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{confirmAction.label}?</h3>
              <p className="text-gray-600 text-sm mb-6">
                {confirmAction.action === 'deny_trade'
                  ? 'This will deny the trade offer. If the buyer opted in, the order will switch to cash payment.'
                  : 'This will cancel the order and restock the item.'}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmAction(null)} className="flex-1 border border-gray-300 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-50 transition-colors">Go Back</button>
                <button
                  onClick={() => { handleAction(confirmAction.orderId, confirmAction.action); setConfirmAction(null); }}
                  className={`flex-1 text-white font-semibold py-2 rounded-lg transition-colors ${confirmAction.action === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-500 hover:bg-yellow-600'}`}
                >Confirm</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}