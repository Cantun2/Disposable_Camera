import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Auto-update the service worker in the background; we surface a refresh
      // via registerSW() in main.tsx. SW is registered manually there.
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: [
        'camera.svg',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: 'Wedding Disposable',
        short_name: 'Wedding Cam',
        description:
          'A zero-friction disposable camera for your wedding — shoot vintage film photos and watch the gallery fill up live.',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        categories: ['photo', 'lifestyle', 'social'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App-shell offline caching: precache the built JS/CSS/HTML + fonts +
        // icons so the shell loads with no network. SPA fallback to index.html.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Keep the SW off in `vite dev` (avoids stale-cache surprises while
        // developing); it is generated for `vite build` / `vite preview`.
        enabled: false,
      },
    }),
  ],
  server: {
    // getUserMedia requires a secure context. localhost counts as secure,
    // but to test on a real phone over the LAN you need HTTPS.
    // Run `vite --host` and use a tunnel (ngrok/cloudflared) or `@vitejs/plugin-basic-ssl`.
    host: true,
    // Allow phone-testing tunnels to reach the dev server (Vite blocks unknown
    // Host headers by default). Cloudflare quick tunnels use *.trycloudflare.com.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
  },
})
