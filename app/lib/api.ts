export const API_BASE_URL = '';

export function apiUrl(path: string): string {
  if (!path) {
    return '/';
  }

  return path.startsWith('/') ? path : `/${path}`;
}