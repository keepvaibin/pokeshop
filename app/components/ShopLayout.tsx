"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { publicFetcher } from '../lib/fetcher';
import { SlidersHorizontal, X } from 'lucide-react';
import Navbar from './Navbar';
import Breadcrumbs from './Breadcrumbs';
import ProductCard from './ProductCard';
import ProductQuickViewModal from './ProductQuickViewModal';
import Spinner from './Spinner';
import type { StorefrontItem } from './storefrontTypes';
const PRICE_FALLBACK = 1000;

const TCG_TYPES    = ['Fire','Water','Grass','Psychic','Fighting','Darkness','Metal','Lightning','Fairy','Dragon','Colorless'];
const TCG_STAGES   = ['Basic','Stage 1','Stage 2','Mega','BREAK','VMAX','VSTAR','Tera'];
const TCG_RARITY_GROUPS = ['Common','Uncommon','Rare','Holo Rare','Ultra Rare','Illustration Rare','Special Illustration Rare','Gold Secret Rare'];
const TCG_SUPERTYPES = ['Pokémon','Trainer','Energy'];

interface SubCat { id: number; name: string; slug: string; }
interface Tag { id: number; name: string; slug: string; }
interface Category { id: number; name: string; slug: string; is_core?: boolean; is_active?: boolean; subcategories: SubCat[]; tags?: Tag[]; }
type CollectionResponse<T> = { results?: T[] } | T[];

export interface ShopLayoutProps {
  /** Category slug: 'cards' | 'boxes' | 'accessories' | '' (all) | custom slug */
  categorySlug: string;
  title: string;
  /** If true: hides sort selector, forces sort=newest */
  lockSort?: boolean;
  /** If true: search-results mode — shows q-driven title & category facets in sidebar */
  isSearch?: boolean;
  /** Server-fetched items data — used as SWR fallbackData so HTML ships with products */
  initialItems?: CollectionResponse<StorefrontItem>;
  /** Server-fetched categories data — used as SWR fallbackData */
  initialCategories?: CollectionResponse<Category>;
}

// ---------------------------------------------------------------------------
// Dual-thumb price range slider
// ---------------------------------------------------------------------------
function PriceSlider({ min, max, ceiling, onCommit }: {
  min: number; max: number; ceiling: number; onCommit: (min: number, max: number) => void;
}) {
  const [localMin, setLocalMin] = useState(min);
  const [localMax, setLocalMax] = useState(max);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from URL param changes
  useEffect(() => { setLocalMin(min); }, [min]);
  useEffect(() => { setLocalMax(max); }, [max]);
  useEffect(() => () => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
    }
  }, []);

  const scheduleCommit = (nextMin: number, nextMax: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onCommit(nextMin, nextMax), 600);
  };

  const handleMin = (v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(0, Math.min(v, localMax - 1));
    setLocalMin(clamped);
    scheduleCommit(clamped, localMax);
  };
  const handleMax = (v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(ceiling, Math.max(v, localMin + 1));
    setLocalMax(clamped);
    scheduleCommit(localMin, clamped);
  };

  const minPct = (localMin / ceiling) * 100;
  const maxPct = (localMax / ceiling) * 100;

  return (
    <div>
      <div className="flex justify-between text-xs text-pkmn-gray mb-3">
        <span className="font-semibold text-pkmn-text">${localMin}</span>
        <span className="font-semibold text-pkmn-text">${localMax}</span>
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
          type="range" min={0} max={ceiling} value={localMin}
          onChange={e => handleMin(Number(e.target.value))}
          aria-label="Minimum price"
          className="pkc-range-input absolute inset-0 w-full"
          style={{ zIndex: 3 }}
        />
        {/* Max range input */}
        <input
          type="range" min={0} max={ceiling} value={localMax}
          onChange={e => handleMax(Number(e.target.value))}
          aria-label="Maximum price"
          className="pkc-range-input absolute inset-0 w-full"
          style={{ zIndex: 4 }}
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
          type="number" value={localMax} min={localMin + 1} max={ceiling}
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
function ShopLayoutInner({ categorySlug, title, lockSort, isSearch, initialItems, initialCategories }: ShopLayoutProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ---- URL param reads ----
  const sortParam       = searchParams.get('sort') || '';
  const qParam          = searchParams.get('q') || '';
  const minPriceParam   = Number(searchParams.get('min_price') || 0);
  const maxPriceRaw      = searchParams.get('max_price');
  const maxPriceParam    = maxPriceRaw ? Number(maxPriceRaw) : null;
  const searchCategoryParams = isSearch ? searchParams.getAll('category') : [];
  const tagParams            = searchParams.getAll('tag');
  const tcgTypesParam       = searchParams.getAll('tcg_type');
  const tcgStagesParam      = searchParams.getAll('tcg_stage');
  const rarityTypesParam    = searchParams.getAll('rarity_type');
  const printedRarityParams = searchParams.getAll('rarity');
  const tcgSupertypesParam  = searchParams.getAll('tcg_supertype');
  const tcgSubtypeParams    = searchParams.getAll('tcg_subtype');
  const regulationMarkParams = searchParams.getAll('regulation_mark');
  const standardLegalParam  = searchParams.get('standard_legal') === '1';
  const subcatParam         = searchParams.get('subcategory') || '';
  const setNameParams       = searchParams.getAll('tcg_set_name');
  const artistParams        = searchParams.getAll('tcg_artist');
  const inStockOnlyParam    = searchParams.get('in_stock') === '1';
  const pageParam           = Number(searchParams.get('page') || 1);
  const joinedSearchCategories = searchCategoryParams.join('|');
  const joinedTagParams = tagParams.join('|');
  const joinedTcgTypes = tcgTypesParam.join('|');
  const joinedTcgStages = tcgStagesParam.join('|');
  const joinedRarityTypes = rarityTypesParam.join('|');
  const joinedPrintedRarities = printedRarityParams.join('|');
  const joinedTcgSupertypes = tcgSupertypesParam.join('|');
  const joinedTcgSubtypes = tcgSubtypeParams.join('|');
  const joinedRegulationMarks = regulationMarkParams.join('|');
  const joinedSetNames = setNameParams.join('|');
  const joinedArtists = artistParams.join('|');

  const [sortBy, setSortBy]         = useState(lockSort ? 'newest' : (sortParam || 'featured'));
  const [quickView, setQuickView]   = useState<StorefrontItem | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = filterOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [filterOpen]);

  // Sync sortBy from URL navigation (New Releases uses ?sort=newest)
  const prevSort = useRef(sortParam);
  useEffect(() => {
    if (prevSort.current !== sortParam) {
      setSortBy(lockSort ? 'newest' : (sortParam || 'featured'));
      prevSort.current = sortParam;
    }
  }, [sortParam, lockSort]);

  // ---- Fetch categories via SWR ----
  const { data: catData } = useSWR('/api/inventory/categories/', publicFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
    fallbackData: initialCategories ?? undefined,
  });
  const allCategories: Category[] = useMemo(
    () => Array.isArray(catData) ? catData : catData?.results || [],
    [catData]
  );

  // ---- Fetch facet options (distinct sets + artists) ----
  const facetsKey = categorySlug
    ? `/api/inventory/items/facets/?category=${categorySlug}`
    : '/api/inventory/items/facets/';
  const { data: facetsData } = useSWR(facetsKey, publicFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });
  const availableSets: string[] = facetsData?.sets ?? [];
  const availableArtists: string[] = facetsData?.artists ?? [];
  const availablePrintedRarities: string[] = facetsData?.printed_rarities ?? [];
  const availableSubtypes: string[] = facetsData?.subtypes ?? [];
  const availableRegulationMarks: string[] = facetsData?.regulation_marks ?? [];

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
    if (maxPriceParam !== null)     p.set('max_price', String(maxPriceParam));
    if (inStockOnlyParam) p.set('in_stock', '1');
    tcgTypesParam.forEach(v => p.append('tcg_type', v));
    tcgStagesParam.forEach(v => p.append('tcg_stage', v));
    rarityTypesParam.forEach(v => p.append('rarity_type', v));
    printedRarityParams.forEach(v => p.append('rarity', v));
    tcgSupertypesParam.forEach(v => p.append('tcg_supertype', v));
    tcgSubtypeParams.forEach(v => p.append('tcg_subtype', v));
    regulationMarkParams.forEach(v => p.append('regulation_mark', v));
    if (standardLegalParam) p.set('standard_legal', '1');
    tagParams.forEach(v => p.append('tag', v));
    if (subcatParam)  p.set('subcategory', subcatParam);
    setNameParams.forEach(v => p.append('tcg_set_name', v));
    artistParams.forEach(v => p.append('tcg_artist', v));
    if (pageParam > 1) p.set('page', String(pageParam));
    return p.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySlug, lockSort, sortBy, sortParam, qParam, minPriceParam, maxPriceParam, inStockOnlyParam,
      isSearch, joinedSearchCategories, joinedTagParams,
      joinedTcgTypes, joinedTcgStages, joinedRarityTypes, joinedPrintedRarities,
      joinedTcgSupertypes, joinedTcgSubtypes, joinedRegulationMarks, standardLegalParam,
      subcatParam, joinedSetNames, joinedArtists, pageParam]);

  // ---- Fetch items via SWR ----
  const backendQs = buildBackendParams();
  const { data: itemsData, error: itemsError, mutate: mutateItems } = useSWR(
    `/api/inventory/items/?${backendQs}`,
    publicFetcher,
    { keepPreviousData: true, fallbackData: initialItems ?? undefined }
  );
  const items: StorefrontItem[] = useMemo(
    () => itemsData?.results ?? itemsData ?? [],
    [itemsData]
  );
  const totalCount: number = itemsData?.count ?? items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / 24));
  const loading = !itemsData && !itemsError;

  // Dynamic price ceiling from API (max price among items matching non-price filters)
  const priceCeiling = useMemo(() => {
    const apiMax = itemsData?.price_max;
    if (typeof apiMax === 'number' && apiMax > 0) return Math.ceil(apiMax);
    return PRICE_FALLBACK;
  }, [itemsData?.price_max]);
  const effectiveMaxPrice = maxPriceParam ?? priceCeiling;

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
      rarity: printedRarityParams,
      tcg_supertype: tcgSupertypesParam,
      tcg_subtype: tcgSubtypeParams,
      regulation_mark: regulationMarkParams,
      standard_legal: standardLegalParam ? '1' : '',
      subcategory: subcatParam,
      tcg_set_name: setNameParams,
      tcg_artist: artistParams,
      min_price: minPriceParam > 0 ? String(minPriceParam) : '',
      max_price: maxPriceParam !== null ? String(maxPriceParam) : '',
      in_stock: inStockOnlyParam ? '1' : '',
      page: '',  // default: cleared by overrides when navigating
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

  const goToPage = (page: number) => {
    navigate({ page: page > 1 ? String(page) : '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      max_price: max < priceCeiling ? String(max) : '',
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

  const hasActiveFilters = tcgTypesParam.length + tcgStagesParam.length + rarityTypesParam.length + printedRarityParams.length +
    tcgSupertypesParam.length + tcgSubtypeParams.length + regulationMarkParams.length + tagParams.length + searchCategoryParams.length +
    (standardLegalParam ? 1 : 0) + (subcatParam ? 1 : 0) + setNameParams.length +
    artistParams.length + (minPriceParam > 0 ? 1 : 0) + (maxPriceParam !== null ? 1 : 0) + (inStockOnlyParam ? 1 : 0) > 0;

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

  const StandardLegalFilter = () => (
    <div className="pkc-filter-panel p-4">
      <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Playability</h4>
      <label className="flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={standardLegalParam}
          onChange={() => navigate({ standard_legal: standardLegalParam ? '' : '1' })}
          className="w-4 h-4 accent-pkmn-blue cursor-pointer"
        />
        <span className="ml-2 text-sm text-pkmn-text">Standard legal</span>
      </label>
    </div>
  );

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar initialCategories={initialCategories} />
      <div className="max-w-7xl mx-auto px-4 py-4">
        <Breadcrumbs items={breadcrumbs} />
        <h1 className="text-3xl font-heading font-black text-pkmn-text uppercase mb-6">{pageTitle}</h1>

        {/* ===== MOBILE FILTER BUTTON ===== */}
        <button
          onClick={() => setFilterOpen(true)}
          className="lg:hidden flex items-center gap-2 mb-4 px-4 py-2.5 border border-pkmn-border bg-white text-sm font-heading font-bold uppercase tracking-[0.06rem] text-pkmn-text hover:border-pkmn-blue transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {hasActiveFilters && <span className="ml-1 h-2 w-2 bg-pkmn-blue" />}
        </button>

        {/* ===== MOBILE FILTER DRAWER ===== */}
        <div className={`fixed inset-0 z-50 lg:hidden ${filterOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${filterOpen ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setFilterOpen(false)}
          />
          <div className={`absolute inset-y-0 left-0 w-[300px] max-w-[85vw] bg-pkmn-bg overflow-y-auto shadow-xl transition-transform duration-300 ease-out ${filterOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              <div className="sticky top-0 z-10 flex items-center justify-between bg-pkmn-blue px-4 py-3">
                <h3 className="text-sm font-heading font-black uppercase tracking-[0.08rem] text-white">Filters</h3>
                <div className="flex items-center gap-3">
                  {hasActiveFilters && (
                    <button onClick={clearAllFilters} className="text-[11px] font-semibold uppercase tracking-[0.06rem] text-white/90 hover:text-white">
                      Clear all
                    </button>
                  )}
                  <button onClick={() => setFilterOpen(false)} className="text-white/90 hover:text-white">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="space-y-4 p-4">
                {/* In-stock toggle */}
                <div className="pkc-filter-panel p-4">
                  <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Availability</h4>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inStockOnlyParam}
                      onChange={() => navigate({ in_stock: inStockOnlyParam ? '' : '1' })}
                      className="w-4 h-4 accent-pkmn-blue"
                    />
                    <span className="ml-2 text-sm text-pkmn-text">Only show items in stock</span>
                  </label>
                </div>

                {/* Price Range */}
                <div className="pkc-filter-panel p-4">
                  <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Price Range</h4>
                  <PriceSlider min={minPriceParam} max={effectiveMaxPrice} ceiling={priceCeiling} onCommit={handlePriceCommit} />
                </div>

                {contextualCategorySlug === 'cards' && (
                  <>
                    <CheckboxFilter label="Supertype" options={TCG_SUPERTYPES} selected={tcgSupertypesParam} paramKey="tcg_supertype" />
                    <CheckboxFilter label="Type"      options={TCG_TYPES}      selected={tcgTypesParam}      paramKey="tcg_type" />
                    <CheckboxFilter label="Stage"     options={TCG_STAGES}     selected={tcgStagesParam}     paramKey="tcg_stage" />
                    <CheckboxFilter label="Rarity Group" options={TCG_RARITY_GROUPS} selected={rarityTypesParam} paramKey="rarity_type" />
                    {availablePrintedRarities.length > 0 && (
                      <CheckboxFilter label="Printed Rarity" options={availablePrintedRarities} selected={printedRarityParams} paramKey="rarity" />
                    )}
                    {availableSubtypes.length > 0 && (
                      <CheckboxFilter label="Card Traits" options={availableSubtypes} selected={tcgSubtypeParams} paramKey="tcg_subtype" />
                    )}
                    {availableRegulationMarks.length > 0 && (
                      <CheckboxFilter label="Regulation Mark" options={availableRegulationMarks} selected={regulationMarkParams} paramKey="regulation_mark" />
                    )}
                    <StandardLegalFilter />
                    {availableSets.length > 0 && (
                      <CheckboxFilter label="Set" options={availableSets} selected={setNameParams} paramKey="tcg_set_name" />
                    )}
                    {availableArtists.length > 0 && (
                      <CheckboxFilter label="Artist" options={availableArtists} selected={artistParams} paramKey="tcg_artist" />
                    )}
                  </>
                )}

                {contextualCategorySlug === 'boxes' && availableSets.length > 0 && (
                  <CheckboxFilter label="Set" options={availableSets} selected={setNameParams} paramKey="tcg_set_name" />
                )}

                {contextualCategorySlug === 'accessories' && accessoriesSubcats.length > 0 && (
                  <div className="pkc-filter-panel p-4">
                    <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Type</h4>
                    <label className="flex items-center mb-2 cursor-pointer">
                      <input type="radio" name="subcat-mobile" checked={!subcatParam} onChange={() => navigate({ subcategory: '' })} className="w-4 h-4 accent-pkmn-blue" />
                      <span className="ml-2 text-sm text-pkmn-text">All</span>
                    </label>
                    {accessoriesSubcats.map(s => (
                      <label key={s.slug} className="flex items-center mb-2 cursor-pointer">
                        <input type="radio" name="subcat-mobile" checked={subcatParam === s.slug} onChange={() => navigate({ subcategory: s.slug })} className="w-4 h-4 accent-pkmn-blue" />
                        <span className="ml-2 text-sm text-pkmn-text">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}

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

                {currentCatSubcats.length > 0 && (
                  <div className="pkc-filter-panel p-4">
                    <h4 className="-mx-4 -mt-4 mb-4 bg-pkmn-blue px-4 py-2 text-xs font-heading font-bold uppercase tracking-[0.08rem] text-white">Type</h4>
                    <label className="flex items-center mb-2 cursor-pointer">
                      <input type="radio" name="subcat-mobile" checked={!subcatParam} onChange={() => navigate({ subcategory: '' })} className="w-4 h-4 accent-pkmn-blue" />
                      <span className="ml-2 text-sm text-pkmn-text">All</span>
                    </label>
                    {currentCatSubcats.map(s => (
                      <label key={s.slug} className="flex items-center mb-2 cursor-pointer">
                        <input type="radio" name="subcat-mobile" checked={subcatParam === s.slug} onChange={() => navigate({ subcategory: s.slug })} className="w-4 h-4 accent-pkmn-blue" />
                        <span className="ml-2 text-sm text-pkmn-text">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}

                {(isSearch || categorySlug === '' || categorySlug === 'all') && contextualCategorySlug !== 'cards' && contextualCategorySlug !== 'boxes' && availableSets.length > 0 && (
                  <CheckboxFilter label="Set" options={availableSets} selected={setNameParams} paramKey="tcg_set_name" />
                )}
                {(isSearch || categorySlug === '' || categorySlug === 'all') && contextualCategorySlug !== 'cards' && availableArtists.length > 0 && (
                  <CheckboxFilter label="Artist" options={availableArtists} selected={artistParams} paramKey="tcg_artist" />
                )}
              </div>
            </div>
          </div>

        <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-8">
          {/* ===== DESKTOP SIDEBAR ===== */}
          <div className="hidden lg:block space-y-4">
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
              {/* In-stock toggle */}
              <div className="mb-5">
                <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase">Availability</h4>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStockOnlyParam}
                    onChange={() => navigate({ in_stock: inStockOnlyParam ? '' : '1' })}
                    className="w-4 h-4 accent-pkmn-blue"
                  />
                  <span className="ml-2 text-sm text-pkmn-text">Only show items in stock</span>
                </label>
              </div>
              {/* Price Range */}
              <div>
                <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase">Price Range</h4>
                <PriceSlider min={minPriceParam} max={effectiveMaxPrice} ceiling={priceCeiling} onCommit={handlePriceCommit} />
              </div>
            </div>

            {/* ---- Cards sidebar ---- */}
            {contextualCategorySlug === 'cards' && (
              <>
                <CheckboxFilter label="Supertype" options={TCG_SUPERTYPES} selected={tcgSupertypesParam} paramKey="tcg_supertype" />
                <CheckboxFilter label="Type"      options={TCG_TYPES}      selected={tcgTypesParam}      paramKey="tcg_type" />
                <CheckboxFilter label="Stage"     options={TCG_STAGES}     selected={tcgStagesParam}     paramKey="tcg_stage" />
                <CheckboxFilter label="Rarity Group" options={TCG_RARITY_GROUPS} selected={rarityTypesParam} paramKey="rarity_type" />
                {availablePrintedRarities.length > 0 && (
                  <CheckboxFilter label="Printed Rarity" options={availablePrintedRarities} selected={printedRarityParams} paramKey="rarity" />
                )}
                {availableSubtypes.length > 0 && (
                  <CheckboxFilter label="Card Traits" options={availableSubtypes} selected={tcgSubtypeParams} paramKey="tcg_subtype" />
                )}
                {availableRegulationMarks.length > 0 && (
                  <CheckboxFilter label="Regulation Mark" options={availableRegulationMarks} selected={regulationMarkParams} paramKey="regulation_mark" />
                )}
                <StandardLegalFilter />
                {availableSets.length > 0 && (
                  <CheckboxFilter label="Set" options={availableSets} selected={setNameParams} paramKey="tcg_set_name" />
                )}
                {availableArtists.length > 0 && (
                  <CheckboxFilter label="Artist" options={availableArtists} selected={artistParams} paramKey="tcg_artist" />
                )}
              </>
            )}

            {/* ---- Boxes sidebar ---- */}
            {contextualCategorySlug === 'boxes' && availableSets.length > 0 && (
              <CheckboxFilter label="Set" options={availableSets} selected={setNameParams} paramKey="tcg_set_name" />
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

            {/* ---- Set / Artist filters for search + shop-all ---- */}
            {(isSearch || categorySlug === '' || categorySlug === 'all') && contextualCategorySlug !== 'cards' && contextualCategorySlug !== 'boxes' && availableSets.length > 0 && (
              <CheckboxFilter label="Set" options={availableSets} selected={setNameParams} paramKey="tcg_set_name" />
            )}
            {(isSearch || categorySlug === '' || categorySlug === 'all') && contextualCategorySlug !== 'cards' && availableArtists.length > 0 && (
              <CheckboxFilter label="Artist" options={availableArtists} selected={artistParams} paramKey="tcg_artist" />
            )}
          </div>

          {/* ===== PRODUCT GRID ===== */}
          <div>
            {/* Sort bar */}
            <div className="flex items-center justify-between mb-6 border border-pkmn-border bg-[#f5f5f5] px-4 py-3">
              <p className="text-sm text-pkmn-gray">
                {totalPages > 1
                  ? `${(pageParam - 1) * 24 + 1}–${Math.min(pageParam * 24, totalCount)} of ${totalCount} products`
                  : `${totalCount} ${totalCount === 1 ? 'product' : 'products'}`}
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
              <Spinner label="Loading products…" />            ) : itemsError ? (
              <div className="text-center py-16">
                <p className="text-pkmn-red text-lg mb-3">Failed to load products.</p>
                <button onClick={() => mutateItems()} className="text-pkmn-blue underline text-sm">Try Again</button>
              </div>            ) : items.length === 0 ? (
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

            {/* Pagination */}
            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => goToPage(pageParam - 1)}
                  disabled={pageParam <= 1}
                  className="px-3 py-1.5 text-sm border border-pkmn-border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pkmn-blue hover:text-white transition-colors"
                >
                  ← Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - pageParam) <= 2)
                  .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === 'ellipsis' ? (
                      <span key={`e${idx}`} className="px-1 text-pkmn-gray">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => goToPage(p as number)}
                        className={`px-3 py-1.5 text-sm border rounded transition-colors ${
                          p === pageParam
                            ? 'bg-pkmn-blue text-white border-pkmn-blue'
                            : 'border-pkmn-border hover:bg-pkmn-blue hover:text-white'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => goToPage(pageParam + 1)}
                  disabled={pageParam >= totalPages}
                  className="px-3 py-1.5 text-sm border border-pkmn-border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pkmn-blue hover:text-white transition-colors"
                >
                  Next →
                </button>
              </nav>
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
    <Suspense fallback={
      <div className="pkc-shell bg-pkmn-bg min-h-screen">
        <Navbar initialCategories={props.initialCategories} />
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="h-6 bg-pkmn-border rounded w-48 mb-4" />
          <div className="h-10 bg-pkmn-border rounded w-64 mb-6" />
          <div className="flex items-center justify-center py-24"><Spinner label="Loading products…" /></div>
        </div>
      </div>
    }>
      <ShopLayoutInner {...props} />
    </Suspense>
  );
}
