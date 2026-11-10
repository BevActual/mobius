import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // A test, with its hooks, gets a minute at most; the whole run gets 45 minutes, so something slow everywhere
  // fails with a clear message instead of using up the CI job's time.
  timeout: 60_000,
  globalTimeout: 45 * 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
