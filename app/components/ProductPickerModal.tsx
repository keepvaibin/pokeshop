"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import FallbackImage from './FallbackImage';
import { API_BASE_URL as API } from '@/app/lib/api';

type ProductTag = {
  id: number;
  name?: string;
};

export interface PickedProduct {
  id: number;
  title: string;
  price?: string;
  image_path?: string;
  category?: number | null;
  subcategory?: number | null;
  tags?: ProductTag[];
}

interface ProductPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: PickedProduct[];
  onConfirm: (products: PickedProduct[]) => void;
  coveredCategoryIds?: number[];
  coveredSubcategoryIds?: number[];
  coveredTagIds?: number[];
}

const PAGE_SIZE = 24;

export default function ProductPickerModal({
  open,
  onClose,
  selected,
  onConfirm,
  coveredCategoryIds = [],
  coveredSubcategoryIds = [],
  coveredTagIds = [],
}: ProductPickerModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localSelected, setLocalSelected] = useState<PickedProduct[]>(selected);
  const requestSeq = useRef(0);

  const hasCoveredTargets = coveredCategoryIds.length > 0 || coveredSubcategoryIds.length > 0 || coveredTagIds.length > 0;

  useEffect(() => {
    if (open) setLocalSelected(selected);
  }, [open, selected]);

  const fetchProducts = useCallback(async (q: string, p: number) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const params = new URLSearchParams({ page: String(p), page_size: String(PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      coveredCategoryIds.forEach(id => params.append('coupon_target_category', String(id)));
      coveredSubcategoryIds.forEach(id => params.append('coupon_target_subcategory', String(id)));
      coveredTagIds.forEach(id => params.append('coupon_target_tag', String(id)));
      localSelected.forEach(product => params.append('coupon_target_product', String(product.id)));
      const res = await axios.get(`${API}/api/inventory/items/`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (seq !== requestSeq.current) return;
      const data = res.data;
      const items = (data.results ?? data) as Array<Record<string, unknown>>;
      const count = typeof data.count === 'number' ? data.count : items.length;
      const nextTotalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
      if (p > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }
      setResults(items.map(i => ({
        id: i.id as number,
        title: i.title as string,
        price: i.price as string | undefined,
        image_path: i.image_path as string | undefined,
        category: i.category as number | null | undefined,
        subcategory: i.subcategory as number | null | undefined,
        tags: (i.tags as ProductTag[] | undefined) ?? [],
      })));
      setTotalCount(count);
      setTotalPages(nextTotalPages);
    } catch {
      if (seq !== requestSeq.current) return;
      setResults([]);
      setTotalCount(0);
      setTotalPages(1);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [coveredCategoryIds, coveredSubcategoryIds, coveredTagIds, localSelected]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => fetchProducts(query, page), 250);
    return () => clearTimeout(timer);
  }, [open, query, page, fetchProducts]);

  const updateQuery = (value: string) => {
    requestSeq.current += 1;
    setQuery(value);
    setPage(1);
    setResults([]);
    setTotalCount(0);
    setTotalPages(1);
    setLoading(true);
  };

  const isSelected = (id: number) => localSelected.some(p => p.id === id);

  const targetCoveredReason = (product: PickedProduct): string | null => {
    if (product.category && coveredCategoryIds.includes(product.category)) return 'Included by category';
    if (product.subcategory && coveredSubcategoryIds.includes(product.subcategory)) return 'Included by subcategory';
    if ((product.tags || []).some(tag => coveredTagIds.includes(tag.id))) return 'Included by tag';
    return null;
  };

  const toggle = (product: PickedProduct) => {
    if (targetCoveredReason(product)) return;
    setLocalSelected(prev =>
      prev.some(p => p.id === product.id)
        ? prev.filter(p => p.id !== product.id)
        : [...prev, product]
    );
  };

  const handleConfirm = () => {
    onConfirm(localSelected);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="bg-white border border-pkmn-border shadow-2xl w-full max-w-lg flex flex-col animate-in fade-in zoom-in-95 duration-200"
        style={{ maxHeight: 'min(85vh, 640px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-lg font-bold text-pkmn-text">Select Products</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-pkmn-bg"><X size={20} /></button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray" />
            <input
              type="text"
              value={query}
              onChange={e => updateQuery(e.target.value)}
              placeholder="Search products..."
              autoFocus
              className="w-full pl-9 pr-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
            />
          </div>
        </div>

        {/* Selected count */}
        {localSelected.length > 0 && (
          <div className="px-5 pb-2">
            <p className="text-xs text-pkmn-blue font-semibold">{localSelected.length} specific product{localSelected.length !== 1 ? 's' : ''} selected</p>
          </div>
        )}
        {hasCoveredTargets && (
          <div className="px-5 pb-2">
            <p className="text-xs text-pkmn-gray">Products covered by selected categories, subcategories, or tags are checked and sorted after unselected products.</p>
          </div>
        )}

        {/* Product list */}
        <div className="flex-1 overflow-y-auto px-5 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-pkmn-blue" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-pkmn-gray py-10">No products found</p>
          ) : (
            <div className="space-y-1">
              {results.map(product => {
                const coveredReason = targetCoveredReason(product);
                const active = isSelected(product.id) || !!coveredReason;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => toggle(product)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-all duration-100 ${
                      active
                        ? coveredReason
                          ? 'bg-pkmn-blue/5 ring-1 ring-pkmn-blue/20 cursor-default'
                          : 'bg-pkmn-blue/10 ring-1 ring-pkmn-blue/30'
                        : 'hover:bg-pkmn-bg'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      active ? 'bg-pkmn-blue border-pkmn-blue' : 'border-pkmn-border'
                    }`}>
                      {active && <Check size={12} className="text-white" />}
                    </div>
                    <div className="w-10 h-10 rounded border border-pkmn-border overflow-hidden flex-shrink-0 bg-pkmn-bg">
                      <FallbackImage
                        src={product.image_path ? `${API}${product.image_path}` : ''}
                        alt={product.title}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-pkmn-text truncate">{product.title}</p>
                      {product.price && <p className="text-xs text-pkmn-gray">${Number(product.price).toFixed(2)}</p>}
                      {coveredReason && <p className="text-[10px] font-semibold uppercase tracking-[0.04rem] text-pkmn-blue-dark">{coveredReason}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 px-5 py-2 border-t border-pkmn-border">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="p-1 rounded hover:bg-pkmn-bg disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-pkmn-gray">{page} / {totalPages}{totalCount > 0 ? ` · ${totalCount} product${totalCount !== 1 ? 's' : ''}` : ''}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-1 rounded hover:bg-pkmn-bg disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-pkmn-border">
          <button type="button" onClick={onClose} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-md hover:bg-pkmn-bg">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark text-white font-semibold py-2 rounded-md">
            Confirm{localSelected.length > 0 ? ` (${localSelected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
