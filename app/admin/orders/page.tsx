"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import TradeCalculator from '../../components/TradeCalculator';
import AdminOrderAdjustModal, { type AdminOrderAdjustOrder } from '../../components/AdminOrderAdjustModal';
import { API_BASE_URL as API } from '@/app/lib/api';

const PAGE_SIZE = 50;

interface Order extends AdminOrderAdjustOrder {
  item_title: string;
  item_price: string;
  quantity: number;
  display_items?: { item?: number; item_title: string; quantity: number; price_at_purchase?: string | null; subtotal?: string }[];
  items_summary?: string;
  discord_handle: string;
  created_at: string;
  cancellation_reason?: string | null;
  cancelled_by?: { email: string } | string | null;
  trade_offer?: { total_credit: string; cards: { card_name: string; estimated_value: string }[] };
}

const CANCELLABLE_STATUSES = new Set(['pending', 'cash_needed', 'trade_review', 'pending_counteroffer']);

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  cash_needed: 'Balance Due',
  trade_review: 'Trade Review',
  pending_counteroffer: 'Counteroffer',
};

const paymentLabels: Record<string, string> = {
  venmo: 'Venmo',
  zelle: 'Zelle',
  paypal: 'PayPal',
  trade: 'Trade-In',
  cash_plus_trade: 'Trade + Balance',
};

function formatPaymentLabel(value: string) {
  return paymentLabels[value] || value.replace('_', ' ');
}

function formatMoney(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function orderNetDue(order: Order) {
  const subtotal = (order.order_items ?? []).reduce((sum, item) => sum + Number(item.price_at_purchase) * item.quantity, 0);
  return Math.max(
    0,
    subtotal
      - Number(order.discount_applied || 0)
      - Number(order.trade_credit_applied || 0)
      - Number(order.store_credit_applied || 0),
  );
}

function displayItemsForOrder(order: Order) {
  if (order.display_items && order.display_items.length > 0) {
    return order.display_items;
  }
  const groups = new Map<string, { item?: number; item_title: string; quantity: number; price_at_purchase?: string | null }>();
  (order.order_items ?? []).forEach((line) => {
    const key = String(line.item ?? line.item_title);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      if (existing.price_at_purchase !== line.price_at_purchase) {
        existing.price_at_purchase = null;
      }
      return;
    }
    groups.set(key, {
      item: line.item,
      item_title: line.item_title,
      quantity: line.quantity,
      price_at_purchase: line.price_at_purchase,
    });
  });
  return Array.from(groups.values());
}

function normalizeStatusFilter(value: string) {
  if (value === 'active' || Object.prototype.hasOwnProperty.call(statusLabels, value)) return value;
  return '';
}

export default function AdminOrderHistoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
      </div>
    }>
      <AdminOrderHistory />
    </Suspense>
  );
}

function AdminOrderHistory() {
  const searchParams = useSearchParams();
  const { user } = useRequireAuth({ adminOnly: true });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(normalizeStatusFilter(searchParams.get('status') || ''));
  const [searchQuery, setSearchQuery] = useState(searchParams.get('user') || searchParams.get('email') || '');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [adjustTarget, setAdjustTarget] = useState<Order | null>(null);
  const [adjustMode, setAdjustMode] = useState<'items' | 'order'>('order');

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    axios.get(`${API}/api/orders/admin-history/?page=${currentPage}`, { headers })
      .then(r => {
        const data = r.data;
        setOrders(data.results ?? data);
        if (data.count !== undefined) setTotalCount(data.count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin, headers, currentPage]);

  function openAdjust(order: Order, mode: 'items' | 'order') {
    setAdjustTarget(order);
    setAdjustMode(mode);
  }

  function closeAdjust() {
    setAdjustTarget(null);
  }

  function handleOrderUpdated(updated: AdminOrderAdjustOrder) {
    setOrders(prev => prev.map(order => (order.id === updated.id ? { ...order, ...updated } : order)));
  }

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

  const filtered = orders.filter(o => {
    if (statusFilter === 'active') {
      if (!CANCELLABLE_STATUSES.has(o.status)) return false;
    } else if (statusFilter && o.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const itemsText = o.items_summary || o.item_title || '';
      return o.user_email?.toLowerCase().includes(q) || o.discord_handle?.toLowerCase().includes(q) || itemsText.toLowerCase().includes(q) || o.order_id?.toLowerCase().includes(q) || o.coupon_code?.toLowerCase().includes(q);
    }
    return true;
  });

  const statusColor: Record<string, string> = {
    pending: 'bg-pkmn-blue/15 text-pkmn-blue',
    fulfilled: 'bg-green-500/15 text-green-600',
    cancelled: 'bg-pkmn-red/15 text-pkmn-red',
    cash_needed: 'bg-pkmn-blue/15 text-pkmn-blue',
    trade_review: 'bg-purple-500/15 text-purple-600',
    pending_counteroffer: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark',
  };

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-black text-pkmn-text mb-1">Order History</h1>
        <p className="text-pkmn-gray mb-6">All orders across all statuses</p>

        {/* Quick Calculator */}
        <div className="mb-6">
          <TradeCalculator />
        </div>

        {/* Filters */}
        <div className="bg-white border border-pkmn-border p-4 mb-6 shadow-sm flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-pkmn-gray mb-1">Search</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Email, Discord, item, order ID..."
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
              <option value="">All</option>
              <option value="active">Current Orders</option>
              <option value="pending">Pending</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
              <option value="trade_review">Trade Review</option>
              <option value="cash_needed">Balance Due</option>
              <option value="pending_counteroffer">Counteroffer</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
          </div>
        ) : (
          <div className="bg-white border border-pkmn-border shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pkmn-border bg-pkmn-bg">
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Order ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Customer</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Item</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Qty</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Amount Due</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Payment</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Pickup / Delivery</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-pkmn-gray">No orders found</td>
                  </tr>
                ) : (
                  filtered.map((o) => {
                    const customerSummary = [o.user_email, o.discord_handle].filter(Boolean).join(' • ');
                    const displayItems = displayItemsForOrder(o);
                    const itemSummary = displayItems.map(item => `${item.item_title} x${item.quantity}`).join(', ');
                    const pickupSummary = o.delivery_details || o.pickup_timeslot || (o.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown');
                    const canCancelItems = ['pending', 'cash_needed'].includes(o.status) && (o.order_items?.length ?? 0) > 1 && Boolean(o.order_id);
                    const discountApplied = Number(o.discount_applied || 0);
                    const hasCoupon = Boolean(o.coupon_code && discountApplied > 0);
                    return (
                    <tr key={o.id} className="border-b border-pkmn-border even:bg-pkmn-bg/50 even: hover:bg-pkmn-bg">
                      <td className="py-3 px-4 font-mono text-xs whitespace-nowrap">{o.order_id ? <Link href={`/orders/${o.order_id}`} className="text-pkmn-blue hover:text-pkmn-blue-dark hover:underline">{o.order_id.slice(0, 8)}&hellip;</Link> : `#${o.id}`}</td>
                      <td className="py-3 px-4 text-pkmn-gray whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="py-3 px-4">
                        <p className="max-w-[220px] truncate text-pkmn-text font-medium whitespace-nowrap" title={customerSummary}>{customerSummary}</p>
                      </td>
                      <td className="py-3 px-4 text-pkmn-text">
                        <p className="max-w-[220px] truncate whitespace-nowrap" title={itemSummary}>{itemSummary}</p>
                      </td>
                      <td className="py-3 px-4 text-pkmn-gray-dark whitespace-nowrap">{displayItems.reduce((sum, item) => sum + item.quantity, 0)}</td>
                      <td className="py-3 px-4 text-pkmn-text whitespace-nowrap">
                        <p className="font-semibold">{formatMoney(orderNetDue(o))}</p>
                        {hasCoupon && (
                          <p className="mt-1 text-xs font-semibold text-green-600">
                            Promo {o.coupon_code} -${discountApplied.toFixed(2)}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-pkmn-gray-dark whitespace-nowrap">{formatPaymentLabel(o.payment_method)}</td>
                      <td className="py-3 px-4 text-pkmn-gray-dark">
                        <p className="max-w-[260px] truncate whitespace-nowrap" title={pickupSummary}>{pickupSummary}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${statusColor[o.status] || 'bg-pkmn-bg text-pkmn-text'}`}>
                          {statusLabels[o.status] || o.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {CANCELLABLE_STATUSES.has(o.status) && o.order_id ? (
                          <div className="flex justify-end gap-2">
                            {canCancelItems && (
                              <button
                                type="button"
                                onClick={() => openAdjust(o, 'items')}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md border border-pkmn-blue text-pkmn-blue hover:bg-pkmn-blue hover:text-white transition-colors whitespace-nowrap"
                              >
                                Cancel Items
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openAdjust(o, 'order')}
                              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white transition-colors whitespace-nowrap"
                            >
                              Cancel Order
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-pkmn-gray">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (() => {
          const totalPages = Math.ceil(totalCount / PAGE_SIZE);
          return (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                disabled={currentPage <= 1}
                onClick={() => { setCurrentPage(p => p - 1); }}
                className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-border bg-white text-pkmn-gray-dark hover:bg-pkmn-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-sm text-pkmn-gray">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => { setCurrentPage(p => p + 1); }}
                className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-border bg-white text-pkmn-gray-dark hover:bg-pkmn-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          );
        })()}
      </div>

      {adjustTarget && (
        <AdminOrderAdjustModal
          order={adjustTarget}
          headers={headers}
          initialMode={adjustMode}
          onClose={closeAdjust}
          onUpdated={handleOrderUpdated}
        />
      )}
    </div>
  );
}
