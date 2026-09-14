/**
 * 生成 public/samples 下的示例工件。
 * 轮廓统一为矩形（顶点按数组顺序前进），seam 独立给出以保证数组换起点归一化不变。
 * 运行：npm run samples
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linearGreedy } from '../src/lib/solver'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'public', 'samples')

const W = 100
const H = 60
// 从 polygon[0] 起的弧长 -> 坐标
function rectPoint(s: number): { x: number; y: number } {
  const L = 2 * (W + H)
  s = ((s % L) + L) % L
  if (s <= W) return { x: s, y: 0 }
  if (s <= W + H) return { x: W, y: s - W }
  if (s <= 2 * W + H) return { x: W - (s - W - H), y: H }
  return { x: 0, y: L - s }
}

function cands(arcs: number[]) {
  return arcs.map((s, i) => ({ id: `C${i + 1}`, point: rectPoint(s) }))
}

function job(
  name: string,
  p: {
    arcs: number[]
    w: number
    dMin: number
    G: number
    seam?: { x: number; y: number }
    forbidden?: { id: string; fromS: number; toS: number; reason: string }[]
    corners?: number[]
  }
) {
  const polygon = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H }
  ]
  return {
    job: name,
    contour: polygon,
    seam: p.seam ?? { x: 0, y: 0 },
    bridgeWidth: p.w,
    minCenterDistance: p.dMin,
    maxFreeLength: p.G,
    corners: p.corners ?? [0, 1, 2, 3],
    candidates: cands(p.arcs),
    forbidden: (p.forbidden ?? []).map((z) => ({
      id: z.id,
      from: rectPoint(z.fromS),
      to: rectPoint(z.toS),
      reason: z.reason
    }))
  }
}

// 穷举验证（小样例）：桥数最少 + 跨接缝闭合
function brute(arcs: number[], L: number, w: number, dMin: number, G: number): number | null {
  const n = arcs.length
  const okGap = (a: number, b: number) => b - a >= dMin - 1e-9 && b - a - w <= G + 1e-9
  for (let k = 1; k <= n; k++) {
    const combos: number[][] = []
    const rec = (start: number, picked: number[]) => {
      if (picked.length === k) {
        combos.push(picked)
        return
      }
      for (let i = start; i < n; i++) rec(i + 1, picked.concat(i))
    }
    rec(0, [])
    for (const c of combos) {
      let good = true
      for (let i = 0; i < k; i++) {
        const a = arcs[c[i]]
        const b = arcs[c[(i + 1) % k]]
        const lifted = b <= a ? b + L : b
        if (!okGap(a, lifted)) {
          good = false
          break
        }
      }
      if (good) return k
    }
  }
  return null
}

function save(file: string, data: unknown) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, file), JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log('wrote', file)
}

// ---------- 1. 贪心失解：从首个候选摊直贪心无法闭合跨接缝，但最优解存在 ----------
{
  const L = 320
  const [w, dMin, G] = [6, 24, 70]
  // 贪心锚定 0：0→76→150→224→300，闭合桥心距仅 20 < dMin 而失败；
  // 跳过 0：30→76→150→224→300→(350)，全部净空 ≤70，5 桥可行且最优。
  const arcs = [0, 30, 76, 150, 224, 300]
  const g = linearGreedy(arcs, L, w, dMin, G)
  const b = brute(arcs, L, w, dMin, G)
  console.log('[greedy-fail] greedy valid:', g.valid, g.reason, 'bruteOptimalCount:', b)
  if (g.valid) throw new Error('贪心失解样例未使摊直贪心失败')
  if (b === null) throw new Error('贪心失解样例必须实际有解')
  save(
    'greedy-fail.json',
    job('贪心失解（锚定首候选闭合桥心距不足，跳过它 5 桥可行且最优）', {
      arcs,
      w,
      dMin,
      G,
      forbidden: [{ id: 'Z1', fromS: 96, toS: 120, reason: '拼接口加强带，禁止开桥' }]
    })
  )
}

// ---------- 2. 跨接缝：最长悬空恰好跨过接缝 ----------
{
  // 闭合桥间隔 260→60（提升 380）为 120，是全圈最大悬空，必须显式检查
  const arcs = [60, 130, 200, 260]
  save('cross-seam.json', job('跨接缝长悬空（260→60 闭合段为最大悬空）', { arcs, w: 6, dMin: 24, G: 120 }))
}

// ---------- 3. 桥宽擦碰禁区：一个候选桥心离禁区端点刚好半个桥宽，擦边即淘汰 ----------
{
  // 禁区 [100,120]；候选 s=97 时覆盖 [94,100]，100 端点相接 => 碰撞；s=93 覆盖 [90,96] 安全
  const arcs = [20, 93, 97, 180, 250]
  save(
    'forbidden-touch.json',
    job('桥宽擦碰禁区（C3 与禁区端点 100 擦边，淘汰后仍可解）', {
      arcs,
      w: 6,
      dMin: 24,
      G: 90,
      forbidden: [{ id: 'Z1', fromS: 100, toS: 120, reason: '压线区' }]
    })
  )
}

// ---------- 4. 无解：禁区吃掉中部候选，两端候选间净空超过最大悬空 ----------
{
  // 禁区 [70,260]（不跨缝），候选 40 与 290 的覆盖分别 [37,43]/[287,293] 不碰禁区；
  // 但 290→40 跨接缝桥心距 70 < dMin，且另一方向 40→290 净空 244 > G => 无可行布置
  const arcs = [40, 150, 290]
  save(
    'infeasible.json',
    job('无解见证（中部候选全部撞禁区，剩余候选跨接缝间距不足）', {
      arcs,
      w: 6,
      dMin: 80,
      G: 90,
      forbidden: [{ id: 'Z1', fromS: 70, toS: 260, reason: '大面积避让区' }]
    })
  )
}

// ---------- 5. 常规矩形刀版：角点标注，正常 6 桥 ----------
{
  const arcs = [20, 80, 115, 175, 215, 275]
  save('regular-box.json', job('常规纸盒刀版（矩形 100×60）', { arcs, w: 5, dMin: 20, G: 60 }))
}

// ---------- 6. 单桥：整圈净长 L-w 必须显示为正，且在 G 范围内可行 ----------
{
  save(
    'single-bridge.json',
    job('单桥刀版（整圈净长 314mm，唯一悬空跨接缝）', { arcs: [160], w: 6, dMin: 10, G: 314 })
  )
}

// ---------- 7. 接缝不在数组起点：3mm 桥画在右侧边中部，不允许被画成整圈 ----------
{
  save(
    'offset-seam.json',
    job('接缝偏置（seam 在右边 s=130，3mm 短桥就开在接缝处）', {
      arcs: [130],
      w: 3,
      dMin: 10,
      G: 400,
      seam: rectPoint(130)
    })
  )
}

console.log('samples done')
