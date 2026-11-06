import { defineConfig } from 'vitest/config';

// Playwright owns e2e/. Vitest only runs unit tests.
export default defineConfig({ test: { include: ['src/**/*.test.{ts,tsx}'], exclude: ['e2e/**', 'node_modules/**'] } });
