import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3310);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4310);

/**
 * 종단 테스트는 API와 웹을 직접 띄운다.
 * 오프라인 모드라 API 키가 없어도 돌아간다 — 흐름만 본다.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx tsx apps/api/src/index.ts`,
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        SKYCUT_OFFLINE: '1',
        SKYCUT_API_PORT: String(API_PORT),
        SKYCUT_DATA_DIR: 'out/e2e/api',
        SKYCUT_DOWNLOAD_DIR: 'out/e2e/shorts',
      },
    },
    {
      command: `npx next start apps/web -p ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // rewrites는 서버가 뜰 때 읽으므로 빌드를 다시 하지 않아도 된다
      env: { SKYCUT_API_ORIGIN: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
