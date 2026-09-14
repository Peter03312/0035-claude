import type { ChosenBridge, Candidate, Job, SolveResult, SpanInfo, Witness } from '../types'
import { EPS, forwardGap } from './geometry'

/**
 * 桥位精确求解（环，不可摊直）。
 *
 * 约束：
 *  - 只能选用候选位，且桥宽覆盖不得与人工禁区擦碰；
 *  - 相邻已选桥沿整圈的桥心距离 >= minCenterDistance；
 *  - 相邻已选桥沿整圈的无桥净长（桥心距 - 桥宽）<= maxFreeLength。
 *
 * 目标序：桥数最少 → 最大悬空净长最短 → 自接缝起的桥心环向序列字典序最小。
 *
 * 做法：枚举接缝后第一座桥（每个可行候选各当一次锚点，跨接缝闭合段因此被显式检查），
 * 链上动态规划；每个端点保留 (maxFree, 序列) 的 Pareto 前沿，再全局按三级目标取唯一最优。
 */

interface Path {
  /** 链上提升后的桥心位置（首项为锚点，严格递增） */
  seq: number[]
  /** 目前最大无桥净长（不含闭合跨接缝段） */
  maxFree: number
}

function dominates(a: Path, b: Path): boolean {
  // 同为某个锚点下发到同一末候选的路径：
  // 桥数更少且悬空不更长即可支配；桥数相同再按序列字典序（影响最终第三级目标）。
  if (a.seq.length > b.seq.length) return false
  if (a.maxFree > b.maxFree + EPS) return false
  if (a.seq.length < b.seq.length) return true
  for (let i = 0; i < a.seq.length; i++) {
    if (Math.abs(a.seq[i] - b.seq[i]) <= EPS) continue
    return a.seq[i] < b.seq[i]
  }
  return true // 完全等价
}

function insertPareto(list: Path[], p: Path): void {
  for (const q of list) {
    if (dominates(q, p)) return
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (dominates(p, list[i])) list.splice(i, 1)
  }
  list.push(p)
}

export interface GreedyRun {
  produced: boolean
  valid: boolean
  count: number
  maxFree: number | null
  wrapFree: number | null
  reason?: string
  chosen: number[]
}

/**
 * 参考用“摊直贪心”：固定从排序后第一个候选出发，每次尽量向前跳。
 * 它把环在数组首尾切开，闭合时的跨接缝段只能事后补查——这正是本工作台要纠正的缺陷。
 */
export function linearGreedy(
  arcs: number[],
  L: number,
  w: number,
  dMin: number,
  G: number
): GreedyRun {
  if (arcs.length === 0) {
    return { produced: false, valid: false, count: 0, maxFree: null, wrapFree: null, reason: '无候选', chosen: [] }
  }
  const chosen = [arcs[0]]
  let cur = arcs[0]
  let maxFree = -Infinity
  while (true) {
    const limit = cur + G + w
    let next = NaN
    for (const s of arcs) {
      if (s <= cur + dMin - EPS) continue
      if (s > limit + EPS) break
      if (Number.isNaN(next) || s > next) next = s
    }
    if (Number.isNaN(next)) break
    maxFree = Math.max(maxFree, next - cur - w)
    chosen.push(next)
    cur = next
    if (cur >= L - EPS) break
  }
  // 单桥：整圈净长
  const wrapGap = chosen.length === 1 ? L : chosen[0] + L - chosen[chosen.length - 1]
  const wrapFree = wrapGap - w
  const innerStall = cur + G + w < L - EPS
  let valid = true
  let reason: string | undefined
  if (innerStall) {
    valid = false
    reason = '摊直后内部出现无候选可填的超长悬空'
  }
  if (wrapFree > G + EPS) {
    valid = false
    reason = '跨接缝（数组首尾闭合）悬空超长，摊直贪心漏检'
  }
  for (let i = 1; i < chosen.length; i++) {
    if (chosen[i] - chosen[i - 1] < dMin - EPS) {
      valid = false
      reason = '桥心距不足'
    }
  }
  if (wrapGap < dMin - EPS) {
    valid = false
    reason = '跨接缝桥心距不足'
  }
  return {
    produced: true,
    valid,
    count: chosen.length,
    maxFree: chosen.length === 1 ? wrapFree : Math.max(maxFree === -Infinity ? -Infinity : maxFree, wrapFree),
    wrapFree,
    reason,
    chosen
  }
}

function buildSpans(job: Job, feasible: Candidate[], arcsNorm: number[]): SpanInfo[] {
  const { perimeter: L, bridgeWidth: w } = job
  const spans: SpanInfo[] = []
  const labelAt = (s: number): Candidate => feasible.find((c) => Math.abs(c.s - s) <= EPS)!
  // 单桥：唯一悬空是整圈扣除自身桥宽后的净长 L-w，不是桥到自身的零心距
  if (arcsNorm.length === 1) {
    const a = arcsNorm[0]
    return [
      {
        fromId: labelAt(a).id,
        toId: labelAt(a).id,
        freeLength: L - w,
        centerDistance: L,
        crossesSeam: true
      }
    ]
  }
  for (let i = 0; i < arcsNorm.length; i++) {
    const a = arcsNorm[i]
    const b = arcsNorm[(i + 1) % arcsNorm.length]
    const gap = forwardGap(a, b, L)
    spans.push({
      fromId: labelAt(a).id,
      toId: labelAt(b).id,
      freeLength: gap - w,
      centerDistance: gap,
      crossesSeam: b <= a + EPS
    })
  }
  return spans
}

/** 工艺参数硬校验：任何一项不合法都不允许出方案（避免负悬空等误导数据） */
export function validateParams(p: {
  perimeter: number
  bridgeWidth: number
  minCenterDistance: number
  maxFreeLength: number
}): Witness[] {
  const { perimeter: L, bridgeWidth: w, minCenterDistance: dMin, maxFreeLength: G } = p
  const out: Witness[] = []
  const paramWitness = (message: string): Witness => ({
    kind: 'param',
    arcA: 0,
    arcB: L,
    crossesSeam: false,
    required: undefined,
    message
  })
  const num = (x: number) => Number.isFinite(x) && x > 0
  if (!Number.isFinite(L) || L <= 0) out.push(paramWitness('轮廓周长无效'))
  if (!num(w)) out.push(paramWitness('桥宽必须为正数'))
  else if (w >= L) out.push(paramWitness(`桥宽 ${w} 不小于周长 ${round3(L)}，桥将覆盖整圈，禁止出方案`))
  if (!num(dMin)) out.push(paramWitness('最小桥心距必须为正数'))
  else if (dMin > L) out.push(paramWitness(`最小桥心距 ${dMin} 大于周长 ${round3(L)}，环上放不下两座桥`))
  if (!num(G)) out.push(paramWitness('最大悬空长度必须为正数'))
  else if (G < 0) out.push(paramWitness('最大悬空长度不能为负'))
  if (num(w) && num(dMin) && dMin < w) {
    out.push(paramWitness(`最小桥心距 ${dMin} 小于桥宽 ${w}，相邻桥覆盖必然搭接`))
  }
  return out
}

function round3(x: number): number {
  return Math.round(x * 1e3) / 1e3
}

export function solve(job: Job): SolveResult {
  const { perimeter: L, bridgeWidth: w, minCenterDistance: dMin, maxFreeLength: G } = job

  const paramIssues = validateParams({ perimeter: L, bridgeWidth: w, minCenterDistance: dMin, maxFreeLength: G })
  const greedy = {
    produced: false,
    valid: false,
    count: 0,
    maxFree: null as number | null,
    wrapFree: null as number | null,
    reason: paramIssues.length ? '参数不合法，未执行摊直贪心' : undefined
  }
  if (paramIssues.length) {
    return infeasible(job, [], greedy, paramIssues)
  }

  const feasible = job.candidates
    .filter((c) => c.collides.length === 0)
    .slice()
    .sort((a, b) => a.s - b.s)
  const arcs = feasible.map((c) => c.s)

  const g0 = linearGreedy(arcs, L, w, dMin, G)
  greedy.produced = g0.produced
  greedy.valid = g0.valid
  greedy.count = g0.count
  greedy.maxFree = g0.maxFree
  greedy.wrapFree = g0.wrapFree
  greedy.reason = g0.reason

  const noCandidateWitness = (): Witness[] => [
    {
      kind: 'no-candidate',
      arcA: 0,
      arcB: L,
      crossesSeam: true,
      freeLength: L,
      required: G,
      message: '没有任何不碰禁区的候选桥心，整圈轮廓无桥可布'
    }
  ]

  if (arcs.length === 0) {
    return infeasible(job, [], greedy, noCandidateWitness())
  }

  // ---- 枚举锚点的链上 DP ----
  interface Solution {
    seq: number[]
    maxFree: number
  }
  let best = null as Solution | null
  const m = arcs.length

  const consider = (seqLifted: number[], maxFree: number) => {
    // seqLifted 提升坐标；归一化后按自接缝序列比较
    const norm = seqLifted
      .map((x) => (x >= L - EPS ? x - L : x))
      .sort((a, b) => a - b)
    const candidate: Solution = { seq: norm, maxFree }
    if (!best || compareSolution(candidate, best) < 0) best = candidate
  }

  // 单桥（无论候选数多少）：整圈为唯一悬空
  if (L >= dMin - EPS && L - w <= G + EPS) {
    consider([arcs[0]], L - w)
  }

  for (let ai = 0; ai < m; ai++) {
    const p = arcs.slice(ai).concat(arcs.slice(0, ai).map((x) => x + L))
    // 单候选：闭合段就是整圈（已在上方统一处理）
    if (m === 1) continue
    const dp: Path[][] = Array.from({ length: m }, () => [])
    for (let j = 1; j < m; j++) {
      const gap = p[j] - p[0]
      if (gap >= dMin - EPS && gap - w <= G + EPS) {
        dp[j] = [{ seq: [p[0], p[j]], maxFree: gap - w }]
      }
    }
    for (let i = 1; i < m; i++) {
      for (const path of dp[i]) {
        for (let k = i + 1; k < m; k++) {
          const gap = p[k] - p[i]
          if (gap < dMin - EPS) continue
          if (gap - w > G + EPS) break
          const seq = path.seq.concat(p[k])
          insertPareto(dp[k], { seq, maxFree: Math.max(path.maxFree, gap - w) })
        }
        // 闭合：回到锚点（提升一圈）
        const gapClose = p[0] + L - p[i]
        if (gapClose >= dMin - EPS && gapClose - w <= G + EPS) {
          consider(path.seq, Math.max(path.maxFree, gapClose - w))
        }
      }
    }
  }

  if (best) {
    const sel = best.seq
    const spans = buildSpans(job, feasible, sel)
    const bridges: ChosenBridge[] = sel.map((s) => {
      const c = feasible.find((x) => Math.abs(x.s - s) <= EPS)!
      return { candidateId: c.id, s, point: c.point }
    })
    return {
      feasible: true,
      bridges,
      count: bridges.length,
      maxFree: Math.max(...spans.map((sp) => sp.freeLength)),
      spans,
      witnesses: [],
      greedy
    }
  }

  return infeasible(job, arcs, greedy, gapWitnesses(job, arcs).concat(spacingWitness(job, arcs)))
}

function compareSolution(
  a: { seq: number[]; maxFree: number },
  b: { seq: number[]; maxFree: number }
): number {
  if (a.seq.length !== b.seq.length) return a.seq.length - b.seq.length
  if (Math.abs(a.maxFree - b.maxFree) > EPS) return a.maxFree - b.maxFree
  for (let i = 0; i < a.seq.length; i++) {
    if (Math.abs(a.seq[i] - b.seq[i]) > EPS) return a.seq[i] - b.seq[i]
  }
  return 0
}

function infeasible(_job: Job, _arcs: number[], greedy: SolveResult['greedy'], witnesses: Witness[]): SolveResult {
  return {
    feasible: false,
    bridges: [],
    count: 0,
    maxFree: null,
    spans: [],
    witnesses,
    greedy
  }
}

/** 相邻可行候选之间无候选可填的强制悬空（含跨接缝对），净长超限即为无解硬见证 */
function gapWitnesses(job: Job, arcs: number[]): Witness[] {
  const { perimeter: L, bridgeWidth: w, maxFreeLength: G, candidates } = job
  const out: Witness[] = []
  if (arcs.length === 1) {
    const free = L - w
    if (free > G + EPS) {
      const c = candidates.find((x) => Math.abs(x.s - arcs[0]) <= EPS)!
      out.push({
        kind: 'gap',
        arcA: arcs[0],
        arcB: arcs[0] + L,
        crossesSeam: true,
        freeLength: free,
        required: G,
        fromLabel: c.label,
        toLabel: c.label,
        message: `仅有的候选 ${c.label} 跨接缝整圈净长 ${free.toFixed(2)} > ${G}`
      })
    }
    return out
  }
  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i]
    const b = arcs[(i + 1) % arcs.length]
    const lifted = b <= a + EPS ? b + L : b
    const gap = lifted - a
    const free = gap - w
    if (free > G + EPS) {
      const ca = candidates.find((x) => Math.abs(x.s - a) <= EPS)!
      const cb = candidates.find((x) => Math.abs(x.s - b) <= EPS)!
      const crosses = lifted > L - EPS
      out.push({
        kind: 'gap',
        arcA: a,
        arcB: lifted,
        crossesSeam: crosses,
        freeLength: free,
        required: G,
        fromLabel: ca.label,
        toLabel: cb.label,
        message: `${ca.label}→${cb.label}${crosses ? '（跨接缝）' : ''}之间没有候选位，无桥净长 ${free.toFixed(2)} > ${G}`
      })
    }
  }
  out.sort((x, y) => (y.freeLength ?? 0) - (x.freeLength ?? 0))
  return out
}

/** 间距见证：取全部可行候选（dMin=0 下的最密解），找出最紧的桥心距冲突 */
function spacingWitness(job: Job, arcs: number[]): Witness[] {
  const { perimeter: L, minCenterDistance: dMin, candidates } = job
  if (arcs.length < 2) return []
  let worst: { a: number; b: number; lifted: number; gap: number } | null = null
  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i]
    const b = arcs[(i + 1) % arcs.length]
    const lifted = b <= a + EPS ? b + L : b
    const gap = lifted - a
    if (gap < dMin - EPS && (!worst || gap < worst.gap)) worst = { a, b, lifted, gap }
  }
  if (!worst) return []
  const ca = candidates.find((x) => Math.abs(x.s - worst!.a) <= EPS)!
  const cb = candidates.find((x) => Math.abs(x.s - worst!.b) <= EPS)!
  return [
    {
      kind: 'spacing',
      arcA: worst.a,
      arcB: worst.lifted,
      crossesSeam: worst.lifted > L - EPS,
      centerDistance: worst.gap,
      required: dMin,
      fromLabel: ca.label,
      toLabel: cb.label,
      message: `即使候选全选，${ca.label}→${cb.label} 桥心距仅 ${worst.gap.toFixed(2)} < 下限 ${dMin}`
    }
  ]
}
