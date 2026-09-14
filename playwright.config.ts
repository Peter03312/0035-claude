import { defineConfig, devices } from '@playwright/test'

// verify 服务（docker compose run --rm verify）在容器内构建并预览后执行本套件。
// 本地开发可先 `npm run build && npm run preview`，再 `npm run test:e2e`。
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    timeout: 60_000,
    reuseExistingServer: true
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
