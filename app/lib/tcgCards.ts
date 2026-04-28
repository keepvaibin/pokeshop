import axios from 'axios';

import { API_BASE_URL as API } from '@/app/lib/api';

export interface TCGCard {
  product_id: number | null;
  api_id: string;
  name: string;
  clean_name: string;
  group_name: string;
  set_name: string;
  set_id: string;
  sub_type_name: string;
  tcg_subtypes: string;
  rarity: string;
  market_price: string | null;
  image_url: string;
  image_small: string;
  image_large: string;
  card_number: string;
  number: string;
  set_printed_total: string;
  tcgplayer_url: string;
  price_source: string;
  tcg_type: string;
  tcg_stage: string;
  rarity_type: string;
  tcg_supertype: string;
  tcg_hp: number | null;
  tcg_artist: string;
  set_release_date: string;
  short_description: string;
}

const SEARCH_CACHE_TTL_MS = 60_000;
const tcgSearchCache = new Map<string, { expiresAt: number; results: TCGCard[] }>();

function normalizeTCGCard(rawCard: Partial<TCGCard> & Record<string, unknown>): TCGCard {
  const imageUrl = String(rawCard.image_url || rawCard.image_small || rawCard.image_large || '');
  const imageSmall = String(rawCard.image_small || rawCard.image_url || rawCard.image_large || '');
  const imageLarge = String(rawCard.image_large || rawCard.image_url || rawCard.image_small || '');
  const cardNumber = String(rawCard.card_number || rawCard.number || '');
  const setName = String(rawCard.set_name || rawCard.group_name || '');
  const cleanName = String(rawCard.clean_name || rawCard.name || '');
  const marketPrice = rawCard.market_price == null ? null : String(rawCard.market_price);
  const tcgHp = typeof rawCard.tcg_hp === 'number'
    ? rawCard.tcg_hp
    : Number.isFinite(Number(rawCard.tcg_hp))
      ? Number(rawCard.tcg_hp)
      : null;

  return {
    product_id: rawCard.product_id == null ? null : Number(rawCard.product_id),
    api_id: String(rawCard.api_id || ''),
    name: String(rawCard.name || cleanName),
    clean_name: cleanName,
    group_name: setName,
    set_name: setName,
    set_id: String(rawCard.set_id || ''),
    sub_type_name: String(rawCard.sub_type_name || rawCard.tcg_subtypes || 'Normal'),
    tcg_subtypes: String(rawCard.tcg_subtypes || rawCard.sub_type_name || 'Normal'),
    rarity: String(rawCard.rarity || ''),
    market_price: marketPrice,
    image_url: imageUrl,
    image_small: imageSmall,
    image_large: imageLarge,
    card_number: cardNumber,
    number: cardNumber,
    set_printed_total: String(rawCard.set_printed_total || ''),
    tcgplayer_url: String(rawCard.tcgplayer_url || ''),
    price_source: String(rawCard.price_source || ''),
    tcg_type: String(rawCard.tcg_type || ''),
    tcg_stage: String(rawCard.tcg_stage || ''),
    rarity_type: String(rawCard.rarity_type || ''),
    tcg_supertype: String(rawCard.tcg_supertype || ''),
    tcg_hp: tcgHp,
    tcg_artist: String(rawCard.tcg_artist || ''),
    set_release_date: String(rawCard.set_release_date || ''),
    short_description: String(rawCard.short_description || rawCard.name || cleanName),
  };
}

export function getTCGCardResultKey(card: TCGCard) {
  if (card.product_id) {
    return `product:${card.product_id}`;
  }
  if (card.api_id) {
    return `api:${card.api_id}`;
  }
  return [
    card.clean_name,
    card.set_name || card.group_name,
    card.card_number || card.number,
    card.market_price || '',
    card.sub_type_name || card.tcg_subtypes,
  ].join('|').toLowerCase();
}

export function dedupeTCGCardResults(cards: TCGCard[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = getTCGCardResultKey(card);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function normalizeTCGCardResults(rawResults: unknown): TCGCard[] {
  if (!Array.isArray(rawResults)) {
    return [];
  }
  return dedupeTCGCardResults(rawResults.map((card) => normalizeTCGCard(card as Partial<TCGCard> & Record<string, unknown>)));
}

export async function fetchTCGCardResults(query: string, options?: { limit?: number; signal?: AbortSignal }) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const limit = Math.max(1, Math.min(options?.limit ?? 20, 50));
  const normalizedQuery = trimmedQuery.toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = `${normalizedQuery}|${limit}`;
  const now = Date.now();
  const cached = tcgSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.results;
  }

  const response = await axios.get(`${API}/api/inventory/tcg-search/`, {
    params: { q: trimmedQuery, limit },
    signal: options?.signal,
  });
  const results = normalizeTCGCardResults(response.data?.results ?? response.data ?? []);
  tcgSearchCache.set(cacheKey, {
    expiresAt: now + SEARCH_CACHE_TTL_MS,
    results,
  });
  return results;
}