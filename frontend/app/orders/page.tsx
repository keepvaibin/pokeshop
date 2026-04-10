"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../hooks/useRequireAuth';
import Navbar from '../components/Navbar';
import Spinner from '../components/Spinner';
import Link from 'next/link';
import { Package, AlertCircle, RefreshCw, DollarSign, XCircle, Calendar, CheckCircle, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import PickupTimeslotSelector, { type TimeslotSelection } from '../components/PickupTimeslotSelector';

interface Order {
  id: number;
  order_id?: string;
  item: number;
  item_title?: string;
  quantity: number;
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
  recurring_timeslot?: number | null;
  pickup_timeslot?: number | null;
  trade_offer?: { total_credit: string; credit_percentage: string; cards: { id: number; card_name: string; estimated_value: string; is_accepted: boolean | null }[] };
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  fulfilled: { label: 'Fulfilled', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
  cash_needed: { label: 'Cash Needed', color: 'bg-orange-100 text-orange-800' },
  trade_review: { label: 'Trade Under Review', color: 'bg-purple-100 text-purple-800' },
  pending_counteroffer: { label: 'Counteroffer Pending', color: 'bg-amber-100 text-amber-800' },
};

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
      const res = await axios.post('http://localhost:8000/api/orders/reschedule/', {
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
    <div className="mt-3 bg-red-50 border-2 border-red-300 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Calendar size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-red-800">Reschedule Required</p>
          <p className="text-xs text-red-700">
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
        className="w-full bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50 text-sm"
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

  const CANCELLABLE = ['pending', 'cash_needed', 'trade_review', 'pending_counteroffer'];

  const handleCancel = async (orderId: number) => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    setCancellingId(orderId);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(
        'http://localhost:8000/api/orders/cancel/',
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
      .get('http://localhost:8000/api/orders/my-orders/', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      .then((r) => setOrders(r.data))
      .catch((err) => { if (!controller.signal.aborted) setError('Failed to load your orders.'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [userEmail]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Package className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-800">My Orders</h1>
            <p className="text-gray-600 text-sm">Track your order history and status</p>
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading your orders..." />
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-800">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-12 text-center">
            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No Orders Yet</h2>
            <p className="text-gray-600 mb-6">You haven&apos;t placed any orders. Start shopping!</p>
            <Link href="/" className="inline-flex items-center gap-2 bg-blue-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
              Browse Shop
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const sc = statusConfig[order.status] || { label: order.status, color: 'bg-gray-100 dark:bg-gray-800 text-gray-600' };
              return (
                <div key={order.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                  <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">
                      {order.order_id ? (
                        <Link href={`/orders/${order.order_id}`} className="text-blue-600 hover:text-blue-800 hover:underline transition-colors">
                          {new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </Link>
                      ) : `Order #${order.id}`}
                    </h3>
                      {order.order_id && <p className="text-[10px] text-gray-400 font-mono">{order.order_id}</p>}
                      <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${sc.color}`}>
                      {sc.label}
                    </span>
                  </div>
                  <div className="px-6 py-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Item</p>
                        <p className="text-gray-900 dark:text-gray-100 font-medium">{order.item_title || `Item #${order.item}`}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Quantity</p>
                        <p className="text-gray-900 dark:text-gray-100 font-medium">{order.quantity}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Payment</p>
                        <p className="text-gray-900 dark:text-gray-100 font-medium capitalize">{order.payment_method.replace('_', ' ')}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Delivery</p>
                        <p className="text-gray-900 dark:text-gray-100 font-medium capitalize">{order.delivery_method}</p>
                      </div>
                      {order.trade_card_name && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase">Trade Card</p>
                          <p className="text-gray-900 dark:text-gray-100 font-medium">{order.trade_card_name} (${order.trade_card_value})</p>
                        </div>
                      )}
                      {order.preferred_pickup_time && (order.delivery_method === 'asap' || order.recurring_timeslot || order.pickup_timeslot) && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase">Pickup Time</p>
                          <p className="text-gray-900 dark:text-gray-100 font-medium">{order.preferred_pickup_time}</p>
                        </div>
                      )}
                    </div>
                    {order.trade_offer && order.trade_offer.cards.length > 0 && (
                      <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-blue-800 mb-1"><RefreshCw size={12} className="inline mr-1" />Trade Offer ({order.trade_offer.cards.length} card{order.trade_offer.cards.length > 1 ? 's' : ''}) — ${Number(order.trade_offer.total_credit).toFixed(2)} credit</p>
                        <div className="flex flex-wrap gap-1">
                          {order.trade_offer.cards.map((c) => (
                            <span key={c.id} className={`text-xs rounded px-2 py-0.5 flex items-center gap-1 ${
                              c.is_accepted === true ? 'bg-green-100 border border-green-200 text-green-800' :
                              c.is_accepted === false ? 'bg-red-100 border border-red-200 text-red-700 line-through' :
                              'bg-white dark:bg-gray-900 border border-blue-100 text-gray-700'
                            }`}>
                              {c.is_accepted === true && <CheckCircle size={10} className="text-green-600" />}
                              {c.is_accepted === false && <XCircle size={10} className="text-red-500" />}
                              {c.card_name} (${Number(c.estimated_value).toFixed(2)})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {CANCELLABLE.includes(order.status) && (
                      <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-800 flex items-start gap-2">
                        <MessageCircle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>Please message <strong>keepvaibin</strong> on Discord to facilitate your order.</span>
                      </div>
                    )}
                    {order.status === 'cash_needed' && (
                      <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                        <DollarSign size={14} className="inline mr-1" />
                        {order.payment_method === 'venmo'
                          ? 'Your trade was denied. Please pay via Venmo/Zelle to complete this order.'
                          : order.trade_offer && Number(order.trade_offer.total_credit) === 0
                            ? 'You declined the trade offer. Please pay the full balance via Venmo/Zelle.'
                            : 'Some trade cards were not accepted. Please pay the remaining balance via Venmo/Zelle.'}
                      </div>
                    )}
                    {order.status === 'trade_review' && (
                      <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
                        <RefreshCw size={14} className="inline mr-1" />Your trade offer is being reviewed by the store admin.
                      </div>
                    )}
                    {order.status === 'pending_counteroffer' && order.order_id && (
                      <Link
                        href={`/orders/${order.order_id}`}
                        className="mt-3 flex items-center gap-2 bg-amber-50 border-2 border-amber-400 rounded-lg p-3 text-sm text-amber-900 font-semibold hover:bg-amber-100 transition-colors animate-pulse"
                      >
                        <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
                        Action Required: Review Counteroffer
                      </Link>
                    )}
                    {order.status === 'cancelled' && order.cancellation_penalty && (
                      <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                        <AlertCircle size={14} className="inline mr-1" />Late cancellation — penalty applied (cancelled within 24h of pickup).
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
                          className="flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <XCircle size={14} />
                          {cancellingId === order.id ? 'Cancelling...' : 'Cancel Order'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
