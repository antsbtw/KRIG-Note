# KRIG 技术规范 · GraphView v1.3

> Design Spec v1.3 · 2026-04-25
>
> 本版本基于 v1.2（`KRIG_GraphView_Spec_v1.2.md`），把"3D 渲染管线决议"作为 v1.3 的核心变更。
>
> 渲染层细节由独立规范承载：`Graph-3D-Rendering-Spec.md`。
>
> v1.0 / v1.1 / v1.2 保留作为历史锚点。本文件为后续以本版本为准。

---

## 0. v1.3 核心变更摘要

| 维度 | v1.2 | v1.3 |
|------|------|------|
| 节点 / 边 label 显示 | DOM PM readonly 通过 CSS2DRenderer 浮层 | **SVG 几何 mesh 进入 Three.js 场景** |
| 文字渲染 | DOM 字体子像素抗锯齿 | opentype.js outline 化 + ShapeGeometry |
| 公式渲染 | KaTeX → DOM | **MathJax v3 fontCache:'none' → path SVG** |
| KaTeX strut 撑高 | 已知缺陷，无 CSS 解 | **彻底消除（几何不受 DOM 盒模型约束）** |
| 节点形状抽象 | 由 BlockManager 直接挂载 DOM | **ShapeRenderer + ContentRenderer + NodeRenderer 三接口** |
| 视图变种扩展 | 在 GraphEngine 内做 mode 分支 | **形状抽象层支持思维导图 / BPMN 等变种独立扩展** |
| 性能基线 | 未量化 | **单节点 < 30ms / 200 节点 < 500ms / 60+fps** |
| 编辑模式 | DOM PM 即编辑器，与显示同管线 | **显示态 SVG / 编辑态 DOM 切换，不追求像素级一致** |
| 序列化器位置 | （没有独立序列化器） | **`src/lib/atom-serializers/svg/` 跨视图共享层** |

**继承不变**：

- 数据模型（Atom[] label）继承 v1.2 § 4.2 / 4.3
- 持久化结构（SurrealDB schema）继承 v1.2 § 4.4
- 变种切换"克隆为新图"承诺继承 v1.2 § 3.3
- Graph + Note 互补关系继承 v1.2 § 1.2
- 多重图弧线决议继承 v1.1

---

## 1. 概述

### 1.1 命名分层（不变）

继承 v1.2 § 1.1 的命名分层：

```
┌─ L5 GraphView（WebContentsView，每个 Workspace 1 个实例）
│
│   graph.html → src/plugins/graph/renderer.tsx
│
│   └─ 内部持有一个 GraphEngine 实例（可切换变种）
│       │
│       └─ GraphEngine（抽象基类）
│           ├── KnowledgeEngine（默认变种）
│           ├── BPMNEngine
│           ├── MindMapEngine
│           ├── TimelineEngine
│           ├── CanvasEngine
│           └── BasicEngine（验证用最简实现）
```

### 1.2 设计原则（v1.3 修订）

| 原则 | 说明 |
|------|------|
| 父类只做通用事 | 渲染循环、节点/边管理、内容渲染、SurrealDB 读写，全部在 GraphEngine 父类实现 |
| 变种只覆盖差异 | **形状库**（v1.3 形状抽象升级）、布局算法、交互规则，由具体 Engine 子类覆盖 |
| **职责分离（v1.2 强化 / v1.3 延续）** | Three.js 负责空间，**Note 负责内容定义**，SurrealDB 负责持久化。**Graph 不重新实现任何内容能力**；凡涉及文字/富内容的场景，复用 Note 的 Block 类型 |
| **Graph + Note 互补（v1.2 / v1.3 不变）** | Note 是文本/内容的表达手段，Graph 是结构/拓扑的表达手段。两者平等、互补、不互相替代 |
| **跨视图共享序列化器（v1.3 新增）** | Atom → SVG 序列化器是跨视图的纯函数模块，**不属于任何 plugin**，物理放在 `src/lib/atom-serializers/`，未来可服务 Note 导出 PDF / EBook 渲染等其他用途 |
| **形状/内容分离（v1.3 新增）** | 节点视觉 = 形状 × 内容投影。形状（圆/矩形/菱形/...）与内容（文字/公式/...）作为两个独立模块各自迭代 |
| 接口稳定优先 | GraphEngine 接口一旦定稳，变种不需要关心底层实现细节 |
| 可测试性 | BasicEngine 作为最简变种，用于验证父类接口完整性 |

### 1.3 变种继承关系（不变）

继承 v1.2 § 1.3。变种数量与定义不变。本规范仅升级"变种之间的扩展点"——形状抽象层。

---

## 2. 技术栈（v1.3 修订）

| 层次 | 技术 | 职责 |
|------|------|------|
| 空间渲染 | Three.js | 节点形状、边、容器、场景管理 |
| **节点 label / 边 label 渲染（v1.3 修订）** | **THREE.SVGLoader + ShapeGeometry** | **从 Atom[] 序列化的 SVG 转为 3D 几何 mesh** |
| **文字 outline 化（v1.3 新增）** | **opentype.js** | 把字体文字转成 SVG path |
| **公式 SVG 化（v1.3 修订）** | **MathJax v3（替代 KaTeX）** | 直接输出 path-only SVG，免文字 outline 化 |
| 编辑态 DOM 浮层 | CSS2DRenderer | 仅用于编辑态（双击节点时） |
| 布局计算 | Dagre（默认）/ 可插拔 | 自动排列节点坐标 |
| 数据持久化 | SurrealDB | 图结构 + 节点/边 atoms 直接内联存储 |
| 编辑能力 | ProseMirror | 仅在编辑态浮层中使用 |

**移除**：

- ~~CSS2DRenderer 作为节点 label 显示主路径~~（仅保留作编辑态浮层）
- ~~KaTeX 作为公式渲染主路径~~（被 MathJax 替代）

---

## 3. 核心架构

### 3.1 整体结构（v1.3 修订）

```
GraphView (L5 WebContentsView)
    │
    └── GraphEngine
          ├── SceneManager        Three.js 场景、相机、渲染循环
          ├── NodeManager         节点的增删改查、选中状态
          ├── EdgeManager         边的增删改查、路径计算
          ├── RenderingLayer      ★ v1.3 新增 ★
          │     ├── NodeRenderer       形状/内容组合器
          │     ├── EdgeRenderer       边渲染（线 + 箭头 + label）
          │     ├── ShapeLibrary       形状渲染器集合
          │     ├── ContentRenderer    内容渲染器（默认 SvgGeometry）
          │     └── Cache              SvgCache + GeometryCache
          ├── LayoutEngine        布局算法的统一入口（可插拔）
          ├── SurrealAdapter      SurrealDB 读写接口
          ├── InteractionHandler  鼠标、键盘、触摸事件（含 raycaster）
          ├── EditOverlay         ★ v1.3 新增 ★ 编辑态 DOM 浮层管理
          └── LifecycleManager    mount / dispose / resize
```

**v1.2 的 `BlockManager`** 拆解为：
- 显示态 → `RenderingLayer.NodeRenderer + ContentRenderer`
- 编辑态 → `EditOverlay`

### 3.2 GraphEngine 父类与变种边界（v1.3 修订）

```typescript
abstract class GraphEngine {
  // ── 父类实现，变种不需要关心 ──────────────────────
  protected scene:          THREE.Scene;
  protected camera:         THREE.OrthographicCamera;
  protected renderer:       THREE.WebGLRenderer;
  protected css2dEditor:    CSS2DRenderer;          // 仅编辑态使用
  protected nodeManager:    NodeManager;
  protected edgeManager:    EdgeManager;
  protected renderingLayer: RenderingLayer;          // ★ v1.3 新增 ★
  protected editOverlay:    EditOverlay;             // ★ v1.3 新增 ★
  protected layoutEngine:   LayoutEngine;
  protected surreal:        SurrealAdapter;

  mount(container: HTMLElement): void { ... }
  dispose(): void { ... }
  resize(width: number, height: number): void { ... }

  addNode(node: GraphNode): void { ... }
  addEdge(edge: GraphEdge): void { ... }
  removeNode(id: string): void { ... }
  removeEdge(id: string): void { ... }
  selectNode(id: string): void { ... }

  // 编辑态切换（v1.3 新增）
  enterEditMode(nodeId: string): void { ... }
  exitEditMode(commit: boolean): void { ... }

  loadFromSurreal(graphId: string): Promise<void> { ... }
  saveToSurreal(): Promise<void> { ... }

  runLayout(): void { ... }

  // ── 变种必须实现 ───────────────────────────────────
  abstract getShapeLibrary(): ShapeLibrary;          // 形状库（v1.3 接口升级）
  abstract getLayoutAlgorithm(): LayoutAlgo;
  abstract getInteractionRules(): InteractionRules;
}
```

`getShapeLibrary()` 在 v1.3 返回的是 `ShapeRenderer` 实例集合（见 `Graph-3D-Rendering-Spec.md` § 3.1），而不是 v1.2 隐含的"DOM 形状定义"。

### 3.3 变种切换流程（不变）

继承 v1.2 § 3.3。"克隆为新图"承诺不变。

需要补充的变化：变种切换时 `RenderingLayer.NodeRenderer` 重新实例化（持有不同的 ShapeLibrary 实例）。

### 3.4 GraphEngine 变种注册（不变）

继承 v1.2 § 3.4。

---

## 4. 数据模型（不变）

### 4.1 Graph（不变）

继承 v1.2 § 4.1。

### 4.2 GraphNode（不变）

继承 v1.2 § 4.2。`label: Atom[]` 数据模型在 v1.3 中**完全不变**。

> 渲染管线变了，**数据模型没变**。这是 v1.3 的关键收益：v1.2 的所有节点数据无需迁移即可消费 v1.3 的渲染管线。

### 4.3 GraphEdge（不变）

继承 v1.2 § 4.3。

### 4.4 SurrealDB 存储结构（不变）

继承 v1.2 § 4.4。

---

## 5. 渲染管线（v1.3 核心）

### 5.1 数据流

```
GraphNode { atoms: Atom[] }
  ↓ NodeManager.add(node)
RenderingLayer.NodeRenderer.createNode(node)
  ├── ShapeLibrary.get(node.type).createMesh(node)
  └── ContentRenderer.render(node.atoms)
        ├── (cache) atomsToSvg(atoms) → SVG string
        ├── (cache) SVGLoader.parse + ShapeGeometry
        └── THREE.Mesh × N → Group
  ↓
THREE.Group → scene.add()
```

### 5.2 接口契约

完整接口契约见 `Graph-3D-Rendering-Spec.md` § 3：

- `ShapeRenderer`：形状渲染抽象
- `ContentRenderer`：内容渲染抽象
- `NodeRenderer`：组合器
- `EdgeRenderer`：边渲染

### 5.3 序列化器

跨视图共享的 Atom→SVG 序列化器物理位置在 `src/lib/atom-serializers/svg/`，详见 `Graph-3D-Rendering-Spec.md` § 4。

GraphView 通过 `ContentRenderer.render(atoms)` 间接消费序列化器，不直接 import。

### 5.4 缓存

三级缓存（SvgCache + GeometryCache + 不缓存 Mesh）详见 `Graph-3D-Rendering-Spec.md` § 5。

### 5.5 性能基线

| 指标 | v1.3 目标 | PoC 实测 |
|------|----------|---------|
| 单节点首次创建（冷缓存）| < 30ms | 1.6-2.5ms（稳态） |
| 单节点 label 更新 | < 10ms | TBD |
| 100 节点初始加载 | < 500ms | 187ms |
| fps（任意操作下） | 60+ | 120（顶到屏幕刷新率） |

详见 `Graph-3D-Rendering-Spec.md` § 10。

---

## 6. 编辑模式（v1.3 修订）

### 6.1 设计原则

显示态与编辑态是**两种独立渲染模式**，通过显式切换：

```
[默认显示态]
  节点 = SVG 几何 mesh，进入 Three.js 场景

[双击节点 / 触发编辑]
  ↓
  GraphEngine.enterEditMode(nodeId)
  ├── 几何 mesh.visible = false
  ├── EditOverlay 创建 PM EditorView 浮层
  ├── 浮层定位到节点屏幕坐标
  └── PM 内容初始化为节点 atoms

[用户编辑]
  ↓
  PM 完整功能：mark / 公式 / slash menu / 4 React UI 弹窗

[blur / Esc / Cmd+Enter]
  ↓
  GraphEngine.exitEditMode(commit: true)
  ├── 提取 PM 当前 atoms
  ├── NodeRenderer.updateContent(group, atoms)（重新渲染）
  ├── EditOverlay 销毁 PM
  └── 几何 mesh.visible = true
```

### 6.2 EditOverlay 模块

```typescript
class EditOverlay {
  enter(nodeId: string, currentAtoms: Atom[]): void;
  exit(commit: boolean): { committedAtoms: Atom[] | null };
  isActive(): boolean;
  getActiveNodeId(): string | null;
}
```

底层使用 CSS2DRenderer 创建浮层 DOM，里面挂 `NodeEditorPopup` React 组件（从 `feature/graph-labels` 分支可复用大部分代码）。

### 6.3 编辑器功能

继承 v1.2 + `feature/graph-labels` 分支的设计：

- 完整 ProseMirror schema（与 NoteView 共用）
- 4 个 React UI 弹窗（mathInline / mathBlock / link / 等）
- slash menu 创建任意 Block 类型
- 全部 mark（bold / italic / underline / code / link）
- 完整快捷键

但**改为浮层模式**：position: fixed，覆盖在节点屏幕坐标处。

### 6.4 一致性折中

显示态（SVG 几何）和编辑态（DOM PM）可能有**微小视觉差异**：

- 编辑态有 KaTeX strut 撑高 → 节点临时变高
- 显示态无 strut → 节点紧凑

**这是接受的折中**：编辑期间用户专注内容，对临时变形不敏感；提交后重新走 SVG 几何路线，最终态准确。

不追求"编辑态和显示态像素级一致"。

---

## 7. 交互（继承 v1.2，补充 raycaster）

### 7.1 交互层（v1.3 修订）

v1.2 的交互全部基于 DOM 浮层（CSS2D 上的 mouse 事件）。v1.3 改为基于 **`THREE.Raycaster`**：

```typescript
class InteractionHandler {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  onMouseMove(e: MouseEvent): void {
    // 转 NDC 坐标
    // raycaster.setFromCamera + intersectObjects
    // 命中 → 派发 hover/cursor 事件
  }

  onClick(e: MouseEvent): void { ... }
  onDoubleClick(e: MouseEvent): void {
    // 命中 → enterEditMode(nodeId)
  }
  onMouseDown(e: MouseEvent): void {
    // 命中 → 拖动开始
  }
}
```

PoC 已验证 raycaster 路径在 200 节点下 120fps 无延迟（详见 `Graph-3D-Rendering-Spec.md` § 1.2）。

### 7.2 操作清单（继承 v1.2）

| 操作 | 触发 | 行为 |
|------|------|------|
| 选中节点 | 单击 | 高亮选中环 |
| 取消选中 | 单击空白 | 清除选中 |
| 编辑节点 label | 双击 | 进入 EditOverlay |
| 拖动节点 | mousedown 圆中心 + 拖动 | 节点位置变化 + 实时回写 |
| 拖出新边 | mousedown 圆边缘 + 拖动 | 创建临时边 → mouseup 在另一节点上 |
| 删除选中 | Delete / Backspace | 移除节点/边 |
| 撤销 / 重做 | Cmd+Z / Cmd+Shift+Z | 通过 CommandStack |
| 重置视图 | toolbar 按钮 | 相机回正 |
| 缩放 / 平移 | 滚轮 / 中键拖动 | 相机缩放/平移 |

### 7.3 hover 高亮（v1.3 实现）

PoC 已实现：

- raycaster 命中节点 group 的 shape mesh
- 命中时圆色变橙 (`#ffaa3b`) + cursor: pointer
- 离开时恢复

正式实施期增强：

- 节点边缘 hover → cursor: crosshair（拖出新边的提示）
- 选中态优先级高于 hover 态
- 拖动期间 hover 暂停

---

## 8. 持久化（不变）

继承 v1.2 § 5。SurrealDB schema 不变，IPC handler 不变。

唯一变化：**节点拖动时无需重新走 SVG 序列化管线**——只更新 group 的 position。这是 v1.3 渲染管线的天然优势（与 v1.2 的 DOM 浮层位置同步逻辑等价）。

---

## 9. 字体资源（v1.3 新增）

### 9.1 字体清单

| 字体 | 用途 | 协议 | 大小 |
|------|------|------|------|
| Inter Regular / Italic / Bold | 西文 | OFL | 各 ~400KB |
| Noto Sans SC Regular / Bold | 中文 | OFL | 各 < 400KB（subset） |

详见 `Graph-3D-Rendering-Spec.md` § 4.4。

### 9.2 加载时序

- App 启动时不加载（懒加载）
- GraphView 首次创建节点时触发字体加载（Inter ~10ms + Noto SC ~100ms）
- 后续节点命中缓存

### 9.3 子集化

v1.0 实施期采用 GB 2312 一级（3500 字 + 标点）子集化方案，目标 < 400KB。详见 `Graph-3D-Rendering-Spec.md` § 4.4.2。

---

## 10. 视图变种与形状库（v1.3 修订）

### 10.1 形状库定义

```typescript
interface ShapeLibrary {
  // 默认形状（变种必须提供）
  getDefaultShape(): ShapeRenderer;

  // 按节点类型获取形状
  getShape(nodeType: string): ShapeRenderer;

  // 注册新形状（变种内部使用）
  registerShape(nodeType: string, renderer: ShapeRenderer): void;
}
```

### 10.2 各变种的形状库

| 变种 | 形状 |
|------|------|
| **KnowledgeEngine** | concept → CircleShape；entity → RoundRectShape（v1.3 范围内仅实现 CircleShape） |
| **MindMapEngine** | root → RoundRectShape (large)；child → RoundRectShape (medium)（独立 spec 实施） |
| **BPMNEngine** | task → TaskShape；event → EventShape；gateway → DiamondShape（独立 spec 实施） |
| **TimelineEngine** | event → CircleShape；milestone → DiamondShape（独立 spec 实施） |
| **CanvasEngine** | 用户自由定义（独立 spec 实施） |
| **BasicEngine** | concept → CircleShape（验证用） |

### 10.3 内容投影规则

无论何种变种，节点内容（atoms）的渲染**全部走同一 ContentRenderer**（默认 SvgGeometryContent）。形状只决定"边框 / 容器 / 几何外观"，内容投影方式由 ShapeRenderer 的 `getContentAnchor` 决定（见 `Graph-3D-Rendering-Spec.md` § 8.2）。

---

## 11. 与 Note 的关系（继承 v1.2，强化）

继承 v1.2 § 6：Graph + Note 互补，平等关系。

v1.3 新增证据：

- 节点 label 是 Atom[]，与 Note 的 doc_content 同形态
- 序列化器 `src/lib/atom-serializers/svg/` 是 **Graph 和 Note 的共享层**：未来 Note 导出 PDF 也走这个序列化器
- 形状/内容分离架构表明：**内容是知识，形状是表达**——同一份内容可以以不同形状呈现，而内容的来源（Note）和呈现的方式（Graph 视图变种）完全解耦

这进一步强化了三层架构（语义层 / 翻译层 / 可视化层）的实现：

- **语义层**：Atom（在 Graph 节点 label 中、在 Note doc 中）
- **翻译层**：序列化器（atom-serializers/svg）—— 跨视图
- **可视化层**：Graph / Note 各自的 Renderer（Graph 用 SVG 几何，Note 用 DOM PM）

---

## 12. 实施路线（v1.3）

按 `Graph-3D-Rendering-Spec.md` § 11 的 4 个 Phase 推进：

1. **Phase 1（2 周）**：基础渲染（CircleShape + SvgGeometryContent + P0 Block 类型 + raycaster hover）
2. **Phase 2（1 周）**：完善内容覆盖（P1 Block 类型 + 边渲染 + 三级缓存）
3. **Phase 3（1 周）**：编辑模式（EditOverlay + 浮层 PM + 提交回路）
4. **Phase 4（1 周）**：性能与稳定性（监控仪表板 + 退化策略 + 跨平台验证）

总计 5 周左右。后续 v1.4 / v2.0 范围（思维导图变种、Worker、字体子集化深度优化、CodeMirror 集成）独立 spec。

---

## 13. 与现有规范的关系

| 规范 | 关系 |
|------|------|
| `KRIG-Three-Layer-Architecture.md` | 顶层原则不变；v1.3 是可视化层 GraphView 的迭代实施 |
| `Graph-3D-Rendering-Spec.md` | 渲染层细节由该规范承载；v1.3 在数据模型/交互/持久化层面引用它 |
| `Graph-3D-Rendering-PoC-Spec.md` | PoC 阶段规范，作为锚点保留 |
| `Graph-3D-Rendering-PoC-Report.md` | PoC 评审结论，是 v1.3 决策的输入证据 |
| `KRIG_GraphView_Spec_v1.2.md` | 数据模型 / 持久化 / 交互全部继承；渲染层被 v1.3 取代 |
| `KRIG_GraphView_Spec_v1.1.md` | 多重图弧线决议继承；其余被 v1.2 / v1.3 覆盖 |
| `KRIG_GraphView_Spec_v1.0.md` | 历史锚点 |

---

## 14. 决策日志

| 日期 | 决议 | 备注 |
|------|------|------|
| 2026-04-25 | 锁定路线 2（SVG 几何 → Three.js 场景） | 替代 v1.0~v1.2 的 CSS2DRenderer DOM 浮层 |
| 2026-04-25 | 形状/内容分离架构正式纳入 v1.3 | 为思维导图/BPMN 等视图变种留扩展空间 |
| 2026-04-25 | 编辑模式：显示态 SVG / 编辑态 DOM 切换 | 不追求像素级一致 |
| 2026-04-25 | 序列化器作为跨视图共享层 | 不属于任何 plugin，物理放在 `src/lib/atom-serializers/` |
| 2026-04-25 | 数据模型完全不变 | v1.2 数据无需迁移即可消费 v1.3 渲染管线 |
| 2026-04-25 | KaTeX → MathJax v3（fontCache:'none'） | 直接输出 path SVG，免文字 outline 化 |
| 2026-04-25 | raycaster 取代 DOM 浮层事件 | PoC 验证 200 节点 120fps 无延迟 |
| 2026-04-25 | 字体子集化 v1.0 范围 = GB 2312 一级 | 目标 < 400KB；详见 Rendering Spec § 4.4 |
| 2026-04-25 | 实施分 4 个 Phase / 共 5 周 | 详见 Rendering Spec § 11 |

---

## 附录 A：术语表（继承 + 扩展）

继承 v1.2 附录 + Rendering Spec 附录 A，新增：

| 术语 | 定义 |
|------|------|
| RenderingLayer | GraphEngine 内部的渲染子模块集合（NodeRenderer / EdgeRenderer / Cache 等） |
| EditOverlay | GraphEngine 内部管理编辑态 DOM 浮层的子模块 |
| 显示态 | 节点为 SVG 几何 mesh 的状态（默认） |
| 编辑态 | 节点暂时切换为 DOM PM 编辑器浮层的状态（双击触发） |

---

## 附录 B：从 v1.2 到 v1.3 的迁移检查表

如果生产环境从 v1.2 升级到 v1.3：

- [x] 数据迁移：**无需**（数据模型不变）
- [ ] 字体资源：将 Inter / Noto Sans SC 加入项目资源
- [ ] 序列化器：实施 `src/lib/atom-serializers/svg/`
- [ ] 渲染层：替换 GraphEngine 中的 BlockManager 为 RenderingLayer
- [ ] 编辑器：将 NodeEditorPopup 改造为浮层模式（EditOverlay）
- [ ] 字体子集化：构建期生成 GB 2312 一级子集
- [ ] 跨平台验证：Windows / Linux 字体渲染一致性
- [ ] 性能验证：所有 § 5.5 性能基线指标
- [ ] 回归测试：v1.2 所有用户场景在 v1.3 下功能等价

---

**Spec 完。建议依照 § 12 实施路线启动 Phase 1。**
