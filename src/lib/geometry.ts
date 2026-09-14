import type { Vec } from '../types'

/** 1 µm 容差，所有长度单位 mm */
export const EPS = 1e-6

export function v(x: number, y: number): Vec {
  return { x, y }
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k }
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** 点在整条闭合折线上的最近投影；offset 为自 polygon[0] 起的有向累积弧长 */
export function projectOnClosed(polygon: Vec[], p: Vec): {
  point: Vec
  offset: number
  edgeIndex: number
  edgeT: number
} {
  let best: { point: Vec; offset: number; edgeIndex: number; edgeT: number } | null = null
  let bestD = Infinity
  let acc = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
    t = Math.min(1, Math.max(0, t))
    const point = { x: a.x + dx * t, y: a.y + dy * t }
    const d = dist(point, p)
    if (d < bestD - EPS) {
      bestD = d
      best = { point, offset: acc + t * Math.sqrt(len2), edgeIndex: i, edgeT: t }
    }
    acc += Math.sqrt(len2)
  }
  return best!
}

/** 顶点下标 -> 自 polygon[0] 起的有向弧长（带绕圈次数） */
export function indexOffset(polygon: Vec[], cum: number[], index: number): number {
  const n = polygon.length
  return cum[((index % n) + n) % n] + (Math.floor(index / n) || 0) * cum[n]
}

/** 归一化到环上 [0,L)（保留 1µm） */
export function wrap(s: number, L: number): number {
  const r = ((s % L) + L) % L
  return r < L - EPS ? Math.round(r / EPS) * EPS : 0
}

/** 自 polygon[0] 起的有向偏移 -> 自接缝起环向弧长 */
export function toRingArc(offset: number, seamOffset: number, L: number): number {
  return wrap(offset - seamOffset, L)
}

/** 自接缝环向弧长 -> 世界坐标 */
export function arcToPoint(polygon: Vec[], cum: number[], seamOffset: number, s: number): Vec {
  const L = cum[cum.length - 1]
  let off = s + seamOffset
  off = ((off % L) + L) % L
  return offsetToPoint(polygon, cum, off)
}

export function offsetToPoint(polygon: Vec[], cum: number[], off: number): Vec {
  const L = cum[cum.length - 1]
  off = Math.min(Math.max(off, 0), L)
  if (off >= L - EPS) return polygon[0]
  // 二分所在边
  let lo = 0
  let hi = cum.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid + 1] < off - EPS) lo = mid + 1
    else hi = mid
  }
  const i = lo
  const a = polygon[i]
  const b = polygon[(i + 1) % polygon.length]
  const segLen = cum[i + 1] - cum[i]
  const t = segLen > EPS ? (off - cum[i]) / segLen : 0
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function cumulative(polygon: Vec[]): number[] {
  const cum = [0]
  for (let i = 0; i < polygon.length; i++) {
    cum.push(cum[i] + dist(polygon[i], polygon[(i + 1) % polygon.length]))
  }
  return cum
}

/** 有向前进弧长差 (b - a) 模 L，范围 [0,L) */
export function forwardGap(a: number, b: number, L: number): number {
  return wrap(b - a, L)
}

/** 线性插值（颜色/缩放辅助） */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
