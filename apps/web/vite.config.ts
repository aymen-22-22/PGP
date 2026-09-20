import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Phone ERP',
        short_name: 'Phone ERP',
        description: 'Warehouse and distribution management with IMEI traceability',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline shell only. Business data is never served from cache, because a
        // stale stock figure is worse than an honest "you are offline".
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Navigations to /api must not be answered with the app shell.
        navigateFallbackDenylist: [/^\/api/],
        // Deliberately no runtimeCaching rule for /api.
        //
        // A request that matches no rule is never handled by the service worker
        // at all, so it goes straight to the network and is never cached — the
        // guarantee we want. An explicit NetworkOnly rule would achieve the same
        // caching behaviour but put workbox in the path of every API call, and
        // on a failed request it rejects with `no-response`, which surfaces as
        // an uncaught promise rejection and hides the app's own "you are
        // offline" handling behind console noise.
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_DEV_API ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keeps the initial download small on a warehouse phone.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
