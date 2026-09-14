<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BridgeCanvas from './components/BridgeCanvas.vue'
import CutSheet from './components/CutSheet.vue'
import { useWorkbench } from './composables/useWorkbench'

const wb = useWorkbench()
const { job, fileName, result, addMode, selectedId, liveParams, paramError } = wb
const fileInput = ref<HTMLInputElement | null>(null)
const parseError = ref('')
const samples = [
  { file: 'regular-box.json', label: '常规纸盒刀版' },
  { file: 'single-bridge.json', label: '单桥整圈净长' },
  { file: 'offset-seam.json', label: '接缝不在数组起点' },
  { file: 'greedy-fail.json', label: '贪心失解' },
  { file: 'cross-seam.json', label: '跨接缝长悬空' },
  { file: 'forbidden-touch.json', label: '桥宽擦碰禁区' },
  { file: 'infeasible.json', label: '无解见证' }
]
const activeSample = ref('')

const errorIssues = computed(() => wb.issues.value.filter((i) => i.level === 'error'))
const warningIssues = computed(() => wb.issues.value.filter((i) => i.level === 'warning'))

function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  parseError.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result))
      activeSample.value = ''
      wb.loadJson(raw, f.name)
    } catch (e) {
      parseError.value = `JSON 语法错误：${(e as Error).message}`
    }
  }
  reader.readAsText(f)
}

async function loadSample(file: string) {
  parseError.value = ''
  const res = await fetch(`./samples/${file}`)
  const raw = await res.json()
  activeSample.value = file
  wb.loadJson(raw, file)
}

const candidateRows = computed(() => {
  const j = wb.job.value
  if (!j) return []
  return j.candidates
    .slice()
    .sort((a, b) => a.s - b.s)
    .map((c) => ({
      ...c,
      chosen: wb.result.value?.feasible && wb.result.value!.bridges.some((b) => b.candidateId === c.id)
    }))
})

const statusLine = computed(() => {
  const r = wb.result.value
  if (!r) {
    return wb.stale.value
      ? '候选或参数已变更，结果失效，请重新求解'
      : wb.job.value
        ? '数据已加载，点击“求解桥位”'
        : '请导入工件 JSON'
  }
  if (r.feasible) {
    return `可行方案：${r.count} 座桥，最大悬空 ${r.maxFree?.toFixed(2)} mm`
  }
  return `无可行方案（${r.witnesses.length} 条见证）`
})

onMounted(() => {
  // 默认载入常规样例，让工作台打开即有真实数据
  loadSample('regular-box.json')
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>模切钢刀桥位工作台</h1>
      <div class="import-box">
        <button type="button" class="btn" @click="fileInput?.click()">导入工件 JSON</button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          hidden
          @change="onFile"
        />
        <label class="sample-pick">
          示例：
          <select :value="activeSample" @change="loadSample(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>选择示例…</option>
            <option v-for="s in samples" :key="s.file" :value="s.file">{{ s.label }}</option>
          </select>
        </label>
        <span class="filename" data-testid="filename">{{ fileName }}</span>
      </div>
    </header>

    <p v-if="parseError" class="parse-error" data-testid="parse-error">{{ parseError }}</p>

    <div v-if="!job && errorIssues.length" class="issues" data-testid="import-errors">
      <h3>导入失败：{{ errorIssues.length }} 个错误</h3>
      <ul>
        <li v-for="(i, k) in errorIssues" :key="k">
          <code>{{ i.path }}</code>
          <span v-if="i.contourIndex !== undefined">（轮廓元素 #{{ i.contourIndex }}）</span>
          ：{{ i.message }}
        </li>
      </ul>
    </div>

    <main v-if="job" class="layout">
      <div class="left">
        <div class="canvas-toolbar no-print">
          <button
            type="button"
            class="btn primary"
            data-testid="solve-btn"
            @click="wb.runSolve()"
          >
            求解桥位
          </button>
          <button
            type="button"
            class="btn"
            :class="{ active: addMode }"
            data-testid="add-btn"
            @click="addMode = !addMode"
          >
            {{ addMode ? '退出增补' : '增补候选' }}
          </button>
          <button type="button" class="btn" data-testid="reset-btn" @click="wb.resetAll()">
            复位校正
          </button>
          <span class="status" data-testid="status">{{ statusLine }}</span>
        </div>

        <BridgeCanvas />

        <div class="legend no-print">
          <span><i class="lg outline"></i>闭合折线</span>
          <span><i class="lg seam"></i>固定接缝</span>
          <span><i class="lg corner"></i>角点</span>
          <span><i class="lg cand"></i>候选桥心（可拖动校正）</span>
          <span><i class="lg chosen"></i>已选桥覆盖</span>
          <span><i class="lg forbidden"></i>人工禁区</span>
          <span><i class="lg cross"></i>跨接缝悬空</span>
          <span><i class="lg witness"></i>不可行见证</span>
        </div>
      </div>

      <aside class="right">
        <section class="panel">
          <h3>参数（可临时校正）</h3>
          <label>桥宽 w (mm)
            <input
              type="number"
              step="0.1"
              min="0.1"
              :value="liveParams.bridgeWidth"
              data-testid="in-width"
              @change="wb.setParam('bridgeWidth', +($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>最小桥心距 (mm)
            <input
              type="number"
              step="0.5"
              min="0"
              :value="liveParams.minCenterDistance"
              @change="wb.setParam('minCenterDistance', +($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>最大悬空长度 (mm)
            <input
              type="number"
              step="0.5"
              min="0"
              :value="liveParams.maxFreeLength"
              @change="wb.setParam('maxFreeLength', +($event.target as HTMLInputElement).value)"
            />
          </label>
          <p class="muted small">周长 {{ job.perimeter.toFixed(2) }} mm；修改后需重新求解。</p>
          <p v-if="paramError" class="param-error" data-testid="param-error">{{ paramError }}</p>
        </section>

        <section class="panel" data-testid="candidate-panel">
          <h3>候选桥心（{{ candidateRows.length }}）</h3>
          <ul class="cand-list">
            <li
              v-for="c in candidateRows"
              :key="c.id"
              :class="{
                collision: c.collides.length,
                chosen: c.chosen,
                selected: selectedId === c.id
              }"
              @click="selectedId = c.id"
            >
              <strong>{{ c.label }}</strong>
              <span class="arc">s={{ c.s.toFixed(2) }}</span>
              <span v-if="c.custom" class="tag blue">校正</span>
              <span v-if="c.chosen" class="tag green">选</span>
              <span v-if="c.collides.length" class="tag red" :title="c.collides.join(', ')">
                碰禁区 {{ c.collides.join(',') }}
              </span>
              <button
                type="button"
                class="mini"
                :data-cand="c.id"
                @click.stop="wb.removeCandidate(c.id)"
              >
                删除
              </button>
            </li>
          </ul>
        </section>

        <section v-if="result" class="panel" data-testid="greedy-panel">
          <h3>摊直贪心对照（仅诊断）</h3>
          <p v-if="!result.greedy.produced" class="muted small">无候选，贪心未执行。</p>
          <p v-else class="small" :class="result.greedy.valid ? 'ok-text' : 'bad-text'">
            从排序首候选摊直贪心：{{ result.greedy.valid ? '恰好可行' : '失解/不可行' }}
            （{{ result.greedy.count }} 桥<template v-if="result.greedy.maxFree !== null">
              ，最大悬空 {{ result.greedy.maxFree.toFixed(2) }}</template>）
            <br v-if="result.greedy.reason" />
            <span v-if="result.greedy.reason">{{ result.greedy.reason }}</span>
          </p>
        </section>

        <section v-if="warningIssues.length" class="panel">
          <h3>导入告警（{{ warningIssues.length }}）</h3>
          <ul class="issue-list warn">
            <li v-for="(i, k) in warningIssues" :key="k"><code>{{ i.path }}</code>：{{ i.message }}</li>
          </ul>
        </section>
      </aside>
    </main>

    <div v-if="job" class="sheet-area">
      <CutSheet />
    </div>
  </div>
</template>

<style src="./styles.css"></style>
