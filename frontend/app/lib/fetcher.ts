const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const publicFetcher = (path: string) =>
  fetch(`${API}${path}`).then(r => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });

export const authedFetcher = (path: string) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  return fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
};
