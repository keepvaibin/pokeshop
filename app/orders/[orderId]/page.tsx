"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import Spinner from '../../components/Spinner';
import Link from 'next/link';
import { ArrowLeft, Printer, Package, CheckCircle, XCircle, MessageCircle, Calendar, CreditCard, RefreshCw } from 'lucide-react';

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

interface Order {
  id: number;
  order_id: string;
  item_title: string;
  item_price: string;
  quantity: number;
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
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark border-pkmn-yellow/20' },
  fulfilled: { label: 'Fulfilled', color: 'bg-green-500/15 text-green-600 border-green-500/20' },
  cancelled: { label: 'Cancelled', color: 'bg-pkmn-red/15 text-pkmn-red border-pkmn-red/20' },
  cash_needed: { label: 'Balance Due', color: 'bg-pkmn-blue/15 text-pkmn-blue border-pkmn-blue/20' },
  trade_review: { label: 'Trade Under Review', color: 'bg-purple-500/15 text-purple-600 border-purple-500/20' },
  pending_counteroffer: { label: 'Counteroffer Pending', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark border-pkmn-yellow/20' },
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
    axios.get(`http://localhost:8000/api/inventory/recurring-timeslots/`)
      .then(r => setSlots(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => {});
  }, []);

  const handleReschedule = async () => {
    if (!selectedSlot || !pickupDate) return;
    setSubmitting(true);
    const token = localStorage.getItem('access_token');
    try {
      const res = await axios.post('http://localhost:8000/api/orders/reschedule/', {
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
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-4">
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
      .get(`http://localhost:8000/api/orders/receipt/${orderId}/`, {
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

  const salePrice = order ? Number(order.item_price) * order.quantity : 0;
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
    <div className="bg-pkmn-bg min-h-screen print:bg-white">
      <div className="print:hidden">
        <Navbar />
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back + Print buttons */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Link href="/orders" className="flex items-center gap-2 text-sm text-pkmn-gray hover:text-pkmn-text transition-colors">
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
          <div className="bg-pkmn-red/10 border border-pkmn-red/20 rounded-xl p-8 text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-pkmn-red font-medium">{error}</p>
            <Link href="/orders" className="text-pkmn-blue hover:underline text-sm mt-2 inline-block">View My Orders</Link>
          </div>
        ) : order ? (
          <div className="bg-white border border-pkmn-border rounded-2xl shadow-sm overflow-hidden print:shadow-none print:border-0">
            {/* Receipt Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-6 text-white print:bg-white print:text-pkmn-text">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Package size={24} />
                    {new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </h1>
                  <p className="text-blue-200 text-xs mt-1 font-mono print:text-pkmn-gray">{order.order_id}</p>
                </div>
                <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${statusConfig[order.status]?.color || 'bg-pkmn-bg text-pkmn-text border-pkmn-border'}`}>
                  {statusConfig[order.status]?.label || order.status}
                </span>
              </div>
            </div>

            <div className="p-8 space-y-6">
              {/* Discord instruction banner for active orders */}
              {ACTIVE_STATUSES.includes(order.status) && (
                <div className="flex items-start gap-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 print:hidden">
                  <MessageCircle size={20} className="text-indigo-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-indigo-900">Please message keepvaibin on Discord to facilitate the order.</p>
                    <p className="text-xs text-indigo-700 mt-0.5">Discord: {order.discord_handle}</p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3 bg-pkmn-bg border border-pkmn-border rounded-xl p-4">
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

              {/* Item Line */}
              <div className="border border-pkmn-border rounded-xl overflow-hidden">
                <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                  <h3 className="text-sm font-bold text-pkmn-gray-dark">Item Details</h3>
                </div>
                <div className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-pkmn-text">{order.item_title}</p>
                    <p className="text-sm text-pkmn-gray">Qty: {order.quantity} x ${Number(order.item_price).toFixed(2)}</p>
                  </div>
                  <p className="text-lg font-bold text-pkmn-text">${salePrice.toFixed(2)}</p>
                </div>
              </div>

              {/* Trade Cards */}
              {order.trade_offer && order.trade_offer.cards.length > 0 && (
                <div className="border border-pkmn-border rounded-xl overflow-hidden">
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
                            <span className="bg-pkmn-yellow/15 text-pkmn-yellow-dark text-[10px] font-bold px-1.5 py-0.5 rounded-full">WANTED</span>
                          )}
                          <span className="text-xs text-pkmn-gray capitalize">{card.condition?.replace('_', ' ')}</span>
                        </div>
                        {/* Per-card credit display */}
                        <div className="text-right">
                          {card.is_countered ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-white0 line-through">${Number(card.computed_credit ?? 0).toFixed(2)}</span>
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
                  {/* Trade decision summary */}
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
              <div className="border border-pkmn-border rounded-xl overflow-hidden">
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
                      // Trade not yet reviewed - show bulk line
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
                <div className="bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-xl p-4 text-sm text-pkmn-blue">
                  <CreditCard size={14} className="inline mr-1.5" />
                  {tradeCredit === 0
                    ? (order.payment_method === 'venmo'
                        ? (order.buy_if_trade_denied
                            ? `Your order stays active and the full balance of $${discountedSubtotal.toFixed(2)} is now due via ${order.backup_payment_method || formatPaymentLabel(order.payment_method) || 'Venmo/Zelle'}.`
                            : 'The trade could not be approved, so this order has been cancelled.')
                        : `The trade credit was removed. The full balance of $${discountedSubtotal.toFixed(2)} is now due via ${order.backup_payment_method || formatPaymentLabel(order.payment_method) || 'Venmo/Zelle'}.`)
                    : `The remaining balance of $${cashDue.toFixed(2)} is due via ${order.backup_payment_method || 'Venmo/Zelle'} before pickup.`}
                </div>
              )}

              {/* Counteroffer Comparison Block */}
              {order.status === 'pending_counteroffer' && order.trade_offer && (() => {
                const counterCards = order.trade_offer.cards.filter(c => c.is_accepted === true);
                const originalCredit = counterCards.reduce((sum, c) => sum + Number(c.computed_credit ?? c.estimated_value), 0);
                const originalTotal = Math.max(0, discountedSubtotal - originalCredit);
                const newTotal = cashDue;
                return (
                  <div className="bg-pkmn-yellow/10 border border-amber-300 rounded-xl p-5 space-y-4">
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
                    {/* Two-column comparison */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white border border-pkmn-yellow/20 rounded-lg p-3 text-center">
                        <p className="text-xs text-pkmn-gray uppercase font-semibold mb-1">Original Expected</p>
                        <p className="text-lg font-bold text-pkmn-gray-dark">${originalTotal.toFixed(2)}</p>
                        <p className="text-xs text-pkmn-gray-dark mt-0.5">at {order.trade_offer.credit_percentage}% credit</p>
                      </div>
                      <div className="bg-pkmn-yellow/15 border border-pkmn-yellow rounded-lg p-3 text-center">
                        <p className="text-xs text-pkmn-yellow-dark uppercase font-semibold mb-1">New Total Due</p>
                        <p className="text-2xl font-black text-pkmn-text">${newTotal.toFixed(2)}</p>
                        <p className="text-xs text-pkmn-yellow-dark mt-0.5">with counteroffer applied</p>
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-2 flex-col sm:flex-row">
                      <button
                        onClick={async () => {
                          const token = localStorage.getItem('access_token');
                          try {
                            const res = await axios.post('http://localhost:8000/api/orders/respond-counteroffer/', { order_id: order.id, response: 'accept' }, { headers: { Authorization: `Bearer ${token}` } });
                            setOrder(res.data);
                          } catch { /* ignore */ }
                        }}
                        className="flex-1 bg-green-600 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-green-700 transition-all active:scale-95 text-sm"
                      >
                        Accept Counteroffer
                      </button>
                      <button
                        onClick={async () => {
                          const token = localStorage.getItem('access_token');
                          try {
                            const res = await axios.post('http://localhost:8000/api/orders/respond-counteroffer/', { order_id: order.id, response: 'pay_cash' }, { headers: { Authorization: `Bearer ${token}` } });
                            setOrder(res.data);
                          } catch { /* ignore */ }
                        }}
                        className="flex-1 bg-pkmn-blue text-white font-bold py-2.5 px-4 rounded-lg hover:bg-pkmn-blue-dark transition-all active:scale-95 text-sm"
                      >
                        Keep Order &amp; Pay Balance
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm('Cancel this order? Your items will be restocked.')) return;
                          const token = localStorage.getItem('access_token');
                          try {
                            const res = await axios.post('http://localhost:8000/api/orders/respond-counteroffer/', { order_id: order.id, response: 'cancel' }, { headers: { Authorization: `Bearer ${token}` } });
                            setOrder(res.data);
                          } catch { /* ignore */ }
                        }}
                        className="flex-1 bg-pkmn-red/100 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-pkmn-red transition-all active:scale-95 text-sm"
                      >
                        Cancel Order
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Rescheduling Banner */}
              {order.requires_rescheduling && <RescheduleSection order={order} onUpdate={setOrder} />}

              {/* Order Timeline */}
              {order.resolution_summary && order.resolution_summary.length > 0 && (
                <div className="border border-pkmn-border rounded-xl overflow-hidden">
                  <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                    <h3 className="text-sm font-bold text-pkmn-gray-dark">Order Timeline</h3>
                  </div>
                  <div className="px-5 py-4">
                    <ol className="relative border-l border-pkmn-border ml-2 space-y-4">
                      {order.resolution_summary.map((evt, i) => (
                        <li key={i} className="ml-4">
                          <div className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full border-2 border-white bg-pkmn-blue/100" />
                          <p className="text-xs text-pkmn-gray-dark">
                            {new Date(evt.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="text-sm text-pkmn-gray-dark">{evt.detail}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
