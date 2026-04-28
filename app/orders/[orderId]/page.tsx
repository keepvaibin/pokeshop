"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import Spinner from '../../components/Spinner';
import Link from 'next/link';
import { ArrowLeft, Printer, Package, CheckCircle, XCircle, MessageCircle, Calendar, CreditCard, RefreshCw } from 'lucide-react';
import PickupTimeslotSelector, { type TimeslotSelection } from '../../components/PickupTimeslotSelector';
import toast from 'react-hot-toast';

interface TradeCard {
  id: number;
  card_name: string;
  estimated_value: string;
  condition: string;
  rarity: string;
  is_wanted_card: boolean;
  approved: boolean | null;
  is_accepted: boolean | null;
  admin_override_value: string | null;
  computed_credit: string | null;
  is_countered: boolean;
  is_rejected: boolean;
}

interface TradeOffer {
  id: number;
  total_credit: string;
  credit_percentage: string;
  trade_mode: string;
  cards: TradeCard[];
}

interface TimelineEvent {
  timestamp: string;
  event: string;
  detail: string;
}

interface OrderItemDetail {
  id: number;
  item: number;
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
  payment_method: string;
  delivery_method: string;
  discord_handle: string;
  status: string;
  created_at: string;
  preferred_pickup_time?: string;
  trade_offer?: TradeOffer;
  buy_if_trade_denied: boolean;
  trade_overage: string;
  backup_payment_method: string;
  counteroffer_message?: string;
  counteroffer_expires_at?: string | null;
  recurring_timeslot?: string | null;
  pickup_timeslot?: string | null;
  delivery_details?: string | null;
  resolution_summary?: TimelineEvent[];
  coupon_code?: string;
  discount_applied?: string;
  requires_rescheduling?: boolean;
  reschedule_deadline?: string | null;
  pickup_date?: string | null;
  pickup_rescheduled_by_user?: boolean;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: { email?: string } | string | null;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-white/20 text-white border-white/30' },
  fulfilled: { label: 'Fulfilled', color: 'bg-green-400 text-white border-green-500' },
  cancelled: { label: 'Cancelled', color: 'bg-pkmn-red text-white border-pkmn-red-dark' },
  cash_needed: { label: 'Balance Due', color: 'bg-pkmn-yellow text-pkmn-gray-dark border-pkmn-yellow-dark' },
  trade_review: { label: 'Trade Review', color: 'bg-white/20 text-white border-white/30' },
  pending_counteroffer: { label: 'Counteroffer', color: 'bg-pkmn-yellow text-pkmn-gray-dark border-pkmn-yellow-dark' },
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

interface RecurringSlot {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function RescheduleSection({ order, onUpdate }: { order: Order; onUpdate: (o: Order) => void }) {
  const [slots, setSlots] = useState<RecurringSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    axios.get(`${API}/api/inventory/recurring-timeslots/`)
      .then(r => setSlots(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => {});
  }, []);

  const handleReschedule = async () => {
    if (!selectedSlot || !pickupDate) return;
    setSubmitting(true);
    const token = localStorage.getItem('access_token');
    try {
      const res = await axios.post(`${API}/api/orders/reschedule/`, {
        order_id: order.id,
        recurring_timeslot_id: Number(selectedSlot),
        pickup_date: pickupDate,
      }, { headers: { Authorization: `Bearer ${token}` } });
      onUpdate(res.data);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const deadlineStr = order.reschedule_deadline
    ? new Date(order.reschedule_deadline).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-md p-5 space-y-4">
      <div>
        <h3 className="text-base font-bold text-pkmn-text flex items-center gap-2">
          <Calendar size={16} className="text-amber-600" /> Timeslot Rescheduling Required
        </h3>
        <p className="text-sm text-amber-800 mt-1">
          Your original pickup timeslot was cancelled. Please select a new one.
        </p>
        {deadlineStr && (
          <p className="text-xs text-amber-700 mt-1">Deadline: {deadlineStr}</p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-pkmn-text uppercase mb-1 block">New Timeslot</label>
          <select
            value={selectedSlot}
            onChange={e => setSelectedSlot(e.target.value)}
            className="w-full border border-pkmn-border rounded-lg p-2.5 text-sm bg-white"
          >
            <option value="">Select a timeslot</option>
            {slots.map(s => (
              <option key={s.id} value={s.id}>
                {DAY_NAMES[s.day_of_week]} {s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)}
                {s.location ? ` (${s.location})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-pkmn-text uppercase mb-1 block">Pickup Date</label>
          <input
            type="date"
            value={pickupDate}
            onChange={e => setPickupDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="w-full border border-pkmn-border rounded-lg p-2.5 text-sm bg-white"
          />
        </div>
      </div>
      <button
        onClick={handleReschedule}
        disabled={!selectedSlot || !pickupDate || submitting}
        className="bg-amber-600 text-white font-bold py-2.5 px-6 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 text-sm"
      >
        {submitting ? 'Rescheduling...' : 'Confirm New Timeslot'}
      </button>
    </div>
  );
}

function VoluntaryRescheduleSection({ order, onUpdate }: { order: Order; onUpdate: (o: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [selectedTimeslot, setSelectedTimeslot] = useState<TimeslotSelection | null>(null);
  const [saving, setSaving] = useState(false);

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
      onUpdate(res.data);
      toast.success('Pickup time changed!');
      setOpen(false);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to change pickup time');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm font-semibold text-pkmn-blue hover:bg-pkmn-blue/10 px-4 py-2.5 rounded-md transition-colors border border-pkmn-blue/20"
      >
        <Calendar size={16} /> Change Pickup Day
        <span className="text-[10px] text-pkmn-gray font-normal ml-1">(one-time)</span>
      </button>
    );
  }

  return (
    <div className="bg-pkmn-blue/5 border border-pkmn-blue/20 rounded-md p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <Calendar size={18} className="text-pkmn-blue flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-pkmn-blue">Change Pickup Day</p>
            <p className="text-xs text-pkmn-gray">You can change your pickup time once per order. Must be at least 1 day before your current pickup, and the shop will be notified.</p>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-pkmn-gray hover:text-pkmn-text text-xs font-bold">Cancel</button>
      </div>
      <PickupTimeslotSelector
        value={selectedTimeslot}
        onChange={setSelectedTimeslot}
      />
      <button
        onClick={handleReschedule}
        disabled={!selectedTimeslot || saving}
        className="w-full bg-pkmn-blue text-white font-bold py-2.5 px-4 rounded-md hover:bg-pkmn-blue-dark transition-all active:scale-95 disabled:opacity-50 text-sm"
      >
        {saving ? 'Changing...' : 'Confirm New Pickup Time'}
      </button>
    </div>
  );
}

export default function ReceiptPage() {
  const params = useParams();
  const orderId = params?.orderId as string;
  const { user } = useRequireAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !orderId) return;
    const token = localStorage.getItem('access_token');
    axios
      .get(`${API}/api/orders/receipt/${orderId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => setOrder(r.data))
      .catch(() => setError('Order not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [user, orderId]);

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

  const salePrice = order
    ? (order.order_items && order.order_items.length > 0
        ? order.order_items.reduce((sum, oi) => sum + Number(oi.price_at_purchase) * oi.quantity, 0)
        : Number(order.item_price) * order.quantity)
    : 0;
  const discountApplied = order?.discount_applied ? Number(order.discount_applied) : 0;
  const discountedSubtotal = salePrice - discountApplied;
  const tradeCredit = order?.trade_offer ? Number(order.trade_offer.total_credit) : 0;
  const overage = order ? Number(order.trade_overage) : 0;
  const cashDue = Math.max(0, discountedSubtotal - tradeCredit);

  // Trade card decision helpers (used for card coloring + decision summary)
  const acceptedCards = order?.trade_offer?.cards.filter(c => c.is_accepted === true) ?? [];
  const rejectedCards = order?.trade_offer?.cards.filter(c => c.is_accepted === false) ?? [];
  const hasTradeDecisions = acceptedCards.length > 0 || rejectedCards.length > 0;
  const allAccepted = hasTradeDecisions && rejectedCards.length === 0;
  const allRejected = hasTradeDecisions && acceptedCards.length === 0;

  const ACTIVE_STATUSES = ['pending', 'cash_needed', 'trade_review', 'pending_counteroffer'];

  return (
    <>
      {/* ── Screen UI (hidden when printing) ── */}
      <div className="bg-pkmn-bg min-h-screen print:hidden">
        <div className="print:hidden">
          <Navbar />
        </div>
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Back + Print buttons */}
          <div className="flex items-center justify-between mb-6 print:hidden">
            <Link href={user?.is_admin ? "/admin/orders" : "/orders"} className="flex items-center gap-2 text-sm text-pkmn-gray hover:text-pkmn-text transition-colors">
              <ArrowLeft size={16} /> Back to Orders
            </Link>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 text-sm font-medium text-pkmn-blue hover:text-pkmn-blue-dark transition-colors"
            >
              <Printer size={16} /> Print Receipt
            </button>
          </div>

          {loading ? (
            <Spinner label="Loading receipt..." />
          ) : error ? (
            <div className="bg-pkmn-red/10 border border-pkmn-red/20 rounded-md p-8 text-center">
              <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <p className="text-pkmn-red font-medium">{error}</p>
              <Link href={user?.is_admin ? "/admin/orders" : "/orders"} className="text-pkmn-blue hover:underline text-sm mt-2 inline-block">View My Orders</Link>
            </div>
          ) : order ? (
            <div className="bg-white border border-pkmn-border rounded-md shadow-sm overflow-hidden print:shadow-none print:border-0">
              {/* Receipt Header */}
              <div className="px-8 py-6 text-white print:bg-white print:text-pkmn-text" style={{ background: 'linear-gradient(to right, #0054a6, #003087)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                      <Package size={24} />
                      {new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </h1>
                    <p className="text-blue-200 text-xs mt-1 font-mono print:text-pkmn-gray">{order.order_id}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap ${statusConfig[order.status]?.color || 'bg-white/20 text-white border-white/30'}`}>
                    {statusConfig[order.status]?.label || order.status}
                  </span>
                </div>
              </div>

              <div className="p-8 space-y-6">
                {/* Admin-cancelled banner — appears at top when shop cancelled the order */}
                {order.status === 'cancelled' && order.cancellation_reason && (
                  <div className="bg-pkmn-red/10 border-2 border-pkmn-red rounded-md p-5 print:border-pkmn-red">
                    <div className="flex items-start gap-3">
                      <XCircle size={24} className="text-pkmn-red flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h2 className="text-base font-bold text-pkmn-red">
                          This order has been cancelled by the shop
                        </h2>
                        <p className="text-sm text-pkmn-text mt-1">
                          <span className="font-semibold">Reason:</span> {order.cancellation_reason}
                        </p>
                        <p className="text-xs text-pkmn-gray mt-2">
                          Items have been restocked and your pickup timeslot (if any) has been released.
                          No payment is required. Please contact the shop on Discord if you have questions.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Discord instruction banner for active orders */}
                {ACTIVE_STATUSES.includes(order.status) && (
                  <div className="flex items-center gap-4 bg-pkmn-blue/10 border border-pkmn-blue/20 p-4 print:hidden">
                    <MessageCircle size={20} className="text-pkmn-blue flex-shrink-0" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="text-sm font-semibold text-pkmn-text">Please DM keepvaibin on Discord if you have any questions about your order.</p>
                      <p className="text-xs text-pkmn-gray mt-0.5">Discord: {order.discord_handle}</p>
                    </div>
                    <a
                      href="https://discordapp.com/channels/@me/306226303051497473"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ background: '#5865F2', color: '#fff', padding: '8px 20px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', flexShrink: 0, display: 'inline-block' }}
                    >
                      DM
                    </a>
                  </div>
                )}

                <div className="flex items-start gap-4 bg-pkmn-bg border border-pkmn-border p-4">
                  <Calendar size={18} className="text-pkmn-blue flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-pkmn-text">Delivery Details</p>
                    <p className="text-sm text-pkmn-gray">
                      {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                    </p>
                  </div>
                </div>

                {/* Order Info Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-pkmn-gray uppercase">Date</p>
                    <p className="text-pkmn-text font-medium text-sm">
                      {new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-pkmn-gray uppercase">Customer</p>
                    <p className="text-pkmn-text font-medium text-sm">{order.user_email}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-pkmn-gray uppercase">Payment</p>
                    <p className="text-pkmn-text font-medium text-sm">{formatPaymentLabel(order.payment_method)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-pkmn-gray uppercase">Pickup / Delivery</p>
                    <p className="text-pkmn-text font-medium text-sm">
                      {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                    </p>
                  </div>
                  {order.backup_payment_method && (
                    <div>
                      <p className="text-xs font-semibold text-pkmn-gray uppercase">Backup Payment</p>
                      <p className="text-pkmn-text font-medium text-sm capitalize">{order.backup_payment_method}</p>
                    </div>
                  )}
                </div>

                {/* Item Details */}
                <div className="border border-pkmn-border rounded-md overflow-hidden">
                  <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                    <h3 className="text-sm font-bold text-pkmn-gray-dark">Item Details</h3>
                  </div>
                  {order.order_items && order.order_items.length > 0 ? (
                    <div className="divide-y divide-gray-100">
                      {order.order_items.map((oi) => (
                        <div key={oi.id} className="px-5 py-4 flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-pkmn-text">{oi.item_title}</p>
                            <p className="text-sm text-pkmn-gray">Qty: {oi.quantity} x ${Number(oi.price_at_purchase).toFixed(2)}</p>
                          </div>
                          <p className="text-lg font-bold text-pkmn-text">${(Number(oi.price_at_purchase) * oi.quantity).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-4 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-pkmn-text">{order.item_title}</p>
                        <p className="text-sm text-pkmn-gray">Qty: {order.quantity} x ${Number(order.item_price).toFixed(2)}</p>
                      </div>
                      <p className="text-lg font-bold text-pkmn-text">${salePrice.toFixed(2)}</p>
                    </div>
                  )}
                </div>

                {/* Trade Cards */}
                {order.trade_offer && order.trade_offer.cards.length > 0 && (
                  <div className="border border-pkmn-border rounded-md overflow-hidden">
                    <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border flex items-center justify-between">
                      <h3 className="text-sm font-bold text-pkmn-gray-dark flex items-center gap-1.5">
                        <RefreshCw size={14} /> Trade Cards ({order.trade_offer.cards.length})
                      </h3>
                      <span className="text-xs text-pkmn-gray capitalize">{order.trade_offer.trade_mode.replace('_', ' ')}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {order.trade_offer.cards.map((card) => (
                        <div
                          key={card.id}
                          className={`px-5 py-3 flex items-center justify-between ${
                            card.is_countered ? 'bg-pkmn-yellow/10' :
                            card.is_accepted === true ? 'bg-green-500/10' :
                            card.is_rejected ? 'bg-pkmn-red/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {card.is_countered && <RefreshCw size={14} className="text-amber-500" />}
                            {card.is_accepted === true && !card.is_countered && <CheckCircle size={14} className="text-green-600" />}
                            {card.is_rejected && <XCircle size={14} className="text-pkmn-red" />}
                            <span className={`font-medium text-sm ${
                              card.is_countered ? 'text-pkmn-text' :
                              card.is_accepted === true ? 'text-green-600' :
                              card.is_rejected ? 'text-pkmn-red line-through' :
                              'text-pkmn-text'
                            }`}>{card.card_name}</span>
                            {card.is_wanted_card && (
                              <span className="bg-pkmn-yellow/15 text-pkmn-yellow-dark text-[10px] font-bold px-1.5 py-0.5">WANTED</span>
                            )}
                            <span className="text-xs text-pkmn-gray capitalize">{card.condition?.replace('_', ' ')}</span>
                          </div>
                          <div className="text-right">
                            {card.is_countered ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-pkmn-gray line-through">${Number(card.computed_credit ?? 0).toFixed(2)}</span>
                                <span className="font-bold text-sm text-pkmn-yellow-dark">${Number(card.admin_override_value ?? 0).toFixed(2)}</span>
                              </div>
                            ) : card.is_accepted === true ? (
                              <span className="font-bold text-sm text-emerald-600">${Number(card.computed_credit ?? card.estimated_value).toFixed(2)}</span>
                            ) : card.is_rejected ? (
                              <span className="font-bold text-sm text-pkmn-red">$0.00</span>
                            ) : (
                              <span className="font-bold text-sm text-pkmn-text">${Number(card.computed_credit ?? card.estimated_value).toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {hasTradeDecisions && (
                      <div className="px-5 py-3 bg-pkmn-blue/10 border-t border-pkmn-blue/20">
                        <p className="text-sm text-pkmn-blue font-medium">
                          {allAccepted
                            ? 'Your trade was fully approved! No additional payment required.'
                            : allRejected
                              ? (order.payment_method === 'venmo'
                                  ? (order.buy_if_trade_denied
                                      ? `Your order stays active and the full balance of $${discountedSubtotal.toFixed(2)} is now due via ${order.backup_payment_method || 'Venmo/Zelle'}.`
                                      : 'The trade could not be approved, so this order has been cancelled.')
                                  : `The trade credit was removed. The full balance of $${discountedSubtotal.toFixed(2)} is now due via ${order.backup_payment_method || formatPaymentLabel(order.payment_method) || 'Venmo/Zelle'}.`)
                              : cashDue > 0
                                ? `Some of your cards were accepted. The remaining balance of $${cashDue.toFixed(2)} is due via ${order.backup_payment_method || 'Venmo/Zelle'}.`
                                : 'Some of your cards were accepted. No additional payment required.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Payment Ledger */}
                <div className="border border-pkmn-border rounded-md overflow-hidden">
                  <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                    <h3 className="text-sm font-bold text-pkmn-gray-dark flex items-center gap-1.5">
                      <CreditCard size={14} /> Payment Summary
                    </h3>
                  </div>
                  <div className="px-5 py-4 space-y-2 text-sm">
                    <div className="flex justify-between text-pkmn-gray">
                      <span>Subtotal</span>
                      <span>${salePrice.toFixed(2)}</span>
                    </div>
                    {discountApplied > 0 && (
                      <div className="flex justify-between text-purple-700">
                        <span>Coupon Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</span>
                        <span>-${discountApplied.toFixed(2)}</span>
                      </div>
                    )}
                    {order.trade_offer && tradeCredit > 0 && (() => {
                      const creditCards = order.trade_offer!.cards.filter(c => c.is_accepted === true);
                      if (creditCards.length === 0) {
                        return (
                          <div className="flex justify-between text-emerald-600">
                            <span>Trade Credit Applied</span>
                            <span>-${Math.min(tradeCredit, discountedSubtotal).toFixed(2)}</span>
                          </div>
                        );
                      }
                      return (
                        <>
                          {creditCards.map(card => {
                            const cardCredit = card.is_countered
                              ? Number(card.admin_override_value ?? 0)
                              : Number(card.computed_credit ?? card.estimated_value);
                            return (
                              <div key={card.id} className="flex justify-between text-emerald-600">
                                <span className="truncate max-w-[200px]">Trade ({card.card_name})</span>
                                <span className="font-medium">-${Math.min(cardCredit, discountedSubtotal).toFixed(2)}</span>
                              </div>
                            );
                          })}
                          <hr className="border-zinc-200 my-1" />
                        </>
                      );
                    })()}
                    {overage > 0 && (
                      <div className="flex justify-between text-pkmn-yellow-dark">
                        <span>Overpayment (shop owes you)</span>
                        <span>${overage.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-3 border-t border-pkmn-border text-lg font-bold text-pkmn-text">
                      <span>Total Due</span>
                      <span>${cashDue.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Cash needed banner */}
                {order.status === 'cash_needed' && (
                  <div className="bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-md p-4 text-sm text-pkmn-blue">
                    <CreditCard size={14} className="inline mr-1.5" />
                    {tradeCredit === 0
                      ? (order.payment_method === 'venmo'
                          ? (order.buy_if_trade_denied
                              ? `Your order stays active and the full balance of $${discountedSubtotal.toFixed(2)} is now due via ${order.backup_payment_method || formatPaymentLabel(order.payment_method) || 'Venmo/Zelle'}.`
                              : 'The trade could not be approved, so this order has been cancelled.')
                          : `The trade credit was removed. The full balance of $${discountedSubtotal.toFixed(2)} is now due via ${order.backup_payment_method || formatPaymentLabel(order.payment_method) || 'Venmo/Zelle'}.`)
                      : `The remaining balance of $${cashDue.toFixed(2)} is due via ${order.backup_payment_method ? formatPaymentLabel(order.backup_payment_method) : 'Venmo/Zelle'} before pickup.`}
                  </div>
                )}

                {/* Counteroffer Comparison Block */}
                {order.status === 'pending_counteroffer' && order.trade_offer && (() => {
                  const counterCards = order.trade_offer.cards.filter(c => c.is_accepted === true);
                  const originalCredit = counterCards.reduce((sum, c) => sum + Number(c.computed_credit ?? c.estimated_value), 0);
                  const originalTotal = Math.max(0, discountedSubtotal - originalCredit);
                  const newTotal = cashDue;
                  return (
                    <div className="bg-pkmn-yellow/10 border border-amber-300 rounded-md p-5 space-y-4">
                      <div>
                        <h3 className="text-base font-bold text-pkmn-text flex items-center gap-2">
                          <RefreshCw size={16} /> Counteroffer Comparison
                        </h3>
                        {order.counteroffer_message && (
                          <p className="mt-1 text-sm text-pkmn-yellow-dark">{order.counteroffer_message}</p>
                        )}
                        {order.counteroffer_expires_at && (
                          <p className="mt-1 text-xs text-pkmn-yellow-dark">
                            Expires: {new Date(order.counteroffer_expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white border border-pkmn-yellow/20 p-3 text-center">
                          <p className="text-xs text-pkmn-gray uppercase font-semibold mb-1">Original Expected</p>
                          <p className="text-lg font-bold text-pkmn-gray-dark">${originalTotal.toFixed(2)}</p>
                          <p className="text-xs text-pkmn-gray-dark mt-0.5">at {order.trade_offer.credit_percentage}% credit</p>
                        </div>
                        <div className="bg-pkmn-yellow/15 border border-pkmn-yellow p-3 text-center">
                          <p className="text-xs text-pkmn-yellow-dark uppercase font-semibold mb-1">New Total Due</p>
                          <p className="text-2xl font-black text-pkmn-text">${newTotal.toFixed(2)}</p>
                          <p className="text-xs text-pkmn-yellow-dark mt-0.5">with counteroffer applied</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-col sm:flex-row">
                        <button
                          onClick={async () => {
                            const token = localStorage.getItem('access_token');
                            try {
                              const res = await axios.post(`${API}/api/orders/respond-counteroffer/`, { order_id: order.id, response: 'accept' }, { headers: { Authorization: `Bearer ${token}` } });
                              setOrder(res.data);
                            } catch { /* ignore */ }
                          }}
                          className="flex-1 whitespace-nowrap bg-green-600 text-white font-bold py-2.5 px-4 hover:bg-green-700 transition-all active:scale-95 text-sm"
                        >
                          Accept Counteroffer
                        </button>
                        <button
                          onClick={async () => {
                            const token = localStorage.getItem('access_token');
                            try {
                              const res = await axios.post(`${API}/api/orders/respond-counteroffer/`, { order_id: order.id, response: 'pay_cash' }, { headers: { Authorization: `Bearer ${token}` } });
                              setOrder(res.data);
                            } catch { /* ignore */ }
                          }}
                          className="flex-1 whitespace-nowrap bg-pkmn-blue text-white font-bold py-2.5 px-3 hover:bg-pkmn-blue-dark transition-all active:scale-95 text-sm"
                        >
                          Keep &amp; Pay Balance
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('Cancel this order? Your items will be restocked.')) return;
                            const token = localStorage.getItem('access_token');
                            try {
                              const res = await axios.post(`${API}/api/orders/respond-counteroffer/`, { order_id: order.id, response: 'cancel' }, { headers: { Authorization: `Bearer ${token}` } });
                              setOrder(res.data);
                            } catch { /* ignore */ }
                          }}
                          className="flex-1 whitespace-nowrap bg-pkmn-red text-white font-bold py-2.5 px-4 hover:bg-pkmn-red-dark transition-all active:scale-95 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Rescheduling Banner */}
                {order.requires_rescheduling && <RescheduleSection order={order} onUpdate={setOrder} />}

                {/* Voluntary Reschedule — scheduled orders only, not already used, not forced reschedule */}
                {!order.requires_rescheduling
                  && order.delivery_method === 'scheduled'
                  && !order.pickup_rescheduled_by_user
                  && ACTIVE_STATUSES.includes(order.status) && (
                  <VoluntaryRescheduleSection order={order} onUpdate={setOrder} />
                )}

                {/* Order Timeline */}
                {order.resolution_summary && order.resolution_summary.length > 0 && (
                  <div className="border border-pkmn-border rounded-md overflow-hidden">
                    <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                      <h3 className="text-sm font-bold text-pkmn-gray-dark">Order Timeline</h3>
                    </div>
                    <style dangerouslySetInnerHTML={{ __html: `
                      @keyframes timeline-pulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(0, 84, 166, 0.4); }
                        50% { box-shadow: 0 0 8px 3px rgba(0, 84, 166, 0.25); }
                      }
                    `}} />
                    <div style={{ padding: '16px 20px' }}>
                      {order.resolution_summary.map((evt, i) => {
                        const isLast = i === order.resolution_summary!.length - 1;
                        const isLatest = isLast;
                        return (
                          <div key={i} style={{ display: 'flex', gap: '16px' }}>
                            {/* Left column: line above + circle + line below */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                              {/* Line above circle (hidden for first item) */}
                              <div style={{ width: '2px', height: '12px', background: i > 0 ? '#94a3b8' : 'transparent' }} />
                              {/* Circle — centered vertically alongside content */}
                              <div style={{
                                width: '12px',
                                height: '12px',
                                borderRadius: '50%',
                                background: '#0054a6',
                                flexShrink: 0,
                                ...(isLatest ? { animation: 'timeline-pulse 2s ease-in-out infinite' } : {}),
                              }} />
                              {/* Line below circle (hidden for last item) */}
                              <div style={{ width: '2px', flexGrow: 1, background: isLast ? 'transparent' : '#94a3b8', minHeight: '8px' }} />
                            </div>
                            {/* Right column: text content */}
                            <div style={{ flex: 1, minWidth: 0, paddingTop: '4px', paddingBottom: isLast ? '0' : '12px' }}>
                              <p className="text-xs text-pkmn-gray">
                                {new Date(evt.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <p className="text-sm text-pkmn-text" style={{ marginTop: '4px' }}>{evt.detail}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Print-only invoice (shown only when printing) ── */}
      {order && !loading && !error && (
        <div className="hidden print:block" style={{ fontFamily: "'Times New Roman', serif", fontSize: '10pt', color: '#000', padding: '0.75in', lineHeight: '1.5' }}>
          {/* Header */}
          <div style={{ borderBottom: '2px solid #000', paddingBottom: '8px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '15pt', fontWeight: 'bold', letterSpacing: '0.05em' }}>SCTCG</div>
              <div style={{ fontSize: '8pt', color: '#555' }}>UC Santa Cruz Trading Card Group</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '9pt' }}>
              <div style={{ fontWeight: 'bold', fontSize: '11pt', letterSpacing: '0.08em' }}>ORDER INVOICE</div>
              <div>{new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
          </div>

          {/* Order + Customer meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', fontSize: '9pt' }}>
            <div style={{ lineHeight: '1.6' }}>
              <div><span style={{ fontWeight: 'bold' }}>Order ID:</span> {order.order_id}</div>
              <div><span style={{ fontWeight: 'bold' }}>Status:</span> {(statusConfig[order.status]?.label || order.status).toUpperCase()}</div>
            </div>
            <div style={{ textAlign: 'right', lineHeight: '1.6' }}>
              <div><span style={{ fontWeight: 'bold' }}>Customer:</span> {order.user_email}</div>
              <div><span style={{ fontWeight: 'bold' }}>Payment:</span> {formatPaymentLabel(order.payment_method)}</div>
              {order.backup_payment_method && <div><span style={{ fontWeight: 'bold' }}>Backup:</span> {order.backup_payment_method}</div>}
              <div><span style={{ fontWeight: 'bold' }}>Delivery:</span> {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP')}</div>
            </div>
          </div>

          {/* Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', marginBottom: '4px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #000' }}>
                <th style={{ textAlign: 'left', padding: '3px 0', fontWeight: 'bold' }}>Item</th>
                <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 'bold' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 'bold' }}>Unit Price</th>
                <th style={{ textAlign: 'right', padding: '3px 0', fontWeight: 'bold' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(order.order_items && order.order_items.length > 0 ? order.order_items : [{
                id: 0, item: 0, item_title: order.item_title,
                item_price: order.item_price, quantity: order.quantity, price_at_purchase: order.item_price,
              }]).map((oi) => (
                <tr key={oi.id} style={{ borderBottom: '1px dotted #bbb' }}>
                  <td style={{ padding: '3px 0' }}>{oi.item_title}</td>
                  <td style={{ textAlign: 'right', padding: '3px 8px' }}>{oi.quantity}</td>
                  <td style={{ textAlign: 'right', padding: '3px 8px' }}>${Number(oi.price_at_purchase).toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 0' }}>${(Number(oi.price_at_purchase) * oi.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Payment Summary — right-aligned narrow table */}
          <table style={{ width: '45%', marginLeft: 'auto', borderCollapse: 'collapse', fontSize: '9pt', marginBottom: '12px' }}>
            <tbody>
              <tr style={{ borderTop: '1px solid #000' }}>
                <td style={{ padding: '3px 0' }}>Subtotal</td>
                <td style={{ textAlign: 'right', padding: '3px 0' }}>${salePrice.toFixed(2)}</td>
              </tr>
              {discountApplied > 0 && (
                <tr>
                  <td style={{ padding: '2px 0' }}>Coupon{order.coupon_code ? ` (${order.coupon_code})` : ''}</td>
                  <td style={{ textAlign: 'right', padding: '2px 0' }}>-${discountApplied.toFixed(2)}</td>
                </tr>
              )}
              {order.trade_offer && tradeCredit > 0 && (
                <tr>
                  <td style={{ padding: '2px 0' }}>Trade Credit</td>
                  <td style={{ textAlign: 'right', padding: '2px 0' }}>-${Math.min(tradeCredit, discountedSubtotal).toFixed(2)}</td>
                </tr>
              )}
              {overage > 0 && (
                <tr>
                  <td style={{ padding: '2px 0' }}>Overpayment</td>
                  <td style={{ textAlign: 'right', padding: '2px 0' }}>${overage.toFixed(2)}</td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid #000', fontWeight: 'bold' }}>
                <td style={{ padding: '3px 0' }}>Total Due</td>
                <td style={{ textAlign: 'right', padding: '3px 0' }}>${cashDue.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* Trade Cards (if any) */}
          {order.trade_offer && order.trade_offer.cards.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ borderBottom: '1px solid #000', fontWeight: 'bold', paddingBottom: '3px', marginBottom: '4px', fontSize: '9pt' }}>Trade Cards</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
                <thead>
                  <tr style={{ borderBottom: '1px dotted #888' }}>
                    <th style={{ textAlign: 'left', padding: '2px 0' }}>Card</th>
                    <th style={{ textAlign: 'left', padding: '2px 8px' }}>Condition</th>
                    <th style={{ textAlign: 'right', padding: '2px 0' }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {order.trade_offer.cards.map(card => (
                    <tr key={card.id} style={{ borderBottom: '1px dotted #ddd' }}>
                      <td style={{ padding: '2px 0' }}>{card.card_name}{card.is_wanted_card ? ' \u2605' : ''}</td>
                      <td style={{ padding: '2px 8px' }}>{card.condition?.replace('_', ' ') || '\u2014'}</td>
                      <td style={{ textAlign: 'right', padding: '2px 0' }}>
                        {card.is_countered
                          ? `$${Number(card.admin_override_value ?? 0).toFixed(2)}`
                          : card.is_rejected
                            ? '$0.00 (rejected)'
                            : `$${Number(card.computed_credit ?? card.estimated_value).toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop: '1px solid #000', marginTop: '18px', paddingTop: '6px', fontSize: '8pt', color: '#666', textAlign: 'center' }}>
            Thank you for your order &mdash; SCTCG @ UC Santa Cruz
          </div>
        </div>
      )}
    </>
  );
}
