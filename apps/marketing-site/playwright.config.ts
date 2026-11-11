import { defineConfig, devices } from '@playwright/test';

// Требует core-api + MongoDB запущенными отдельно (см. tests/e2e/README.md) — marketing-site
// как BFF без core-api не может зарегистрировать/залогинить клиента. Дев-сервер marketing-site
// сам поднимается ниже через webServer, если ещё не запущен.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
