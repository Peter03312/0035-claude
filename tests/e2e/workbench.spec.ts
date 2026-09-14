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

  // 桥宽覆盖整圈禁区后，候选全部碰撞；放宽桥心距/悬空，隔离“无可选桥位”这一见证
  await page.fill('[data-testid="in-width"]', '300')
  await page.dispatchEvent('[data-testid="in-width"]', 'change')
  await page.locator('.panel label', { hasText: '最小桥心距' }).locator('input').fill('300')
  await page.locator('.panel label', { hasText: '最大悬空' }).locator('input').fill('400')
  await page.locator('.panel label', { hasText: '最大悬空' }).locator('input').dispatchEvent('change')
  await solve(page)
  await expect(page.locator('[data-testid="cut-sheet"]')).toContainText('无可选桥位')
})

test('单桥：切桥单整圈悬空为正的 314mm，不出现负数', async ({ page }) => {
  await loadSample(page, '单桥整圈净长')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('可行方案：1 座桥')
  const freeCell = page.locator('[data-testid="cut-sheet"] .grid tbody tr td:nth-child(8)')
  const txt = await freeCell.textContent()
  expect(Number(txt)).toBeGreaterThan(0)
  expect(Number(txt)).toBeCloseTo(314, 1)
  await expect(page.locator('[data-testid="cut-sheet"] tr.seamrow')).toHaveCount(1)
})

test('桥宽≥周长：参数输入被拒绝；缩小悬空限值后不产生可行方案或负悬空', async ({ page }) => {
  await loadSample(page, '单桥整圈净长')
  await page.fill('[data-testid="in-width"]', '320')
  await page.dispatchEvent('[data-testid="in-width"]', 'change')
  await expect(page.locator('[data-testid="param-error"]')).toBeVisible()
  await expect(page.locator('[data-testid="param-error"]')).toContainText('小于周长')
  // 把最大悬空收到 10：单桥整圈净长 314，必然无解，且净长始终为正
  const gInput = page.locator('.panel label', { hasText: '最大悬空' }).locator('input')
  await gInput.fill('10')
  await gInput.dispatchEvent('change')
  await solve(page)
  await expect(page.locator('[data-testid="status"]')).toContainText('无可行方案')
  await expect(page.locator('[data-testid="cut-sheet"]')).toContainText('禁止嵌刀')
})

test('接缝不在数组起点：3mm 桥的高亮长度约 3mm，不遮挡整圈', async ({ page }) => {
  await loadSample(page, '接缝不在数组起点')
  await solve(page)
  // 已选桥覆盖只应是右侧边上的一小段；用路径点列总长度估算（≤6mm，而非 ~320mm）
  const d = await page.locator('svg path.bridge').first().getAttribute('d')
  const nums = d!.match(/[\d.]+/g)!.map(Number)
  let len = 0
  for (let i = 2; i + 1 < nums.length; i += 2) {
    len += Math.hypot(nums[i] - nums[i - 2], nums[i + 1] - nums[i - 1])
  }
  expect(len).toBeLessThan(8)
})

test('重复候选编号：导入被拒绝并定位到重复字段', async ({ page }) => {
  await page.goto('/')
  const bad = {
    job: 'dup',
    contour: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 }
    ],
    seam: { x: 0, y: 0 },
    bridgeWidth: 5,
    minCenterDistance: 10,
    maxFreeLength: 200,
    candidates: [
      { id: 'SAME', point: { x: 20, y: 0 } },
      { id: 'SAME', point: { x: 80, y: 0 } }
    ]
  }
  await page.setInputFiles('input[type="file"]', {
    name: 'dup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bad))
  })
  await expect(page.locator('[data-testid="import-errors"]')).toContainText('candidates[1].id')
  await expect(page.locator('[data-testid="import-errors"]')).toContainText('重复')
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
