import { apiUrl } from '@/app/lib/api';

export function buildItemsUrl(
  categorySlug: string,
  searchParams?: Record<string, string | string[] | undefined>,
  lockSort?: boolean,
): string {
  const p = new URLSearchParams();
  if (categorySlug) p.set('category', categorySlug);
  if (lockSort) p.set('sort', 'newest');

  if (searchParams) {
    const keys = ['sort', 'q', 'min_price', 'max_price', 'tag', 'tcg_type',
      'tcg_stage', 'rarity_type', 'tcg_supertype', 'subcategory', 'tcg_set_name', 'tcg_artist', 'in_stock', 'page'];
    for (const key of keys) {
      if (lockSort && key === 'sort') continue;
      const val = searchParams[key];
      if (val !== undefined) {
        if (Array.isArray(val)) val.forEach(v => p.append(key, v));
        else p.set(key, val);
      }
    }
  }

  const qs = p.toString();
  return apiUrl(`/api/inventory/items/${qs ? `?${qs}` : ''}`);
}

export async function fetchItems(
  categorySlug: string,
  searchParams?: Record<string, string | string[] | undefined>,
  lockSort?: boolean,
) {
  try {
    const url = buildItemsUrl(categorySlug, searchParams, lockSort);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchCategories() {
  try {
    const res = await fetch(apiUrl('/api/inventory/categories/'), { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchItem(slug: string) {
  try {
    const res = await fetch(apiUrl(`/api/inventory/items/${slug}/`), { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchHomepageSections() {
  try {
    const res = await fetch(apiUrl('/api/inventory/homepage-sections/'), { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchSettings() {
  try {
    const res = await fetch(apiUrl('/api/inventory/settings/'), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
