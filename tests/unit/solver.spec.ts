import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importWork } from '../../src/lib/importJob'
import { solve, linearGreedy } from '../../src/lib/solver'
import { arcToPoint, cumulative, projectOnClosed, wrap } from '../../src/lib/geometry'
import { footprintHitsZone, makeZone } from '../../src/lib/arcs'
import type { RawWork } from '../../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const samples = resolve(here, '..', '..', 'public', 'samples')

function load(file: string) {
  const raw = JSON.parse(readFileSync(resolve(samples, file), 'utf8'))
  const { job, issues } = importWork(raw)
  return { raw, job, issues }
}

function expectFeasible(file: string) {
  const { job, issues } = load(file)
  expect(issues.filter((i) => i.level === 'error')).toEqual([])
  expect(job).not.toBeNull()
  const r = solve(job!)
  expect(r.feasible).toBe(true)
  return { job: job!, r }
}

describe('几何归一化', () => {
  it('投影与弧长往返一致', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
    const cum = cumulative(poly)
    expect(cum[cum.length - 1]).toBeCloseTo(40, 9)
    const pr = projectOnClosed(poly, { x: 3, y: -2 })
    expect(pr.offset).toBeCloseTo(3, 9)
    expect(pr.edgeIndex).toBe(0)
    const back = arcToPoint(poly, cum, 0, 12)
    expect(back.x).toBeCloseTo(10, 9)
    expect(back.y).toBeCloseTo(2, 9)
    expect(wrap(-0.5, 40)).toBeCloseTo(39.5, 9)
  })

  it('轮廓数组换起点不改变归一化结果（接缝由世界坐标独立确定）', () => {
    const { raw, job } = load('greedy-fail.json')
    const r1 = solve(job!)
    const seq1 = r1.bridges.map((b) => b.s)

    // 把 contour 旋转两个顶点（世界形状不变），接缝与候选仍以世界点给出
    const c = raw.contour as { x: number; y: number }[]
    const rotated: RawWork = {
      ...raw,
      contour: c.slice(2).concat(c.slice(0, 2))
    }
    const out2 = importWork(rotated)
    expect(out2.issues.filter((i) => i.level === 'error')).toEqual([])
    const r2 = solve(out2.job!)
    const seq2 = r2.bridges.map((b) => b.s)
    expect(seq2.map((x) => Math.round(x * 1e6))).toEqual(seq1.map((x) => Math.round(x * 1e6)))
    expect(r2.count).toBe(r1.count)
    expect(r2.maxFree).toBeCloseTo(r1.maxFree!, 9)
  })

  it('接缝不在 contour[0] 时，旋转轮廓 + 同步旋转索引式候选/禁区仍归一化不变', () => {
    // cross-seam 样例：seam 位于 (0,0)；构造 seam 落在矩形长边中部的独立数据
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 }
    ]
    const make = (rotated: boolean) => {
      const c = rotated ? poly.slice(1).concat(poly.slice(0, 1)) : poly
      return {
        job: 'rotate',
        contour: c,
        seam: { x: 50, y: 0 }, // 世界固定，不随数组起点走
        bridgeWidth: 6,
        minCenterDistance: 20,
        maxFreeLength: 80,
        candidates: [{ point: { x: 90, y: 0 } }, { point: { x: 100, y: 40 } }, { point: { x: 10, y: 60 } }],
        forbidden: [{ from: { x: 40, y: 60 }, to: { x: 20, y: 60 }, reason: '跨缝禁区' }]
      }
    }
    const a = importWork(make(false))
    const b = importWork(make(true))
    expect(a.job).not.toBeNull()
    expect(b.job).not.toBeNull()
    const sa = solve(a.job!).bridges.map((x) => Math.round(x.s * 1e6))
    const sb = solve(b.job!).bridges.map((x) => Math.round(x.s * 1e6))
    expect(sb).toEqual(sa)
    // 接缝弧长 s=0 必须对应世界点 (50,0)
    expect(a.job!.seamPoint.x).toBeCloseTo(50, 9)
    expect(b.job!.seamPoint.x).toBeCloseTo(50, 9)
  })
})

describe('桥宽擦碰禁区（端点相接也算）', () => {
  const L = 320
  const zone = makeZone('z', 100, 120, L, 't')
  it('覆盖区间端点相接判定为碰撞', () => {
    expect(footprintHitsZone(97, 6, zone, L)).toBe(true) // [94,100] 碰端点 100
    expect(footprintHitsZone(93, 6, zone, L)).toBe(false) // [90,96]
    expect(footprintHitsZone(123, 6, zone, L)).toBe(true) // [120,126] 碰端点 120
  })
  it('跨接缝禁区与跨接缝桥宽覆盖同样判定', () => {
    const wrapZone = makeZone('z', 310, 10, L, 't')
    expect(wrapZone.wraps).toBe(true)
    expect(footprintHitsZone(317, 6, wrapZone, L)).toBe(true) // [314,320] 与 [310,320]
    expect(footprintHitsZone(5, 6, wrapZone, L)).toBe(true) // [2,8] 与 [0,10]
    expect(footprintHitsZone(100, 6, wrapZone, L)).toBe(false)
  })
  it('forbidden-touch 样例：C3 被禁区擦边淘汰，方案仍可行且不含 C3', () => {
    const { job, r } = expectFeasible('forbidden-touch.json')
    const c3 = job.candidates.find((c) => c.id === 'C3')!
    expect(c3.collides).toContain('Z1')
    expect(r.bridges.find((b) => b.candidateId === 'C3')).toBeUndefined()
    expect(r.count).toBe(4)
  })
})

describe('贪心失解样例', () => {
  it('摊直贪心闭合失败，但精确解 5 桥唯一最优', () => {
    const { job, r } = expectFeasible('greedy-fail.json')
    const arcs = job.candidates
      .filter((c) => c.collides.length === 0)
      .map((c) => c.s)
      .sort((a, b) => a - b)
    const g = linearGreedy(arcs, job.perimeter, job.bridgeWidth, job.minCenterDistance, job.maxFreeLength)
    expect(g.valid).toBe(false)
    // 闭合桥心距 20 < dMin：摊直贪心在数组首尾接缝处被拒绝
    expect(job.perimeter - (300 - 0)).toBeLessThan(job.minCenterDistance)

    expect(r.feasible).toBe(true)
    expect(r.greedy.valid).toBe(false)
    expect(r.count).toBe(5)
    expect(r.bridges.map((b) => b.s)).toEqual([30, 76, 150, 224, 300])
    expect(r.maxFree).toBeCloseTo(70, 9)
  })
})

describe('跨接缝', () => {
  it('最优方案的最大悬空是跨接缝闭合段，spans 正确标注', () => {
    const { r } = expectFeasible('cross-seam.json')
    expect(r.count).toBe(4)
    const cross = r.spans.filter((s) => s.crossesSeam)
    expect(cross).toHaveLength(1)
    expect(cross[0].centerDistance).toBeCloseTo(120, 9)
    expect(cross[0].freeLength).toBeCloseTo(114, 9)
    expect(r.maxFree).toBeCloseTo(114, 9)
  })
})

describe('无解见证', () => {
  it('infeasible 样例同时给出 gap 与 spacing 见证，且定位跨接缝段', () => {
    const { job } = load('infeasible.json')
    const r = solve(job!)
    expect(r.feasible).toBe(false)
    expect(r.bridges).toEqual([])
    const gap = r.witnesses.find((w) => w.kind === 'gap')!
    const spacing = r.witnesses.find((w) => w.kind === 'spacing')!
    expect(gap).toBeTruthy()
    expect(spacing).toBeTruthy()
    expect(spacing.crossesSeam).toBe(true)
    expect(gap.freeLength!).toBeGreaterThan(job!.maxFreeLength)
    expect(spacing.centerDistance!).toBeLessThan(job!.minCenterDistance)
  })

  it('没有可行候选时给出 no-candidate 见证', () => {
    const { raw } = load('infeasible.json')
    const wide: RawWork = { ...raw, bridgeWidth: 300 }
    const { job } = importWork(wide)
    // 300 < 320 周长，不报参数错；但每个候选的桥宽都覆盖禁区
    const r = solve(job!)
    expect(r.feasible).toBe(false)
    expect(r.witnesses.some((w) => w.kind === 'no-candidate')).toBe(true)
  })
})

describe('导入错误定位', () => {
  it('定位到字段路径与轮廓元素下标', () => {
    const bad = {
      job: '坏数据',
      contour: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: '十', y: 0 },
        { x: 0, y: 10 }
      ],
      seam: { x: 0, y: 0 },
      bridgeWidth: -1,
      minCenterDistance: 2,
      maxFreeLength: 5,
      candidates: [{ point: { x: 3, y: 'oops' } }, {}],
      forbidden: [{ id: 'z' }]
    }
    const { job, issues } = importWork(bad)
    expect(job).toBeNull()
    const paths = issues.map((i) => i.path)
    expect(paths).toContain('contour[2].x')
    expect(issues.find((i) => i.path === 'contour[2].x')?.contourIndex).toBe(2)
    expect(paths).toContain('bridgeWidth')
    expect(paths).toContain('candidates[0].point.y')
    expect(paths).toContain('candidates[1]')
    expect(paths).toContain('forbidden[0].from')
    expect(paths).toContain('forbidden[0].to')
  })

  it('桥宽不小于周长报参数错误', () => {
    const { job, issues } = importWork({
      contour: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ],
      seam: { x: 0, y: 0 },
      bridgeWidth: 100,
      minCenterDistance: 2,
      maxFreeLength: 5,
      candidates: []
    })
    expect(job).toBeNull()
    expect(issues.some((i) => i.path === 'bridgeWidth')).toBe(true)
  })
})
