import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // A test, with its hooks, gets a minute at most; the whole run gets 45 minutes, so something slow everywhere
  // fails with a clear message instead of using up the CI job's time.
  timeout: 60_000,
  globalTimeout: 45 * 60_000,
  workers: 1,
  fullyParallel: false,
  // In CI a failed test gets one more try. One that then passes still counts as a sighting of an unstable test: the
  // JSON report feeds the run summary (scripts/e2e-summary.mjs), so the table in docs/developers/testing.md is filled
  // from what CI saw.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'test-results/report.json' }]] : [['list']],
  // Stops a run that would drive a shell carrying an older interface than the one just built.
  ...(process.env.MOBIUS_E2E_ANY_BUILD || process.env.MOBIUS_E2E_LOCAL ? {} : { globalSetup: './e2e/stale-build.ts' }),
  // `npm run e2e:local`: the interface from the dev server, with the real host behind the dev bridge (e2e/dev-bridge.ts).
  ...(process.env.MOBIUS_E2E_LOCAL ? { webServer: { command: 'npx vite build && npx vite preview --host 127.0.0.1 --port 5199 --strictPort', url: 'http://127.0.0.1:5199/', reuseExistingServer: true, timeout: 180_000 } } : {}),
  use: { trace: 'retain-on-failure' },
});
