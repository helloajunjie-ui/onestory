import { test, expect, type Page } from '@playwright/test'

/**
 * PLAY 页 useChatEngine 接入冒烟测试。
 *
 * 策略：用 page.route 拦截 AI API 请求（/api/ai/chat/completions），返回 mock 的 SSE 流式响应，
 * 从而在不依赖真实 API key 的情况下，完整验证 4 场景（发送/引导页/重新生成/编辑保存）
 * 的前端逻辑是否正确调用 useChatEngine 并渲染结果。
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

/** 拦截 AI API，返回 mock 的 SSE 流式响应 */
function mockChatCompletions(page: Page, replyText: string) {
  return page.route('**/chat/completions', async (route) => {
    const chunks = replyText.split('')
    let body = ''
    chunks.forEach((ch, i) => {
      body += `data: ${JSON.stringify({
        choices: [{ delta: { content: ch }, index: 0 }],
      })}\n\n`
      if (i === chunks.length - 1) {
        body += 'data: [DONE]\n\n'
      }
    })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' },
      body,
    })
  })
}

/** 从首页开始，创建剧本并进入对话页，返回 scriptId 和 saveId */
async function createScriptAndEnterConversation(page: Page) {
  // 首页 → 新建剧本（query 参数路由）
  await page.goto(`${BASE}/`)
  await page.getByRole('button', { name: /新建剧本|创建第一个剧本/ }).first().click()
  await page.waitForURL(/\/editor\?id=new/)

  // 填写标题和提示词
  await page.getByPlaceholder('输入剧本标题').fill('冒烟测试剧本')
  // 提示词在 Tabs 的 prompt 面板中
  await page.getByRole('tab', { name: '提示词' }).click()
  await page.getByPlaceholder(/世界观设定/).fill('你是一个测试助手，请简短回复。')

  // 填写引导页 HTML（新存档时会自动触发引导页 iframe）
  await page.getByRole('tab', { name: /引导页/ }).click()
  await page.getByPlaceholder(/创建角色/).fill(
    '<div class="char-create"><h1>创建角色</h1><input type="text" id="name" /><button onclick="submit()">开始游戏</button></div>'
  )

  // 保存
  await page.getByRole('button', { name: /保存/ }).click()
  await page.waitForURL(/\/editor\?id=[^&]+/)

  // 预览 → 无存档自动创建新档并进入对话页（引导页流程）
  await page.getByRole('button', { name: /预览/ }).click()
  await page.waitForURL(/\/play\/save\?id=[^&]+&save=[^&]+$/)
}

test('4 场景冒烟：引导页 / 发送 / 重新生成 / 编辑保存', async ({ page }) => {
  await seedAIConfig(page)
  await mockChatCompletions(page, '这是AI的回复内容。')

  await createScriptAndEnterConversation(page)

  // ===== 场景 1：引导页（新存档且 history 为空时自动触发）=====
  await expect(page.locator('iframe')).toBeVisible({ timeout: 10_000 })
  // 引导页 iframe 提交角色数据
  const frame = page.frameLocator('iframe')
  await frame.locator('body').evaluate((body) => {
    window.parent.postMessage({ type: 'ink-tavern-submit', data: { 角色: '勇者' } }, '*')
  })
  // 引导提交后触发 AI 开场回复（复用 mock）
  await expect(page.getByText('这是AI的回复内容。')).toBeVisible({ timeout: 15_000 })

  // ===== 场景 2：发送 =====
  const input = page.getByPlaceholder(/输入你的行动或对话/)
  await input.fill('你好，开始冒险')
  await page.getByRole('button', { name: '发送' }).click()

  // 等待 AI 回复渲染（流式结束后）
  await expect(page.getByText('这是AI的回复内容。').last()).toBeVisible({ timeout: 15_000 })

  // ===== 场景 3：重新生成 =====
  await page.getByTitle('重新生成 AI 回复').last().click()
  // 自研 ConfirmDialog 确认（替代原生 confirm）
  await page.getByRole('button', { name: '重新生成', exact: true }).click()
  // 等待新的 AI 回复
  await expect(page.getByText('这是AI的回复内容。').last()).toBeVisible({ timeout: 15_000 })

  // ===== 场景 4：编辑保存 =====
  await page.getByTitle('编辑本条消息').last().click()
  // 编辑 textarea 处于 focus 状态
  const editArea = page.locator('textarea:focus')
  await editArea.fill('编辑后的消息内容')
  await page.getByRole('button', { name: /保存/ }).last().click()
  // 等待编辑保存后的 AI 回复
  await expect(page.getByText('这是AI的回复内容。').last()).toBeVisible({ timeout: 15_000 })

  // 最终断言：页面无错误
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})
