"use client";

import { useEffect, useState, useMemo } from 'react';
import useSWR from 'swr';
import { publicFetcher } from './lib/fetcher';
import Navbar from './components/Navbar';
import Spinner from './components/Spinner';
import HeroBanner from './components/HeroBanner';
import PromoTile from './components/PromoTile';
import ProductCarousel from './components/ProductCarousel';
import ProductCard from './components/ProductCard';
import ProductQuickViewModal from './components/ProductQuickViewModal';
import AdminDashboard from './components/AdminDashboard';
import AnnouncementBanner from './components/AnnouncementBanner';
import { useAuth } from './contexts/AuthContext';
import type { StorefrontItem } from './components/storefrontTypes';

interface BannerData {
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string;
  display_image_url?: string;
  link_url: string;
  size: string;
  position_order: number;
}

interface HomepageSection {
  id: number;
  title: string;
  section_type: string;
  items: StorefrontItem[];
  banners: BannerData[];
}

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [viewMode, setViewMode] = useState<'admin' | 'storefront'>('admin');
  const [viewInitialized, setViewInitialized] = useState(false);

  useEffect(() => {
    if (!authLoading && !viewInitialized) {
      setViewMode(isAdmin ? 'admin' : 'storefront');
      setViewInitialized(true);
    }
  }, [authLoading, isAdmin, viewInitialized]);

  const [quickView, setQuickView] = useState<StorefrontItem | null>(null);

  const { data: itemsData, error: itemsError, mutate: mutateItems } = useSWR(
    '/api/inventory/items/',
    publicFetcher
  );
  const items: StorefrontItem[] = useMemo(
    () => itemsData?.results ?? itemsData ?? [],
    [itemsData]
  );

  const { data: sectionsData } = useSWR(
    '/api/inventory/homepage-sections/',
    publicFetcher
  );
  const sections: HomepageSection[] = useMemo(
    () => sectionsData?.results ?? sectionsData ?? [],
    [sectionsData]
  );

  const loading = !itemsData && !itemsError;
  const error = itemsError ? 'Failed to load items. Please try again.' : '';

  const hasCarouselSection = sections.some(s => s.section_type === 'CAROUSEL');

  const inAdminMode = isAdmin && viewMode === 'admin';

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      {!inAdminMode && <AnnouncementBanner />}
      <Navbar
        adminMode={inAdminMode}
        viewMode={isAdmin ? viewMode : undefined}
        onViewModeChange={isAdmin ? setViewMode : undefined}
      />

      {/* Free delivery promo - below navbar, above hero, not shown in admin mode */}
      {!inAdminMode && (
        <div className="w-full bg-pkmn-blue text-white py-2.5">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 text-center max-sm:flex-col">
            <p className="text-sm font-heading font-semibold tracking-[0.0625rem] text-white">
              Free on-campus delivery for all orders!
            </p>
            <a
              href="/delivery-info"
              className="inline-flex items-center justify-center border border-white/35 bg-transparent px-4 py-1.5 text-xs font-heading font-bold uppercase tracking-[0.08rem] !text-white transition-colors duration-[120ms] ease-out hover:bg-white hover:!text-pkmn-blue no-underline hover:no-underline"
            >
              Learn More
            </a>
          </div>
        </div>
      )}

      {/* Admin Dashboard */}
      {isAdmin && viewMode === 'admin' ? (
        <AdminDashboard />
      ) : (
        <>
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
                    imageUrl={banner.display_image_url || banner.image_url}
                    linkUrl={banner.link_url}
                  />
                );
              }
              if (section.section_type === 'CAROUSEL') {
                const carouselItems = section.items.length > 0 ? section.items : items.slice(0, 12);
                return (
                  <div key={section.id} className="max-w-7xl mx-auto px-4 py-[3.125rem]">
                    <ProductCarousel
                      title={section.title}
                      items={carouselItems}
                      onQuickView={setQuickView}
                    />
                  </div>
                );
              }
              if (section.section_type === 'GRID') {
                const gridBanners = section.banners.filter(b => b.size === 'QUARTER');
                return (
                  <div key={section.id} className="max-w-7xl mx-auto px-4 py-[3.125rem]">
                    <h2 className="text-2xl font-heading font-black text-center mb-6 uppercase text-pkmn-text">
                      {section.title}
                    </h2>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {gridBanners.map(banner => (
                        <PromoTile
                          key={banner.id}
                          title={banner.title}
                          imageUrl={banner.display_image_url || banner.image_url}
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
              <HeroBanner
                title="Welcome to SCTCG"
                subtitle="Pokemon TCG cards, sealed drops, and accessories reserved for Santa Cruz players"
                imageUrl="/hero-banner.jpg"
                linkUrl="/tcg"
              />
              <div className="max-w-7xl mx-auto px-4 py-[3.125rem]">
                <h2 className="text-2xl font-heading font-black text-center mb-6 uppercase text-pkmn-text">
                  Shop by Category
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <PromoTile title="TCG Cards" imageUrl="/promo-tcg-cards.jpg" linkUrl="/tcg/cards" />
                  <PromoTile title="Sealed Products" imageUrl="/promo-sealed.jpg" linkUrl="/tcg/boxes" />
                  <PromoTile title="Accessories" imageUrl="/promo-accessories.jpg" linkUrl="/tcg/accessories" />
                  <PromoTile title="New Releases" imageUrl="/promo-new-releases.jpg" linkUrl="/new-releases" />
                </div>
              </div>
            </>
          )}

          {/* Featured Items Section */}
          <div className="max-w-7xl mx-auto px-4 py-[3.125rem]">
            {loading ? (
              <Spinner label="Loading items..." />
            ) : error ? (
              <div className="bg-pkmn-red/10 border border-pkmn-red/20 p-8 text-center">
                <p className="text-pkmn-red font-medium mb-3">{error}</p>
                <button
                  onClick={() => mutateItems()}
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
                      items={items.slice(0, 12)}
                      onQuickView={setQuickView}
                    />
                  </div>
                )}

                <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase mb-6">All Products</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {items.map((item) => (
                    <ProductCard key={item.id} item={item} onQuickView={setQuickView} />
                  ))}
                </div>
              </>
            )}
          </div>

          {quickView && <ProductQuickViewModal key={quickView.id} item={quickView} onClose={() => setQuickView(null)} />}
        </>
      )}
    </div>
  );
}
