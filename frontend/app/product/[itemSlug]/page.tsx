"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { useCart } from '../../contexts/CartContext';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/Breadcrumbs';
import Link from 'next/link';
import { ShoppingCart, Star, Clock, Minus, Plus } from 'lucide-react';
import FallbackImage from '../../components/FallbackImage';
import toast from 'react-hot-toast';
import Spinner from '../../components/Spinner';
import RichText from '../../components/RichText';
import { hasPerUserLimit, resolvePurchaseCap } from '../../components/storefrontTypes';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
  published_at: string | null;
  scheduled_drops: { id: number; quantity: number; drop_time: string; is_processed: boolean }[];
  tcg_set_name?: string;
  rarity?: string;
  is_holofoil?: boolean;
  tcg_type?: string;
  tcg_stage?: string;
  rarity_type?: string;
  tcg_supertype?: string;
  tcg_subtypes?: string;
  tcg_hp?: number;
  tcg_artist?: string;
}

export default function ProductPage() {
  const params = useParams();
  const slug = params?.itemSlug as string;
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [limitInfo, setLimitInfo] = useState<{ itemId: number | null; limitReached: boolean; remaining: number | null }>({
    itemId: null,
    limitReached: false,
    remaining: null,
  });
  const [qty, setQty] = useState(1);
  const { addToCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    if (!slug) return;
    axios
      .get(`${API}/api/inventory/items/${slug}/`)
      .then((r) => {
        setItem(r.data);
        const hero =
          r.data.images?.length > 0 ? r.data.images[0].url : r.data.image_path || '';
        setSelectedImage(hero);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!user || !item) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;
    axios
      .get(`${API}/api/orders/purchase-limits/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => {
        const limit = r.data[String(item.id)];
        setLimitInfo({
          itemId: item.id,
          limitReached: !!limit && typeof limit.remaining === 'number' && limit.remaining <= 0,
          remaining: limit ? limit.remaining : hasPerUserLimit(item.max_per_user) ? item.max_per_user : null,
        });
      })
      .catch(() => {});
  }, [user, item]);

  const limitReached = !!(user && item && limitInfo.itemId === item.id && limitInfo.limitReached);
  const remaining = user && item && limitInfo.itemId === item.id
    ? limitInfo.remaining
    : hasPerUserLimit(item?.max_per_user) ? item?.max_per_user ?? null : null;

  if (loading) {
    return (
      <div className="bg-white min-h-screen">
        <Navbar />
        <Spinner label="Loading product..." />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="bg-white min-h-screen">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="text-3xl font-heading font-black text-pkmn-text mb-2">Product not found</h1>
          <Link href="/" className="text-pkmn-blue font-semibold no-underline hover:no-underline">
            &larr; Back to shop
          </Link>
        </div>
      </div>
    );
  }

  const allImages =
    item.images.length > 0
      ? item.images.map((i) => i.url)
      : item.image_path
        ? [item.image_path]
        : [];

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Breadcrumbs */}
        <Breadcrumbs items={[
          { label: 'Home', url: '/' },
          { label: 'Shop All', url: '/tcg' },
          { label: item.title, url: `/product/${item.slug}` },
        ]} />

        {/* Main layout */}
        <div className="flex flex-col gap-10 py-4 lg:flex-row">
          {/* Left: Image Gallery */}
          <div className="w-full lg:w-1/2">
            <div className="pkc-panel flex aspect-square w-full items-center justify-center bg-[#f5f5f5] p-8 relative">
              {selectedImage ? (
                <FallbackImage
                  src={selectedImage}
                  alt={item.title}
                  className="max-h-full max-w-full object-contain"
                  fallbackClassName="flex items-center justify-center"
                  fallbackSize={64}
                />
              ) : (
                <div className="text-pkmn-gray text-center">No Image Available</div>
              )}
            </div>
            {allImages.length > 1 && (
              <div className="flex gap-2 justify-center flex-wrap mt-4">
                {allImages.map((url, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(url)}
                    className={`h-16 w-16 overflow-hidden border-2 transition-all duration-[120ms] ease-out ${
                      selectedImage === url
                          ? 'border-pkmn-blue bg-[#eef5fb]'
                        : 'border-pkmn-border hover:border-pkmn-blue/50'
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.3'; }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Details */}
          <div className="w-full min-w-0 lg:w-1/2">
            <div className="pkc-panel min-w-0 p-6">
            <h1 className="text-3xl font-heading font-black text-pkmn-text mb-2 tracking-tight break-words">{item.title}</h1>

            {/* Rating placeholder */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex text-pkmn-yellow">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={16} fill="currentColor" />
                ))}
              </div>
              <span className="text-sm text-pkmn-gray">(12 reviews)</span>
            </div>

            <p className="mb-6 text-2xl font-black text-pkmn-text">
              ${Number(item.price).toFixed(2)}
            </p>

            {/* TCG Card Data */}
            {(item.tcg_set_name || item.rarity) && (
              <div className="flex flex-wrap gap-3 mb-4 text-sm">
                {item.tcg_set_name && (
                  <span className="pkc-pill border-pkmn-border bg-[#f5f5f5]">
                    Set: <strong>{item.tcg_set_name}</strong>
                  </span>
                )}
                {item.rarity && (
                  <span className="pkc-pill border-pkmn-border bg-[#f5f5f5]">
                    Rarity: <strong>{item.rarity}</strong>
                  </span>
                )}
                {item.is_holofoil && (
                  <span className="pkc-pill border-pkmn-yellow bg-pkmn-yellow text-pkmn-text">
                    Holofoil
                  </span>
                )}
              </div>
            )}

            {/* TCG attribute pills */}
            {(item.tcg_supertype || item.tcg_type || item.tcg_stage || item.rarity_type || item.tcg_hp || item.tcg_artist) && (
              <div className="flex flex-wrap gap-1.5 mb-5">
                {item.tcg_supertype && <span className="pkc-pill border-pkmn-blue/20 bg-pkmn-blue/10 text-pkmn-blue">{item.tcg_supertype}</span>}
                {item.tcg_type && <span className="pkc-pill border-orange-500/20 bg-orange-100 text-orange-700">{item.tcg_type}</span>}
                {item.tcg_stage && <span className="pkc-pill border-green-600/20 bg-green-100 text-green-700">{item.tcg_stage}</span>}
                {item.rarity_type && <span className="pkc-pill border-purple-500/20 bg-purple-100 text-purple-700">{item.rarity_type}</span>}
                {item.tcg_hp != null && <span className="pkc-pill border-pkmn-red/20 bg-red-100 text-red-700">{item.tcg_hp} HP</span>}
                {item.tcg_artist && <span className="pkc-pill border-pkmn-border bg-[#f5f5f5] text-pkmn-gray-dark">Artist {item.tcg_artist}</span>}
              </div>
            )}

            {/* Description */}
            <RichText
              html={item.description}
              className="text-pkmn-gray-dark leading-relaxed mb-6 min-w-0 break-words [overflow-wrap:anywhere] [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic [&_table]:max-w-full"
            />
            </div>

            {/* Action Block */}
            {limitReached ? (
              <div className="pkc-panel mt-8 p-6">
                <div className="w-full flex items-center justify-center gap-2 py-4 bg-orange-500/10 border-2 border-orange-500/20 text-orange-600 font-bold text-lg">
                  <Clock size={20} /> Limit Reached. Resets at noon!
                </div>
              </div>
            ) : item.stock > 0 ? (
              <div className="pkc-panel mt-8 p-6">
                <div className="flex items-center gap-4">
                  {/* Quantity */}
                  <div className="flex items-center border border-pkmn-gray-mid bg-white">
                    <button
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      className="p-3 hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out"
                    >
                      <Minus size={16} className={qty <= 1 ? 'text-pkmn-gray-dark' : 'text-pkmn-text'} />
                    </button>
                    <span className="w-12 text-center font-bold text-pkmn-text">{qty}</span>
                    <button
                      onClick={() => {
                        const maxQty = resolvePurchaseCap(item.stock, item.max_per_user, remaining);
                        setQty(Math.min(qty + 1, maxQty));
                      }}
                      className="p-3 hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out"
                    >
                      <Plus size={16} className="text-pkmn-text" />
                    </button>
                  </div>
                  {/* Add to Cart */}
                  <button
                    onClick={() => {
                      const ok = addToCart({ ...item, image_path: (item.images.length > 0 && item.images[0].url) || item.image_path }, qty);
                      if (ok) toast.success(`${qty}x ${item.title} added to cart!`);
                      else toast.error(`Maximum quantity reached for ${item.title}`);
                    }}
                    className="pkc-button-accent flex-1 !py-3 text-sm"
                  >
                    <ShoppingCart size={20} /> Add to Cart
                  </button>
                </div>
                {typeof remaining === 'number' && hasPerUserLimit(item.max_per_user) && remaining < item.max_per_user && (
                  <p className="text-xs text-orange-600 font-medium mt-2">{remaining} remaining today</p>
                )}
              </div>
            ) : (
              <div className="pkc-panel mt-8 p-6">
                <button className="w-full bg-pkmn-border text-pkmn-gray cursor-not-allowed border border-pkmn-border font-heading font-bold text-lg py-3 uppercase" disabled>
                  OUT OF STOCK
                </button>
                <button className="pkc-button-secondary mt-3 w-full">
                  Email me when available
                </button>
                {(() => {
                  const upcoming = item.scheduled_drops?.filter(d => !d.is_processed) ?? [];
                  if (upcoming.length === 0) return null;
                  return (
                    <div className="mt-4 border border-pkmn-blue/30 bg-pkmn-blue/10 p-3 space-y-1.5">
                      <p className="text-sm font-bold text-pkmn-blue">Upcoming Restocks</p>
                      {upcoming.map(d => (
                        <div key={d.id} className="flex items-center justify-between text-sm">
                          <span className="text-pkmn-blue font-medium">+{d.quantity} units</span>
                          <span className="text-pkmn-gray">{new Date(d.drop_time).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
