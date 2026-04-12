"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Breadcrumbs from '../components/Breadcrumbs';
import ProductCard from '../components/ProductCard';
import Spinner from '../components/Spinner';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const TCG_TYPES    = ['Fire','Water','Grass','Psychic','Fighting','Darkness','Metal','Lightning','Fairy','Dragon','Colorless'];
const TCG_STAGES   = ['Basic','Stage 1','Stage 2','Mega','BREAK','VMAX','VSTAR','Tera'];
const TCG_RARITIES = ['Common','Uncommon','Rare','Holo Rare','Ultra Rare','Illustration Rare','Special Illustration Rare','Gold Secret Rare'];

interface Category {
  id: number;
  name: string;
  slug: string;
  subcategories: { id: number; name: string; slug: string }[];
}

interface Item {
  id: number;
  title: string;
  slug: string;
  price: string;
  image_path: string;
  images: { url: string }[];
  stock: number;
  is_holofoil?: boolean;
  rarity?: string;
  rarity_type?: string;
  tcg_type?: string;
  tcg_stage?: string;
  category?: number;
  category_slug?: string;
  subcategory?: number;
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-pkmn-bg flex items-center justify-center"><Spinner /></div>}>
      <ProductsContent />
    </Suspense>
  );
}

function ProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Read params from URL
  const categorySlug = searchParams.get('category') || '';
  const sortParam    = searchParams.get('sort') || '';
  const tcgTypesParam    = searchParams.getAll('tcg_type');
  const tcgStagesParam   = searchParams.getAll('tcg_stage');
  const rarityTypesParam = searchParams.getAll('rarity_type');

  // Local sort UI (mirrors URL sort for non-newest non-category sorts)
  const [sortBy, setSortBy] = useState(sortParam || 'featured');

  // Keep sortBy in sync when navigating to new-releases
  const prevSortParam = useRef(sortParam);
  useEffect(() => {
    if (prevSortParam.current !== sortParam) {
      setSortBy(sortParam || 'featured');
      prevSortParam.current = sortParam;
    }
  }, [sortParam]);

  const isTCGCategory = categorySlug === 'tcg-cards';

  // Helper: build URL params string
  const buildParams = useCallback((overrides: Record<string, string | string[]> = {}) => {
    const p = new URLSearchParams();
    const merged = {
      category: categorySlug,
      sort: sortBy === 'newest' ? 'newest' : (sortBy !== 'featured' ? sortBy : ''),
      tcg_type: tcgTypesParam,
      tcg_stage: tcgStagesParam,
      rarity_type: rarityTypesParam,
      ...overrides,
    } as Record<string, string | string[]>;
    Object.entries(merged).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(val => val && p.append(k, val));
      else if (v) p.set(k, v);
    });
    return p.toString();
  }, [categorySlug, sortBy, tcgTypesParam, tcgStagesParam, rarityTypesParam]);

  const navigate = (overrides: Record<string, string | string[]>) => {
    router.push('/products?' + buildParams(overrides));
  };

  const toggleFacet = (key: 'tcg_type' | 'tcg_stage' | 'rarity_type', value: string) => {
    const current: string[] = key === 'tcg_type' ? tcgTypesParam : key === 'tcg_stage' ? tcgStagesParam : rarityTypesParam;
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    navigate({ [key]: next });
  };

  useEffect(() => {
    axios.get(`${API}/api/inventory/categories/`)
      .then(r => setCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => {});
  }, []);

  // Fetch items from backend with all active filters
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (categorySlug) p.set('category', categorySlug);
    if (sortParam) p.set('sort', sortParam);
    else if (sortBy && sortBy !== 'featured') p.set('sort', sortBy);
    tcgTypesParam.forEach(v => p.append('tcg_type', v));
    tcgStagesParam.forEach(v => p.append('tcg_stage', v));
    rarityTypesParam.forEach(v => p.append('rarity_type', v));

    axios.get(`${API}/api/inventory/items/?${p.toString()}`)
      .then(r => setItems(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySlug, sortParam, sortBy, tcgTypesParam.join(','), tcgStagesParam.join(','), rarityTypesParam.join(',')]);

  const handleSortChange = (val: string) => {
    setSortBy(val);
    navigate({ sort: val === 'featured' ? '' : val });
  };

  const activeCat = categories.find(c => c.slug === categorySlug);
  const breadcrumbs = [
    { label: 'Home', url: '/' },
    { label: 'Products', url: '/products' },
    ...(activeCat ? [{ label: activeCat.name, url: `/products?category=${activeCat.slug}` }] : []),
    ...(sortParam === 'newest' && !categorySlug ? [{ label: 'New Releases', url: '/products?sort=newest' }] : []),
  ];

  const pageTitle = sortParam === 'newest' && !categorySlug
    ? 'New Releases'
    : activeCat?.name || 'All Products';

  const hasActiveFacets = tcgTypesParam.length + tcgStagesParam.length + rarityTypesParam.length > 0;

  return (
    <div className="bg-white min-h-screen">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-4">
        <Breadcrumbs items={breadcrumbs} />

        <h1 className="text-3xl font-heading font-black text-pkmn-text uppercase mb-6">{pageTitle}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-8">
          {/* Sidebar */}
          <div className="space-y-4">
            {/* Categories block */}
            <div className="bg-pkmn-bg rounded-[.6rem] p-4">
              <h3 className="text-lg font-heading font-black text-pkmn-text border-b border-pkmn-border pb-2 mb-4">Filters</h3>
              <div className="mb-4">
                <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase">Categories</h4>
                <label className="flex items-center mb-2 cursor-pointer">
                  <input type="radio" name="category" checked={!categorySlug} onChange={() => navigate({ category: '', tcg_type: [], tcg_stage: [], rarity_type: [] })} className="w-4 h-4 accent-pkmn-blue cursor-pointer" />
                  <span className="ml-2 text-sm text-pkmn-text">All Categories</span>
                </label>
                {categories.map(cat => (
                  <label key={cat.slug} className="flex items-center mb-2 cursor-pointer">
                    <input type="radio" name="category" checked={categorySlug === cat.slug} onChange={() => navigate({ category: cat.slug, tcg_type: [], tcg_stage: [], rarity_type: [] })} className="w-4 h-4 accent-pkmn-blue cursor-pointer" />
                    <span className="ml-2 text-sm text-pkmn-text font-bold">{cat.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* TCG Facets — only when TCG Cards category is active */}
            {isTCGCategory && (
              <>
                {/* Type */}
                <div className="bg-pkmn-bg rounded-[.6rem] p-4">
                  <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase border-b border-pkmn-border pb-2">Type</h4>
                  {TCG_TYPES.map(t => (
                    <label key={t} className="flex items-center mb-1.5 cursor-pointer">
                      <input type="checkbox" checked={tcgTypesParam.includes(t)} onChange={() => toggleFacet('tcg_type', t)} className="w-4 h-4 accent-pkmn-blue cursor-pointer" />
                      <span className="ml-2 text-sm text-pkmn-text">{t}</span>
                    </label>
                  ))}
                </div>

                {/* Stage */}
                <div className="bg-pkmn-bg rounded-[.6rem] p-4">
                  <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase border-b border-pkmn-border pb-2">Stage</h4>
                  {TCG_STAGES.map(s => (
                    <label key={s} className="flex items-center mb-1.5 cursor-pointer">
                      <input type="checkbox" checked={tcgStagesParam.includes(s)} onChange={() => toggleFacet('tcg_stage', s)} className="w-4 h-4 accent-pkmn-blue cursor-pointer" />
                      <span className="ml-2 text-sm text-pkmn-text">{s}</span>
                    </label>
                  ))}
                </div>

                {/* Rarity */}
                <div className="bg-pkmn-bg rounded-[.6rem] p-4">
                  <h4 className="text-sm font-heading font-bold text-pkmn-text mb-3 uppercase border-b border-pkmn-border pb-2">Rarity</h4>
                  {TCG_RARITIES.map(r => (
                    <label key={r} className="flex items-center mb-1.5 cursor-pointer">
                      <input type="checkbox" checked={rarityTypesParam.includes(r)} onChange={() => toggleFacet('rarity_type', r)} className="w-4 h-4 accent-pkmn-blue cursor-pointer" />
                      <span className="ml-2 text-sm text-pkmn-text">{r}</span>
                    </label>
                  ))}
                </div>

                {hasActiveFacets && (
                  <button onClick={() => navigate({ tcg_type: [], tcg_stage: [], rarity_type: [] })} className="w-full text-sm text-pkmn-blue underline text-left px-1">
                    Clear facet filters
                  </button>
                )}
              </>
            )}
          </div>

          {/* Product Grid */}
          <div>
            {/* Sort Bar */}
            <div className="flex items-center justify-between mb-6 border-b border-pkmn-border pb-4">
              <p className="text-sm text-pkmn-gray">
                {items.length} {items.length === 1 ? 'product' : 'products'}
              </p>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase text-pkmn-gray">Sort by:</label>
                <select
                  value={sortBy}
                  onChange={e => handleSortChange(e.target.value)}
                  className="bg-white border border-pkmn-border text-pkmn-text text-sm rounded px-3 py-1.5 focus:outline-none focus:border-pkmn-blue"
                >
                  <option value="featured">Featured</option>
                  <option value="newest">Newest</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="name">Name: A to Z</option>
                  {isTCGCategory && (
                    <>
                      <option value="release-desc">Release Date: Newest First</option>
                      <option value="release-asc">Release Date: Oldest First</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {loading ? (
              <Spinner label="Loading products..." />
            ) : items.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-pkmn-gray text-lg">No products match your filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {items.map(item => (
                  <ProductCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
