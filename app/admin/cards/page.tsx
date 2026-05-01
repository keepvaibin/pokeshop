"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Layers,
  ListChecks,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import FallbackImage from '../../components/FallbackImage';

const PAGE_SIZE = 36;

const TCG_TYPES = ['Fire','Water','Grass','Psychic','Fighting','Darkness','Metal','Lightning','Fairy','Dragon','Colorless'];
const TCG_STAGES = ['Basic','Stage 1','Stage 2','Mega','BREAK','VMAX','VSTAR','Tera'];
const TCG_SUPERTYPES = ['Pokémon','Trainer','Energy'];

const MISSING_FILTERS = [
  { key: 'regulation_mark', label: 'Regulation' },
  { key: 'tcg_type', label: 'Type' },
  { key: 'tcg_hp', label: 'HP' },
  { key: 'standard_legal', label: 'Playability' },
  { key: 'api_id', label: 'API ID' },
  { key: 'rarity', label: 'Printed Rarity' },
];

const SYNC_FIELD_OPTIONS = [
  { key: 'regulation_mark', label: 'Regulation mark' },
  { key: 'standard_legal', label: 'Standard legal' },
  { key: 'tcg_type', label: 'Type' },
  { key: 'tcg_hp', label: 'HP' },
  { key: 'tcg_stage', label: 'Stage' },
  { key: 'tcg_supertype', label: 'Supertype' },
  { key: 'rarity', label: 'Printed rarity' },
  { key: 'tcg_subtypes', label: 'Card traits' },
  { key: 'tcg_artist', label: 'Artist' },
  { key: 'tcg_set_release_date', label: 'Release date' },
  { key: 'api_id', label: 'API ID' },
];

interface CardImagePayload {
  id: number;
  url: string;
  position: number;
}

interface AdminCardItem {
  id: number;
  title: string;
  slug: string;
  price: string;
  stock: number;
  is_active: boolean;
  show_when_out_of_stock: boolean;
  image_path: string;
  images: CardImagePayload[];
  tcg_set_name: string | null;
  rarity: string | null;
  rarity_type: string | null;
  card_number: string | null;
  api_id: string | null;
  tcg_type: string | null;
  tcg_stage: string | null;
  tcg_supertype: string | null;
  tcg_subtypes: string | null;
  tcg_hp: number | null;
  tcg_artist: string | null;
  tcg_set_release_date: string | null;
  regulation_mark: string | null;
  standard_legal: boolean | null;
  tcg_legalities: Record<string, string>;
}

interface AdminCardFacets {
  tcg_types: string[];
  tcg_stages: string[];
  tcg_supertypes: string[];
  printed_rarities: string[];
  regulation_marks: string[];
  sets: string[];
  artists: string[];
}

interface AdminCardsResponse {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: AdminCardItem[];
  facets: AdminCardFacets;
}

interface SyncResult {
  item_id: number;
  slug: string;
  title: string;
  status: 'updated' | 'unchanged' | 'not_matched' | 'error';
  message: string;
  updated_fields: string[];
  item?: AdminCardItem;
}

interface SyncResponse {
  count: number;
  processed: number;
  matched: number;
  updated: number;
  skipped: number;
  results: SyncResult[];
}

type StandardLegalFilter = 'all' | 'true' | 'false' | 'unknown';
type StockFilter = 'all' | 'in_stock' | 'out_of_stock';
type StatusFilter = 'all' | 'active' | 'inactive';
type SyncScope = 'filtered' | 'selected';

interface FilterState {
  search: string;
  stock: StockFilter;
  status: StatusFilter;
  standardLegal: StandardLegalFilter;
  type: string;
  stage: string;
  supertype: string;
  rarity: string;
  regulationMark: string;
  setName: string;
  artist: string;
  sort: string;
}

interface CardEditForm {
  tcg_set_name: string;
  card_number: string;
  api_id: string;
  rarity: string;
  tcg_supertype: string;
  tcg_type: string;
  tcg_stage: string;
  tcg_subtypes: string;
  tcg_hp: string;
  regulation_mark: string;
  standard_legal: 'unknown' | 'true' | 'false';
  tcg_artist: string;
  tcg_set_release_date: string;
}

const emptyFacets: AdminCardFacets = {
  tcg_types: [],
  tcg_stages: [],
  tcg_supertypes: [],
  printed_rarities: [],
  regulation_marks: [],
  sets: [],
  artists: [],
};

const initialFilters: FilterState = {
  search: '',
  stock: 'all',
  status: 'all',
  standardLegal: 'all',
  type: '',
  stage: '',
  supertype: '',
  rarity: '',
  regulationMark: '',
  setName: '',
  artist: '',
  sort: 'missing-first',
};

function formatMoney(value: string | number) {
  const amount = Number(value || 0);
  return `$${amount.toFixed(2)}`;
}

function compactText(values: Array<string | number | null | undefined>) {
  return values.filter(value => value !== null && value !== undefined && String(value).trim()).join(' · ');
}

function cardImage(card: AdminCardItem) {
  return card.images?.[0]?.url || card.image_path || '';
}

function legalLabel(value: boolean | null) {
  if (value === true) return 'Standard legal';
  if (value === false) return 'Not standard';
  return 'Unknown legality';
}

function cardToEditForm(card: AdminCardItem): CardEditForm {
  return {
    tcg_set_name: card.tcg_set_name || '',
    card_number: card.card_number || '',
    api_id: card.api_id || '',
    rarity: card.rarity || '',
    tcg_supertype: card.tcg_supertype || '',
    tcg_type: card.tcg_type || '',
    tcg_stage: card.tcg_stage || '',
    tcg_subtypes: card.tcg_subtypes || '',
    tcg_hp: card.tcg_hp == null ? '' : String(card.tcg_hp),
    regulation_mark: card.regulation_mark || '',
    standard_legal: card.standard_legal == null ? 'unknown' : card.standard_legal ? 'true' : 'false',
    tcg_artist: card.tcg_artist || '',
    tcg_set_release_date: card.tcg_set_release_date || '',
  };
}

function uniqueOptions(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto border border-pkmn-border bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-pkmn-border bg-white px-5 py-4">
          <h2 className="font-heading text-lg font-black uppercase text-pkmn-text">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center text-pkmn-gray hover:bg-pkmn-bg hover:text-pkmn-red" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.06rem] text-pkmn-gray">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20"
      >
        <option value="">All</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function FieldInput({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.06rem] text-pkmn-gray">{label}</span>
      {children}
    </label>
  );
}

export default function AdminCardsPage() {
  const { user, loading: authLoading } = useRequireAuth({ adminOnly: true });
  const [cards, setCards] = useState<AdminCardItem[]>([]);
  const [facets, setFacets] = useState<AdminCardFacets>(emptyFacets);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCards, setLoadingCards] = useState(true);
  const [selectedCard, setSelectedCard] = useState<AdminCardItem | null>(null);
  const [editForm, setEditForm] = useState<CardEditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncScope, setSyncScope] = useState<SyncScope>('filtered');
  const [syncFields, setSyncFields] = useState<string[]>(['regulation_mark', 'standard_legal']);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResults, setLastSyncResults] = useState<SyncResult[]>([]);

  const canUseAdmin = !authLoading && !!user?.is_admin;

  const typeOptions = useMemo(() => uniqueOptions(TCG_TYPES, facets.tcg_types), [facets.tcg_types]);
  const stageOptions = useMemo(() => uniqueOptions(TCG_STAGES, facets.tcg_stages), [facets.tcg_stages]);
  const supertypeOptions = useMemo(() => uniqueOptions(TCG_SUPERTYPES, facets.tcg_supertypes), [facets.tcg_supertypes]);
  const pageLabel = totalCount === 0 ? 'No cards' : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(totalCount, page * PAGE_SIZE)} of ${totalCount}`;

  const buildParams = useCallback((targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), page_size: String(PAGE_SIZE), sort: filters.sort });
    if (filters.search.trim()) params.set('q', filters.search.trim());
    if (filters.stock !== 'all') params.set('stock', filters.stock);
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.standardLegal !== 'all') params.set('standard_legal', filters.standardLegal);
    if (filters.type) params.append('tcg_type', filters.type);
    if (filters.stage) params.append('tcg_stage', filters.stage);
    if (filters.supertype) params.append('tcg_supertype', filters.supertype);
    if (filters.rarity) params.append('rarity', filters.rarity);
    if (filters.regulationMark) params.append('regulation_mark', filters.regulationMark);
    if (filters.setName) params.append('tcg_set_name', filters.setName);
    if (filters.artist) params.append('tcg_artist', filters.artist);
    missingFields.forEach(field => params.append('missing', field));
    return params;
  }, [filters, missingFields, page]);

  const buildSyncFilters = useCallback(() => ({
    q: filters.search.trim(),
    stock: filters.stock === 'all' ? '' : filters.stock,
    status: filters.status === 'all' ? '' : filters.status,
    standard_legal: filters.standardLegal === 'all' ? '' : filters.standardLegal,
    tcg_type: filters.type ? [filters.type] : [],
    tcg_stage: filters.stage ? [filters.stage] : [],
    tcg_supertype: filters.supertype ? [filters.supertype] : [],
    rarity: filters.rarity ? [filters.rarity] : [],
    regulation_mark: filters.regulationMark ? [filters.regulationMark] : [],
    tcg_set_name: filters.setName ? [filters.setName] : [],
    tcg_artist: filters.artist ? [filters.artist] : [],
    missing: missingFields,
    sort: filters.sort,
  }), [filters, missingFields]);

  const fetchCards = useCallback(async (targetPage = page) => {
    if (!canUseAdmin) return;
    setLoadingCards(true);
    try {
      const response = await axios.get<AdminCardsResponse>(`${API}/api/inventory/admin/cards/?${buildParams(targetPage).toString()}`);
      setCards(response.data.results);
      setFacets(response.data.facets || emptyFacets);
      setTotalCount(response.data.count);
      setTotalPages(response.data.total_pages || 1);
      setPage(response.data.page || targetPage);
      setSelectedCard(previous => {
        if (!previous) return null;
        const fresh = response.data.results.find(card => card.id === previous.id);
        return fresh || null;
      });
    } catch {
      toast.error('Failed to load cards');
    } finally {
      setLoadingCards(false);
    }
  }, [buildParams, canUseAdmin, page]);

  useEffect(() => {
    if (!canUseAdmin) return;
    const timer = setTimeout(() => {
      void fetchCards(page);
    }, filters.search.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [canUseAdmin, fetchCards, filters.search, page]);

  useEffect(() => {
    setEditForm(selectedCard ? cardToEditForm(selectedCard) : null);
  }, [selectedCard]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters(previous => ({ ...previous, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setMissingFields([]);
    setPage(1);
  }

  function toggleMissing(field: string) {
    setMissingFields(previous => previous.includes(field) ? previous.filter(value => value !== field) : [...previous, field]);
    setPage(1);
  }

  function toggleSyncField(field: string) {
    setSyncFields(previous => previous.includes(field) ? previous.filter(value => value !== field) : [...previous, field]);
  }

  async function saveSelectedCard() {
    if (!selectedCard || !editForm) return;
    const parsedHp = editForm.tcg_hp.trim() ? Number(editForm.tcg_hp) : null;
    if (parsedHp !== null && (!Number.isInteger(parsedHp) || parsedHp < 0)) {
      toast.error('HP must be a positive whole number');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        tcg_set_name: editForm.tcg_set_name.trim() || null,
        card_number: editForm.card_number.trim() || null,
        api_id: editForm.api_id.trim() || null,
        rarity: editForm.rarity.trim() || null,
        tcg_supertype: editForm.tcg_supertype.trim() || null,
        tcg_type: editForm.tcg_type.trim() || null,
        tcg_stage: editForm.tcg_stage.trim() || null,
        tcg_subtypes: editForm.tcg_subtypes.trim() || null,
        tcg_hp: parsedHp,
        regulation_mark: editForm.regulation_mark.trim().toUpperCase() || null,
        standard_legal: editForm.standard_legal === 'unknown' ? null : editForm.standard_legal === 'true',
        tcg_artist: editForm.tcg_artist.trim() || null,
        tcg_set_release_date: editForm.tcg_set_release_date || null,
      };
      const response = await axios.patch<AdminCardItem>(`${API}/api/inventory/items/${selectedCard.slug}/`, payload);
      setSelectedCard(response.data);
      setCards(previous => previous.map(card => card.id === response.data.id ? response.data : card));
      toast.success('Card saved');
    } catch (err) {
      const message = axios.isAxiosError<{ error?: string; detail?: string }>(err)
        ? err.response?.data?.error || err.response?.data?.detail || 'Failed to save card'
        : 'Failed to save card';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function submitSync() {
    if (syncFields.length === 0) {
      toast.error('Choose at least one property');
      return;
    }
    if (syncScope === 'selected' && !selectedCard) {
      toast.error('Select a card first');
      return;
    }

    setSyncing(true);
    setLastSyncResults([]);
    try {
      const payload = syncScope === 'selected'
        ? { item_ids: selectedCard ? [selectedCard.id] : [], fields: syncFields }
        : { filters: buildSyncFilters(), fields: syncFields };
      const response = await axios.post<SyncResponse>(`${API}/api/inventory/admin/cards/sync-properties/`, payload);
      setLastSyncResults(response.data.results || []);
      const selectedResult = selectedCard ? response.data.results?.find(result => result.item_id === selectedCard.id) : null;
      if (selectedResult?.item) {
        setSelectedCard(selectedResult.item);
      }
      await fetchCards(page);
      toast.success(`${response.data.updated} of ${response.data.processed} cards updated`);
    } catch (err) {
      const message = axios.isAxiosError<{ error?: string }>(err)
        ? err.response?.data?.error || 'Failed to sync card properties'
        : 'Failed to sync card properties';
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  const selectedImage = selectedCard ? cardImage(selectedCard) : '';
  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(initialFilters) || missingFields.length > 0;

  if (authLoading || !user?.is_admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pkmn-bg px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-pkmn-blue" />
          <p className="text-pkmn-gray">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pkmn-bg">
      <Navbar adminMode />
      <main className="mx-auto max-w-7xl px-3 py-6 sm:px-4 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center bg-pkmn-blue text-white">
              <Layers size={24} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18rem] text-pkmn-blue">Admin Cards</p>
              <h1 className="font-heading text-3xl font-black uppercase text-pkmn-text">Cards</h1>
              <p className="text-sm text-pkmn-gray">Search, filter, edit, and sync TCG metadata.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-xs font-semibold uppercase tracking-[0.08rem] text-pkmn-gray sm:text-right">{pageLabel}</span>
            <button
              type="button"
              onClick={() => { setSyncScope(selectedCard ? 'selected' : 'filtered'); setSyncModalOpen(true); }}
              className="inline-flex items-center justify-center gap-2 bg-pkmn-blue px-4 py-2.5 text-sm font-bold uppercase text-white hover:bg-pkmn-blue-dark"
            >
              <RefreshCw size={16} /> Sync Properties
            </button>
          </div>
        </div>

        <section className="mb-6 border border-pkmn-border bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-pkmn-text">
              <SlidersHorizontal size={18} />
              <h2 className="font-heading text-sm font-black uppercase">Filters</h2>
            </div>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="text-xs font-bold uppercase text-pkmn-blue hover:text-pkmn-blue-dark">
                Clear all
              </button>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(140px,1fr))]">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.06rem] text-pkmn-gray">Search</span>
              <div className="relative">
                <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                  placeholder="Name, set, number, artist..."
                  className="w-full border border-pkmn-border bg-pkmn-bg py-2 pl-9 pr-3 text-sm text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20"
                />
              </div>
            </label>
            <SelectFilter label="Type" value={filters.type} options={typeOptions} onChange={(value) => updateFilter('type', value)} />
            <SelectFilter label="Stage" value={filters.stage} options={stageOptions} onChange={(value) => updateFilter('stage', value)} />
            <SelectFilter label="Supertype" value={filters.supertype} options={supertypeOptions} onChange={(value) => updateFilter('supertype', value)} />
            <SelectFilter label="Printed Rarity" value={filters.rarity} options={facets.printed_rarities} onChange={(value) => updateFilter('rarity', value)} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-6">
            <SelectFilter label="Regulation" value={filters.regulationMark} options={facets.regulation_marks} onChange={(value) => updateFilter('regulationMark', value)} />
            <SelectFilter label="Set" value={filters.setName} options={facets.sets} onChange={(value) => updateFilter('setName', value)} />
            <SelectFilter label="Artist" value={filters.artist} options={facets.artists} onChange={(value) => updateFilter('artist', value)} />
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.06rem] text-pkmn-gray">Stock</span>
              <select value={filters.stock} onChange={(event) => updateFilter('stock', event.target.value as StockFilter)} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                <option value="all">All</option>
                <option value="in_stock">In stock</option>
                <option value="out_of_stock">Out of stock</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.06rem] text-pkmn-gray">Playability</span>
              <select value={filters.standardLegal} onChange={(event) => updateFilter('standardLegal', event.target.value as StandardLegalFilter)} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                <option value="all">All</option>
                <option value="true">Standard legal</option>
                <option value="false">Not standard</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.06rem] text-pkmn-gray">Sort</span>
              <select value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                <option value="missing-first">Missing first</option>
                <option value="name">Name</option>
                <option value="stock-low">Stock low</option>
                <option value="release-desc">Newest set</option>
                <option value="release-asc">Oldest set</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {MISSING_FILTERS.map(option => {
              const active = missingFields.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleMissing(option.key)}
                  className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-bold uppercase ${active ? 'border-pkmn-blue bg-pkmn-blue text-white' : 'border-pkmn-border bg-pkmn-bg text-pkmn-gray-dark hover:border-pkmn-blue/40'}`}
                >
                  {active ? <CheckCircle size={13} /> : <AlertCircle size={13} />} Missing {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
          <section>
            {loadingCards ? (
              <div className="flex items-center justify-center border border-pkmn-border bg-white py-16 shadow-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-pkmn-blue" />
              </div>
            ) : cards.length === 0 ? (
              <div className="border border-pkmn-border bg-white p-10 text-center shadow-sm">
                <Layers className="mx-auto mb-3 h-9 w-9 text-pkmn-gray" />
                <p className="font-heading font-bold uppercase text-pkmn-text">No cards found</p>
                <p className="mt-1 text-sm text-pkmn-gray">Adjust filters or clear missing-only chips.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map(card => {
                  const active = selectedCard?.id === card.id;
                  const image = cardImage(card);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setSelectedCard(card)}
                      className={`min-h-[230px] border bg-white p-3 text-left shadow-sm transition-all hover:border-pkmn-blue hover:shadow-md focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30 ${active ? 'border-pkmn-blue ring-2 ring-pkmn-blue/20' : 'border-pkmn-border'}`}
                    >
                      <div className="flex gap-3">
                        <div className="flex h-28 w-20 shrink-0 items-center justify-center bg-pkmn-bg">
                          {image ? (
                            <FallbackImage src={image} alt={card.title} className="h-full w-full object-contain" fallbackSize={28} fallbackClassName="flex h-full w-full items-center justify-center" />
                          ) : (
                            <ImageIcon className="h-7 w-7 text-pkmn-gray" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 font-heading font-black text-pkmn-text">{card.title}</p>
                            <span className="shrink-0 bg-pkmn-bg px-2 py-1 text-[10px] font-black uppercase text-pkmn-gray-dark">{card.stock}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-pkmn-gray">{compactText([card.tcg_set_name, card.card_number ? `#${card.card_number}` : '', card.rarity]) || 'No print metadata'}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-black uppercase">
                            {card.tcg_type ? <span className="border border-pkmn-border bg-pkmn-bg px-2 py-1 text-pkmn-gray-dark">{card.tcg_type}</span> : <span className="border border-pkmn-red/20 bg-pkmn-red/10 px-2 py-1 text-pkmn-red">No type</span>}
                            {card.tcg_hp ? <span className="border border-pkmn-border bg-pkmn-bg px-2 py-1 text-pkmn-gray-dark">{card.tcg_hp} HP</span> : <span className="border border-pkmn-yellow/40 bg-pkmn-yellow/20 px-2 py-1 text-pkmn-yellow-dark">No HP</span>}
                            {card.regulation_mark ? <span className="border border-green-500/20 bg-green-500/10 px-2 py-1 text-green-700">Reg {card.regulation_mark}</span> : <span className="border border-pkmn-red/20 bg-pkmn-red/10 px-2 py-1 text-pkmn-red">No Reg</span>}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-pkmn-border pt-3 text-xs">
                        <span className="font-black text-pkmn-text">{formatMoney(card.price)}</span>
                        <span className={card.standard_legal === true ? 'font-bold text-green-700' : card.standard_legal === false ? 'font-bold text-pkmn-gray-dark' : 'font-bold text-pkmn-red'}>{legalLabel(card.standard_legal)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-6 flex flex-col gap-3 border border-pkmn-border bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => setPage(previous => Math.max(1, previous - 1))} disabled={page <= 1} className="inline-flex w-full items-center justify-center gap-2 border border-pkmn-border px-3 py-2 text-sm font-semibold text-pkmn-text hover:bg-pkmn-bg disabled:opacity-40 sm:w-auto">
                  <ChevronLeft size={16} /> Previous
                </button>
                <span className="text-center text-sm font-semibold text-pkmn-gray">Page {page} of {totalPages}</span>
                <button type="button" onClick={() => setPage(previous => Math.min(totalPages, previous + 1))} disabled={page >= totalPages} className="inline-flex w-full items-center justify-center gap-2 border border-pkmn-border px-3 py-2 text-sm font-semibold text-pkmn-text hover:bg-pkmn-bg disabled:opacity-40 sm:w-auto">
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </section>

          <aside className="min-h-[560px] border border-pkmn-border bg-white shadow-sm lg:sticky lg:top-4 lg:self-start">
            {!selectedCard || !editForm ? (
              <div className="flex h-[560px] flex-col items-center justify-center p-8 text-center">
                <ListChecks className="mb-3 h-10 w-10 text-pkmn-gray" />
                <p className="font-heading font-black uppercase text-pkmn-text">Select a card</p>
                <p className="mt-1 text-sm text-pkmn-gray">Card metadata opens here.</p>
              </div>
            ) : (
              <div>
                <div className="border-b border-pkmn-border bg-pkmn-bg/70 p-5">
                  <div className="flex gap-4">
                    <div className="flex h-36 w-24 shrink-0 items-center justify-center bg-white">
                      {selectedImage ? (
                        <FallbackImage src={selectedImage} alt={selectedCard.title} className="h-full w-full object-contain" fallbackSize={32} fallbackClassName="flex h-full w-full items-center justify-center" />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-pkmn-gray" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="line-clamp-3 font-heading text-xl font-black text-pkmn-text">{selectedCard.title}</h2>
                      <p className="mt-1 text-sm text-pkmn-gray">{compactText([selectedCard.tcg_set_name, selectedCard.card_number ? `#${selectedCard.card_number}` : '', selectedCard.rarity])}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div className="border border-pkmn-border bg-white p-2">
                          <p className="text-[10px] font-bold uppercase text-pkmn-gray">Stock</p>
                          <p className="text-sm font-black text-pkmn-text">{selectedCard.stock}</p>
                        </div>
                        <div className="border border-pkmn-border bg-white p-2">
                          <p className="text-[10px] font-bold uppercase text-pkmn-gray">HP</p>
                          <p className="text-sm font-black text-pkmn-text">{selectedCard.tcg_hp ?? '-'}</p>
                        </div>
                        <div className="border border-pkmn-border bg-white p-2">
                          <p className="text-[10px] font-bold uppercase text-pkmn-gray">Reg</p>
                          <p className="text-sm font-black text-pkmn-text">{selectedCard.regulation_mark || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSyncScope('selected'); setSyncModalOpen(true); }}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-pkmn-blue px-4 py-2.5 text-sm font-bold uppercase text-white hover:bg-pkmn-blue-dark"
                  >
                    <Sparkles size={16} /> Sync This Card
                  </button>
                </div>

                <div className="space-y-5 p-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FieldInput label="Set">
                      <input value={editForm.tcg_set_name} onChange={(event) => setEditForm({ ...editForm, tcg_set_name: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Card Number">
                      <input value={editForm.card_number} onChange={(event) => setEditForm({ ...editForm, card_number: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Printed Rarity">
                      <input value={editForm.rarity} onChange={(event) => setEditForm({ ...editForm, rarity: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Regulation Mark">
                      <input value={editForm.regulation_mark} onChange={(event) => setEditForm({ ...editForm, regulation_mark: event.target.value.toUpperCase() })} maxLength={5} className="w-full border border-pkmn-border px-3 py-2 text-sm uppercase focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Supertype">
                      <select value={editForm.tcg_supertype} onChange={(event) => setEditForm({ ...editForm, tcg_supertype: event.target.value })} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                        <option value="">Blank</option>
                        {supertypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </FieldInput>
                    <FieldInput label="Type">
                      <select value={editForm.tcg_type} onChange={(event) => setEditForm({ ...editForm, tcg_type: event.target.value })} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                        <option value="">Blank</option>
                        {typeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </FieldInput>
                    <FieldInput label="Stage">
                      <select value={editForm.tcg_stage} onChange={(event) => setEditForm({ ...editForm, tcg_stage: event.target.value })} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                        <option value="">Blank</option>
                        {stageOptions.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </FieldInput>
                    <FieldInput label="HP">
                      <input type="number" min="0" value={editForm.tcg_hp} onChange={(event) => setEditForm({ ...editForm, tcg_hp: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Standard Legal">
                      <select value={editForm.standard_legal} onChange={(event) => setEditForm({ ...editForm, standard_legal: event.target.value as CardEditForm['standard_legal'] })} className="w-full border border-pkmn-border bg-white px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20">
                        <option value="unknown">Unknown</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </FieldInput>
                    <FieldInput label="Release Date">
                      <input type="date" value={editForm.tcg_set_release_date} onChange={(event) => setEditForm({ ...editForm, tcg_set_release_date: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Card Traits">
                      <input value={editForm.tcg_subtypes} onChange={(event) => setEditForm({ ...editForm, tcg_subtypes: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                    <FieldInput label="Artist">
                      <input value={editForm.tcg_artist} onChange={(event) => setEditForm({ ...editForm, tcg_artist: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                    </FieldInput>
                  </div>
                  <FieldInput label="API ID">
                    <input value={editForm.api_id} onChange={(event) => setEditForm({ ...editForm, api_id: event.target.value })} className="w-full border border-pkmn-border px-3 py-2 text-sm focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-pkmn-blue/20" />
                  </FieldInput>
                  <button
                    type="button"
                    onClick={saveSelectedCard}
                    disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-2 bg-pkmn-blue px-4 py-3 text-sm font-bold uppercase text-white hover:bg-pkmn-blue-dark disabled:opacity-50"
                  >
                    <Save size={16} /> {saving ? 'Saving...' : 'Save Card Changes'}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      {syncModalOpen && (
        <ModalShell title="Sync Card Properties" onClose={() => setSyncModalOpen(false)}>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSyncScope('filtered')}
                className={`border px-3 py-3 text-sm font-black uppercase ${syncScope === 'filtered' ? 'border-pkmn-blue bg-pkmn-blue text-white' : 'border-pkmn-border bg-pkmn-bg text-pkmn-text hover:border-pkmn-blue/40'}`}
              >
                Filtered Cards
              </button>
              <button
                type="button"
                onClick={() => setSyncScope('selected')}
                disabled={!selectedCard}
                className={`border px-3 py-3 text-sm font-black uppercase disabled:opacity-40 ${syncScope === 'selected' ? 'border-pkmn-blue bg-pkmn-blue text-white' : 'border-pkmn-border bg-pkmn-bg text-pkmn-text hover:border-pkmn-blue/40'}`}
              >
                Selected Card
              </button>
            </div>

            <div className="border border-pkmn-border bg-pkmn-bg p-3 text-sm text-pkmn-gray-dark">
              {syncScope === 'selected' && selectedCard ? selectedCard.title : `${totalCount} filtered card${totalCount === 1 ? '' : 's'}`}
            </div>

            <div>
              <h3 className="mb-3 text-xs font-black uppercase tracking-[0.08rem] text-pkmn-gray">Properties</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SYNC_FIELD_OPTIONS.map(option => {
                  const active = syncFields.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleSyncField(option.key)}
                      className={`flex items-center justify-between gap-3 border px-3 py-2 text-left text-sm font-semibold ${active ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue' : 'border-pkmn-border bg-white text-pkmn-text hover:border-pkmn-blue/40'}`}
                    >
                      <span>{option.label}</span>
                      {active ? <CheckCircle size={16} /> : <span className="h-4 w-4 border border-pkmn-gray-mid" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={submitSync}
              disabled={syncing || syncFields.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 bg-pkmn-blue px-4 py-3 text-sm font-bold uppercase text-white hover:bg-pkmn-blue-dark disabled:opacity-50"
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing...' : 'Apply Sync'}
            </button>

            {lastSyncResults.length > 0 && (
              <div className="max-h-56 overflow-y-auto border border-pkmn-border">
                {lastSyncResults.slice(0, 20).map(result => (
                  <div key={`${result.item_id}-${result.status}`} className="flex items-start justify-between gap-3 border-b border-pkmn-border p-3 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-pkmn-text">{result.title}</p>
                      <p className="text-xs text-pkmn-gray">{result.message}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-1 text-[10px] font-black uppercase ${result.status === 'updated' ? 'bg-green-500/10 text-green-700' : result.status === 'unchanged' ? 'bg-pkmn-bg text-pkmn-gray-dark' : 'bg-pkmn-red/10 text-pkmn-red'}`}>
                      {result.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}
