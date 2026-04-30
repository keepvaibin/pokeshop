"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import { fetchTCGCardResults, getTCGCardResultKey, type TCGCard } from '@/app/lib/tcgCards';

import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { AlertCircle, X, ImagePlus, Pencil, Trash2, Eye, EyeOff, Plus, Search, ImageIcon, Package, Monitor, Smartphone, Star, ShoppingCart, Minus as MinusIcon, Plus as PlusIcon, ExternalLink, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import FallbackImage from '../../components/FallbackImage';
import toast from 'react-hot-toast';
import RichText from '../../components/RichText';
import DraggableImageList from '../../components/DraggableImageList';
import DraggableFileList from '../../components/DraggableFileList';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

const DATABASE_CARD_SEARCH_CACHE_TTL_MS = 60_000;

const quillModules = {
  toolbar: [
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ header: [1, 2, 3, false] }],
    ['link'],
    ['clean'],
  ],
  table: true,
};

const quillFormats = ['bold', 'italic', 'underline', 'strike', 'list', 'header', 'link', 'table'];

const INVENTORY_PAGE_SIZE = 24;

type PriceAutofillMeta = {
  sourceLabel: string;
  sourcePrice: number | null;
  tcgplayerUrl: string;
};

type LivePreviewState = {
  title: string;
  description: string;
  shortDescription: string;
  price: string;
  stock: string;
  maxPerUser: string;
  imageUrls: string[];
  tcgSetName?: string;
  rarityType?: string;
  tcgSupertype?: string;
  tcgType?: string;
  tcgStage?: string;
  tcgHp?: string;
  tcgArtist?: string;
  isHolofoil?: boolean;
};

function parseImportedPrice(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatPriceInputValue(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function roundSubDollarCardPrice(value: number) {
  if (value >= 0.65) return 0.75;
  if (value >= 0.30) return 0.50;
  return 0.25;
}

function roundToNearestHalfDollar(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 2) / 2).toFixed(2));
}

function buildPreviewImages(uploadedImageUrls: string[], importedImageUrl: string) {
  if (uploadedImageUrls.length > 0) {
    return uploadedImageUrls;
  }

  if (importedImageUrl) {
    return [importedImageUrl];
  }

  return [];
}

function formatAdminMaxPerUser(value: string) {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed) || parsed <= 0) {
    return 'No limit';
  }
  return String(parsed);
}

function normalizeDateInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const slashDate = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashDate) {
    const [, year, month, day] = slashDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const dashDate = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashDate) {
    const [, year, month, day] = dashDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return '';
}

function roundImportedCardPrice(marketPrice: number) {
  if (marketPrice > 0 && marketPrice < 1) {
    return formatPriceInputValue(roundSubDollarCardPrice(marketPrice));
  }

  return formatPriceInputValue(roundToNearestHalfDollar(marketPrice));
}

function itemUsesOutOfStockVisibility(item: { stock: number }) {
  return item.stock <= 0;
}

function isItemVisibleOnStorefront(item: { stock: number; is_active: boolean; show_when_out_of_stock: boolean }) {
  if (!item.is_active) {
    return false;
  }
  if (itemUsesOutOfStockVisibility(item)) {
    return item.show_when_out_of_stock;
  }
  return true;
}

export default function AdminInventoryPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  type InventoryCategory = {
    id: number;
    name: string;
    slug: string;
    subcategories: { id: number; name: string; slug: string }[];
    tags?: { id: number; name: string; slug: string }[];
  };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [showWhenOutOfStock, setShowWhenOutOfStock] = useState(true);
  const [maxPerUser, setMaxPerUser] = useState('');
  const [maxPerWeek, setMaxPerWeek] = useState('');
  const [maxTotalPerUser, setMaxTotalPerUser] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [previewBeforeRelease, setPreviewBeforeRelease] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePath, setImagePath] = useState(''); // for TCG-imported external URL
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Category + TCG fields
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [tcgType, setTcgType] = useState('');
  const [tcgStage, setTcgStage] = useState('');
  const [rarityType, setRarityType] = useState('');
  const [tcgSupertype, setTcgSupertype] = useState('');
  const [tcgSubtypes, setTcgSubtypes] = useState('');
  const [tcgHp, setTcgHp] = useState('');
  const [tcgArtist, setTcgArtist] = useState('');
  const [tcgRarity, setTcgRarity] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [tcgSetReleaseDate, setTcgSetReleaseDate] = useState('');
  // Edit modal category/TCG
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editTcgType, setEditTcgType] = useState('');
  const [editTcgStage, setEditTcgStage] = useState('');
  const [editRarityType, setEditRarityType] = useState('');
  const [editTcgSupertype, setEditTcgSupertype] = useState('');
  const [editTcgSubtypes, setEditTcgSubtypes] = useState('');
  const [editTcgHp, setEditTcgHp] = useState('');
  const [editTcgArtist, setEditTcgArtist] = useState('');
  const [editTcgSetName, setEditTcgSetName] = useState('');

  const TCG_TYPES   = ['Fire','Water','Grass','Psychic','Fighting','Darkness','Metal','Lightning','Fairy','Dragon','Colorless'];
  const TCG_STAGES  = ['Basic','Stage 1','Stage 2','Mega','BREAK','VMAX','VSTAR','Tera'];
  const TCG_RARITIES = ['Common','Uncommon','Rare','Holo Rare','Ultra Rare','Illustration Rare','Special Illustration Rare','Gold Secret Rare'];

  // Wizard state
  const [addWizardStep, setAddWizardStep] = useState<1|2>(1);
  const [addWizardCategorySlug, setAddWizardCategorySlug] = useState('');
  const [tcgSets, setTcgSets] = useState<{id: string; name: string}[]>([]);
  const [tcgSetsLoading, setTcgSetsLoading] = useState(false);
  const [tcgSetName, setTcgSetName] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [tcgQuery, setTcgQuery] = useState('');
  const [tcgResults, setTcgResults] = useState<TCGCard[]>([]);
  const [tcgLoading, setTcgLoading] = useState(false);
  const [tcgSearchAttempted, setTcgSearchAttempted] = useState(false);
  const [tcgSearchError, setTcgSearchError] = useState('');
  const tcgSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tcgSearchRequestIdRef = useRef(0);
  const [tcgSetsError, setTcgSetsError] = useState('');
  const [priceAutofillMeta, setPriceAutofillMeta] = useState<PriceAutofillMeta | null>(null);
  const [cardPriceAutofillLoading, setCardPriceAutofillLoading] = useState(false);
  const [importedApiId, setImportedApiId] = useState('');

  const searchTCG = useCallback(async (queryInput?: string, options?: { suppressErrorToast?: boolean }) => {
    const query = (queryInput ?? tcgQuery).trim();
    if (!query) {
      setTcgSearchAttempted(false);
      setTcgResults([]);
      setTcgSearchError('');
      return;
    }

    const requestId = ++tcgSearchRequestIdRef.current;
    setTcgLoading(true);
    setTcgSearchAttempted(true);
    setTcgSearchError('');
    try {
      const nextResults = await fetchTCGCardResults(query, { limit: 40 });
      // Ignore stale responses if a newer query was already fired.
      if (requestId !== tcgSearchRequestIdRef.current) {
        return;
      }
      setTcgResults(nextResults);
      setTcgSearchError('');
    } catch (error) {
      if (requestId !== tcgSearchRequestIdRef.current) {
        return;
      }
        setTcgResults([]);
        const message = axios.isAxiosError(error)
          ? error.response?.data?.error || error.message
          : 'TCG search failed';
        const nextError = message || 'TCG search failed';
        setTcgSearchError(nextError);
        if (!options?.suppressErrorToast) {
          toast.error(nextError);
        }
    } finally {
      if (requestId === tcgSearchRequestIdRef.current) {
        setTcgLoading(false);
      }
    }
  }, [tcgQuery]);

  useEffect(() => {
    if (addWizardCategorySlug !== 'cards') return;

    if (tcgSearchDebounceRef.current) {
      clearTimeout(tcgSearchDebounceRef.current);
      tcgSearchDebounceRef.current = null;
    }

    const query = tcgQuery.trim();
    if (query.length < 2) {
      setTcgSearchAttempted(false);
      setTcgResults([]);
      setTcgLoading(false);
      return;
    }

    tcgSearchDebounceRef.current = setTimeout(() => {
      void searchTCG(query, { suppressErrorToast: true });
    }, 700);

    return () => {
      if (tcgSearchDebounceRef.current) {
        clearTimeout(tcgSearchDebounceRef.current);
        tcgSearchDebounceRef.current = null;
      }
    };
  }, [tcgQuery, addWizardCategorySlug, searchTCG]);

  const autofillCardPriceFromDatabase = async () => {
    if (addWizardCategorySlug !== 'cards') return;

    const queryName = title.trim();
    if (!queryName) {
      toast.error('Enter a card name first.');
      return;
    }

    setCardPriceAutofillLoading(true);
    try {
      const q = [queryName, tcgSetName.trim()].filter(Boolean).join(' ');
      const results = await fetchTCGCardResults(q, { limit: 40 });
      if (results.length === 0) {
        toast.error('No matching cards found in the database.');
        return;
      }

      const normalizedSet = tcgSetName.trim().toLowerCase();
      const normalizedTitle = queryName.toLowerCase();
      const ranked = [...results].sort((a, b) => {
        const score = (card: TCGCard) => {
          let points = 0;
          const cardName = (card.name || '').toLowerCase();
          const cardSet = (card.set_name || '').toLowerCase();
          if (cardName === normalizedTitle) points += 40;
          else if (cardName.includes(normalizedTitle)) points += 20;
          if (normalizedSet && cardSet === normalizedSet) points += 35;
          else if (normalizedSet && cardSet.includes(normalizedSet)) points += 15;
          if (parseImportedPrice(card.market_price) !== null) points += 10;
          return points;
        };
        return score(b) - score(a);
      });

      const best = ranked.find((card) => parseImportedPrice(card.market_price) !== null);
      if (!best) {
        toast.error('Matching card found, but no market price is available.');
        return;
      }

      const parsedMarketPrice = parseImportedPrice(best.market_price);
      if (parsedMarketPrice === null) {
        toast.error('Matching card found, but no market price is available.');
        return;
      }

      setPrice(roundImportedCardPrice(parsedMarketPrice));
      if (!tcgSetName && best.set_name) {
        setTcgSetName(best.set_name);
      }
      setPriceAutofillMeta({
        sourceLabel: best.price_source || 'Trade Database',
        sourcePrice: parsedMarketPrice,
        tcgplayerUrl: best.tcgplayer_url || '',
      });
      toast.success(`Price autofilled from ${best.price_source || 'database'}.`);
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : 'Price autofill failed';
      toast.error(message || 'Price autofill failed');
    } finally {
      setCardPriceAutofillLoading(false);
    }
  };

  // fillFromTCGCard: fills form state without changing modal visibility (used in wizard)
  const fillFromTCGCard = (card: TCGCard) => {
    setTitle(card.name);
    setDescription(`<p>${card.name} from ${card.set_name}. Rarity: ${card.rarity}.</p>`);
    setShortDescription(card.short_description || `${card.set_name} - ${card.rarity}`);
    setImagePath(card.image_large || card.image_url);
    const parsedMarketPrice = parseImportedPrice(card.market_price);
    if (parsedMarketPrice !== null) {
      setPrice(roundImportedCardPrice(parsedMarketPrice));
    }
    setPriceAutofillMeta(
      parsedMarketPrice !== null || card.tcgplayer_url || card.price_source
        ? {
            sourceLabel: card.price_source || 'Latest market price',
            sourcePrice: parsedMarketPrice,
            tcgplayerUrl: card.tcgplayer_url || '',
          }
        : null,
    );
    setStock('1');
    setMaxPerUser(''); // unlimited for TCG cards
    if (card.tcg_type) setTcgType(card.tcg_type);
    if (card.tcg_stage) setTcgStage(card.tcg_stage);
    if (card.rarity_type) setRarityType(card.rarity_type);
    setTcgRarity(card.rarity || '');
    setCardNumber(card.card_number || card.number || '');
    setTcgSupertype(card.tcg_supertype || '');
    setTcgSubtypes(card.tcg_subtypes || '');
    setTcgHp(card.tcg_hp != null ? String(card.tcg_hp) : '');
    setTcgArtist(card.tcg_artist || '');
    setTcgSetName(card.set_name || '');
    setTcgSetReleaseDate(normalizeDateInputValue(card.set_release_date || ''));
    setImportedApiId(card.api_id || '');
    const cardsCat = categories.find(c => c.slug === 'cards');
    if (cardsCat) setSelectedCategoryId(String(cardsCat.id));
  };

  const fetchTCGSets = async () => {
    if (tcgSets.length > 0) return;
    setTcgSetsLoading(true);
    setTcgSetsError('');
    try {
      const r = await axios.get(`${API}/api/inventory/tcg-sets/`);
      const apiSets = r.data.results || [];
      setTcgSets([{ id: 'misc', name: 'Misc.' }, ...apiSets]);
      setTcgSetsError('');
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : 'Failed to load TCG sets.';
      setTcgSetsError(message || 'Failed to load TCG sets.');
    }
    finally { setTcgSetsLoading(false); }
  };

  // Inventory table state
  interface InventoryItem {
    id: number;
    title: string;
    slug: string;
    price: string;
    stock: number;
    show_when_out_of_stock: boolean;
    max_per_user: number;
    max_per_week: number | null;
    max_total_per_user: number | null;
    is_active: boolean;
    description: string;
    short_description: string;
    published_at: string | null;
    preview_before_release: boolean;
    scheduled_drops: { id: number; item: number; quantity: number; drop_time: string; is_processed: boolean; created_at: string }[];
    images: { id: number; url: string; position: number }[];
    image_path: string;
    category: number | null;
    category_slug?: string;
    subcategory: number | null;
    tcg_type: string | null;
    tcg_stage: string | null;
    rarity_type: string | null;
    tcg_supertype: string | null;
    tcg_subtypes: string | null;
    tcg_hp: number | null;
    tcg_artist: string | null;
    tcg_set_name: string | null;
    rarity?: string | null;
    card_number?: string | null;
    api_id?: string | null;
    tcg_set_release_date?: string | null;
  }
  type PaginatedInventoryResponse = {
    count: number;
    next: string | null;
    previous: string | null;
    results: InventoryItem[];
  };
  type InventoryCardSearchResult = {
    card: TCGCard;
    inventory_item: InventoryItem | null;
    exists: boolean;
    action: 'add_stock' | 'add_to_database';
  };
  type InventoryCategoryFilter = 'all' | 'cards' | 'boxes' | 'accessories';
  interface PricingWorkflowManualCard {
    item_id: number;
    slug: string;
    title: string;
    current_price: string;
    set_name: string;
    reason: string;
    tcgplayer_search_url: string;
  }
  interface PricingWorkflowChange {
    item_id: number;
    slug: string;
    title: string;
    previous_value: string;
    current_market_value: string;
    proposed_new_value: string;
    set_name: string;
    tcgplayer_url: string;
  }
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [databaseCardQuery, setDatabaseCardQuery] = useState('');
  const [databaseCardResults, setDatabaseCardResults] = useState<InventoryCardSearchResult[]>([]);
  const [databaseCardLoading, setDatabaseCardLoading] = useState(false);
  const [databaseCardSearchAttempted, setDatabaseCardSearchAttempted] = useState(false);
  const [databaseCardSearchError, setDatabaseCardSearchError] = useState('');
  const databaseCardSearchRequestIdRef = useRef(0);
  const databaseCardSearchCacheRef = useRef(new Map<string, { expiresAt: number; results: InventoryCardSearchResult[] }>());
  const databaseCardSearchInflightRef = useRef(new Map<string, Promise<InventoryCardSearchResult[]>>());
  const [addStockTarget, setAddStockTarget] = useState<InventoryCardSearchResult | null>(null);
  const [addStockQuantity, setAddStockQuantity] = useState('1');
  const [addStockSaving, setAddStockSaving] = useState(false);
  const [inventoryPagination, setInventoryPagination] = useState({ count: 0, next: null as string | null, previous: null as string | null });
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState<InventoryCategoryFilter>('all');
  const [pricingWorkflowOpen, setPricingWorkflowOpen] = useState(false);
  const [pricingWorkflowLoading, setPricingWorkflowLoading] = useState(false);
  const [pricingWorkflowApplying, setPricingWorkflowApplying] = useState(false);
  const [pricingWorkflowManualCards, setPricingWorkflowManualCards] = useState<PricingWorkflowManualCard[]>([]);
  const [pricingWorkflowChanges, setPricingWorkflowChanges] = useState<PricingWorkflowChange[]>([]);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editMaxPerUser, setEditMaxPerUser] = useState('');
  const [editMaxPerWeek, setEditMaxPerWeek] = useState('');
  const [editMaxTotalPerUser, setEditMaxTotalPerUser] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editShortDescription, setEditShortDescription] = useState('');
  const [editPublishedAt, setEditPublishedAt] = useState('');
  const [editPreviewBeforeRelease, setEditPreviewBeforeRelease] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);
  const [editSubcategoryId, setEditSubcategoryId] = useState('');
  const [editImages, setEditImages] = useState<File[]>([]);
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // Scheduled drops state for edit modal
  const [editDrops, setEditDrops] = useState<InventoryItem['scheduled_drops']>([]);
  const [newDropQty, setNewDropQty] = useState('');
  const [newDropTime, setNewDropTime] = useState('');
  const [dropSaving, setDropSaving] = useState(false);
  const [previewAdd, setPreviewAdd] = useState(false);
  const [previewEdit, setPreviewEdit] = useState(false);
  const [livePreview, setLivePreview] = useState<LivePreviewState | null>(null);
  const [livePreviewTab, setLivePreviewTab] = useState<'quick' | 'full'>('quick');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentInventoryPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const searchInventoryCards = async (queryInput?: string, options?: { suppressToast?: boolean }) => {
    const query = (queryInput ?? databaseCardQuery).trim();
    if (query.length < 2) {
      setDatabaseCardSearchAttempted(false);
      setDatabaseCardResults([]);
      setDatabaseCardSearchError('');
      return;
    }

    const cacheKey = `${query.toLowerCase().replace(/\s+/g, ' ')}|24`;
    const cached = databaseCardSearchCacheRef.current.get(cacheKey);
    const requestId = ++databaseCardSearchRequestIdRef.current;
    setDatabaseCardSearchAttempted(true);
    setDatabaseCardSearchError('');

    if (cached && cached.expiresAt > Date.now()) {
      setDatabaseCardResults(cached.results);
      setDatabaseCardLoading(false);
      return;
    }

    setDatabaseCardLoading(true);
    let searchRequest = databaseCardSearchInflightRef.current.get(cacheKey);
    if (!searchRequest) {
      searchRequest = axios.get(`${API}/api/inventory/tcg-inventory-search/`, {
        headers,
        params: { q: query, limit: 24 },
      }).then(response => (Array.isArray(response.data?.results) ? response.data.results : []));
      databaseCardSearchInflightRef.current.set(cacheKey, searchRequest);
    }

    try {
      const results = await searchRequest;
      if (requestId !== databaseCardSearchRequestIdRef.current) return;
      databaseCardSearchCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + DATABASE_CARD_SEARCH_CACHE_TTL_MS,
        results,
      });
      setDatabaseCardResults(results);
    } catch (error) {
      if (requestId !== databaseCardSearchRequestIdRef.current) return;
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.error || error.response?.data?.detail || error.message
        : 'Card database search failed.';
      setDatabaseCardResults([]);
      setDatabaseCardSearchError(errorMessage || 'Card database search failed.');
      if (!options?.suppressToast) {
        toast.error(errorMessage || 'Card database search failed.');
      }
    } finally {
      if (databaseCardSearchInflightRef.current.get(cacheKey) === searchRequest) {
        databaseCardSearchInflightRef.current.delete(cacheKey);
      }
      if (requestId === databaseCardSearchRequestIdRef.current) {
        setDatabaseCardLoading(false);
      }
    }
  };

  const openAddCardFromDatabaseSearch = (card: TCGCard) => {
    const cardsCat = categories.find(c => c.slug === 'cards');
    resetAddForm();
    setAddWizardStep(2);
    setAddWizardCategorySlug('cards');
    if (cardsCat) setSelectedCategoryId(String(cardsCat.id));
    fetchTCGSets();
    fillFromTCGCard(card);
    setShowAddModal(true);
  };

  const submitAddStock = async () => {
    const item = addStockTarget?.inventory_item;
    const quantity = Number.parseInt(addStockQuantity, 10);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Enter a stock quantity greater than zero.');
      return;
    }

    setAddStockSaving(true);
    try {
      const response = await axios.patch(
        `${API}/api/inventory/items/${item.slug}/`,
        { stock: item.stock + quantity },
        { headers },
      );
      const updatedItem = response.data as InventoryItem;
      setItems(previous => previous.map(existing => existing.id === updatedItem.id ? { ...existing, ...updatedItem } : existing));
      setDatabaseCardResults(previous => previous.map(result => (
        result.inventory_item?.id === updatedItem.id
          ? { ...result, inventory_item: { ...result.inventory_item, ...updatedItem }, exists: true, action: 'add_stock' }
          : result
      )));
      setAddStockTarget(null);
      setAddStockQuantity('1');
      fetchItems();
      toast.success(`Added ${quantity} stock to ${updatedItem.title}.`);
    } catch {
      toast.error('Failed to add stock.');
    } finally {
      setAddStockSaving(false);
    }
  };

  const fetchItems = (categoryFilter: InventoryCategoryFilter = inventoryCategoryFilter, page = currentInventoryPage) => {
    setItemsLoading(true);
    const params: Record<string, string | number> = { page };
    if (categoryFilter !== 'all') {
      params.category = categoryFilter;
    }
    axios
      .get(`${API}/api/inventory/items/`, {
        headers,
        params,
      })
      .then(r => {
        const data = r.data as PaginatedInventoryResponse | InventoryItem[];
        if (Array.isArray(data)) {
          setItems(data);
          setInventoryPagination({ count: data.length, next: null, previous: null });
          return;
        }
        setItems(data.results ?? []);
        setInventoryPagination({
          count: Number(data.count ?? 0),
          next: data.next ?? null,
          previous: data.previous ?? null,
        });
      })
      .catch(() => {
        setItems([]);
        setInventoryPagination({ count: 0, next: null, previous: null });
      })
      .finally(() => setItemsLoading(false));
  };

  const toggleItemStorefrontVisibility = async (item: InventoryItem) => {
    const nowVisible = isItemVisibleOnStorefront(item);
    const nextVisible = !nowVisible;
    try {
      const payload: Record<string, boolean | string> = {
        is_active: nextVisible,
        show_when_out_of_stock: nextVisible,
      };

      // If this is still a draft, publishing now prevents "Product not found" after enabling visibility.
      if (nextVisible && !item.published_at) {
        payload.published_at = new Date().toISOString();
      }

      const response = await axios.patch(
        `${API}/api/inventory/items/${item.slug}/`,
        payload,
        { headers },
      );

      setItems((previous) => previous.map((existingItem) => (
        existingItem.id === item.id
          ? { ...existingItem, ...response.data }
          : existingItem
      )));

      fetchItems(inventoryCategoryFilter);
      if (response.data?.is_active !== nextVisible) {
        toast.error('Visibility update failed on server. Please retry from Edit and save.');
      } else {
        toast.success(nowVisible ? 'Item hidden from storefront' : 'Item visible on storefront');
      }
    } catch {
      toast.error('Failed to update storefront visibility.');
    }
  };

  useEffect(() => {
    const fromUrl = (searchParams.get('category') || 'all') as InventoryCategoryFilter;
    const next = ['all', 'cards', 'boxes', 'accessories'].includes(fromUrl) ? fromUrl : 'all';
    if (next !== inventoryCategoryFilter) {
      setInventoryCategoryFilter(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setCategoryFilterAndUrl = (value: InventoryCategoryFilter) => {
    setInventoryCategoryFilter(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') params.delete('category');
    else params.set('category', value);
    params.delete('page');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const filteredItems = useMemo(() => {
    if (inventoryCategoryFilter === 'all') return items;
    const categoryIdToSlug = new Map(categories.map((cat) => [cat.id, cat.slug]));
    return items.filter((item) => {
      const resolvedSlug = item.category_slug || (item.category ? categoryIdToSlug.get(item.category) : undefined);
      return resolvedSlug === inventoryCategoryFilter;
    });
  }, [inventoryCategoryFilter, items, categories]);

  const totalInventoryPages = Math.max(1, Math.ceil(inventoryPagination.count / INVENTORY_PAGE_SIZE));
  const inventoryPageStart = inventoryPagination.count === 0 ? 0 : (currentInventoryPage - 1) * INVENTORY_PAGE_SIZE + 1;
  const inventoryPageEnd = inventoryPagination.count === 0 ? 0 : Math.min(inventoryPagination.count, inventoryPageStart + filteredItems.length - 1);

  const setInventoryPageAndUrl = (page: number) => {
    const safePage = Math.min(Math.max(1, page), totalInventoryPages);
    const params = new URLSearchParams(searchParams.toString());
    if (safePage === 1) params.delete('page');
    else params.set('page', String(safePage));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const runPricingWorkflow = async () => {
    setPricingWorkflowOpen(true);
    setPricingWorkflowLoading(true);
    try {
      const response = await axios.get(`${API}/api/inventory/cards/pricing-workflow/`, { headers });
      setPricingWorkflowManualCards(response.data.manual_cards || []);
      setPricingWorkflowChanges(response.data.changes || []);
    } catch {
      toast.error('Failed to load pricing workflow preview.');
      setPricingWorkflowManualCards([]);
      setPricingWorkflowChanges([]);
    } finally {
      setPricingWorkflowLoading(false);
    }
  };

  const applyPricingWorkflow = async () => {
    setPricingWorkflowApplying(true);
    try {
      const response = await axios.post(`${API}/api/inventory/cards/pricing-workflow/apply/`, {}, { headers });
      toast.success(`Updated ${response.data.updated ?? 0} card prices.`);
      await runPricingWorkflow();
      fetchItems();
    } catch {
      toast.error('Failed to apply pricing workflow.');
    } finally {
      setPricingWorkflowApplying(false);
    }
  };

  useEffect(() => {
    axios.get(`${API}/api/inventory/categories/`)
      .then(r => setCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchItems(inventoryCategoryFilter, currentInventoryPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, inventoryCategoryFilter, currentInventoryPage]);

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const imageUrlsRef = useRef<string[]>([]);
  imageUrlsRef.current = imageUrls;

  // Revoke blob URLs on unmount only
  useEffect(() => {
    return () => { imageUrlsRef.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  const resetAddForm = () => {
    imageUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    setTitle('');
    setDescription('');
    setShortDescription('');
    setPrice('');
    setStock('');
    setShowWhenOutOfStock(true);
    setMaxPerUser('');
    setMaxPerWeek('');
    setMaxTotalPerUser('');
    setPublishedAt('');
    setPreviewBeforeRelease(false);
    setImageFiles([]);
    setImageUrls([]);
    setImagePath('');
    setSelectedCategoryId('');
    setSelectedSubcategoryId('');
    setSelectedTagNames([]);
    setNewTagName('');
    setTcgType('');
    setTcgStage('');
    setRarityType('');
    setTcgSupertype('');
    setTcgSubtypes('');
    setTcgHp('');
    setTcgArtist('');
    setTcgRarity('');
    setCardNumber('');
    setTcgSetReleaseDate('');
    setTcgSetName('');
    setImportedApiId('');
    setTcgQuery('');
    setTcgResults([]);
    setTcgLoading(false);
    setTcgSearchAttempted(false);
    setTcgSearchError('');
    setTcgSetsError('');
    setPriceAutofillMeta(null);
    setPreviewAdd(false);
    setStatus('idle');
    setMessage('');
  };

  const closeAddWizard = () => {
    resetAddForm();
    setShowAddModal(false);
    setAddWizardStep(1);
    setAddWizardCategorySlug('');
  };

  const openAddWizard = () => {
    resetAddForm();
    setAddWizardStep(1);
    setAddWizardCategorySlug('');
    setShowAddModal(true);
  };

  const openCardImportWizard = () => {
    const cardsCat = categories.find(c => c.slug === 'cards');
    resetAddForm();
    setAddWizardStep(2);
    setAddWizardCategorySlug('cards');
    if (cardsCat) setSelectedCategoryId(String(cardsCat.id));
    fetchTCGSets();
    setShowAddModal(true);
  };

  const openWizardCategory = (category: InventoryCategory) => {
    resetAddForm();
    setAddWizardCategorySlug(category.slug);
    setSelectedCategoryId(String(category.id));
    if (category.slug === 'cards' || category.slug === 'boxes' || category.slug === 'accessories') fetchTCGSets();
    setAddWizardStep(2);
  };

  const addCustomTag = () => {
    const normalizedTag = newTagName.trim().replace(/\s+/g, ' ');
    if (!normalizedTag) return;
    if (selectedTagNames.some(tag => tag.toLowerCase() === normalizedTag.toLowerCase())) {
      setNewTagName('');
      return;
    }
    setSelectedTagNames(prev => [...prev, normalizedTag]);
    setNewTagName('');
  };

  const toggleSelectedTag = (tagName: string) => {
    setSelectedTagNames(prev => (
      prev.includes(tagName) ? prev.filter(tag => tag !== tagName) : [...prev, tagName]
    ));
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const newUrls = newFiles.map(f => URL.createObjectURL(f));
    setImageFiles(prev => [...prev, ...newFiles]);
    setImageUrls(prev => [...prev, ...newUrls]);
  };

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(imageUrls[idx]);
    setImageFiles(prev => prev.filter((_, i) => i !== idx));
    setImageUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCategoryId) {
      toast.error('Please select a category.');
      return;
    }
    setStatus('saving');
    setMessage('');

    try {
      const token = localStorage.getItem('access_token');
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('short_description', shortDescription);
      formData.append('stock', stock || '0');
      formData.append('show_when_out_of_stock', showWhenOutOfStock ? 'true' : 'false');
      formData.append('max_per_user', maxPerUser || '0');
      if (maxPerWeek) formData.append('max_per_week', maxPerWeek);
      if (maxTotalPerUser) formData.append('max_total_per_user', maxTotalPerUser);
      formData.append('is_active', 'true');
      formData.append('category', selectedCategoryId);
      if (price) formData.append('price', price);
      if (publishedAt) formData.append('published_at', new Date(publishedAt).toISOString());
      formData.append('preview_before_release', previewBeforeRelease ? 'true' : 'false');
      if (imagePath) formData.append('image_path', imagePath);
      if (importedApiId) formData.append('api_id', importedApiId);
      if (tcgRarity) formData.append('rarity', tcgRarity);
      if (cardNumber) formData.append('card_number', cardNumber);
      if (tcgType) formData.append('tcg_type', tcgType);
      if (tcgStage) formData.append('tcg_stage', tcgStage);
      if (rarityType) formData.append('rarity_type', rarityType);
      if (tcgSupertype) formData.append('tcg_supertype', tcgSupertype);
      if (tcgSubtypes) formData.append('tcg_subtypes', tcgSubtypes);
      if (tcgHp) formData.append('tcg_hp', tcgHp);
      if (tcgArtist) formData.append('tcg_artist', tcgArtist);
      if (tcgSetName) formData.append('tcg_set_name', tcgSetName);
      if (tcgSetReleaseDate) formData.append('tcg_set_release_date', tcgSetReleaseDate);
      if (selectedSubcategoryId) formData.append('subcategory', selectedSubcategoryId);
      if (selectedTagNames.length > 0) formData.append('tag_names', JSON.stringify(selectedTagNames));
      imageFiles.forEach(f => formData.append('images', f));

      const response = await axios.post(`${API}/api/inventory/items/`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setStatus('success');
      setMessage(`Created item: ${response.data.title} (slug: ${response.data.slug})`);
      toast.success(`Item "${response.data.title}" created!`);
      closeAddWizard();
      fetchItems();
      if (databaseCardQuery.trim()) {
        void searchInventoryCards(databaseCardQuery, { suppressToast: true });
      }
    } catch {
      setStatus('error');
      setMessage('Unable to create item. Please check your inputs and try again.');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-pkmn-blue">Admin Inventory</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-pkmn-text">Manage Inventory</h1>
            <p className="mt-2 text-pkmn-gray max-w-2xl">
              View, edit, and manage your store items.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={openCardImportWizard}
              className="inline-flex items-center gap-2 bg-pkmn-blue px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-pkmn-blue-dark active:scale-95"
            >
              Import Card from Database
            </button>
            <button
              onClick={openAddWizard}
              className="inline-flex items-center gap-2 bg-pkmn-blue px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-pkmn-blue-dark active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Add New Item
            </button>
          </div>
        </div>

        <div className="mb-6 bg-white border border-pkmn-border p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-pkmn-text">Card Database Search</h2>
              <p className="mt-1 text-sm text-pkmn-gray">Find a card, then add stock or create the inventory item with the card data filled in.</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void searchInventoryCards();
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="text"
              value={databaseCardQuery}
              onChange={(event) => {
                setDatabaseCardQuery(event.target.value);
                setDatabaseCardSearchAttempted(false);
                setDatabaseCardSearchError('');
              }}
              placeholder="Search cards by name, set, or number"
              className="min-w-0 flex-1 border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={databaseCardLoading || databaseCardQuery.trim().length < 2}
              className="inline-flex items-center justify-center gap-2 bg-pkmn-blue px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pkmn-blue-dark disabled:cursor-not-allowed disabled:bg-pkmn-blue/50"
            >
              <Search size={16} />
              {databaseCardLoading ? 'Searching...' : 'Search'}
            </button>
          </form>

          {databaseCardSearchError && (
            <p className="mt-3 text-sm font-medium text-pkmn-red">{databaseCardSearchError}</p>
          )}

          {databaseCardResults.length > 0 && (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {databaseCardResults.map((result) => {
                const card = result.card;
                const inventoryItem = result.inventory_item;
                const imageUrl = card.image_small || card.image_url || card.image_large;
                const marketPrice = parseImportedPrice(card.market_price);
                return (
                  <div key={getTCGCardResultKey(card)} className="flex gap-3 border border-pkmn-border bg-pkmn-bg p-3">
                    <div className="h-28 w-20 shrink-0 overflow-hidden bg-white flex items-center justify-center">
                      {imageUrl ? (
                        <img src={imageUrl} alt={card.name} className="h-full w-full object-contain" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-pkmn-gray" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-pkmn-text line-clamp-2">{card.name}</p>
                          <p className="mt-0.5 text-xs text-pkmn-gray-dark line-clamp-2">
                            {[card.set_name, card.card_number || card.number ? `#${card.card_number || card.number}` : '', card.rarity || card.tcg_subtypes].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {inventoryItem ? (
                          <span className="shrink-0 bg-green-500/15 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-green-700">Stock {inventoryItem.stock}</span>
                        ) : (
                          <span className="shrink-0 bg-pkmn-blue/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-pkmn-blue">New</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-pkmn-gray-dark">
                        {card.tcg_type && <span className="border border-pkmn-border bg-white px-2 py-0.5">{card.tcg_type}</span>}
                        {card.tcg_stage && <span className="border border-pkmn-border bg-white px-2 py-0.5">{card.tcg_stage}</span>}
                        {card.tcg_supertype && <span className="border border-pkmn-border bg-white px-2 py-0.5">{card.tcg_supertype}</span>}
                        {marketPrice !== null && <span className="border border-pkmn-border bg-white px-2 py-0.5">Market ${marketPrice.toFixed(2)}</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {inventoryItem ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAddStockTarget(result);
                              setAddStockQuantity('1');
                            }}
                            className="inline-flex items-center gap-1.5 bg-pkmn-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-pkmn-blue-dark"
                          >
                            <PlusIcon size={14} /> Add Stock
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openAddCardFromDatabaseSearch(card)}
                            className="inline-flex items-center gap-1.5 bg-pkmn-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-pkmn-blue-dark"
                          >
                            <PlusIcon size={14} /> Add to Database
                          </button>
                        )}
                        {card.tcgplayer_url && (
                          <a
                            href={card.tcgplayer_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-pkmn-blue hover:text-pkmn-blue-dark"
                          >
                            <ExternalLink size={13} /> TCGPlayer
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {databaseCardSearchAttempted && !databaseCardLoading && databaseCardResults.length === 0 && databaseCardQuery.trim() && !databaseCardSearchError && (
            <div className="mt-5 border border-dashed border-pkmn-border bg-pkmn-bg px-4 py-8 text-center text-sm text-pkmn-gray">
              No card database results found.
            </div>
          )}
        </div>

        {/* Inventory Data Table */}
        <div className="bg-white border border-pkmn-border p-8 shadow-sm">
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-pkmn-text">Current Inventory</h2>
          </div>
          {inventoryCategoryFilter === 'cards' && (
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={runPricingWorkflow}
                className="inline-flex items-center bg-pkmn-blue px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06rem] text-white transition hover:bg-pkmn-blue-dark"
              >
                Run Pricing Workflow
              </button>
            </div>
          )}
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-2">
              {([
                { value: 'all', label: 'All' },
                { value: 'cards', label: 'Cards' },
                { value: 'boxes', label: 'Boxes' },
                { value: 'accessories', label: 'Accessories' },
              ] as Array<{ value: InventoryCategoryFilter; label: string }>).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCategoryFilterAndUrl(option.value)}
                  className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06rem] transition-colors ${inventoryCategoryFilter === option.value ? 'bg-pkmn-blue text-white' : 'border border-pkmn-border bg-pkmn-bg text-pkmn-gray-dark hover:border-pkmn-blue/40'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {itemsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
              <span className="ml-3 text-pkmn-gray">Loading items...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-pkmn-gray-dark mx-auto mb-4" />
              <p className="text-pkmn-gray mb-4">
                {items.length === 0
                  ? 'No items yet. Add your first item to get started!'
                  : 'No items match the selected category filter.'}
              </p>
              <button
                onClick={openAddWizard}
                className="inline-flex items-center gap-2 bg-pkmn-blue px-6 py-3 text-sm font-semibold text-white hover:bg-pkmn-blue-dark transition"
              >
                <Plus className="w-4 h-4" />
                {items.length === 0 ? 'Add Your First Item' : 'Add New Item'}
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-pkmn-bg border-b border-pkmn-border">
                    <tr>
                      <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Image</th>
                      <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Title</th>
                      <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Price</th>
                      <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Stock</th>
                      <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Visibility</th>
                      <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Status</th>
                      <th className="text-right py-3 px-2 font-semibold text-pkmn-gray">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const storefrontVisible = isItemVisibleOnStorefront(item);

                      return (
                      <tr key={item.id} className={`border-b border-pkmn-border even:bg-pkmn-bg/50 even: hover:bg-pkmn-bg transition-colors ${!storefrontVisible ? 'opacity-60' : ''}`}>
                        <td className="py-3 px-2">
                          {item.images?.[0]?.url || item.image_path ? (
                            <FallbackImage src={item.images?.[0]?.url || item.image_path} alt="" className="w-10 h-10 object-cover rounded-md" fallbackClassName="w-10 h-10 bg-pkmn-bg rounded-md flex items-center justify-center text-pkmn-gray-dark" fallbackSize={16} />
                          ) : (
                            <div className="w-10 h-10 bg-pkmn-bg rounded-md flex items-center justify-center text-pkmn-gray-dark"><ImageIcon size={16} /></div>
                          )}
                        </td>
                        <td className="py-3 px-2 font-medium text-pkmn-text">{item.title}</td>
                        <td className="py-3 px-2 text-pkmn-gray-dark">${Number(item.price).toFixed(2)}</td>
                        <td className="py-3 px-2 text-pkmn-gray-dark">{item.stock}</td>
                        <td className="py-3 px-2">
                          {(() => {
                            if (!item.published_at) return <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold bg-pkmn-bg text-pkmn-gray">Draft</span>;
                            if (new Date(item.published_at) > new Date()) return <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold bg-pkmn-blue/15 text-pkmn-blue">Scheduled</span>;
                            return <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold bg-green-500/15 text-green-600">Live</span>;
                          })()}
                        </td>
                        <td className="py-3 px-2">
                          {storefrontVisible
                            ? item.stock <= 0
                              ? <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-700">OOS - Visible</span>
                              : <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold bg-green-500/15 text-green-600">Active</span>
                            : <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold bg-pkmn-bg text-pkmn-gray">Hidden</span>
                          }
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <a
                              href={`/product/${item.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-pkmn-gray-dark hover:bg-pkmn-bg rounded-md transition-colors"
                              title="Open product page"
                            >
                              <ExternalLink size={16} />
                            </a>
                            <button
                              onClick={() => {
                                setEditItem(item);
                                setEditTitle(item.title);
                                setEditPrice(String(item.price));
                                setEditStock(String(item.stock));
                                setEditMaxPerUser(item.max_per_user > 0 ? String(item.max_per_user) : '');
                                setEditMaxPerWeek(item.max_per_week ? String(item.max_per_week) : '');
                                setEditMaxTotalPerUser(item.max_total_per_user ? String(item.max_total_per_user) : '');
                                setEditDescription(item.description);
                                setEditShortDescription(item.short_description || '');
                                setEditPublishedAt(item.published_at ? item.published_at.slice(0, 16) : '');
                                setEditPreviewBeforeRelease(item.preview_before_release ?? false);
                                setEditDrops(item.scheduled_drops ?? []);
                                setNewDropQty(''); setNewDropTime('');
                                setEditImages([]);
                                setEditImageUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
                                setEditCategoryId(item.category ? String(item.category) : '');
                                setEditSubcategoryId(item.subcategory ? String(item.subcategory) : '');
                                setEditIsActive(item.is_active ?? true);
                                setEditTcgType(item.tcg_type || '');
                                setEditTcgStage(item.tcg_stage || '');
                                setEditRarityType(item.rarity_type || '');
                                setEditTcgSupertype(item.tcg_supertype || '');
                                setEditTcgSubtypes(item.tcg_subtypes || '');
                                setEditTcgHp(item.tcg_hp != null ? String(item.tcg_hp) : '');
                                setEditTcgArtist(item.tcg_artist || '');
                                setEditTcgSetName(item.tcg_set_name || '');
                                fetchTCGSets();
                              }}
                              className="p-1.5 text-pkmn-blue hover:bg-pkmn-blue/10 rounded-md transition-colors"
                              title="Edit"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => toggleItemStorefrontVisibility(item)}
                              className={`p-1.5 rounded-md transition-colors ${storefrontVisible ? 'text-orange-600 hover:bg-orange-500/10' : 'text-green-600 hover:bg-green-500/10'}`}
                              title={storefrontVisible ? 'Hide from storefront' : 'Show on storefront'}
                            >
                              {storefrontVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(item.slug)}
                              className="p-1.5 text-pkmn-red hover:bg-pkmn-red/10 rounded-md transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>

              {inventoryPagination.count > INVENTORY_PAGE_SIZE && (
                <div className="mt-5 flex flex-col gap-3 border-t border-pkmn-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-pkmn-gray-dark">
                    Showing {inventoryPageStart}-{inventoryPageEnd} of {inventoryPagination.count} items
                  </p>
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setInventoryPageAndUrl(1)}
                      disabled={currentInventoryPage <= 1}
                      className="inline-flex h-9 w-9 items-center justify-center border border-pkmn-border bg-white text-pkmn-gray-dark transition hover:border-pkmn-blue hover:text-pkmn-blue disabled:cursor-not-allowed disabled:opacity-40"
                      title="First page"
                    >
                      <ChevronsLeft size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInventoryPageAndUrl(currentInventoryPage - 1)}
                      disabled={currentInventoryPage <= 1}
                      className="inline-flex h-9 items-center gap-1 border border-pkmn-border bg-white px-3 text-sm font-semibold text-pkmn-gray-dark transition hover:border-pkmn-blue hover:text-pkmn-blue disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft size={16} /> Previous
                    </button>
                    <span className="min-w-24 text-center text-sm font-semibold text-pkmn-text">
                      Page {currentInventoryPage} of {totalInventoryPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setInventoryPageAndUrl(currentInventoryPage + 1)}
                      disabled={currentInventoryPage >= totalInventoryPages}
                      className="inline-flex h-9 items-center gap-1 border border-pkmn-border bg-white px-3 text-sm font-semibold text-pkmn-gray-dark transition hover:border-pkmn-blue hover:text-pkmn-blue disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next <ChevronRight size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInventoryPageAndUrl(totalInventoryPages)}
                      disabled={currentInventoryPage >= totalInventoryPages}
                      className="inline-flex h-9 w-9 items-center justify-center border border-pkmn-border bg-white text-pkmn-gray-dark transition hover:border-pkmn-blue hover:text-pkmn-blue disabled:cursor-not-allowed disabled:opacity-40"
                      title="Last page"
                    >
                      <ChevronsRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {addStockTarget?.inventory_item && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setAddStockTarget(null)}>
            <div className="w-full max-w-sm border border-pkmn-border bg-white p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-pkmn-text">Add Stock</h3>
                  <p className="mt-1 text-sm text-pkmn-gray">{addStockTarget.inventory_item.title}</p>
                </div>
                <button type="button" onClick={() => setAddStockTarget(null)} className="p-1.5 hover:bg-pkmn-bg transition-colors">
                  <X size={20} />
                </button>
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-pkmn-gray-dark">Quantity to add</span>
                <input
                  type="number"
                  min={1}
                  value={addStockQuantity}
                  onChange={event => setAddStockQuantity(event.target.value)}
                  className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  autoFocus
                />
              </label>
              <p className="mt-2 text-xs text-pkmn-gray">
                Current stock: {addStockTarget.inventory_item.stock}. New stock: {addStockTarget.inventory_item.stock + Math.max(0, Number.parseInt(addStockQuantity, 10) || 0)}.
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setAddStockTarget(null)}
                  className="flex-1 border border-pkmn-border py-2.5 text-sm font-semibold text-pkmn-gray-dark transition hover:bg-pkmn-bg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitAddStock}
                  disabled={addStockSaving}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 bg-pkmn-blue py-2.5 text-sm font-semibold text-white transition hover:bg-pkmn-blue-dark disabled:bg-pkmn-blue/50"
                >
                  <PlusIcon size={16} />
                  {addStockSaving ? 'Adding...' : 'Add Stock'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add New Item Wizard */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeAddWizard}>
            <div className={`bg-white border border-pkmn-border shadow-2xl w-full max-h-[90vh] overflow-y-auto p-6 ${addWizardStep === 1 ? 'max-w-md' : 'max-w-lg'}`} onClick={e => e.stopPropagation()}>

              {/* ─── STEP 1: Choose Category ─── */}
              {addWizardStep === 1 && (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h3 className="text-xl font-bold text-pkmn-text">Add Item</h3>
                      <p className="text-sm text-pkmn-gray mt-0.5">Choose a category to continue</p>
                    </div>
                    <button onClick={closeAddWizard} className="p-1.5 hover:bg-pkmn-bg transition-colors"><X size={20} /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { slug: 'cards', label: 'TCG Cards', desc: 'Pokémon singles from the database' },
                      { slug: 'boxes', label: 'Boxes', desc: 'Booster boxes, bundles & packs' },
                      { slug: 'accessories', label: 'Accessories', desc: 'Sleeves, binders, playmats' },
                    ].map(({ slug, label, desc }) => {
                      const cat = categories.find(c => c.slug === slug);
                      if (!cat) return null;
                      return (
                        <button
                          key={slug}
                          onClick={() => openWizardCategory(cat)}
                          className="text-left border border-pkmn-border p-4 hover:border-pkmn-blue hover:bg-pkmn-bg transition-all group"
                        >
                          <p className="font-bold text-pkmn-text group-hover:text-pkmn-blue">{label}</p>
                          <p className="text-xs text-pkmn-gray mt-0.5">{desc}</p>
                        </button>
                      );
                    })}
                    {categories.filter(c => !['cards','boxes','accessories'].includes(c.slug)).map(cat => (
                      <button
                        key={cat.slug}
                        onClick={() => openWizardCategory(cat)}
                        className="text-left border border-pkmn-border p-4 hover:border-pkmn-blue hover:bg-pkmn-bg transition-all group"
                      >
                        <p className="font-bold text-pkmn-text group-hover:text-pkmn-blue">{cat.name}</p>
                        <p className="text-xs text-pkmn-gray mt-0.5">Custom category</p>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* ─── STEP 2: Category-specific form ─── */}
              {addWizardStep === 2 && (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <button onClick={() => { resetAddForm(); setAddWizardStep(1); setAddWizardCategorySlug(''); }} className="p-1.5 hover:bg-pkmn-bg transition-colors" title="Back">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                      </button>
                      <div>
                        <h3 className="text-xl font-bold text-pkmn-text">
                          {addWizardCategorySlug === 'cards' ? 'Add Card' : addWizardCategorySlug === 'boxes' ? 'Add Box' : addWizardCategorySlug === 'accessories' ? 'Add Accessory' : 'Add Item'}
                        </h3>
                        <p className="text-xs text-pkmn-gray mt-0.5 uppercase font-semibold tracking-wide">{categories.find(c => c.slug === addWizardCategorySlug)?.name}</p>
                      </div>
                    </div>
                    <button onClick={closeAddWizard} className="p-1.5 hover:bg-pkmn-bg transition-colors"><X size={20} /></button>
                  </div>

                  {/* Cards: inline TCG search to auto-fill */}
                  {addWizardCategorySlug === 'cards' && (
                    <div className="mb-4 border border-pkmn-border p-4 bg-pkmn-bg">
                      <p className="text-sm font-semibold text-pkmn-gray-dark mb-3">Search our card database to auto-fill:</p>
                      <div className="flex gap-2 mb-3">
                        <input
                          type="text"
                          placeholder="e.g. Charizard, Pikachu..."
                          value={tcgQuery}
                          onChange={e => {
                            setTcgQuery(e.target.value);
                            setTcgSearchAttempted(false);
                            setTcgResults([]);
                            setTcgSearchError('');
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void searchTCG();
                            }
                          }}
                          className="flex-1 min-w-0 border border-pkmn-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-pkmn-blue bg-white"
                        />
                        <button onClick={() => { void searchTCG(); }} disabled={tcgLoading || !tcgQuery.trim()} className="shrink-0 bg-pkmn-blue text-white font-bold px-4 py-2 rounded-md text-sm hover:bg-pkmn-blue-dark disabled:opacity-50 transition-colors whitespace-nowrap">
                          {tcgLoading ? '…' : 'Search'}
                        </button>
                      </div>
                      {tcgResults.length > 0 && (
                        <div className="grid grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                          {tcgResults.map(card => (
                            <button
                              key={getTCGCardResultKey(card)}
                              onClick={() => { fillFromTCGCard(card); toast.success(`Auto-filled: ${card.name}`); }}
                              className="border border-pkmn-border rounded-md p-1.5 hover:border-pkmn-blue hover:shadow-sm transition-all text-left bg-white"
                            >
                              {(card.image_small || card.image_url) && <img src={card.image_small || card.image_url} alt={card.name} className="w-full rounded mb-1" />}
                              <p className="text-xs font-bold text-pkmn-text line-clamp-2">{card.name}</p>
                              <p className="text-xs text-pkmn-gray">{card.set_name}</p>
                              {(card.number || card.tcg_subtypes) && (
                                <p className="text-[11px] text-pkmn-gray-dark mt-0.5 line-clamp-2">
                                  {[card.number ? `#${card.number}` : '', card.tcg_subtypes].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {tcgSearchAttempted && tcgResults.length === 0 && !tcgLoading && tcgQuery.trim() && (
                        <p className="text-xs text-pkmn-gray text-center py-2">No results. Try a different name.</p>
                      )}
                      {tcgSearchError && !tcgLoading && (
                        <p className="mt-2 text-xs text-pkmn-red">{tcgSearchError}</p>
                      )}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Name *</span>
                        <input
                          value={title}
                          onChange={e => setTitle(e.target.value)}
                          required
                          placeholder="Enter item name"
                          className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Stock</span>
                        <input
                          type="number"
                          min={0}
                          value={stock}
                          onChange={e => setStock(e.target.value)}
                          placeholder="0"
                          className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                    </div>

                    {/* Cards / Boxes / Accessories: Set Name selector */}
                    {['cards', 'boxes', 'accessories'].includes(addWizardCategorySlug) && (
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Set</span>
                        {tcgSetsLoading ? (
                          <p className="text-sm text-pkmn-gray mt-1.5">Loading sets…</p>
                        ) : (
                          <>
                            <input
                              list="tcg-set-options"
                              value={tcgSetName}
                              onChange={e => setTcgSetName(e.target.value)}
                              placeholder="Type or select a set…"
                              className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                            <datalist id="tcg-set-options">
                              {tcgSets.map(s => <option key={s.id} value={s.name} />)}
                            </datalist>
                          </>
                        )}
                        {tcgSetsError && (
                          <p className="mt-1 text-xs text-pkmn-red">{tcgSetsError}</p>
                        )}
                      </label>
                    )}

                    {/* Accessories: Subcategory selector */}
                    {addWizardCategorySlug === 'accessories' && (() => {
                      const accCat = categories.find(c => c.slug === 'accessories');
                      const subcats = accCat?.subcategories || [];
                      if (subcats.length === 0) return null;
                      return (
                        <label className="block">
                          <span className="text-sm font-semibold text-pkmn-gray-dark">Type</span>
                          <select
                            value={selectedSubcategoryId}
                            onChange={e => setSelectedSubcategoryId(e.target.value)}
                            className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">No specific type…</option>
                            {subcats.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                          </select>
                        </label>
                      );
                    })()}

                    {/* Custom category: tags + optional subcategory selector */}
                    {!['cards','boxes','accessories'].includes(addWizardCategorySlug) && (() => {
                      const customCat = categories.find(c => c.slug === addWizardCategorySlug);
                      const subcats = customCat?.subcategories || [];
                      const tags = customCat?.tags || [];
                      return (
                        <div className="space-y-4 border border-pkmn-border bg-pkmn-bg p-4">
                          {subcats.length > 0 && (
                            <label className="block">
                              <span className="text-sm font-semibold text-pkmn-gray-dark">Type</span>
                              <select
                                value={selectedSubcategoryId}
                                onChange={e => setSelectedSubcategoryId(e.target.value)}
                                className="mt-1.5 block w-full border border-pkmn-border bg-white px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                              >
                                <option value="">No specific type…</option>
                                {subcats.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                              </select>
                            </label>
                          )}

                          <div className="block">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-pkmn-gray-dark">Tags</span>
                              <span className="text-xs text-pkmn-gray">Select existing tags or create new ones</span>
                            </div>

                            {tags.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {tags.map(tag => {
                                  const selected = selectedTagNames.includes(tag.name);
                                  return (
                                    <button
                                      key={tag.id}
                                      type="button"
                                      onClick={() => toggleSelectedTag(tag.name)}
                                      className={`border px-3 py-1 text-xs font-semibold transition-colors ${selected ? 'border-pkmn-blue bg-pkmn-blue text-white' : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue hover:text-pkmn-blue'}`}
                                    >
                                      {tag.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            <div className="mt-3 flex gap-2">
                              <input
                                type="text"
                                value={newTagName}
                                onChange={e => setNewTagName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addCustomTag();
                                  }
                                }}
                                placeholder="Create a new tag"
                                className="block w-full border border-pkmn-border bg-white px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                              />
                              <button
                                type="button"
                                onClick={addCustomTag}
                                className="bg-pkmn-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-pkmn-blue-dark"
                              >
                                Add
                              </button>
                            </div>

                            {selectedTagNames.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {selectedTagNames.map(tagName => (
                                  <button
                                    key={tagName}
                                    type="button"
                                    onClick={() => toggleSelectedTag(tagName)}
                                    className="border border-pkmn-blue/30 bg-pkmn-blue/10 px-3 py-1 text-xs font-semibold text-pkmn-blue transition hover:bg-pkmn-blue/15"
                                  >
                                    {tagName} <span aria-hidden="true">×</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* TCG-specific fields — only for Cards */}
                    {addWizardCategorySlug === 'cards' && (
                      <div className="border border-pkmn-blue/20 bg-pkmn-blue/5 p-4 space-y-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-pkmn-blue">TCG Card Attributes</p>
                        <div className="grid grid-cols-3 gap-3">
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">Type</span>
                            <select value={tcgType} onChange={e => setTcgType(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                              <option value="">—</option>
                              {TCG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">Stage</span>
                            <select value={tcgStage} onChange={e => setTcgStage(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                              <option value="">—</option>
                              {TCG_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">Rarity</span>
                            <select value={rarityType} onChange={e => setRarityType(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                              <option value="">—</option>
                              {TCG_RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">Card #</span>
                            <input type="text" value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="e.g. 042" className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">Printed Rarity</span>
                            <input type="text" value={tcgRarity} onChange={e => setTcgRarity(e.target.value)} placeholder="e.g. Double Rare" className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">Supertype</span>
                            <select value={tcgSupertype} onChange={e => setTcgSupertype(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                              <option value="">—</option>
                              {['Pokémon','Trainer','Energy'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-pkmn-gray-dark">HP</span>
                            <input type="number" min="0" value={tcgHp} onChange={e => setTcgHp(e.target.value)} placeholder="e.g. 170" className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                          </label>
                        </div>
                        <label className="block">
                          <span className="text-xs font-semibold text-pkmn-gray-dark">Set Release Date</span>
                          <input type="date" value={tcgSetReleaseDate} onChange={e => setTcgSetReleaseDate(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold text-pkmn-gray-dark">Artist</span>
                          <input type="text" value={tcgArtist} onChange={e => setTcgArtist(e.target.value)} placeholder="e.g. Mitsuhiro Arita" className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                        </label>
                        {(tcgType || tcgStage || rarityType || tcgSupertype || tcgArtist || tcgHp || cardNumber || tcgRarity) && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {cardNumber && <span className="bg-pkmn-bg border border-pkmn-border text-pkmn-gray-dark text-xs px-2 py-0.5 font-semibold">#{cardNumber}</span>}
                            {tcgRarity && <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 font-semibold">{tcgRarity}</span>}
                            {tcgSupertype && <span className="bg-pkmn-blue/10 text-pkmn-blue text-xs px-2 py-0.5 font-semibold">{tcgSupertype}</span>}
                            {tcgType && <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 font-semibold">{tcgType}</span>}
                            {tcgStage && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 font-semibold">{tcgStage}</span>}
                            {rarityType && <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 font-semibold">{rarityType}</span>}
                            {tcgHp && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 font-semibold">{tcgHp} HP</span>}
                            {tcgArtist && <span className="bg-pkmn-bg border border-pkmn-border text-pkmn-gray-dark text-xs px-2 py-0.5">✏ {tcgArtist}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Image URL from TCG import */}
                    {imagePath && (
                      <div className="flex items-center gap-3 p-3 bg-pkmn-bg border border-pkmn-border">
                        <img src={imagePath} alt="TCG card preview" className="h-16 w-12 object-contain" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-pkmn-gray-dark">Imported image URL</p>
                          <p className="text-xs text-pkmn-gray truncate">{imagePath}</p>
                        </div>
                        <button type="button" onClick={() => setImagePath('')} className="text-pkmn-red p-1"><X size={14} /></button>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Price ($)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={price}
                          onChange={e => setPrice(e.target.value)}
                          placeholder="9.99"
                          className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        {addWizardCategorySlug === 'cards' && (
                          <button
                            type="button"
                            onClick={autofillCardPriceFromDatabase}
                            disabled={cardPriceAutofillLoading || !title.trim()}
                            className="mt-2 inline-flex items-center rounded-md border border-pkmn-blue/25 bg-pkmn-blue/10 px-3 py-1.5 text-xs font-semibold text-pkmn-blue transition hover:bg-pkmn-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {cardPriceAutofillLoading ? 'Checking database…' : 'Autofill Price from Database'}
                          </button>
                        )}
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Max/User</span>
                        <input
                          type="number"
                          min="0"
                          value={maxPerUser}
                          onChange={e => setMaxPerUser(e.target.value)}
                          placeholder="Leave blank for no limit"
                          className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <p className="mt-1 text-xs text-pkmn-gray">Daily limit (noon reset).</p>
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Max/Week</span>
                        <input
                          type="number"
                          min="0"
                          value={maxPerWeek}
                          onChange={e => setMaxPerWeek(e.target.value)}
                          placeholder="Leave blank for no limit"
                          className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <p className="mt-1 text-xs text-pkmn-gray">Rolling 7-day limit.</p>
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Max Total</span>
                        <input
                          type="number"
                          min="0"
                          value={maxTotalPerUser}
                          onChange={e => setMaxTotalPerUser(e.target.value)}
                          placeholder="Leave blank for no limit"
                          className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <p className="mt-1 text-xs text-pkmn-gray">Lifetime limit per user.</p>
                      </label>
                      <div className="block">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Images</span>
                        <label className="mt-1.5 flex items-center gap-2 cursor-pointer border border-dashed border-pkmn-border bg-pkmn-bg px-4 py-2.5 hover:border-pkmn-blue hover:bg-pkmn-blue/10 transition-colors">
                          <ImagePlus className="w-5 h-5 text-pkmn-blue" />
                          <span className="text-sm text-pkmn-gray">Add&hellip;</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={e => addFiles(e.target.files)}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    {priceAutofillMeta && (
                      <div className="border border-pkmn-blue/20 bg-pkmn-blue/5 px-4 py-3 text-xs text-pkmn-gray">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            {priceAutofillMeta.sourcePrice !== null
                              ? `Auto-filled from ${priceAutofillMeta.sourceLabel} at $${priceAutofillMeta.sourcePrice.toFixed(2)}. You can still edit the price.`
                              : `Price source: ${priceAutofillMeta.sourceLabel}. You can still set the price manually.`}
                          </span>
                          {priceAutofillMeta.tcgplayerUrl && (
                            <a
                              href={priceAutofillMeta.tcgplayerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-pkmn-blue underline decoration-pkmn-blue/40 underline-offset-2 hover:text-pkmn-blue-dark"
                            >
                              View on TCGPlayer
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    <label className="block">
                      <span className="text-sm font-semibold text-pkmn-gray-dark">Publish Date</span>
                      <input
                        type="datetime-local"
                        value={publishedAt}
                        onChange={e => setPublishedAt(e.target.value)}
                        className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>

                    {publishedAt && new Date(publishedAt) > new Date() && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={previewBeforeRelease}
                          onChange={e => setPreviewBeforeRelease(e.target.checked)}
                          className="w-4 h-4 accent-pkmn-blue cursor-pointer"
                        />
                        <span className="text-sm text-pkmn-text font-medium">Preview before release</span>
                        <span className="text-xs text-pkmn-gray">(page visible now, shows &quot;Coming Soon&quot; until release)</span>
                      </label>
                    )}

                    <label className="flex items-start gap-2 cursor-pointer rounded-md border border-pkmn-border bg-pkmn-bg px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={showWhenOutOfStock}
                        onChange={e => setShowWhenOutOfStock(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-pkmn-blue cursor-pointer"
                      />
                      <span>
                        <span className="block text-sm text-pkmn-text font-medium">Keep Visible When Out of Stock</span>
                        <span className="block text-xs text-pkmn-gray">If enabled, item remains visible on storefront even when stock reaches 0. If disabled, item hides automatically.</span>
                      </span>
                    </label>

                    <DraggableFileList
                      files={imageFiles}
                      urls={imageUrls}
                      onReorder={(f, u) => { setImageFiles(f); setImageUrls(u); }}
                      onRemove={(idx) => removeFile(idx)}
                    />

                    <label className="block">
                      <span className="text-sm font-semibold text-pkmn-gray-dark">Short Description</span>
                      <input
                        value={shortDescription}
                        onChange={e => setShortDescription(e.target.value)}
                        maxLength={300}
                        placeholder="Brief summary shown on the storefront card"
                        className="mt-1.5 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <p className="text-xs text-pkmn-gray mt-1">{shortDescription.length}/300</p>
                    </label>

                    <div className="block">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-pkmn-gray-dark">Description</span>
                        <button type="button" onClick={() => setPreviewAdd(!previewAdd)} className="text-xs text-pkmn-blue hover:text-pkmn-blue-dark font-medium flex items-center gap-1">
                          <Eye size={12} /> {previewAdd ? 'Edit' : 'Preview'}
                        </button>
                      </div>
                      {previewAdd && (
                        <div className="mt-1.5 border border-pkmn-border p-4 min-h-[80px] bg-pkmn-bg">
                          <RichText html={description} className="text-pkmn-text [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />
                        </div>
                      )}
                      <div className={`mt-1.5 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:font-normal ${previewAdd ? 'hidden' : ''}`}>
                        <ReactQuill theme="snow" value={description} onChange={setDescription} placeholder="Write a short description for the new item." modules={quillModules} formats={quillFormats} />
                      </div>
                    </div>

                    {message && (
                      <div className={`px-4 py-3 text-sm font-medium ${status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-pkmn-red/10 text-pkmn-red border border-red-100'}`}>
                        {message}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button type="button" onClick={closeAddWizard} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2.5 hover:bg-pkmn-bg transition-colors">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLivePreview({
                            title,
                            description,
                            shortDescription,
                            price,
                            stock,
                            maxPerUser,
                            imageUrls: buildPreviewImages(imageUrls, imagePath),
                            tcgSetName,
                            rarityType,
                            tcgSupertype,
                            tcgType,
                            tcgStage,
                            tcgHp,
                            tcgArtist,
                          });
                          setLivePreviewTab('quick');
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 border-2 border-pkmn-blue/20 bg-pkmn-blue/10 py-2.5 text-sm font-semibold text-pkmn-blue transition hover:bg-pkmn-blue/15"
                      >
                        <Monitor size={16} /> Live Preview
                      </button>
                      <button
                        type="submit"
                        disabled={status === 'saving'}
                        className="flex-1 inline-flex items-center justify-center bg-pkmn-blue py-2.5 text-sm font-semibold text-white transition hover:bg-pkmn-blue-dark disabled:cursor-not-allowed disabled:bg-pkmn-blue/50"
                      >
                        {status === 'saving' ? 'Saving\u2026' : 'Create Item'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-sm w-full p-6 text-center">
              <AlertCircle className="w-10 h-10 text-pkmn-yellow mx-auto mb-3" />
              <h3 className="text-lg font-bold text-pkmn-text mb-2">Delete Item?</h3>
              <p className="text-pkmn-gray text-sm mb-6">This action cannot be undone. The item and all its images will be permanently deleted.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-md hover:bg-pkmn-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await axios.delete(`${API}/api/inventory/items/${deleteConfirm}/`, { headers });
                      setItems(prev => prev.filter(i => i.slug !== deleteConfirm));
                      setDeleteConfirm(null);
                      toast.success('Item deleted');
                    } catch { toast.error('Failed to delete item.'); }
                  }}
                  className="flex-1 bg-pkmn-red text-white font-semibold py-2 rounded-md hover:bg-pkmn-red-dark transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setEditItem(null)}>
<div className="bg-white border border-pkmn-border shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-pkmn-text">Edit Item</h3>
                <button onClick={() => setEditItem(null)} className="p-1 hover:bg-pkmn-bg"><X size={20} /></button>
              </div>
              <form
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  setEditSaving(true);
                  try {
                    const fd = new FormData();
                    fd.append('title', editTitle);
                    fd.append('description', editDescription);
                    fd.append('short_description', editShortDescription);
                    fd.append('price', editPrice || '0');
                    fd.append('stock', editStock || '0');
                    fd.append('is_active', editIsActive ? 'true' : 'false');
                    fd.append('show_when_out_of_stock', editIsActive ? 'true' : 'false');
                    fd.append('max_per_user', editMaxPerUser || '0');
                    if (editMaxPerWeek) fd.append('max_per_week', editMaxPerWeek);
                    else fd.append('max_per_week', '');
                    if (editMaxTotalPerUser) fd.append('max_total_per_user', editMaxTotalPerUser);
                    else fd.append('max_total_per_user', '');
                    const shouldAutoPublishDraft = editIsActive && !editPublishedAt && !editItem.published_at;
                    if (editPublishedAt) {
                      fd.append('published_at', new Date(editPublishedAt).toISOString());
                    } else if (shouldAutoPublishDraft) {
                      fd.append('published_at', new Date().toISOString());
                    } else {
                      fd.append('published_at', '');
                    }
                    fd.append('preview_before_release', editPreviewBeforeRelease ? 'true' : 'false');
                    if (editCategoryId) fd.append('category', editCategoryId);
                    fd.append('subcategory', editSubcategoryId || '');
                    if (editTcgType) fd.append('tcg_type', editTcgType);
                    if (editTcgStage) fd.append('tcg_stage', editTcgStage);
                    if (editRarityType) fd.append('rarity_type', editRarityType);
                    if (editTcgSupertype) fd.append('tcg_supertype', editTcgSupertype);
                    if (editTcgSubtypes) fd.append('tcg_subtypes', editTcgSubtypes);
                    if (editTcgHp) fd.append('tcg_hp', editTcgHp);
                    if (editTcgArtist) fd.append('tcg_artist', editTcgArtist);
                    if (editTcgSetName) fd.append('tcg_set_name', editTcgSetName);
                    editImages.forEach(f => fd.append('images', f));
                    const response = await axios.patch(`${API}/api/inventory/items/${editItem.slug}/`, fd, {
                      headers: { ...headers, 'Content-Type': 'multipart/form-data' },
                    });
                    setItems((previous) => previous.map((existingItem) => (
                      existingItem.id === editItem.id
                        ? { ...existingItem, ...response.data }
                        : existingItem
                    )));
                    setEditItem(null);
                    fetchItems();
                    toast.success('Item updated!');
                  } catch (err: unknown) {
                    const detail = axios.isAxiosError(err) && err.response?.data
                      ? (typeof err.response.data === 'string'
                          ? err.response.data
                          : err.response.data.detail || err.response.data.error || JSON.stringify(err.response.data))
                      : null;
                    toast.error(detail ? `Failed to update item: ${detail}` : 'Failed to update item. Check your inputs and try again.');
                  } finally {
                    setEditSaving(false);
                  }
                }}
                className="space-y-4"
              >
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Name</span>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} required className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                {/* Category */}
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Category</span>
                  <select
                    value={editCategoryId}
                    onChange={e => { setEditCategoryId(e.target.value); setEditSubcategoryId(''); setEditTcgType(''); setEditTcgStage(''); setEditRarityType(''); }}
                    className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">No category</option>
                    {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </label>
                {/* Subcategory — only shown when selected category has subcategories */}
                {editCategoryId && (() => { const cat = categories.find(c => String(c.id) === editCategoryId); return cat && cat.subcategories.length > 0 ? (
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Subcategory</span>
                    <select
                      value={editSubcategoryId}
                      onChange={e => setEditSubcategoryId(e.target.value)}
                      className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="">None</option>
                      {cat.subcategories.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                  </label>
                ) : null; })()}
                {/* Set Name — available for all categories */}
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Set</span>
                  <input
                    list="edit-set-options"
                    value={editTcgSetName}
                    onChange={e => setEditTcgSetName(e.target.value)}
                    placeholder="Type or select a set…"
                    className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <datalist id="edit-set-options">
                    {tcgSets.map(s => <option key={s.id} value={s.name} />)}
                  </datalist>
                </label>
                {/* TCG fields — only when TCG Cards */}
                {editCategoryId && categories.find(c => String(c.id) === editCategoryId)?.slug === 'cards' && (
                  <div className="border border-pkmn-blue/20 bg-pkmn-blue/5 p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-pkmn-blue">TCG Card Attributes</p>
                    <div className="grid grid-cols-3 gap-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Type</span>
                        <select value={editTcgType} onChange={e => setEditTcgType(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Stage</span>
                        <select value={editTcgStage} onChange={e => setEditTcgStage(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Rarity</span>
                        <select value={editRarityType} onChange={e => setEditRarityType(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Supertype</span>
                        <select value={editTcgSupertype} onChange={e => setEditTcgSupertype(e.target.value)} className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {['Pokémon','Trainer','Energy'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">HP</span>
                        <input type="number" min="0" value={editTcgHp} onChange={e => setEditTcgHp(e.target.value)} placeholder="e.g. 170" className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-xs font-semibold text-pkmn-gray-dark">Artist</span>
                      <input type="text" value={editTcgArtist} onChange={e => setEditTcgArtist(e.target.value)} placeholder="e.g. Mitsuhiro Arita" className="mt-1 block w-full rounded-md border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none" />
                    </label>
                    {/* Tag pills preview */}
                    {(editTcgType || editTcgStage || editRarityType || editTcgSupertype || editTcgArtist || editTcgHp) && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {editTcgSupertype && <span className="bg-pkmn-blue/10 text-pkmn-blue text-xs px-2 py-0.5 font-semibold">{editTcgSupertype}</span>}
                        {editTcgType && <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 font-semibold">{editTcgType}</span>}
                        {editTcgStage && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 font-semibold">{editTcgStage}</span>}
                        {editRarityType && <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 font-semibold">{editRarityType}</span>}
                        {editTcgHp && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 font-semibold">{editTcgHp} HP</span>}
                        {editTcgArtist && <span className="bg-pkmn-bg border border-pkmn-border text-pkmn-gray-dark text-xs px-2 py-0.5">✏ {editTcgArtist}</span>}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Price</span>
                    <input type="number" step="0.01" min="0" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Stock</span>
                    <input type="number" min="0" value={editStock} onChange={e => setEditStock(e.target.value)} className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Max/User</span>
                    <input type="number" min="0" value={editMaxPerUser} onChange={e => setEditMaxPerUser(e.target.value)} placeholder="Leave blank for no limit" className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    <p className="mt-1 text-xs text-pkmn-gray">Daily limit (noon reset).</p>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Max/Week</span>
                    <input type="number" min="0" value={editMaxPerWeek} onChange={e => setEditMaxPerWeek(e.target.value)} placeholder="Leave blank for no limit" className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    <p className="mt-1 text-xs text-pkmn-gray">Rolling 7-day limit.</p>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Max Total</span>
                    <input type="number" min="0" value={editMaxTotalPerUser} onChange={e => setEditMaxTotalPerUser(e.target.value)} placeholder="Leave blank for no limit" className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    <p className="mt-1 text-xs text-pkmn-gray">Lifetime limit per user.</p>
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Publish Date</span>
                  <input
                    type="datetime-local"
                    value={editPublishedAt}
                    onChange={e => {
                      setEditPublishedAt(e.target.value);
                      if (!e.target.value || new Date(e.target.value) <= new Date()) {
                        setEditPreviewBeforeRelease(false);
                      }
                    }}
                    className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                {editPublishedAt && new Date(editPublishedAt) > new Date() && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editPreviewBeforeRelease}
                      onChange={e => setEditPreviewBeforeRelease(e.target.checked)}
                      className="w-4 h-4 accent-pkmn-blue cursor-pointer"
                    />
                    <span className="text-sm text-pkmn-text font-medium">Preview before release</span>
                    <span className="text-xs text-pkmn-gray">(page visible now, shows &quot;Coming Soon&quot; until release)</span>
                  </label>
                )}

                <label className="flex items-start gap-2 cursor-pointer rounded-md border border-pkmn-border bg-pkmn-bg px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={e => setEditIsActive(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-pkmn-blue cursor-pointer"
                  />
                  <span>
                    <span className="block text-sm text-pkmn-text font-medium">Visible on Storefront</span>
                    <span className="block text-xs text-pkmn-gray">When enabled, this item appears on the storefront. If stock reaches 0, it will remain visible with an &quot;Out of Stock&quot; indicator.</span>
                  </span>
                </label>

                {/* Scheduled Inventory Drops */}
                <div className="border border-pkmn-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Scheduled Restocks</span>
                    <span className="text-xs text-pkmn-gray-dark">{editDrops.filter(d => !d.is_processed).length} pending</span>
                  </div>
                  {editDrops.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {editDrops.map(drop => (
                        <div key={drop.id} className={`flex items-center justify-between text-sm px-3 py-2 rounded-md ${drop.is_processed ? 'bg-pkmn-bg opacity-60' : 'bg-pkmn-blue/10'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${drop.is_processed ? 'text-pkmn-gray' : 'text-pkmn-blue'}`}>+{drop.quantity}</span>
                            <span className="text-pkmn-gray">{new Date(drop.drop_time).toLocaleString()}</span>
                            {drop.is_processed && <span className="text-xs bg-pkmn-bg text-pkmn-gray px-1.5 py-0.5 rounded">processed</span>}
                          </div>
                          {!drop.is_processed && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await axios.delete(`${API}/api/inventory/inventory-drops/${drop.id}/`, { headers });
                                  setEditDrops(prev => prev.filter(d => d.id !== drop.id));
                                  toast.success('Drop removed');
                                } catch { toast.error('Failed to remove drop'); }
                              }}
                              className="text-pkmn-red hover:text-pkmn-red p-0.5"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      value={newDropQty}
                      onChange={e => setNewDropQty(e.target.value)}
                      className="w-20 rounded-md border border-pkmn-border bg-pkmn-bg px-3 py-1.5 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none"
                    />
                    <input
                      type="datetime-local"
                      value={newDropTime}
                      onChange={e => setNewDropTime(e.target.value)}
                      className="flex-1 rounded-md border border-pkmn-border bg-pkmn-bg px-3 py-1.5 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={dropSaving || !newDropQty || !newDropTime}
                      onClick={async () => {
                        setDropSaving(true);
                        try {
                          const res = await axios.post(`${API}/api/inventory/inventory-drops/`, {
                            item: editItem.id,
                            quantity: Number(newDropQty),
                            drop_time: new Date(newDropTime).toISOString(),
                          }, { headers });
                          setEditDrops(prev => [...prev, res.data].sort((a, b) => new Date(a.drop_time).getTime() - new Date(b.drop_time).getTime()));
                          setNewDropQty(''); setNewDropTime('');
                          toast.success('Drop scheduled');
                        } catch { toast.error('Failed to schedule drop'); }
                        finally { setDropSaving(false); }
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-pkmn-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-pkmn-blue-dark disabled:bg-pkmn-blue/50 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Short Description</span>
                  <input
                    value={editShortDescription}
                    onChange={e => setEditShortDescription(e.target.value)}
                    maxLength={300}
                    placeholder="Brief summary shown on the storefront card"
                    className="mt-1 block w-full border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-pkmn-gray mt-1">{editShortDescription.length}/300</p>
                </label>
                <div className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Description</span>
                    <button type="button" onClick={() => setPreviewEdit(!previewEdit)} className="text-xs text-pkmn-blue hover:text-pkmn-blue-dark font-medium flex items-center gap-1">
                      <Eye size={12} /> {previewEdit ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {previewEdit && (
                    <div className="mt-1 border border-pkmn-border p-4 min-h-[80px] bg-pkmn-bg">
                      <RichText html={editDescription} className="text-pkmn-text [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />
                    </div>
                  )}
                  <div className={`mt-1 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:font-normal ${previewEdit ? 'hidden' : ''}`}>
                    <ReactQuill theme="snow" value={editDescription} onChange={setEditDescription} modules={quillModules} formats={quillFormats} />
                  </div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Current Images</span>
                  {editItem.images.length > 0 && (
                    <div className="mt-1">
                      <DraggableImageList
                        images={editItem.images}
                        onReorder={async (orderedIds) => {
                          try {
                            await axios.post(
                              `${API}/api/inventory/items/${editItem.slug}/reorder-images/`,
                              { order: orderedIds },
                              { headers }
                            );
                            toast.success('Image order saved');
                          } catch { toast.error('Failed to save image order'); }
                        }}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Replace Images</span>
                  <label className="mt-1 flex items-center gap-2 cursor-pointer border border-dashed border-pkmn-border bg-pkmn-bg px-4 py-2.5 hover:border-pkmn-blue hover:bg-pkmn-blue/10 transition-colors">
                    <ImagePlus className="w-5 h-5 text-pkmn-blue" />
                    <span className="text-sm text-pkmn-gray">{editImages.length ? `${editImages.length} file(s) selected - Add more…` : 'Choose new images...'}</span>
                    <input type="file" accept="image/*" multiple onChange={e => {
                      if (!e.target.files) return;
                      const newFiles = Array.from(e.target.files);
                      const newUrls = newFiles.map(f => URL.createObjectURL(f));
                      setEditImages(prev => [...prev, ...newFiles]);
                      setEditImageUrls(prev => [...prev, ...newUrls]);
                    }} className="hidden" />
                  </label>
                  <DraggableFileList
                    files={editImages}
                    urls={editImageUrls}
                    onReorder={(f, u) => { setEditImages(f); setEditImageUrls(u); }}
                    onRemove={(idx) => {
                      URL.revokeObjectURL(editImageUrls[idx]);
                      setEditImages(prev => prev.filter((_, i) => i !== idx));
                      setEditImageUrls(prev => prev.filter((_, i) => i !== idx));
                    }}
                  />
                  <p className="text-xs text-pkmn-gray mt-1">Leave empty to keep existing images</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditItem(null)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2.5 hover:bg-pkmn-bg transition-colors">Cancel</button>
                  <button
                    type="button"
                    onClick={() => {
                      const urls = editImageUrls.length > 0
                        ? editImageUrls
                        : editItem.images.length > 0
                          ? editItem.images.map(i => i.url)
                          : buildPreviewImages([], editItem.image_path);
                      setLivePreview({ title: editTitle, description: editDescription, shortDescription: editShortDescription, price: editPrice, stock: editStock, maxPerUser: editMaxPerUser, imageUrls: urls, tcgSetName: editTcgSetName, rarityType: editRarityType, tcgSupertype: editTcgSupertype, tcgType: editTcgType, tcgStage: editTcgStage, tcgHp: editTcgHp, tcgArtist: editTcgArtist });
                      setLivePreviewTab('quick');
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 border-2 border-pkmn-blue/20 bg-pkmn-blue/10 py-2.5 text-sm font-semibold text-pkmn-blue transition hover:bg-pkmn-blue/15"
                  >
                    <Monitor size={16} /> Live Preview
                  </button>
                  <button type="submit" disabled={editSaving} className="flex-1 bg-pkmn-blue text-white font-semibold py-2.5 hover:bg-pkmn-blue-dark disabled:bg-pkmn-blue/50 transition-colors">
                    {editSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Cards Pricing Workflow Modal */}
        {pricingWorkflowOpen && (
          <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" onClick={() => setPricingWorkflowOpen(false)}>
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-pkmn-border px-5 py-4">
                <div>
                  <h3 className="text-lg font-bold text-pkmn-text">Cards Pricing Workflow</h3>
                  <p className="text-xs text-pkmn-gray mt-0.5">Only cards with a changed proposed value are shown below.</p>
                </div>
                <button type="button" onClick={() => setPricingWorkflowOpen(false)} className="p-1.5 hover:bg-pkmn-bg transition-colors"><X size={18} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 bg-pkmn-bg space-y-5">
                {pricingWorkflowLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-pkmn-blue" />
                    <span className="ml-3 text-pkmn-gray">Building pricing diff…</span>
                  </div>
                ) : (
                  <>
                    <div className="bg-white border border-pkmn-border p-4">
                      <p className="text-sm font-semibold text-pkmn-text">
                        {pricingWorkflowChanges.length} card{pricingWorkflowChanges.length === 1 ? '' : 's'} need pricing updates
                      </p>
                      <p className="text-xs text-pkmn-gray mt-1">
                        {'Formula: market >= 1.00 ? floor(market) : market'}
                      </p>
                    </div>

                    <div className="bg-white border border-pkmn-border p-4">
                      <h4 className="text-sm font-semibold text-pkmn-text mb-3">Manual Cards (review first)</h4>
                      {pricingWorkflowManualCards.length === 0 ? (
                        <p className="text-xs text-pkmn-gray">No manual cards detected.</p>
                      ) : (
                        <div className="space-y-2">
                          {pricingWorkflowManualCards.map((card) => (
                            <div key={card.item_id} className="flex flex-wrap items-center justify-between gap-2 border border-pkmn-border bg-pkmn-bg px-3 py-2">
                              <div>
                                <p className="text-sm font-semibold text-pkmn-text">{card.title}</p>
                                <p className="text-xs text-pkmn-gray">Current ${Number(card.current_price).toFixed(2)} · {card.reason}</p>
                              </div>
                              <a href={card.tcgplayer_search_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-pkmn-blue hover:text-pkmn-blue-dark no-underline">
                                Search on TCGPlayer
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-white border border-pkmn-border p-4">
                      <h4 className="text-sm font-semibold text-pkmn-text mb-3">Proposed Price Changes</h4>
                      {pricingWorkflowChanges.length === 0 ? (
                        <p className="text-xs text-pkmn-gray">No changes to apply right now.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-pkmn-border text-left text-pkmn-gray">
                                <th className="py-2 pr-3 font-semibold">Card</th>
                                <th className="py-2 pr-3 font-semibold">Previous</th>
                                <th className="py-2 pr-3 font-semibold">Market</th>
                                <th className="py-2 pr-3 font-semibold">Proposed</th>
                                <th className="py-2 font-semibold">TCGPlayer</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pricingWorkflowChanges.map((row) => (
                                <tr key={row.item_id} className="border-b border-pkmn-border/60">
                                  <td className="py-2 pr-3 text-pkmn-text font-medium">{row.title}</td>
                                  <td className="py-2 pr-3 text-pkmn-gray-dark">${Number(row.previous_value).toFixed(2)}</td>
                                  <td className="py-2 pr-3 text-pkmn-gray-dark">${Number(row.current_market_value).toFixed(2)}</td>
                                  <td className="py-2 pr-3 text-pkmn-blue font-semibold">${Number(row.proposed_new_value).toFixed(2)}</td>
                                  <td className="py-2">
                                    {row.tcgplayer_url ? (
                                      <a href={row.tcgplayer_url} target="_blank" rel="noreferrer" className="text-pkmn-blue text-xs font-semibold no-underline hover:text-pkmn-blue-dark">Open</a>
                                    ) : (
                                      <span className="text-xs text-pkmn-gray">N/A</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-pkmn-border px-5 py-4 bg-white">
                <button type="button" onClick={() => setPricingWorkflowOpen(false)} className="border border-pkmn-border px-4 py-2 text-sm font-semibold text-pkmn-gray-dark hover:bg-pkmn-bg transition-colors">Close</button>
                <button
                  type="button"
                  onClick={applyPricingWorkflow}
                  disabled={pricingWorkflowApplying || pricingWorkflowLoading || pricingWorkflowChanges.length === 0}
                  className="bg-pkmn-blue px-4 py-2 text-sm font-semibold text-white hover:bg-pkmn-blue-dark disabled:bg-pkmn-blue/50 transition-colors"
                >
                  {pricingWorkflowApplying ? 'Applying…' : 'Confirm & Apply'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Live Preview Modal */}
        {livePreview && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setLivePreview(null)}>
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header with tabs */}
              <div className="flex items-center justify-between border-b border-pkmn-border px-6 py-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold text-pkmn-text">Live Preview</h3>
                  <div className="flex bg-pkmn-bg rounded-md p-1">
                    <button
                      onClick={() => setLivePreviewTab('quick')}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${livePreviewTab === 'quick' ? 'bg-white text-pkmn-blue shadow-sm' : 'text-pkmn-gray hover:text-pkmn-gray-dark'}`}
                    >
                      <Smartphone size={14} className="inline mr-2 -mt-0.5" />
                      Quick View
                    </button>
                    <button
                      onClick={() => setLivePreviewTab('full')}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${livePreviewTab === 'full' ? 'bg-white text-pkmn-blue shadow-sm' : 'text-pkmn-gray hover:text-pkmn-gray-dark'}`}
                    >
                      <Monitor size={14} className="inline mr-2 -mt-0.5" />
                      Full Page
                    </button>
                  </div>
                </div>
                <button onClick={() => setLivePreview(null)} className="p-1.5 hover:bg-pkmn-bg transition-colors"><X size={20} /></button>
              </div>

              {/* Preview content */}
              <div className="flex-1 overflow-y-auto bg-pkmn-bg p-6">
                {livePreviewTab === 'quick' ? (
                  /* Quick View - card as it appears on storefront grid */
                  <div className="max-w-sm mx-auto">
                    <div className="bg-white border border-pkmn-border shadow-sm overflow-hidden">
                      <div className="aspect-square bg-pkmn-bg flex items-center justify-center overflow-hidden">
                        {livePreview.imageUrls[0] ? (
                          <FallbackImage src={livePreview.imageUrls[0]} alt={livePreview.title} className="w-full h-full object-contain" fallbackClassName="flex items-center justify-center" fallbackSize={48} />
                        ) : (
                          <ImageIcon size={48} className="text-pkmn-gray-dark" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <h3 className="font-bold text-pkmn-text text-lg truncate">{livePreview.title || 'Untitled'}</h3>
                        {livePreview.shortDescription && (
                          <p className="text-sm text-pkmn-gray line-clamp-2">{livePreview.shortDescription}</p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xl font-bold text-pkmn-blue">${Number(livePreview.price || 0).toFixed(2)}</span>
                          <span className="text-sm text-pkmn-gray">{livePreview.stock || 0} in stock</span>
                        </div>
                        <button className="w-full bg-linear-to-r from-pkmn-yellow to-pkmn-red text-white font-bold py-3 flex items-center justify-center gap-2 text-sm cursor-default">
                          <ShoppingCart size={16} /> Add to Cart
                        </button>
                      </div>
                    </div>
                    <p className="text-center text-xs text-pkmn-gray-dark mt-4">This is how the card appears on the storefront grid</p>
                  </div>
                ) : (
                  /* Full Page - mirrors the actual product detail page layout */
                  <div className="max-w-4xl mx-auto">
                    <div className="flex flex-col gap-10 py-4 lg:flex-row">
                      {/* Gallery */}
                      <div className="w-full lg:w-1/2">
                        <div className="pkc-panel flex aspect-square w-full items-center justify-center bg-[#f5f5f5] p-8 relative">
                          {livePreview.imageUrls[0] ? (
                            <FallbackImage src={livePreview.imageUrls[0]} alt={livePreview.title} className="max-h-full max-w-full object-contain" fallbackClassName="flex items-center justify-center" fallbackSize={64} />
                          ) : (
                            <div className="text-pkmn-gray text-center">No Image Available</div>
                          )}
                        </div>
                        {livePreview.imageUrls.length > 1 && (
                          <div className="flex gap-2 justify-center flex-wrap mt-4">
                            {livePreview.imageUrls.map((url, idx) => (
                              <div key={idx} className={`h-16 w-16 overflow-hidden border-2 transition-all ${idx === 0 ? 'border-pkmn-blue bg-[#eef5fb]' : 'border-pkmn-border'}`}>
                                <img src={url} alt="" className="w-full h-full object-cover" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="w-full min-w-0 lg:w-1/2">
                        <div className="pkc-panel min-w-0 p-6">
                          <h1 className="text-3xl font-heading font-black text-pkmn-text mb-2 tracking-tight break-words">{livePreview.title || 'Untitled'}</h1>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="flex text-pkmn-yellow">
                              {[...Array(5)].map((_, i) => <Star key={i} size={16} fill="currentColor" />)}
                            </div>
                            <span className="text-sm text-pkmn-gray">(12 reviews)</span>
                          </div>
                          <p className="mb-6 text-2xl font-black text-pkmn-text">${Number(livePreview.price || 0).toFixed(2)}</p>

                          {/* Set / Rarity / Holofoil pills */}
                          {(livePreview.tcgSetName || livePreview.rarityType) && (
                            <div className="flex flex-wrap gap-3 mb-4 text-sm">
                              {livePreview.tcgSetName && (
                                <span className="pkc-pill border-pkmn-border bg-[#f5f5f5]">
                                  <span>Set:&nbsp;</span><strong>{livePreview.tcgSetName}</strong>
                                </span>
                              )}
                              {livePreview.rarityType && (
                                <span className="pkc-pill border-pkmn-border bg-[#f5f5f5]">
                                  <span>Rarity:&nbsp;</span><strong>{livePreview.rarityType}</strong>
                                </span>
                              )}
                            </div>
                          )}

                          {/* TCG metadata pills */}
                          {(livePreview.tcgSupertype || livePreview.tcgType || livePreview.tcgStage || livePreview.rarityType || livePreview.tcgHp || livePreview.tcgArtist) && (
                            <div className="flex flex-wrap gap-1.5 mb-5">
                              {livePreview.tcgSupertype && <span className="pkc-pill border-pkmn-blue/20 bg-pkmn-blue/10 text-pkmn-blue">{livePreview.tcgSupertype}</span>}
                              {livePreview.tcgType && <span className="pkc-pill border-orange-500/20 bg-orange-100 text-orange-700">{livePreview.tcgType}</span>}
                              {livePreview.tcgStage && <span className="pkc-pill border-green-600/20 bg-green-100 text-green-700">{livePreview.tcgStage}</span>}
                              {livePreview.rarityType && <span className="pkc-pill border-purple-500/20 bg-purple-100 text-purple-700">{livePreview.rarityType}</span>}
                              {livePreview.tcgHp && <span className="pkc-pill border-pkmn-red/20 bg-red-100 text-red-700">{livePreview.tcgHp} HP</span>}
                              {livePreview.tcgArtist && <span className="pkc-pill border-pkmn-border bg-[#f5f5f5] text-pkmn-gray-dark">Artist {livePreview.tcgArtist}</span>}
                            </div>
                          )}

                          <RichText html={livePreview.description} className="text-pkmn-gray-dark leading-relaxed mb-6 min-w-0 break-words [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic [&_table]:max-w-full" />
                        </div>

                        {/* Add to cart section */}
                        <div className="pkc-panel mt-8 p-6">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center border border-pkmn-gray-mid bg-white">
                              <button className="p-3 cursor-default"><MinusIcon size={16} className="text-pkmn-gray-dark" /></button>
                              <span className="w-12 text-center font-bold text-pkmn-text">1</span>
                              <button className="p-3 cursor-default"><PlusIcon size={16} className="text-pkmn-text" /></button>
                            </div>
                            <button className="pkc-button-accent flex-1 !py-3 text-sm cursor-default">
                              <ShoppingCart size={20} /> Add to Cart
                            </button>
                          </div>
                          <div className="flex justify-between text-sm mt-4">
                            <span className="text-pkmn-gray">Availability</span>
                            <span className="font-semibold text-green-600">{livePreview.stock || 0} in stock</span>
                          </div>
                          <div className="flex justify-between text-sm mt-2">
                            <span className="text-pkmn-gray">Max per student</span>
                            <span className="font-semibold text-pkmn-text">{formatAdminMaxPerUser(livePreview.maxPerUser)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="text-center text-xs text-pkmn-gray-dark mt-4">This is how the full product page will appear to customers</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
