"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import TradeCalculator from '../../components/TradeCalculator';

const PAGE_SIZE = 50;

interface Order {
  id: number;
  order_id?: string;
  item_title: string;
  item_price: string;
  quantity: number;
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
    axios.get(`http://localhost:8000/api/orders/admin-history/?page=${currentPage}`, { headers })
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-zinc-400">Redirecting to login&hellip;</p>
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
    pending: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
    fulfilled: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
    cash_needed: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
    trade_review: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
    pending_counteroffer: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300',
  };

  return (
    <div className="bg-gray-100 dark:bg-zinc-950 min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-black text-gray-900 dark:text-zinc-100 mb-1">Order History</h1>
        <p className="text-gray-600 dark:text-zinc-400 mb-6">All orders across all statuses</p>

        {/* Quick Calculator */}
        <div className="mb-6">
          <TradeCalculator />
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 mb-6 shadow-sm flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1">Search</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Email, Discord, item, order ID..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-zinc-800 rounded-lg text-sm text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-zinc-800 rounded-lg text-sm text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:outline-none transition-colors duration-200"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
              <option value="trade_review">Trade Review</option>
              <option value="cash_needed">Cash Needed</option>
              <option value="pending_counteroffer">Pending Counteroffer</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950">
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Order ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Customer</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Item</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Qty</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Payment</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Pickup / Delivery</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500 dark:text-zinc-400">No orders found</td>
                  </tr>
                ) : (
                  filtered.map((o) => (
                    <tr key={o.id} className="border-b border-gray-100 dark:border-zinc-800/50 even:bg-gray-50/50 even:dark:bg-zinc-950/30 hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                      <td className="py-3 px-4 font-mono text-xs">{o.order_id ? <Link href={`/orders/${o.order_id}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-300 hover:underline">{o.order_id.slice(0, 8)}&hellip;</Link> : `#${o.id}`}</td>
                      <td className="py-3 px-4 text-gray-600 dark:text-zinc-400">{new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="py-3 px-4">
                        <p className="text-gray-900 dark:text-zinc-100 font-medium">{o.user_email}</p>
                        <p className="text-xs text-gray-500 dark:text-zinc-400">{o.discord_handle}</p>
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-zinc-100">{o.item_title}</td>
                      <td className="py-3 px-4 text-gray-700 dark:text-zinc-400">{o.quantity}</td>
                      <td className="py-3 px-4 text-gray-700 dark:text-zinc-400 capitalize">{o.payment_method.replace('_', ' ')}</td>
                      <td className="py-3 px-4 text-gray-700 dark:text-zinc-400 max-w-[220px]">
                        {o.delivery_details || o.pickup_timeslot || (o.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor[o.status] || 'bg-gray-100 dark:bg-zinc-900 text-gray-800 dark:text-zinc-400'}`}>
                          {o.status.replace('_', ' ')}
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
                className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-sm text-gray-600 dark:text-zinc-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => { setCurrentPage(p => p + 1); }}
                className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
