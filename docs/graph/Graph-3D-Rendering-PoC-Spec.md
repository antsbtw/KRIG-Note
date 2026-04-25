# KRIG 技术规范 · Graph 3D Rendering PoC

> PoC Spec · 2026-04-25
>
> 本规范定义 GraphView 渲染管线从 "CSS2DRenderer DOM 浮层" 向 "SVG 几何 → Three.js 场景" 重构的可行性验证（Proof of Concept）阶段。
>
> **PoC 不是实施 spec**：它的产出物是一个回答 "这条路是否可走" 的实验，配套**形状/内容分离架构骨架**。PoC 通过后再写正式 `Graph-3D-Rendering-Spec.md`。
>
> 关联文档：
> - 顶层架构：`docs/KRIG-Three-Layer-Architecture.md`
> - GraphView 现状：`docs/graph/KRIG_GraphView_Spec_v1.2.md`

---

## 0. 文档定位

本 spec 处于 **三层架构 · 可视化层** 的内部技术决策层级。它回答 "Graph 这个视图变种，把语义层 Atom[] 在屏幕上呈现出来 / 让用户编辑回去" 的具体技术管线选择。

它**不**改动语义层（Atom 形态），**不**改动其他视图（Note 仍是 DOM PM）。

---

## 1. 背景：为何走"3D 几何"路线

### 1.1 现状（CSS2DRenderer DOM 浮层）

当前 GraphView 节点 label 的渲染管线：

```
Atom[] → ProseMirror readonly 渲染（DOM）
       → CSS2DObject 包裹
       → CSS2DRenderer 计算屏幕坐标
       → DOM 浮层叠加在 WebGLRenderer canvas 之上
```

**实质**：节点圆是 Three.js 几何，节点 label 是 DOM 浮层。两者共享屏幕位置但不共享渲染管线。

### 1.2 当前路线的边界

| 维度 | 现状 |
|------|------|
| 文字/富内容渲染 | ✅ 浏览器原生（DOM PM、KaTeX、字体） |
| 与 3D 物体的深度排序 | ❌ DOM 永远在 WebGL canvas 之上 |
| 节点真正进入 3D 场景 | ❌ label 不参与场景变换 |
| KaTeX strut 撑高节点 | ❌ DOM 盒模型规则全部生效，无法消除 |
| 编辑能力 | ✅ DOM PM 直接可用 |

### 1.3 路线 2：SVG 几何路线

```
Atom[] → Block-SVG 序列化器
       → path-only SVG（文字 outline 化）
       → THREE.SVGLoader 解析为 Shape
       → ShapeGeometry → Mesh
       → 进入 Three.js 场景，作为节点 mesh 的 child
```

**实质**：节点 label 真正成为 3D 场景中的几何对象，参与缩放/旋转/深度，与节点形状空间一致。

### 1.4 选择路线 2 的依据

- 解决 KaTeX strut 撑高（几何不再受 DOM 盒模型约束）
- 解锁真正的 3D 图谱表达（label 可以随节点旋转、参与场景变换）
- 与三层架构 "可视化层自决其渲染" 原则一致：Graph 视图选择最适合"图"的渲染管线，不被 Note 的 DOM 选择绑架

### 1.5 路线 2 的代价（已知）

- 工程量大：全量实施 34-50 天
- 文字渲染从浏览器子像素抗锯齿转为几何三角形化，小尺寸/中文需实测
- SVGLoader 不解析 `<text>`，文字必须预先 outline 化为 path
- 交互（hover/拖动/编辑切换）需基于 raycaster 重写
- 性能要求：100 节点初始加载、运行时增量更新需缓存 + 异步管线

**正因为代价大，必须先做 PoC 验证可行性**。

---

## 2. PoC 的目的与非目的

### 2.1 PoC 必须回答的问题

| Q | 问题 | 验收标准 |
|---|------|---------|
| Q1 | SVGLoader 路线在 Three.js 里画文字 + 公式的清晰度是否过关 | 1080p 屏幕下，节点默认尺寸（radius ≈ 24）的公式肉眼可读；中文文字不糊 |
| Q2 | 节点形状与内容渲染解耦的架构能否成立 | 形状（ShapeRenderer）与内容（ContentRenderer）作为两个独立模块各自迭代，互不依赖 |
| Q3 | 内容尺寸如何反向影响形状/布局 | 至少有一个明确的"内容 bbox 反馈给形状"接口被定义并跑通（即使图谱变种本身不用） |
| Q4 | 端到端性能 | 单节点 Atom[] → SVG → 几何 → Three.js 场景 < 100ms |

### 2.2 PoC 不做的事

- ❌ 完整 Block-SVG 序列化器（只支持 textBlock + mathInline 子集）
- ❌ 编辑态（PoC 只验证显示）
- ❌ 拖动适配 / hover / 双击编辑
- ❌ 增量更新 / 缓存 / Web Worker 异步管线
- ❌ 思维导图 / BPMN 等其他视图变种
- ❌ 性能优化（只验证可行性，不优化）

---

## 3. PoC 范围

### 3.1 内容覆盖

最小数据集：**一个 textBlock + 一个 mathInline 公式**

```ts
// PoC 节点 label 示例
const sampleLabel: Atom[] = [
  {
    type: 'textBlock',
    content: [
      { type: 'text', text: 'Energy = ' },
      { type: 'mathInline', attrs: { tex: 'E = mc^2' } }
    ]
  }
];
```

### 3.2 渲染管线（PoC 实现链路）

```
Atom[] (sampleLabel)
  ↓ minimal-block-svg-serializer.ts（PoC 子集）
SVG 字符串（含 <text> 元素 + KaTeX SVG 输出）
  ↓ text-to-path 后处理（opentype.js + 字体子集）
path-only SVG 字符串
  ↓ THREE.SVGLoader.parse()
SVGResult（paths[]）
  ↓ Shape → ShapeGeometry → Mesh（每个 path 一个 Mesh）
THREE.Group（包含所有 Mesh）
  ↓ 作为节点 mesh 的 child
进入场景，与节点圆共同渲染
```

### 3.3 节点形状

PoC 仅实现一种形状：**圆**（继承当前图谱视觉）。

形状-内容关系：圆固定半径，SVG 内容作为 child 挂在圆下方。

> 思维导图/BPMN 形态的"形状包围内容"在 PoC 不实现，但**架构必须支持**。见 § 4.2。

### 3.4 字体处理（多路径回退）

字体 outline 化是 SVGLoader 路线的最大风险点。PoC 采取**多路径试探**而非"一次定生死"：

| 路径 | 描述 | 优先级 | 复杂度 |
|------|------|-------|-------|
| **F1** | opentype.js + 字体子集 → 文字 outline 化 → path-only SVG | 首选 | 高 |
| **F2** | KaTeX SVG 字体内嵌 outline（KaTeX 自带 SVG 字体）+ 通用文字走 F1 | 备选 | 中 |
| **F3** | 文字部分降级为方案 D1（SVG → canvas → 纹理 → Plane Mesh），其他几何走 SVGLoader | 兜底 | 低 |
| **F4** | 文字部分用 SDF（troika-three-text）+ 公式走 F1/F2 | 兜底备选 | 中 |

**PoC 字体方案的成功定义**：能跑通其中**任意一种**即可继续 PoC。F1 不通则尝试 F2/F3/F4，**不立即终止 PoC**。

时间预算：字体方案探索整体不超过 **3 天**。3 天后若所有路径都失败，再触发"PoC 终止"流程。

- 西文：F1 路径用 Inter / Roboto 字体子集
- 中文：F1 路径用常用 1000 字子集；F1 在中文上不通（性能或字号清晰度），降级到 F3 文字纹理方案
- KaTeX：优先 F2（KaTeX 输出已是 SVG，字体可 inline）

---

## 4. 架构骨架（PoC 必须建立）

PoC 实现少，但**架构骨架不能省**。这是 Q2 的验收前提。

### 4.1 三层渲染抽象

```
┌─────────────────────────────────────────┐
│          GraphNode (data layer)          │
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
│ ...          │ │                 │
└──────────────┘ └─────────────────┘
```

PoC 阶段只实现 `CircleShape` + `SvgGeometryContent`，但接口必须定义完整以容纳未来扩展。

### 4.2 接口定义（PoC 必须）

#### ShapeRenderer

```ts
interface ShapeRenderer {
  /** 根据节点数据创建形状 mesh */
  createMesh(node: GraphNode): THREE.Object3D;

  /** 根据内容 bbox 调整形状（可选；图谱变种 = no-op，思维导图变种 = 依据 bbox 调框尺寸） */
  fitToContent?(mesh: THREE.Object3D, contentBBox: THREE.Box3): void;

  /** 形状几何中心相对于节点位置的偏移 */
  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3;

  dispose(mesh: THREE.Object3D): void;
}

class CircleShape implements ShapeRenderer { /* PoC 实现 */ }
class RoundRectShape implements ShapeRenderer { /* PoC 不做，但接口预留 */ }
```

#### ContentRenderer

```ts
interface ContentRenderer {
  /** Atom[] 渲染为 Three.js Object3D */
  render(atoms: Atom[]): Promise<THREE.Object3D>;

  /** 渲染结果的边界盒（供 ShapeRenderer.fitToContent 使用） */
  getBBox(rendered: THREE.Object3D): THREE.Box3;

  dispose(rendered: THREE.Object3D): void;
}

class SvgGeometryContent implements ContentRenderer { /* PoC 实现 */ }
class CssDomContent implements ContentRenderer { /* PoC 不做，但接口预留：兼容当前 CSS2DRenderer 路线作为退路 */ }
```

#### NodeRenderer

```ts
class NodeRenderer {
  constructor(
    private shape: ShapeRenderer,
    private content: ContentRenderer,
  ) {}

  async createNode(node: GraphNode): Promise<THREE.Group> {
    const group = new THREE.Group();
    const shapeMesh = this.shape.createMesh(node);
    const contentObj = await this.content.render(node.atoms);

    // content bbox 反馈给 shape（思维导图等变种用得上）
    const bbox = this.content.getBBox(contentObj);
    this.shape.fitToContent?.(shapeMesh, bbox);

    // 内容定位到 shape 的内容锚点
    const anchor = this.shape.getContentAnchor(shapeMesh);
    contentObj.position.copy(anchor);

    group.add(shapeMesh, contentObj);
    return group;
  }
}
```

### 4.3 SVG 序列化器（PoC 子集）

PoC 仅支持：
- `textBlock` → SVG `<text>`（ Inter/Roboto 字体）
- `mathInline` → KaTeX SVG 输出
- 文字 outline 化（opentype.js）

**位置：从一开始就独立模块**，不放进 note 模块。理由：

- 序列化器是"任何视图都能消费 Atom"的工具，从架构原则看就属于跨模块共享层
- 严格遵守 "experiment/graph-3d-poc 分支只改本模块"，不能越界改 note 模块
- 一开始就独立，未来不需要 refactor 迁移

```
src/lib/atom-serializers/svg/         # 独立模块（跨视图共享）
  ├── index.ts                        # 入口 atomsToSvg(atoms): string
  ├── blocks/
  │   ├── textBlock.ts                # PoC 实现
  │   └── mathInline.ts               # PoC 实现
  ├── text-to-path.ts                 # opentype.js outline 化（F1 路径）
  ├── text-to-texture.ts              # SVG 纹理化（F3 兜底，PoC 视情况实现）
  └── katex-svg.ts                    # KaTeX 公式 → SVG（F2 路径）
```

> `src/lib/atom-serializers/` 的命名预留未来扩展空间：除了 `svg/` 子目录，未来可能有 `markdown/`、`html/`、`pdf/` 等其他序列化目标。PoC 阶段只创建 `svg/` 子目录。

---

## 5. PoC 的物理位置

### 5.1 分支

`experiment/graph-3d-poc`，从 `main` 起。

> 不是 feature/* 因为它是实验性质，可能被丢弃。借用 `experiment/web-content-extractor` 的命名约定。

### 5.2 文件位置

```
src/plugins/graph/poc/                    # PoC 专用，正式实施时删除/迁移
  ├── PocPanel.tsx                        # PoC 主面板（在现有 GraphView 内挂载）
  ├── PocScene.ts                         # 最小 Three.js 场景
  ├── shapes/
  │   └── CircleShape.ts                  # PoC 实现
  ├── contents/
  │   └── SvgGeometryContent.ts           # PoC 实现
  └── NodeRenderer.ts                     # 形状/内容组合器

src/lib/atom-serializers/svg/             # 序列化器 PoC 子集（位置见 § 4.3）
  └── ...
```

**主 GraphView 数据/渲染代码完全不动**。PoC 是独立沙盒，仅在 GraphView 入口处加一个轻量"PoC 模式"分支。

### 5.3 启动方式：URL 参数路由（不动主进程）

通过现有 GraphView 的 URL query 参数 `?poc=1` 切换到 PoC 模式：

```tsx
// src/plugins/graph/renderer.tsx（仅加 4-6 行 mode 判断，不改其他逻辑）
const isPocMode = new URLSearchParams(window.location.search).get('poc') === '1';

return isPocMode
  ? <PocPanel />
  : <GraphView />;  // 原有渲染入口
```

**触发方式**：
- 开发期：手动改 URL 或在调试栏加按钮（仅 dev 模式可见）
- 不需要新建 BrowserWindow、不需要改 main 进程、不需要新 IPC channel

**和主进程的关系**：完全无关。PoC 复用现有 graph WebContentsView 的承载，仅改 renderer 层的入口分支。

> 这是 spec 的一个明确约束：PoC 不允许任何 main 进程改动。如果 PoC 实现过程发现确实需要 main 改动（如新增 IPC handler），先停下来评估是否能用现有 IPC 顶替，或调整 PoC 范围。

---

## 6. PoC 验收标准

### 6.1 功能验收

| 项 | 通过条件 |
|----|---------|
| 节点显示 | 5 个节点，每个 label 含 textBlock + mathInline 公式，全部正确渲染 |
| 节点圆 | 每个节点的圆与 SVG 内容空间一致，缩放场景时同步变换 |
| 文字清晰度 | 1080p 屏幕，1:1 缩放下，西文字号 ≈ 12px、中文 ≈ 14px 肉眼可读 |
| 公式渲染 | KaTeX 公式无 strut 撑高问题，几何形状正确 |
| 形状-内容分离 | 代码层面 ShapeRenderer / ContentRenderer 接口实现完整，能够通过 mock 替换验证 |
| bbox 反馈 | `fitToContent` 接口被调用一次（即使 CircleShape 实现为 no-op，调用链路要打通） |

### 6.2 性能验收

| 指标 | 目标 |
|------|------|
| 单节点端到端（Atom[] → 出现在场景） | < 100ms |
| 5 节点初始加载 | < 500ms |
| 缩放 / 平移流畅度 | 60fps（不掉帧） |

> 5 节点是 PoC 的极小规模。100 节点 / 增量更新 / Worker 异步是正式实施期问题。

### 6.3 架构验收

- 形状/内容分离骨架在 PoC 代码中清晰可见
- 接口定义足以容纳"思维导图"用例（即使不实现，要能写出 RoundRectShape 的伪代码而不需要修改接口）
- 与现有 GraphEngine 主代码完全无耦合（PoC 删除后不影响生产代码）

### 6.4 失败标准（任一触发即终止 PoC）

- 文字清晰度在 F1/F3/F4 **所有路径**下都肉眼不可接受
- 单节点 > 500ms（性能黑洞）
- 字体方案 F1/F2/F3/F4 **全部**在 3 天内无法跑通
- SVGLoader 在某个边缘 case 上崩溃且无替代方案

PoC 失败 = 路线 2 暂时不走，回退讨论替代（路线 1 DOM 浮层、彻底重新评估）。

---

## 7. 时间盒

PoC 严格**6-8 天**：

| 天 | 任务 |
|----|------|
| 1 | F1 字体方案验证（opentype.js + 子集化）；KaTeX SVG 输出验证 |
| 2 | F1 不通则切 F2/F3/F4；任一路径跑通即可继续 |
| 3 | 字体方案最终落定；minimal block-svg-serializer 起步（textBlock + mathInline） |
| 4 | 端到端 Atom[] → 字体路径输出；SVGLoader 集成；ShapeGeometry 生成；单节点入场景 |
| 5 | NodeRenderer + ShapeRenderer / ContentRenderer 接口落地 |
| 6 | 5 节点场景；缩放/平移验证；性能测量 |
| 7 | 中文字体场景；清晰度判定 |
| 8 | 评审材料准备：截图、性能数据、代码示例、架构骨架图 |

**第 1-3 天是字体探索高风险窗口**。3 天结束如 F1/F2/F3/F4 全部失败，触发"失败标准"流程，PoC 终止。

---

## 8. PoC 评审

### 8.1 评审输出

PoC 完成后形成**评审报告**：`docs/graph/Graph-3D-Rendering-PoC-Report.md`，包含：

- 功能/性能/架构验收逐项结果
- 截图对比：当前 CSS2DRenderer 路线 vs PoC 几何路线
- 性能数据
- 暴露的工程风险与未解问题
- 建议：通过 / 调整后通过 / 终止

### 8.2 评审决议

三种结果：

| 结果 | 后续 |
|------|------|
| 通过 | 写正式 `Graph-3D-Rendering-Spec.md`；规划 6-8 周全量实施 |
| 调整后通过 | 调整范围（如降级文字方案）后再写正式 spec |
| 终止 | PoC 分支保留作为历史档案；回退讨论替代路线 |

---

## 9. 与现有规范的关系

| 规范 | 关系 |
|------|------|
| `KRIG-Three-Layer-Architecture.md` | 顶层原则不变；PoC 是可视化层 Graph 视图内部的渲染管线决策 |
| `KRIG_GraphView_Spec_v1.2.md` | v1.2 数据模型（label: Atom[]）继续有效；PoC 不改数据层 |
| `KRIG_GraphView_Spec_v1.3`（计划中） | 待 PoC 通过后撰写，把 3D 渲染管线作为 v1.3 的核心决议 |

---

## 10. 决策日志

| 日期 | 决议 | 备注 |
|------|------|------|
| 2026-04-25 | 锁定路线 2（SVG 几何 → Three.js 场景） | 替代 CSS2DRenderer DOM 浮层路线；解决 KaTeX strut 撑高 |
| 2026-04-25 | 节点形状与内容渲染必须解耦 | 为思维导图/BPMN 等视图变种留架构空间 |
| 2026-04-25 | 视图变种采取插件方式（B 方案） | MindMapView / BpmnView 作为独立 View 插件，复用底层渲染管线，不在 GraphView 内部加 mode |
| 2026-04-25 | PoC 优先（6-8 天） | 在投入 6-8 周全量实施前验证可行性 |
| 2026-04-25 | PoC 仅覆盖 textBlock + mathInline | 最小子集即可回答 Q1-Q4 |
| 2026-04-25 | 字体方案：F1/F2/F3/F4 多路径回退 | 任一路径跑通即可；3 天全失败再终止 PoC |
| 2026-04-25 | 序列化器从一开始就独立位置 `src/lib/atom-serializers/svg/` | 跨视图共享层；PoC 分支不越界改 note 模块 |
| 2026-04-25 | PoC 启动方式：URL 参数 `?poc=1` 路由 | 不动 main 进程；仅 graph renderer 入口加 mode 分支 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| Atom | 语义层数据，对应 ProseMirror node JSON |
| Block-SVG 序列化器 | 把 Atom[] 翻译成 SVG 字符串的工具，与具体视图解耦 |
| ShapeRenderer | 节点形状渲染抽象（圆/矩形/菱形/...） |
| ContentRenderer | 节点内容渲染抽象（SVG 几何 / DOM / SDF 文字 / ...） |
| outline 化 | 把字体文字转换为纯 SVG path（消除 `<text>` 元素，使 SVGLoader 可处理） |
| path-only SVG | 不含 `<text>`、`<filter>`、`<linearGradient>` 等 SVGLoader 不支持元素的 SVG，仅含 path/rect/circle/polygon |
| 视图变种 | 基于同一渲染管线，呈现不同知识结构语义的视图族成员（图谱、思维导图、BPMN、流程图等） |
