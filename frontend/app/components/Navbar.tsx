"use client";

import { useState, useRef, useEffect } from 'react';
import { ShoppingCart, User, ChevronDown, Package, Box, ClipboardList, Star, ScrollText, Settings, Tag, Key, Search, Menu, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface CategoryData {
  id: number;
  name: string;
  slug: string;
  is_core?: boolean;
  subcategories: { id: number; name: string; slug: string }[];
}

const CORE_SLUGS = new Set(['cards', 'boxes', 'accessories']);

const Navbar = () => {
  const { user } = useAuth();
  const { totalItems } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const adminRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/inventory/categories/`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setCategories(data);
        else if (data?.results) setCategories(data.results);
      })
      .catch(() => {});
  }, []);

  // Custom categories: non-Sacred-Three (shown after Cards/Boxes/Accessories in Strip 3)
  const customCats = categories.filter(c => !CORE_SLUGS.has(c.slug));
  const MAX_VISIBLE_CUSTOM = 3;
  const visibleCustom = customCats.slice(0, MAX_VISIBLE_CUSTOM);
  const overflowCustom = customCats.slice(MAX_VISIBLE_CUSTOM);

  const handleSearch = () => {
    const q = searchQuery.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const navLinkCls = "flex-1 text-center py-2.5 text-[0.8125rem] font-heading font-bold uppercase text-pkmn-gray hover:bg-white hover:text-pkmn-blue transition-colors duration-[120ms] ease-out tracking-[0.0625rem] no-underline hover:no-underline";
  const primaryActionCls = "pkc-button-primary no-underline hover:no-underline";
  const dividerEl = <span className="text-pkmn-gray-mid self-center select-none pointer-events-none text-xs px-0.5">|</span>;

  return (
    <div className="pkc-shell w-full sticky top-0 z-40">
      {/* Strip 1: Promo Bar */}
      {pathname === '/' && (
        <div className="w-full bg-pkmn-blue text-white py-2.5">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 text-center max-sm:flex-col">
            <p className="text-sm font-heading font-semibold tracking-[0.0625rem]">
              Free on-campus delivery for all orders!
            </p>
            <Link
              href="/delivery-info"
              className="inline-flex items-center justify-center border border-white/35 bg-transparent px-4 py-1.5 text-xs font-heading font-bold uppercase tracking-[0.08rem] !text-white transition-colors duration-[120ms] ease-out hover:bg-white hover:!text-pkmn-blue no-underline hover:no-underline"
            >
              Learn More
            </Link>
          </div>
        </div>
      )}

      {/* Strip 2: Main Navigation */}
      <div className="bg-white border-b border-pkmn-border px-4 py-3 flex min-h-[4.75rem] justify-between items-center shadow-pkmn-nav">
        {/* Left: Logo */}
        <Link href="/" className="flex-shrink-0">
          <Image
            src="/SCTCG.png"
            alt="SCTCG"
            width={176}
            height={48}
            className="object-contain"
            style={{ height: '3rem', width: 'auto' }}
            priority
          />
        </Link>

        {/* Center: Search Bar (hidden on mobile) */}
        <div className="hidden md:flex flex-1 max-w-lg mx-8">
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Search the shop"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              className="pkc-input pkc-search-input w-full pr-11 text-sm placeholder:text-pkmn-gray-dark"
            />
            <button type="button" onClick={handleSearch} className="absolute right-0 top-0 inline-flex h-full w-10 items-center justify-center border-l border-pkmn-gray-mid bg-white text-pkmn-gray-dark transition-colors hover:bg-pkmn-blue hover:text-white">
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-4">
          {/* Mobile menu toggle */}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-pkmn-text">
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <Link href="/cart" className="relative group">
            <ShoppingCart className="w-6 h-6 text-pkmn-text group-hover:text-pkmn-blue transition-colors duration-[120ms] ease-out" />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex h-5 min-w-5 items-center justify-center bg-pkmn-red px-1 text-[11px] font-bold text-white">
                {totalItems}
              </span>
            )}
          </Link>

          {user ? (
            <div className="flex items-center space-x-3">
              <Link
                href={user.is_admin ? '/admin/orders' : '/orders'}
                className="flex items-center gap-1 text-pkmn-text hover:text-pkmn-blue transition-colors duration-[120ms] ease-out text-sm font-heading font-semibold tracking-[0.0625rem]"
                title="My Orders"
              >
                <Package className="w-5 h-5" />
                <span className="hidden sm:inline">Orders</span>
              </Link>

              <div className="flex items-center gap-1.5">
                <User className="w-5 h-5 text-pkmn-text" />
                <span className="text-pkmn-text text-sm hidden lg:inline">{user.email}</span>
              </div>

              {user.is_admin && (
                <div className="relative" ref={adminRef}>
                  <button
                    onClick={() => setAdminOpen(!adminOpen)}
                    className="pkc-button-primary !px-3 !py-1.5 !text-[0.6875rem]"
                  >
                    Admin <ChevronDown className={`w-3.5 h-3.5 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {adminOpen && (
                    <div className="absolute right-0 mt-2 w-52 z-50">
                      <div className="pkc-panel overflow-hidden">
                        {[
                          { href: '/admin/dispatch', icon: Box, label: 'Dispatch' },
                          { href: '/admin/inventory', icon: ClipboardList, label: 'Inventory' },
                          { href: '/admin/categories', icon: Tag, label: 'Categories' },
                          { href: '/admin/promos', icon: Star, label: 'Promo Banners' },
                          { href: '/admin/wanted', icon: Star, label: 'Wanted List' },
                          { href: '/admin/orders', icon: ScrollText, label: 'Order History' },
                          { href: '/admin/coupons', icon: Tag, label: 'Coupons' },
                          { href: '/admin/access-codes', icon: Key, label: 'Access Codes' },
                          { href: '/admin/settings', icon: Settings, label: 'Settings' },
                        ].map(({ href, icon: Icon, label }) => (
                          <Link
                            key={href}
                            href={href}
                            onClick={() => setAdminOpen(false)}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-heading text-pkmn-text hover:bg-pkmn-bg hover:text-pkmn-blue transition-colors duration-[120ms] ease-out"
                          >
                            <Icon size={14} /> {label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" className={primaryActionCls}>
              Login
            </Link>
          )}
        </div>
      </div>

      {/* Strip 3: Category Navigation — flex grid with | dividers */}
      <div className="hidden md:flex items-stretch border-b border-pkmn-gray-mid bg-[#f7f7f7]">
        <Link href="/new-releases" className={navLinkCls}>New Releases</Link>
        {dividerEl}
        <Link href="/tcg/cards" className={navLinkCls}>Cards</Link>
        {dividerEl}
        <Link href="/tcg/boxes" className={navLinkCls}>Boxes</Link>
        {dividerEl}
        <Link href="/tcg/accessories" className={navLinkCls}>Accessories</Link>
        {visibleCustom.map(cat => (
          <span key={cat.slug} className="contents">
            {dividerEl}
            <Link href={`/category/${cat.slug}`} className={navLinkCls}>{cat.name}</Link>
          </span>
        ))}
        {overflowCustom.length > 0 && (
          <span className="contents">
            {dividerEl}
            <div ref={moreRef} className="relative flex-1 flex justify-center items-center">
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className="w-full py-2.5 text-sm font-heading font-bold uppercase text-pkmn-gray hover:text-pkmn-blue hover:bg-pkmn-bg transition-colors duration-[120ms] ease-out tracking-[0.0625rem] flex items-center justify-center gap-1"
              >
                More <ChevronDown className={`w-3 h-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreOpen && (
                <div className="absolute top-full left-0 min-w-[160px] z-50 border border-pkmn-border bg-white shadow-pkmn-card">
                  {overflowCustom.map(cat => (
                    <Link
                      key={cat.slug}
                      href={`/category/${cat.slug}`}
                      onClick={() => setMoreOpen(false)}
                      className="block px-4 py-2.5 text-sm font-heading text-pkmn-text hover:bg-pkmn-bg hover:text-pkmn-blue transition-colors duration-[120ms] ease-out no-underline hover:no-underline"
                    >
                      {cat.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </span>
        )}
        {dividerEl}
        <Link href="/tcg" className={navLinkCls}>Shop All</Link>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-pkmn-border px-4 py-4 space-y-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search the shop"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { handleSearch(); setMobileMenuOpen(false); } }}
              className="pkc-input pkc-search-input w-full pr-11 text-sm placeholder:text-pkmn-gray-dark"
            />
            <button type="button" onClick={() => { handleSearch(); setMobileMenuOpen(false); }} className="absolute right-0 top-0 inline-flex h-full w-10 items-center justify-center border-l border-pkmn-gray-mid bg-white text-pkmn-gray-dark transition-colors hover:bg-pkmn-blue hover:text-white">
              <Search className="w-4 h-4" />
            </button>
          </div>
          <Link href="/new-releases" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-heading font-bold uppercase text-pkmn-gray py-2 no-underline hover:no-underline">
            New Releases
          </Link>
          <Link href="/tcg/cards" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-heading font-bold uppercase text-pkmn-gray py-2 no-underline hover:no-underline">
            Cards
          </Link>
          <Link href="/tcg/boxes" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-heading font-bold uppercase text-pkmn-gray py-2 no-underline hover:no-underline">
            Boxes
          </Link>
          <Link href="/tcg/accessories" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-heading font-bold uppercase text-pkmn-gray py-2 no-underline hover:no-underline">
            Accessories
          </Link>
          {customCats.map(cat => (
            <Link key={cat.slug} href={`/category/${cat.slug}`} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-heading font-bold uppercase text-pkmn-gray py-2 no-underline hover:no-underline">
              {cat.name}
            </Link>
          ))}
          <Link href="/tcg" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-heading font-bold uppercase text-pkmn-gray py-2 no-underline hover:no-underline">
            Shop All
          </Link>
        </div>
      )}
    </div>
  );
};

export default Navbar;