# 模切钢刀桥位工作台

纯前端工作台（Vue 3 + TypeScript + Vite）：导入刀版 JSON，在画布上校正候选桥心，
按钢刀工艺约束求出**桥数最少、最大悬空最短、序列字典序**三级唯一最优的桥位方案，
并生成可打印（另存 PDF）的**切桥单**。全程在浏览器本地完成，无后端。

## 解决的工艺问题

模切钢刀嵌入刀模板前：

- 桥位过少 → 长段刀线悬空松动；桥位过密 → 切口被过度削弱；
- 桥宽覆盖不能擦碰人工禁区（压线、拼接口、避让区）；
- 相邻桥心环向距离不能小于 `minCenterDistance`；
- 相邻已选桥之间沿**整圈**的无桥净长（桥心距 − 桥宽）不能超过 `maxFreeLength`。

常见错误做法是把闭合轮廓在数组首尾处**摊直成一条线段再贪心布桥**：
它会在接缝处漏检最长悬空（跨接缝闭合段），或锚定错误候选而明明有解却报失解。
本工具在**环**上建模：枚举接缝后第一座桥作为锚点（每个可行候选都当一次锚点），
对跨接缝闭合段做与普通段完全相同的校核，再用链上动态规划在全部锚点方案中取唯一最优。
界面同时运行“摊直贪心”作为**对照诊断**，直观展示它在样例 `greedy-fail.json` 上失解。

## 数据格式（导入的本地 JSON）

```json
{
  "job": "纸盒刀版 A",
  "contour": [{"x": 0, "y": 0}, {"x": 100, "y": 0}],
  "seam": {"x": 0, "y": 0},
  "bridgeWidth": 5,
  "minCenterDistance": 20,
  "maxFreeLength": 60,
  "corners": [0, 1],
  "candidates": [
    {"id": "C1", "point": {"x": 20, "y": 0}},
    {"id": "C2", "at": 2},
    {"id": "C3", "s": 215.0}
  ],
  "forbidden": [
    {"id": "Z1", "from": {"x": 96, "y": 0}, "to": {"x": 120, "y": 0}, "reason": "拼接口"}
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `contour` | **闭合折线**顶点数组，按数组顺序前进，末点隐式回到首点；至少 3 点，相邻点不得重合 |
| `seam` | 固定接缝世界坐标（投影到最近轮廓边）；亦可用数值字段 `seamS`（自 `contour[0]` 的有向弧长） |
| `bridgeWidth` | 桥宽 w（mm，>0，且 < 周长）；桥口在桥心两侧各覆盖 w/2 |
| `minCenterDistance` | 相邻已选桥桥心沿整圈的最小环向距离（mm） |
| `maxFreeLength` | 相邻已选桥之间无桥净长（桥心距 − w）上限（mm） |
| `candidates` | **唯一允许开桥的位置**。可用 `point{x,y}`（自动投影）、`at`（顶点下标）或 `s`（自 `contour[0]` 弧长）三选一 |
| `forbidden` | 人工禁区弧段，端点同样支持 `from/to`（点）、`fromIndex/toIndex`、`fromS/toS`；`to` 落在 `from` 之前表示**跨接缝禁区** |
| `corners` | 角点（仅标注），顶点下标数组或 `{point|at|s}` 对象数组 |

### 归一化与“换起点不变”

导入后所有位置都换算成**自固定接缝起沿轮廓前进方向的环向弧长 s∈[0,L)**。
接缝由世界坐标（或 `seamS`）独立确定，与 `contour` 数组从哪个顶点开始无关：
把 `contour` 循环移位（换起点），同一物理刀版的候选序列、禁区、求解结果完全一致
（见单元测试“轮廓数组换起点不改变归一化结果”）。

### 错误定位

导入不合法时**不会出方案**，错误逐条定位到字段路径与轮廓元素下标，例如
`contour[2].x`（轮廓元素 #2）、`candidates[3].at`、`forbidden[1].to`、`bridgeWidth`。

## 求解规则

只可从候选位选桥；候选被淘汰的条件：其桥宽覆盖区间 `[s−w/2, s+w/2]`
与任一禁区弧段相交（**端点相接即算擦碰**，1 µm 容差）。

对最终方案，沿环依次校核每一对相邻桥（含最后一座桥 → 第一座桥的跨接缝闭合段）：

- 桥心距离 ≥ `minCenterDistance`；
- 无桥净长 = 桥心距离 − w ≤ `maxFreeLength`。

解的唯一优先级：

1. **桥数最少**；
2. 桥数相同，**最大无桥悬空净长最短**；
3. 仍并列，取**自接缝起的桥心环向序列**字典序最小者。

无解时给出可在画布上直接看到的**见证**：相邻可行候选之间无任何候选可填却仍超长的
“悬空超长”段（跨接缝会显式标注）、即使候选全选仍违反桥心距的“桥心距不足”对、
以及全部候选都撞禁区时的“无可选桥位”整圈见证。切桥单在无解时明确提示**禁止嵌刀**。

## 画布校正

- **拖动**候选短横标记：松手时重新投影到最近轮廓边，候选标记为“校正”；
- **增补候选**：进入增补模式后点击轮廓边任意位置（投影落点）；
- 候选列表可删除候选；参数面板可临时微调桥宽/最小桥心距/最大悬空；
- 任何校正都会使已求结果失效（状态栏提示重新求解），“复位校正”回到原始 JSON；
- 高亮：紫色弧=跨接缝悬空，红色粗段=人工禁区，红色虚线=不可行见证，蓝色粗段=已选桥覆盖；
  红色虚线候选短横=桥宽擦碰禁区（不可选）。

## 本地开发

```bash
npm ci
npm run dev          # 开发服务器
npm run test:unit    # Vitest（含桥宽擦碰、贪心失解、跨接缝、无解、换起点归一化）
npm run build        # vue-tsc 类型检查 + 生产构建
npm run preview      # 预览生产构建（4173 端口）
npm run test:e2e     # Playwright（自动起 preview；需先 npm run build）
npm run samples      # 重新生成 public/samples 下样例（脚本内含贪心/穷举断言）
```

内置样例（`public/samples/`）：

- `regular-box.json` 常规矩形刀版；
- `greedy-fail.json` **摊直贪心失解而精确解为 5 桥**（闭合桥心距 20 < 下限 24）；
- `cross-seam.json` 最大悬空（114 mm）恰为 260→60 **跨接缝闭合段**；
- `forbidden-touch.json` 候选 C3 的桥宽在 s=100 处与禁区**端点擦碰**被淘汰；
- `infeasible.json` 无解：中部候选全部撞禁区，剩余候选跨接缝间距不足。

## Docker Compose

静态应用（nginx 托管 `dist/`）：

```bash
docker compose up --build -d
# 浏览器打开 http://localhost:8080
APP_PORT=9090 docker compose up --build -d   # 用 APP_PORT 覆盖宿主端口
```

一次性校验服务（Vitest 单元测试 + 生产构建 + Playwright 端到端，跑完即退出）：

```bash
docker compose build verify
docker compose run --rm verify
```

`verify` 使用 `mcr.microsoft.com/playwright:v1.49.1-jammy` 镜像（内置 Chromium 与系统库），
Playwright 的 `webServer` 配置会在容器内自行 `npm run preview`，无需暴露端口。

## 目录

```
src/
  lib/geometry.ts    折线投影、累积弧长、环向弧长换算
  lib/arcs.ts        桥宽覆盖 × 禁区的环向闭区间擦碰判定
  lib/importJob.ts   JSON 解析、字段级校验、接缝归一化
  lib/solver.ts      锚点枚举 + 链上 DP（Pareto 前沿）+ 摊直贪心对照 + 无解见证
  lib/svgPath.ts     环向弧段（含跨接缝）→ 画布沿轮廓路径
  composables/       全局工作台状态（导入/校正/参数/求解）
  components/        画布与可打印切桥单
tests/unit           Vitest
tests/e2e            Playwright
docker/              nginx 配置与 verify 脚本
```
