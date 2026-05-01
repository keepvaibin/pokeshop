import { API_BASE_URL } from '@/app/lib/api';

let refreshPromise: Promise<string | null> | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function expiresWithin(token: string, seconds: number): boolean {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;
  if (!exp) return false;
  return exp * 1000 <= Date.now() + seconds * 1000;
}

export async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refresh = localStorage.getItem('refresh_token');
    if (!refresh) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      localStorage.setItem('access_token', data.access);
      if (data.refresh) localStorage.setItem('refresh_token', data.refresh);
      return data.access as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function getFreshAccessToken(minValiditySeconds = 120): Promise<string | null> {
  const access = localStorage.getItem('access_token');
  if (access && !expiresWithin(access, minValiditySeconds)) {
    return access;
  }
  return tryRefreshToken();
}
