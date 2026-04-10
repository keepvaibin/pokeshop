"use client";

import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Search, X, Loader2 } from 'lucide-react';

export interface TCGCard {
  product_id: number;
  name: string;
  clean_name: string;
  group_name: string;
  sub_type_name: string;
  rarity: string;
  market_price: string;
  image_url: string;
}

interface TCGCardSearchProps {
  onSelect: (card: TCGCard) => void;
  initialValue?: string;
}

export default function TCGCardSearch({ onSelect, initialValue = '' }: TCGCardSearchProps) {
  const [query, setQuery] = useState(initialValue);
  const [results, setResults] = useState<TCGCard[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(`http://localhost:8000/api/inventory/tcg-search/?q=${encodeURIComponent(value.trim())}`);
        setResults(res.data.results ?? res.data);
        setIsOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleSelect = (card: TCGCard) => {
    setQuery(card.clean_name);
    setIsOpen(false);
    onSelect(card);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search TCG card database..."
          className="w-full pl-9 pr-8 py-2.5 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg text-sm text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {loading && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 animate-spin" />}
        {query && !loading && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setIsOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((card, i) => (
            <button
              key={`${card.product_id}-${card.sub_type_name}-${i}`}
              type="button"
              onClick={() => handleSelect(card)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-zinc-700 border-b border-gray-100 dark:border-zinc-700 last:border-0 transition-colors"
            >
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate mr-2">{card.clean_name}</span>
                <span className="text-sm font-bold text-green-700 whitespace-nowrap">${Number(card.market_price).toFixed(2)}</span>
              </div>
              <div className="text-xs text-gray-500">
                {card.group_name} &middot; {card.sub_type_name}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3 text-center text-sm text-gray-500">
          No cards found. You can enter details manually.
        </div>
      )}
    </div>
  );
}
