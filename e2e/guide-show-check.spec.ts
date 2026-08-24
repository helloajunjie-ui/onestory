import { test, expect, type Page } from '@playwright/test'

/**
 * 引导页显示专项排查测试。
 *
 * 覆盖两条路径：
 *   A. 从首页新建剧本并带引导页 → 新开存档 → 验证引导页 iframe 及其内容可见
 *   B. 引导页为完整 HTML 文档（含 <html>/<body>）时，剥离逻辑是否正确、内容是否可见
 *
 * 前置：Playwright 会自行启动独立的测试服务（http://localhost:8099，数据目录 data-e2e）。
 */

const BASE = 'http://localhost:8099'

/** 预置 AI 配置到服务端（新架构配置存 Go 后端 SQLite） */
async function seedAIConfig(page: Page) {
  await page.request.put(`${BASE}/api/settings/ai`, {
    data: {
      baseUrl: 'https://mock-api.example.com/v1',
      apiKey: 'mock-key',
      model: 'mock-model',
      breakPrompt: '',
    },
  })
}

/** 从首页新建剧本并填写引导页（支持完整 HTML 文档形态） */
async function createScriptWithGuide(page: Page, guideHtml: string) {
  await page.goto(`${BASE}/`)
  await page.getByRole('button', { name: /新建剧本|创建第一个剧本/ }).first().click()
  await page.waitForURL(/\/editor\?id=new/)

  await page.getByPlaceholder('输入剧本标题').fill('引导页排查剧本')
  await page.getByRole('tab', { name: /引导页/ }).click()
  await page.getByPlaceholder(/创建角色/).fill(guideHtml)

  await page.getByRole('button', { name: /保存/ }).click()
  await page.waitForURL(/\/editor\?id=[^&]+/)

  // 预览 → 无存档自动创建新档并进入对话页（引导页流程）
  await page.getByRole('button', { name: /预览/ }).click()
  await page.waitForURL(/\/play\/save\?id=[^&]+&save=[^&]+$/)
}

test('路径A：新开存档，引导页 iframe 及内容可见', async ({ page }) => {
  await seedAIConfig(page)
  await createScriptWithGuide(
    page,
    '<div class="char-create"><h1>创建角色</h1><input type="text" id="name" /><button onclick="submit()">开始游戏</button></div>'
  )

  const frame = page.frameLocator('iframe')
  await expect(frame.locator('body')).toBeVisible({ timeout: 10_000 })
  await expect(frame.getByText('创建角色')).toBeVisible({ timeout: 10_000 })
  await expect(frame.locator('#name')).toBeVisible({ timeout: 10_000 })
})

test('路径B：引导页为完整 HTML 文档时，剥离后内容可见', async ({ page }) => {
  await seedAIConfig(page)
  await createScriptWithGuide(
    page,
    '<!DOCTYPE html><html><head><style>h1{color:#f59e0b}</style></head><body><div class="char-create"><h1>完整文档引导</h1><input type="text" id="hero" /><button>确认</button></div></body></html>'
  )

  const frame = page.frameLocator('iframe')
  await expect(frame.locator('body')).toBeVisible({ timeout: 10_000 })
  await expect(frame.getByText('完整文档引导')).toBeVisible({ timeout: 10_000 })
  await expect(frame.locator('#hero')).toBeVisible({ timeout: 10_000 })
})
