import type { ForbiddenZone } from '../types'
import { EPS } from './geometry'

/**
 * 桥宽覆盖在环上的对称区间 [s-w/2, s+w/2]（端点相接即视为擦碰）。
 * 禁区弧段 b<a 表示跨接缝。
 */
export function footprintHitsZone(
  s: number,
  w: number,
  zone: { a: number; b: number; wraps: boolean },
  L: number
): boolean {
  const half = w / 2
  const fa = ((s - half) % L + L) % L
  const fb = ((s + half) % L + L) % L
  const fWraps = fb <= fa + EPS && w > EPS && Math.abs(w - L) > EPS
  const fSegs: [number, number][] = fWraps
    ? [
        [fa, L],
        [0, fb]
      ]
    : [[fa, fb]]
  const zSegs: [number, number][] = zone.wraps
    ? [
        [zone.a, L],
        [0, zone.b]
      ]
    : [[zone.a, zone.b]]
  for (const [a1, b1] of fSegs) {
    for (const [a2, b2] of zSegs) {
      // 闭区间相交：相接也算碰
      if (b1 + EPS >= a2 && b2 + EPS >= a1) return true
    }
  }
  return false
}

export function collidingZones(
  s: number,
  w: number,
  zones: ForbiddenZone[],
  L: number
): string[] {
  return zones.filter((z) => footprintHitsZone(s, w, z, L)).map((z) => z.id)
}

/**
 * 由起止弧长构造沿前进方向的环向区间。
 * 相等表示退化为点；to 落在 from 之前（模 L）表示跨接缝。
 */
export function makeZone(
  id: string,
  fromArc: number,
  toArc: number,
  L: number,
  reason: string
): ForbiddenZone {
  const a = ((fromArc % L) + L) % L
  const b = ((toArc % L) + L) % L
  const wraps = !(b > a + EPS || Math.abs(b - a) <= EPS)
  return { id, a, b, wraps, reason }
}

