import type { Vec } from '../types'
import { offsetToPoint } from './geometry'

/**
 * 环向弧段 [arcA, arcB]（arcB 可 ≥ L 表示跨接缝）转成世界折线点列，
 * 用于在画布上沿轮廓加粗高亮。
 * arc 为自接缝起的弧长；off = arc + seamOffset 为自 polygon[0] 起的偏移。
 * 在“提升坐标”（允许超过一圈）下沿顶点前进，映射回世界点。
 */
export function arcToPath(
  polygon: Vec[],
  cum: number[],
  seamOffset: number,
  arcA: number,
  arcB: number
): Vec[] {
  const L = cum[cum.length - 1]
  const n = polygon.length
  const u0 = ((arcA + seamOffset) % L + L) % L
  const u1 = arcB + seamOffset
  const pts: Vec[] = [offsetToPoint(polygon, cum, u0)]

  // 找起点之后第一个顶点的提升偏移
  let edge = 0
  for (let i = 0; i < n; i++) {
    if (cum[i] <= u0 + 1e-9) edge = i
  }
  let base = 0
  if (cum[edge + 1] < u0 - 1e-9) {
    edge = 0
    base = L
  }
  let guard = 0
  while (base + cum[edge + 1] < u1 - 1e-9 && guard < n + 2) {
    pts.push(offsetToPoint(polygon, cum, cum[edge + 1]))
    edge++
    if (edge >= n) {
      edge = 0
      base += L
    }
    guard++
  }
  const endWrapped = ((u1 % L) + L) % L
  const last = offsetToPoint(polygon, cum, endWrapped)
  const first = pts[0]
  if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-6 || pts.length > 1) pts.push(last)
  return pts
}

export function pointsToPath(pts: Vec[]): string {
  if (pts.length === 0) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')
}

export interface Fit {
  vbX: number
  vbY: number
  vbW: number
  vbH: number
}

export function fitViewBox(polygon: Vec[], pad = 8): Fit {
  const xs = polygon.map((p) => p.x)
  const ys = polygon.map((p) => p.y)
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad
  return { vbX: minX, vbY: minY, vbW: maxX - minX, vbH: maxY - minY }
}
