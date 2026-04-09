"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useCart } from '../contexts/CartContext';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import TradeCardForm, { type TradeCard } from '../components/TradeCardForm';
import PickupTimeslotSelector, { type TimeslotSelection } from '../components/PickupTimeslotSelector';
import { AlertCircle, Info, ClipboardList, CreditCard, Calendar, Zap, DollarSign, ArrowLeftRight, Wallet, ImageIcon, Clock, CheckCircle } from 'lucide-react';
import FallbackImage from '../components/FallbackImage';
import toast from 'react-hot-toast';

interface Settings {
  trade_credit_percentage: number;
  max_trade_cards_per_order: number;
}

export default function Checkout() {
  const { cart, clearCart, removeFromCart } = useCart();
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [selectedTimeslot, setSelectedTimeslot] = useState<TimeslotSelection | null>(null);
  const [discordHandle, setDiscordHandle] = useState('');
  const [tradeCards, setTradeCards] = useState<TradeCard[]>([]);
  const [tradeMode, setTradeMode] = useState<'all_or_nothing' | 'allow_partial'>('all_or_nothing');
  const [buyIfTradeDenied, setBuyIfTradeDenied] = useState(false);
  const [backupPaymentMethod, setBackupPaymentMethod] = useState('');
  const [preferredPickupTime, setPreferredPickupTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Settings>({ trade_credit_percentage: 85, max_trade_cards_per_order: 5 });

  const cartTotal = cart.reduce((sum, i) => sum + (Number(i.price) || 0) * i.quantity, 0);
  const rawTradeTotal = tradeCards.reduce((sum, c) => sum + (Number(c.estimated_value) || 0), 0);
  const effectiveCredit = rawTradeTotal * (settings.trade_credit_percentage / 100);
  const tradeCoversTotal = effectiveCredit >= cartTotal;
  const difference = Math.max(0, cartTotal - effectiveCredit);
  const overage = Math.max(0, effectiveCredit - cartTotal);
  const overageWithinTolerance = overage > 0 && overage <= cartTotal * 0.05;

  useEffect(() => {
    axios.get('http://localhost:8000/api/inventory/settings/')
      .then((r) => setSettings(r.data))
      .catch(console.error);
  }, []);

  const validateForm = (): boolean => {
    const e: Record<string, string> = {};
    if (!paymentMethod) e.paymentMethod = 'Payment method is required';
    if (!deliveryMethod) e.deliveryMethod = 'Delivery method is required';
    if (deliveryMethod === 'scheduled' && !selectedTimeslot) e.selectedSlot = 'Pickup time is required';
    if (!discordHandle.trim()) e.discordHandle = 'Discord handle is required';
    if (paymentMethod === 'cash_plus_trade') {
      if (tradeCards.length === 0) e.tradeCards = 'Add at least one card for trade-in';
      const needsBackupPayment = tradeMode === 'allow_partial' || effectiveCredit < cartTotal;
      if (needsBackupPayment && !backupPaymentMethod) e.backupPayment = 'Backup payment method is required when you may owe a cash balance';
      tradeCards.forEach((c, i) => {
        if (!c.card_name.trim()) e[`card_${i}_name`] = `Card #${i + 1} name is required`;
        if (!c.estimated_value || c.estimated_value <= 0) e[`card_${i}_value`] = `Card #${i + 1} value must be > $0`;
      });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitOrder = async (method: string) => {
    if (!user || !validateForm()) return;
    setLoading(true);
    const succeededIds: number[] = [];
    try {
      const token = localStorage.getItem('access_token');
      for (const item of cart) {
        const isTradeMethod = method === 'cash_plus_trade';
        const activeTradeCards = isTradeMethod ? tradeCards : [];
        const hasPhotos = activeTradeCards.some(c => c.photo);

        // Build trade_cards data (without File objects)
        const tradeCardsPayload = activeTradeCards.map(c => ({
          card_name: c.card_name,
          estimated_value: c.estimated_value,
          condition: c.condition,
          rarity: c.rarity,
          is_wanted_card: c.is_wanted_card,
          tcg_product_id: c.tcg_product_id || null,
          tcg_sub_type: c.tcg_sub_type || '',
          base_market_price: c.base_market_price || null,
          custom_price: c.custom_price || null,
        }));

        if (hasPhotos) {
          // Use FormData for file uploads
          const fd = new FormData();
          fd.append('item_id', String(item.id));
          fd.append('quantity', String(item.quantity));
          fd.append('payment_method', method);
          fd.append('delivery_method', deliveryMethod);
          if (deliveryMethod === 'scheduled' && selectedTimeslot) {
            fd.append('recurring_timeslot_id', String(selectedTimeslot.recurring_timeslot_id));
            fd.append('pickup_date', selectedTimeslot.pickup_date);
          }
          fd.append('discord_handle', discordHandle.trim());
          fd.append('trade_offer_data', JSON.stringify(tradeCardsPayload));
          fd.append('trade_mode', isTradeMethod ? tradeMode : 'all_or_nothing');
          fd.append('buy_if_trade_denied', String(buyIfTradeDenied));
          fd.append('backup_payment_method', isTradeMethod && (tradeMode === 'allow_partial' || effectiveCredit < cartTotal) ? backupPaymentMethod : '');
          fd.append('preferred_pickup_time', preferredPickupTime.trim());
          // Attach photos keyed by index
          activeTradeCards.forEach((c, i) => {
            if (c.photo) fd.append(`trade_photo_${i}`, c.photo);
          });
          await axios.post('http://localhost:8000/api/orders/checkout/', fd, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
          });
        } else {
          // Standard JSON request
          await axios.post(
            'http://localhost:8000/api/orders/checkout/',
            {
              item_id: item.id,
              quantity: item.quantity,
              payment_method: method,
              delivery_method: deliveryMethod,
              recurring_timeslot_id: deliveryMethod === 'scheduled' && selectedTimeslot ? selectedTimeslot.recurring_timeslot_id : null,
              pickup_date: deliveryMethod === 'scheduled' && selectedTimeslot ? selectedTimeslot.pickup_date : null,
              discord_handle: discordHandle.trim(),
              trade_offer_data: JSON.stringify(tradeCardsPayload),
              trade_mode: isTradeMethod ? tradeMode : 'all_or_nothing',
              buy_if_trade_denied: buyIfTradeDenied,
              backup_payment_method: isTradeMethod && (tradeMode === 'allow_partial' || effectiveCredit < cartTotal) ? backupPaymentMethod : '',
              preferred_pickup_time: preferredPickupTime.trim(),
            },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
        succeededIds.push(item.id);
      }
      clearCart();
      toast.success('Order placed successfully!');
      router.push('/checkout/success');
    } catch (err) {
      // Remove already-ordered items from cart so retry doesn't duplicate them
      if (succeededIds.length > 0) {
        succeededIds.forEach(id => removeFromCart(id));
      }
      console.error('Checkout error:', err);
      if (axios.isAxiosError(err)) console.error('Checkout validation errors:', err.response?.data);
      if (axios.isAxiosError(err) && err.response?.status === 400 && err.response?.data) {
        const d = err.response.data;
        if (d.error === 'trade_value_too_low') {
          const msg = `Trade credit ($${Number(d.trade_credit).toFixed(2)}) is below the sale price ($${Number(d.sale_price).toFixed(2)}). Use Cash + Trade or Full Cash instead.`;
          setErrors({ submit: msg });
          toast.error(msg);
        } else {
          // Map DRF field-level errors to inline form sections
          const fieldMap: Record<string, string> = {
            discord_handle: 'discordHandle',
            delivery_method: 'deliveryMethod',
            payment_method: 'paymentMethod',
            trade_cards: 'tradeCards',
            trade_mode: 'tradeCards',
            pickup_date: 'selectedSlot',
            recurring_timeslot_id: 'selectedSlot',
            pickup_timeslot_id: 'selectedSlot',
          };
          const mapped: Record<string, string> = {};
          let hasFieldErrors = false;

          if (typeof d === 'object' && !d.detail && !d.error) {
            for (const [field, msgs] of Object.entries(d)) {
              const key = fieldMap[field] || 'submit';
              const text = Array.isArray(msgs) ? msgs.join(', ') : String(msgs);
              mapped[key] = mapped[key] ? `${mapped[key]}; ${text}` : text;
              hasFieldErrors = true;
            }
          }

          if (hasFieldErrors) {
            setErrors(mapped);
            const summary = Object.values(mapped).join(' | ');
            toast.error(summary);
          } else {
            const msg = d.detail || d.error || 'Order failed. Please check your inputs.';
            setErrors({ submit: String(msg) });
            toast.error(String(msg));
          }
        }
      } else {
        const failedCount = cart.length - succeededIds.length;
        const msg = succeededIds.length > 0
          ? `${succeededIds.length} item(s) ordered successfully, but ${failedCount} failed. Please retry.`
          : 'Failed to process order. Please try again.';
        setErrors({ submit: msg });
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
        </div>
      </div>
    );

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Checkout</h1>
        <p className="text-gray-600 mb-6">Complete your order details below</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Form */}
          <div className="lg:col-span-2 space-y-5">
            {/* Error banner */}
            {errors.submit && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-800 text-sm">{errors.submit}</p>
              </div>
            )}

            {/* Section 1: Contact & Delivery */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><ClipboardList size={20} /> Order Details</h2>

              {/* Discord Handle */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Discord Handle *</label>
                <input
                  type="text"
                  value={discordHandle}
                  onChange={(e) => { setDiscordHandle(e.target.value); setErrors({ ...errors, discordHandle: '' }); }}
                  className={`w-full p-3 border rounded-lg text-gray-900 focus:ring-2 focus:border-transparent transition-colors ${errors.discordHandle ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                  placeholder="e.g., YourName#1234"
                />
                {errors.discordHandle && <p className="text-red-500 text-xs mt-1">{errors.discordHandle}</p>}
              </div>

              {/* Delivery Method */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Delivery Method *</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'scheduled', label: 'Scheduled Pickup', desc: 'Choose a campus timeslot' },
                    { value: 'asap', label: 'ASAP Pickup', desc: 'Downtown pickup ASAP' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setDeliveryMethod(opt.value); setErrors({ ...errors, deliveryMethod: '' }); }}
                      className={`p-4 border-2 rounded-xl text-left transition-all ${
                        deliveryMethod === opt.value
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                          : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <p className={`font-semibold text-sm ${deliveryMethod === opt.value ? 'text-blue-800' : 'text-gray-900'}`}>{opt.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
                {errors.deliveryMethod && <p className="text-red-500 text-xs mt-1">{errors.deliveryMethod}</p>}
              </div>

              {/* Pickup Timeslot */}
              {deliveryMethod === 'scheduled' && (
                <PickupTimeslotSelector
                  value={selectedTimeslot}
                  onChange={(sel) => { setSelectedTimeslot(sel); setErrors({ ...errors, selectedSlot: '' }); }}
                  error={errors.selectedSlot}
                />
              )}

              {/* Preferred Pickup Time */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Preferred Pickup Time</label>
                <input
                  type="text"
                  value={preferredPickupTime}
                  onChange={(e) => setPreferredPickupTime(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  placeholder="e.g., Weekdays after 3pm, Fridays only"
                />
                <p className="text-gray-500 text-xs mt-1">Optional — let us know when works best for you</p>
              </div>
            </div>

            {/* Section 2: Payment */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><CreditCard size={20} /> Payment</h2>

              {/* Payment Method */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method *</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { value: 'venmo', label: 'Venmo' },
                    { value: 'zelle', label: 'Zelle' },
                    { value: 'paypal', label: 'PayPal' },
                    { value: 'cash_plus_trade', label: 'Trade-In' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setPaymentMethod(opt.value); setErrors({ ...errors, paymentMethod: '' }); }}
                      className={`p-3 border-2 rounded-xl text-center text-sm font-medium transition-all ${
                        paymentMethod === opt.value
                          ? 'border-blue-500 bg-blue-50 text-blue-800 ring-2 ring-blue-200'
                          : 'border-gray-200 text-gray-700 hover:border-blue-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {errors.paymentMethod && <p className="text-red-500 text-xs mt-1">{errors.paymentMethod}</p>}
              </div>

              {/* Trade-In Section */}
              {paymentMethod === 'cash_plus_trade' && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                  <TradeCardForm
                    cards={tradeCards}
                    onChange={setTradeCards}
                    creditPercentage={settings.trade_credit_percentage}
                    maxCards={settings.max_trade_cards_per_order}
                  />
                  {errors.tradeCards && <p className="text-red-500 text-xs">{errors.tradeCards}</p>}

                  {/* Trade Mode */}
                  {tradeCards.length > 0 && (
                    <div className="bg-white border border-blue-100 rounded-lg p-4 space-y-2">
                      <p className="text-sm font-semibold text-gray-800">Trade Review Mode</p>
                      <div className="flex gap-3">
                        <label className={`flex-1 flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-all ${tradeMode === 'all_or_nothing' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                          <input type="radio" name="tradeMode" value="all_or_nothing" checked={tradeMode === 'all_or_nothing'} onChange={() => setTradeMode('all_or_nothing')} className="accent-blue-600" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">All or Nothing</p>
                            <p className="text-xs text-gray-500">All cards must be accepted</p>
                          </div>
                        </label>
                        <label className={`flex-1 flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-all ${tradeMode === 'allow_partial' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                          <input type="radio" name="tradeMode" value="allow_partial" checked={tradeMode === 'allow_partial'} onChange={() => setTradeMode('allow_partial')} className="accent-blue-600" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">Allow Partial</p>
                            <p className="text-xs text-gray-500">Some cards can be accepted individually</p>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Trade value feedback */}
                  {tradeCards.length > 0 && effectiveCredit > 0 && (
                    <div className={`rounded-lg p-3 text-sm ${
                      tradeCoversTotal
                        ? overageWithinTolerance
                          ? 'bg-green-50 border border-green-200 text-green-800'
                          : overage > 0
                            ? 'bg-amber-50 border border-amber-200 text-amber-800'
                            : 'bg-green-50 border border-green-200 text-green-800'
                        : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
                    }`}>
                      {tradeCoversTotal ? (
                        overageWithinTolerance ? (
                          <p><CheckCircle size={14} className="inline mr-1" />Your cards are an equivalent trade (${effectiveCredit.toFixed(2)} credit vs ${cartTotal.toFixed(2)} total). No cash needed!</p>
                        ) : overage > 0 ? (
                          <p><AlertCircle size={14} className="inline mr-1" />Your trade credit (${effectiveCredit.toFixed(2)}) exceeds the total (${cartTotal.toFixed(2)}) by <strong>${overage.toFixed(2)}</strong>. Keepvaibin will owe you back the difference.</p>
                        ) : (
                          <p><CheckCircle size={14} className="inline mr-1" />Your cards exactly cover the total (${cartTotal.toFixed(2)}). Straight trade is available.</p>
                        )
                      ) : (
                        <p>Trade credit (${effectiveCredit.toFixed(2)}) is below the total (${cartTotal.toFixed(2)}). Difference: <strong>${difference.toFixed(2)}</strong></p>
                      )}
                    </div>
                  )}

                  {/* Backup payment method — required if credit < total OR allow_partial */}
                  {(tradeMode === 'allow_partial' || effectiveCredit < cartTotal) && tradeCards.length > 0 && (
                    <div className="bg-white border border-blue-100 rounded-lg p-4 space-y-2">
                      <p className="text-sm font-semibold text-gray-800">Backup Payment Method *</p>
                      <p className="text-xs text-gray-500">
                        {effectiveCredit < cartTotal
                          ? `Please select a backup payment method (Venmo / Zelle / PayPal). Your trade credit ($${effectiveCredit.toFixed(2)}) is less than the order total ($${cartTotal.toFixed(2)}). Difference: $${difference.toFixed(2)}.`
                          : 'Please select a backup payment method (Venmo / Zelle / PayPal). If some cards are rejected, we will collect the remaining balance this way.'}
                      </p>
                      <div className="flex gap-3">
                        {['venmo', 'zelle', 'paypal'].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => { setBackupPaymentMethod(m); setErrors({ ...errors, backupPayment: '' }); }}
                            className={`flex-1 p-3 border-2 rounded-lg text-center text-sm font-medium capitalize transition-all ${
                              backupPaymentMethod === m
                                ? 'border-blue-500 bg-blue-50 text-blue-800'
                                : 'border-gray-200 text-gray-700 hover:border-blue-300'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      {errors.backupPayment && <p className="text-red-500 text-xs">{errors.backupPayment}</p>}
                    </div>
                  )}

                  {/* Buy if trade denied */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={buyIfTradeDenied}
                      onChange={(e) => setBuyIfTradeDenied(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        If my trade offer is not accepted, I wish to purchase this item with cash instead.
                      </span>
                      <div className="flex items-center gap-1 mt-1">
                        <Info size={14} className="text-gray-400" />
                        <span className="text-xs text-gray-500">
                          Your order stays active and you'll be notified to pay via Venmo/Zelle.
                        </span>
                      </div>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Submit Buttons */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
              {paymentMethod === 'cash_plus_trade' && (
                <button
                  onClick={() => submitOrder('cash_plus_trade')}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'Processing...' : tradeCoversTotal ? 'Confirm Trade-In' : `Confirm Trade-In + Pay $${difference.toFixed(2)}`}
                </button>
              )}

              {paymentMethod && paymentMethod !== 'cash_plus_trade' && (
                <button
                  onClick={() => submitOrder(paymentMethod)}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                >
                  {loading ? 'Processing...' : 'Confirm Reservation'}
                </button>
              )}

              {!paymentMethod && (
                <p className="text-center text-sm text-gray-400 py-2">Select a payment method to continue</p>
              )}
            </div>
          </div>

          {/* RIGHT: Sticky Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm sticky top-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Order Summary</h2>

              <div className="space-y-3 pb-4 border-b border-gray-200">
                {cart.map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    {item.image_path ? (
                      <FallbackImage src={item.image_path} alt={item.title} className="w-12 h-12 object-cover rounded-lg bg-gray-100" fallbackClassName="w-12 h-12 flex items-center justify-center rounded-lg bg-gray-200 text-gray-400" fallbackSize={20} />
                    ) : (
                      <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-gray-200 text-gray-400"><ImageIcon size={20} /></div>
                    )}
                    <div className="flex-grow min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.quantity} × ${(Number(item.price) || 0).toFixed(2)}</p>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">${((Number(item.price) || 0) * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2 py-4 border-b border-gray-200 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
                {paymentMethod === 'cash_plus_trade' && tradeCards.length > 0 && (
                  <>
                    <div className="flex justify-between text-gray-500">
                      <span>Card Value ({tradeCards.length})</span>
                      <span>${rawTradeTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-green-600">
                      <span>Trade Credit ({settings.trade_credit_percentage}%)</span>
                      <span>-${Math.min(effectiveCredit, cartTotal).toFixed(2)}</span>
                    </div>
                    {overage > 0 && (
                      <div className="flex justify-between text-amber-600">
                        <span>{overageWithinTolerance ? 'Equivalent Trade' : 'Shop Owes You'}</span>
                        <span>${overage.toFixed(2)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Shipping</span>
                  <span className="text-green-600 font-medium">Free</span>
                </div>
              </div>

              <div className="flex justify-between pt-4 text-lg font-bold text-gray-900">
                <span>Total Due</span>
                <span>${paymentMethod === 'cash_plus_trade' ? (tradeCoversTotal ? '0.00' : difference.toFixed(2)) : cartTotal.toFixed(2)}</span>
              </div>

              {preferredPickupTime && (
                <div className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                  <Clock size={14} className="inline mr-1" /> Preferred pickup: {preferredPickupTime}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}