"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import TradeCalculator from '../../components/TradeCalculator';
import { API_BASE_URL as API } from '@/app/lib/api';

const PAGE_SIZE = 50;

interface OrderItem {
  id: number;
  item_title: string;
  quantity: number;
  price_at_purchase: string;
}

interface Order {
  id: number;
  order_id?: string;
  item_title: string;
  item_price: string;
  quantity: number;
  order_items?: OrderItem[];
  user_email: string;
  discord_handle: string;
  payment_method: string;
  delivery_method: string;
  pickup_timeslot?: string | null;
  delivery_details?: string | null;
  status: string;
  created_at: string;
  trade_offer?: { total_credit: string; cards: { card_name: string; estimated_value: string }[] };
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  cash_needed: 'Balance Due',
  trade_review: 'Trade Review',
  pending_counteroffer: 'Pending Counteroffer',
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

export default function AdminOrderHistory() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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
    if (statusFilter && o.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return o.user_email?.toLowerCase().includes(q) || o.discord_handle?.toLowerCase().includes(q) || o.item_title?.toLowerCase().includes(q) || o.order_id?.toLowerCase().includes(q);
    }
    return true;
  });

  const statusColor: Record<string, string> = {
    pending: 'bg-pkmn-blue/15 text-pkmn-blue',
    fulfilled: 'bg-green-500/100/100/100/15 text-green-600',
    cancelled: 'bg-pkmn-red/15 text-pkmn-red',
    cash_needed: 'bg-pkmn-blue/15 text-pkmn-blue',
    trade_review: 'bg-purple-500/100/100/100/15 text-purple-600',
    pending_counteroffer: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark',
  };

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-black text-pkmn-text mb-1">Order History</h1>
        <p className="text-pkmn-gray mb-6">All orders across all statuses</p>

        {/* Quick Calculator */}
        <div className="mb-6">
          <TradeCalculator />
        </div>

        {/* Filters */}
        <div className="bg-white border border-pkmn-border rounded-xl p-4 mb-6 shadow-sm flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-pkmn-gray mb-1">Search</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Email, Discord, item, order ID..."
                className="w-full pl-9 pr-4 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-pkmn-gray mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text bg-white focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
              <option value="trade_review">Trade Review</option>
              <option value="cash_needed">Balance Due</option>
              <option value="pending_counteroffer">Pending Counteroffer</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
          </div>
        ) : (
          <div className="bg-white border border-pkmn-border rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pkmn-border bg-pkmn-bg">
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Order ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Customer</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Item</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Qty</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Payment</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Pickup / Delivery</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-pkmn-gray">No orders found</td>
                  </tr>
                ) : (
                  filtered.map((o) => (
                    <tr key={o.id} className="border-b border-pkmn-border even:bg-pkmn-bg/50 even: hover:bg-pkmn-bg">
                      <td className="py-3 px-4 font-mono text-xs">{o.order_id ? <Link href={`/orders/${o.order_id}`} className="text-pkmn-blue hover:text-pkmn-blue-dark hover:underline">{o.order_id.slice(0, 8)}&hellip;</Link> : `#${o.id}`}</td>
                      <td className="py-3 px-4 text-pkmn-gray">{new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="py-3 px-4">
                        <p className="text-pkmn-text font-medium">{o.user_email}</p>
                        <p className="text-xs text-pkmn-gray">{o.discord_handle}</p>
                      </td>
                      <td className="py-3 px-4 text-pkmn-text">{(o.order_items ?? []).map(oi => `${oi.item_title} x${oi.quantity}`).join(', ')}</td>
                      <td className="py-3 px-4 text-pkmn-gray-dark">{(o.order_items ?? []).reduce((s, oi) => s + oi.quantity, 0)}</td>
                      <td className="py-3 px-4 text-pkmn-gray-dark">{formatPaymentLabel(o.payment_method)}</td>
                      <td className="py-3 px-4 text-pkmn-gray-dark max-w-[220px]">
                        {o.delivery_details || o.pickup_timeslot || (o.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor[o.status] || 'bg-pkmn-bg text-pkmn-text'}`}>
                          {statusLabels[o.status] || o.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))
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
                className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg border border-pkmn-border bg-white text-pkmn-gray-dark hover:bg-pkmn-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-sm text-pkmn-gray">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => { setCurrentPage(p => p + 1); }}
                className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg border border-pkmn-border bg-white text-pkmn-gray-dark hover:bg-pkmn-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
