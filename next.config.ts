import type { NextConfig } from "next";

// Initialize PWA with caching settings
// @ts-ignore - next-pwa might miss types in some setups, require avoids ESM conflicts
const withPWA = require("next-pwa")({
  dest: "public",         // Where to save the service worker
  register: true,         // Auto-register the worker
  skipWaiting: true,      // Instantly update the app when you deploy changes
  
  // ✅ FIX 1: Enable PWA in development mode (as requested)
  disable: false, 
  
  // ✅ FIX 2: Exclude Next.js internal build manifests that cause the "snapshot resolve" error
  buildExcludes: [/middleware-manifest\.json$/, /app-build-manifest\.json$/],
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