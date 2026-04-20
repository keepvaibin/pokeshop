"use client";

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import {
  Search,
  ShoppingCart,
  User,
  X,
  Plus,
  Minus,
  Trash2,
  ChevronDown,
  AlertCircle,
  Package,
  CheckCircle,
  Zap,
  Star,
  ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import FallbackImage from '../../components/FallbackImage';
import PickupTimeslotSelector, { type TimeslotSelection } from '../../components/PickupTimeslotSelector';
import Spinner from '../../components/Spinner';
import { AdminCartProvider, useAdminCart } from '../../contexts/AdminCartContext';
import { API_BASE_URL as API } from '@/app/lib/api';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface POSItem {
  id: number;
  title: string;
  slug: string;
  price: string;
  image_path: string;
  images: { id: number; image: string; position: number }[];
  stock: number;
  published_at: string | null;
  category: number | null;
  category_slug: string | null;
  short_description: string;
}

interface UserResult {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  discord_handle: string;
  nickname: string;
  is_admin: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getToken(): string {
  return typeof window !== 'undefined' ? (localStorage.getItem('access_token') ?? '') : '';
}

function authHeader() {
  return { Authorization: `Bearer ${getToken()}` };
}

function isReleased(item: POSItem): boolean {
  if (!item.published_at) return false;
  return new Date(item.published_at) <= new Date();
}

function stockLabel(stock: number): { text: string; cls: string } {
  if (stock === 0) return { text: 'Out of Stock', cls: 'bg-pkmn-red text-white' };
  if (stock <= 3) return { text: `${stock} left`, cls: 'bg-amber-100 text-amber-800' };
  return { text: `${stock} in stock`, cls: 'bg-green-100 text-green-800' };
}

// ── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ item }: { item: POSItem }) {
  const { cart, addItem, removeItem, updateQuantity } = useAdminCart();
  const cartEntry = cart.find(c => c.item_id === item.id);
  const qty = cartEntry?.quantity ?? 0;

  const imageSrc =
    item.images?.[0]?.image || (item.image_path.startsWith('http') ? item.image_path : null);

  const { text: stockText, cls: stockCls } = stockLabel(item.stock);
  const released = isReleased(item);

  function handleAdd() {
    if (item.stock === 0) return;
    addItem({
      item_id: item.id,
      title: item.title,
      price: item.price,
      stock: item.stock,
      image_path: imageSrc ?? '',
      published_at: item.published_at,
    });
  }

  return (
    <div className={`bg-white border border-pkmn-border rounded-lg overflow-hidden shadow-pkmn-card hover:shadow-pkmn-hover transition-shadow flex flex-col ${item.stock === 0 ? 'opacity-60' : ''}`}>
      {/* Image */}
      <div className="relative aspect-square bg-pkmn-bg flex items-center justify-center overflow-hidden">
        {imageSrc ? (
          <FallbackImage
            src={imageSrc}
            alt={item.title}
            className="w-full h-full object-contain p-2"
            fallbackClassName="w-full h-full flex items-center justify-center"
            fallbackSize={40}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-pkmn-gray-dark">
            <Package size={40} />
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
          {!released && (
            <span className="text-[10px] font-bold bg-pkmn-blue text-white px-1.5 py-0.5 rounded uppercase tracking-wide">
              Unreleased
            </span>
          )}
          {released && item.published_at && new Date(item.published_at) > new Date(new Date().getTime() - 7 * 86400000) && (
            <span className="text-[10px] font-bold bg-pkmn-yellow text-pkmn-text px-1.5 py-0.5 rounded uppercase tracking-wide flex items-center gap-0.5">
              <Star size={8} /> New
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-2 flex flex-col gap-1 flex-1">
        <p className="text-xs font-semibold text-pkmn-text leading-tight line-clamp-2 font-heading">
          {item.title}
        </p>
        {item.category_slug && (
          <p className="text-[10px] text-pkmn-gray-dark uppercase tracking-wide">
            {item.category_slug.replace(/-/g, ' ')}
          </p>
        )}
        <p className="text-sm font-black text-pkmn-blue font-heading">${parseFloat(item.price).toFixed(2)}</p>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded self-start ${stockCls}`}>
          {stockText}
        </span>
      </div>

      {/* Cart controls */}
      <div className="px-2 pb-2">
        {qty === 0 ? (
          <button
            onClick={handleAdd}
            disabled={item.stock === 0}
            className="w-full flex items-center justify-center gap-1 bg-pkmn-blue text-white text-xs font-bold py-1.5 rounded hover:bg-pkmn-blue-dark transition-colors disabled:bg-pkmn-disabled disabled:cursor-not-allowed"
          >
            <Plus size={12} /> Add
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => qty === 1 ? removeItem(item.id) : updateQuantity(item.id, qty - 1)}
              className="flex-none w-7 h-7 flex items-center justify-center bg-pkmn-bg border border-pkmn-border rounded hover:bg-gray-200 transition-colors"
            >
              {qty === 1 ? <Trash2 size={11} className="text-pkmn-red" /> : <Minus size={11} />}
            </button>
            <span className="flex-1 text-center text-sm font-bold text-pkmn-text">{qty}</span>
            <button
              onClick={() => updateQuantity(item.id, qty + 1)}
              disabled={qty >= item.stock}
              className="flex-none w-7 h-7 flex items-center justify-center bg-pkmn-blue text-white rounded hover:bg-pkmn-blue-dark transition-colors disabled:bg-pkmn-disabled disabled:cursor-not-allowed"
            >
              <Plus size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── User Search ───────────────────────────────────────────────────────────────

function UserSearchField({
  selectedUser,
  onSelect,
  onClear,
}: {
  selectedUser: UserResult | null;
  onSelect: (u: UserResult) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleInput(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API}/api/orders/admin/users/search/`, {
          params: { q: val },
          headers: authHeader(),
        });
        setResults(res.data);
        setOpen(true);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  if (selectedUser) {
    return (
      <div className="flex items-center gap-2 bg-pkmn-blue-light border border-pkmn-blue rounded-lg px-3 py-2">
        <User size={16} className="text-pkmn-blue flex-none" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-pkmn-text truncate">
            {selectedUser.first_name || selectedUser.nickname
              ? `${selectedUser.first_name} ${selectedUser.last_name}`.trim() || selectedUser.nickname
              : selectedUser.email}
          </p>
          <p className="text-xs text-pkmn-gray truncate">{selectedUser.email}
            {selectedUser.discord_handle && (
              <span className="ml-1 text-pkmn-blue-dark">@{selectedUser.discord_handle}</span>
            )}
          </p>
        </div>
        <button
          onClick={onClear}
          className="flex-none text-pkmn-gray-dark hover:text-pkmn-red transition-colors"
          title="Clear customer"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search by email, name, or Discord…"
          className="w-full pl-9 pr-4 py-2.5 border border-pkmn-border rounded-lg text-sm focus:outline-none focus:border-pkmn-blue bg-white placeholder:text-pkmn-gray-dark"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-pkmn-blue border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-pkmn-border rounded-lg shadow-pkmn-hover z-50 overflow-hidden">
          {results.map(u => (
            <button
              key={u.id}
              className="w-full text-left px-3 py-2.5 hover:bg-pkmn-bg border-b border-pkmn-border last:border-0 transition-colors"
              onClick={() => {
                onSelect(u);
                setQuery('');
                setResults([]);
                setOpen(false);
              }}
            >
              <p className="text-sm font-semibold text-pkmn-text">
                {(u.first_name || u.last_name)
                  ? `${u.first_name} ${u.last_name}`.trim()
                  : u.nickname || u.email}
                {u.is_admin && (
                  <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold uppercase">Admin</span>
                )}
              </p>
              <p className="text-xs text-pkmn-gray-dark">
                {u.email}
                {u.discord_handle && <span className="ml-1">· @{u.discord_handle}</span>}
              </p>
            </button>
          ))}
        </div>
      )}

      {open && !loading && results.length === 0 && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-pkmn-border rounded-lg shadow-pkmn-hover z-50 px-3 py-3 text-sm text-pkmn-gray-dark text-center">
          No users found for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

// ── Order Panel (right sidebar) ───────────────────────────────────────────────

const PAYMENT_OPTIONS = [
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'cash', label: 'Cash' },
];

function OrderPanel({
  selectedUser,
  onSelectUser,
  onClearUser,
}: {
  selectedUser: UserResult | null;
  onSelectUser: (u: UserResult) => void;
  onClearUser: () => void;
}) {
  const router = useRouter();
  const { cart, removeItem, updateQuantity, clearCart, totalPrice } = useAdminCart();

  const [paymentMethod, setPaymentMethod] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [selectedTimeslot, setSelectedTimeslot] = useState<TimeslotSelection | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const canSubmit =
    selectedUser &&
    cart.length > 0 &&
    paymentMethod &&
    deliveryMethod &&
    (deliveryMethod !== 'scheduled' || selectedTimeslot) &&
    !submitting;

  async function handleCreateOrder() {
    setFormError('');

    if (!selectedUser) { setFormError('Please select a customer.'); return; }
    if (cart.length === 0) { setFormError('Please add at least one item.'); return; }
    if (!paymentMethod) { setFormError('Please select a payment method.'); return; }
    if (!deliveryMethod) { setFormError('Please select a delivery method.'); return; }
    if (deliveryMethod === 'scheduled' && !selectedTimeslot) {
      setFormError('Please select a pickup timeslot.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        target_user_id: selectedUser.id,
        items: cart.map(c => ({ item_id: c.item_id, quantity: c.quantity })),
        payment_method: paymentMethod,
        delivery_method: deliveryMethod,
        admin_notes: adminNotes.trim(),
      };

      if (deliveryMethod === 'scheduled' && selectedTimeslot) {
        payload.recurring_timeslot_id = selectedTimeslot.recurring_timeslot_id;
        payload.pickup_date = selectedTimeslot.pickup_date;
      }

      const res = await axios.post(
        `${API}/api/orders/admin/create-order/`,
        payload,
        { headers: authHeader() },
      );

      clearCart();
      toast.success('Order created!');
      router.push(`/orders/${res.data.order_id}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error
          || Object.values(err.response?.data ?? {}).flat().join(', ')
          || 'Failed to create order.';
        setFormError(String(msg));
      } else {
        setFormError('Failed to create order. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Customer */}
      <section className="bg-white border border-pkmn-border rounded-lg p-4">
        <h3 className="text-xs font-black text-pkmn-gray-dark uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <User size={13} /> Customer
        </h3>
        <UserSearchField
          selectedUser={selectedUser}
          onSelect={onSelectUser}
          onClear={onClearUser}
        />
      </section>

      {/* Cart */}
      <section className="bg-white border border-pkmn-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-pkmn-gray-dark uppercase tracking-wider flex items-center gap-1.5">
            <ShoppingCart size={13} /> Cart
          </h3>
          {cart.length > 0 && (
            <button
              onClick={() => { if (confirm('Clear all items?')) clearCart(); }}
              className="text-xs text-pkmn-red hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <p className="text-sm text-pkmn-gray-dark text-center py-4">
            Add items from the product browser
          </p>
        ) : (
          <div className="space-y-2">
            {cart.map(item => (
              <div key={item.item_id} className="flex items-center gap-2 py-1.5 border-b border-pkmn-border last:border-0">
                {/* Thumbnail */}
                <div className="w-10 h-10 flex-none bg-pkmn-bg rounded overflow-hidden flex items-center justify-center">
                  <FallbackImage
                    src={item.image_path}
                    alt={item.title}
                    className="w-full h-full object-contain"
                    fallbackSize={16}
                    fallbackClassName="w-full h-full flex items-center justify-center"
                  />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-pkmn-text truncate">{item.title}</p>
                  <p className="text-xs text-pkmn-gray-dark">${parseFloat(item.price).toFixed(2)} × {item.quantity}</p>
                </div>
                {/* Qty controls */}
                <div className="flex items-center gap-0.5 flex-none">
                  <button
                    onClick={() => item.quantity === 1 ? removeItem(item.item_id) : updateQuantity(item.item_id, item.quantity - 1)}
                    className="w-6 h-6 flex items-center justify-center rounded border border-pkmn-border hover:bg-gray-100"
                  >
                    {item.quantity === 1 ? <Trash2 size={10} className="text-pkmn-red" /> : <Minus size={10} />}
                  </button>
                  <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.item_id, item.quantity + 1)}
                    disabled={item.quantity >= item.stock}
                    className="w-6 h-6 flex items-center justify-center rounded border border-pkmn-blue bg-pkmn-blue text-white hover:bg-pkmn-blue-dark disabled:bg-pkmn-disabled disabled:border-pkmn-disabled"
                  >
                    <Plus size={10} />
                  </button>
                </div>
                {/* Line total */}
                <p className="text-xs font-bold text-pkmn-blue w-12 text-right flex-none">
                  ${(parseFloat(item.price) * item.quantity).toFixed(2)}
                </p>
              </div>
            ))}

            {/* Total */}
            <div className="pt-2 flex items-center justify-between">
              <p className="text-sm font-black text-pkmn-text font-heading">Total</p>
              <p className="text-lg font-black text-pkmn-blue font-heading">${totalPrice.toFixed(2)}</p>
            </div>
          </div>
        )}
      </section>

      {/* Checkout Form */}
      <section className="bg-white border border-pkmn-border rounded-lg p-4 space-y-4">
        <h3 className="text-xs font-black text-pkmn-gray-dark uppercase tracking-wider flex items-center gap-1.5">
          <CheckCircle size={13} /> Checkout
        </h3>

        {/* Payment */}
        <div>
          <label className="block text-xs font-bold text-pkmn-text mb-1">Payment Method</label>
          <div className="relative">
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full appearance-none border border-pkmn-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-pkmn-blue pr-8"
            >
              <option value="">Select payment…</option>
              {PAYMENT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-pkmn-gray-dark pointer-events-none" />
          </div>
        </div>

        {/* Delivery */}
        <div>
          <label className="block text-xs font-bold text-pkmn-text mb-1">Delivery Method</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'scheduled', label: 'Campus Pickup', icon: <Package size={13} /> },
              { value: 'asap', label: 'ASAP Downtown', icon: <Zap size={13} /> },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => {
                  setDeliveryMethod(opt.value);
                  if (opt.value === 'asap') setSelectedTimeslot(null);
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-bold rounded-lg border transition-colors ${
                  deliveryMethod === opt.value
                    ? 'bg-pkmn-blue text-white border-pkmn-blue'
                    : 'bg-white text-pkmn-text border-pkmn-border hover:border-pkmn-blue'
                }`}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeslot (scheduled only) */}
        {deliveryMethod === 'scheduled' && (
          <div>
            <label className="block text-xs font-bold text-pkmn-text mb-1">Pickup Timeslot</label>
            <PickupTimeslotSelector
              value={selectedTimeslot}
              onChange={setSelectedTimeslot}
            />
          </div>
        )}

        {/* Admin Notes */}
        <div>
          <label className="block text-xs font-bold text-pkmn-text mb-1">
            Admin Notes <span className="font-normal text-pkmn-gray-dark">(optional)</span>
          </label>
          <textarea
            value={adminNotes}
            onChange={e => setAdminNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. Customer paid cash at event booth"
            className="w-full border border-pkmn-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-pkmn-blue placeholder:text-pkmn-gray-dark"
          />
        </div>

        {/* Error */}
        {formError && (
          <div className="flex items-start gap-2 bg-red-50 border border-pkmn-red rounded-lg px-3 py-2">
            <AlertCircle size={15} className="text-pkmn-red flex-none mt-0.5" />
            <p className="text-xs text-pkmn-red">{formError}</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleCreateOrder}
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 bg-pkmn-blue text-white font-black text-sm py-3 rounded-lg hover:bg-pkmn-blue-dark transition-colors disabled:bg-pkmn-disabled disabled:cursor-not-allowed font-heading uppercase tracking-wide"
        >
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <CheckCircle size={16} /> Create Order
            </>
          )}
        </button>

        {!canSubmit && !submitting && (
          <p className="text-[11px] text-pkmn-gray-dark text-center">
            {!selectedUser && 'Select a customer · '}
            {cart.length === 0 && 'Add items · '}
            {!paymentMethod && 'Choose payment · '}
            {!deliveryMethod && 'Choose delivery · '}
            {deliveryMethod === 'scheduled' && !selectedTimeslot && 'Pick a timeslot · '}
          </p>
        )}
      </section>
    </div>
  );
}

// ── Inner Page (has access to AdminCartContext) ───────────────────────────────

function POSInner() {
  const { user, loading: authLoading } = useRequireAuth({ adminOnly: true });
  const { totalItems } = useAdminCart();

  const [products, setProducts] = useState<POSItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);

  // Load inventory
  useEffect(() => {
    if (!user) return;
    axios
      .get<POSItem[]>(`${API}/api/orders/admin/pos-inventory/`, {
        headers: authHeader(),
      })
      .then(res => {
        setProducts(res.data);
        setProductsLoading(false);
      })
      .catch(() => {
        setProductsError('Failed to load inventory. Please refresh.');
        setProductsLoading(false);
      });
  }, [user]);

  const categories = [...new Set(products.map(p => p.category_slug).filter(Boolean) as string[])].sort();

  const filteredProducts = products.filter(p => {
    const matchSearch =
      !productSearch ||
      p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.short_description ?? '').toLowerCase().includes(productSearch.toLowerCase());
    const matchCategory = !categoryFilter || p.category_slug === categoryFilter;
    return matchSearch && matchCategory;
  });

  // Sort: in-stock first, then by title
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (a.stock === 0 && b.stock > 0) return 1;
    if (a.stock > 0 && b.stock === 0) return -1;
    return a.title.localeCompare(b.title);
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-pkmn-bg flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user?.is_admin) return null;

  return (
    <div className="min-h-screen bg-pkmn-bg">
      <Navbar />

      {/* Admin POS header bar */}
      <div className="bg-amber-50 border-b-2 border-pkmn-yellow">
        <div className="max-w-screen-xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/dispatch"
              className="flex items-center gap-1 text-sm text-pkmn-gray hover:text-pkmn-blue transition-colors"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Admin</span>
            </Link>
            <div className="h-4 w-px bg-pkmn-border" />
            <h1 className="text-sm font-black text-pkmn-text uppercase tracking-wider font-heading flex items-center gap-2">
              <ShoppingCart size={16} className="text-pkmn-yellow-dark" />
              Point of Sale
            </h1>
            <span className="hidden sm:inline text-xs text-pkmn-gray-dark border border-amber-300 bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold uppercase">
              Admin Only
            </span>
          </div>

          {totalItems > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-bold text-pkmn-blue">
              <ShoppingCart size={15} />
              <span>{totalItems} item{totalItems !== 1 ? 's' : ''} in cart</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        <div className="flex flex-col xl:flex-row gap-6 items-start">
          {/* ── Left: Product Browser ─────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Search + filter bar */}
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Search products…"
                  className="w-full pl-9 pr-4 py-2.5 border border-pkmn-border rounded-lg text-sm bg-white focus:outline-none focus:border-pkmn-blue placeholder:text-pkmn-gray-dark"
                />
                {productSearch && (
                  <button
                    onClick={() => setProductSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark hover:text-pkmn-text"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {categories.length > 0 && (
                <div className="relative flex-none">
                  <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="appearance-none border border-pkmn-border rounded-lg px-3 py-2.5 pr-8 text-sm bg-white focus:outline-none focus:border-pkmn-blue"
                  >
                    <option value="">All Categories</option>
                    {categories.map(c => (
                      <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-pkmn-gray-dark pointer-events-none" />
                </div>
              )}
            </div>

            {/* Count */}
            {!productsLoading && !productsError && (
              <p className="text-xs text-pkmn-gray-dark mb-3">
                {sortedProducts.length} product{sortedProducts.length !== 1 ? 's' : ''}
                {(productSearch || categoryFilter) && ' matching filters'}
              </p>
            )}

            {/* Product grid */}
            {productsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="bg-white border border-pkmn-border rounded-lg overflow-hidden animate-pulse">
                    <div className="aspect-square bg-pkmn-border" />
                    <div className="p-2 space-y-1.5">
                      <div className="h-3 bg-pkmn-border rounded w-3/4" />
                      <div className="h-3 bg-pkmn-border rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : productsError ? (
              <div className="flex items-center gap-2 bg-red-50 border border-pkmn-red rounded-lg px-4 py-3">
                <AlertCircle size={16} className="text-pkmn-red" />
                <p className="text-sm text-pkmn-red">{productsError}</p>
              </div>
            ) : sortedProducts.length === 0 ? (
              <div className="text-center py-16 text-pkmn-gray-dark">
                <Package size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No products found</p>
                {(productSearch || categoryFilter) && (
                  <button
                    onClick={() => { setProductSearch(''); setCategoryFilter(''); }}
                    className="mt-2 text-xs text-pkmn-blue hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {sortedProducts.map(item => (
                  <ProductCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Order Panel ──────────────────────────────────────────── */}
          <div className="xl:sticky xl:top-4 xl:w-80 w-full flex-none">
            <OrderPanel
              selectedUser={selectedUser}
              onSelectUser={setSelectedUser}
              onClearUser={() => setSelectedUser(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page Export (wraps POSInner with AdminCartProvider) ───────────────────────

export default function AdminPOSPage() {
  return (
    <AdminCartProvider>
      <POSInner />
    </AdminCartProvider>
  );
}
