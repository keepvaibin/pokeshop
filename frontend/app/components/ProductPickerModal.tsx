"use client";

import { useState, useEffect, useCallback } from 'react';
import { Search, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import FallbackImage from './FallbackImage';
import { API_BASE_URL as API } from '@/app/lib/api';

export interface PickedProduct {
  id: number;
  title: string;
  price?: string;
  image_path?: string;
}

interface ProductPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: PickedProduct[];
  onConfirm: (products: PickedProduct[]) => void;
}

const PAGE_SIZE = 12;

export default function ProductPickerModal({ open, onClose, selected, onConfirm }: ProductPickerModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [localSelected, setLocalSelected] = useState<PickedProduct[]>(selected);

  useEffect(() => {
    if (open) setLocalSelected(selected);
  }, [open, selected]);

  const fetchProducts = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const params: Record<string, string> = { page: String(p) };
      if (q.trim()) params.q = q.trim();
      const res = await axios.get(`${API}/api/inventory/items/`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res.data;
      const items = (data.results ?? data) as Array<Record<string, unknown>>;
      setResults(items.map(i => ({
        id: i.id as number,
        title: i.title as string,
        price: i.price as string | undefined,
        image_path: i.image_path as string | undefined,
      })));
      const count = data.count ?? items.length;
      setTotalPages(Math.max(1, Math.ceil(count / PAGE_SIZE)));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => fetchProducts(query, page), 250);
    return () => clearTimeout(timer);
  }, [open, query, page, fetchProducts]);

  useEffect(() => { setPage(1); }, [query]);

  const isSelected = (id: number) => localSelected.some(p => p.id === id);

  const toggle = (product: PickedProduct) => {
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
              onChange={e => setQuery(e.target.value)}
              placeholder="Search products..."
              autoFocus
              className="w-full pl-9 pr-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
            />
          </div>
        </div>

        {/* Selected count */}
        {localSelected.length > 0 && (
          <div className="px-5 pb-2">
            <p className="text-xs text-pkmn-blue font-semibold">{localSelected.length} product{localSelected.length !== 1 ? 's' : ''} selected</p>
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
                const active = isSelected(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => toggle(product)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-100 ${
                      active
                        ? 'bg-pkmn-blue/10 ring-1 ring-pkmn-blue/30'
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
            <span className="text-xs text-pkmn-gray">{page} / {totalPages}</span>
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
          <button type="button" onClick={onClose} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-lg hover:bg-pkmn-bg">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark text-white font-semibold py-2 rounded-lg">
            Confirm{localSelected.length > 0 ? ` (${localSelected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
