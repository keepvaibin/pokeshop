"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { useCart } from '../../contexts/CartContext';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import Link from 'next/link';
import { ArrowLeft, ShoppingCart, Star, Clock, Minus, Plus, Frown, ImageIcon } from 'lucide-react';
import FallbackImage from '../../components/FallbackImage';
import toast from 'react-hot-toast';
import Spinner from '../../components/Spinner';
import RichText from '../../components/RichText';

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
}

export default function ProductPage() {
  const params = useParams();
  const slug = params?.itemSlug as string;
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [limitReached, setLimitReached] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const { addToCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    if (!slug) return;
    axios
      .get(`http://localhost:8000/api/inventory/items/${slug}/`)
      .then((r) => {
        setItem(r.data);
        const hero =
          r.data.images?.length > 0 ? r.data.images[0].url : r.data.image_path || '';
        setSelectedImage(hero);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  // Fetch 24h purchase limit for this item
  useEffect(() => {
    if (!user || !item) { // eslint-disable-next-line react-hooks/set-state-in-effect
      setLimitReached(false); return; }
    const token = localStorage.getItem('access_token');
    if (!token) return;
    axios
      .get('http://localhost:8000/api/orders/purchase-limits/', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => {
        const limit = r.data[String(item.id)];
        setLimitReached(!!limit && limit.remaining <= 0);
        setRemaining(limit ? limit.remaining : item.max_per_user);
      })
      .catch(() => {});
  }, [user, item?.id, item?.max_per_user]);

  if (loading) {
    return (
      <div className="bg-zinc-50 min-h-screen">
        <Navbar />
        <Spinner label="Loading product..." />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="bg-zinc-50 min-h-screen">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <Frown className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-zinc-100 mb-2">Product not found</h1>
          <Link href="/" className="text-blue-600 hover:underline font-semibold">
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
    <div className="bg-zinc-50 min-h-screen">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-zinc-100 dark:text-zinc-100 mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> Back to shop
        </Link>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm overflow-hidden">
          <div className="md:flex">
            {/* Gallery */}
            <div className="md:w-1/2 bg-gray-100 dark:bg-zinc-800 p-8">
              <div className="flex items-center justify-center aspect-square mb-4">
                {selectedImage ? (
                  <FallbackImage
                    src={selectedImage}
                    alt={item.title}
                    className="max-h-full max-w-full object-contain rounded-xl"
                    fallbackClassName="flex items-center justify-center"
                    fallbackSize={64}
                  />
                ) : (
                  <div className="flex items-center justify-center text-gray-400">
                    <ArrowLeft size={64} />
                  </div>
                )}
              </div>
              {allImages.length > 1 && (
                <div className="flex gap-2 justify-center flex-wrap">
                  {allImages.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImage(url)}
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        selectedImage === url
                          ? 'border-blue-500 ring-2 ring-blue-200'
                          : 'border-gray-200 dark:border-zinc-700 hover:border-gray-400'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.3'; }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="md:w-1/2 p-8 flex flex-col">
              <h1 className="text-3xl font-black text-gray-900 dark:text-zinc-100 mb-2 break-words">{item.title}</h1>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex text-yellow-400">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={16} fill="currentColor" />
                  ))}
                </div>
                <span className="text-sm text-gray-500">(5.0)</span>
              </div>

              <p className="text-3xl font-bold text-blue-600 mb-6">
                ${Number(item.price).toFixed(2)}
              </p>

              <RichText html={item.description} className="mb-6 leading-relaxed flex-grow text-gray-600 min-w-0 break-words overflow-wrap-anywhere whitespace-normal [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Availability</span>
                  <span
                    className={`font-semibold ${item.stock > 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {item.stock > 0 ? `${item.stock} in stock` : 'Out of stock'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Max per student</span>
                  <span className="font-semibold text-gray-900 dark:text-zinc-100">
                    {item.max_per_user}
                  </span>
                </div>
              </div>

              {limitReached ? (
                <div className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-orange-50 border-2 border-orange-200 text-orange-700 font-bold text-lg">
                  <Clock size={20} /> Limit Reached. Resets at noon!
                </div>
              ) : item.stock > 0 ? (
                <div className="space-y-3">
                  {/* Quantity Selector */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-700">Quantity:</span>
                    <div className="flex items-center bg-gray-100 dark:bg-zinc-800 rounded-lg p-1">
                      <button
                        onClick={() => setQty(Math.max(1, qty - 1))}
                        className="p-2 hover:bg-gray-200 rounded transition-colors text-gray-700"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="w-10 text-center font-semibold text-gray-900 dark:text-zinc-100">{qty}</span>
                      <button
                        onClick={() => {
                          const maxQty = Math.min(item.stock, remaining ?? item.max_per_user);
                          setQty(Math.min(qty + 1, maxQty));
                        }}
                        className="p-2 hover:bg-gray-200 rounded transition-colors text-gray-700"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    {remaining !== null && remaining < item.max_per_user && (
                      <span className="text-xs text-orange-600 font-medium">{remaining} left today</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const ok = addToCart({ ...item, image_path: (item.images.length > 0 && item.images[0].url) || item.image_path }, qty);
                      if (ok) toast.success(`${qty}× ${item.title} added to cart!`);
                      else toast.error(`Maximum quantity reached for ${item.title}`);
                    }}
                    className="w-full bg-gradient-to-r from-yellow-400 to-red-500 text-white font-bold py-4 rounded-xl hover:from-yellow-500 hover:to-red-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-lg"
                  >
                    <ShoppingCart size={20} /> Add to Cart
                  </button>
                </div>
              ) : (
                <div className="w-full bg-gray-200 text-gray-500 font-bold py-4 rounded-xl text-center">
                  Sold Out
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-zinc-900 dark:bg-zinc-950 text-zinc-100 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-zinc-400">
            &copy; 2026 UCSC Pok&eacute;shop. Pok&eacute;mon is a trademark of
            Nintendo/Game Freak.
          </p>
        </div>
      </div>
    </div>
  );
}
