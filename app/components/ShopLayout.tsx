"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import axios from 'axios';
import Navbar from './Navbar';
import Breadcrumbs from './Breadcrumbs';
import ProductCard from './ProductCard';
import ProductQuickViewModal from './ProductQuickViewModal';
import Spinner from './Spinner';
import type { StorefrontItem } from './storefrontTypes';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const PRICE_MAX = 1000;

const TCG_TYPES    = ['Fire','Water','Grass','Psychic','Fighting','Darkness','Metal','Lightning','Fairy','Dragon','Colorless'];
const TCG_STAGES   = ['Basic','Stage 1','Stage 2','Mega','BREAK','VMAX','VSTAR','Tera'];
const TCG_RARITIES = ['Common','Uncommon','Rare','Holo Rare','Ultra Rare','Illustration Rare','Special Illustration Rare','Gold Secret Rare'];
const TCG_SUPERTYPES = ['Pokémon','Trainer','Energy'];

interface SubCat { id: number; name: string; slug: string; }
interface Tag { id: number; name: string; slug: string; }
interface Category { id: number; name: string; slug: string; is_core?: boolean; is_active?: boolean; subcategories: SubCat[]; tags?: Tag[]; }

export interface ShopLayoutProps {
  /** Category slug: 'cards' | 'boxes' | 'accessories' | '' (all) | custom slug */
  categorySlug: string;
  title: string;
  /** If true: hides sort selector, forces sort=newest */
  lockSort?: boolean;
  /** If true: search-results mode — shows q-driven title & category facets in sidebar */
  isSearch?: boolean;
}

// ---------------------------------------------------------------------------
// Dual-thumb price range slider
// ---------------------------------------------------------------------------
function PriceSlider({ min, max, onCommit }: {
  min: number; max: number; onCommit: (min: number, max: number) => void;
}) {
  const [localMin, setLocalMin] = useState(min);
  const [localMax, setLocalMax] = useState(max);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from URL param changes
  useEffect(() => { setLocalMin(min); }, [min]);
  useEffect(() => { setLocalMax(max); }, [max]);

  const scheduleCommit = (nextMin: number, nextMax: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onCommit(nextMin, nextMax), 600);
  };

  const handleMin = (v: number) => {
    const clamped = Math.min(v, localMax - 1);
    setLocalMin(clamped);
    scheduleCommit(clamped, localMax);
  };
  const handleMax = (v: number) => {
    const clamped = Math.max(v, localMin + 1);
    setLocalMax(clamped);
    scheduleCommit(localMin, clamped);
  };

  const minPct = (localMin / PRICE_MAX) * 100;
  const maxPct = (localMax / PRICE_MAX) * 100;

  return (
    <div>
      <div className="flex justify-between text-xs text-pkmn-gray mb-3">
        <span className="font-semibold text-pkmn-text">${localMin}</span>
        <span className="font-semibold text-pkmn-text">${localMax === PRICE_MAX ? `${PRICE_MAX}+` : localMax}</span>
      </div>
      {/* Slider track container */}
      <div className="relative h-5 mb-3">
        {/* Background track */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-pkmn-border" />
        {/* Active range highlight */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-pkmn-blue"
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
        />
        {/* Min range input (invisible, captures interaction) */}
        <input
          type="range" min={0} max={PRICE_MAX} value={localMin}
          onChange={e => handleMin(Number(e.target.value))}
          aria-label="Minimum price"
          className="pkc-range-input absolute inset-0 w-full"
          style={{ zIndex: 3 }}
        />
        {/* Max range input */}
        <input
          type="range" min={0} max={PRICE_MAX} value={localMax}
          onChange={e => handleMax(Number(e.target.value))}
          aria-label="Maximum price"
          className="pkc-range-input absolute inset-0 w-full"
          style={{ zIndex: 4 }}
        />
        {/* Visual thumb — min */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-pkmn-blue pointer-events-none"
          style={{ left: `calc(${minPct}% - 8px)` }}
        />
        {/* Visual thumb — max */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-pkmn-blue pointer-events-none"
          style={{ left: `calc(${maxPct}% - 8px)` }}
        />
      </div>
      {/* Numeric inputs for precise entry */}
      <div className="flex items-center gap-2">
        <input
          type="number" value={localMin} min={0} max={localMax - 1}
          onChange={e => handleMin(Number(e.target.value))}
          className="pkc-input w-20 px-2 py-1 text-center text-xs"
        />
        <span className="text-pkmn-gray text-xs">–</span>
        <input
          type="number" value={localMax} min={localMin + 1} max={PRICE_MAX}
          onChange={e => handleMax(Number(e.target.value))}
          className="pkc-input w-20 px-2 py-1 text-center text-xs"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main inner component (uses useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------
function ShopLayoutInner({ categorySlug, title, lockSort, isSearch }: ShopLayoutProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ---- URL param reads ----
  const sortParam       = searchParams.get('sort') || '';
  const qParam          = searchParams.get('q') || '';
  const minPriceParam   = Number(searchParams.get('min_price') || 0);
  const maxPriceParam   = Number(searchParams.get('max_price') || PRICE_MAX);
  const searchCategoryParams = isSearch ? searchParams.getAll('category') : [];
  const tagParams            = searchParams.getAll('tag');
  const tcgTypesParam       = searchParams.getAll('tcg_type');
  const tcgStagesParam      = searchParams.getAll('tcg_stage');
  const rarityTypesParam    = searchParams.getAll('rarity_type');
  const tcgSupertypesParam  = searchParams.getAll('tcg_supertype');
  const subcatParam         = searchParams.get('subcategory') || '';
  const setNameParam        = searchParams.get('tcg_set_name') || '';
  const artistParam         = searchParams.get('tcg_artist') || '';
  const joinedSearchCategories = searchCategoryParams.join('|');
  const joinedTagParams = tagParams.join('|');
  const joinedTcgTypes = tcgTypesParam.join('|');
  const joinedTcgStages = tcgStagesParam.join('|');
  const joinedRarityTypes = rarityTypesParam.join('|');
  const joinedTcgSupertypes = tcgSupertypesParam.join('|');

  const [sortBy, setSortBy]         = useState(lockSort ? 'newest' : (sortParam || 'featured'));
  const [items, setItems]           = useState<StorefrontItem[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [quickView, setQuickView]   = useState<StorefrontItem | null>(null);
  const [loading, setLoading]       = useState(true);
  // local sidebar text inputs (debounced)
  const [setNameInput, setSetNameInput]   = useState(setNameParam);
  const [artistInput, setArtistInput]     = useState(artistParam);
  const setNameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const artistTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync sortBy from URL navigation (New Releases uses ?sort=newest)
  const prevSort = useRef(sortParam);
  useEffect(() => {
    if (prevSort.current !== sortParam) {
      setSortBy(lockSort ? 'newest' : (sortParam || 'featured'));
      prevSort.current = sortParam;
    }
  }, [sortParam, lockSort]);

  // ---- Fetch categories (for accessories sidebar + search sidebar) ----
  useEffect(() => {
    axios.get(`${API}/api/inventory/categories/`)
      .then(r => setAllCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => {});
  }, []);

  // ---- Build backend query params ----
  const buildBackendParams = useCallback(() => {
    const p = new URLSearchParams();
    if (categorySlug) p.set('category', categorySlug);
    else if (isSearch) searchCategoryParams.forEach(v => p.append('category', v));
    if (lockSort)     p.set('sort', 'newest');
    else if (sortBy && sortBy !== 'featured') p.set('sort', sortBy);
    else if (sortParam && sortParam !== 'featured') p.set('sort', sortParam);
    if (qParam)        p.set('q', qParam);
    if (minPriceParam > 0)        p.set('min_price', String(minPriceParam));
    if (maxPriceParam < PRICE_MAX) p.set('max_price', String(maxPriceParam));
    tcgTypesParam.forEach(v => p.append('tcg_type', v));
    tcgStagesParam.forEach(v => p.append('tcg_stage', v));
    rarityTypesParam.forEach(v => p.append('rarity_type', v));
    tcgSupertypesParam.forEach(v => p.append('tcg_supertype', v));
    tagParams.forEach(v => p.append('tag', v));
    if (subcatParam)  p.set('subcategory', subcatParam);
    if (setNameParam) p.set('tcg_set_name', setNameParam);
    if (artistParam)  p.set('tcg_artist', artistParam);
    return p.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySlug, lockSort, sortBy, sortParam, qParam, minPriceParam, maxPriceParam,
      isSearch, joinedSearchCategories, joinedTagParams,
      joinedTcgTypes, joinedTcgStages, joinedRarityTypes,
      joinedTcgSupertypes, subcatParam, setNameParam, artistParam]);

  // ---- Fetch items ----
  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/api/inventory/items/?${buildBackendParams()}`)
      .then(r => setItems(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [buildBackendParams]);

  // ---- Navigation helpers ----
  const basePath = isSearch ? '/search'
    : categorySlug === '' || categorySlug === 'all' ? '/tcg'
    : categorySlug === 'cards'       ? '/tcg/cards'
    : categorySlug === 'boxes'       ? '/tcg/boxes'
    : categorySlug === 'accessories' ? '/tcg/accessories'
    : `/category/${categorySlug}`;

  const buildUrlParams = (overrides: Record<string, string | string[]> = {}) => {
    const merged: Record<string, string | string[]> = {
      category: isSearch ? searchCategoryParams : [],
      sort: lockSort ? '' : (sortBy !== 'featured' ? sortBy : ''),
      tag: tagParams,
      tcg_type: tcgTypesParam,
      tcg_stage: tcgStagesParam,
      rarity_type: rarityTypesParam,
      tcg_supertype: tcgSupertypesParam,
      subcategory: subcatParam,
      tcg_set_name: setNameParam,
      tcg_artist: artistParam,
      min_price: minPriceParam > 0 ? String(minPriceParam) : '',
      max_price: maxPriceParam < PRICE_MAX ? String(maxPriceParam) : '',
      ...(qParam ? { q: qParam } : {}),
      ...overrides,
    };
    const p = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(val => val && p.append(k, val));
      else if (v) p.set(k, v);
    });
    return p.toString();
  };

  const navigate = (overrides: Record<string, string | string[]>) => {
    router.push(basePath + '?' + buildUrlParams(overrides));
  };

  const toggleFacet = (key: string, value: string, current: string[]) => {
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    navigate({ [key]: next });
  };

  const handleSortChange = (val: string) => {
    setSortBy(val);
    navigate({ sort: val === 'featured' ? '' : val });
  };

  const handlePriceCommit = (min: number, max: number) => {
    navigate({
      min_price: min > 0 ? String(min) : '',
      max_price: max < PRICE_MAX ? String(max) : '',
    });
  };

  const clearAllFilters = () => {
    setSortBy(lockSort ? 'newest' : 'featured');
    if (isSearch && qParam) {
      router.push(`/search?q=${encodeURIComponent(qParam)}`);
      return;
    }
    router.push(basePath);
  };

  // ---- Derived state ----
  const resultCategorySlugs = Array.from(new Set(items.map(item => item.category_slug).filter(Boolean))) as string[];
  const resolvedSearchCategorySlug = !isSearch ? ''
    : searchCategoryParams.length === 1 ? searchCategoryParams[0]
    : resultCategorySlugs.length === 1 ? resultCategorySlugs[0]
    : '';
  const contextualCategorySlug = isSearch ? resolvedSearchCategorySlug : categorySlug;
  const accessoriesSubcats = allCategories.find(c => c.slug === 'accessories')?.subcategories || [];
  const customCategory = contextualCategorySlug && !['cards','boxes','accessories','','all'].includes(contextualCategorySlug)
    ? allCategories.find(c => c.slug === contextualCategorySlug)
    : undefined;
  const currentCatSubcats = customCategory?.subcategories || [];
  const currentCatTags = customCategory?.tags || [];
  const showGenericSearchFilters = isSearch && !contextualCategorySlug;

  const hasActiveFilters = tcgTypesParam.length + tcgStagesParam.length + rarityTypesParam.length +
    tcgSupertypesParam.length + tagParams.length + searchCategoryParams.length + (subcatParam ? 1 : 0) + (setNameParam ? 1 : 0) +
    (artistParam ? 1 : 0) + (minPriceParam > 0 ? 1 : 0) + (maxPriceParam < PRICE_MAX ? 1 : 0) > 0;

  const pageTitle = isSearch && qParam
    ? `Search results for "${qParam}"`
    : title;

  const breadcrumbs = [
    { label: 'Home', url: '/' },
    ...(isSearch ? [{ label: 'Search', url: '/search' }]
      : categorySlug === '' ? [{ label: 'Shop All', url: '/tcg' }]
      : categorySlug === 'cards'       ? [{ label: 'TCG Cards', url: '/tcg/cards' }]
      : categorySlug === 'boxes'       ? [{ label: 'Boxes', url: '/tcg/boxes' }]
      : categorySlug === 'accessories' ? [{ label: 'Accessories', url: '/tcg/accessories' }]
      : [{ label: title, url: basePath }]),
  ];

  // ---- Sidebar filter section component ----
  const CheckboxFilter = ({ label, options, selected, paramKey }: {
    label: string; options: string[]; selected: string[]; paramKey: string;
  }) => (
    <div className="pkc-filter-panel p-4">
      <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">{label}</h4>
      {options.map(opt => (
        <label key={opt} className="flex items-center mb-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(opt)}
            onChange={() => toggleFacet(paramKey, opt, selected)}
            className="w-4 h-4 accent-pkmn-blue cursor-pointer"
          />
          <span className="ml-2 text-sm text-pkmn-text">{opt}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-4">
        <Breadcrumbs items={breadcrumbs} />
        <h1 className="text-3xl font-heading font-black text-pkmn-text uppercase mb-6">{pageTitle}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-8">
          {/* ===== SIDEBAR ===== */}
          <div className="space-y-4">
            {/* Filters header */}
            <div className="pkc-filter-panel p-4">
              <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between bg-pkmn-blue px-4 py-2">
                <h3 className="text-xs font-heading font-black uppercase tracking-[0.08rem] text-white">Filters</h3>
                {hasActiveFilters && (
                  <button onClick={clearAllFilters} className="text-[11px] font-semibold uppercase tracking-[0.06rem] text-white/90 hover:text-white">
                    Clear all
                  </button>
                )}
              </div>
              {/* Price Range */}
              <div>
                <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase">Price Range</h4>
                <PriceSlider min={minPriceParam} max={maxPriceParam} onCommit={handlePriceCommit} />
              </div>
            </div>

            {/* ---- Cards sidebar ---- */}
            {contextualCategorySlug === 'cards' && (
              <>
                <CheckboxFilter label="Supertype" options={TCG_SUPERTYPES} selected={tcgSupertypesParam} paramKey="tcg_supertype" />
                <CheckboxFilter label="Type"      options={TCG_TYPES}      selected={tcgTypesParam}      paramKey="tcg_type" />
                <CheckboxFilter label="Stage"     options={TCG_STAGES}     selected={tcgStagesParam}     paramKey="tcg_stage" />
                <CheckboxFilter label="Rarity"    options={TCG_RARITIES}   selected={rarityTypesParam}   paramKey="rarity_type" />
                <div className="pkc-filter-panel p-4">
                  <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Set</h4>
                  <input
                    type="text"
                    placeholder="Filter by set…"
                    value={setNameInput}
                    onChange={e => {
                      setSetNameInput(e.target.value);
                      if (setNameTimer.current) clearTimeout(setNameTimer.current);
                      setNameTimer.current = setTimeout(() => navigate({ tcg_set_name: e.target.value }), 500);
                    }}
                    className="pkc-input w-full text-sm"
                  />
                </div>
                <div className="pkc-filter-panel p-4">
                  <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Artist</h4>
                  <input
                    type="text"
                    placeholder="Filter by artist…"
                    value={artistInput}
                    onChange={e => {
                      setArtistInput(e.target.value);
                      if (artistTimer.current) clearTimeout(artistTimer.current);
                      artistTimer.current = setTimeout(() => navigate({ tcg_artist: e.target.value }), 500);
                    }}
                    className="pkc-input w-full text-sm"
                  />
                </div>
              </>
            )}

            {/* ---- Boxes sidebar ---- */}
            {contextualCategorySlug === 'boxes' && (
              <div className="pkc-filter-panel p-4">
                <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Set</h4>
                <input
                  type="text"
                  placeholder="Filter by set…"
                  value={setNameInput}
                  onChange={e => {
                    setSetNameInput(e.target.value);
                    if (setNameTimer.current) clearTimeout(setNameTimer.current);
                    setNameTimer.current = setTimeout(() => navigate({ tcg_set_name: e.target.value }), 500);
                  }}
                  className="pkc-input w-full text-sm"
                />
              </div>
            )}

            {/* ---- Accessories sidebar ---- */}
            {contextualCategorySlug === 'accessories' && accessoriesSubcats.length > 0 && (
              <div className="pkc-filter-panel p-4">
                <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Type</h4>
                <label className="flex items-center mb-2 cursor-pointer">
                  <input type="radio" name="subcat" checked={!subcatParam} onChange={() => navigate({ subcategory: '' })} className="w-4 h-4 accent-pkmn-blue" />
                  <span className="ml-2 text-sm text-pkmn-text">All</span>
                </label>
                {accessoriesSubcats.map(s => (
                  <label key={s.slug} className="flex items-center mb-2 cursor-pointer">
                    <input type="radio" name="subcat" checked={subcatParam === s.slug} onChange={() => navigate({ subcategory: s.slug })} className="w-4 h-4 accent-pkmn-blue" />
                    <span className="ml-2 text-sm text-pkmn-text">{s.name}</span>
                  </label>
                ))}
              </div>
            )}

            {/* ---- Search / All sidebar: category radio ---- */}
            {showGenericSearchFilters && (
              <div className="pkc-filter-panel p-4">
                <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Core Categories</h4>
                {[
                  { slug: 'cards', label: 'Cards' },
                  { slug: 'boxes', label: 'Boxes' },
                  { slug: 'accessories', label: 'Accessories' },
                ].map(cat => (
                  <label key={cat.slug} className="flex items-center mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={searchCategoryParams.includes(cat.slug)}
                      onChange={() => toggleFacet('category', cat.slug, searchCategoryParams)}
                      className="w-4 h-4 accent-pkmn-blue"
                    />
                    <span className="ml-2 text-sm text-pkmn-text">{cat.label}</span>
                  </label>
                ))}
              </div>
            )}

            {!isSearch && (categorySlug === '' || categorySlug === 'all') && (
              <div className="pkc-filter-panel p-4">
                <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Category</h4>
                {allCategories.filter(c => c.is_active !== false).map(cat => {
                  const href = cat.slug === 'cards' ? '/tcg/cards'
                    : cat.slug === 'boxes' ? '/tcg/boxes'
                    : cat.slug === 'accessories' ? '/tcg/accessories'
                    : `/category/${cat.slug}`;
                  return (
                    <a key={cat.slug} href={`${href}${qParam ? `?q=${encodeURIComponent(qParam)}` : ''}`} className="flex items-center mb-2 text-sm text-pkmn-text font-bold hover:text-pkmn-blue no-underline hover:no-underline">
                      {cat.name}
                    </a>
                  );
                })}
              </div>
            )}

            {currentCatTags.length > 0 && (
              <div className="pkc-filter-panel p-4">
                <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Tags</h4>
                {currentCatTags.map(tag => (
                  <label key={tag.slug} className="flex items-center mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tagParams.includes(tag.slug)}
                      onChange={() => toggleFacet('tag', tag.slug, tagParams)}
                      className="w-4 h-4 accent-pkmn-blue"
                    />
                    <span className="ml-2 text-sm text-pkmn-text">{tag.name}</span>
                  </label>
                ))}
              </div>
            )}

            {/* ---- Custom category subcats ---- */}
            {currentCatSubcats.length > 0 && (
              <div className="pkc-filter-panel p-4">
                <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Type</h4>
                <label className="flex items-center mb-2 cursor-pointer">
                  <input type="radio" name="subcat" checked={!subcatParam} onChange={() => navigate({ subcategory: '' })} className="w-4 h-4 accent-pkmn-blue" />
                  <span className="ml-2 text-sm text-pkmn-text">All</span>
                </label>
                {currentCatSubcats.map(s => (
                  <label key={s.slug} className="flex items-center mb-2 cursor-pointer">
                    <input type="radio" name="subcat" checked={subcatParam === s.slug} onChange={() => navigate({ subcategory: s.slug })} className="w-4 h-4 accent-pkmn-blue" />
                    <span className="ml-2 text-sm text-pkmn-text">{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ===== PRODUCT GRID ===== */}
          <div>
            {/* Sort bar */}
            <div className="flex items-center justify-between mb-6 border border-pkmn-border bg-[#f5f5f5] px-4 py-3">
              <p className="text-sm text-pkmn-gray">
                {items.length} {items.length === 1 ? 'product' : 'products'}
              </p>
              {!lockSort && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold uppercase text-pkmn-gray">Sort by:</label>
                  <select
                    value={sortBy}
                    onChange={e => handleSortChange(e.target.value)}
                    className="pkc-input px-3 py-1.5 text-sm text-pkmn-text"
                  >
                    <option value="featured">Featured</option>
                    <option value="newest">Newest</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="name">Name: A to Z</option>
                    {categorySlug === 'cards' && (
                      <>
                        <option value="release-desc">Release Date: Newest</option>
                        <option value="release-asc">Release Date: Oldest</option>
                      </>
                    )}
                  </select>
                </div>
              )}
              {lockSort && (
                <span className="text-xs text-pkmn-gray font-semibold uppercase tracking-wide">Newest First</span>
              )}
            </div>

            {loading ? (
              <Spinner label="Loading products…" />
            ) : items.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-pkmn-gray text-lg">No products found.</p>
                {hasActiveFilters && (
                  <button onClick={clearAllFilters} className="mt-3 text-pkmn-blue underline text-sm">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
                {items.map(item => (
                  <ProductCard key={item.id} item={item} onQuickView={setQuickView} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {quickView && <ProductQuickViewModal key={quickView.id} item={quickView} onClose={() => setQuickView(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export — wraps inner component in Suspense so pages don't need to
// ---------------------------------------------------------------------------
export default function ShopLayout(props: ShopLayoutProps) {
  return (
    <Suspense fallback={<div className="pkc-shell min-h-screen bg-pkmn-bg flex items-center justify-center"><Spinner /></div>}>
      <ShopLayoutInner {...props} />
    </Suspense>
  );
}
