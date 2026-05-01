import { apiUrl } from '@/app/lib/api';
import { getFreshAccessToken, tryRefreshToken } from '@/app/lib/auth-refresh';

export const publicFetcher = (path: string) =>
  fetch(apiUrl(path)).then(r => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });

export const authedFetcher = async (path: string) => {
  const token = typeof window !== 'undefined' ? await getFreshAccessToken() : null;
  const res = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    const newToken = await tryRefreshToken();
    if (newToken) {
      const retry = await fetch(apiUrl(path), {
        headers: { Authorization: `Bearer ${newToken}` },
      });
      if (!retry.ok) throw new Error(`${retry.status}`);
      return retry.json();
    }
  }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};
