import { test, expect } from '@playwright/test'

/**
 * 验证 Go 服务 SPA fallback 下任意路径都回退到 index.html 且 Vue 成功挂载。
 */
const BASE = 'http://localhost:8099'

for (const path of ['/editor/abc-real-id', '/play/abc-real-id']) {
  test(`SPA fallback 渲染: ${path}`, async ({ page }) => {
    await page.goto(`${BASE}${path}`)
    // fallback 返回 index.html，Vue 客户端应成功挂载 #app
    await expect(page.locator('#app')).toBeAttached({ timeout: 10_000 })
    const url = page.url()
    expect(url).toContain(path)
  })
}
