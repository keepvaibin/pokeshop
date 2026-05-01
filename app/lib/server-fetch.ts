// ---------------------------------------------------------------------------
// Server-side helpers (Server Components only)
// ---------------------------------------------------------------------------
// On the server, we call Django directly using BACKEND_API_URL so that the
// request never loops back through the Next.js routing/rewrite layer.
// Going through the rewrite would trigger Next.js's trailing-slash redirect
// (308 → strip slash) even when skipTrailingSlashRedirect is set, because
// that flag only activates when a middleware.ts is present *and* the request
// arrives over the network — not for in-process server-to-server loopback.
//
// BACKEND_API_URL may be "https://api.example.com" or "https://api.example.com/api".
// We normalise to the origin only (strip trailing /api if present).
function getDjangoBase(): string {
  const raw = (process.env.BACKEND_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
  return raw.replace(/\/api$/i, '');
}

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
      'tcg_stage', 'rarity_type', 'rarity', 'tcg_supertype', 'tcg_subtype',
      'regulation_mark', 'standard_legal', 'subcategory', 'tcg_set_name', 'tcg_artist', 'in_stock', 'home_feed', 'page'];
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
  // Use Django base directly — trailing slash on the items path so DRF DefaultRouter matches.
  return `${getDjangoBase()}/api/inventory/items/${qs ? `?${qs}` : ''}`;
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
    const res = await fetch(`${getDjangoBase()}/api/inventory/categories/`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchItem(slug: string) {
  try {
    const res = await fetch(`${getDjangoBase()}/api/inventory/items/${slug}/`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchHomepageSections() {
  try {
    const res = await fetch(`${getDjangoBase()}/api/inventory/homepage-sections/`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchSettings() {
  try {
    const res = await fetch(`${getDjangoBase()}/api/inventory/settings/`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
