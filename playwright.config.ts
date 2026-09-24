import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Cloud sandbox ships Chromium here; locally Playwright uses its own download.
const sandboxChrome = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(sandboxChrome) ? { executablePath: sandboxChrome } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 412, height: 915 },
        launchOptions,
      },
    },
  ],
});
