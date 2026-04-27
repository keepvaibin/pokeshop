import type { NextConfig } from "next";

if (!process.env.BACKEND_API_URL) {
  throw new Error('BACKEND_API_URL is required for Next.js deployment.');
}

// Derive the Django origin for the Next.js image remote pattern allowlist.
// BACKEND_API_URL may be "https://host" or "https://host/api".
const apiHost = new URL(
  process.env.BACKEND_API_URL.replace(/\/+$/, '').replace(/\/api$/i, '')
).hostname;

const nextConfig: NextConfig = {
  output: 'standalone',
  // Prevents Next.js from 308-redirecting /api/foo/ → /api/foo. Combined with
  // proxy.ts this ensures the trailing slash reaches the Route Handler intact,
  // which then forwards it verbatim to Django (APPEND_SLASH=False, so Django
  // needs the trailing slash to match DRF DefaultRouter URL patterns).
  skipTrailingSlashRedirect: true,
  // API proxy is handled by the Route Handler at app/api/[...path]/route.ts.
  // That handler uses request.nextUrl.pathname which preserves trailing slashes,
  // unlike rewrites() which normalise them away before the upstream fetch.
  images: {
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: apiHost },
      { protocol: 'http', hostname: apiHost },
    ],
  },

};

export default nextConfig;
