export interface StorefrontItemImage {
  id?: number;
  url: string;
  position?: number;
}

export interface StorefrontScheduledDrop {
  id: number;
  quantity: number;
  drop_time: string;
  is_processed: boolean;
}

export interface StorefrontItem {
  id: number;
  title: string;
  slug: string;
  description?: string;
  short_description?: string;
  price: number | string;
  image_path?: string;
  stock: number;
  max_per_user?: number;
  images: StorefrontItemImage[];
  scheduled_drops?: StorefrontScheduledDrop[];
  published_at?: string | null;
  is_holofoil?: boolean;
  rarity?: string;
  category_slug?: string;
  tcg_type?: string;
  tcg_stage?: string;
  rarity_type?: string;
  tcg_supertype?: string;
  tcg_set_name?: string;
  tcg_artist?: string;
}

export function hasPerUserLimit(maxPerUser?: number | null) {
  return typeof maxPerUser === 'number' && maxPerUser > 0;
}

export function resolvePurchaseCap(stock: number, maxPerUser?: number | null, remaining?: number | null) {
  if (typeof remaining === 'number') {
    return Math.max(0, Math.min(stock, remaining));
  }

  if (hasPerUserLimit(maxPerUser)) {
    return Math.max(0, Math.min(stock, maxPerUser!));
  }

  return Math.max(0, stock);
}

export function formatPerUserLimit(maxPerUser?: number | null) {
  return hasPerUserLimit(maxPerUser) ? String(maxPerUser) : 'No limit';
}