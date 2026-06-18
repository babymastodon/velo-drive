import { defineConfig } from 'vitest/config';

// Unit / differential / property tests (Node + happy-dom). E2E lives in Playwright.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
