// ============================================================
// Playwright — E2E-тесты сайта cfd-course
// ------------------------------------------------------------
// Сценарий запуска (npm run test:e2e):
//   1) firebase emulators:exec поднимает auth/firestore/storage,
//   2) внутри exec запускается vitest? нет — playwright test.
// Локально: перед тестами нужен эмулятор + статик-сервер на 5555.
// В webServer ниже поднимается http-server статики; эмулятор
// поднимает scripts/e2e-run.mjs (обёртка над emulators:exec).
// ============================================================
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5555',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
    // ставим localStorage до загрузки первой страницы —
    // firebase-config.js увидит флаг и подключит эмуляторы.
    storageState: undefined,
  },
  webServer: {
    command: 'node node_modules/http-server/bin/http-server . -p 5555 -c-1 --silent',
    port: 5555,
    reuseExistingServer: true,
    timeout: 20_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
