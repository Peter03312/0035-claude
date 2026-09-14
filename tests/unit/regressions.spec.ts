import { describe, it, expect } from 'vitest'
import { importWork } from '../../src/lib/importJob'
import { solve, validateParams } from '../../src/lib/solver'
import { arcToPath } from '../../src/lib/svgPath'
import { cumulative } from '../../src/lib/geometry'
import { pointsToPath } from '../../src/lib/svgPath'
import type { RawWork } from '../../src/types'

const W = 100
const H = 60
const L = 320
const poly = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: H },
  { x: 0, y: H }
]
function rectPoint(s: number) {
  s = ((s % L) + L) % L
  if (s <= W) return { x: s, y: 0 }
  if (s <= W + H) return { x: W, y: s - W }
  if (s <= 2 * W + H) return { x: W - (s - W - H), y: H }
  return { x: 0, y: L - s }
}

function jobOverrides(p: {
  arcs?: number[]
  w?: number
  dMin?: number
  G?: number
  seamPoint?: { x: number; y: number }
  ids?: string[]
  forbidden?: { id?: string; fromS: number; toS: number }[]
}): RawWork {
  const arcs = p.arcs ?? [100]
  return {
    job: 't',
    contour: poly,
    seam: p.seamPoint ?? { x: 0, y: 0 },
    bridgeWidth: p.w ?? 6,
    minCenterDistance: p.dMin ?? 10,
    maxFreeLength: p.G ?? 400,
    candidates: arcs.map((s, i) => ({
      id: p.ids?.[i] ?? `C${i + 1}`,
      point: rectPoint(s)
    })),
    forbidden: (p.forbidden ?? []).map((z, i) => ({
      id: z.id ?? `Z${i}`,
      from: rectPoint(z.fromS),
      to: rectPoint(z.toS),
      reason: 'r'
    }))
  }
}

describe('1. 单桥整圈悬空不得为负', () => {
  it('spans 给出 L-w 而非 0-w', () => {
    const raw = jobOverrides({ arcs: [100], w: 6, dMin: 10, G: 400 })
    const { job } = importWork(raw)
    const r = solve(job!)
    expect(r.feasible).toBe(true)
    expect(r.count).toBe(1)
    expect(r.maxFree).toBeCloseTo(314, 9)
    expect(r.spans).toHaveLength(1)
    expect(r.spans[0].freeLength).toBeCloseTo(314, 9)
    expect(r.spans[0].centerDistance).toBeCloseTo(320, 9)
    expect(r.spans[0].crossesSeam).toBe(true)
    for (const sp of r.spans) expect(sp.freeLength).toBeGreaterThanOrEqual(0)
  })

  it('单桥超过最大悬空时不可行，见证净空为正的 L-w', () => {
    const raw = jobOverrides({ arcs: [100], w: 6, dMin: 10, G: 100 })
    const { job } = importWork(raw)
    const r = solve(job!)
    expect(r.feasible).toBe(false)
    const gap = r.witnesses.find((x) => x.kind === 'gap')!
    expect(gap.freeLength).toBeCloseTo(314, 9)
    expect(gap.freeLength).toBeGreaterThan(0)
  })
})

describe('2. 桥宽 ≥ 周长一律不可行（含 UI 覆盖路径）', () => {
  it('导入期报错', () => {
    const raw = jobOverrides({ arcs: [100], w: 320, dMin: 10, G: 400 })
    const { job, issues } = importWork(raw)
    expect(job).toBeNull()
    expect(issues.some((i) => i.path === 'bridgeWidth')).toBe(true)
  })

  it('validateParams 拒绝桥宽≥周长、桥心距<桥宽', () => {
    const eq = validateParams({ perimeter: 320, bridgeWidth: 320, minCenterDistance: 320, maxFreeLength: 400 })
    expect(eq.some((w) => w.message.includes('桥宽'))).toBe(true)
    const over = validateParams({ perimeter: 320, bridgeWidth: 400, minCenterDistance: 400, maxFreeLength: 400 })
    expect(over.some((w) => w.message.includes('桥宽'))).toBe(true)
    const d = validateParams({ perimeter: 320, bridgeWidth: 6, minCenterDistance: 4, maxFreeLength: 400 })
    expect(d.some((w) => w.message.includes('小于桥宽'))).toBe(true)
  })

  it('画布把桥宽调到 300（<周长但单桥净空超限）不得给出可行方案与负悬空', () => {
    const raw = jobOverrides({ arcs: [100], w: 6, dMin: 10, G: 400 })
    const { job } = importWork(raw)
    const wide = { ...job!, bridgeWidth: 300 }
    const r = solve(wide)
    expect(r.feasible).toBe(false)
    expect(r.witnesses.some((w) => w.kind === 'param')).toBe(true)
  })
})

describe('3. 轮廓外输入点：切桥坐标写入吸附点并告警', () => {
  it('远离轮廓的候选点吸附到轮廓，原始离群点不进入数据', () => {
    const raw = jobOverrides({})
    // (50,-300) 最近边为底边 y=0，垂足 (50,0)，偏离 300mm
    raw.candidates = [{ id: 'OFF', point: { x: 50, y: -300 } }]
    const { job, issues } = importWork(raw)
    expect(job).not.toBeNull()
    const c = job!.candidates[0]
    expect(c.point.y).toBeCloseTo(0, 9)
    expect(c.point.x).toBeCloseTo(50, 9)
    const warn = issues.find((i) => i.path === 'candidates[0].point')!
    expect(warn.level).toBe('warning')
    expect(warn.message).toContain('吸附')
  })

  it('近轮廓点（≤0.5mm）静默吸附，不告警', () => {
    const raw = jobOverrides({})
    raw.candidates = [{ id: 'NEAR', point: { x: 50, y: 0.2 } }]
    const { issues } = importWork(raw)
    expect(issues.some((i) => i.path === 'candidates[0].point')).toBe(false)
  })
})

describe('4/5. 弧段路径：不填充、接缝不在数组起点时短桥不画成整圈', () => {
  it('接缝偏移 130 时，6mm 桥的路径长度约 6mm', () => {
    const cum = cumulative(poly)
    const seam = 130 // 右边
    // 桥心环向 s=0，桥宽 6 → [-3,+3] 跨接缝
    const pts = arcToPath(poly, cum, seam, -3, 3)
    let length = 0
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
    expect(length).toBeCloseTo(6, 6)
    // 路径首尾应在接缝点附近（rectPoint(130) = (100,30)）
    expect(pts[0]).toEqual(expect.objectContaining({ x: 100 }))
  })

  it('跨接缝禁区段不绕整圈', () => {
    const cum = cumulative(poly)
    const pts = arcToPath(poly, cum, 130, 305, 325) // 环上 20mm 段跨缝
    let length = 0
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
    expect(length).toBeCloseTo(20, 6)
  })

  it('点串是开放折线（首点不闭合到尾点），配合 fill:none 不产生填充面', () => {
    const cum = cumulative(poly)
    const pts = arcToPath(poly, cum, 0, 10, 40)
    const d = pointsToPath(pts)
    expect(d.startsWith('M')).toBe(true)
    expect(d).not.toContain('Z')
  })
})

describe('6. 重复候选/禁区编号按错误拒绝', () => {
  it('候选 id 重复 -> 导入失败并定位字段', () => {
    const raw = jobOverrides({ arcs: [20, 80, 150], ids: ['A', 'A', 'B'] })
    const { job, issues } = importWork(raw)
    expect(job).toBeNull()
    const err = issues.find((i) => i.path === 'candidates[1].id')!
    expect(err).toBeTruthy()
    expect(err.message).toContain('重复')
  })

  it('禁区 id 重复同样报错', () => {
    const raw = jobOverrides({
      forbidden: [
        { id: 'Z', fromS: 10, toS: 20 },
        { id: 'Z', fromS: 40, toS: 50 }
      ]
    })
    const { issues } = importWork(raw)
    expect(issues.some((i) => i.path === 'forbidden[1].id')).toBe(true)
  })

  it('环向重合候选报错（切桥单不会两行同桥）', () => {
    const raw = jobOverrides({})
    raw.candidates = [
      { id: 'P1', point: rectPoint(50) },
      { id: 'P2', point: rectPoint(50 + 1e-7) }
    ]
    const { job } = importWork(raw)
    expect(job).toBeNull()
  })
})
