import { defineConfig } from '@playwright/test';

// One app on one temporary project for the whole run: tests reset its files and run one at a time.
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  use: { baseURL: process.env.REVIEW_URL },
});
