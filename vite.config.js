import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Umrah Wallet',
        short_name: 'Umrah Wallet',
        description: 'Personal SAR wallet and expense tracker for Umrah',
        theme_color: '#090a0d',
        background_color: '#090a0d',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        categories: ['finance', 'productivity'],
      },
      workbox: {
        // Cache-first for all assets (app shell works offline)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Live exchange rate API — network-first, fall back to cache
            urlPattern: /^https:\/\/api\.exchangerate\.host\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'exchange-rate-api',
              expiration: { maxEntries: 10, maxAgeSeconds: 6 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],

  // Vitest configuration
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{js,jsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/services/**'],
    },
  },

  resolve: {
    alias: {
      '@': '/src',
    },
  },

  // Build config
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // Function form required — this Vite version's bundler rejects the
        // classic Rollup object-map form ("manualChunks is not a function").
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-router-dom') || id.includes('/react-dom/') || id.includes('/react/')) return 'vendor';
          if (id.includes('dexie')) return 'db';
          if (id.includes('decimal.js')) return 'math';
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'charts';
        },
      },
    },
  },
});
