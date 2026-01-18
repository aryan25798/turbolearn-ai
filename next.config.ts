import type { NextConfig } from "next";

// Initialize PWA with caching settings
// @ts-ignore - next-pwa might miss types in some setups, require avoids ESM conflicts
const withPWA = require("next-pwa")({
  dest: "public",         // Where to save the service worker
  register: true,         // Auto-register the worker
  skipWaiting: true,      // Instantly update the app when you deploy changes
  disable: process.env.NODE_ENV === "development", // Disable in dev mode to avoid caching issues while coding
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This helps with speed by compressing assets (Gzip)
  compress: true, 
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**', // Allows external images (like user avatars) to load efficiently
      },
    ],
  },
};

// Wrap the config with PWA
export default withPWA(nextConfig);