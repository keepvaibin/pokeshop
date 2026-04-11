"use client";

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Breadcrumbs from '../components/Breadcrumbs';
import ProductCard from '../components/ProductCard';
import Spinner from '../components/Spinner';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
  category?: number;
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
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.get('category') || '');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>(searchParams.get('subcategory') || '');
  const [sortBy, setSortBy] = useState('featured');

  useEffect(() => {
    axios.get(`${API}/api/inventory/categories/`)
      .then(r => setCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/api/inventory/items/`)
      .then(r => setItems(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = useCallback(() => {
    let result = [...items];

    if (selectedCategory) {
      const cat = categories.find(c => c.slug === selectedCategory);
      if (cat) result = result.filter(i => i.category === cat.id);
    }
    if (selectedSubcategory) {
      const allSubs = categories.flatMap(c => c.subcategories);
      const sub = allSubs.find(s => s.slug === selectedSubcategory);
      if (sub) result = result.filter(i => i.subcategory === sub.id);
    }

    switch (sortBy) {
      case 'price-low':
        result.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
        break;
      case 'price-high':
        result.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
        break;
      case 'name':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return result;
  }, [items, selectedCategory, selectedSubcategory, sortBy, categories]);

  const breadcrumbs = [
    { label: 'Home', url: '/' },
    { label: 'Products', url: '/products' },
  ];
  if (selectedCategory) {
    const cat = categories.find(c => c.slug === selectedCategory);
    if (cat) breadcrumbs.push({ label: cat.name, url: `/products?category=${cat.slug}` });
  }

  const filtered = filteredItems();

  return (
    <div className="bg-white min-h-screen">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-4">
        <Breadcrumbs items={breadcrumbs} />

        <h1 className="text-3xl font-black text-pkmn-text uppercase mb-6">
          {selectedCategory
            ? categories.find(c => c.slug === selectedCategory)?.name || 'Products'
            : 'All Products'}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-8">
          {/* Sidebar */}
          <div className="bg-pkmn-bg rounded-lg p-4">
            <h3 className="text-lg font-black text-pkmn-text border-b border-pkmn-border pb-2 mb-4">
              Filters
            </h3>

            {/* Categories */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-pkmn-text mb-3 uppercase">Categories</h4>
              <label className="flex items-center mb-2 cursor-pointer">
                <input
                  type="radio"
                  name="category"
                  checked={!selectedCategory}
                  onChange={() => { setSelectedCategory(''); setSelectedSubcategory(''); }}
                  className="w-4 h-4 text-pkmn-blue accent-pkmn-blue cursor-pointer"
                />
                <span className="ml-2 text-sm text-pkmn-text">All Categories</span>
              </label>
              {categories.map(cat => (
                <div key={cat.slug}>
                  <label className="flex items-center mb-2 cursor-pointer">
                    <input
                      type="radio"
                      name="category"
                      checked={selectedCategory === cat.slug}
                      onChange={() => { setSelectedCategory(cat.slug); setSelectedSubcategory(''); }}
                      className="w-4 h-4 text-pkmn-blue accent-pkmn-blue cursor-pointer"
                    />
                    <span className="ml-2 text-sm text-pkmn-text font-bold">{cat.name}</span>
                  </label>
                  {selectedCategory === cat.slug && cat.subcategories.length > 0 && (
                    <div className="ml-6 mb-2">
                      {cat.subcategories.map(sub => (
                        <label key={sub.slug} className="flex items-center mb-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="subcategory"
                            checked={selectedSubcategory === sub.slug}
                            onChange={() => setSelectedSubcategory(sub.slug)}
                            className="w-4 h-4 text-pkmn-blue accent-pkmn-blue cursor-pointer"
                          />
                          <span className="ml-2 text-sm text-pkmn-text">{sub.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <div>
            {/* Sort Bar */}
            <div className="flex items-center justify-between mb-6 border-b border-pkmn-border pb-4">
              <p className="text-sm text-pkmn-gray">
                {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
              </p>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase text-pkmn-gray">Sort by:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-white border border-pkmn-border text-pkmn-text text-sm rounded px-3 py-1.5 focus:outline-none focus:border-pkmn-blue"
                >
                  <option value="featured">Featured</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="name">Name: A to Z</option>
                </select>
              </div>
            </div>

            {loading ? (
              <Spinner label="Loading products..." />
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-pkmn-gray text-lg">No products match your filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filtered.map(item => (
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
