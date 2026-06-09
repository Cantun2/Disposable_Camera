import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
