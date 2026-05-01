"use client";

import { useState, useEffect } from 'react';
import axiosInstance, { isAxiosError } from '@/app/lib/axios';
import { useCart } from '../contexts/CartContext';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import TradeCardForm from '../components/TradeCardForm';
import PickupTimeslotSelector, { type TimeslotSelection } from '../components/PickupTimeslotSelector';
import { AlertCircle, Info, ClipboardList, CreditCard, ImageIcon, CheckCircle, PackageCheck, Merge } from 'lucide-react';
import FallbackImage from '../components/FallbackImage';
import toast from 'react-hot-toast';
import { API_BASE_URL as API } from '@/app/lib/api';
import OrderMergePreviewModal, { type MergeableOrder } from '../components/OrderMergePreviewModal';
import OrderMergeConfirmModal from '../components/OrderMergeConfirmModal';
import { serializeCheckoutTradeCards, type TradeCard } from '@/app/lib/tradeCards';

interface Settings {
  trade_credit_percentage: number;
  max_trade_cards_per_order: number;
}

interface WalletSummary {
  balance: number;
}

interface ActiveSlot {
  type: 'scheduled' | 'asap';
  recurring_timeslot_id: number | null;
  pickup_date: string | null;
  label: string;
}

export default function Checkout() {
  const { cart, clearCart } = useCart();
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [selectedTimeslot, setSelectedTimeslot] = useState<TimeslotSelection | null>(null);
  const [tradeCards, setTradeCards] = useState<TradeCard[]>([]);
  const [tradeMode, setTradeMode] = useState<'all_or_nothing' | 'allow_partial'>('all_or_nothing');
  const [buyIfTradeDenied, setBuyIfTradeDenied] = useState(false);
  const [backupPaymentMethod, setBackupPaymentMethod] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Settings>({ trade_credit_percentage: 85, max_trade_cards_per_order: 5 });
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState<{
    code: string;
    discount_amount: string | null;
    discount_percent: string | null;
    min_order_total: string | null;
    specific_product_ids: number[];
    requires_cash_only: boolean;
    status: 'active' | 'disabled';
    disabled_reason: string | null;
    computed_discount: string;
  } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [activeSlots, setActiveSlots] = useState<ActiveSlot[]>([]);
  const [storeAvail, setStoreAvail] = useState<{ is_ooo: boolean; ooo_until: string | null; orders_disabled: boolean }>({ is_ooo: false, ooo_until: null, orders_disabled: false });
  const [enabledPayments, setEnabledPayments] = useState<Record<string, boolean>>({ venmo: true, zelle: true, paypal: true, cash: true, trade: true });
  const [wallet, setWallet] = useState<WalletSummary>({ balance: 0 });
  const [useStoreCredit, setUseStoreCredit] = useState(false);

  // Merge-into-order state
  const [mergeableOrders, setMergeableOrders] = useState<MergeableOrder[]>([]);
  const [mergePreviewOrder, setMergePreviewOrder] = useState<MergeableOrder | null>(null);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);

  // Only scheduled campus slots count toward the 2-slot cap; ASAP is exempt.
  const scheduledSlots = activeSlots.filter(s => s.type === 'scheduled');

  const cartTotal = cart.reduce((sum, i) => sum + (Number(i.price) || 0) * i.quantity, 0);

  // Coupon discount calculation — use server-computed discount when available
  const couponDiscountAmount = (() => {
    if (!couponDiscount || couponDiscount.status === 'disabled') return 0;
    if (couponDiscount.computed_discount && Number(couponDiscount.computed_discount) > 0) {
      return Number(couponDiscount.computed_discount);
    }
    if (couponDiscount.discount_amount) return Math.min(Number(couponDiscount.discount_amount), cartTotal);
    if (couponDiscount.discount_percent) return Math.min(cartTotal * Number(couponDiscount.discount_percent) / 100, cartTotal);
    return 0;
  })();
  const discountedTotal = Math.max(0, cartTotal - couponDiscountAmount);

  const rawTradeTotal = tradeCards.reduce((sum, c) => sum + (Number(c.estimated_value) || 0), 0);
  const effectiveCredit = rawTradeTotal * (settings.trade_credit_percentage / 100);
  const tradeCreditPreview = paymentMethod === 'cash_plus_trade' ? effectiveCredit : 0;
  const tradeCreditAppliedPreview = paymentMethod === 'cash_plus_trade' ? Math.min(effectiveCredit, discountedTotal) : 0;
  const remainingAfterTrade = Math.max(0, discountedTotal - tradeCreditAppliedPreview);
  const storeCreditAppliedPreview = useStoreCredit ? Math.min(wallet.balance, remainingAfterTrade) : 0;
  const totalDuePreview = Math.max(0, remainingAfterTrade - storeCreditAppliedPreview);
  const tradeCoversTotal = tradeCreditAppliedPreview >= discountedTotal;
  const difference = remainingAfterTrade;
  const overage = Math.max(0, effectiveCredit - discountedTotal);
  const overageWithinTolerance = overage > 0 && overage <= discountedTotal * 0.05;

  const getPaymentMinimum = (method: string) => {
    if (method === 'zelle') return 5;
    if (method === 'venmo' || method === 'paypal') return 1;
    return 0;
  };

  const cashDueForMinimum = paymentMethod === 'cash_plus_trade'
    ? totalDuePreview
    : Math.max(0, discountedTotal - storeCreditAppliedPreview);
  const effectivePaymentMethodForMinimum = paymentMethod === 'cash_plus_trade' ? backupPaymentMethod : paymentMethod;
  const minimumRequired = getPaymentMinimum(effectivePaymentMethodForMinimum);
  const violatesPaymentMinimum =
    !!effectivePaymentMethodForMinimum &&
    cashDueForMinimum > 0 &&
    cashDueForMinimum < minimumRequired;
  const paymentMinimumMessage = violatesPaymentMinimum
    ? `${effectivePaymentMethodForMinimum.toUpperCase()} requires at least $${minimumRequired.toFixed(2)}. Current total due is $${cashDueForMinimum.toFixed(2)}.`
    : '';

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    let cancelled = false;

    const loadWallet = async () => {
      try {
        const response = await axiosInstance.get(`${API}/api/trade-ins/wallet/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        const nextBalance = Number(response.data?.balance || 0);
        setWallet({ balance: nextBalance });
        setUseStoreCredit((previous) => (previous && nextBalance > 0 ? previous : false));
      } catch {
        if (!cancelled) {
          setWallet({ balance: 0 });
          setUseStoreCredit(false);
        }
      }
    };

    const refreshWallet = () => {
      void loadWallet();
    };
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void loadWallet();
      }
    };

    void loadWallet();
    window.addEventListener('focus', refreshWallet);
    window.addEventListener('pageshow', refreshWallet);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshWallet);
      window.removeEventListener('pageshow', refreshWallet);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, []);

  useEffect(() => {
    axiosInstance.get(`${API}/api/inventory/settings/`)
      .then((r) => {
        setSettings(r.data);
        setStoreAvail({
          is_ooo: !!r.data.is_ooo,
          ooo_until: r.data.ooo_until || null,
          orders_disabled: !!r.data.orders_disabled,
        });
        setEnabledPayments({
          venmo: r.data.pay_venmo_enabled !== false,
          zelle: r.data.pay_zelle_enabled !== false,
          paypal: r.data.pay_paypal_enabled !== false,
          cash: r.data.pay_cash_enabled !== false,
          trade: r.data.pay_trade_enabled !== false,
        });
      })
      .catch(() => {});
    const token = localStorage.getItem('access_token');
    if (token) {
      axiosInstance.get(`${API}/api/orders/active-timeslots/`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => setActiveSlots(r.data.active_slots || []))
        .catch(() => {});

      // Fetch orders eligible for cart-merge.
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const MERGE_STATUSES = new Set(['pending', 'trade_review', 'cash_needed']);
      axiosInstance.get(`${API}/api/orders/my-orders/`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        const tomorrowStart = new Date();
        tomorrowStart.setHours(0, 0, 0, 0);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);

        const orders: MergeableOrder[] = (r.data?.results ?? r.data ?? [])
          .filter((o: Record<string, unknown>) => {
            if (!MERGE_STATUSES.has(o.status as string)) return false;

            if (o.delivery_method === 'scheduled' && typeof o.pickup_date === 'string' && o.pickup_date) {
              const pickupDate = new Date(`${o.pickup_date}T00:00:00`);
              return pickupDate >= tomorrowStart;
            }

            const updatedAt = o.updated_at ? new Date(o.updated_at as string) : new Date(o.created_at as string);
            return Date.now() - updatedAt.getTime() <= ONE_DAY_MS;
          })
          .map((o: Record<string, unknown>) => {
            const tradeOffer = o.trade_offer as Record<string, unknown> | null;
            const oid = String(o.order_id);
            const rawDisplayItems = Array.isArray(o.display_items)
              ? o.display_items as Record<string, unknown>[]
              : Array.isArray(o.order_items)
                ? o.order_items as Record<string, unknown>[]
                : [];
            const orderItems = rawDisplayItems.map((oi) => ({
              id: typeof oi.id === 'number' ? oi.id : null,
              item: typeof oi.item === 'number' ? oi.item : undefined,
              item_title: String(oi.item_title ?? ''),
              quantity: Number(oi.quantity ?? 0),
              price_at_purchase: oi.price_at_purchase == null ? null : String(oi.price_at_purchase ?? oi.item_price ?? 0),
              subtotal: oi.subtotal == null ? undefined : String(oi.subtotal),
              image_path: typeof oi.image_path === 'string' ? oi.image_path : undefined,
            }));
            return {
              order_id: oid,
              short_id: oid.slice(0, 8),
              status: o.status as string,
              created_at: o.created_at as string,
              item_count: orderItems.reduce((sum, item) => sum + item.quantity, 0),
              order_items: orderItems,
              trade_credit: tradeOffer ? Number(tradeOffer.total_credit ?? 0) : 0,
              discount_applied: Number(o.discount_applied ?? 0),
              coupon_code: String(o.coupon_code ?? ''),
              delivery_method: String(o.delivery_method ?? ''),
              pickup_label: o.pickup_timeslot ? String(o.pickup_timeslot) : null,
            } satisfies MergeableOrder;
          });
        setMergeableOrders(orders);
      }).catch(() => {});
    }
  }, []);

  const applyCoupon = async (codeOverride?: string) => {
    const code = (codeOverride || couponCode).trim();
    if (!code) return;
    setCouponError('');
    setCouponLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const cartItems = cart.map(i => ({ item_id: i.id, quantity: i.quantity, price: Number(i.price) || 0 }));
      const res = await axiosInstance.post(`${API}/api/orders/validate-coupon/`, {
        code,
        cart_items: cartItems,
        trade_credit: tradeCreditPreview,
        store_credit: useStoreCredit ? Math.min(wallet.balance, Math.max(0, cartTotal - tradeCreditPreview)) : 0,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCouponDiscount(res.data);
      if (res.data.status === 'active') {
        if (!codeOverride) toast.success(`Coupon "${res.data.code}" applied!`);
      }
    } catch (err) {
      if (!codeOverride) setCouponDiscount(null);
      if (isAxiosError(err) && err.response?.data?.error) {
        setCouponError(err.response.data.error);
      } else {
        setCouponError('Failed to validate coupon.');
      }
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCouponDiscount(null);
    setCouponCode('');
    setCouponError('');
  };

  // Re-validate coupon when cart or trade credit changes
  useEffect(() => {
    if (couponDiscount?.code) {
      applyCoupon(couponDiscount.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartTotal, effectiveCredit, useStoreCredit, wallet.balance]);

  const validateForm = (): boolean => {
    const e: Record<string, string> = {};
    if (storeAvail.orders_disabled) {
      e.submit = 'Orders are not being accepted right now. Please try again later.';
      setErrors(e);
      return false;
    }
    const walletOnlyCheckout = useStoreCredit && paymentMethod !== 'cash_plus_trade' && Math.max(0, discountedTotal - storeCreditAppliedPreview) === 0;
    if (!paymentMethod && !walletOnlyCheckout) e.paymentMethod = 'Payment method is required';
    if (!deliveryMethod) e.deliveryMethod = 'Delivery method is required';
    if (deliveryMethod === 'scheduled' && !selectedTimeslot) e.selectedSlot = 'Pickup time is required';
    if (paymentMethod === 'cash_plus_trade') {
      if (tradeCards.length === 0) e.tradeCards = 'Add at least one card for trade-in';
      const needsBackupPayment = tradeMode === 'allow_partial' || effectiveCredit < cartTotal;
      if (needsBackupPayment && !backupPaymentMethod) e.backupPayment = 'Backup payment method is required when you may owe a cash balance';
      tradeCards.forEach((c, i) => {
        if (!c.card_name.trim()) e[`card_${i}_name`] = `Card #${i + 1} name is required`;
        if (!c.estimated_value || c.estimated_value <= 0) e[`card_${i}_value`] = `Card #${i + 1} value must be > $0`;
      });
    }
    if (violatesPaymentMinimum) {
      e.paymentMinimum = paymentMinimumMessage;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitOrder = async (method: string) => {
    if (!user || !validateForm()) return;
    const token = localStorage.getItem('access_token');
    if (!token) {
      toast.error('Session expired. Please log in again.');
      router.push('/login');
      return;
    }
    setLoading(true);
    try {
      const isTradeMethod = method === 'cash_plus_trade';
      const activeTradeCards = isTradeMethod ? tradeCards : [];
      const hasPhotos = activeTradeCards.some(c => c.photo);

      const itemsPayload = cart.map(i => ({ item_id: i.id, quantity: i.quantity }));
      const tradeCardsPayload = serializeCheckoutTradeCards(activeTradeCards);

      if (hasPhotos) {
        // Use FormData for file uploads
        const fd = new FormData();
        fd.append('items', JSON.stringify(itemsPayload));
        fd.append('payment_method', method);
        fd.append('delivery_method', deliveryMethod);
        if (deliveryMethod === 'scheduled' && selectedTimeslot) {
          fd.append('recurring_timeslot_id', String(selectedTimeslot.recurring_timeslot_id));
          fd.append('pickup_date', selectedTimeslot.pickup_date);
        }
        fd.append('discord_handle', '');
        fd.append('trade_offer_data', JSON.stringify(tradeCardsPayload));
        fd.append('trade_mode', isTradeMethod ? tradeMode : 'all_or_nothing');
        fd.append('buy_if_trade_denied', String(buyIfTradeDenied));
        fd.append('backup_payment_method', isTradeMethod && (tradeMode === 'allow_partial' || effectiveCredit < cartTotal) ? backupPaymentMethod : '');
        if (couponDiscount?.status === 'active') fd.append('coupon_code', couponDiscount.code);
        fd.append('trade_credit_total', String(Math.round(tradeCreditPreview * 100) / 100));
        fd.append('use_store_credit', String(useStoreCredit));
        // Attach photos keyed by index
        activeTradeCards.forEach((c, i) => {
          if (c.photo) fd.append(`trade_photo_${i}`, c.photo);
        });
        await axiosInstance.post(`${API}/api/orders/checkout/`, fd, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
        });
      } else {
        // Standard JSON request
        await axiosInstance.post(
          `${API}/api/orders/checkout/`,
          {
            items: itemsPayload,
            payment_method: method,
            delivery_method: deliveryMethod,
            recurring_timeslot_id: deliveryMethod === 'scheduled' && selectedTimeslot ? selectedTimeslot.recurring_timeslot_id : null,
            pickup_date: deliveryMethod === 'scheduled' && selectedTimeslot ? selectedTimeslot.pickup_date : null,
            discord_handle: '',
            trade_offer_data: JSON.stringify(tradeCardsPayload),
            trade_mode: isTradeMethod ? tradeMode : 'all_or_nothing',
            buy_if_trade_denied: buyIfTradeDenied,
            backup_payment_method: isTradeMethod && (tradeMode === 'allow_partial' || effectiveCredit < cartTotal) ? backupPaymentMethod : '',
            coupon_code: couponDiscount?.status === 'active' ? couponDiscount.code : '',
            trade_credit_total: Math.round(tradeCreditPreview * 100) / 100,
            use_store_credit: useStoreCredit,
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
      clearCart();
      toast.success('Order placed successfully!');
      router.push('/checkout/success');
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 401) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (isAxiosError(err) && err.response?.status === 400 && err.response?.data) {
        const d = err.response.data;
        if (d.error === 'trade_value_too_low') {
          const msg = `Trade credit ($${Number(d.trade_credit).toFixed(2)}) is below the sale price ($${Number(d.sale_price).toFixed(2)}). Use Trade + Balance or Full Cash instead.`;
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

          const flattenErrors = (val: unknown): string => {
            if (typeof val === 'string') return val;
            if (Array.isArray(val)) return val.map(flattenErrors).join(', ');
            if (val && typeof val === 'object') return Object.values(val).map(flattenErrors).join('; ');
            return String(val ?? '');
          };

          const mapped: Record<string, string> = {};
          let hasFieldErrors = false;

          if (typeof d === 'object' && !d.detail && !d.error) {
            for (const [field, msgs] of Object.entries(d)) {
              const key = fieldMap[field] || 'submit';
              const text = flattenErrors(msgs);
              mapped[key] = mapped[key] ? `${mapped[key]}; ${text}` : text;
              hasFieldErrors = true;
            }
          }

          if (hasFieldErrors) {
            setErrors(mapped);
            const summary = Object.values(mapped).join(' | ');
            toast.error(summary);
          } else {
            const msg = typeof d.detail === 'string' ? d.detail
              : typeof d.error === 'string' ? d.error
              : flattenErrors(d.detail || d.error || 'Order failed. Please check your inputs.');
            setErrors({ submit: msg });
            toast.error(msg);
          }
        }
      } else {
        const msg = 'Failed to process order. Please try again.';
        setErrors({ submit: msg });
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );

  if (user.is_restricted) {
    return (
      <div className="pkc-shell bg-pkmn-bg min-h-screen">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="pkc-panel p-8 border-2 border-pkmn-red/30">
            <AlertCircle className="w-16 h-16 text-pkmn-red mx-auto mb-4" />
            <h1 className="text-2xl font-heading font-bold text-pkmn-text mb-2 uppercase">Account Restricted</h1>
            <p className="text-pkmn-gray mb-4">Your account has been restricted due to multiple strikes. You cannot place new orders at this time.</p>
            <p className="text-sm text-pkmn-gray">If you believe this is an error, please contact the shop admin on Discord.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-heading font-black text-pkmn-text mb-6 uppercase">Checkout</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Form */}
          <div className="lg:col-span-2 space-y-4">
            {/* Error banner */}
            {errors.submit && (
              <div className="p-4 bg-pkmn-red/10 border border-pkmn-red/20 flex items-start space-x-2">
                <AlertCircle className="w-5 h-5 text-pkmn-red flex-shrink-0 mt-0.5" />
                <p className="text-pkmn-red text-sm">{errors.submit}</p>
              </div>
            )}

            {/* Merge-into-existing-order section */}
            {mergeableOrders.length > 0 && cart.length > 0 && (
              <div className="bg-white border border-pkmn-border p-6 shadow-sm space-y-3">
                <h2 className="text-lg font-heading font-bold text-pkmn-text flex items-center gap-2 uppercase">
                  <Merge size={20} /> Add to Existing Order
                </h2>
                <p className="text-sm text-pkmn-gray-dark">
                  You have active orders. Instead of placing a new order, you can bundle your cart into one of these:
                </p>
                <div className="space-y-2">
                  {mergeableOrders.map((mo) => {
                    const existingTotal = mo.order_items.reduce(
                      (sum, orderItem) => sum + Number(orderItem.subtotal ?? Number(orderItem.price_at_purchase || 0) * orderItem.quantity), 0
                    );
                    const cartTotal_ = cart.reduce((s, i) => s + (Number(i.price) || 0) * i.quantity, 0);
                    // Format the title from pickup_label: "Tuesday, Apr 21 • 2:00–3:00 PM • Location"
                    // If no label, fall back to delivery method
                    let pickupTitle: string;
                    let pickupSub: string | null = null;
                    if (mo.pickup_label) {
                      const parts = mo.pickup_label.split(' • ');
                      if (parts.length >= 2) {
                        pickupTitle = parts[0]; // "Tuesday, Apr 21"
                        pickupSub = parts[1];   // "Tuesday 02:12 PM - 02:13 PM"
                      } else {
                        pickupTitle = mo.pickup_label;
                      }
                    } else {
                      pickupTitle = mo.delivery_method === 'asap' ? 'ASAP Pickup' : 'Scheduled Pickup';
                    }
                    return (
                      <button
                        type="button"
                        key={mo.order_id}
                        onClick={() => setMergePreviewOrder(mo)}
                        className="flex w-full items-center justify-between gap-4 border border-pkmn-border bg-pkmn-bg px-4 py-3 text-left transition-colors hover:border-pkmn-blue hover:bg-pkmn-blue/5 focus:outline-none focus:ring-2 focus:ring-pkmn-blue focus:ring-offset-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-pkmn-text truncate">{pickupTitle}</p>
                          {pickupSub && (
                            <p className="text-xs text-pkmn-gray-dark truncate">{pickupSub}</p>
                          )}
                          <p className="text-xs text-pkmn-gray mt-0.5">
                            Order #{mo.short_id} &middot; {mo.item_count} item{mo.item_count !== 1 ? 's' : ''} &middot;{' '}
                            ${existingTotal.toFixed(2)}
                          </p>
                        </div>
                        <span className="pkc-button-primary flex-shrink-0 !px-4 !py-2 !text-xs">
                          + Add ${cartTotal_.toFixed(2)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-pkmn-gray">
                  Or continue below to place a separate new order.
                </p>
              </div>
            )}

            {/* Section 1: Contact & Delivery */}
            <div className="bg-white border border-pkmn-border p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-heading font-bold text-pkmn-text flex items-center gap-2 uppercase"><ClipboardList size={20} /> Order Details</h2>

              {/* Bundling banner */}
              {scheduledSlots.length > 0 && (
                <div className={`rounded-md p-4 text-sm ${scheduledSlots.length >= 2 ? 'bg-pkmn-yellow/10 border border-pkmn-yellow/20' : 'bg-pkmn-blue/10 border border-pkmn-blue/20'}`}>
                  <div className="flex items-start gap-2">
                    <PackageCheck size={16} className={`mt-0.5 flex-shrink-0 ${scheduledSlots.length >= 2 ? 'text-pkmn-yellow-dark' : 'text-pkmn-blue'}`} />
                    <div>
                      {scheduledSlots.length === 1 ? (
                        <>
                          <p className="font-semibold text-pkmn-text">You have an active order</p>
                          <p className="text-pkmn-gray mt-0.5">
                            Bundle with <strong>{scheduledSlots[0].label}</strong>? Select the same timeslot below to combine pickups.
                          </p>
                        </>
                      ) : scheduledSlots.length >= 2 ? (
                        <>
                          <p className="font-semibold text-pkmn-yellow-dark">Multiple active campus pickups</p>
                          <p className="text-pkmn-yellow-dark mt-0.5">
                            You already have {scheduledSlots.length} scheduled slots. Please bundle with an existing pickup:
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {scheduledSlots.map((s, i) => (
                              <li key={i} className="text-pkmn-yellow-dark">• {s.label}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold text-pkmn-text">You have active orders</p>
                          <p className="text-pkmn-gray mt-0.5">Consider bundling with an existing pickup to combine deliveries.</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Delivery Method */}
              {storeAvail.orders_disabled ? (
                <div className="border-2 border-pkmn-red/20 bg-pkmn-red/5 p-5 text-center rounded-md">
                  <AlertCircle size={24} className="mx-auto mb-2 text-pkmn-red" />
                  <p className="text-sm font-semibold text-pkmn-red">Orders are not being accepted right now.</p>
                  <p className="mt-1 text-xs text-pkmn-red/70">Please try again later.</p>
                </div>
              ) : (
              <div>
                <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Delivery Method *</label>
                {scheduledSlots.length >= 2 ? (
                  <div className="space-y-2">
                    {scheduledSlots.map((slot) => (
                      <button
                        key={`${slot.recurring_timeslot_id}-${slot.pickup_date}`}
                        type="button"
                        onClick={() => {
                          setDeliveryMethod('scheduled');
                          setSelectedTimeslot({ recurring_timeslot_id: slot.recurring_timeslot_id!, pickup_date: slot.pickup_date! });
                          setErrors({ ...errors, deliveryMethod: '', selectedSlot: '' });
                        }}
                        className={`w-full p-4 border-2 text-left transition-all duration-[120ms] ease-out ${
                          deliveryMethod === 'scheduled' && selectedTimeslot?.recurring_timeslot_id === slot.recurring_timeslot_id && selectedTimeslot?.pickup_date === slot.pickup_date
                            ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                            : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
                        }`}
                      >
                        <p className="font-semibold text-sm">Bundle: {slot.label}</p>
                        <p className="text-xs opacity-70 mt-0.5">Combine with your existing pickup</p>
                      </button>
                    ))}
                    {!storeAvail.is_ooo && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryMethod('asap');
                        setSelectedTimeslot(null);
                        setErrors({ ...errors, deliveryMethod: '', selectedSlot: '' });
                      }}
                      className={`w-full p-4 border-2 text-left transition-all duration-[120ms] ease-out ${
                        deliveryMethod === 'asap'
                          ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                          : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
                      }`}
                    >
                      <p className="font-semibold text-sm">ASAP Pickup</p>
                      <p className="text-xs opacity-70 mt-0.5">Downtown pickup ASAP</p>
                    </button>
                    )}
                    {errors.deliveryMethod && <p className="text-pkmn-red text-xs mt-1">{errors.deliveryMethod}</p>}
                    {errors.selectedSlot && <p className="text-pkmn-red text-xs mt-1">{errors.selectedSlot}</p>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: 'scheduled', label: 'Scheduled Pickup', desc: 'Choose a campus timeslot' },
                      ...(!storeAvail.is_ooo ? [{ value: 'asap', label: 'ASAP Pickup', desc: 'Downtown pickup ASAP' }] : []),
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setDeliveryMethod(opt.value); setErrors({ ...errors, deliveryMethod: '' }); }}
                        className={`p-4 border-2 text-left transition-all duration-[120ms] ease-out ${
                          deliveryMethod === opt.value
                            ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                            : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
                        }`}
                      >
                        <p className="font-semibold text-sm">{opt.label}</p>
                        <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                )}
                {errors.deliveryMethod && scheduledSlots.length < 2 && <p className="text-pkmn-red text-xs mt-1">{errors.deliveryMethod}</p>}
              </div>
              )}

              {!storeAvail.orders_disabled && deliveryMethod === 'scheduled' && scheduledSlots.length < 2 && (
                <PickupTimeslotSelector
                  value={selectedTimeslot}
                  onChange={(sel) => { setSelectedTimeslot(sel); setErrors({ ...errors, selectedSlot: '' }); }}
                  error={errors.selectedSlot}
                />
              )}
            </div>

            {/* Section 2: Payment */}
            <div className="bg-white border border-pkmn-border p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-heading font-bold text-pkmn-text flex items-center gap-2 uppercase"><CreditCard size={20} /> Payment</h2>

              {/* Payment Method */}
              <div>
                <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Payment Method *</label>
                {wallet.balance > 0 && (
                  <div className="mb-4 rounded-md border border-pkmn-blue/20 bg-pkmn-blue/10 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-pkmn-text">Store Credit Wallet</p>
                        <p className="text-xs text-pkmn-gray-dark">Available balance: ${wallet.balance.toFixed(2)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUseStoreCredit((prev) => !prev)}
                        className={`px-3 py-2 border-2 text-xs font-heading font-bold transition-all ${useStoreCredit ? 'bg-pkmn-blue border-pkmn-blue text-white' : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'}`}
                      >
                        {useStoreCredit ? 'Using Wallet' : 'Apply Wallet'}
                      </button>
                    </div>
                    {useStoreCredit && (
                      <p className="text-xs text-pkmn-blue-dark">
                        Applying ${storeCreditAppliedPreview.toFixed(2)} from your wallet at checkout.
                      </p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { value: 'venmo', label: 'Venmo', key: 'venmo' },
                    { value: 'zelle', label: 'Zelle', key: 'zelle' },
                    { value: 'paypal', label: 'PayPal', key: 'paypal' },
                    { value: 'cash', label: 'Cash', key: 'cash' },
                    { value: 'cash_plus_trade', label: 'Trade-In', key: 'trade' },
                  ].filter(opt => enabledPayments[opt.key]).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setPaymentMethod(opt.value); setErrors({ ...errors, paymentMethod: '' }); }}
                      className={`p-3 border-2 text-center text-sm font-heading font-bold transition-all duration-[120ms] ease-out ${
                        paymentMethod === opt.value
                          ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                          : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {errors.paymentMethod && <p className="text-pkmn-red text-xs mt-1">{errors.paymentMethod}</p>}
                {errors.paymentMinimum && <p className="text-pkmn-red text-xs mt-1">{errors.paymentMinimum}</p>}
                {useStoreCredit && paymentMethod !== 'cash_plus_trade' && totalDuePreview === 0 && (
                  <p className="text-xs text-green-600 mt-1">Your wallet covers the full order. No external payment is required.</p>
                )}
              </div>

              {/* Trade-In Section */}
              {paymentMethod === 'cash_plus_trade' && (
                <div className="bg-pkmn-blue/10 border border-pkmn-blue/20 p-5 space-y-4">
                  <TradeCardForm
                    cards={tradeCards}
                    onChange={setTradeCards}
                    creditPercentage={settings.trade_credit_percentage}
                    maxCards={settings.max_trade_cards_per_order}
                  />
                  {errors.tradeCards && <p className="text-pkmn-red text-xs">{errors.tradeCards}</p>}

                  {/* Trade Mode - only relevant with multiple cards */}
                  {tradeCards.length > 1 && (
                    <div className="bg-white border border-pkmn-blue/10 rounded-md p-4 space-y-2">
                      <p className="text-sm font-semibold text-pkmn-text">Trade Review Mode</p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <label className={`flex-1 flex items-center gap-2 p-3 border-2 rounded-md cursor-pointer transition-all ${tradeMode === 'all_or_nothing' ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark' : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'}`}>
                          <input type="radio" name="tradeMode" value="all_or_nothing" checked={tradeMode === 'all_or_nothing'} onChange={() => setTradeMode('all_or_nothing')} className="accent-pkmn-blue" />
                          <div>
                            <p className="text-sm font-medium text-pkmn-text">All or Nothing</p>
                            <p className="text-xs text-pkmn-gray">All cards must be accepted</p>
                          </div>
                        </label>
                        <label className={`flex-1 flex items-center gap-2 p-3 border-2 rounded-md cursor-pointer transition-all ${tradeMode === 'allow_partial' ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark' : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'}`}>
                          <input type="radio" name="tradeMode" value="allow_partial" checked={tradeMode === 'allow_partial'} onChange={() => setTradeMode('allow_partial')} className="accent-pkmn-blue" />
                          <div>
                            <p className="text-sm font-medium text-pkmn-text">Allow Partial</p>
                            <p className="text-xs text-pkmn-gray">Some cards can be accepted individually</p>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Trade value breakdown + feedback */}
                  {tradeCards.length > 0 && effectiveCredit > 0 && (
                    <div className="space-y-2">
                      <div className="bg-white/60 rounded-md px-4 py-3 text-sm space-y-1">
                        <div className="flex justify-between text-pkmn-gray-dark">
                          <span>Card Value ({tradeCards.length} card{tradeCards.length !== 1 ? 's' : ''})</span>
                          <span>${rawTradeTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-medium text-pkmn-text">
                          <span>Trade Credit ({settings.trade_credit_percentage}%)</span>
                          <span>${effectiveCredit.toFixed(2)}</span>
                        </div>
                        {storeCreditAppliedPreview > 0 && (
                          <div className="flex justify-between text-green-600">
                            <span>Store Credit Applied</span>
                            <span>${storeCreditAppliedPreview.toFixed(2)}</span>
                          </div>
                        )}
                        {overage > 0 && (
                          <div className="flex justify-between text-pkmn-yellow-dark">
                            <span>{overageWithinTolerance ? 'Equivalent Trade' : 'Shop Owes You'}</span>
                            <span>${overage.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                      <div className={`rounded-md p-3 text-sm ${
                        tradeCoversTotal
                          ? overageWithinTolerance
                            ? 'bg-green-500/10 border border-green-500/20 text-green-600'
                            : overage > 0
                              ? 'bg-pkmn-yellow/10 border border-pkmn-yellow/20 text-pkmn-yellow-dark'
                              : 'bg-green-500/10 border border-green-500/20 text-green-600'
                          : 'bg-pkmn-blue/10 border border-pkmn-blue/20 text-pkmn-blue'
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
                          <p>Trade credit (${effectiveCredit.toFixed(2)}){storeCreditAppliedPreview > 0 ? ` plus store credit ($${storeCreditAppliedPreview.toFixed(2)})` : ''} still leaves a balance due of <strong>${totalDuePreview.toFixed(2)}</strong>.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Backup payment method - required if credit < total OR allow_partial */}
                  {(tradeMode === 'allow_partial' || effectiveCredit < cartTotal) && tradeCards.length > 0 && (
                    <div className="bg-white border border-pkmn-blue/10 rounded-md p-4 space-y-2">
                      <p className="text-sm font-semibold text-pkmn-text">Backup Payment Method *</p>
                      <p className="text-xs text-pkmn-gray">
                        {effectiveCredit < cartTotal
                          ? `Please select a backup payment method. Your trade credit ($${effectiveCredit.toFixed(2)})${storeCreditAppliedPreview > 0 ? ` plus wallet credit ($${storeCreditAppliedPreview.toFixed(2)})` : ''} is less than the order total ($${discountedTotal.toFixed(2)}). Difference: $${totalDuePreview.toFixed(2)}.`
                          : 'Please select a backup payment method (Venmo / Zelle / PayPal). If some cards are rejected, we will collect the remaining balance this way.'}
                      </p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        {[
                          { value: 'venmo', label: 'Venmo' },
                          { value: 'zelle', label: 'Zelle' },
                          { value: 'paypal', label: 'PayPal' },
                          { value: 'cash', label: 'Cash' },
                        ].filter(m => enabledPayments[m.value]).map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => { setBackupPaymentMethod(m.value); setErrors({ ...errors, backupPayment: '' }); }}
                            className={`flex-1 p-3 border-2 rounded-md text-center text-sm font-medium transition-all ${
                              backupPaymentMethod === m.value
                                ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                                : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      {errors.backupPayment && <p className="text-pkmn-red text-xs">{errors.backupPayment}</p>}
                    </div>
                  )}

                  {/* Buy if trade denied */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={buyIfTradeDenied}
                      onChange={(e) => setBuyIfTradeDenied(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-pkmn-border text-pkmn-blue focus:ring-pkmn-blue"
                    />
                    <div>
                      <span className="text-sm font-medium text-pkmn-text">
                        If my trade offer is not accepted, I wish to purchase this item with cash instead.
                      </span>
                      <div className="flex items-center gap-1 mt-1">
                        <Info size={14} className="text-pkmn-gray-dark" />
                        <span className="text-xs text-pkmn-gray">
                          Your order stays active and you&apos;ll be notified to pay via Venmo/Zelle.
                        </span>
                      </div>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Submit Buttons */}
            <div className="bg-white border border-pkmn-border p-6 shadow-sm space-y-3">
              {paymentMethod === 'cash_plus_trade' && (
                <button
                  onClick={() => submitOrder('cash_plus_trade')}
                  disabled={loading || violatesPaymentMinimum}
                  className="pkc-button-accent w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Processing...' : tradeCoversTotal && storeCreditAppliedPreview === 0 ? 'Confirm Trade-In' : `Confirm Trade-In + Pay $${totalDuePreview.toFixed(2)}`}
                </button>
              )}

              {(paymentMethod && paymentMethod !== 'cash_plus_trade') || (useStoreCredit && paymentMethod !== 'cash_plus_trade' && totalDuePreview === 0) ? (
                <button
                  onClick={() => submitOrder(useStoreCredit && paymentMethod !== 'cash_plus_trade' && totalDuePreview === 0 ? 'store_credit' : paymentMethod)}
                  disabled={loading || violatesPaymentMinimum}
                  className="pkc-button-accent w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Processing...' : useStoreCredit && paymentMethod !== 'cash_plus_trade' && totalDuePreview === 0 ? 'Confirm Wallet Reservation' : 'Confirm Reservation'}
                </button>
              ) : null}

              {paymentMinimumMessage && (
                <p className="text-center text-xs text-pkmn-red">{paymentMinimumMessage}</p>
              )}

              {!paymentMethod && !(useStoreCredit && totalDuePreview === 0) && (
                <p className="text-center text-sm text-pkmn-gray-dark py-2">Select a payment method to continue</p>
              )}
            </div>
          </div>

          {/* RIGHT: Sticky Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-pkmn-border p-6 shadow-sm sticky top-8">
              <h2 className="text-xl font-heading font-black text-pkmn-text mb-4 uppercase">Order Summary</h2>

              <div className="space-y-3 pb-4 border-b border-pkmn-border">
                {cart.map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    {item.image_path ? (
                      <FallbackImage src={item.image_path} alt={item.title} className="w-12 h-12 object-cover bg-pkmn-bg" fallbackClassName="w-12 h-12 flex items-center justify-center bg-pkmn-bg text-pkmn-gray-dark" fallbackSize={20} />
                    ) : (
                      <div className="w-12 h-12 flex items-center justify-center bg-pkmn-bg text-pkmn-gray-dark"><ImageIcon size={20} /></div>
                    )}
                    <div className="flex-grow min-w-0">
                      <p className="text-sm font-medium text-pkmn-text truncate">{item.title}</p>
                      <p className="text-xs text-pkmn-gray">{item.quantity} x ${(Number(item.price) || 0).toFixed(2)}</p>
                    </div>
                    <p className="text-sm font-semibold text-pkmn-text">${((Number(item.price) || 0) * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2 py-4 border-b border-pkmn-border text-sm">
                {/* Promo code input */}
                <div className="mb-3">
                  {couponDiscount ? (
                    <div>
                      <div className={`flex items-center justify-between px-3 py-2 border ${couponDiscount.status === 'active' ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                        <div className="flex-1">
                          <span className={`text-sm font-medium ${couponDiscount.status === 'active' ? 'text-green-600' : 'text-amber-600'}`}>
                            {couponDiscount.code}: {couponDiscount.discount_amount ? `$${Number(couponDiscount.discount_amount).toFixed(2)} off` : `${Number(couponDiscount.discount_percent)}% off`}
                          </span>
                          {couponDiscount.status === 'disabled' && couponDiscount.disabled_reason && (
                            <p className="text-xs text-amber-600 mt-0.5">{couponDiscount.disabled_reason}</p>
                          )}
                        </div>
                        <button onClick={removeCoupon} className="text-pkmn-red text-xs font-semibold hover:text-pkmn-red ml-2">Remove</button>
                      </div>
                      {couponDiscount.requires_cash_only && couponDiscount.status === 'active' && (
                        <p className="text-xs text-pkmn-gray mt-1">This coupon is cash-only and cannot be combined with trade-ins.</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponCode}
                        onChange={e => { setCouponCode(e.target.value); setCouponError(''); }}
                        onKeyDown={e => e.key === 'Enter' && applyCoupon()}
                        placeholder="Promo code"
                        className="flex-1 px-3 py-2 border border-pkmn-border text-sm text-pkmn-text bg-white uppercase focus:ring-2 focus:ring-pkmn-blue"
                      />
                      <button
                        onClick={() => applyCoupon()}
                        disabled={couponLoading || !couponCode.trim()}
                        className="pkc-button-primary !px-4 !py-2 disabled:bg-pkmn-gray-dark"
                      >
                        {couponLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {couponError && <p className="text-xs text-pkmn-red mt-1">{couponError}</p>}
                </div>

                <div className="flex justify-between text-pkmn-gray">
                  <span>Subtotal</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
                {couponDiscountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Coupon Discount</span>
                    <span>-${couponDiscountAmount.toFixed(2)}</span>
                  </div>
                )}
                {paymentMethod === 'cash_plus_trade' && tradeCards.length > 0 && effectiveCredit > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Trade Credit</span>
                    <span>-${tradeCreditAppliedPreview.toFixed(2)}</span>
                  </div>
                )}
                {storeCreditAppliedPreview > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Store Credit</span>
                    <span>-${storeCreditAppliedPreview.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between pt-4 text-lg font-bold text-pkmn-text">
                <span>Total Due</span>
                <span>${totalDuePreview.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Merge preview modal */}
      {mergePreviewOrder && (
        <OrderMergePreviewModal
          order={mergePreviewOrder}
          cartItems={cart.map((i) => ({
            id: i.id,
            title: i.title,
            price: Number(i.price) || 0,
            quantity: i.quantity,
            image_path: i.image_path,
          }))}
          hasTradeCards={tradeCards.length > 0 && paymentMethod === 'cash_plus_trade'}
          open={!!mergePreviewOrder}
          onClose={() => setMergePreviewOrder(null)}
          onConfirm={() => {
            setMergeConfirmOpen(true);
          }}
        />
      )}

      {/* Merge confirm modal */}
      {mergePreviewOrder && (
        <OrderMergeConfirmModal
          order={mergePreviewOrder}
          cartItems={cart.map((i) => ({
            id: i.id,
            title: i.title,
            price: Number(i.price) || 0,
            quantity: i.quantity,
            image_path: i.image_path,
          }))}
          open={mergeConfirmOpen}
          onClose={() => setMergeConfirmOpen(false)}
          onSuccess={() => {
            const orderId = mergePreviewOrder.order_id;
            clearCart();
            setMergeConfirmOpen(false);
            setMergePreviewOrder(null);
            toast.success('Items merged into your order!');
            router.push(`/orders/${orderId}`);
          }}
        />
      )}
    </div>
  );
}