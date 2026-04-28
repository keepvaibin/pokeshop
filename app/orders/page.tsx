"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../hooks/useRequireAuth';
import Navbar from '../components/Navbar';
import Spinner from '../components/Spinner';
import Link from 'next/link';
import { Package, AlertCircle, RefreshCw, DollarSign, XCircle, Calendar, CheckCircle, MessageCircle, ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import PickupTimeslotSelector, { type TimeslotSelection } from '../components/PickupTimeslotSelector';
import { API_BASE_URL as API } from '@/app/lib/api';

const PAGE_SIZE = 50;

interface OrderItem {
  id: number;
  item: number;
  item_title: string;
  item_price: string;
  quantity: number;
  price_at_purchase: string;
}

interface Order {
  id: number;
  order_id?: string;
  item: number;
  item_title?: string;
  quantity: number;
  order_items?: OrderItem[];
  payment_method: string;
  delivery_method: string;
  discord_handle: string;
  status: string;
  trade_card_name?: string;
  trade_card_value?: string;
  buy_if_trade_denied?: boolean;
  preferred_pickup_time?: string;
  created_at: string;
  cancelled_at?: string | null;
  cancellation_penalty?: boolean;
  requires_rescheduling?: boolean;
  reschedule_deadline?: string | null;
  recurring_timeslot?: string | null;
  pickup_timeslot?: string | null;
  pickup_date?: string | null;
  pickup_rescheduled_by_user?: boolean;
  delivery_details?: string | null;
  trade_offer?: { total_credit: string; credit_percentage: string; cards: { id: number; card_name: string; estimated_value: string; is_accepted: boolean | null }[] };
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
  fulfilled: { label: 'Fulfilled', color: 'bg-green-500/15 text-green-600' },
  cancelled: { label: 'Cancelled', color: 'bg-pkmn-red/15 text-pkmn-red' },
  cash_needed: { label: 'Balance Due', color: 'bg-pkmn-blue/15 text-pkmn-blue' },
  trade_review: { label: 'Trade Review', color: 'bg-purple-500/15 text-purple-600' },
  pending_counteroffer: { label: 'Counteroffer', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
};

const paymentLabels: Record<string, string> = {
  venmo: 'Venmo',
  zelle: 'Zelle',
  paypal: 'PayPal',
  cash: 'Cash',
  trade: 'Trade-In',
  cash_plus_trade: 'Trade + Balance',
};

function formatPaymentLabel(value: string) {
  return paymentLabels[value] || value.replace('_', ' ');
}

function RescheduleBanner({ order, onRescheduled }: { order: Order; onRescheduled: (o: Order) => void }) {
  const [selectedTimeslot, setSelectedTimeslot] = useState<TimeslotSelection | null>(null);
  const [saving, setSaving] = useState(false);

  const deadline = order.reschedule_deadline ? new Date(order.reschedule_deadline) : null;
  const hoursLeft = deadline ? Math.max(0, (deadline.getTime() - Date.now()) / 3600000) : 0;

  const handleReschedule = async () => {
    if (!selectedTimeslot) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(`${API}/api/orders/reschedule/`, {
        order_id: order.id,
        recurring_timeslot_id: selectedTimeslot.recurring_timeslot_id,
        pickup_date: selectedTimeslot.pickup_date,
      }, { headers: { Authorization: `Bearer ${token}` } });
      onRescheduled(res.data);
      toast.success('Order rescheduled successfully!');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to reschedule order');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 bg-pkmn-red/10 border-2 border-pkmn-red/30 rounded-md p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Calendar size={18} className="text-pkmn-red flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-pkmn-red">Reschedule Required</p>
          <p className="text-xs text-pkmn-red">
            Your pickup timeslot was removed. Please select a new time.
            {hoursLeft > 0 && <> You have <strong>{hoursLeft.toFixed(1)} hours</strong> before auto-cancellation.</>}
          </p>
        </div>
      </div>
      <PickupTimeslotSelector
        value={selectedTimeslot}
        onChange={setSelectedTimeslot}
      />
      <button
        onClick={handleReschedule}
        disabled={!selectedTimeslot || saving}
        className="w-full bg-pkmn-red text-white font-bold py-2 px-4 rounded-md hover:bg-pkmn-red-dark transition-all active:scale-95 disabled:opacity-50 text-sm"
      >
        {saving ? 'Rescheduling...' : 'Confirm New Timeslot'}
      </button>
    </div>
  );
}

export default function OrdersPage() {
  const { user } = useRequireAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [tradeInsEnabled, setTradeInsEnabled] = useState(true);

  const CANCELLABLE = ['pending', 'cash_needed', 'trade_review', 'pending_counteroffer'];

  const handleCancel = async (orderId: number) => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    setCancellingId(orderId);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(
        `${API}/api/orders/cancel/`,
        { order_id: orderId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setOrders((prev) => prev.map((o) => (o.id === orderId ? res.data : o)));
      toast.success(res.data.cancellation_penalty
        ? 'Order cancelled (late cancellation penalty applied)'
        : 'Order cancelled successfully');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to cancel order');
      }
    } finally {
      setCancellingId(null);
    }
  };

  const userEmail = user?.email;
  useEffect(() => {
    if (!userEmail) return;
    const token = localStorage.getItem('access_token');
    const controller = new AbortController();
    axios
      .get(`${API}/api/orders/my-orders/?page=${currentPage}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      .then((r) => {
        const data = r.data;
        setOrders(data.results ?? data);
        if (data.count !== undefined) setTotalCount(data.count);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load your orders.'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [userEmail, currentPage]);

  // Fetch wallet balance once on mount.
  useEffect(() => {
    if (!userEmail) return;
    const token = localStorage.getItem('access_token');
    axios
      .get(`${API}/api/trade-ins/wallet/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => setWalletBalance(String(r.data?.balance ?? '0.00')))
      .catch(() => setWalletBalance('0.00'));
  }, [userEmail]);

  // Fetch shop settings to check if trade-ins are open.
  useEffect(() => {
    axios
      .get(`${API}/api/inventory/settings/`)
      .then((r) => setTradeInsEnabled(r.data?.trade_ins_enabled !== false))
      .catch(() => {});
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Package className="w-8 h-8 text-pkmn-blue" />
          <div>
            <h1 className="text-3xl font-heading font-bold text-pkmn-text uppercase">My Orders</h1>
            <p className="text-pkmn-gray text-sm">Track your order history and status</p>
          </div>
        </div>

        {/* Wallet & Trade-In Card */}
        <div className="pkc-panel mb-6 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-2 border-pkmn-blue/20 bg-pkmn-blue/5">
          <div className="flex items-center gap-3">
            <Wallet className="w-7 h-7 text-pkmn-blue" />
            <div>
              <p className="text-xs font-semibold text-pkmn-gray uppercase">Store Credit Balance</p>
              <p className="text-2xl font-bold text-pkmn-text">
                ${walletBalance ?? '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tradeInsEnabled ? (
              <Link
                href="/trade-in"
                className="pkc-button-primary no-underline hover:no-underline text-sm"
              >
                Submit a Trade-In
              </Link>
            ) : (
              <span className="px-4 py-2 text-sm font-semibold rounded-md bg-gray-100 text-gray-400 cursor-not-allowed">
                Trade-Ins Closed
              </span>
            )}
            <Link
              href="/trade-in/history"
              className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-blue text-pkmn-blue hover:bg-pkmn-blue hover:text-white transition-colors no-underline"
            >
              History
            </Link>
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading your orders..." />
        ) : error ? (
          <div className="bg-pkmn-red/10 border border-pkmn-red/20 p-6 text-center">
            <AlertCircle className="w-8 h-8 text-pkmn-red mx-auto mb-2" />
            <p className="text-pkmn-red">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="pkc-panel border-2 border-dashed border-pkmn-border p-12 text-center">
            <Package className="w-16 h-16 text-pkmn-gray-dark mx-auto mb-4" />
            <h2 className="text-2xl font-heading font-bold text-pkmn-text mb-2 uppercase">No Orders Yet</h2>
            <p className="text-pkmn-gray mb-6">You haven&apos;t placed any orders. Start shopping!</p>
            <Link href="/" className="pkc-button-primary no-underline hover:no-underline">
              Browse Shop
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const sc = statusConfig[order.status] || { label: order.status, color: 'bg-pkmn-bg text-pkmn-gray' };
              return (
                <div key={order.id} className="pkc-panel overflow-hidden transition-colors duration-[120ms] ease-out hover:border-pkmn-gray-mid">
                  <div className="px-6 py-4 flex items-center justify-between border-b border-pkmn-border">
                    <div>
                      <h3 className="font-bold text-pkmn-text">
                      {order.order_id ? (
                        <Link href={`/orders/${order.order_id}`} className="text-pkmn-blue hover:text-pkmn-blue-dark hover:underline transition-colors">
                          {new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </Link>
                      ) : `Order #${order.id}`}
                    </h3>
                      {order.order_id && <p className="text-[10px] text-pkmn-gray-dark font-mono">{order.order_id}</p>}
                      <p className="text-xs text-pkmn-gray">{new Date(order.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full whitespace-nowrap px-3 py-1 text-xs font-semibold ${sc.color}`}>
                      {sc.label}
                    </span>
                  </div>
                  <div className="px-6 py-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                      <div className="sm:col-span-2">
                        <p className="text-xs font-semibold text-pkmn-gray uppercase">Items</p>
                        <ul className="text-pkmn-text font-medium">
                          {(order.order_items ?? []).map((oi) => (
                            <li key={oi.id} className="truncate">{oi.item_title} x{oi.quantity}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-pkmn-gray uppercase">Payment</p>
                        <p className="text-pkmn-text font-medium whitespace-nowrap">{formatPaymentLabel(order.payment_method)}</p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-xs font-semibold text-pkmn-gray uppercase">Pickup / Delivery</p>
                        <p className="text-pkmn-text font-medium truncate">
                          {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                        </p>
                      </div>
                      {order.trade_card_name && (
                        <div>
                          <p className="text-xs font-semibold text-pkmn-gray uppercase">Trade Card</p>
                          <p className="text-pkmn-text font-medium">{order.trade_card_name} (${order.trade_card_value})</p>
                        </div>
                      )}
                    </div>
                    {order.trade_offer && order.trade_offer.cards.length > 0 && (
                      <div className="mt-3 bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-md p-3">
                        <p className="text-xs font-semibold text-pkmn-blue mb-1"><RefreshCw size={12} className="inline mr-1" />Trade Offer ({order.trade_offer.cards.length} card{order.trade_offer.cards.length > 1 ? 's' : ''}) - ${Number(order.trade_offer.total_credit).toFixed(2)} credit</p>
                        <div className="flex flex-wrap gap-1">
                          {order.trade_offer.cards.map((c) => (
                            <span key={c.id} className={`text-xs rounded px-2 py-0.5 flex items-center gap-1 ${
                              c.is_accepted === true ? 'bg-green-500/15 border border-green-500/20 text-green-600' :
                              c.is_accepted === false ? 'bg-pkmn-red/15 border border-pkmn-red/20 text-pkmn-red line-through' :
                              'bg-white border border-pkmn-blue/10 text-pkmn-gray-dark'
                            }`}>
                              {c.is_accepted === true && <CheckCircle size={10} className="text-green-600" />}
                              {c.is_accepted === false && <XCircle size={10} className="text-pkmn-red" />}
                              {c.card_name} (${Number(c.estimated_value).toFixed(2)})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {CANCELLABLE.includes(order.status) && (
                      <div className="mt-3 bg-indigo-500/10 border border-indigo-500/20 rounded-md p-3 text-sm text-indigo-600 flex items-start gap-2">
                        <MessageCircle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>Please message <strong>keepvaibin</strong> on Discord to facilitate your order.</span>
                      </div>
                    )}
                    {order.status === 'cash_needed' && (
                      <div className="mt-3 bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-md p-3 text-sm text-pkmn-blue">
                        <DollarSign size={14} className="inline mr-1" />
                        {order.payment_method === 'venmo'
                          ? 'Your order is still active and now just needs the remaining balance before pickup.'
                          : order.trade_offer && Number(order.trade_offer.total_credit) === 0
                            ? 'The trade credit was removed, so the remaining balance needs to be paid before pickup.'
                            : 'Your order is still active. There is a remaining balance due before pickup.'}
                      </div>
                    )}
                    {order.status === 'trade_review' && (
                      <div className="mt-3 bg-purple-500/10 border border-purple-500/20 rounded-md p-3 text-sm text-purple-600">
                        <RefreshCw size={14} className="inline mr-1" />Your trade offer is being reviewed by the store admin.
                      </div>
                    )}
                    {order.status === 'pending_counteroffer' && order.order_id && (
                      <Link
                        href={`/orders/${order.order_id}`}
                        className="mt-3 inline-flex items-center gap-2 whitespace-nowrap bg-pkmn-yellow/10 border-2 border-pkmn-yellow rounded-md p-3 text-sm text-pkmn-text font-semibold hover:bg-pkmn-yellow/15 transition-colors animate-pulse"
                      >
                        <AlertCircle size={16} className="text-pkmn-yellow-dark flex-shrink-0" />
                        Review Counteroffer
                      </Link>
                    )}
                    {order.status === 'cancelled' && order.cancellation_penalty && (
                      <div className="mt-3 bg-pkmn-red/10 border border-pkmn-red/20 rounded-md p-3 text-sm text-pkmn-red">
                        <AlertCircle size={14} className="inline mr-1" />Late cancellation - penalty applied (cancelled within 24h of pickup).
                      </div>
                    )}
                    {order.requires_rescheduling && (
                      <RescheduleBanner
                        order={order}
                        onRescheduled={(updated) => setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))}
                      />
                    )}
                    {CANCELLABLE.includes(order.status) && (
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => handleCancel(order.id)}
                          disabled={cancellingId === order.id}
                          className="flex items-center gap-1.5 text-sm font-semibold text-pkmn-red hover:text-pkmn-red hover:bg-pkmn-red/10 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                        >
                          <XCircle size={14} />
                          {cancellingId === order.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (() => {
          const totalPages = Math.ceil(totalCount / PAGE_SIZE);
          return (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                disabled={currentPage <= 1}
                onClick={() => { setCurrentPage(p => p - 1); setLoading(true); }}
                className="pkc-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-sm text-pkmn-gray">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => { setCurrentPage(p => p + 1); setLoading(true); }}
                className="pkc-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
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
