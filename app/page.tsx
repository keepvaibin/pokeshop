"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useCart } from './contexts/CartContext';
import { useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import Link from 'next/link';
import { X, Clock, Minus, Plus } from 'lucide-react';
import FallbackImage from './components/FallbackImage';
import toast from 'react-hot-toast';
import Spinner from './components/Spinner';
import HeroBanner from './components/HeroBanner';
import PromoTile from './components/PromoTile';
import ProductCarousel from './components/ProductCarousel';
import ProductCard from './components/ProductCard';

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
  is_holofoil?: boolean;
  rarity?: string;
}

interface BannerData {
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string;
  size: string;
  position_order: number;
}

interface HomepageSection {
  id: number;
  title: string;
  section_type: string;
  items: Item[];
  banners: BannerData[];
}

export default function Storefront() {
  const [items, setItems] = useState<Item[]>([]);
  const [sections, setSections] = useState<HomepageSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quickView, setQuickView] = useState<Item | null>(null);
  const [quickViewQty, setQuickViewQty] = useState(1);
  const [purchaseLimits, setPurchaseLimits] = useState<Record<string, { purchased_24h: number; max_per_user: number; remaining: number }>>({});
  const { addToCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/api/inventory/items/`).then(r => r.data.results ?? r.data),
      axios.get(`${API}/api/inventory/homepage-sections/`).then(r => r.data.results ?? r.data).catch(() => []),
    ])
      .then(([itemsData, sectionsData]) => {
        setItems(itemsData);
        setSections(sectionsData);
      })
      .catch(() => setError('Failed to load items. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) { setPurchaseLimits({}); return; }
    const token = localStorage.getItem('access_token');
    if (!token) return;
    axios
      .get(`${API}/api/orders/purchase-limits/?all=1`, {
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

  const hasCarouselSection = sections.some(s => s.section_type === 'CAROUSEL');

  return (
    <div className="bg-white min-h-screen">
      <Navbar />

      {/* CMS-driven sections OR default layout */}
      {sections.length > 0 ? (
        sections.map(section => {
          if (section.section_type === 'HERO' && section.banners.length > 0) {
            const banner = section.banners[0];
            return (
              <HeroBanner
                key={section.id}
                title={banner.title}
                subtitle={banner.subtitle || undefined}
                imageUrl={banner.image_url}
                linkUrl={banner.link_url}
              />
            );
          }
          if (section.section_type === 'CAROUSEL') {
            const carouselItems = section.items.length > 0 ? section.items : items.slice(0, 12);
            return (
              <div key={section.id} className="max-w-7xl mx-auto px-4 py-8">
                <ProductCarousel
                  title={section.title}
                  items={carouselItems.map(i => ({ ...i, price: String(i.price) }))}
                />
              </div>
            );
          }
          if (section.section_type === 'GRID') {
            const gridBanners = section.banners.filter(b => b.size === 'QUARTER');
            return (
              <div key={section.id} className="max-w-7xl mx-auto px-4 py-8">
                <h2 className="text-2xl font-heading font-black text-center mb-6 uppercase text-pkmn-text">
                  {section.title}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {gridBanners.map(banner => (
                    <PromoTile
                      key={banner.id}
                      title={banner.title}
                      imageUrl={banner.image_url}
                      linkUrl={banner.link_url}
                    />
                  ))}
                </div>
              </div>
            );
          }
          return null;
        })
      ) : (
        <>
          {/* Default Hero */}
          <HeroBanner
            title="Welcome to UCSC Pokéshop"
            subtitle="Premium Pokémon TCG cards, packs & accessories for Slugs"
            imageUrl=""
            linkUrl="/products"
          />

          {/* Default Quick-Link Grid */}
          <div className="max-w-7xl mx-auto px-4 py-8">
            <h2 className="text-2xl font-heading font-black text-center mb-6 uppercase text-pkmn-text">
              Shop by Category
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <PromoTile title="TCG Cards" imageUrl="" linkUrl="/products?category=tcg-cards" />
              <PromoTile title="Sealed Products" imageUrl="" linkUrl="/products?category=sealed" />
              <PromoTile title="Accessories" imageUrl="" linkUrl="/products?category=accessories" />
              <PromoTile title="New Releases" imageUrl="" linkUrl="/products" />
            </div>
          </div>
        </>
      )}

      {/* Featured Items Section */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <Spinner label="Loading items..." />
        ) : error ? (
          <div className="bg-pkmn-red/10 border border-pkmn-red/20 p-8 text-center">
            <p className="text-pkmn-red font-medium mb-3">{error}</p>
            <button
              onClick={() => {
                setError('');
                setLoading(true);
                axios.get(`${API}/api/inventory/items/`)
                  .then(r => setItems(r.data.results ?? r.data))
                  .catch(() => setError('Failed to load items.'))
                  .finally(() => setLoading(false));
              }}
              className="text-pkmn-blue hover:underline font-semibold"
            >
              Try Again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-pkmn-border p-12 text-center">
            <h3 className="text-2xl font-heading font-bold text-pkmn-text mb-2">Coming Soon!</h3>
            <p className="text-pkmn-gray">Check back soon for amazing Pokémon merchandise!</p>
          </div>
        ) : (
          <>
            {!hasCarouselSection && (
              <div className="mb-12">
                <ProductCarousel
                  title="New Arrivals"
                  items={items.slice(0, 12).map(i => ({ ...i, price: String(i.price) }))}
                />
              </div>
            )}

            <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase mb-6">All Products</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {items.map((item) => (
                <div key={item.id} onClick={() => { setQuickView(item); setQuickViewQty(1); }} className="cursor-pointer">
                  <ProductCard item={{ ...item, price: String(item.price) }} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Quick View Modal */}
      {quickView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { setQuickView(null); setQuickViewQty(1); }}
        >
          <div
            className="relative bg-white border border-pkmn-border shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setQuickView(null); setQuickViewQty(1); }}
              className="absolute top-4 right-4 p-2 hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out z-10"
            >
              <X size={20} className="text-pkmn-gray" />
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
              <div className="space-y-3">
                <div className="aspect-square bg-pkmn-bg flex items-center justify-center p-4">
                  {heroImage(quickView) ? (
                    <FallbackImage
                      src={heroImage(quickView)!}
                      alt={quickView.title}
                      className="object-contain w-full h-full"
                      fallbackClassName="flex items-center justify-center w-full h-full"
                      fallbackSize={64}
                    />
                  ) : (
                    <div className="text-pkmn-gray text-center">No Image</div>
                  )}
                </div>
                {quickView.images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {quickView.images.map((img) => (
                      <FallbackImage
                        key={img.id}
                        src={img.url}
                        alt=""
                        className="w-14 h-14 object-cover rounded-lg border-2 border-pkmn-border flex-shrink-0"
                        fallbackClassName="w-14 h-14 rounded-lg border-2 border-pkmn-border bg-pkmn-bg flex items-center justify-center flex-shrink-0"
                        fallbackSize={16}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col min-w-0 overflow-hidden flex-1">
                <h2 className="text-2xl font-heading font-black text-pkmn-text mb-2 break-words tracking-tight">
                  {quickView.title}
                </h2>
                <p className="text-xl font-black text-pkmn-blue mb-3">
                  ${Number(quickView.price).toFixed(2)}
                </p>
                {quickView.short_description && (
                  <p className="text-pkmn-gray-dark text-sm mb-4 leading-relaxed break-words">
                    {quickView.short_description}
                  </p>
                )}
                <p className="text-sm text-pkmn-gray mb-4">
                  {quickView.stock > 0 ? `${quickView.stock} in stock` : 'Out of Stock'}
                </p>

                {quickView.stock > 0 && !isLimitReached(quickView.id) && (
                  <div className="bg-pkmn-bg p-4 border border-pkmn-border mb-4">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-sm font-bold text-pkmn-text">Qty:</span>
                      <div className="flex items-center bg-white border border-pkmn-border">
                        <button onClick={() => setQuickViewQty(q => Math.max(1, q - 1))} className="p-2 hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out" disabled={quickViewQty <= 1}>
                          <Minus size={16} className={quickViewQty <= 1 ? 'text-pkmn-gray-dark' : 'text-pkmn-text'} />
                        </button>
                        <span className="px-4 py-1 text-sm font-bold min-w-[2rem] text-center">{quickViewQty}</span>
                        {(() => {
                          const limit = purchaseLimits[String(quickView.id)];
                          const maxQty = Math.min(quickView.stock, limit?.remaining ?? quickView.max_per_user);
                          return (
                            <button onClick={() => setQuickViewQty(q => Math.min(maxQty, q + 1))} className="p-2 hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out" disabled={quickViewQty >= maxQty}>
                              <Plus size={16} className={quickViewQty >= maxQty ? 'text-pkmn-gray-dark' : 'text-pkmn-text'} />
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const ok = addToCart({ ...quickView, image_path: heroImage(quickView) || quickView.image_path }, quickViewQty);
                        if (ok) toast.success(`${quickView.title} x${quickViewQty} added to cart!`);
                        else toast.error(`Maximum quantity reached for ${quickView.title}`);
                        setQuickView(null);
                        setQuickViewQty(1);
                      }}
                      className="w-full bg-pkmn-red hover:bg-pkmn-red-dark text-white font-heading font-bold text-lg py-3 uppercase tracking-[0.0625rem] shadow-md transition-colors duration-[120ms] ease-out"
                    >
                      Add to Cart
                    </button>
                  </div>
                )}

                {quickView.stock > 0 && isLimitReached(quickView.id) && (
                  <div className="w-full flex items-center justify-center gap-2 py-3 bg-orange-500/10 border border-orange-500/20 text-orange-600 font-semibold text-sm mb-4">
                    <Clock size={16} /> Limit Reached (resets at noon)
                  </div>
                )}

                {quickView.stock <= 0 && (
                  <div className="mb-4">
                    <button className="w-full bg-pkmn-border text-pkmn-gray cursor-not-allowed border border-pkmn-border font-heading font-bold text-lg py-3 uppercase" disabled>
                      OUT OF STOCK
                    </button>
                    {(() => {
                      const nd = quickView.scheduled_drops?.find(d => !d.is_processed);
                      return nd ? (
                        <p className="text-sm text-pkmn-blue font-bold mt-2 text-center">
                          Restock: {new Date(nd.drop_time).toLocaleDateString()}
                        </p>
                      ) : null;
                    })()}
                  </div>
                )}

                <Link
                  href={`/product/${quickView.slug}`}
                  className="w-full text-center border border-pkmn-border text-pkmn-text font-heading font-bold py-3 hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out block uppercase tracking-[0.0625rem] no-underline hover:no-underline"
                  onClick={() => { setQuickView(null); setQuickViewQty(1); }}
                >
                  View Full Details
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
