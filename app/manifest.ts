import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TurboLearn AI',
    short_name: 'TurboLearn',
    description: 'Professional Dual-Core AI Tutor',
    start_url: '/',
    display: 'standalone',
    background_color: '#131314',
    theme_color: '#131314',
    orientation: 'portrait',
    // ✅ We point both sizes to your single icon.png
    icons: [
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}