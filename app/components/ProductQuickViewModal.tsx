"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Clock, Minus, Plus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import { API_BASE_URL as API } from '@/app/lib/api';
import FallbackImage from './FallbackImage';
import { formatPerUserLimit, hasPerUserLimit, resolvePurchaseCap, type StorefrontItem } from './storefrontTypes';

interface PurchaseLimit {
  purchased_24h: number;
  max_per_user: number;
  remaining: number | null;
}

interface ProductQuickViewModalProps {
  item: StorefrontItem;
  onClose: () => void;
}

export default function ProductQuickViewModal({ item, onClose }: ProductQuickViewModalProps) {
  const { addToCart } = useCart();
  const { user } = useAuth();
  const [purchaseLimits, setPurchaseLimits] = useState<Record<string, PurchaseLimit>>({});
  const [quantity, setQuantity] = useState(1);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const gallery = useMemo(() => {
    if (item.images.length > 0) {
      return item.images;
    }
    if (item.image_path) {
      return [{ id: -1, url: item.image_path }];
    }
    return [];
  }, [item.image_path, item.images]);

  const selectedImageUrl = gallery[selectedImageIndex]?.url || item.image_path || '';
  const limit = user ? purchaseLimits[String(item.id)] : undefined;
  const purchaseCap = resolvePurchaseCap(item.stock, item.max_per_user, limit?.remaining);
  const maxQty = item.stock > 0 ? Math.max(1, purchaseCap) : 1;
  const isLimitReached = !!limit && typeof limit.remaining === 'number' && limit.remaining <= 0;
  const nextDrop = item.scheduled_drops?.find((drop) => !drop.is_processed);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      return;
    }

    axios
      .get(`${API}/api/orders/purchase-limits/?all=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => setPurchaseLimits(response.data))
      .catch(() => {});
  }, [user]);

  const handleAddToCart = () => {
    const ok = addToCart(
      {
        id: item.id,
        title: item.title,
        price: Number(item.price),
        image_path: selectedImageUrl || item.image_path,
        description: item.description,
        max_per_user: item.max_per_user,
        stock: item.stock,
      },
      quantity,
    );

    if (ok) {
      toast.success(`${item.title} x${quantity} added to cart!`);
      onClose();
      return;
    }

    toast.error(`Maximum quantity reached for ${item.title}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative max-h-[92vh] w-full max-w-5xl overflow-y-auto border border-pkmn-border bg-white shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-view-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center border border-pkmn-border bg-white text-pkmn-text transition-colors duration-[120ms] ease-out hover:border-pkmn-blue hover:text-pkmn-blue"
          aria-label="Close quick view"
        >
          <X size={18} />
        </button>

        <div className="grid gap-8 p-6 md:grid-cols-[1.05fr_0.95fr] md:p-8">
          <div className="space-y-4">
            <div className="overflow-hidden border border-pkmn-border bg-[#f5f5f5] p-4">
              <div className="aspect-square overflow-hidden border border-pkmn-border bg-white">
                {selectedImageUrl ? (
                  <FallbackImage
                    src={selectedImageUrl}
                    alt={item.title}
                    className="h-full w-full object-contain"
                    fallbackClassName="flex h-full w-full items-center justify-center"
                    fallbackSize={64}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-pkmn-gray-dark">
                    No image available
                  </div>
                )}
              </div>
            </div>

            {gallery.length > 1 && (
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
                {gallery.map((image, index) => {
                  const isActive = index === selectedImageIndex;
                  return (
                    <button
                      key={image.id ?? image.url}
                      type="button"
                      onClick={() => setSelectedImageIndex(index)}
                      className={`overflow-hidden border-2 bg-white p-1 transition-colors duration-[120ms] ease-out ${
                        isActive ? 'border-pkmn-blue bg-[#eef5fb]' : 'border-pkmn-border hover:border-pkmn-blue/60'
                      }`}
                    >
                      <FallbackImage
                        src={image.url}
                        alt=""
                        className="h-16 w-full object-cover"
                        fallbackClassName="flex h-16 w-full items-center justify-center bg-pkmn-bg"
                        fallbackSize={18}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="border-b border-pkmn-border pb-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="pkc-pill border-pkmn-blue/25 bg-pkmn-blue/10 text-pkmn-blue-dark">
                  Quick View
                </span>
                {item.rarity && (
                  <Link href={`/search?rarity_type=${encodeURIComponent(item.rarity)}`} className="pkc-pill border-pkmn-yellow/30 bg-pkmn-yellow/10 text-pkmn-yellow-dark hover:bg-pkmn-yellow/20 transition-colors cursor-pointer no-underline">
                    {item.rarity}
                  </Link>
                )}
                {item.is_holofoil && (
                  <span className="pkc-pill border-pkmn-yellow bg-pkmn-yellow text-black">
                    Holofoil
                  </span>
                )}
              </div>

              <h2 id="quick-view-title" className="text-3xl font-heading font-black leading-tight text-pkmn-text">
                {item.title}
              </h2>

              <div className="mt-4 flex items-end justify-between gap-4">
                <p className="text-3xl font-heading font-black text-pkmn-text">
                  ${Number(item.price).toFixed(2)}
                </p>
                <div className="text-right text-sm text-pkmn-gray">
                  <p className="font-semibold text-pkmn-text">
                    {item.stock > 0 ? `${item.stock} in stock` : 'Out of Stock'}
                  </p>
                  <p>{hasPerUserLimit(item.max_per_user) ? `Limit ${formatPerUserLimit(item.max_per_user)} per customer` : 'No purchase limit'}</p>
                </div>
              </div>

              {(item.short_description || item.description) && (
                <p className="mt-4 text-sm leading-7 text-pkmn-gray-dark">
                  {item.short_description || item.description}
                </p>
              )}
            </div>

            <div className="mt-5 space-y-4">
              {item.stock > 0 && !isLimitReached && (
                <div className="pkc-filter-panel p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-heading font-bold uppercase tracking-[0.08rem] text-pkmn-text">Quantity</p>
                    <div className="flex items-center overflow-hidden border border-pkmn-gray-mid bg-white">
                      <button
                        type="button"
                        onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                        className="p-3 text-pkmn-text transition-colors duration-[120ms] ease-out hover:bg-pkmn-bg disabled:text-pkmn-gray-dark"
                        disabled={quantity <= 1}
                      >
                        <Minus size={16} />
                      </button>
                      <span className="min-w-[3rem] text-center text-sm font-bold text-pkmn-text">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity((current) => Math.min(maxQty, current + 1))}
                        className="p-3 text-pkmn-text transition-colors duration-[120ms] ease-out hover:bg-pkmn-bg disabled:text-pkmn-gray-dark"
                        disabled={quantity >= maxQty}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="pkc-button-accent mt-4 w-full !py-3.5 text-sm"
                  >
                    Add to Cart
                  </button>
                </div>
              )}

              {item.stock > 0 && isLimitReached && (
                <div className="flex items-center gap-2 border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-600">
                  <Clock size={16} /> Limit reached for today. Try again after the purchase window resets.
                </div>
              )}

              {item.stock <= 0 && (
                <div className="border border-pkmn-border bg-[#f5f5f5] px-4 py-4 text-sm text-pkmn-gray-dark">
                  <p className="font-semibold uppercase tracking-[0.08rem] text-pkmn-text">Currently unavailable</p>
                  {nextDrop ? (
                    <p className="mt-1">
                      Next restock: {new Date(nextDrop.drop_time).toLocaleDateString()} at{' '}
                      {new Date(nextDrop.drop_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  ) : (
                    <p className="mt-1">This item is sold out right now.</p>
                  )}
                </div>
              )}

              <Link
                href={`/product/${item.slug}`}
                onClick={onClose}
                className="pkc-button-secondary w-full no-underline hover:no-underline"
              >
                View Full Details
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}