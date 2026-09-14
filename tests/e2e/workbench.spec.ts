import { test, expect, type Page } from '@playwright/test'

async function loadSample(page: Page, label: string) {
  await page.goto('/')
  await page.selectOption('.sample-pick select', { label })
  await expect(page.locator('[data-testid="filename"]')).toContainText('.json')
}

async function solve(page: Page) {
  await page.click('[data-testid="solve-btn"]')
}

test('常规样例：求解后切桥单给出实际桥位并可进入打印', async ({ page }) => {
  await loadSample(page, '常规纸盒刀版')
  await expect(page.locator('.cand-list li')).toHaveCount(6)
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：6 座桥')
  const rows = page.locator('[data-testid="cut-sheet"] .grid tbody tr')
  await expect(rows).toHaveCount(6)
  // 切桥单含坐标与弧长，是可嵌刀的实际数据而非占位
  await expect(rows.first()).toContainText('C1')
  await expect(page.locator('[data-testid="cut-sheet"] .verdict.ok')).toContainText('方案可行')
  await expect(page.locator('[data-testid="print-btn"]')).toBeVisible()
})

test('桥宽擦碰禁区：碰撞候选标红且被求解器排除', async ({ page }) => {
  await loadSample(page, '桥宽擦碰禁区')
  const collisionItem = page.locator('.cand-list li.collision', { hasText: 'C3' })
  await expect(collisionItem).toContainText('碰禁区 Z1')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：4 座桥')
  // C3 未被选中
  await expect(page.locator('.cand-list li', { hasText: 'C3' })).not.toHaveClass(/chosen/)
})

test('贪心失解：摊直贪心诊断失解，精确求解器仍给出可行 5 桥', async ({ page }) => {
  await loadSample(page, '贪心失解')
  await solve(page)
  await expect(page.locator('[data-testid="greedy-panel"] .bad-text')).toContainText('失解/不可行')
  await expect(page.locator('[data-testid="greedy-panel"] .bad-text')).toContainText('跨接缝')
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：5 座桥')
  const arcs = await page.locator('[data-testid="cut-sheet"] .grid tbody tr td:nth-child(3)').allTextContents()
  expect(arcs.map(Number)).toEqual([30, 76, 150, 224, 300])
})

test('跨接缝：画布突出跨接缝悬空段，且为最大悬空', async ({ page }) => {
  await loadSample(page, '跨接缝长悬空')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：4 座桥')
  await expect(page.locator('svg path.cross-seam')).toHaveCount(1)
  const title = await page.locator('svg path.cross-seam').getAttribute('title')
  expect(title).toContain('114.0')
  await expect(page.locator('[data-testid="cut-sheet"] tr.seamrow')).toHaveCount(1)
  await expect(page.locator('[data-testid="cut-sheet"] tr.seamrow td:nth-child(9)')).toHaveText('是')
})

test('无解：切桥单与画布见证阻止嵌刀；增大桥宽使全部候选碰撞后出现 no-candidate 见证', async ({ page }) => {
  await loadSample(page, '无解见证')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('无可行方案')
  await expect(page.locator('[data-testid="cut-sheet"] .verdict.bad')).toBeVisible()
  await expect(page.locator('svg path.witness').first()).toBeVisible()
  const witnessTypes = await page
    .locator('[data-testid="cut-sheet"] tbody tr td:first-child')
    .allTextContents()
  expect(witnessTypes.join('|')).toContain('悬空超长')
  expect(witnessTypes.join('|')).toContain('桥心距不足')

  // 桥宽覆盖整圈禁区后，候选全部碰撞
  await page.fill('[data-testid="in-width"]', '300')
  await page.dispatchEvent('[data-testid="in-width"]', 'change')
  await solve(page)
  await expect(page.locator('[data-testid="cut-sheet"] .verdict.bad')).toContainText('无可行桥位')
  await expect(page.locator('[data-testid="cut-sheet"]')).toContainText('无可选桥位')
})

test('画布校正：拖动候选后状态标记失效，复位恢复原始解', async ({ page }) => {
  await loadSample(page, '常规纸盒刀版')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：6 座桥')

  // 拖动第一个候选标记（C1 位于底边 s=20）向下偏移，重新投影仍在底边
  const mark = page.locator('g.cand', { hasText: 'C1' }).locator('.mark')
  const box = await mark.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 4, { steps: 6 })
  await page.mouse.up()

  await expect(page.locator('[data-testid="status"]')).toContainText('结果失效，请重新求解')
  await expect(page.locator('.cand-list li', { hasText: '校正' })).not.toHaveCount(0)

  // 复位后重新求解，恢复原始 6 桥
  await page.click('[data-testid="reset-btn"]')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：6 座桥')
  await expect(page.locator('.cand-list li', { hasText: '校正' })).toHaveCount(0)
})

test('导入错误：字段级错误定位到 contour 元素', async ({ page }) => {
  await page.goto('/')
  const bad = {
    job: '坏数据',
    contour: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: '十', y: 0 },
      { x: 0, y: 10 }
    ],
    seam: { x: 0, y: 0 },
    bridgeWidth: 2,
    minCenterDistance: 2,
    maxFreeLength: 5,
    candidates: []
  }
  await page.setInputFiles('input[type="file"]', {
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bad))
  })
  await expect(page.locator('[data-testid="import-errors"]')).toBeVisible()
  await expect(page.locator('[data-testid="import-errors"]')).toContainText('contour[2].x')
  await expect(page.locator('[data-testid="import-errors"]')).toContainText('轮廓元素 #2')
})
