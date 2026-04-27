# KRIG Graph · Layout Engine Spec

> Layout Spec v0.1 · 2026-04-28（B3.4 决策版，可进入实现阶段）
>
> 作者：wenwu + Claude
>
> 本 spec 是 KRIG Graph **布局引擎** 的设计文档，与 [`KRIG-Graph-Import-Spec.md`](./KRIG-Graph-Import-Spec.md) §2 衔接（取代该节的 v1 简化设计）。
>
> 主旨：**KRIG Graph 是知识表示工具，布局算法不该是技术债**。引入业界级布局引擎 [Eclipse Layout Kernel (ELK)](https://eclipse.dev/elk/) 的 JS 端口 elkjs，替换 v1.4 阶段为"先跑起来"手写的 force / grid / tree-hierarchy 三个算法。
>
> v1.4 → v1.7 阶段 graph 模块仍属**实验阶段**，无外部用户依赖现有 layout 行为，是替换技术债的最佳时机。

---

## 0. 定位

### 0.1 解决的问题

KRIG Graph 是基于知识图谱的知识表示工具（详见 [`KRIG-Note-Vision.md`](../KRIG-Note-Vision.md) §1）。**知识表示能力的强弱直接取决于布局质量**：

- 节点位置不合理 → 用户看不出结构关系
- 边相互交叉 / 穿过节点 → 关系网难以阅读
- 复杂图（DAG、多根树、含环）布局崩溃 → 高级视图无法实现

v1.4 阶段的手写布局是为"先把 Graph 跑起来"写的，从未被设计为长期方案：

| 现有算法 | v1.4 实现 | 已知问题 |
|---------|-----------|----------|
| `force` | 简化力导（手写） | 无应力收敛、无自适应步长、节点稍多即抖 |
| `grid` | 固定网格（手写） | 不考虑节点尺寸差异、不处理散户 |
| `tree-hierarchy` | BFS + 字典序（手写，B3.3 加） | 子树会重叠、不紧凑、非业界 Tidy Tree |

### 0.2 核心决策（2026-04-28）

> **引入 elkjs 替换三个手写算法。所有 layout 走 ELK，统一接口、统一品质。**

理由：

| 论点 | 解释 |
|------|------|
| 早换比晚换便宜 | graph 模块属实验阶段，无用户依赖现有 layout 行为；积累用户后再换会造成"破坏性变更" |
| 手写算法是技术债 | force / grid / tree-hierarchy 在 v1.4 阶段写的简化版，不是想长期维护的代码 |
| 一次性获得 9 个业界级算法 | ELK 自带 layered / mrtree / radial / force / stress / disco / box / fixed / random，KRIG 现在 3 个手写 → 9 个免费 |
| 边路由免费 | ELK 输出 edge sections 含 bendPoints，端点已贴节点边缘；KRIG 现有 `clipLineEndpointsToShapes` 工具变冗余 |
| 未来 DAG / 嵌套 / ports 场景免费 | KRIG 愿景 §5.4 用户能创造视图模式，未来必有依赖图 / 流程图 / 状态机 — ELK 是这些的标准实现 |
| 接口同构 | 升级后所有 layout 都是"调 ELK + 写 adapter"模式，未来加新视图模式注册一行 |
| 包体积代价可接受 | KRIG 是 Electron 桌面应用；elkjs unpacked ~8 MB 在桌面应用语境下无感 |

### 0.3 不在本 spec 范围

- ❌ Pattern Substance 局部布局（B3.2 已实现，是 ELK 之外的"群内"位置；详见 [Pattern Spec §3.1](./KRIG-Graph-Pattern-Spec.md#31-合成顺序决议-v02)）
- ❌ ViewMode 切换 UI（B3.3 已实现）
- ❌ projection 渲染管线（B3.4 范围，但本 spec 只触及 layout，详见 [Pattern Spec §2.6](./KRIG-Graph-Pattern-Spec.md#26-projection-开放注册决议-v02)）

---

## 1. ELK 简介

### 1.1 是什么

**Eclipse Layout Kernel (ELK)** 是 Eclipse 基金会下的图布局算法框架。原生 Java，由 KIELER 项目组维护 20+ 年，业界事实标准之一（与 graphviz、OGDF 并列）。

**elkjs** 是 ELK 通过 GWT 编译到 JavaScript 的官方端口，每月与 ELK 主版本同步发布。npm 包，零运行时依赖，周下载量 200 万+。

### 1.2 提供的能力

```
ELK 不只是"一个布局算法"，是"一组互补的布局算法 + 边路由引擎"：

  ┌─ 节点定位算法 ─────────────────────────┐
  │  layered    分层 DAG（流程图、依赖图） │
  │  mrtree     多根树（contains 树首选）  │
  │  radial     径向树（思维导图）         │
  │  force      力导（应力收敛 + 自适应）  │
  │  stress     应力布局（关系密度大时）   │
  │  disco      不连通组件分组             │
  │  box        盒装平铺（≈ KRIG grid）    │
  │  fixed      固定位置（用户拖动后）     │
  │  random     随机布局（调试用）         │
  └────────────────────────────────────────┘

  ┌─ 边路由引擎（独立于布局算法） ─────────┐
  │  ORTHOGONAL  直角折线（组织架构图风）   │
  │  POLYLINE    多段直线                   │
  │  SPLINES     三次贝塞尔（思维导图风）   │
  │  UNDEFINED   两端直接连线（默认）       │
  └────────────────────────────────────────┘
```

### 1.3 ELK 与 d3-hierarchy 的对比

调研期对比过 d3-hierarchy（业界另一主流方案），最终选 ELK 的关键差别：

| 维度 | d3-hierarchy | elkjs |
|------|--------------|-------|
| 解决问题 | **纯树**（每节点一个父） | **DAG / 通用图** |
| 算法数 | 4（tree / cluster / pack / partition） | **9** |
| 边路由 | 用户自画 | **专门引擎，输出 bend points** |
| ports | 无 | 节点可定义 N 个 port |
| 嵌套子图 | 无 | 支持 hierarchical compound |
| 包体积 | ~14 KB gzip | ~250 KB gzip |
| API | 同步 | 异步（WebWorker） |
| 场景上限 | 几百节点纯树 | 几千节点复杂图 |

**KRIG 选 ELK 的根本原因**：愿景 §5.4 "用户能创造视图模式"必然导向 DAG / 流程图 / 状态机等场景，d3-hierarchy 一年内会撞天花板，ELK 不会。

### 1.4 ELK 不是 KRIG 的渲染层

**关键澄清**：ELK 只是"坐标计算器"，**不碰渲染**：

```
ELK 只做：
  输入：{ children: [{id, width, height}], edges: [{sources, targets}] }
       ↓
  输出：{ children: [{id, x, y}], edges: [{sections: [bendPoints]}] }

ELK 不做：
  ❌ 不画 SVG
  ❌ 不画 Canvas
  ❌ 不操作 DOM
  ❌ 不依赖任何 UI 框架
```

**KRIG 渲染层（Three.js / SceneManager / shapes）100% 不变**。ELK 替换的是 layout 算法的内核，不是渲染管线。

---

## 2. 接口异步化

### 2.1 LayoutAlgorithm 接口变更

ELK 的 `elk.layout()` 返回 Promise（算法跑在 WebWorker 里）。KRIG 现有 `LayoutAlgorithm.compute` 是同步签名，需要异步化：

```typescript
// v1.4（同步）
interface LayoutAlgorithm {
  id: string;
  label: string;
  supportsDimension: (2 | 3)[];
  compute(input: LayoutInput): LayoutOutput;       // ← 同步
}

// v1.8 B3.4（异步）
interface LayoutAlgorithm {
  id: string;
  label: string;
  supportsDimension: (2 | 3)[];
  compute(input: LayoutInput): Promise<LayoutOutput>;  // ← 异步
}

interface LayoutOutput {
  positions: Map<string, { x: number; y: number; z?: number }>;
  /** B3.4 新增：边路由产物（projection 用） */
  edgeSections?: Map<string, EdgeSection[]>;
}

interface EdgeSection {
  startPoint: { x: number; y: number };
  endPoint:   { x: number; y: number };
  bendPoints: Array<{ x: number; y: number }>;
}
```

### 2.2 LayoutInput 扩展（B3.4 label-aware sizing）

KRIG label 是富内容（行内公式 / 公式块 / 列表 / 多字体回退），实际 bbox 与 substance 声明的 size 经常不一致（详见 §7）。LayoutInput 新增字段让 layout adapter 在调 ELK 前能查询 label 真实尺寸：

```typescript
interface LayoutInput {
  // 既有字段
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtom[];
  presentations: GraphPresentationAtom[];
  substanceResolver: (id: string) => Substance | undefined;
  dimension: 2 | 3;
  bounds?: { width: number; height: number; depth?: number };

  // ── B3.4 新增 ──
  /**
   * 同步查询节点 label 真实 bbox。
   * 实现：先查 presentation atom 中的 label_bbox 字段 → 命中直接返回
   *       未命中则返回 undefined，由 adapter 用 substance.visual.size 兜底
   * 异步测量在 GraphView mount 时跑（背景任务），不阻塞 layout 调用
   */
  measureLabel?: (geometryId: string) => { width: number; height: number } | undefined;
}
```

### 2.3 影响面

调用 LayoutAlgorithm 的地方：

| 文件 | 影响 |
|-----|------|
| `src/plugins/graph/layout/force.ts` | 改 async，内部调 ELK 'force'，按 §7 算 padded size |
| `src/plugins/graph/layout/grid.ts` | 改 async，内部调 ELK 'box' |
| `src/plugins/graph/layout/tree-hierarchy.ts` | 改 async，内部调 ELK 'mrtree' |
| `src/plugins/graph/components/GraphView.tsx` | useEffect 已是 async，加 await；加 label 测量预热步骤 |
| `src/plugins/graph/layout/types.ts` | 接口 sync → async + 加 measureLabel |
| `src/plugins/graph/layout/label-measurer.ts` | **新文件**：跑 SvgGeometryContent 测尺寸 + 写 presentation atom |

### 2.4 边路由数据出口

新增 `LayoutOutput.edgeSections` 字段：

```
ELK 输出 → adapter 暂存到 LayoutOutput.edgeSections（按 line geometry id 索引）
        ↓
projection.customizeLine(lineInst, ...) 从 sections 取 bendPoints
        ↓
LineSegmentShape（扩展支持多点）→ Three.js BufferGeometry
```

只有 ELK 算的 layout 会产出 sections；纯位置算法（v1.5+ 用户自定义的）可省略。

---

## 3. 9 个算法的注册路径

### 3.1 v1.8（B3.4）注册的算法

```typescript
// src/plugins/graph/layout/elk-runner.ts
//   - 单例 ELK 实例（WebWorker 模式）
//   - 三个 layout adapter 共用

// src/plugins/graph/layout/force.ts        — ELK 'force'
// src/plugins/graph/layout/grid.ts         — ELK 'box'
// src/plugins/graph/layout/tree-hierarchy.ts — ELK 'mrtree'
```

KRIG 对外的 LayoutAlgorithm id 保持不变（`force` / `grid` / `tree-hierarchy`），现有 ViewMode 注册和数据库 active_view_mode 字段无需迁移。

### 3.2 v1.9+ 后续注册路径（占位）

| KRIG layout id | ELK 算法 | 触发场景 |
|---------------|---------|---------|
| `radial-tree` | radial | 思维导图视图 |
| `layered` | layered | 依赖图 / 流程图视图 |
| `stress` | stress | 大图谱关系密度高场景 |
| `disco` | disco | 多个不连通子图共存 |

每个新算法 = 注册一行 + 选项映射，无需改基础设施。

### 3.3 移除的算法

v1.4 spec 提到的 `manual`（纯 presentation 驱动）**不再单列为算法**。在 ELK 模式下：
- 用户拖动产生的 `pinned: true` 由 ELK 'fixed' 算法直接尊重
- 用户的位置 atom 通过 LayoutInput.presentations 传给 ELK，作为初始位置 hint

---

## 4. WebWorker 启动模式

### 4.1 选用分离模式

elkjs 提供两种发布形态：

| 形态 | 文件 | 适用 |
|-----|------|-----|
| Bundled | `elk.bundled.js` | 浏览器 `<script>` 标签，主线程算 |
| 分离 | `elk-api.js` + `elk-worker.js` | WebWorker 不阻塞主线程 |

**KRIG 选分离模式（WebWorker）**：

| 论点 | 解释 |
|------|------|
| 不阻塞主线程 | 算 1000+ 节点不卡 UI；切换 ViewMode 时主线程仍丝滑响应 |
| 与 KRIG 架构契合 | 主进程跑 SurrealDB / 渲染进程跑 Three.js，重计算外移到 Worker 是统一原则 |
| 未来扩展性 | 大图谱（v1.9+ 关系网炸开后）才不会成为瓶颈 |

### 4.2 单例模式

```
src/plugins/graph/layout/elk-runner.ts:
  - 模块加载时创建一个 ELK 实例
  - 所有 layout adapter 共用
  - WebWorker 在第一次 layout() 时启动，常驻
```

不每次 layout 都新建 ELK —— Worker 启动有开销（~50ms）。

---

## 5. 边路由策略

### 5.1 默认 ORTHOGONAL（直角折线）

v1.8 B3.4 默认 `'elk.edgeRouting': 'ORTHOGONAL'`，组织架构图风格。理由：

- 树形结构最经典的视觉语义
- 拐点少，视觉清晰
- 端点贴节点边，无需手写 clipLineEndpointsToShapes

### 5.2 接口预留 edgeStyle 字段

projection 接口支持 edgeStyle：

```typescript
interface Projection {
  id: string;
  label: string;
  description?: string;
  edgeStyle?: 'orthogonal' | 'splines' | 'polyline' | 'straight';  // ← B3.4 新增
}
```

v1.8 仅启用 `'orthogonal'`，`'splines'` 等留 v1.9+ 注册（一行代码）。

### 5.3 散户节点的边

ViewMode = tree 时，散户节点（无 contains 关系）由 ELK mrtree 当作独立树根处理。它们之间若存在其他关系（relates-to / refs / ...）：
- v1.8 暂不显示这些边（tree projection 只画 contains 父子边）
- v1.9+ 可加 "show non-tree edges" 选项，作为辅助直线显示

---

## 6. 实现路线（B3.4 milestone）

```
B3.4 (本 spec)  Layout Spec v0.1                 ← ✅ 完成（2026-04-28）
       ↓
B3.4.1  引入 elkjs + WebWorker 单例 + 接口异步化  ← Commit 1
       - npm install elkjs
       - elk-runner.ts 单例 + workerUrl 配置
       - LayoutAlgorithm 接口 sync → async + measureLabel 字段
       - GraphView 调用点加 await
       ↓
B3.4.2  三算法换芯到 ELK                          ← Commit 2
       - force.ts        → ELK 'force'  + adapter
       - grid.ts         → ELK 'box'    + adapter
       - tree-hierarchy.ts → ELK 'mrtree' + adapter
       - LayoutOutput 加 edgeSections 字段
       ↓
B3.4.3  tree projection 注册                      ← Commit 3
       - projection/built-in/tree.ts
       - customizeLine 从 edgeSections 取 bendPoints
       - viewmode/built-in/index.ts: tree 改 projection: 'tree'
       ↓
B3.4.4  LineSegmentShape 多点折线支持             ← Commit 4
       - setFromPoints([首,...中,尾]) 完整路径
       - 箭头仍只在末段
       ↓
B3.4.5  label-aware sizing（详见 §7）              ← Commit 5
       - presentation atom 加 label_bbox.width / .height 持久字段
       - label-measurer.ts: SvgGeometryContent.render → bbox → 写 atom
       - GraphView mount 时跑测量预热（背景任务，不阻塞首次渲染）
       - layout adapter 通过 input.measureLabel 查 bbox
       - getInstanceBoxSize: substance.size + labelLayout 方位 padding
       ↓
端到端验证（沿用 B3.3 Workspace-Pattern-Test + 新增公式 label 样本）：
  - 切到层级树视图 → 节点紧凑分层 + 直角折线父子边
  - 切回力导/网格 → ELK 算法替换后视觉同等或更优
  - 含公式 / 长文 label 的节点 → 节点间距足够，label 不越界
```

---

## 7. Label-aware sizing（B3.4 决策）

### 7.1 问题背景

KRIG 节点 label 不是简单文字，而是**富内容渲染管线**：

```
ProseMirror Atom[]（与 NoteView 同源的 atom 模型）
  ↓ atomsToSvg（textBlock / mathBlock / mathInline / list / table）
SVG 字符串（含 MathJax 渲染的公式 path、字体回退、多行布局）
  ↓ SvgGeometryContent
Three.js ShapeGeometry + Mesh（矢量、可缩放无锯齿）
```

支持：
- 行内公式（`mathInline`）
- 公式块（`mathBlock`）
- 列表 / 多行文字 / 富文本
- 字体回退（中英混排、emoji、多语言）
- 三级缓存（atom → SVG → Geometry → Mesh）

**这是 KRIG 区别于 Obsidian / Logseq 图谱视图的核心能力之一**（其他工具的图谱节点只能显示纯文本 ID）。

### 7.2 ELK 与 KRIG label 系统的边界

ELK **不参与** label 渲染，只算节点 (x, y)：

```
KRIG label 渲染（atom → SVG → Mesh）   ← 100% KRIG 自治，ELK 无感
                ↓
                只需要：节点 (x, y) + label anchor 位置
                ↓
ELK 输出节点 (x, y)                      ← ELK 唯一职责
                ↓
KRIG LabelLayout（inside-center / below-center / ...）算 anchor
                ↓
labelObj.position.set(anchor)           ← KRIG 原有 6 个 LabelLayout 不动
```

### 7.3 真实问题：节点尺寸 vs label 实际 bbox 不一致

substance 声明的 `visual.size = { width, height }` 是设计期硬编码，无法预知 label 实际渲染尺寸。例子：

```
substance:        krig-formula
visual.size:      { width: 120, height: 60 }
labelLayout:      'inside-center'
实际 label 内容： \int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
SvgGeometryContent 渲染后实际 bbox: { width: 280, height: 50 }
```

v1.4 力导布局下节点抖动掩盖了这个问题；ELK 排得严丝合缝后**label 越界 / 重叠会显眼**。

### 7.4 决策：方案 C — 异步测量 + 持久化到 atom

| 方案 | 描述 | 取舍 |
|------|------|------|
| A | 信任 substance.visual.size，作者保证 | 零改动；但用户写公式必爆边，留技术债 |
| B | 渲染期同步测量，反馈给 ELK 重排 | 准确；但 label 渲染跑两次，首次加载慢 |
| **C** | **首次渲染测尺寸 → 写 presentation atom → 后续读** | 稳态性能好；首次加载有测量步骤；要加 schema 字段 |

**核心决策（2026-04-28）**：选 C。一次到位，不留技术债。

### 7.5 数据模型扩展

`graph_presentation_atom` 表加两个字段（schemaless，不需要 migration）：

```typescript
interface GraphPresentationAtomRecord {
  // 既有字段
  graph_id, layout_id, subject_id, attribute, value, value_kind, ...

  // ── B3.4 新增 ──
  // 这两个字段以独立 atom 行存储，与 position.x / .y 同形式：
  //   { layout_id: '*', attribute: 'label_bbox.width',  value: '280', value_kind: 'number' }
  //   { layout_id: '*', attribute: 'label_bbox.height', value: '50',  value_kind: 'number' }
}
```

`layout_id = '*'`（跨布局通用） — label 实际尺寸不依赖布局算法。

### 7.6 测量流程

```
GraphView 加载图谱：
  ① 从 atom 表读 RenderableScene（含 label 内容）
  ② 异步并发：所有节点跑 SvgGeometryContent.render(label.atoms) 测 bbox
        ├─ 命中 SVG L1 / Geometry L2 缓存 → 几乎瞬间
        └─ 未命中 → MathJax 渲染（公式节点稍慢，~50ms / 个）
  ③ 测出的 bbox 写回 graph_presentation_atom（label_bbox.width / .height）
        ├─ 与 atom 表既有 atom 比对，差异 > 1px 才写（避免无意义写）
        └─ 节点 label 内容变更时，下次渲染重测重写
  ④ 测量完成后调 layout：
        layout adapter 通过 LayoutInput.measureLabel(geometryId) 查
        ├─ 命中（已写过 atom）→ 用真实 bbox
        └─ 未命中（首次 / 异步未跑完）→ 用 substance.visual.size 兜底
  ⑤ ELK 算位置 → 渲染 → fitToContent
```

**关键：测量是异步背景任务，不阻塞首次渲染**。首次进入图谱时用 substance 声明的 size 排，~100ms 后测量完成，自动重排（用户视觉感受到节点轻微调整位置 = 自适应）。

### 7.7 getInstanceBoxSize 工具

```
function getInstanceBoxSize(inst, measureLabel) {
  const substanceSize = inst.visual.size ?? defaultSize(inst.visual.shape);
  const labelBbox = measureLabel?.(inst.id);
  if (!labelBbox) return substanceSize;  // 兜底

  switch (inst.visual.labelLayout) {
    case 'inside-center':
    case 'inside-top':
      // label 在 shape 内 → 取 shape 与 label 的较大者，不再 padding
      return {
        width:  Math.max(substanceSize.width,  labelBbox.width  + 2 * margin),
        height: Math.max(substanceSize.height, labelBbox.height + 2 * margin),
      };

    case 'above-center':
    case 'below-center':
      // label 在 shape 上下 → shape 高度 + label 高度 + margin
      return {
        width:  Math.max(substanceSize.width, labelBbox.width),
        height: substanceSize.height + labelBbox.height + margin,
      };

    case 'left-of':
    case 'right-of':
      return {
        width:  substanceSize.width + labelBbox.width + margin,
        height: Math.max(substanceSize.height, labelBbox.height),
      };
  }
}
```

ELK 把这个 padded size 当作"含 label 的总占位框"处理；shape mesh 落位时仍按 substance.visual.size 摆，label 由 KRIG LabelLayout 摆到外部 padding 区。

### 7.8 边 label（B3.4 不处理）

KRIG 当前 5 个内置 relation substance 都**没有边 label**（仅箭头 + 颜色）。RenderableInstance 中 line 的 label 字段在 adapter 也未填。

未来加边 label（例如 "contains" 字样标在边中段）时：
- ELK input 写 `edges[].labels`（含尺寸）
- ELK output 在 sections 中返回 label 位置
- KRIG 复用 SvgGeometryContent 渲染同样的富内容

留 v1.9+。

---

## 8. 与愿景的对应关系

| 愿景原则 | 本 spec 对应 |
|---------|-----------|
| §5.1 图谱面向机器 / 视图面向人 | ELK 是"机器→人"的翻译引擎之一，专属 Layer 3 |
| §5.3 一图多表 | 9 个算法 → 9+ 种布局视角，强化"一图多表" |
| §5.4 用户能创造视图模式 | ELK 提供基础设施，未来用户的自定义 ViewMode 直接复用 |
| §5.5 媒介定位 | 业界级布局是"知识表达"的基础设施 |
| §5.6 视图是双向接口 | 'fixed' 算法尊重用户拖动；presentations 作为初始 hint 传 ELK |

---

## 9. 不在本 spec 范围

- ❌ ELK 算法的内部数学原理 — 信任上游实现
- ❌ ELK 选项的全部 150+ 项配置 — 按需暴露
- ❌ 自定义算法插件 — KRIG 一律走 ELK 配置或新增 adapter，不写新算法
- ❌ 边 label 的渲染与定位 — 当前 5 个内置 relation 无边 label，留 v1.9+
- ❌ label 内容在视图中的实时编辑 — 双向闭环（愿景 §5.6）的事，独立 milestone

---

## 10. 修订历史

| 日期 | 修订 | 触发 |
|------|------|------|
| 2026-04-28 | v0.1 决策版 | B3.4 启动；wenwu 决策"不留技术债，graph 实验阶段是替换最佳时机"；选 ELK 而非 d3-hierarchy 因 KRIG 长期面向 DAG / 复杂视图 |
| 2026-04-28 | v0.1.1 加 §7 label-aware sizing | wenwu 指出 KRIG label 支持公式 / 富内容，是知识表示能力核心；决策方案 C：异步测量 → 写 presentation atom → 后续读，一次到位不留技术债 |
