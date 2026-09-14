import { computed, reactive, ref } from 'vue'
import type { Candidate, ImportIssue, Job, SolveResult, Vec } from '../types'
import { importWork } from '../lib/importJob'
import { solve } from '../lib/solver'
import { EPS, arcToPoint, projectOnClosed, toRingArc, wrap } from '../lib/geometry'
import { collidingZones } from '../lib/arcs'

export interface ParamOverride {
  bridgeWidth: number | null
  minCenterDistance: number | null
  maxFreeLength: number | null
}

const job = ref<Job | null>(null)
const issues = ref<ImportIssue[]>([])
const fileName = ref('')
let lastRaw: unknown = null
const override = reactive<ParamOverride>({ bridgeWidth: null, minCenterDistance: null, maxFreeLength: null })
const result = ref<SolveResult | null>(null)
const stale = ref(false)
const addMode = ref(false)
const selectedId = ref<string | null>(null)

/** 当前生效参数（画布微调覆盖 JSON 初值） */
const liveParams = computed(() => ({
  bridgeWidth: override.bridgeWidth ?? job.value?.bridgeWidth ?? NaN,
  minCenterDistance: override.minCenterDistance ?? job.value?.minCenterDistance ?? NaN,
  maxFreeLength: override.maxFreeLength ?? job.value?.maxFreeLength ?? NaN
}))

function refreshCollisions(j: Job, w = liveParams.value.bridgeWidth) {
  for (const c of j.candidates) {
    c.collides = collidingZones(c.s, w, j.forbidden, j.perimeter)
  }
}

function markChanged() {
  stale.value = true
  result.value = null
}

export function useWorkbench() {
  function loadJson(raw: unknown, name = '') {
    const out = importWork(raw)
    issues.value = out.issues
    fileName.value = name
    lastRaw = raw
    override.bridgeWidth = null
    override.minCenterDistance = null
    override.maxFreeLength = null
    addMode.value = false
    selectedId.value = null
    result.value = null
    stale.value = false
    if (out.job) {
      refreshCollisions(out.job, out.job.bridgeWidth)
      job.value = out.job
    } else {
      job.value = null
    }
  }

  function runSolve() {
    if (!job.value) return
    const j: Job = { ...job.value, ...liveParams.value }
    refreshCollisions(j)
    job.value = j
    result.value = solve(j)
    stale.value = false
  }

  /** 把候选拖到世界坐标：重新投影到最近折线边 */
  function moveCandidate(id: string, world: Vec) {
    if (!job.value) return
    const j = job.value
    const c = j.candidates.find((x) => x.id === id)
    if (!c) return
    const pr = projectOnClosed(j.polygon, world)
    const s = toRingArc(pr.offset, j.seamOffset, j.perimeter)
    if (j.candidates.some((o) => o.id !== id && Math.abs(wrap(o.s - s, j.perimeter)) <= EPS)) return
    c.s = s
    c.point = pr.point
    c.edgeIndex = pr.edgeIndex
    c.custom = true
    refreshCollisions(j)
    markChanged()
  }

  /** 双击/点击轮廓新增候选 */
  function addCandidateAt(world: Vec) {
    if (!job.value) return
    const j = job.value
    const pr = projectOnClosed(j.polygon, world)
    const s = toRingArc(pr.offset, j.seamOffset, j.perimeter)
    if (j.candidates.some((o) => Math.abs(wrap(o.s - s, j.perimeter)) <= EPS)) return
    const customCount = j.candidates.filter((x) => x.custom).length + 1
    const c: Candidate = {
      id: `custom-${Date.now()}`,
      s,
      point: pr.point,
      edgeIndex: pr.edgeIndex,
      custom: true,
      collides: [],
      label: `M${customCount}`
    }
    j.candidates.push(c)
    refreshCollisions(j)
    selectedId.value = c.id
    markChanged()
  }

  function removeCandidate(id: string) {
    if (!job.value) return
    const j = job.value
    j.candidates = j.candidates.filter((c) => c.id !== id)
    refreshCollisions(j)
    if (selectedId.value === id) selectedId.value = null
    markChanged()
  }

  /** 复位：丢弃画布校正与参数覆盖，重新归一化原始 JSON */
  function resetAll() {
    if (lastRaw !== null) loadJson(lastRaw, fileName.value)
  }

  function setParam(key: keyof ParamOverride, value: number | null) {
    if (!job.value) return
    override[key] = value
    if (key === 'bridgeWidth' && job.value) refreshCollisions(job.value)
    markChanged()
  }

  function arcPoint(s: number): Vec | null {
    if (!job.value) return null
    return arcToPoint(job.value.polygon, job.value.cum, job.value.seamOffset, s)
  }

  return {
    job,
    issues,
    fileName,
    override,
    liveParams,
    result,
    stale,
    addMode,
    selectedId,
    loadJson,
    runSolve,
    moveCandidate,
    addCandidateAt,
    removeCandidate,
    resetAll,
    setParam,
    arcPoint
  }
}
