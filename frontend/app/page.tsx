"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useCart } from './contexts/CartContext';
import { useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import Link from 'next/link';
import { Star, X, Eye, Clock, ImageIcon, Zap, Flame, TrendingUp, Frown, Minus, Plus } from 'lucide-react';
import FallbackImage from './components/FallbackImage';
import toast from 'react-hot-toast';
import Spinner from './components/Spinner';
import RichText from './components/RichText';

interface ItemImage {
  id: number;
  url: string;
  position: number;
}

interface Item {
  id: number;
  title: string;
  slug: string;
  description: string;
  short_description: string;
  price: number;
  image_path: string;
  stock: number;
  max_per_user: number;
  images: ItemImage[];
  go_live_date: string | null;
}

export default function Storefront() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quickView, setQuickView] = useState<Item | null>(null);
  const [quickViewQty, setQuickViewQty] = useState(1);
  const [purchaseLimits, setPurchaseLimits] = useState<Record<string, { purchased_24h: number; max_per_user: number; remaining: number }>>({});
  const { addToCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    axios
      .get('http://localhost:8000/api/inventory/items/')
      .then((r) => setItems(r.data))
      .catch(() => setError('Failed to load items. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  // Fetch 24h purchase limits when user is logged in
  useEffect(() => {
    if (!user) { setPurchaseLimits({}); return; }
    const token = localStorage.getItem('access_token');
    if (!token) return;
    axios
      .get('http://localhost:8000/api/orders/purchase-limits/?all=1', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => setPurchaseLimits(r.data))
      .catch(() => {});
  }, [user]);

  const isLimitReached = (itemId: number): boolean => {
    const limit = purchaseLimits[String(itemId)];
    return !!limit && limit.remaining <= 0;
  };

  const heroImage = (item: Item): string | null => {
    if (item.images.length > 0 && item.images[0].url) return item.images[0].url;
    if (item.image_path) return item.image_path;
    return null;
  };

  return (
    <div className="bg-slate-50 min-h-screen">
      <Navbar />

      {/* Hero Banner */}
      <div className="w-full h-80 bg-gradient-to-r from-yellow-400 via-red-500 to-blue-600 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <Zap className="absolute top-10 left-10 w-16 h-16 text-white/20" />
          <div className="absolute bottom-10 right-10 w-16 h-16 rounded-full bg-white/20" />
        </div>
        <div className="text-center text-white relative z-10">
          <h1 className="text-5xl font-black mb-3 drop-shadow-lg">
            Welcome to UCSC Pok&eacute;shop
          </h1>
          <p className="text-2xl font-semibold drop-shadow-md">
            Gotta catch &apos;em all! Premium Pok&eacute;mon gear for Slugs
          </p>
        </div>
      </div>

      {/* Trending */}
      <div className="bg-white border-b-4 border-yellow-400 py-4">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center space-x-2 text-red-600 font-bold text-lg">
            <Flame className="w-6 h-6" />
            <span>Trending Now</span>
          </div>
          <p className="text-gray-600 text-sm mt-1">
            Limited availability &bull; Must-have items
          </p>
        </div>
      </div>

      {/* Items grid */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h2 className="text-4xl font-black text-gray-900 mb-2">
            Featured Items
          </h2>
          <div className="w-16 h-1 bg-gradient-to-r from-yellow-400 to-red-500" />
        </div>

        {loading ? (
          <Spinner label="Loading items..." />
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
            <Frown className="w-10 h-10 text-red-500 mx-auto mb-3" />
            <p className="text-red-800 font-medium mb-3">{error}</p>
            <button onClick={() => { setError(''); setLoading(true); axios.get('http://localhost:8000/api/inventory/items/').then(r => setItems(r.data)).catch(() => setError('Failed to load items.')).finally(() => setLoading(false)); }} className="text-blue-600 hover:underline font-semibold">Try Again</button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
            <TrendingUp className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              Coming Soon!
            </h3>
            <p className="text-gray-600 text-lg mb-2">
              Our Squirtles are still gathering stock&hellip;
            </p>
            <p className="text-gray-500">
              Check back soon for amazing Pok&eacute;mon merchandise!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="group bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all duration-300 flex flex-col"
              >
                <Link
                  href={`/product/${item.slug}`}
                  className="relative bg-gray-100 block aspect-square"
                >
                  {heroImage(item) ? (
                    <FallbackImage
                      src={heroImage(item)!}
                      alt={item.title}
                      className={`w-full h-full object-contain p-2 ${item.stock === 0 ? 'grayscale opacity-60' : ''}`}
                      fallbackClassName={`w-full h-full flex items-center justify-center text-gray-400 ${item.stock === 0 ? 'grayscale opacity-60' : ''}`}
                      fallbackSize={48}
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-gray-200 text-gray-400 text-4xl ${item.stock === 0 ? 'grayscale opacity-60' : ''}`}>
                      <ImageIcon size={48} />
                    </div>
                  )}
                  {item.stock === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold">
                        Sold Out
                      </span>
                    </div>
                  )}
                  {item.stock > 0 && item.stock <= 3 && (
                    <div className="absolute top-2 right-2 bg-orange-500 text-white px-3 py-1 rounded-full text-xs font-bold">
                      Only {item.stock} left!
                    </div>
                  )}
                </Link>

                <div className="p-4 flex-grow flex flex-col">
                  <Link
                    href={`/product/${item.slug}`}
                    className="text-lg font-bold text-gray-900 mb-1 line-clamp-2 hover:text-blue-600 transition-colors break-words overflow-wrap-anywhere"
                  >
                    {item.title}
                  </Link>
                  {item.short_description && (
                    <p className="text-sm text-gray-500 mb-1 line-clamp-2 break-words overflow-wrap-anywhere whitespace-normal">{item.short_description}</p>
                  )}
                  <p className="text-blue-600 font-bold text-lg mb-2">
                    ${Number(item.price).toFixed(2)}
                  </p>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">
                      Stock: {item.stock}
                    </span>
                    <div className="flex text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={14} fill="currentColor" />
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto">
                    {isLimitReached(item.id) ? (
                      <div className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-sm font-semibold">
                        <Clock size={16} /> Limit Reached (resets at noon)
                      </div>
                    ) : (
                    <button
                      onClick={() => { setQuickView(item); setQuickViewQty(1); }}
                      disabled={item.stock === 0}
                      className={`w-full font-semibold py-2.5 px-3 rounded-lg transition-all flex items-center justify-center gap-2 text-sm ${item.stock === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-yellow-400 to-red-500 text-white hover:from-yellow-500 hover:to-red-600 active:scale-95'}`}
                    >
                      <Eye size={16} /> {item.stock === 0 ? 'Sold Out' : 'Quick View'}
                    </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick View Modal */}
      {quickView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { setQuickView(null); setQuickViewQty(1); }}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setQuickView(null); setQuickViewQty(1); }}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
            >
              <X size={20} className="text-gray-600" />
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
              {/* Left Column — Image */}
              <div className="space-y-3">
                <div className="aspect-square bg-gray-50 flex items-center justify-center p-4 rounded-lg">
                  {heroImage(quickView) ? (
                    <FallbackImage
                      src={heroImage(quickView)!}
                      alt={quickView.title}
                      className="object-contain w-full h-full"
                      fallbackClassName="flex items-center justify-center w-full h-full"
                      fallbackSize={64}
                    />
                  ) : (
                    <ImageIcon size={64} className="text-gray-400" />
                  )}
                </div>
                {quickView.images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {quickView.images.map((img) => (
                      <FallbackImage
                        key={img.id}
                        src={img.url}
                        alt=""
                        className="w-14 h-14 object-cover rounded-lg border-2 border-gray-200 flex-shrink-0"
                        fallbackClassName="w-14 h-14 rounded-lg border-2 border-gray-200 bg-gray-100 flex items-center justify-center flex-shrink-0"
                        fallbackSize={16}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column — Details */}
              <div className="flex flex-col min-w-0 overflow-hidden flex-1">
                <h2 className="text-2xl font-bold text-gray-900 mb-2 break-words">
                  {quickView.title}
                </h2>
                <p className="text-xl font-bold text-blue-600 mb-3">
                  ${Number(quickView.price).toFixed(2)}
                </p>
                {quickView.short_description && (
                  <p className="min-w-0 break-words overflow-wrap-anywhere whitespace-normal text-gray-600 text-sm mb-4">
                    {quickView.short_description}
                  </p>
                )}
                <p className="text-sm text-gray-500 mb-4">
                  Stock: {quickView.stock}
                </p>
                {quickView.stock > 0 && !isLimitReached(quickView.id) && (
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-sm font-medium text-gray-700">Qty:</span>
                    <div className="flex items-center border border-gray-300 rounded-lg">
                      <button onClick={() => setQuickViewQty(q => Math.max(1, q - 1))} className="p-2 hover:bg-gray-100 transition-colors rounded-l-lg" disabled={quickViewQty <= 1}><Minus size={16} className={quickViewQty <= 1 ? 'text-gray-300' : 'text-gray-600'} /></button>
                      <span className="px-4 py-1 text-sm font-semibold min-w-[2rem] text-center">{quickViewQty}</span>
                      {(() => { const limit = purchaseLimits[String(quickView.id)]; const maxQty = Math.min(quickView.stock, limit?.remaining ?? quickView.max_per_user); return (
                      <button onClick={() => setQuickViewQty(q => Math.min(maxQty, q + 1))} className="p-2 hover:bg-gray-100 transition-colors rounded-r-lg" disabled={quickViewQty >= maxQty}><Plus size={16} className={quickViewQty >= maxQty ? 'text-gray-300' : 'text-gray-600'} /></button>
                      ); })()}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-3 mt-auto">
                  {quickView.stock > 0 && !isLimitReached(quickView.id) && (
                    <button
                      onClick={() => {
                        const ok = addToCart({ ...quickView, image_path: heroImage(quickView) || quickView.image_path }, quickViewQty);
                        if (ok) {
                          toast.success(`${quickView.title} x${quickViewQty} added to cart!`);
                        } else {
                          toast.error(`Maximum quantity reached for ${quickView.title}`);
                        }
                        setQuickView(null);
                        setQuickViewQty(1);
                      }}
                      className="w-full bg-gradient-to-r from-yellow-400 to-red-500 text-white font-bold py-3 rounded-lg hover:from-yellow-500 hover:to-red-600 active:scale-95 transition-all"
                    >
                      Add to Cart ({quickViewQty})
                    </button>
                  )}
                  {quickView.stock > 0 && isLimitReached(quickView.id) && (
                    <div className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 font-semibold text-sm">
                      <Clock size={16} /> Limit Reached (resets at noon)
                    </div>
                  )}
                  <Link
                    href={`/product/${quickView.slug}`}
                    className="w-full text-center border border-gray-300 text-gray-700 font-semibold py-3 rounded-lg hover:bg-gray-50 transition-colors"
                    onClick={() => { setQuickView(null); setQuickViewQty(1); }}
                  >
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-900 text-white py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-gray-400">
            &copy; 2026 UCSC Pok&eacute;shop. Pok&eacute;mon is a trademark of
            Nintendo/Game Freak.
          </p>
        </div>
      </div>
    </div>
  );
}
