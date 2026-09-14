// 领域模型：原始 JSON、归一化工件与求解结果
// 环向约定：折线顶点按数组顺序前进（末点隐式回到首点闭合），弧长 s 自固定接缝起沿该方向量取，单位 mm。

export interface Vec {
  x: number
  y: number
}

/** 导入问题（字段级定位） */
export interface ImportIssue {
  level: 'error' | 'warning'
  /** 字段路径，如 candidates[3].point.x、forbidden[2].to */
  path: string
  message: string
  /** 关联的轮廓元素下标，如 contour[5] */
  contourIndex?: number
}

export interface RawCandidate {
  id?: unknown
  point?: { x?: unknown; y?: unknown }
  /** 轮廓顶点下标 */
  at?: unknown
  /** 自 contour[0] 起的有向弧长（mm） */
  s?: unknown
  note?: unknown
}

export interface RawForbidden {
  id?: unknown
  from?: { x?: unknown; y?: unknown }
  to?: { x?: unknown; y?: unknown }
  fromIndex?: unknown
  toIndex?: unknown
  fromS?: unknown
  toS?: unknown
  reason?: unknown
}

export interface RawWork {
  job?: unknown
  contour?: unknown
  seam?: { x?: unknown; y?: unknown }
  bridgeWidth?: unknown
  minCenterDistance?: unknown
  maxFreeLength?: unknown
  corners?: unknown
  candidates?: unknown
  forbidden?: unknown
}

export interface Candidate {
  id: string
  /** 自接缝起的环向弧长 [0,L) */
  s: number
  point: Vec
  edgeIndex: number
  /** 人工在画布上校正/增补 */
  custom: boolean
  /** 碰撞的人工禁区 id 列表（擦碰即算） */
  collides: string[]
  label: string
}

export interface ForbiddenZone {
  id: string
  /** 环向区间，b<a 表示跨接缝 */
  a: number
  b: number
  wraps: boolean
  reason: string
}

export interface Corner {
  id: string
  s: number
  point: Vec
  label: string
}

export interface Job {
  name: string
  /** 原始顺序的闭合折线顶点 */
  polygon: Vec[]
  /** 各顶点自 polygon[0] 起的累积弧长，长度 n+1（末值为周长） */
  cum: number[]
  /** 接缝自 polygon[0] 起的弧长 */
  seamOffset: number
  perimeter: number
  seamPoint: Vec
  bridgeWidth: number
  minCenterDistance: number
  maxFreeLength: number
  candidates: Candidate[]
  forbidden: ForbiddenZone[]
  corners: Corner[]
  issues: ImportIssue[]
}

export interface SpanInfo {
  fromId: string
  toId: string
  /** 两桥边缘之间的无桥净长 */
  freeLength: number
  centerDistance: number
  crossesSeam: boolean
}

export interface Witness {
  kind: 'gap' | 'spacing' | 'no-candidate' | 'param'
  /** 环向区间（自接缝起向前），用于画布高亮；跨接缝时 arcB+L */
  arcA: number
  arcB: number
  crossesSeam: boolean
  freeLength?: number
  centerDistance?: number
  required?: number
  fromLabel?: string
  toLabel?: string
  message: string
}

export interface ChosenBridge {
  candidateId: string
  s: number
  point: Vec
}

export interface GreedyReport {
  /** 摊直贪心是否选出了方案（可能漏检跨接缝超长） */
  produced: boolean
  valid: boolean
  count: number
  maxFree: number | null
  wrapFree: number | null
  reason?: string
}

export interface SolveResult {
  feasible: boolean
  bridges: ChosenBridge[]
  count: number
  maxFree: number | null
  spans: SpanInfo[]
  witnesses: Witness[]
  greedy: GreedyReport
}
