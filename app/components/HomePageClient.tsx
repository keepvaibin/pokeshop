"use client";

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { publicFetcher } from '../lib/fetcher';
import Navbar from './Navbar';
import Spinner from './Spinner';
import HeroBanner from './HeroBanner';
import PromoTile from './PromoTile';
import ProductCarousel from './ProductCarousel';
import ProductCard from './ProductCard';
import ProductQuickViewModal from './ProductQuickViewModal';
import AdminDashboard from './AdminDashboard';
import AnnouncementBanner from './AnnouncementBanner';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { StorefrontItem } from './storefrontTypes';

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

type CollectionResponse<T> = { results?: T[] } | T[];

interface HomePageClientProps {
  initialItems: CollectionResponse<StorefrontItem>;
  initialNewestItems: CollectionResponse<StorefrontItem>;
  initialSections: CollectionResponse<HomepageSection>;
  initialAnnouncement?: string | null;
}

export default function HomePageClient({ initialItems, initialNewestItems, initialSections, initialAnnouncement }: HomePageClientProps) {
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [adminViewMode, setAdminViewMode] = useState<'admin' | 'storefront'>('admin');

  const [quickView, setQuickView] = useState<StorefrontItem | null>(null);

  const viewMode: 'admin' | 'storefront' = isAdmin ? adminViewMode : 'storefront';

  const { data: itemsData, error: itemsError, mutate: mutateItems } = useSWR(
    '/api/inventory/items/',
    publicFetcher,
    { keepPreviousData: true, fallbackData: initialItems ?? undefined }
  );
  const items: StorefrontItem[] = useMemo(
    () => itemsData?.results ?? itemsData ?? [],
    [itemsData]
  );

  const { data: newestItemsData } = useSWR(
    '/api/inventory/items/?sort=newest',
    publicFetcher,
    { keepPreviousData: true, fallbackData: initialNewestItems ?? undefined }
  );
  const newestItems: StorefrontItem[] = useMemo(
    () => newestItemsData?.results ?? newestItemsData ?? [],
    [newestItemsData]
  );

  const { data: sectionsData } = useSWR(
    '/api/inventory/homepage-sections/',
    publicFetcher,
    { keepPreviousData: true, fallbackData: initialSections ?? undefined }
  );
  const sections: HomepageSection[] = useMemo(
    () => sectionsData?.results ?? sectionsData ?? [],
    [sectionsData]
  );

  const loading = !itemsData && !itemsError;
  const error = itemsError ? 'Failed to load items. Please try again.' : '';
  const newArrivalsHref = '/tcg?sort=newest';
  const allProductsHref = '/tcg';
  const featuredItems = useMemo(() => items.slice(0, 12), [items]);

  const hasCarouselSection = sections.some(s => s.section_type === 'CAROUSEL');

  const inAdminMode = isAdmin && viewMode === 'admin';

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      {!inAdminMode && <AnnouncementBanner announcement={initialAnnouncement} />}
      <Navbar
        adminMode={isAdmin}
        viewMode={isAdmin ? viewMode : undefined}
        onViewModeChange={isAdmin ? setAdminViewMode : undefined}
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
                const isNewArrivalsSection = section.title.trim().toLowerCase() === 'new arrivals';
                const carouselItems = (section.items.length > 0
                  ? section.items
                  : isNewArrivalsSection
                    ? newestItems.slice(0, 12)
                    : items.slice(0, 12)).slice(0, 12);
                return (
                  <section key={section.id} className="max-w-7xl mx-auto px-4 py-[3.125rem]">
                    <ProductCarousel
                      title={section.title}
                      items={carouselItems}
                      onQuickView={setQuickView}
                    />
                    {isNewArrivalsSection && (
                      <div className="mt-8 flex justify-center">
                        <Link
                          href={newArrivalsHref}
                          className="group/btn inline-flex items-center gap-2 bg-pkmn-blue px-5 py-3 font-heading text-sm font-bold uppercase tracking-[0.08rem] !text-white no-underline transition-colors duration-[120ms] ease-out hover:bg-[#094a91] hover:no-underline"
                        >
                          Shop More
                          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
                        </Link>
                      </div>
                    )}
                  </section>
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
                  <section className="mb-12">
                    <ProductCarousel
                      title="New Arrivals"
                      items={newestItems.slice(0, 12)}
                      onQuickView={setQuickView}
                    />
                    <div className="mt-8 flex justify-center">
                      <Link
                        href={newArrivalsHref}
                        className="group/btn inline-flex items-center gap-2 bg-pkmn-blue px-5 py-3 font-heading text-sm font-bold uppercase tracking-[0.08rem] !text-white no-underline transition-colors duration-[120ms] ease-out hover:bg-[#094a91] hover:no-underline"
                      >
                        Shop More
                        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
                      </Link>
                    </div>
                  </section>
                )}

                <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase mb-6">All Products</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                  {featuredItems.map((item) => (
                    <ProductCard key={item.id} item={item} onQuickView={setQuickView} />
                  ))}
                </div>
                <div className="mt-8 flex justify-center">
                  <Link
                    href={allProductsHref}
                    className="group/btn inline-flex items-center gap-2 bg-pkmn-blue px-5 py-3 font-heading text-sm font-bold uppercase tracking-[0.08rem] !text-white no-underline transition-colors duration-[120ms] ease-out hover:bg-[#094a91] hover:no-underline"
                  >
                    Shop All
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
                  </Link>
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
