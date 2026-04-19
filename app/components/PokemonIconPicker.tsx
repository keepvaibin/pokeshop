"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import { Search, X } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';

interface PokemonIcon {
  id: number;
  pokedex_number: number;
  display_name: string;
  region: string;
  filename: string;
}

function formatPokemonIconName(filename: string | null | undefined) {
  if (!filename) return null;

  const baseName = filename.replace(/\.png$/i, '');
  const trimmed = baseName
    .replace(/^\d+_/, '')
    .replace(/_(kanto|johto|hoenn|sinnoh|unova|kalos|alola|galar|hisui|paldea)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!trimmed) return null;

  return trimmed.replace(/\b\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

const REGIONS = [
  'Kanto', 'Johto', 'Hoenn', 'Sinnoh',
  'Unova', 'Kalos', 'Alola', 'Galar', 'Hisui', 'Paldea',
];

export default function PokemonIconPicker({
  currentIcon,
  onSelect,
}: {
  currentIcon: string | null | undefined;
  onSelect: (filename: string | null, iconId?: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [icons, setIcons] = useState<PokemonIcon[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const CACHE_KEY = 'sctcg_pokemon_icons';

  const fetchIcons = useCallback(async () => {
    if (icons.length > 0) return;
    setLoading(true);
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        setIcons(JSON.parse(cached));
        setLoading(false);
        return;
      }
      const res = await axios.get(`${API}/api/auth/pokemon-icons/`);
      setIcons(res.data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(res.data)); } catch { /* quota */ }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [icons.length]);

  useEffect(() => {
    if (open && icons.length === 0) fetchIcons();
  }, [open, fetchIcons, icons.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const toggleRegion = (r: string) => {
    setSelectedRegions(prev => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = icons;
    if (selectedRegions.size > 0) {
      list = list.filter(i => selectedRegions.has(i.region));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i => i.display_name.toLowerCase().includes(q));
    }
    return list;
  }, [icons, selectedRegions, search]);

  const currentIconData = useMemo(() => {
    if (!currentIcon) return null;
    return icons.find(i => i.filename === currentIcon) || null;
  }, [icons, currentIcon]);

  const currentIconLabel = useMemo(() => {
    if (currentIconData?.display_name) return currentIconData.display_name;
    return formatPokemonIconName(currentIcon);
  }, [currentIcon, currentIconData]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const icon of icons) {
      counts[icon.region] = (counts[icon.region] || 0) + 1;
    }
    return counts;
  }, [icons]);

  return (
    <div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative flex h-16 w-16 cursor-pointer items-center justify-center border-2 border-pkmn-border bg-white transition-colors hover:border-[#0c55a5] overflow-hidden"
        >
          {currentIcon ? (
            <Image src={`/pkmn_icons/${currentIcon}`} alt="Your Pokémon icon" width={56} height={56} className="object-contain" />
          ) : (
            <span className="text-2xl text-[#767676]">?</span>
          )}
        </button>
        <div>
          <p className="text-sm font-semibold text-pkmn-text">
            {currentIconLabel || 'No icon selected'}
          </p>
          <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-bold text-[#0c55a5] hover:underline cursor-pointer">
            {currentIcon ? 'Change Icon' : 'Choose Icon'}
          </button>
          {currentIcon && (
            <button type="button" onClick={() => onSelect(null, null)} className="mt-1 ml-3 text-xs font-bold text-pkmn-red hover:underline cursor-pointer">
              Remove
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            ref={modalRef}
            className="relative mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-black bg-white shadow-xl"
          >
            {/* PKC-style blue header */}
            <div className="flex items-center justify-between bg-[#0c55a5] px-4 py-3">
              <h3 className="text-base font-bold text-white">Choose Your Pokémon Icon</h3>
              <button type="button" onClick={() => setOpen(false)} className="cursor-pointer rounded p-1 text-white/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search bar */}
            <div className="border-b border-[#eee] bg-[#fafafa] px-4 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#767676]" />
                <input
                  type="text"
                  placeholder="Search Pokémon..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-md border border-[#eee] bg-white py-2 pl-9 pr-3 text-sm focus:border-[#0c55a5] focus:outline-none focus:ring-1 focus:ring-[#0c55a5]/30"
                />
              </div>
            </div>

            {/* Sidebar + grid layout */}
            <div className="flex flex-1 overflow-hidden">
              {/* PKC-style sidebar facet */}
              <div className="w-[180px] shrink-0 overflow-y-auto border-r border-[#eee] bg-[#fafafa] p-3">
                <div className="rounded-md border border-black bg-white">
                  <div className="rounded-t-lg bg-[#0c55a5] px-3 py-2">
                    <span className="text-xs font-bold text-white">Region</span>
                  </div>
                  <div className="p-2 space-y-1">
                    {REGIONS.map(r => {
                      const active = selectedRegions.has(r);
                      const count = regionCounts[r] || 0;
                      return (
                        <label
                          key={r}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-[#e6f8fc] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleRegion(r)}
                            className="h-3.5 w-3.5 rounded border-[#767676] accent-[#0c55a5]"
                          />
                          <span className={`flex-1 ${active ? 'font-bold text-[#0c55a5]' : 'text-[#333]'}`}>{r}</span>
                          <span className="text-[10px] text-[#767676]">{count}</span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedRegions.size > 0 && (
                    <div className="border-t border-[#eee] px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedRegions(new Set())}
                        className="w-full rounded bg-[#767676] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#555] transition-colors"
                      >
                        Clear Filters
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Icon grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <p className="py-12 text-center text-sm text-[#767676]">Loading icons...</p>
                ) : filtered.length === 0 ? (
                  <p className="py-12 text-center text-sm text-[#767676]">No Pokémon found.</p>
                ) : (
                  <div className="grid grid-cols-6 gap-1 sm:grid-cols-8 lg:grid-cols-10">
                    {filtered.map(icon => {
                      const selected = icon.filename === currentIcon;
                      return (
                        <button
                          key={icon.id}
                          type="button"
                          onClick={() => { onSelect(icon.filename, icon.id); setOpen(false); }}
                          title={icon.display_name}
                          className={`cursor-pointer flex items-center justify-center rounded-md p-1 transition-colors ${
                            selected
                              ? 'bg-[#0c55a5]/15 ring-2 ring-[#0c55a5]'
                              : 'hover:bg-[#e6f8fc]'
                          }`}
                        >
                          <Image src={`/pkmn_icons/${icon.filename}`} alt={icon.display_name} width={44} height={44} className="object-contain" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-[#eee] bg-[#fafafa] px-4 py-2 text-xs text-[#767676]">
              {filtered.length} Pokémon{selectedRegions.size > 0 ? ` in ${[...selectedRegions].join(', ')}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
