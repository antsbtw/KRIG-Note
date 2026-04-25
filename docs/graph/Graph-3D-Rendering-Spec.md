# KRIG 技术规范 · Graph 3D Rendering

> Design Spec v1.0 · 2026-04-25
>
> 本规范定义 GraphView 节点 / 边的 3D 渲染管线的最终形态。
>
> 关联文档：
> - 顶层架构：`docs/KRIG-Three-Layer-Architecture.md`
> - PoC 规范：`docs/graph/Graph-3D-Rendering-PoC-Spec.md`
> - PoC 评审报告：`docs/graph/Graph-3D-Rendering-PoC-Report.md`
> - GraphView v1.3：`docs/graph/KRIG_GraphView_Spec_v1.3.md`

---

## 0. 文档定位

本规范处于 **三层架构 · 可视化层 · GraphView 视图** 的内部技术决策层级。

它定义 GraphView 的渲染管线、形状/内容分离架构、序列化器边界、字体资源策略、缓存与性能策略、编辑模式切换。

**不**改动语义层（Atom 形态），**不**改动其他视图（Note/EBook/Web/Thought 各自的渲染选择不受影响）。

序列化器（`src/lib/atom-serializers/svg/`）作为**跨视图共享层**存在，但本规范只规定 GraphView 如何消费它；序列化器自身的演进由其他视图的需求共同驱动。

---

## 1. 概述

### 1.1 路线决议

GraphView 节点 label 的渲染管线为：

```
Atom[]
  ↓ atomsToSvg()                    [跨视图共享层]
SVG 字符串（path-only，文字 outline 化或 MathJax 直接 path 输出）
  ↓ THREE.SVGLoader.parse()
SVGResult { paths: [...] }
  ↓ SVGLoader.createShapes() + ShapeGeometry
THREE.Mesh × N
  ↓ THREE.Group 包装（含 y 轴翻转）
NodeRenderer 输出，作为节点 mesh 的 child
  ↓
进入 Three.js 场景
```

**取代**：原 v1.0~v1.2 使用的 `CSS2DRenderer` DOM 浮层路线。

**取代理由**：
- DOM 浮层不参与 3D 场景变换，无法与节点圆共享空间
- KaTeX strut 撑高问题在 DOM 盒模型下无法消除
- PoC 实测 SVG 几何路线在性能、清晰度、交互可行性上全部超越 DOM 浮层路线

### 1.2 PoC 验收回顾

PoC 阶段（2026-04-25，8 天）已正面验收 5 个核心问题：

| 问题 | 验收标准 | PoC 实测 |
|------|---------|---------|
| Q1 清晰度 | 1080p 可读 | 西文/中文/公式全清晰，120Hz 屏幕无失真 |
| Q2 形状/内容分离 | 接口完整可扩展 | ShapeRenderer + ContentRenderer + NodeRenderer 三接口落地 |
| Q3 bbox 反馈 | 链路打通 | fitToContent 接口被调用 |
| Q4 性能 | 单节点 <100ms / 5 节点 <500ms / 60fps | **单节点 1.6ms / 200 节点 328ms / 120fps** |
| Q5 交互可行性 | raycaster 命中节点 | hover 200 节点零延迟 |

详见 PoC 评审报告。

### 1.3 本规范的边界

**包含**：
- 渲染管线的最终架构（接口、模块边界、数据流）
- 序列化器（`src/lib/atom-serializers/svg/`）的接口契约
- 字体资源策略（哪些字体、子集化方案、加载时序）
- 缓存与增量更新策略
- 编辑模式切换的渲染契约
- 节点形状抽象（图谱 / 思维导图 / BPMN 共用）
- 边的渲染（线段、贝塞尔曲线、箭头、label）
- 性能基线与监控

**不包含**：
- 数据模型（GraphNode / GraphEdge / Atom）—— 见 GraphView Spec v1.3 § 4
- 业务交互逻辑（拖动、双击、键盘快捷键）—— 见 GraphView Spec v1.3 § 7
- 持久化（SurrealDB schema、IPC handler）—— 见 GraphView Spec v1.3 § 5
- 视图变种（思维导图 / BPMN）的具体实现 —— 各自独立 spec

---

## 2. 渲染管线总览

### 2.1 三层渲染抽象

```
┌─────────────────────────────────────────┐
│           GraphNode (data layer)         │
│  { id, position, atoms: Atom[], shape }  │
└─────────────────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────┐
│              NodeRenderer                │
│   组合 ShapeRenderer + ContentRenderer   │
└─────────────────────────────────────────┘
              │
       ┌──────┴──────┐
       ↓             ↓
┌──────────────┐ ┌─────────────────┐
│ShapeRenderer │ │ContentRenderer  │
│              │ │                 │
│ CircleShape  │ │ SvgGeometry     │
│ RoundRectShp │ │   Content       │
│ DiamondShape │ │ (text→path→mesh)│
│ TaskShape    │ │                 │
│ ...          │ │ FutureContent   │
└──────────────┘ └─────────────────┘
              │
              ↓
┌─────────────────────────────────────────┐
│        atom-serializers/svg/             │
│  Atom[] → SVG (path-only) → string       │
└─────────────────────────────────────────┘
```

### 2.2 模块物理位置

```
src/lib/atom-serializers/             # 跨视图共享层（不属于任何 plugin）
  └── svg/
      ├── index.ts                    # atomsToSvg(atoms) 入口
      ├── blocks/                     # Block 类型分发
      │   ├── textBlock.ts
      │   ├── mathInline.ts
      │   ├── mathBlock.ts
      │   ├── heading.ts              # 待实现
      │   ├── bulletList.ts           # 待实现
      │   ├── orderedList.ts          # 待实现
      │   └── ...
      ├── text-to-path.ts             # opentype.js outline 化
      ├── mathjax-svg.ts              # MathJax 适配
      ├── font-loader.ts              # 字体加载与缓存
      └── fonts/                      # 字体资源（OFL 协议）

src/plugins/graph/rendering/          # GraphView 渲染层（替代 PoC 沙盒）
  ├── NodeRenderer.ts                 # 形状/内容组合器
  ├── EdgeRenderer.ts                 # 边渲染
  ├── shapes/
  │   ├── CircleShape.ts              # 图谱默认（v1.3 范围）
  │   ├── RoundRectShape.ts           # 思维导图（独立 spec 定义时实现）
  │   └── ...
  ├── contents/
  │   └── SvgGeometryContent.ts
  ├── interfaces.ts                   # ShapeRenderer / ContentRenderer 接口
  └── cache/
      ├── SvgCache.ts                 # SVG 字符串缓存
      └── GeometryCache.ts            # ShapeGeometry 缓存

src/plugins/graph/engines/            # 已存在的引擎层（不动）
  ├── GraphEngine.ts                  # 抽象基类
  ├── KnowledgeEngine.ts              # 默认变种
  └── ...
```

### 2.3 数据流（运行时）

```
[创建节点]
  GraphEngine.createNode(node)
    ↓
  NodeRenderer.createNode(node)
    ├── ShapeRenderer.createMesh(node) → 圆/矩形/...
    └── ContentRenderer.render(node.atoms)
          ├── 查 SvgCache(hash(atoms))
          │   命中 → 返回 SVG 字符串
          │   未命中 → atomsToSvg(atoms) → 缓存 + 返回
          ├── SVGLoader.parse(svgString)
          ├── 查 GeometryCache(hash(svgString))
          │   命中 → 复用 ShapeGeometry
          │   未命中 → createShapes + ShapeGeometry → 缓存 + 返回
          └── new THREE.Mesh × N，包成 Group
    ↓
  THREE.Group { ShapeMesh, ContentObj }
    ↓
  scene.add(group)

[更新节点 label]
  GraphEngine.setNodeLabel(id, atoms)
    ↓
  NodeRenderer.updateContent(group, atoms)
    ├── ContentRenderer.dispose(group.children[1])
    ├── ContentRenderer.render(atoms)
    └── group.children[1] = new contentObj

[删除节点]
  GraphEngine.deleteNode(id)
    ↓
  NodeRenderer.dispose(group)
    ├── ShapeRenderer.dispose(group.children[0])
    └── ContentRenderer.dispose(group.children[1])
```

---

## 3. 接口契约

### 3.1 ShapeRenderer

```ts
interface ShapeRenderer {
  /** 根据节点数据创建形状 mesh */
  createMesh(node: GraphNode): THREE.Object3D;

  /**
   * 根据内容 bbox 调整形状尺寸（可选）
   * - 图谱 CircleShape：no-op（圆固定半径）
   * - 思维导图 RoundRectShape：依据 bbox 调整框宽高
   * - BPMN 各形状：通常 no-op（形状固定尺寸由业务语义决定）
   */
  fitToContent?(mesh: THREE.Object3D, contentBBox: THREE.Box3): void;

  /**
   * 形状的内容锚点：内容 mesh 应放置的相对坐标
   * - 图谱：圆心下方 (0, -radius - padding, 0)
   * - 思维导图：框中心 (0, 0, 0)
   * - BPMN 任务框：中心 (0, 0, 0)
   * - BPMN 事件圆：圆心下方
   */
  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3;

  dispose(mesh: THREE.Object3D): void;
}
```

### 3.2 ContentRenderer

```ts
interface ContentRenderer {
  /** Atom[] 渲染为 Three.js Object3D */
  render(atoms: Atom[]): Promise<THREE.Object3D>;

  /** 渲染结果的边界盒（供 ShapeRenderer.fitToContent 使用） */
  getBBox(rendered: THREE.Object3D): THREE.Box3;

  dispose(rendered: THREE.Object3D): void;
}
```

ContentRenderer 实现：

- **`SvgGeometryContent`**（默认）：走 SVG 序列化器路径
- **`CssDomContent`**（保留扩展位）：走 CSS2DRenderer 路径，仅用于编辑态浮层（见 § 7）

### 3.3 NodeRenderer

```ts
class NodeRenderer {
  constructor(
    private shape: ShapeRenderer,
    private content: ContentRenderer,
  ) {}

  async createNode(node: GraphNode): Promise<THREE.Group>;
  async updateContent(group: THREE.Group, atoms: Atom[]): Promise<void>;
  setHighlight(group: THREE.Group, mode: 'default' | 'hover' | 'selected'): void;
  dispose(group: THREE.Group): void;
}
```

### 3.4 EdgeRenderer

```ts
interface EdgeRendererOptions {
  source: THREE.Vector3;
  target: THREE.Vector3;
  curveOffset?: number;       // 多重图弧线偏移
  arrow?: boolean;            // 箭头
  label?: Atom[];             // 边 label
}

class EdgeRenderer {
  constructor(content: ContentRenderer);

  async createEdge(opts: EdgeRendererOptions): Promise<THREE.Group>;
  async updateLabel(group: THREE.Group, atoms: Atom[]): Promise<void>;
  updateEndpoints(group: THREE.Group, source: THREE.Vector3, target: THREE.Vector3): void;
  setHighlight(group: THREE.Group, mode: 'default' | 'hover' | 'selected'): void;
  dispose(group: THREE.Group): void;
}
```

边由 3 部分组成：
- 主曲线（直线 / 二次贝塞尔）
- 箭头（小三角 mesh，沿曲线终点切线方向）
- label（可选，复用 ContentRenderer，挂在曲线中点）

---

## 4. 序列化器（atom-serializers/svg）

### 4.1 入口契约

```ts
/**
 * 把 Atom[] 渲染为 path-only SVG 字符串
 *
 * 输出 SVG 满足：
 * - 不含 <text> 元素（文字已 outline 化为 path）
 * - 不含 <use> 引用（MathJax fontCache: 'none'）
 * - 不含 <filter> / <linearGradient> / <mask>（SVGLoader 不支持）
 * - 颜色用具体值（不含 currentColor）
 */
export async function atomsToSvg(atoms: Atom[]): Promise<string>;
```

### 4.2 Block 类型覆盖

正式实施期需覆盖以下 Block 类型：

| Block 类型 | 优先级 | 复杂度 | 实现说明 |
|-----------|-------|-------|---------|
| **textBlock** | P0 | 低 | inline 节点（text / mathInline）混排 |
| **heading** | P0 | 低 | 大字号 textBlock |
| **mathInline** | P0 | 中 | MathJax inline mode |
| **mathBlock** | P0 | 中 | MathJax display mode |
| **bulletList** | P1 | 中 | 缩进 + bullet path |
| **orderedList** | P1 | 中 | 缩进 + 数字 |
| **codeBlock** | P2 | 高 | 等宽字体 + 语法高亮（CodeMirror 6 集成期再做） |
| **table** | P2 | 高 | 表格线 + 单元格内嵌 textBlock |
| **image** | P2 | 中 | 图片 → texture map plane（不进 path SVG） |
| **video / audio** | P3 | 高 | 占位预览图（运行时播放走 DOM 浮层） |
| **frameBlock / columnList** | P3 | 高 | 嵌套布局，序列化复杂 |

P0 必须，P1 在 v1.0 实施期完成，P2 / P3 看情况。

### 4.3 inline 节点覆盖

| inline 类型 | 优先级 | 实现 |
|-----------|-------|------|
| text | P0 | text-to-path |
| mathInline | P0 | mathjax-svg |
| mark（bold / italic / underline / code） | P0 | 字重/斜体字体切换 + 下划线 path |
| link | P1 | 颜色变化 + 点击事件由上层 raycaster 处理 |
| inlineImage | P2 | 行内图片占位 |

### 4.4 字体策略

#### 4.4.1 字体资源

| 字体 | 用途 | 协议 | 大小（ttf/otf） |
|------|------|------|----------------|
| Inter Regular / Italic / Bold | 西文 | OFL | 各 ~400KB |
| Noto Sans SC Regular / Bold | 中文 | OFL | 各 ~8MB（subset OTF） |
| (可选) JetBrains Mono | 等宽（codeBlock） | OFL | ~200KB |

字体放在 `src/lib/atom-serializers/svg/fonts/`。

#### 4.4.2 子集化策略

PoC 阶段使用 8MB 全字 Noto SC（首次加载 105ms）。正式实施按以下顺序优化：

**Phase 1（必做，v1.0 范围）**：
- 用 `pyftsubset` 对 Noto Sans SC 做 GB 2312 一级（3500 字）+ 标点符号子集
- 目标大小：< 400KB
- 工作量：1-2 天
- 风险：遇到子集外字符回退（跳过或显示豆腐块）

**Phase 2（可选，v1.1 范围）**：
- 增加 GB 2312 全集（7000 字）+ 常用繁体字
- 目标大小：< 800KB

**Phase 3（v2.0 范围）**：
- 完整 unicode-range 路由器（参考 fontsource 多分包结构）
- 按需加载，首屏只加载用到的分包
- 目标：首屏字体 < 100KB，全字按需加载

#### 4.4.3 加载时序

- **App 启动时**：不加载字体（懒加载）
- **GraphView 首次创建节点时**：触发 `loadFont('inter')` + `loadFont('notoSansSc')`
- **后续节点**：命中缓存，0 加载延迟
- **字体未加载完成时的渲染**：阻塞等待（PoC 实测 < 200ms 可接受）

### 4.5 公式：MathJax v3

#### 4.5.1 配置

```ts
const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: 'none' });
const html = mathjax.document('', { InputJax: tex, OutputJax: svg });
```

`fontCache: 'none'` 关键：每次输出完整 path，避免 `<use>` 引用全局 defs（SVGLoader 不解析 use 引用）。

#### 4.5.2 嵌入策略

MathJax 输出独立 `<svg>` 文档，需提取并平移：

```
<svg viewBox="..." width="..ex" height="..ex" style="vertical-align:..ex">
  <g stroke="currentColor" fill="currentColor">
    <g><path d="..." /></g>
    ...
  </g>
</svg>
```

处理步骤：
1. 提取 viewBox 数值
2. 提取 width / height（ex 单位转 px：1ex ≈ 0.5 × fontSize）
3. 解析 vertical-align 得到基线偏移
4. 替换 `currentColor` → 具体色值（避免 SVGLoader 警告）
5. 包成 `<g transform="translate(..) scale(..)">内层 g</g>` 嵌入到外层 SVG

#### 4.5.3 Worker 兼容性（v2.0 范围）

PoC 用 `browserAdaptor` 在主线程运行。Worker 中需切换 `liteAdaptor`，需实测兼容性。详见 § 6.3。

### 4.6 颜色方案

序列化器输出 SVG 中的颜色由调用方（GraphView 或视图变种）决定，序列化器内部使用以下默认值并支持外部覆盖：

| 元素 | 默认色 | 用途 |
|------|-------|------|
| 文字 / 公式 | `#dddddd` | 深色背景上的浅灰 |
| inline code 背景 | `#333333` | 略亮于背景 |
| link 文字 | `#88aaff` | 蓝紫强调 |
| 强调（bold / mark）| `#ffffff` | 高对比 |

未来支持主题切换时，所有颜色改为从主题对象读取。

---

## 5. 缓存与增量更新

### 5.1 三级缓存

```
┌──────────────────────┐
│  Atom[] (input)       │
│  hash(JSON.stringify)│
└──────────────────────┘
         ↓
┌──────────────────────┐  L1: SvgCache
│  SVG string           │  Map<atomsHash, string>
│  hash(string)         │  LRU 1000 条
└──────────────────────┘
         ↓
┌──────────────────────┐  L2: GeometryCache
│  ShapeGeometry[]      │  Map<svgHash, geometry[]>
│                       │  LRU 500 条
└──────────────────────┘
         ↓
┌──────────────────────┐  L3: 不缓存
│  THREE.Mesh × N       │  每节点独立实例（共享 geometry，不共享 material）
└──────────────────────┘
```

- **L1（SvgCache）**：`atomsToSvg` 入口处缓存。命中率高（同一图里很多节点 label 相同/相似）
- **L2（GeometryCache）**：SVGLoader.createShapes + ShapeGeometry 结果缓存。命中率中等
- **L3 不缓存**：Mesh 必须独立（每个节点的 transform 不同），但 geometry 复用即可

### 5.2 缓存淘汰

- LRU + 容量上限
- 节点删除时不主动清缓存（依赖 LRU 自然淘汰）
- 图切换时（`activeGraphId` 变化）清空 L1，保留 L2

### 5.3 增量更新

节点 label 变更（`setNodeLabel(id, atoms)`）时：

```ts
async updateContent(group: THREE.Group, atoms: Atom[]): Promise<void> {
  const oldContent = group.children[1];
  const newContent = await this.content.render(atoms);  // 内部走缓存
  group.remove(oldContent);
  this.content.dispose(oldContent);
  group.add(newContent);
  // shape 不变，无需重建
}
```

不重建整个 group，只替换内容部分。

### 5.4 性能基线

PoC 实测（无缓存）：

| 节点数 | setup | avg/节点 |
|--------|-------|---------|
| 6 | 153ms | 25.5ms |
| 200 | 328ms | 1.6ms |

加缓存后预期：

| 场景 | 预期 |
|------|------|
| 100 节点全部 label 不同 | < 200ms |
| 100 节点 50% label 重复（典型概念图谱） | < 100ms |
| 单节点 label 更新（缓存命中） | < 5ms |
| 缩放/平移 | 持续 60+ fps（200 节点测试中实测 120fps） |

---

## 6. Web Worker 异步管线（v2.0 范围）

### 6.1 动机

主线程渲染在节点数 < 500 时无压力（PoC 已证）。但以下场景会触发主线程阻塞：

- 节点数 > 1000
- 单节点 atoms 极复杂（多页公式、巨大表格）
- 图切换时一次性创建数百节点

### 6.2 Worker 边界

**Worker 内执行**：
- `atomsToSvg(atoms)`（含 MathJax + 字体 outline 化）
- `SVGLoader.parse(svgString)` → 序列化的 path 数据

**主线程执行**：
- `ShapeGeometry` 创建（受限于 SharedArrayBuffer，几何对象不能跨 Worker 共享）
- `THREE.Mesh` / `THREE.Material` 创建
- 场景管理 + 渲染循环

### 6.3 MathJax Worker 兼容

PoC 用 `browserAdaptor`（依赖 DOM）。Worker 中无 DOM，需切换 `liteAdaptor`：

```ts
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor';
```

需实测：
- liteAdaptor 输出格式与 browserAdaptor 是否一致
- 性能差异
- 是否需要单独 bundle Worker（避免主线程 mathjax-full 重复加载）

### 6.4 实施估算

5-7 天。其中字体 outline 化的 Worker 化最复杂（opentype.js 需要在 Worker 中加载）。

---

## 7. 编辑模式切换

### 7.1 设计原则

显示态（SVG 几何）与编辑态（DOM PM）是**两种独立渲染模式**，通过显式切换：

```
[默认显示态]
  节点 = SVG 几何 mesh，参与 3D 场景

[双击节点 / 触发编辑]
  ↓
  1. 几何 mesh.visible = false
  2. 创建 DOM PM 编辑器（CSS2DRenderer 浮层）
  3. 浮层位置 = 节点屏幕坐标
  4. PM 内容初始化为节点 atoms

[用户编辑]
  ↓
  PM 完整功能：mark / 公式 / slash menu / 4 个 React UI

[blur / Esc / Cmd+Enter 提交]
  ↓
  1. 提取 PM 当前 atoms
  2. NodeRenderer.updateContent(group, atoms)
  3. 销毁 DOM PM 编辑器
  4. 几何 mesh.visible = true
```

### 7.2 CssDomContent 的角色

`CssDomContent` 是 `ContentRenderer` 接口的另一个实现，专门服务编辑态：

```ts
class CssDomContent implements ContentRenderer {
  async render(atoms: Atom[]): Promise<THREE.Object3D> {
    // 创建 PM EditorView → 包成 CSS2DObject
  }
  // ... bbox / dispose
}
```

显示态用 `SvgGeometryContent`，编辑态临时切换到 `CssDomContent`。完成后切回。

### 7.3 编辑器的功能要求

继承之前 `feature/graph-labels` 分支已实现的 ProseMirror 编辑器（NodeEditorPopup React 组件 + 4 个 UI 弹窗 + slash menu），但**改为浮层模式**：

- 位置：`position: fixed`，覆盖在节点屏幕坐标处
- 尺寸：根据内容自适应，但有上限（避免遮挡过多）
- 关闭：blur / Esc / Cmd+Enter 三种途径

### 7.4 编辑模式的"几何与 DOM 一致性"

编辑态和显示态可能有微小视觉差异（DOM PM 的 KaTeX strut vs SVG 几何无 strut）。**这是接受的折中**：

- 编辑态用户在编辑，对临时变形不敏感
- 提交后立即重新走 SVG 几何路线，最终态准确

不追求"编辑态和显示态像素级一致"。

### 7.5 实施估算

3-4 天。其中 CssDomContent 编辑器的 PM schema、plugin、4 个 UI、slash menu 等大部分代码可从 `feature/graph-labels` 分支复用。

---

## 8. 节点形状抽象与视图变种

### 8.1 形状库

正式实施期 v1.0 范围只实现 `CircleShape`（图谱默认）。其他形状作为后续视图变种独立 spec 时实现。

形状预留接口和命名空间：

| 形状 | 视图变种 | 实施时机 |
|------|---------|---------|
| **CircleShape** | 图谱（KnowledgeEngine） | v1.0 |
| **RoundRectShape** | 思维导图（MindMapEngine） | 独立 spec / 独立分支 |
| **DiamondShape** | BPMN 网关 | BPMN spec |
| **TaskShape** | BPMN 任务（圆角矩形） | BPMN spec |
| **EventShape** | BPMN 事件（圆 + 内圈） | BPMN spec |
| **HexagonShape** | 时间线 / Cynefin 框架 | TBD |

### 8.2 内容定位策略

`getContentAnchor` 返回的相对坐标决定内容如何摆放：

| 形状 | 锚点策略 | 内容布局 |
|------|---------|---------|
| Circle | `(0, -radius - 4, 0.1)` | 圆下方（图谱风格） |
| RoundRect | `(0, 0, 0.1)` | 框中心，框尺寸由 fitToContent 撑大 |
| Diamond | `(0, 0, 0.1)` | 菱形中心，文字短即可 |
| Task | `(0, 0, 0.1)` | 任务框中心 |
| Event | `(0, -radius - 4, 0.1)` | 事件圆下方 |

### 8.3 Z 轴层级

为避免 z-fighting，约定层级：

| 元素 | z |
|------|---|
| 边曲线 | -1 |
| 边箭头 | -0.5 |
| 边 label | 0.5 |
| 节点 shape mesh | 0 |
| 节点 content | 0.1 |
| hover ring | 0.2 |
| 选中 outline | 0.3 |
| 编辑态 DOM 浮层 | (CSS2DRenderer 全局浮层) |

---

## 9. 边渲染

### 9.1 主曲线

- **直线**：`THREE.Line` + `BufferGeometry`，单一线段
- **二次贝塞尔**（多重图）：参数化曲线 → 分段 BufferGeometry（采样 32-64 点）

### 9.2 箭头

- 终点位置 + 切线方向
- 小三角 mesh（ShapeGeometry from path）
- 旋转对齐切线

### 9.3 多重图弧线

继承 v1.1 spec 的决议：两点之间 N 条边时按弧形偏移。

```
curveOffsetFactor = (i - (N-1)/2) * spacing
```

i 为该边在同端边集合中的索引，spacing 为偏移基础距离。

### 9.4 边 label

复用 `ContentRenderer`：边 label 也是 Atom[]，序列化为 SVG 几何，挂在曲线中点。与节点 label 完全一致的序列化路径。

### 9.5 实施估算

3-4 天。

---

## 10. 性能基线与监控

### 10.1 性能预算

| 指标 | 目标 | 阈值（红线） |
|------|------|------------|
| 单节点首次创建（冷缓存） | < 30ms | 100ms |
| 单节点首次创建（热缓存） | < 5ms | 30ms |
| 单节点 label 更新 | < 10ms | 50ms |
| 100 节点初始加载 | < 500ms | 2000ms |
| 1000 节点初始加载 | < 5s | 15s |
| 渲染 fps（任意操作下） | 60 | 30 |
| 字体首次加载 | < 200ms | 1000ms |
| MathJax 初始化 | < 50ms | 500ms |

### 10.2 性能监控

GraphEngine 内置 perfStats：

```ts
interface PerfStats {
  lastNodeMs: number;
  totalNodes: number;
  totalSetupMs: number;
  fps: number;
  cacheHitRate: { svg: number; geometry: number };
  fontLoadMs: { inter: number; notoSansSc: number };
  mathjaxInitMs: number;
}
```

dev 模式下 GraphView toolbar 可展开 perf 面板。生产模式仅在内部诊断 IPC 暴露。

### 10.3 退化策略

性能不达标时的退化策略：

| 触发条件 | 退化动作 |
|---------|---------|
| 节点数 > 5000 | 启用 LOD（远距离节点不渲染 content，只显示 shape） |
| fps < 30（持续 1s） | 暂停 raycaster hover；仅在 mouseup 时检测 |
| 字体加载 > 5s（超时） | 回退到方案 D1（SVG → canvas → texture） |
| 单帧渲染 > 100ms | 切换到主线程低优先级渲染队列（requestIdleCallback） |

---

## 11. 实施清单（v1.0 范围）

按优先级 + 依赖关系排序：

### Phase 1：基础渲染（P0，2 周）

1. 形状/内容分离接口落地（`src/plugins/graph/rendering/`）
2. CircleShape + SvgGeometryContent + NodeRenderer
3. 序列化器 P0 Block 类型：textBlock + heading + mathInline + mathBlock
4. 字体加载 + 子集化 Phase 1（GB 2312 一级）
5. 集成到 GraphEngine（替换 CSS2DRenderer 路径）
6. raycaster hover + 节点选中

**验收**：原 v1.2 GraphView 的所有节点显示场景在新路径下功能等价。

### Phase 2：完善内容覆盖（P1，1 周）

7. 序列化器 P1 Block 类型：bulletList + orderedList + mark
8. 边渲染（直线 + 多重图弧线 + 箭头 + 边 label）
9. 三级缓存（SvgCache + GeometryCache）

**验收**：可以可视化任何 Note 的全部 P0+P1 内容作为图节点 label。

### Phase 3：编辑模式（P0，1 周）

10. CssDomContent ContentRenderer
11. 编辑态浮层（NodeEditorPopup + 4 React UI + slash menu）
12. 编辑提交 → 重新走 SVG 几何

**验收**：双击节点 → PM 编辑 → 提交 → 显示态准确刷新。

### Phase 4：性能与稳定性（1 周）

13. 性能监控仪表板（dev 模式）
14. 退化策略实施
15. 跨平台字体渲染验证
16. 生产构建字体资源加载验证

**验收**：所有性能预算指标达标。

### 后续（v1.1+，独立 spec）

17. P2 Block 类型：codeBlock（CodeMirror 6 集成）/ table / image
18. Worker 异步管线
19. 字体子集化 Phase 2 / 3
20. 思维导图 / BPMN 视图变种

---

## 12. 与现有规范的关系

| 规范 | 关系 |
|------|------|
| `KRIG-Three-Layer-Architecture.md` | 顶层原则不变；本规范是可视化层 GraphView 的渲染管线决议 |
| `Graph-3D-Rendering-PoC-Spec.md` | PoC 阶段规范，已完成历史使命，作为锚点保留 |
| `Graph-3D-Rendering-PoC-Report.md` | PoC 评审结论，是本规范的输入证据 |
| `KRIG_GraphView_Spec_v1.2.md` | 数据模型（label: Atom[]）继承；渲染路线被本规范取代 |
| `KRIG_GraphView_Spec_v1.3.md` | 在数据模型 / 持久化 / 交互层面继承 v1.2，渲染层面采用本规范 |

---

## 13. 决策日志

| 日期 | 决议 | 备注 |
|------|------|------|
| 2026-04-25 | 锁定路线 2（SVG 几何 → Three.js 场景） | 替代 CSS2DRenderer DOM 浮层 |
| 2026-04-25 | 序列化器物理位置 `src/lib/atom-serializers/svg/` | 跨视图共享层 |
| 2026-04-25 | 字体方案：F1（opentype.js + getPath） | PoC 一次跑通 |
| 2026-04-25 | 公式方案：MathJax v3 fontCache:'none'（替代 KaTeX） | 直接输出 path SVG |
| 2026-04-25 | 形状/内容分离架构（Shape / Content / NodeRenderer） | 为思维导图/BPMN 留扩展 |
| 2026-04-25 | 三级缓存（Svg / Geometry / 不缓存 Mesh） | LRU + 命中率监控 |
| 2026-04-25 | 编辑模式：显示态 SVG / 编辑态 DOM 切换 | 不追求像素级一致 |
| 2026-04-25 | 边渲染：直线 + 二次贝塞尔 + 箭头 | 继承 v1.1 多重图决议 |
| 2026-04-25 | Worker 异步管线推迟到 v2.0 | 主线程 200 节点 120fps，无紧迫性 |
| 2026-04-25 | 字体子集化 Phase 1（GB 2312 一级 < 400KB）作 v1.0 范围 | pyftsubset 构建期生成 |

---

## 附录 A：术语表

继承 PoC spec 附录 A，新增：

| 术语 | 定义 |
|------|------|
| L1 SvgCache | atomsToSvg 输出的 SVG 字符串 LRU 缓存 |
| L2 GeometryCache | ShapeGeometry 实例 LRU 缓存（按 SVG hash 索引） |
| LOD（Level of Detail） | 视距过远时降级渲染（只画 shape，不画 content） |
| 退化策略 | 性能不达标时主动牺牲质量保证流畅度 |
| Phase 1/2/3（实施阶段） | v1.0 实施期内的逐步 rollout 阶段 |

---

## 附录 B：开放问题

正式实施期需回答的问题：

1. **字体子集化的 build pipeline**：用 pyftsubset 还是 npm 包？是否进 CI？
2. **生产构建字体路径**：Vite 的 `?url` 在 Electron 打包后是否仍工作？
3. **跨平台一致性**：Windows / Linux 的字体渲染差异是否需要回退方案？
4. **MathJax 的 Worker liteAdaptor 验证**：v2.0 之前先做技术储备验证
5. **多语言**（日文 / 韩文 / 阿拉伯语）：是否需要支持？目前 spec 仅覆盖中英文
6. **主题切换**：浅色 / 深色 / 自定义主题如何与序列化器颜色方案配合
7. **打印 / 导出**：用户能否把图谱导出为 SVG 文件（直接复用序列化器输出）？

---

**Spec 完。建议进入 Phase 1 实施。**
