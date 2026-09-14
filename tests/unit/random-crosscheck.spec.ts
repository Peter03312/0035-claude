import { describe, it, expect } from 'vitest'
import { solve } from '../../src/lib/solver'
import { cumulative } from '../../src/lib/geometry'
import { importWork } from '../../src/lib/importJob'
import type { RawWork } from '../../src/types'

/**
 * 在小环（n 个候选）上枚举全部子集，按
 * 桥数 → 最大悬空 → 桥心序列字典序 三级目标求参考最优，
 * 与精确求解器交叉验证（含跨接缝闭合校核）。
 */
function bruteOptimal(
  arcs: number[],
  L: number,
  w: number,
  dMin: number,
  G: number,
  blocked: boolean[]
): { count: number; maxFree: number; seq: number[] } | null {
  const n = arcs.length
  const order = arcs.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s)
  const feasible = (pick: number[]): number[] | null => {
    const sel = pick.filter((i) => !blocked[i]).sort((a, b) => arcs[a] - arcs[b])
    if (sel.length === 0) return null
    let maxFree = -Infinity
    for (let k = 0; k < sel.length; k++) {
      const a = arcs[sel[k]]
      const b = arcs[sel[(k + 1) % sel.length]]
      const gap = b <= a ? b + L - a : b - a
      if (gap < dMin - 1e-9) return null
      const free = gap - w
      if (free > G + 1e-9) return null
      maxFree = Math.max(maxFree, free)
    }
    return [sel.length, maxFree, sel.map((i) => arcs[i])] as unknown as number[]
  }
  let best: { count: number; maxFree: number; seq: number[] } | null = null
  for (let mask = 0; mask < 1 << n; mask++) {
    const pick: number[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) pick.push(i)
    const got = feasible(pick)
    if (!got) continue
    const cand = { count: got[0] as number, maxFree: got[1] as number, seq: got[2] as unknown as number[] }
    if (
      !best ||
      cand.count < best.count ||
      (cand.count === best.count && cand.maxFree < best.maxFree - 1e-9) ||
      (cand.count === best.count &&
        Math.abs(cand.maxFree - best.maxFree) <= 1e-9 &&
        lexic(cand.seq, best.seq))
    ) {
      best = cand
    }
  }
  void order
  return best
}

function lexic(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i]
  }
  return a.length < b.length
}

function buildJob(arcs: number[], L: number, w: number, dMin: number, G: number, zones: [number, number][]) {
  // 用圆近似折线不行；仍用矩形，周长 L 需等于 2(W+H)。这里统一让测试取 L=320 (W=100,H=60)
  const W = 100
  const H = 60
  const poly = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H }
  ]
  const rectPoint = (s: number) => {
    s = ((s % L) + L) % L
    if (s <= W) return { x: s, y: 0 }
    if (s <= W + H) return { x: W, y: s - W }
    if (s <= 2 * W + H) return { x: W - (s - W - H), y: H }
    return { x: 0, y: L - s }
  }
  const raw: RawWork = {
    job: 'rand',
    contour: poly,
    seam: { x: 0, y: 0 },
    bridgeWidth: w,
    minCenterDistance: dMin,
    maxFreeLength: G,
    candidates: arcs.map((s, i) => ({ id: `C${i + 1}`, point: rectPoint(s) })),
    forbidden: zones.map(([a, b], i) => ({
      id: `Z${i}`,
      from: rectPoint(a),
      to: rectPoint(b),
      reason: 'r'
    }))
  }
  const out = importWork(raw)
  expect(out.job).not.toBeNull()
  return out.job!
}

describe('求解器与穷举参考交叉验证', () => {
  it('随机参数下三级最优一致（含跨接缝与禁区）', () => {
    const L = 320
    let rng = 0x12345678
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff
      return rng / 0x7fffffff
    }
    let trials = 0
    for (let t = 0; t < 400; t++) {
      const n = 2 + Math.floor(rand() * 6) // 2..7
      const arcs = Array.from({ length: n }, () => Math.round(rand() * (L - 4)) + 2)
      const uniq = Array.from(new Set(arcs)).sort((a, b) => a - b)
      if (uniq.length < 2) continue
      const w = [4, 6, 8][Math.floor(rand() * 3)]
      const dMin = [15, 25, 40][Math.floor(rand() * 3)]
      const G = [50, 70, 95, 130][Math.floor(rand() * 4)]
      const zones: [number, number][] = rand() < 0.35 ? [[Math.round(rand() * 200) + 40, Math.round(rand() * 60) + 20]] : []
      const job = buildJob(uniq, L, w, dMin, G, zones)
      void cumulative
      const r = solve(job)
      const blocked = job.candidates.map((c) => c.collides.length > 0)
      const ref = bruteOptimal(
        job.candidates.map((c) => c.s),
        L,
        w,
        dMin,
        G,
        blocked
      )
      expect(r.feasible).toBe(ref !== null)
      if (ref) {
        expect(r.count).toBe(ref.count)
        expect(r.maxFree!).toBeCloseTo(ref.maxFree, 6)
        expect(r.bridges.map((b) => Math.round(b.s * 1e6))).toEqual(ref.seq.map((s) => Math.round(s * 1e6)))
      }
      trials++
    }
    expect(trials).toBeGreaterThan(300)
  })
})
