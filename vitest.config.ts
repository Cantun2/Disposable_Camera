import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts (owned by the design/build agent) on
// purpose. Tests run in plain Node — browser globals (localStorage, fetch) are
// stubbed per-test — so they stay fast and need no jsdom dependency.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
