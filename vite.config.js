import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',

      // Pre-cache the app shell and all built assets
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],

      manifest: {
        name:             'STR/VOL Tracker',
        short_name:       'STR/VOL',
        description:      'Industrial strength & volume tracker with AI coaching.',
        theme_color:      '#09090b',
        background_color: '#09090b',
        display:          'standalone',
        orientation:      'portrait',
        scope:            '/',
        start_url:        '/',
        icons: [
          {
            src:   'pwa-192x192.png',
            sizes: '192x192',
            type:  'image/png',
          },
          {
            src:   'pwa-512x512.png',
            sizes: '512x512',
            type:  'image/png',
          },
          {
            // Maskable variant lets Android crop the icon
            // into a circle / squircle without white bars
            src:     'pwa-512x512.png',
            sizes:   '512x512',
            type:    'image/png',
            purpose: 'maskable',
          },
        ],
      },

      // Workbox strategy: cache the app shell with
      // network-first for API calls, cache-first for assets
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Supabase API — network-first so data is always fresh,
            // falls back to cache when offline
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName:         'supabase-api-cache',
              expiration:        { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts — cache-first, they never change
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler:    'CacheFirst',
            options: {
              cacheName:         'google-fonts-cache',
              expiration:        { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})