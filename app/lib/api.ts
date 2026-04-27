// Keep browser-originated API calls away from /api/* because browsers can
// retain permanent redirects for those exact URLs after a bad deploy.
export const API_BASE_URL = '/api-proxy';

export function apiUrl(path: string): string {
  if (!path) {
    return '/';
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === '/api' || normalized.startsWith('/api/')) {
    return `${API_BASE_URL}${normalized}`;
  }

  return normalized;
}