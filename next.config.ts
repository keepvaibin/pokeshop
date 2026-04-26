import type { NextConfig } from "next";

if (!process.env.BACKEND_API_URL) {
  throw new Error('BACKEND_API_URL is required for Next.js API rewrites.');
}

const backendApiOrigin = process.env.BACKEND_API_URL.replace(/\/$/, '');
const apiHost = new URL(backendApiOrigin).hostname;

const nextConfig: NextConfig = {
  output: 'standalone',
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendApiOrigin}/api/:path*`,
      },
    ];
  },
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
