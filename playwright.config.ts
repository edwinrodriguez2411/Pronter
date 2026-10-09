import { defineConfig } from '@playwright/test';

const deployedURL = process.env.PRONTER_E2E_URL;
const baseURL = deployedURL ? new URL(deployedURL).origin : 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: { baseURL, headless: true, screenshot: 'only-on-failure' },
  webServer: deployedURL ? undefined : { command: 'npm start', url: `${baseURL}/api/health`, reuseExistingServer: !process.env.CI, timeout: 30000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
