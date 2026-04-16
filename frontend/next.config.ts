import type { NextConfig } from "next";

const apiHost = process.env.NEXT_PUBLIC_API_URL
  ? new URL(process.env.NEXT_PUBLIC_API_URL).hostname
  : 'localhost';

const nextConfig: NextConfig = {
  images: {
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
