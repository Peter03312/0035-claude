import type {
  Candidate,
  Corner,
  ForbiddenZone,
  ImportIssue,
  Job,
  RawCandidate,
  RawForbidden,
  RawWork,
  Vec
} from '../types'
import {
  EPS,
  arcToPoint,
  cumulative,
  indexOffset,
  projectOnClosed,
  toRingArc,
  wrap
} from './geometry'
import { collidingZones, makeZone } from './arcs'

class IssueBag {
  list: ImportIssue[] = []
  error(path: string, message: string, contourIndex?: number) {
    this.list.push({ level: 'error', path, message, contourIndex })
  }
  warning(path: string, message: string, contourIndex?: number) {
    this.list.push({ level: 'warning', path, message, contourIndex })
  }
  hasErrors(): boolean {
    return this.list.some((i) => i.level === 'error')
  }
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function asPoint(x: unknown, path: string, bag: IssueBag): Vec | null {
  if (!x || typeof x !== 'object') {
    bag.error(path, '应为 {x,y} 对象')
    return null
  }
  const p = x as { x?: unknown; y?: unknown }
  if (!isNum(p.x)) bag.error(`${path}.x`, 'x 必须是有限数字')
  if (!isNum(p.y)) bag.error(`${path}.y`, 'y 必须是有限数字')
  if (!isNum(p.x) || !isNum(p.y)) return null
  return { x: p.x, y: p.y }
}

export interface ImportOutcome {
  job: Job | null
  issues: ImportIssue[]
}

/**
 * 解析并归一化工件 JSON。
 * 归一化对轮廓数组循环移位不变：接缝由 seam 点（或 s）独立确定。
 */
export function importWork(raw: unknown): ImportOutcome {
  const bag = new IssueBag()
  if (!raw || typeof raw !== 'object') {
    bag.error('$', '根节点必须是 JSON 对象')
    return { job: null, issues: bag.list }
  }
  const w = raw as RawWork

  // ---- 轮廓 ----
  const polygon: Vec[] = []
  if (!Array.isArray(w.contour)) {
    bag.error('contour', 'contour 必须是闭合折线顶点数组')
  } else {
    w.contour.forEach((el, i) => {
      const p = asPoint(el, `contour[${i}]`, bag)
      if (p) polygon.push(p)
      else bag.list[bag.list.length - 1].contourIndex = i
    })
  }
  let cum: number[] = []
  let L = 0
  if (polygon.length >= 3) {
    cum = cumulative(polygon)
    L = cum[cum.length - 1]
    // 重合相邻顶点会导致零长边
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length
      if (Math.hypot(polygon[j].x - polygon[i].x, polygon[j].y - polygon[i].y) <= EPS) {
        bag.error(`contour[${i}]`, `顶点 ${i} 与 ${j} 重合，折线边长度为 0`, i)
      }
    }
  } else if (Array.isArray(w.contour)) {
    bag.error('contour', '闭合折线至少需要 3 个顶点')
  }

  // ---- 标量参数 ----
  const numParam = (key: 'bridgeWidth' | 'minCenterDistance' | 'maxFreeLength'): number | null => {
    const x = w[key]
    if (!isNum(x)) {
      bag.error(key, `${key} 必须是正数（mm）`)
      return null
    }
    if (x <= 0) {
      bag.error(key, `${key} 必须大于 0`)
      return null
    }
    return x
  }
  const bridgeWidth = numParam('bridgeWidth')
  const minCenterDistance = numParam('minCenterDistance')
  const maxFreeLength = numParam('maxFreeLength')
  if (bridgeWidth && L > 0 && bridgeWidth >= L) {
    bag.error('bridgeWidth', `桥宽 ${bridgeWidth} 不小于轮廓周长 ${round(L)}，单桥已横跨整圈`)
  }
  if (bridgeWidth && minCenterDistance && minCenterDistance < bridgeWidth - EPS) {
    bag.warning(
      'minCenterDistance',
      `最小桥心距 ${minCenterDistance} 小于桥宽 ${bridgeWidth}，两桥将搭接；通常应 ≥ 桥宽`
    )
  }

  // 无轮廓则无法继续做几何归一化
  if (!L) return { job: null, issues: bag.list }

  // ---- 接缝 ----
  let seamPoint: Vec | null = null
  let seamOffset = 0
  const seamRaw = w.seam as { x?: unknown; y?: unknown } | undefined
  if (seamRaw && (seamRaw.x !== undefined || seamRaw.y !== undefined)) {
    seamPoint = asPoint(seamRaw, 'seam', bag)
    if (seamPoint) seamOffset = projectOnClosed(polygon, seamPoint).offset
  } else if (isNum((w as RawWork & { seamS?: unknown }).seamS)) {
    seamOffset = ((w as RawWork & { seamS: number }).seamS % L + L) % L
    seamPoint = arcToPoint(polygon, cum, 0, seamOffset)
  } else {
    bag.error('seam', '缺少固定接缝 seam{x,y}（或数值字段 seamS）')
  }
  if (!seamPoint) seamPoint = polygon[0]

  // ---- 候选桥心 ----
  const candidates: Candidate[] = []
  const seenArc = new Map<number, number>()
  const addCandidate = (
    idBase: string,
    s: number,
    point: Vec,
    edgeIndex: number,
    custom: boolean,
    label?: string
  ) => {
    const rs = wrap(s, L)
    for (const [prev, idx] of seenArc) {
      const d = Math.min(Math.abs(rs - prev), L - Math.abs(rs - prev))
      if (d <= EPS) {
        bag.warning(`candidates[${idx}]`, `候选桥心与 #${idx + 1} 环向重合（1µm 内），已忽略重复点`)
        return
      }
    }
    const idx = candidates.length
    seenArc.set(rs, idx)
    candidates.push({
      id: idBase,
      s: rs,
      point,
      edgeIndex,
      custom,
      collides: [],
      label: label ?? `C${idx + 1}`
    })
  }

  if (!Array.isArray(w.candidates)) {
    bag.error('candidates', 'candidates 必须是候选桥心数组（可为空数组）')
  } else {
    w.candidates.forEach((rcRaw, i) => {
      const path = `candidates[${i}]`
      const rc = (rcRaw ?? {}) as RawCandidate
      if (!rcRaw || typeof rcRaw !== 'object') {
        bag.error(path, '候选必须是对象')
        return
      }
      const hasPoint = rc.point && typeof rc.point === 'object'
      const hasIndex = rc.at !== undefined
      const hasS = rc.s !== undefined
      if (!hasPoint && !hasIndex && !hasS) {
        bag.error(path, '候选必须提供 point{x,y}、at（顶点下标）或 s（自 contour[0] 的弧长）之一')
        return
      }
      let offset: number | null = null
      let point: Vec | null = null
      let edgeIndex = 0
      if (hasPoint) {
        point = asPoint(rc.point, `${path}.point`, bag)
        if (point) {
          const pr = projectOnClosed(polygon, point)
          offset = pr.offset
          edgeIndex = pr.edgeIndex
        }
      } else if (hasIndex) {
        if (!Number.isInteger(rc.at) || (rc.at as number) < 0 || (rc.at as number) >= polygon.length) {
          bag.error(`${path}.at`, `at 必须是 [0,${polygon.length - 1}] 内的整数顶点下标`)
        } else {
          const idx = rc.at as number
          offset = indexOffset(polygon, cum, idx)
          point = polygon[idx]
          edgeIndex = idx
        }
      } else {
        if (!isNum(rc.s)) {
          bag.error(`${path}.s`, 's 必须是有限数字（mm，自 contour[0] 起）')
        } else {
          offset = ((rc.s as number) % L + L) % L
          point = arcToPoint(polygon, cum, 0, offset)
          const pr = projectOnClosed(polygon, point)
          edgeIndex = pr.edgeIndex
        }
      }
      if (offset !== null && point) {
        addCandidate(
          typeof rc.id === 'string' && rc.id ? rc.id : `cand-${i}`,
          toRingArc(offset, seamOffset, L),
          point,
          edgeIndex,
          false
        )
      }
    })
  }

  // ---- 人工禁区 ----
  const forbidden: ForbiddenZone[] = []
  const resolveEndpoint = (
    z: RawForbidden,
    which: 'from' | 'to',
    path: string
  ): number | null => {
    const pt = z[which]
    const idxV = z[which === 'from' ? 'fromIndex' : 'toIndex']
    const sV = z[which === 'from' ? 'fromS' : 'toS']
    if (pt && typeof pt === 'object') {
      const p = asPoint(pt, path, bag)
      if (!p) return null
      return toRingArc(projectOnClosed(polygon, p).offset, seamOffset, L)
    }
    if (idxV !== undefined) {
      if (!Number.isInteger(idxV) || (idxV as number) < 0 || (idxV as number) >= polygon.length) {
        bag.error(path, `${which}Index 必须是 [0,${polygon.length - 1}] 内的整数顶点下标`)
        return null
      }
      return toRingArc(indexOffset(polygon, cum, idxV as number), seamOffset, L)
    }
    if (sV !== undefined) {
      if (!isNum(sV)) {
        bag.error(path, `${which}S 必须是有限数字`)
        return null
      }
      const off = ((sV as number) % L + L) % L
      return toRingArc(off, seamOffset, L)
    }
    bag.error(path, `禁区端点 ${which} 需要 point / ${which}Index / ${which}S 之一`)
    return null
  }

  if (w.forbidden !== undefined && !Array.isArray(w.forbidden)) {
    bag.error('forbidden', 'forbidden 必须是数组')
  } else if (Array.isArray(w.forbidden)) {
    w.forbidden.forEach((zfRaw, i) => {
      const path = `forbidden[${i}]`
      if (!zfRaw || typeof zfRaw !== 'object') {
        bag.error(path, '禁区必须是对象')
        return
      }
      const zf = zfRaw as RawForbidden
      const a = resolveEndpoint(zf, 'from', `${path}.from`)
      const b = resolveEndpoint(zf, 'to', `${path}.to`)
      if (a !== null && b !== null) {
        const reason = typeof zf.reason === 'string' && zf.reason ? zf.reason : '人工禁区'
        forbidden.push(
          makeZone(typeof zf.id === 'string' && zf.id ? zf.id : `zone-${i}`, a, b, L, reason)
        )
      }
    })
  }

  // ---- 角点（标注信息，不参与强制约束） ----
  const corners: Corner[] = []
  if (w.corners !== undefined && !Array.isArray(w.corners)) {
    bag.error('corners', 'corners 必须是数组')
  } else if (Array.isArray(w.corners)) {
    w.corners.forEach((cRaw, i) => {
      const path = `corners[${i}]`
      let point: Vec | null = null
      let s = 0
      if (isNum(cRaw)) {
        if (cRaw < 0 || cRaw >= polygon.length) {
          bag.error(path, `角点顶点下标越界，应在 [0,${polygon.length - 1}]`)
          return
        }
        point = polygon[cRaw]
        s = toRingArc(indexOffset(polygon, cum, cRaw), seamOffset, L)
      } else if (cRaw && typeof cRaw === 'object') {
        const c = cRaw as { point?: { x?: unknown; y?: unknown }; at?: unknown; s?: unknown }
        if (c.point && typeof c.point === 'object') {
          point = asPoint(c.point, `${path}.point`, bag)
          if (point) s = toRingArc(projectOnClosed(polygon, point).offset, seamOffset, L)
        } else if (c.at !== undefined) {
          if (!Number.isInteger(c.at) || (c.at as number) < 0 || (c.at as number) >= polygon.length) {
            bag.error(`${path}.at`, 'at 必须是合法顶点下标')
            return
          }
          point = polygon[c.at as number]
          s = toRingArc(indexOffset(polygon, cum, c.at as number), seamOffset, L)
        } else if (isNum(c.s)) {
          const off = ((c.s % L) + L) % L
          s = toRingArc(off, seamOffset, L)
          point = arcToPoint(polygon, cum, seamOffset, s)
        } else {
          bag.error(path, '角点需要 point / at / s')
          return
        }
      } else {
        bag.error(path, '角点必须是顶点下标或对象')
        return
      }
      corners.push({
        id: `corner-${i}`,
        s,
        point: point!,
        label: `角${i + 1}`
      })
    })
  }

  if (candidates.length === 0) {
    bag.warning('candidates', '没有任何候选桥心，必然无解；请在画布上增补或修正候选')
  }

  // ---- 碰撞标注 ----
  if (bridgeWidth) {
    for (const c of candidates) {
      c.collides = collidingZones(c.s, bridgeWidth, forbidden, L)
    }
  }

  const job: Job = {
    name: typeof w.job === 'string' && w.job ? w.job : '未命名刀版',
    polygon,
    cum,
    seamOffset,
    perimeter: L,
    seamPoint,
    bridgeWidth: bridgeWidth ?? NaN,
    minCenterDistance: minCenterDistance ?? NaN,
    maxFreeLength: maxFreeLength ?? NaN,
    candidates,
    forbidden,
    corners,
    issues: bag.list
  }
  return { job: bag.hasErrors() ? null : job, issues: bag.list }
}

function round(x: number): number {
  return Math.round(x / EPS) * EPS
}
