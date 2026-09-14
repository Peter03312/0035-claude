<script setup lang="ts">
import { computed } from 'vue'
import { useWorkbench } from '../composables/useWorkbench'
import { EPS } from '../lib/geometry'

const wb = useWorkbench()
const { job, result, liveParams } = wb

const today = new Date()
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
  today.getDate()
).padStart(2, '0')}`

const rows = computed(() => {
  const j = job.value
  const r = result.value
  if (!j || !r?.feasible) return []
  const cand = (id: string) => j.candidates.find((c) => c.id === id)!
  // 自接缝起顺序：桥心弧长升序；悬空行挂在每座桥之后
  return r.bridges
    .slice()
    .sort((a, b) => a.s - b.s)
    .map((b, i) => {
      const span = r.spans.find((sp) => sp.fromId === b.candidateId)!
      const c = cand(b.candidateId)
      return {
        no: i + 1,
        label: c.label,
        arc: b.s,
        x: b.point.x,
        y: b.point.y,
        edge: c.edgeIndex,
        custom: c.custom,
        free: span.freeLength,
        crosses: span.crossesSeam
      }
    })
})

const maxSpanRow = computed(() => rows.value.reduce((m, r) => (r.free > (m?.free ?? -1) ? r : m), null as null | (typeof rows.value)[number]))

function print() {
  window.print()
}

void EPS
</script>

<template>
  <section v-if="job" class="sheet" data-testid="cut-sheet">
    <div class="sheet-toolbar no-print">
      <h3>切桥单</h3>
      <button type="button" class="btn primary" @click="print" data-testid="print-btn">打印 / 另存 PDF</button>
    </div>

    <div class="paper">
      <header class="paper-head">
        <h2>模切钢刀切桥单</h2>
        <table class="meta">
          <tbody>
            <tr><th>刀版名称</th><td>{{ job.name }}</td><th>出单日期</th><td>{{ dateStr }}</td></tr>
            <tr>
              <th>桥宽</th><td>{{ liveParams.bridgeWidth.toFixed(2) }} mm</td>
              <th>最小桥心距</th><td>{{ liveParams.minCenterDistance.toFixed(2) }} mm</td>
            </tr>
            <tr>
              <th>最大悬空限值</th><td>{{ liveParams.maxFreeLength.toFixed(2) }} mm</td>
              <th>轮廓周长</th><td>{{ job.perimeter.toFixed(2) }} mm</td>
            </tr>
          </tbody>
        </table>
      </header>

      <template v-if="result?.feasible">
        <p class="verdict ok">
          方案可行：共 <strong>{{ result.count }}</strong> 座桥，
          最大无桥悬空 <strong>{{ result.maxFree?.toFixed(2) }}</strong> mm
          <span v-if="maxSpanRow">（桥 {{ maxSpanRow.label }} 之后{{ maxSpanRow.crosses ? '，跨接缝闭合段' : '' }}）</span>
        </p>
        <table class="grid">
          <thead>
            <tr>
              <th>#</th><th>桥心编号</th><th>自接缝弧长 (mm)</th><th>坐标 X</th><th>坐标 Y</th>
              <th>所在边</th><th>校正</th><th>到下桥净空 (mm)</th><th>跨接缝</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.label" :class="{ seamrow: row.crosses }">
              <td>{{ row.no }}</td>
              <td>{{ row.label }}</td>
              <td>{{ row.arc.toFixed(2) }}</td>
              <td>{{ row.x.toFixed(2) }}</td>
              <td>{{ row.y.toFixed(2) }}</td>
              <td>E{{ row.edge }}→E{{ (row.edge + 1) % (job?.polygon.length ?? 1) }}</td>
              <td>{{ row.custom ? '人工' : '原候选' }}</td>
              <td :class="{ over: row.free > liveParams.maxFreeLength + EPS }">
                {{ row.free.toFixed(2) }}
              </td>
              <td>{{ row.crosses ? '是' : '' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="note">
          嵌刀说明：沿轮廓前进方向（轮廓顶点顺序），自固定接缝起按表开桥；
          桥口对称覆盖桥心各 {{ (liveParams.bridgeWidth / 2).toFixed(2) }} mm；
          最后一座桥与接缝后第一座桥之间为跨接缝闭合段，已纳入悬空校核。
        </p>
      </template>

      <template v-else-if="result">
        <p class="verdict bad">当前数据无可行桥位方案，禁止嵌刀。请处理下列见证段后重新求解：</p>
        <table class="grid">
          <thead><tr><th>类型</th><th>位置</th><th>实测</th><th>限值</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="(w, i) in result.witnesses" :key="i">
              <td>{{ w.kind === 'gap' ? '悬空超长' : w.kind === 'spacing' ? '桥心距不足' : '无可选桥位' }}</td>
              <td>{{ w.fromLabel }}→{{ w.toLabel }}{{ w.crossesSeam ? '（跨接缝）' : '' }}</td>
              <td>{{ (w.freeLength ?? w.centerDistance ?? job.perimeter).toFixed(2) }}</td>
              <td>{{ (w.required ?? '—') }}</td>
              <td>{{ w.message }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <p v-else class="verdict muted">导入并校正候选后点击“求解桥位”，此处生成可交付嵌刀的切桥单。</p>
    </div>
  </section>
</template>

<style scoped>
.sheet-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.sheet-toolbar h3 {
  margin: 0;
  font-size: 15px;
}
.paper {
  background: #fff;
  border: 1px solid #d7dce5;
  border-radius: 8px;
  padding: 16px 18px;
}
.paper-head h2 {
  margin: 0 0 10px;
  font-size: 18px;
}
.meta {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.meta th {
  text-align: left;
  width: 110px;
  color: #475569;
  padding: 2px 6px;
}
.meta td {
  padding: 2px 6px;
}
.verdict {
  margin: 12px 0 8px;
  font-size: 13px;
}
.verdict.ok {
  color: #166534;
}
.verdict.bad {
  color: #b91c1c;
}
.verdict.muted {
  color: #64748b;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.grid th,
.grid td {
  border: 1px solid #cbd5e1;
  padding: 4px 7px;
  text-align: left;
}
.grid th {
  background: #f1f5f9;
}
tr.seamrow td {
  background: #f5f3ff;
}
td.over {
  color: #b91c1c;
  font-weight: 700;
}
.note {
  font-size: 12px;
  color: #475569;
  margin: 10px 0 0;
}

@media print {
  .paper {
    border: none;
  }
}
</style>
