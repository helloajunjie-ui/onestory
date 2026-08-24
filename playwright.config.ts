import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 冒烟测试配置。
 * 使用系统已安装的 Chrome（channel: 'chrome'），避免下载 Chromium。
 * 目标：验证 Go 后端 + Vue 前端下 PLAY 页 4 场景
 * （发送/引导页/重新生成/编辑保存）的 useChatEngine 接入是否正常。
 * Playwright 会自动启动独立的测试服务（:8099，独立数据目录 data-e2e）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  // e2e 使用独立的测试服务（端口 8099 + 独立数据目录 data-e2e），
  // 避免污染开发数据（如设置页保存的 AI 配置）
  webServer: {
    command: 'cd client/server && go run . -port 8099 -data ./data-e2e',
    url: 'http://localhost:8099/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://localhost:8099',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
