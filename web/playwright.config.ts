import { defineConfig, devices } from '@playwright/test'
import { port } from './e2e/instance'

// Browser smoke tests against a fresh local instance with synthetic data (see e2e/global-setup.ts).
// Build the program first: make build.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  // The tests share one instance and change its data.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/yuyan/`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } }],
})
