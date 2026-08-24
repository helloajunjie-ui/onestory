import { test, expect } from '@playwright/test'

// 编辑器引导页预览渲染检查（固定高度框架内显示）
test('编辑器引导页预览渲染检查（固定高度框架）', async ({ page }) => {
  await page.goto('http://localhost:8099/editor?id=new')
  await page.waitForTimeout(1500)

  await page.getByRole('tab', { name: /引导页/ }).click()
  await page.waitForTimeout(500)

  const textarea = page.locator('textarea').last()
  const iframe = page.locator('iframe[title="guide-preview"]')

  // 场景1：完整 HTML 文档（含 html/head/style/body）
  await textarea.fill(`<!DOCTYPE html>
<html>
<head>
  <style>
    .hero { background: #1e293b; padding: 20px; border-radius: 8px; }
    .hero h1 { color: #f59e0b; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>完整文档测试</h1>
    <p>这是完整 HTML 文档的 body 内容，应该被正确剥离并渲染。</p>
  </div>
</body>
</html>`)
  await page.waitForTimeout(800)

  let count = await iframe.count()
  console.log('场景1 完整文档 iframe count:', count)
  if (count > 0) {
    const handle = await iframe.first().elementHandle()
    const frame = await handle?.contentFrame()
    if (frame) {
      await page.waitForTimeout(500)
      const bodyText = await frame.locator('body').innerText()
      console.log('场景1 body text:', JSON.stringify(bodyText))
      const h1 = await frame.locator('h1').count()
      console.log('场景1 h1 count:', h1)
      const heroBg = await frame.locator('.hero').evaluate((el) => getComputedStyle(el).backgroundColor)
      console.log('场景1 .hero background:', heroBg)
    }
    // 固定高度：iframe 高度应为 100%（填满容器）
    const height = await iframe.first().evaluate((el) => (el as HTMLIFrameElement).style.height)
    console.log('场景1 iframe style.height:', height)
    expect(height).toBe('100%')
  }

  // 场景2：内容变化后 iframe 高度应保持 100%（固定），内容在 iframe 内部滚动
  await textarea.fill(`<p>短内容</p>`)
  await page.waitForTimeout(600)
  const hShort = await iframe.first().evaluate((el) => (el as HTMLIFrameElement).style.height)
  console.log('场景2 短内容 height:', hShort)
  expect(hShort).toBe('100%')

  const longContent = Array.from({ length: 30 }, (_, i) => `<p>第${i + 1}段很长的内容，用于测试内容是否在 iframe 内部滚动。</p>`).join('\n')
  await textarea.fill(longContent)
  await page.waitForTimeout(800)
  const hLong = await iframe.first().evaluate((el) => (el as HTMLIFrameElement).style.height)
  console.log('场景2 长内容 height:', hLong)
  expect(hLong).toBe('100%')

  // 验证 iframe 实际渲染高度（offsetHeight）填满容器，且大于 0
  const offsetHeight = await iframe.first().evaluate((el) => (el as HTMLIFrameElement).offsetHeight)
  console.log('iframe offsetHeight:', offsetHeight)
  expect(offsetHeight).toBeGreaterThan(100)

  // 验证 iframe 内部滚动：长内容时 body.scrollHeight > clientHeight
  const handle2 = await iframe.first().elementHandle()
  const frame2 = await handle2?.contentFrame()
  if (frame2) {
    const scrollMetrics = await frame2.evaluate(() => {
      const body = document.body
      return {
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        overflowY: getComputedStyle(body).overflowY,
      }
    })
    console.log('iframe 内部滚动指标:', JSON.stringify(scrollMetrics))
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
  }

  await page.screenshot({ path: 'test-results/guide-preview.png', fullPage: true })
})
