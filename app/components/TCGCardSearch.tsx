"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Search, X, Loader2 } from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';

export interface TCGCard {
  product_id: number;
  name: string;
  clean_name: string;
  group_name: string;
  set_name?: string;
  sub_type_name: string;
  rarity: string;
  market_price: string;
  image_url: string;
  card_number?: string;
  set_printed_total?: string;
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
        const res = await axios.get(`${API}/api/inventory/tcg-search/?q=${encodeURIComponent(value.trim())}`);
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
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search TCG card database..."
          className="w-full pl-9 pr-8 py-2.5 border border-pkmn-border bg-white rounded-md text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
        />
        {loading && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-pkmn-blue animate-spin" />}
        {query && !loading && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setIsOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark hover:text-pkmn-gray"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-pkmn-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {results.map((card, i) => (
            <button
              key={`${card.product_id}-${card.sub_type_name}-${i}`}
              type="button"
              onClick={() => handleSelect(card)}
              className="w-full text-left px-3 py-2 hover:bg-pkmn-blue/10 border-b border-pkmn-border last:border-0 transition-colors"
            >
              <div className="flex gap-3">
                {card.image_url && (
                  <img
                    src={card.image_url}
                    alt={card.clean_name}
                    className="h-12 w-9 flex-shrink-0 rounded border border-pkmn-border object-cover bg-pkmn-bg"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="text-sm font-medium text-pkmn-text truncate">{card.clean_name}</span>
                    <span className="text-sm font-bold text-green-600 whitespace-nowrap">${Number(card.market_price).toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-pkmn-gray truncate">
                    {card.set_name || card.group_name} &middot; {card.sub_type_name}
                  </div>
                  {(card.card_number || card.rarity) && (
                    <div className="text-[11px] text-pkmn-gray-dark truncate">
                      {[card.card_number ? `#${card.card_number}${card.set_printed_total ? `/${card.set_printed_total}` : ''}` : '', card.rarity].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-pkmn-border rounded-md shadow-lg p-3 text-center text-sm text-pkmn-gray">
          No cards found. You can enter details manually.
        </div>
      )}
    </div>
  );
}
