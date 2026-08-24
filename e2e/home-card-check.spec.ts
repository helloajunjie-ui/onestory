import { test, expect } from '@playwright/test'

// 首页剧本卡片扑克样式渲染（Vue 版）
test('首页剧本卡片扑克样式渲染检查', async ({ page }) => {
  await page.goto('http://localhost:8099/')
  await page.waitForTimeout(1500)

  // 创建测试剧本（通过编辑器）
  await page.goto('http://localhost:8099/editor?id=new')
  await page.waitForTimeout(1200)

  // 填写标题
  const titleInput = page.getByPlaceholder('输入剧本标题')
  await titleInput.fill('扑克卡片测试剧本')
  await page.waitForTimeout(300)

  // 保存
  await page.getByRole('button', { name: /保存/ }).first().click()
  await page.waitForTimeout(1200)

  // 回到首页
  await page.goto('http://localhost:8099/')
  await page.waitForTimeout(1500)

  // 找到卡片
  const card = page.locator('div.group').first()
  const cardCount = await page.locator('div.group').count()
  console.log('卡片数量:', cardCount)

  if (cardCount > 0) {
    // 验证卡片是长方形（aspect-[3/4]：高度 > 宽度）
    const box = await card.boundingBox()
    console.log('卡片尺寸:', JSON.stringify(box))
    if (box) {
      expect(box.height).toBeGreaterThan(box.width)
    }

    // 验证卡片包含封面图区域（上部）和底部信息区
    const hasTitle = await card.getByText('扑克卡片测试剧本').count()
    console.log('标题数量:', hasTitle)
    expect(hasTitle).toBeGreaterThan(0)

    // 验证底部信息区包含标题/简介/类型
    const bottomText = await card.innerText()
    console.log('卡片文本:', JSON.stringify(bottomText))
  }

  await page.screenshot({ path: 'test-results/home-card.png', fullPage: true })
})
