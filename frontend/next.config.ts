import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;
