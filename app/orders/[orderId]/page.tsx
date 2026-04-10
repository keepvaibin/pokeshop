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
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  fulfilled: { label: 'Fulfilled', color: 'bg-green-100 text-green-800 border-green-200' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800 border-red-200' },
  cash_needed: { label: 'Cash Needed', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  trade_review: { label: 'Trade Under Review', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  pending_counteroffer: { label: 'Counteroffer Pending', color: 'bg-amber-100 text-amber-800 border-amber-200' },
};

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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
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
    <div className="bg-gray-50 dark:bg-zinc-950 min-h-screen print:bg-white dark:bg-zinc-900">
      <div className="print:hidden">
        <Navbar />
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back + Print buttons */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Link href="/orders" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:hover:text-zinc-100 dark:text-zinc-100 transition-colors">
            <ArrowLeft size={16} /> Back to Orders
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            <Printer size={16} /> Print Receipt
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading receipt..." />
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-800 font-medium">{error}</p>
            <Link href="/orders" className="text-blue-600 hover:underline text-sm mt-2 inline-block">View My Orders</Link>
          </div>
        ) : order ? (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl shadow-sm overflow-hidden print:shadow-none print:border-0">
            {/* Receipt Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-6 text-white print:bg-white dark:bg-zinc-900 print:text-black dark:text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Package size={24} />
                    {new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </h1>
                  <p className="text-blue-200 text-xs mt-1 font-mono print:text-gray-500">{order.order_id}</p>
                </div>
                <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${statusConfig[order.status]?.color || 'bg-gray-100 dark:bg-zinc-800 text-gray-800 border-gray-200 dark:border-zinc-700'}`}>
                  {statusConfig[order.status]?.label || order.status}
                </span>
              </div>
            </div>

            <div className="p-8 space-y-6">
              {/* Discord instruction banner for active orders */}
              {ACTIVE_STATUSES.includes(order.status) && (
                <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4 print:hidden">
                  <MessageCircle size={20} className="text-indigo-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-indigo-900">Please message keepvaibin on Discord to facilitate the order.</p>
                    <p className="text-xs text-indigo-700 mt-0.5">Discord: {order.discord_handle}</p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3 bg-zinc-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-xl p-4">
                <Calendar size={18} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Delivery Details</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                  </p>
                </div>
              </div>

              {/* Order Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Date</p>
                  <p className="text-gray-900 dark:text-zinc-100 font-medium text-sm">
                    {new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Customer</p>
                  <p className="text-gray-900 dark:text-zinc-100 font-medium text-sm">{order.user_email}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Payment</p>
                  <p className="text-gray-900 dark:text-zinc-100 font-medium text-sm capitalize">{order.payment_method.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Pickup / Delivery</p>
                  <p className="text-gray-900 dark:text-zinc-100 font-medium text-sm">
                    {order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown')}
                  </p>
                </div>
                {order.backup_payment_method && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">Backup Payment</p>
                    <p className="text-gray-900 dark:text-zinc-100 font-medium text-sm capitalize">{order.backup_payment_method}</p>
                  </div>
                )}
              </div>

              {/* Item Line */}
              <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="bg-gray-50 dark:bg-zinc-950 px-5 py-3 border-b border-gray-200 dark:border-zinc-700">
                  <h3 className="text-sm font-bold text-gray-700">Item Details</h3>
                </div>
                <div className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-zinc-100">{order.item_title}</p>
                    <p className="text-sm text-gray-500">Qty: {order.quantity} × ${Number(order.item_price).toFixed(2)}</p>
                  </div>
                  <p className="text-lg font-bold text-gray-900 dark:text-zinc-100">${salePrice.toFixed(2)}</p>
                </div>
              </div>

              {/* Trade Cards */}
              {order.trade_offer && order.trade_offer.cards.length > 0 && (
                <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 dark:bg-zinc-950 px-5 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                      <RefreshCw size={14} /> Trade Cards ({order.trade_offer.cards.length})
                    </h3>
                    <span className="text-xs text-gray-500 capitalize">{order.trade_offer.trade_mode.replace('_', ' ')}</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {order.trade_offer.cards.map((card) => (
                      <div
                        key={card.id}
                        className={`px-5 py-3 flex items-center justify-between ${
                          card.is_accepted === true ? 'bg-green-50' :
                          card.is_accepted === false ? 'bg-red-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {card.is_accepted === true && <CheckCircle size={14} className="text-green-600" />}
                          {card.is_accepted === false && <XCircle size={14} className="text-red-500" />}
                          <span className={`font-medium text-sm ${
                            card.is_accepted === true ? 'text-green-800' :
                            card.is_accepted === false ? 'text-red-700 line-through' :
                            'text-gray-900 dark:text-zinc-100'
                          }`}>{card.card_name}</span>
                          {card.is_wanted_card && (
                            <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200 text-[10px] font-bold px-1.5 py-0.5 rounded-full">WANTED</span>
                          )}
                          <span className="text-xs text-gray-500 capitalize">{card.condition?.replace('_', ' ')}</span>
                        </div>
                        <span className={`font-bold text-sm ${
                          card.is_accepted === true ? 'text-green-700' :
                          card.is_accepted === false ? 'text-red-600' :
                          'text-gray-900 dark:text-zinc-100'
                        }`}>${Number(card.estimated_value).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Trade decision summary */}
                  {hasTradeDecisions && (
                    <div className="px-5 py-3 bg-blue-50 border-t border-blue-200">
                      <p className="text-sm text-blue-800 font-medium">
                        {allAccepted
                          ? 'Your trade was fully approved! No additional payment required.'
                          : allRejected
                            ? (order.payment_method === 'venmo'
                                ? (order.buy_if_trade_denied
                                    ? `Your trade was denied. Please pay $${discountedSubtotal.toFixed(2)} via ${order.backup_payment_method || 'Venmo/Zelle'} to complete this order.`
                                    : 'Your trade was denied. This order has been cancelled.')
                                : `You declined the trade offer. Please pay $${discountedSubtotal.toFixed(2)} via ${order.backup_payment_method || order.payment_method || 'Venmo/Zelle'} to complete this order.`)
                            : cashDue > 0
                              ? `Some of your cards were accepted. Please pay the remaining balance of $${cashDue.toFixed(2)} via ${order.backup_payment_method || 'Venmo/Zelle'} to complete this order.`
                              : 'Some of your cards were accepted. No additional payment required.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Payment Ledger */}
              <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="bg-gray-50 dark:bg-zinc-950 px-5 py-3 border-b border-gray-200 dark:border-zinc-700">
                  <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                    <CreditCard size={14} /> Payment Summary
                  </h3>
                </div>
                <div className="px-5 py-4 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>${salePrice.toFixed(2)}</span>
                  </div>
                  {discountApplied > 0 && (
                    <div className="flex justify-between text-purple-700">
                      <span>Coupon Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</span>
                      <span>-${discountApplied.toFixed(2)}</span>
                    </div>
                  )}
                  {order.trade_offer && tradeCredit > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Trade Credit Applied</span>
                      <span>-${Math.min(tradeCredit, discountedSubtotal).toFixed(2)}</span>
                    </div>
                  )}
                  {overage > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Overpayment (shop owes you)</span>
                      <span>${overage.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-3 border-t border-gray-200 dark:border-zinc-700 text-lg font-bold text-gray-900 dark:text-zinc-100">
                    <span>Total Due</span>
                    <span>${cashDue.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Cash needed banner */}
              {order.status === 'cash_needed' && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
                  <CreditCard size={14} className="inline mr-1.5" />
                  {tradeCredit === 0
                    ? (order.payment_method === 'venmo'
                        ? (order.buy_if_trade_denied
                            ? `Your trade was denied. Please pay $${discountedSubtotal.toFixed(2)} via ${order.backup_payment_method || order.payment_method || 'Venmo/Zelle'} to complete this order.`
                            : 'Your trade was denied. This order has been cancelled.')
                        : `You declined the trade offer. Please pay $${discountedSubtotal.toFixed(2)} via ${order.backup_payment_method || order.payment_method || 'Venmo/Zelle'} to complete this order.`)
                    : `Please pay the remaining balance of $${cashDue.toFixed(2)} via ${order.backup_payment_method || 'Venmo/Zelle'} to complete this order.`}
                </div>
              )}

              {/* Counteroffer banner */}
              {order.status === 'pending_counteroffer' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <div className="text-sm text-amber-900">
                    <RefreshCw size={14} className="inline mr-1.5" />
                    <span className="font-semibold">The shop has sent you a counteroffer.</span>
                    {order.counteroffer_message && (
                      <p className="mt-1 text-amber-800">{order.counteroffer_message}</p>
                    )}
                    {order.counteroffer_expires_at && (
                      <p className="mt-1 text-xs text-amber-700">
                        Expires: {new Date(order.counteroffer_expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  {order.trade_offer && (
                    <p className="text-sm text-amber-800">
                      New trade credit: <span className="font-bold">${Number(order.trade_offer.total_credit).toFixed(2)}</span>
                      {Number(order.trade_offer.total_credit) < discountedSubtotal && (
                        <span className="ml-2">— Cash due: <span className="font-bold">${(discountedSubtotal - Number(order.trade_offer.total_credit)).toFixed(2)}</span></span>
                      )}
                    </p>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={async () => {
                        const token = localStorage.getItem('access_token');
                        try {
                          const res = await axios.post('http://localhost:8000/api/orders/respond-counteroffer/', {
                            order_id: order.id,
                            response: 'accept',
                          }, { headers: { Authorization: `Bearer ${token}` } });
                          setOrder(res.data);
                        } catch { /* ignore */ }
                      }}
                      className="flex-1 bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600 transition-all active:scale-95 text-sm"
                    >
                      Accept Counteroffer
                    </button>
                    <button
                      onClick={async () => {
                        const token = localStorage.getItem('access_token');
                        try {
                          const res = await axios.post('http://localhost:8000/api/orders/respond-counteroffer/', {
                            order_id: order.id,
                            response: 'pay_cash',
                          }, { headers: { Authorization: `Bearer ${token}` } });
                          setOrder(res.data);
                        } catch { /* ignore */ }
                      }}
                      className="flex-1 bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600 transition-all active:scale-95 text-sm"
                    >
                      Deny Trade &amp; Pay Cash
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Cancel this order? Your items will be restocked.')) return;
                        const token = localStorage.getItem('access_token');
                        try {
                          const res = await axios.post('http://localhost:8000/api/orders/respond-counteroffer/', {
                            order_id: order.id,
                            response: 'cancel',
                          }, { headers: { Authorization: `Bearer ${token}` } });
                          setOrder(res.data);
                        } catch { /* ignore */ }
                      }}
                      className="flex-1 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-all active:scale-95 text-sm"
                    >
                      Decline &amp; Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Order Timeline */}
              {order.resolution_summary && order.resolution_summary.length > 0 && (
                <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 dark:bg-zinc-950 px-5 py-3 border-b border-gray-200 dark:border-zinc-700">
                    <h3 className="text-sm font-bold text-gray-700">Order Timeline</h3>
                  </div>
                  <div className="px-5 py-4">
                    <ol className="relative border-l border-gray-200 dark:border-zinc-700 ml-2 space-y-4">
                      {order.resolution_summary.map((evt, i) => (
                        <li key={i} className="ml-4">
                          <div className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full border-2 border-white bg-blue-500" />
                          <p className="text-xs text-gray-400">
                            {new Date(evt.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="text-sm text-gray-700">{evt.detail}</p>
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
