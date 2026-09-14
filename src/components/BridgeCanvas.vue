<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Candidate, Vec, Witness } from '../types'
import { useWorkbench } from '../composables/useWorkbench'
import { fitViewBox, pointsToPath, arcToPath } from '../lib/svgPath'
import { forwardGap } from '../lib/geometry'

const wb = useWorkbench()
const { job, result, addMode, selectedId } = wb
const svgEl = ref<SVGSVGElement | null>(null)

const fit = computed(() => (job.value ? fitViewBox(job.value.polygon, 10) : null))

const viewBox = computed(() => {
  const f = fit.value
  return f ? `${f.vbX} ${f.vbY} ${f.vbW} ${f.vbH}` : '-10 -10 120 80'
})

const polygonPath = computed(() =>
  job.value
    ? pointsToPath(job.value.polygon.concat(job.value.polygon[0]))
    : ''
)

function svgPoint(ev: PointerEvent | MouseEvent): Vec | null {
  const svg = svgEl.value
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX
  pt.y = ev.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

let draggingId: string | null = null

function onCandidateDown(ev: PointerEvent, c: Candidate) {
  if (addMode.value) return
  ev.stopPropagation()
  ;(ev.target as Element).setPointerCapture?.(ev.pointerId)
  draggingId = c.id
  selectedId.value = c.id
}

function onPointerMove(ev: PointerEvent) {
  if (!draggingId) return
  const p = svgPoint(ev)
  if (p) wb.moveCandidate(draggingId, p)
}

function onPointerUp(ev: PointerEvent) {
  if (draggingId) {
    draggingId = null
    void ev
    return
  }
}

function onBackgroundClick(ev: MouseEvent) {
  if (!addMode.value) {
    selectedId.value = null
    return
  }
  const p = svgPoint(ev)
  if (p) wb.addCandidateAt(p)
}

/** 已选桥的粗标记路径 */
const bridgePaths = computed(() => {
  const j = job.value
  const r = result.value
  if (!j || !r?.feasible) return []
  return r.bridges.map((b) => {
    const half = j.bridgeWidth / 2
    const pts = arcToPath(j.polygon, j.cum, j.seamOffset, b.s - half, b.s + half)
    return { id: b.candidateId, d: pointsToPath(pts) }
  })
})

/** 跨接缝悬空高亮（可行方案里净长最大的闭合段；无解时取 gap 见证） */
const crossSeamPaths = computed(() => {
  const j = job.value
  if (!j || !result.value) return []
  const r = result.value
  const out: { d: string; label: string; danger: boolean }[] = []
  if (r.feasible) {
    for (const sp of r.spans.filter((s) => s.crossesSeam)) {
      const ca = j.candidates.find((c) => c.id === sp.fromId)!
      const cb = j.candidates.find((c) => c.id === sp.toId)!
      const pts = arcToPath(j.polygon, j.cum, j.seamOffset, ca.s, liftTo(ca.s, cb.s, j.perimeter))
      out.push({
        d: pointsToPath(pts),
        label: `跨接缝悬空 ${sp.freeLength.toFixed(1)}`,
        danger: sp.freeLength > j.maxFreeLength + 1e-6
      })
    }
  }
  return out
})

function liftTo(a: number, b: number, L: number): number {
  const g = forwardGap(a, b, L)
  return a + g
}

const witnessPaths = computed(() => {
  const j = job.value
  const r = result.value
  if (!j || !r || r.feasible) return []
  return r.witnesses.map((w: Witness) => {
    const pts = arcToPath(j.polygon, j.cum, j.seamOffset, w.arcA, w.arcB)
    return {
      d: pointsToPath(pts),
      kind: w.kind,
      message: w.message,
      crosses: w.crossesSeam
    }
  })
})

const zonePaths = computed(() => {
  const j = job.value
  if (!j) return []
  return j.forbidden.map((z) => {
    const end = z.wraps ? z.b + j.perimeter : z.b
    const pts = arcToPath(j.polygon, j.cum, j.seamOffset, z.a, end)
    return { id: z.id, d: pointsToPath(pts), reason: z.reason }
  })
})

const seamTick = computed(() => {
  const j = job.value
  if (!j) return null
  // 接缝处画一个小方块 + 垂线
  const p = j.seamPoint
  return { x: p.x, y: p.y }
})

const chosenIds = computed(
  () => new Set(result.value?.feasible ? result.value!.bridges.map((b) => b.candidateId) : [])
)
</script>

<template>
  <div class="canvas-wrap" :class="{ adding: addMode }">
    <svg
      ref="svgEl"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @click="onBackgroundClick"
    >
      <!-- 轮廓 -->
      <path :d="polygonPath" class="outline" fill="none" />

      <!-- 人工禁区 -->
      <path
        v-for="z in zonePaths"
        :key="'z-' + z.id"
        :d="z.d"
        class="forbidden"
        :title="z.reason"
      />

      <!-- 无解见证弧段 -->
      <path
        v-for="(w, i) in witnessPaths"
        :key="'w-' + i"
        :d="w.d"
        class="witness"
        :class="w.kind"
        :title="w.message"
      />

      <!-- 跨接缝悬空 -->
      <path
        v-for="(p, i) in crossSeamPaths"
        :key="'cs-' + i"
        :d="p.d"
        class="cross-seam"
        :class="{ danger: p.danger }"
        :title="p.label"
      />

      <!-- 已选桥覆盖 -->
      <path v-for="b in bridgePaths" :key="'b-' + b.id" :d="b.d" class="bridge" />

      <!-- 角点 -->
      <g v-if="job">
        <polygon
          v-for="(c, i) in job.corners"
          :key="'cor-' + i"
          :points="`${c.point.x},${c.point.y - 2.2} ${c.point.x + 2.2},${c.point.y} ${c.point.x},${c.point.y + 2.2} ${c.point.x - 2.2},${c.point.y}`"
          class="corner"
        />
      </g>

      <!-- 接缝 -->
      <g v-if="seamTick">
        <rect
          :x="seamTick.x - 1.6"
          :y="seamTick.y - 1.6"
          width="3.2"
          height="3.2"
          class="seam"
        />
        <text :x="seamTick.x + 3" :y="seamTick.y - 3" class="seam-label">接缝</text>
      </g>

      <!-- 候选桥心 -->
      <template v-if="job">
        <g
          v-for="c in job.candidates"
          :key="c.id"
          class="cand"
          :class="{
            collision: c.collides.length > 0,
            chosen: chosenIds.has(c.id),
            custom: c.custom,
            selected: selectedId === c.id
          }"
          @pointerdown="(e) => onCandidateDown(e, c)"
        >
          <line
            :x1="c.point.x - 3"
            :y1="c.point.y"
            :x2="c.point.x + 3"
            :y2="c.point.y"
            class="mark"
          />
          <circle :cx="c.point.x" :cy="c.point.y" r="4.2" class="hit" fill="transparent" />
          <circle v-if="chosenIds.has(c.id)" :cx="c.point.x" :cy="c.point.y" r="2.4" class="dot" />
          <text :x="c.point.x + 4.5" :y="c.point.y - 4" class="cand-label">{{ c.label }}</text>
          <text v-if="c.custom" :x="c.point.x + 4.5" :y="c.point.y + 7" class="custom-tag">校正</text>
        </g>
      </template>
    </svg>
    <div v-if="addMode" class="add-hint">增补模式：点击轮廓边任意位置新增候选桥心（再次点击按钮退出）</div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 420px;
  border: 1px solid #c8ced8;
  border-radius: 8px;
  background: #fbfcfe;
  overflow: hidden;
}
.canvas-wrap.adding {
  outline: 2px dashed #2563eb;
  outline-offset: -4px;
}
svg {
  width: 100%;
  height: 100%;
  display: block;
  cursor: default;
}
.adding svg {
  cursor: crosshair;
}
.outline {
  stroke: #33415c;
  stroke-width: 0.9;
}
.forbidden {
  stroke: #dc2626;
  stroke-width: 5;
  opacity: 0.55;
  stroke-linecap: butt;
}
.witness {
  stroke: #b91c1c;
  stroke-width: 6.5;
  opacity: 0.9;
  stroke-linecap: round;
  stroke-dasharray: 4 2.5;
}
.witness.spacing {
  stroke: #c2410c;
}
.witness.no-candidate {
  stroke: #7f1d1d;
  stroke-width: 4;
}
.cross-seam {
  stroke: #7c3aed;
  stroke-width: 3;
  opacity: 0.5;
}
.cross-seam.danger {
  stroke: #b91c1c;
}
.bridge {
  stroke: #1d4ed8;
  stroke-width: 4.5;
  stroke-linecap: butt;
}
.corner {
  fill: #64748b;
  stroke: #fff;
  stroke-width: 0.5;
}
.seam {
  fill: #047857;
  stroke: #fff;
  stroke-width: 0.5;
}
.seam-label,
.cand-label,
.custom-tag {
  font-size: 4px;
  fill: #33415c;
  paint-order: stroke;
  stroke: #fbfcfe;
  stroke-width: 0.8px;
}
.custom-tag {
  fill: #2563eb;
}
.cand {
  cursor: grab;
}
.cand .mark {
  stroke-width: 1.6;
  stroke: #0f766e;
}
.cand.custom .mark {
  stroke: #2563eb;
}
.cand.collision .mark {
  stroke: #dc2626;
  stroke-dasharray: 1.6 1.4;
}
.cand.chosen .mark {
  stroke: #1d4ed8;
  stroke-width: 2.2;
}
.cand.selected .hit {
  stroke: #2563eb;
  stroke-width: 0.8;
}
.add-hint {
  position: absolute;
  left: 12px;
  bottom: 12px;
  background: #2563eb;
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}
</style>
