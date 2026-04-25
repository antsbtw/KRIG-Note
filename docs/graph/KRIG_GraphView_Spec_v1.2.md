# KRIG 技术规范 · GraphView v1.2

> Design Spec v1.2 · 2026-04-25
>
> 本版本基于 v1.1（`KRIG_GraphView_Spec_v1.1.md`）+ v1.2 修订提案（`KRIG_GraphView_Spec_v1.2_patch.md`）合并而成。
> v1.0 / v1.1 保留作为历史锚点，所有 patch 保留作为决策留痕。后续以本文件为准。
>
> **v1.2 核心变更**：明确 Graph 与 Note 的职责分离；GraphNode.label / GraphEdge.label 从 string 升级为 Atom[]（直接复用 Note 的内容数据形态）；删除 BlockCapacity / BlockManager / 引用计数等"未实施的理想态"；编辑器复用 NoteView 的 ProseMirror schema。

---

## 1. 概述

GraphView 是 KRIG 工作空间体系（L5 视图层）中的"图谱视图"类型，与 NoteView / EBookView / WebView / ThoughtView 同级。

GraphView 内部承载一个**可插拔的图渲染引擎**（GraphEngine），并按业务语义提供多种**变种**（KnowledgeEngine / BPMNEngine 等）。所有变种共享相同的渲染循环、数据模型和持久化层，只在形状库、布局算法和交互规则上有差异。

### 1.1 命名分层（重要）

为避免歧义，v1.1 明确两层概念：

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

| 层级 | 术语 | 说明 |
|------|------|------|
| L5 视图 | **GraphView** | 工作空间层面的视图类型，对应 `ViewType = 'graph'` |
| 引擎基类 | **GraphEngine** | L5 GraphView 内部的渲染引擎抽象 |
| 引擎变种 | **KnowledgeEngine** / **BPMNEngine** / ... | 具体业务语义的引擎实现 |
| 图实例 | **Graph**（数据层） | SurrealDB 中的 `graph:[id]` 记录 |

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| 父类只做通用事 | 渲染循环、节点/边管理、内容渲染、SurrealDB 读写，全部在 GraphEngine 父类实现 |
| 变种只覆盖差异 | 形状库、布局算法、交互规则，由具体 Engine 子类覆盖 |
| **职责分离（v1.2 强化）** | Three.js 负责空间，**Note 负责内容定义**，SurrealDB 负责持久化。**Graph 不重新实现任何内容能力**；凡涉及文字/富内容的场景，直接复用 Note 的 Block 体系（schema、渲染、编辑） |
| **Graph + Note 互补（v1.2 新增）** | Note 是文本/内容的表达手段，Graph 是结构/拓扑的表达手段。两者平等、互补、不互相替代。**GraphView 必须结合 Note 才完整** |
| 接口稳定优先 | GraphEngine 接口一旦定稳，变种不需要关心底层实现细节 |
| 可测试性 | BasicEngine 作为最简变种，用于验证父类接口完整性 |

### 1.3 变种继承关系

```
GraphEngine（抽象基类，L5 GraphView 内部使用）
    │
    ├── BasicEngine         ← 最简变种，用于验证父类接口（优先实现）
    ├── KnowledgeEngine     ← 知识图谱（默认变种）
    ├── BPMNEngine          ← BPMN 流程图
    ├── MindMapEngine       ← 思维导图
    ├── TimelineEngine      ← 时间轴
    └── CanvasEngine        ← 自由画布
```

---

## 2. 技术栈

| 层次 | 技术 | 职责 |
|------|------|------|
| 空间渲染 | Three.js | 节点形状、边、容器、场景管理 |
| DOM 内容 | CSS2DRenderer | 在 Three.js 节点上挂载 KRIG Block |
| 布局计算 | Dagre（默认）/ 可插拔 | 自动排列节点坐标 |
| 数据持久化 | SurrealDB | 图结构 + Block 内容独立存储 |
| 编辑能力 | ProseMirror | Block 内富文本编辑 |

---

## 3. 核心架构

### 3.1 整体结构

```
GraphView (L5 WebContentsView)
    │
    └── GraphEngine
          ├── SceneManager        Three.js 场景、相机、渲染循环
          ├── NodeManager         节点的增删改查、选中状态
          ├── EdgeManager         边的增删改查、路径计算
          ├── BlockManager        CSS2DRenderer 挂载与 LOD 切换
          ├── LayoutEngine        布局算法的统一入口（可插拔）
          ├── SurrealAdapter      SurrealDB 读写接口
          ├── InteractionHandler  鼠标、键盘、触摸事件
          └── LifecycleManager    mount / dispose / resize
```

### 3.2 GraphEngine 父类与变种的边界

```typescript
abstract class GraphEngine {
  // ── 父类实现，变种不需要关心 ──────────────────────
  protected scene:      THREE.Scene;
  protected camera:     THREE.OrthographicCamera;
  protected renderer:   THREE.WebGLRenderer;
  protected css2d:      CSS2DRenderer;
  protected nodeManager:   NodeManager;
  protected edgeManager:   EdgeManager;
  protected blockManager:  BlockManager;
  protected layoutEngine:  LayoutEngine;
  protected surreal:       SurrealAdapter;

  mount(container: HTMLElement): void { ... }
  dispose(): void { ... }
  resize(width: number, height: number): void { ... }

  addNode(node: GraphNode): void { ... }
  addEdge(edge: GraphEdge): void { ... }
  removeNode(id: string): void { ... }
  removeEdge(id: string): void { ... }
  selectNode(id: string): void { ... }

  loadFromSurreal(graphId: string): Promise<void> { ... }
  saveToSurreal(): Promise<void> { ... }

  runLayout(): void { ... }   // 调用 LayoutEngine，坐标写回节点

  // ── 变种必须实现 ───────────────────────────────────
  abstract getShapeLibrary(): ShapeLibrary;          // 形状库
  abstract getLayoutAlgorithm(): LayoutAlgo;          // 布局算法
  abstract getInteractionRules(): InteractionRules;   // 交互规则
}

// 注：v1.1 的 BlockCapacity / getBlockCapacity 已删除。节点 label 总是
// 一个 atom 数组（可空、可单 Block、可多 Block），用统一形态表达所有情况。
```

### 3.3 默认变种与切换策略

**新建图**：默认 `variant = 'knowledge'`，直接进入 KnowledgeEngine 渲染。

**KnowledgeEngine 默认配置**：

| 配置项 | 值 |
|--------|-----|
| 节点形状 | 圆形（主概念）/ 圆角矩形（实体） |
| 节点尺寸 | 80×80 / 120×60 |
| 默认边类型 | `relates_to` |
| 布局算法 | Force-directed |
| 允许任意节点间连线 | 是 |
| 默认 label 形态 | 单个 textBlock 的 atom 数组 |

**变种切换（两档模式）**：

用户在图的顶栏通过下拉菜单切换变种。切换时执行一次**兼容性检查**：

```typescript
interface VariantCompatibilityCheck {
  canSwitch: boolean;
  blockers:  Array<{
    nodeId:       string;
    currentType:  string;         // 在当前变种下的类型
    reason:       string;         // "目标变种无对应类型" / "目标变种不允许此连接" / ...
  }>;
}
```

**切换流程**：

```
切换变种时：
  ├── 兼容（blockers.length === 0）
  │     → 直接切换：仅更新 graph.variant、重新跑布局、重新渲染
  │     → 节点/边数据不变，只是换渲染方式
  │
  └── 不兼容（blockers.length > 0）
        → 弹出详情列表，展示每个 blocker 的 nodeId / currentType / reason
        ├── 选项 A：取消（默认，原图保持不变）
        └── 选项 B：克隆为新图并切换
              ├── 新建一个 graph:[newId]，复制所有节点/边/Block 引用
              ├── 在新图上执行变种切换（不兼容节点由新 Engine 决定如何处理）
              ├── 原图保持原变种，数据不变
              └── 自动打开新图，并提示用户原图入口仍在 NavSide
```

**核心承诺**：原图数据永远不会被切换操作悄悄改坏。需要变更只能通过"克隆为新图"显式发生。

### 3.4 GraphEngine 变种注册

```typescript
interface GraphEngineRegistration {
  variant: GraphVariant;
  name:    string;                          // 显示名
  icon:    string;
  create:  (deps: GraphEngineDeps) => GraphEngine;
  isCompatible: (graph: Graph, nodes: GraphNode[], edges: GraphEdge[]) => VariantCompatibilityCheck;
}

// src/plugins/graph/engines/registry.ts
const registry = new Map<GraphVariant, GraphEngineRegistration>();
export function registerGraphEngine(reg: GraphEngineRegistration): void;
export function getGraphEngine(variant: GraphVariant): GraphEngineRegistration | undefined;
```

对标 [src/main/view/registry.ts](../../src/main/view/registry.ts) 和 [src/main/workmode/registry.ts](../../src/main/workmode/registry.ts) 的注册模式。

---

## 4. 数据模型

### 4.1 Graph（图主体）

```typescript
interface Graph {
  id:          string;           // "graph:[uuid]"
  title:       string;           // 图标题，显示在 NavSide / WorkspaceBar
  variant:     GraphVariant;     // 当前使用的引擎变种
  hostNoteId?: string;           // 可选宿主 Note（null = 独立图）
  createdAt:   number;           // 创建时间戳
  updatedAt:   number;           // 最后修改时间戳
  meta?:       Record<string, unknown>;  // 变种自定义扩展
}

type GraphVariant =
  | 'knowledge'   // 默认
  | 'bpmn'
  | 'mindmap'
  | 'timeline'
  | 'canvas'
  | 'basic';      // 验证用
```

### 4.2 GraphNode（节点）

**v1.2 修订**：`label` 从 `string` 升级为 `Atom[]`，删除 `blockIds`。详见 v1.2 patch。

```typescript
// Atom 类型直接来自 Note 系统（不重新定义）
type Atom = unknown;  // ProseMirror node JSON：{ type, content, attrs, marks }

interface GraphNode {
  id:        string;             // "graph_node:[uuid]"
  graphId:   string;             // 属于哪个图
  type:      string;             // 由变种定义（如 "concept" / "task" / "person"）

  // 内容（直接复用 Note 的 Atom 数据形态，与 note.doc_content 同形态）
  label:     Atom[];             // 节点显示的内容，可写任意 Block 类型组合

  position?: {                   // 由布局引擎计算后写入
    x: number;
    y: number;
  };
  canvasPosition?: {             // Canvas 自由布局时用户手动拖拽的坐标
    x: number;
    y: number;
    w: number;
    h: number;
    zIndex: number;
  };
  meta?: Record<string, unknown>; // 变种自定义扩展（未来可承载 thoughtIds 等）
}
```

> **默认形态**：节点 label 是单个 textBlock 的 atom 数组：
>
> ```json
> [{ "type": "textBlock", "content": [{ "type": "text", "text": "节点 1" }] }]
> ```
>
> 用户可通过节点编辑器写入任意 Block 类型组合（mathBlock / codeBlock / bulletList 等），节点圆下方将渲染完整富内容。

### 4.3 GraphEdge（边）

**v1.2 修订**：`label` 从 `string?` 升级为 `Atom[]`。

```typescript
interface GraphEdge {
  id:       string;
  graphId:  string;              // 属于哪个图
  type?:    string;              // 由变种定义（如 "flow" / "relates_to" / "child_of"）
  source:   string;              // 源节点 ID
  target:   string;              // 目标节点 ID
  label:    Atom[];              // 边标签的 atom 数组（多数情况是单个 textBlock）
  meta?:    Record<string, unknown>;
}
```

### 4.4 SurrealDB 存储结构

**v1.2 修订**：删除"独立 block 表"的描述（v1.1 描述的"已存在"不符合现实）。当前 atom 直接内联在 graph_node.label / graph_edge.label / note.doc_content 中。

```
SurrealDB
    ├── graph:[id]               图主体
    │     id / title / variant / hostNoteId / createdAt / updatedAt / meta
    │
    ├── graph_node:[id]          节点实体
    │     id / graphId / type / label(Atom[]) / position / canvasPosition / meta
    │
    ├── graph_edge:[id]          边实体（SurrealDB 原生 RELATE）
    │     id / graphId / type / source / target / label(Atom[]) / meta
    │
    └── note:[id]                Note 文档（已存在）
          doc_content (Atom[]) / title / ...

注：
- Atom 数据形态在 graph_node.label / graph_edge.label / note.doc_content 三处都是同样的格式
- 三者互不引用、各自独立持久化
- 不存在独立的 block:[id] 表（v1.1 § 4.4 描述的"已存在"为草案，未实施）
```

**示例**：

```surql
-- 创建图主体
CREATE graph:knowledge_001 SET
  title     = '我的第一个知识图谱',
  variant   = 'knowledge',
  hostNoteId = NONE,
  createdAt = time::now(),
  updatedAt = time::now();

-- 节点写入（label 是 atom 数组，schemaless 直接存 JSON）
CREATE graph_node:concept_ai SET
  graphId  = 'graph:knowledge_001',
  type     = 'concept',
  label    = [{ type: 'textBlock', content: [{ type: 'text', text: '人工智能' }] }],
  position = { x: 240, y: 120 };

-- 边写入（label 也是 atom 数组）
RELATE graph_node:concept_ai -> graph_edge:relates_001 -> graph_node:concept_ml
  SET graphId = 'graph:knowledge_001',
      type    = 'relates_to',
      label   = [{ type: 'textBlock', content: [{ type: 'text', text: '包含' }] }];
```

### 4.5 图与 Note 的关系

图和 Note 是**同级独立的一等公民**，但允许图声明一个"宿主 Note"作为叙述性上下文。

```
独立图（hostNoteId = null）
    graph 单独存在，节点里的 Block 只属于这个图，不在任何 note 的 atom 树里
    典型场景：用户先画图再写笔记，或图是跨多篇笔记的汇总视图

绑定图（hostNoteId = 'note:abc'）
    graph 有一个宿主 Note，通常承载该图的叙述性描述
    典型场景：写了一篇关于"神经网络"的笔记，派生一个知识图谱作为可视化视图
    默认布局建议：graph+note（左图右文）
```

**切换能力**：

- 独立图 → 绑定图：在图属性里设置 `hostNoteId`，原有节点 Block 不变
- 绑定图 → 独立图：清空 `hostNoteId`，不影响 Note，也不影响节点 Block
- 删除宿主 Note：只解除绑定（`hostNoteId` 置 null），不删图

### 4.6 Block 独立化与跨 View 同步（v1.2 降级为"未来路线"）

> **v1.2 状态变更**：v1.1 的 § 4.6 / 4.7 / 4.8 描述了 "block 独立实体 + 引用计数 + 跨 View 同步" 的体系。在 v1.2 阶段，KRIG 实际上**没有独立的 block 实体**（Block/atom 直接内联在 note.doc_content / graph_node.label / graph_edge.label 中），所以这套体系不在 GraphView 范围内实现。
>
> 这些机制的真正落地需要 KRIG **整体的 Block 独立化重构**（涉及 Note / Thought / Graph 等所有视图），属于全系统级别的架构演进，不应由 GraphView 单独驱动。

#### 当前状态（v1.2 实施）

- Atom 直接内联在 graph_node.label / graph_edge.label（schemaless JSON）
- 不存在 `block:[id]` 独立表
- 不存在引用计数机制
- GraphView 改节点 label，不影响任何 Note；Note 改 doc_content，不影响任何节点
- 节点删除时 `node.label`（atom 数组）随节点一起删除，没有"孤儿 block"问题

#### 未来路线（KRIG 全系统 Block 独立化后）

当 KRIG 整体决定升级到独立 block 实体时（时机未定），自然得到：

- 引用计数（`SELECT count() FROM graph_node WHERE blockIds CONTAINS ...`）
- 跨 View 同步（NoteView 改 block:[id] → GraphView 节点重渲）
- 孤儿 block 处置流程

那时 GraphNode.label 从 `Atom[]` 升级为 `BlockId[]`，自动获得这些能力。**升级路径开放，不阻塞当前实施**。

---

## 5. 渲染层设计

### 5.1 相机选型

GraphEngine 使用**正交相机（OrthographicCamera）**，不使用透视相机：

```typescript
const camera = new THREE.OrthographicCamera(
  -width / 2, width / 2,
  height / 2, -height / 2,
  0.1, 1000
);
camera.position.set(0, 0, 100);
```

> 节点大小不随距离变化，符合流程图 / 图谱的认知习惯。GraphView 是 2.5D（平面图 + 深度层叠），透视相机留给 3D 场景。

### 5.2 双渲染器叠加

```
WebGLRenderer（Three.js）    ← 节点形状、边、背景
    +
CSS2DRenderer               ← KRIG Block 内容层（DOM）
    ↓
视觉上统一，坐标系以 Three.js 世界坐标为准
DOM 仅作为视觉覆盖层，不参与碰撞检测
```

```typescript
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const css2dRenderer = new CSS2DRenderer();
css2dRenderer.domElement.style.position = 'absolute';
css2dRenderer.domElement.style.top = '0';
container.appendChild(renderer.domElement);
container.appendChild(css2dRenderer.domElement);
```

### 5.3 LOD（Level of Detail）策略

CSS2DRenderer 挂载大量 DOM 节点在低缩放时会有性能问题，通过 LOD 切换解决：

```
缩放级别          渲染策略
─────────         ────────
> 0.8（近）       完整 CSS2DRenderer Block（可编辑）
0.4 ~ 0.8（中）   CSS2DRenderer 只显示标题摘要
< 0.4（远）       隐藏 DOM，改用 Three.js CanvasTexture 渲染文字
< 0.15（鸟瞰）    纯几何形状，无文字
```

```typescript
controls.addEventListener('change', () => {
  const zoom = camera.zoom;
  blockManager.setLOD(zoom);
});
```

### 5.4 节点形状库接口（ShapeLibrary）

GraphEngine 父类定义接口，变种实现具体形状：

```typescript
interface ShapeLibrary {
  createShape(node: GraphNode): THREE.Mesh;
  applyHighlight(mesh: THREE.Mesh, selected: boolean): void;
  getNodeSize(type: string): { width: number; height: number };
}

// BasicEngine 的最简实现示例
class BasicShapeLibrary implements ShapeLibrary {
  createShape(node: GraphNode): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(30, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0x2D7FF9 });
    return new THREE.Mesh(geometry, material);
  }
  applyHighlight(mesh, selected) {
    (mesh.material as THREE.MeshBasicMaterial).color
      .set(selected ? 0xFF6B6B : 0x2D7FF9);
  }
  getNodeSize() {
    return { width: 60, height: 60 };
  }
}
```

---

## 6. 布局引擎（LayoutEngine）

### 6.1 可插拔接口

```typescript
interface LayoutAlgo {
  name: string;
  compute(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Promise<Map<string, { x: number; y: number }>>;
}
```

### 6.2 默认实现：Dagre

```typescript
class DagreLayout implements LayoutAlgo {
  name = 'dagre';

  async compute(nodes, edges) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 80 });

    nodes.forEach(n => {
      const size = shapeLib.getNodeSize(n.type);
      g.setNode(n.id, { width: size.width, height: size.height });
    });
    edges.forEach(e => g.setEdge(e.source, e.target));

    dagre.layout(g);

    const positions = new Map<string, { x: number; y: number }>();
    g.nodes().forEach(id => {
      const { x, y } = g.node(id);
      positions.set(id, { x, y });
    });
    return positions;
  }
}
```

### 6.3 各变种的布局算法对应

| 变种 | 默认布局算法 | 说明 |
|------|------------|------|
| BasicEngine | Dagre | 验证用 |
| KnowledgeEngine | Force-directed | 关系网络自然聚类 |
| BPMNEngine | Dagre（LR / TB 可选） | 流程图从左到右 |
| MindMapEngine | Tree | 层级发散 |
| TimelineEngine | 线性（自定义） | 时间轴从左到右 |
| CanvasEngine | 无（手动拖拽） | 用户自由摆放 |

---

## 7. 节点内容渲染（NodeContentRenderer）

> v1.2 修订：v1.1 § 7 的 BlockManager 已被替换为 NodeContentRenderer。简化要点：直接消费 atom 数组（不接受 blockIds）；删除 BlockCapacity；编辑器复用 NoteView 的 ProseMirror schema。

### 7.1 渲染原理

NodeContentRenderer 把 atom 数组渲染到 CSS2DObject 的 div 中，复用 NoteView 的 ProseMirror schema。

```typescript
import { blockRegistry } from '@/plugins/note/registry';
import { registerAllBlocks } from '@/plugins/note/blocks';

class NodeContentRenderer {
  private css2dRenderer: CSS2DRenderer;
  private mountedNodes = new Map<string, CSS2DObject>();
  private schema = getGraphSchema();

  /** 渲染 atom 数组到节点上 */
  mount(nodeId: string, atoms: Atom[], mesh: THREE.Mesh): void {
    const container = document.createElement('div');
    container.className = 'krig-graph-node-content';

    // 用 readonly ProseMirror EditorView 渲染 atoms
    renderAtomsReadonly(container, this.schema, atoms);

    const obj = new CSS2DObject(container);
    mesh.add(obj);
    this.mountedNodes.set(nodeId, obj);
  }

  /** 节点 label 内容变化时调用 */
  update(nodeId: string, atoms: Atom[]): void {
    const obj = this.mountedNodes.get(nodeId);
    if (!obj) return;
    renderAtomsReadonly(obj.element, this.schema, atoms);
  }

  unmount(nodeId: string): void {
    const obj = this.mountedNodes.get(nodeId);
    if (obj) {
      obj.element.remove();
      obj.parent?.remove(obj);
      this.mountedNodes.delete(nodeId);
    }
  }

  // LOD 切换
  setLOD(zoom: number): void {
    this.mountedNodes.forEach((obj) => {
      if (zoom > 0.8)       obj.element.dataset.mode = 'full';
      else if (zoom > 0.4)  obj.element.dataset.mode = 'summary';
      else                  obj.visible = false;
    });
  }
}

// schema 单例（GraphView 内部，与 NoteEditor 共享 blockRegistry）
let schemaCache: ReturnType<typeof blockRegistry.buildSchema> | null = null;
function getGraphSchema() {
  if (!schemaCache) {
    registerAllBlocks();
    schemaCache = blockRegistry.buildSchema();
  }
  return schemaCache;
}
```

### 7.2 编辑器接入

节点 label 编辑使用一个独立的 ProseMirror 编辑器实例（不直接复用 NoteEditor 组件，但复用其 schema）：

```typescript
// 双击节点 / 右键编辑 → 弹出小窗口
function openNodeLabelEditor(nodeId: string, atoms: Atom[], onSave: (next: Atom[]) => void) {
  const schema = getGraphSchema();
  const doc = schema.nodeFromJSON({ type: 'doc', content: atoms });
  const state = EditorState.create({ doc, plugins: buildGraphEditorPlugins(schema) });
  const view = new EditorView(containerEl, {
    state,
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
    },
  });

  // 用户点保存 / Esc → 提取 atom 数组保存
  // const next = view.state.doc.content.toJSON();
  // onSave(next);
}
```

### 7.3 坐标同步注意事项

```
⚠️  CSS2DRenderer 的 DOM 元素坐标由 Three.js 世界坐标驱动
    碰撞检测、连接点吸附，必须以 Three.js 世界坐标为准
    DOM 只是视觉覆盖层，不参与任何空间计算
```

---

## 8. 交互设计

### 8.1 InteractionRules 接口

```typescript
interface InteractionRules {
  canConnect(sourceType: string, targetType: string): boolean;
  canAttachBlock(nodeType: string): boolean;
  canDelete(nodeType: string): boolean;
  onDoubleClick(node: GraphNode): void;
}
```

### 8.2 父类默认交互

GraphEngine 父类实现以下通用交互，变种可覆盖：

| 交互 | 默认行为 |
|------|---------|
| 单击节点 | 选中，高亮显示 |
| 双击节点 | 展开 Block 编辑界面 |
| 拖拽节点 | 更新 canvasPosition，实时重绘相关边 |
| 滚轮 | 缩放，触发 LOD 切换 |
| 中键拖拽 | 平移画布 |
| 节点连接点拖拽 | 创建新边（调用 canConnect 校验） |
| Delete 键 | 删除选中节点或边（节点删除走 `deleteNode` 引用计数流程） |
| Ctrl+Z | 撤销（CommandStack） |

### 8.3 CommandStack（撤销/重做）

所有编辑操作通过 CommandStack 执行：

```typescript
interface Command {
  execute(): void;
  undo(): void;
}

class AddNodeCommand implements Command {
  constructor(private engine: GraphEngine, private node: GraphNode) {}
  execute() { this.engine.addNode(this.node); }
  undo()    { this.engine.removeNode(this.node.id); }
}
```

> Block 内部的 ProseMirror 有自己的 history，与 GraphEngine 的 CommandStack 各管各的，不互相穿透。这是有意为之：节点级别的操作（增删边、移位）和 Block 内部的字符级别编辑撤销范围不同。

---

## 9. SurrealAdapter（数据层）

### 9.1 接口定义

```typescript
class SurrealAdapter {
  // 加载图数据（图主体 + 节点 + 边）
  async loadGraph(graphId: string): Promise<{
    graph: Graph;
    nodes: GraphNode[];
    edges: GraphEdge[];
  }> { ... }

  // 保存图主体元数据
  async saveGraph(graph: Graph): Promise<void> { ... }

  // 保存节点
  async saveNode(node: GraphNode): Promise<void> { ... }

  // 保存边
  async saveEdge(edge: GraphEdge): Promise<void> { ... }

  // 删除节点（级联删除相关边 + 处理 Block 引用，见 4.7）
  async deleteNode(id: string, options?: { cleanOrphanBlock?: boolean }):
    Promise<{ removedBlockIds: string[] }> { ... }

  // 删除边
  async deleteEdge(id: string): Promise<void> { ... }

  // 批量保存（编辑完成时调用）
  async saveAll(): Promise<void> { ... }

  // 查询 block 引用计数
  async getBlockReferenceCount(blockId: string):
    Promise<{ inNotes: number; inGraphNodes: number; total: number }> { ... }

  // 克隆图（变种切换的"克隆为新图"逃生口使用）
  async cloneGraph(srcGraphId: string, options: {
    newTitle: string;
    newVariant?: GraphVariant;
  }): Promise<string> { ... }   // 返回新 graphId
}
```

### 9.2 写入策略

```
实时写入（位置变更）   节点拖拽结束时写入 canvasPosition，不在拖拽过程中写
批量写入（内容变更）   Block 内容由 BlockManager 独立管理，编辑完成时写入
保存触发             用户点击「保存」或离开视图时触发 saveAll()
```

> 两条写入流（图结构 / Block 内容）逻辑上保持原子性：saveAll() 使用 SurrealDB 事务，确保节点位置与 Block 内容同步提交。

---

## 10. 生命周期

```typescript
// 标准使用方式
const engine = new KnowledgeEngine();      // 创建变种实例

engine.mount(containerElement);            // 挂载到 DOM，初始化 Three.js 场景
await engine.loadFromSurreal(graphId);     // 从 SurrealDB 加载图数据
engine.runLayout();                        // 执行布局算法

// ... 用户交互 ...

await engine.saveToSurreal();              // 保存到 SurrealDB
engine.dispose();                          // 销毁，清理 Three.js 资源和 DOM
```

### 10.1 生命周期钩子

```typescript
abstract class GraphEngine {
  protected onBeforeMount(): void {}
  protected onAfterMount(): void {}
  protected onBeforeDispose(): void {}
  protected onNodeAdded(node: GraphNode): void {}
  protected onEdgeAdded(edge: GraphEdge): void {}
  protected onLayoutComplete(): void {}
  protected onVariantSwitching(from: GraphVariant, to: GraphVariant): void {}
}
```

---

## 11. BasicEngine（验证用最简引擎）

BasicEngine 是第一个实现的变种，目的是验证 GraphEngine 父类接口的完整性，不承担任何业务语义。

```typescript
class BasicEngine extends GraphEngine {

  getShapeLibrary(): ShapeLibrary {
    return {
      createShape(node) {
        const geo = new THREE.CircleGeometry(30, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0x2D7FF9 });
        return new THREE.Mesh(geo, mat);
      },
      applyHighlight(mesh, selected) {
        (mesh.material as THREE.MeshBasicMaterial).color
          .set(selected ? 0xFF6B6B : 0x2D7FF9);
      },
      getNodeSize() {
        return { width: 60, height: 60 };
      }
    };
  }

  getLayoutAlgorithm(): LayoutAlgo {
    return new DagreLayout();
  }

  getInteractionRules(): InteractionRules {
    return {
      canConnect: () => true,
      canAttachBlock: () => true,
      canDelete: () => true,
      onDoubleClick: (node) => { /* 展开 Block 编辑 */ }
    };
  }

  getBlockCapacity(): BlockCapacity {
    return 'single';
  }
}
```

### BasicEngine 验证清单

BasicEngine 跑通以下所有场景，才视为 GraphEngine 父类接口完整：

- [ ] mount / dispose / resize 生命周期正常
- [ ] 节点增删、选中、高亮
- [ ] 边增删、路径渲染
- [ ] Dagre 布局自动计算坐标
- [ ] CSS2DRenderer Block 挂载与卸载
- [ ] LOD 缩放切换（full / summary / hidden）
- [ ] 节点拖拽 + canvasPosition 更新
- [ ] SurrealDB 加载与保存（含 graph 主表）
- [ ] CommandStack 撤销/重做
- [ ] 坐标同步（Three.js 世界坐标 vs DOM）
- [ ] Block 引用计数：删除节点时正确处理孤儿 block
- [ ] Block 跨 View 同步：NoteView 编辑 block 后，BasicEngine 节点自动重渲

---

## 12. L5 集成

作为 L5 视图类型，GraphView 必须接入 KRIG 现有的 Shell / Workspace / NavSide / IPC / Workmode 体系。本节列出所有集成点。

### 12.1 文件与入口

对标 NoteView / EBookView 的组织方式：

| 项 | 路径 | 说明 |
|----|------|------|
| HTML 入口 | `graph.html` | 放在项目根，对标 `note.html` / `ebook.html` |
| Renderer 入口 | `src/plugins/graph/renderer.tsx` | 对标 [src/plugins/note/renderer.tsx](../../src/plugins/note/renderer.tsx) |
| 根组件 | `src/plugins/graph/components/GraphView.tsx` | L5 视图的 React 根组件 |
| 引擎目录 | `src/plugins/graph/engines/` | 存放 GraphEngine 基类及各变种 |
| Preload | `src/main/preload/view.ts` | 复用统一 View preload（不新增） |
| Vite 配置 | `vite.graph.config.mts` | 独立 bundle（Three.js 不污染其他 View），P0 阶段配置 tree-shaking |

### 12.2 IPC 通道

前缀 `graph:`，在 `src/shared/types.ts` 的 `IPC.GRAPH_*` 统一定义：

| 通道 | 方向 | 用途 |
|------|------|------|
| `graph:load-graph` | main → graph | 加载指定 graphId 的图数据 |
| `graph:new-graph` | main → graph | 新建空白图（variant='knowledge'） |
| `graph:save-request` | main → graph | 请求保存 |
| `graph:state-changed` | graph → main | 标题 / 保存状态变化 |
| `graph:switch-variant` | graph → main | 请求切换变种（触发兼容性检查） |
| `graph:clone-graph` | graph → main | 克隆图（变种切换的逃生口） |
| `graph:block-updated` | main → graph | 某个 block:[id] 被外部修改，要求重渲染 |
| `graph:set-host-note` | graph → main | 设置 / 清除 hostNoteId |
| `graph:send-to-ai` | graph → main | 将选中节点/子图发送到 AI |
| `graph:close` | graph ↔ main | 关闭图视图 |

### 12.3 NavSide 集成

新增 `GraphPanel`，注册方式对标现有 `EBookPanel` / `WebPanel`：

```typescript
// src/plugins/graph/components/GraphPanel.tsx
registerNavPanel({
  mode: 'graph',
  icon: GraphIcon,
  component: GraphPanel,
  onOpen: () => {
    closeRightSlot();   // 遵循 "NavSide 切换关 right slot 契约"
    // 显示图列表 + 新建按钮
  },
});
```

**GraphPanel 内容**：

- 图列表（按 `updatedAt` 降序）
- 每一项显示：标题、变种图标、节点数、是否有 hostNoteId
- 点击 → 在当前 Workspace 打开该图
- `[+]` 新建图按钮 → 弹出命名对话框 → 创建 `graph:[id]` 并打开

### 12.4 Workmode 注册

```typescript
// src/main/workmode/registry.ts
registerWorkmode({
  id: 'graph',
  name: '图谱',
  defaultLayout: 'graph-only',
  allowedLayouts: ['graph-only', 'graph+note'],
});
```

**Layout Mode 新增**（对标 [docs/视图层级定义.md](../视图层级定义.md) § 2.5）：

| Layout Mode | Left Slot | Right Slot | NavMode | 说明 |
|-------------|-----------|-----------|---------|------|
| `graph-only` | GraphView | — | graph | 默认，专注图谱 |
| `graph+note` | GraphView | NoteView | graph | 绑定图（hostNoteId）时自动切到此布局 |

> `note+graph`、`web+graph` 已在视图层级定义 v1.0 中作为二等公民存在，v1.1 不改动。

### 12.5 Workspace 上限

| View 类型 | 每 Workspace 上限 |
|-----------|------------------|
| GraphView | **1** |

**理由**：
- 不同变种的图共享同一个 GraphView 实例，通过变种切换切换渲染
- 不同的图（不同 graphId）通过 NavSide 列表切换，复用同一个 GraphView 实例
- 避免左右双图带来的 UX 复杂度

**对比看图需求**：通过两个 Workspace 各开一张图实现。

### 12.6 与其他 View 的互通（跨 View 消息）

所有跨 View 通信经 main 路由，遵循 [docs/视图层级定义.md](../视图层级定义.md) § 四：

| 模式 | 源 View | 目标 View | 数据 | 触发 |
|------|---------|----------|------|------|
| **节点内容同步** | NoteView (编辑 Block) | GraphView | block:[id] 更新事件 | Block 改动 |
| **节点内容同步（反向）** | GraphView (编辑节点 Block) | NoteView | block:[id] 更新事件 | Block 改动 |
| **AI 对话** | GraphView | WebView | 选中节点/子图的 Markdown 摘要 | 用户发送 |
| **宿主联动** | GraphView (hostNoteId) | NoteView | 打开 hostNote | 用户点击图属性里的宿主链接 |
| **从 Note 建图** | NoteView | GraphView | 选中的概念/实体 → 新建/添加节点 | 用户 → "提取到图谱" |

### 12.7 持久化与 Workspace Snapshot

Workspace 切换时，GraphView 状态随 Workspace 一起隐藏/显示（遵循 L5 生命周期）。

**需在 WorkspaceSnapshot 中记录**：
- 当前打开的 `graphId`

**不持久化**：
- 视图相机状态（zoom / pan）—— 只在内存
- 选中节点
- 图数据本身（永远从 SurrealDB 读）

---

## 13. 实施路线图

| 阶段 | 任务 | 完成标志 |
|------|------|---------|
| **P0** | L5 GraphView 骨架（html / renderer / preload 接入） | 能在 Workspace 打开空白 GraphView |
| **P0** | GraphEngine 父类骨架 + SceneManager | Three.js 场景正常渲染 |
| **P0** | `graph:[id]` 主表 + SurrealAdapter 读写 | 图可新建 / 加载 / 保存 |
| **P0** | NavSide GraphPanel + Workmode 注册 | 用户能从 NavSide 新建和打开图 |
| **P0** | Vite 配置 + tree-shaking | Three.js bundle 体积可控 |
| **P1** | BasicEngine（验证用最简引擎） | 父类接口验证清单全通过（见 § 11） |
| **P1 v1.2** | NodeContentRenderer：用 readonly ProseMirror 渲染 atom 数组到 CSS2DObject | 节点显示富内容 |
| **P1** | DagreLayout | BasicEngine 默认布局可用 |
| **P1** | LOD 切换 | 缩放时正确降级 |
| ~~**P1** Block 跨 View 同步~~ | ~~v1.1 任务~~ | **v1.2 推迟**：依赖 KRIG 整体 Block 独立化（详见 § 4.6） |
| **P2** | KnowledgeEngine（默认变种） | 新建图默认进入 Knowledge，Force-directed 可用 |
| **P2** | InteractionHandler + CommandStack | 拖拽、连线、撤销/重做 |
| **P2** | 变种注册机制 + 两档切换（兼容直切 / 不兼容克隆为新图） | 变种可注册、切换流程可用 |
| **P2** | 图 ↔ Note 绑定（hostNoteId） | `graph+note` 布局可用 |
| ~~**P2** 孤儿 Block 删除时弹窗询问~~ | ~~v1.1 任务~~ | **v1.2 取消**：当前 atom 内联，无孤儿（详见 § 4.6） |
| **P2 v1.2 新增** | 节点 / 边的 ProseMirror 编辑器接入（双击 / 右键编辑） | 用户能在节点/边里写所有 Block 类型 |
| **P2 v1.2 新增** | 注册制 Context Menu surface + 基本操作（选中边 / 复制 / 粘贴 / 编辑属性） | 所有"基本操作"通过统一注册体系暴露 |
| **P3** | BPMNEngine / MindMapEngine / TimelineEngine / CanvasEngine | 按需实现 |
| **P3** | 节点挂 Thought（如决策通过） | Thought 第三种锚点类型 |
| **P3** | 大图性能预算与降级策略 | 节点数 / 边数 / DOM 上限确定 |

---

## 14. Open Questions（v1.1 未定，留待后续）

| # | 问题 | 计划阶段 |
|---|------|---------|
| 1 | 节点挂 Thought 的实现时机与语义 | P3 |
| 2 | 大图性能预算：节点 / 边 / CSS2DObject 上限 | P3，等 KnowledgeEngine 真实数据 |

> Patch 阶段提出的另外 4 条 Open Questions 已在本版本定稿：
> - Block 引用反向索引 → 已采用 SurrealDB 原生查询（§ 4.6）
> - 孤儿 Block 回收策略 → 删节点时弹窗（§ 4.7、P2 路线图）
> - 变种切换逃生口 → 克隆为新图（§ 3.3）
> - Three.js bundle 大小控制 → 独立 vite 配置 + tree-shaking（§ 12.1、P0 路线图）

---

## 15. 决策留痕

本规范关键决策的拍板记录：

| 决策 | 结论 | 日期 |
|------|------|------|
| 命名分层 | L5 视图 GraphView / 引擎基类 GraphEngine | 2026-04-24 |
| 图 ↔ Note 关系 | 方案 C：可选绑定（hostNoteId） | 2026-04-24 |
| ~~节点删除是否删 Block~~ | ~~引用计数 + 孤儿弹窗询问~~（v1.1） | **v1.2 推翻**：节点 label 是 atom 内联，无孤儿问题 |
| ~~Block 多节点引用~~ | ~~支持~~（v1.1） | **v1.2 推翻**：当前没有 block 实体可引用 |
| ~~Note 编辑 Block → 图节点同步~~ | ~~支持，实时~~（v1.1） | **v1.2 推迟**：依赖 KRIG 整体 Block 独立化 |
| ~~Block 多容量节点支持~~ | ~~blockIds 数组 + getBlockCapacity~~（v1.1） | **v1.2 删除该概念**：节点 label 统一是 atom 数组 |
| 默认变种 | KnowledgeEngine | 2026-04-24 |
| 变种切换策略 | 两档：兼容直切 / 不兼容克隆为新图（无强制覆盖） | 2026-04-24 |
| ~~引用反向查询实现~~ | ~~SurrealDB 原生查询~~（v1.1） | **v1.2 不再需要**：无独立 block 实体 |
| 每 Workspace GraphView 数 | 1 | 2026-04-24 |
| 节点挂 Thought | 延后（P3 决策） | 2026-04-24 |
| **Graph 与 Note 职责分离** | Graph 不重造内容能力；GraphNode.label = Atom[]（直接复用 Note 数据形态） | 2026-04-25 |
| **节点 label 数据形态** | Atom[] 内联，不引用独立 block 实体 | 2026-04-25 |
| **NodeContentRenderer 渲染** | 直接消费 atom 数组，复用 blockRegistry schema | 2026-04-25 |
| **NoteEditor 组件复用** | 不直接复用组件，复用其 schema/blockRegistry | 2026-04-25 |

---

## 16. 与其他文档的关系

| 文档 | 关系 |
|------|------|
| [docs/视图层级定义.md](../视图层级定义.md) | L0~L5 层级定义，GraphView 在 L5 的位置 |
| [docs/系统模块清单.md](../系统模块清单.md) | 系统模块全貌 |
| [docs/note/Schema-Reference.md](../note/Schema-Reference.md) | Block / Atom Schema，节点引用的 block 遵此规范 |
| [docs/Ai-Design/KRIG-Atom体系设计文档.md](../Ai-Design/KRIG-Atom体系设计文档.md) | 跨 View 数据模型 |
| `KRIG_GraphView_Spec.md`（v1.0） | 历史锚点，不再维护 |
| `KRIG_GraphView_Spec_v1.1.md` | 历史锚点，不再维护（v1.2 已替代） |
| `KRIG_GraphView_Spec_v1.1_patch.md` | v1.0 → v1.1 修订过程留痕，不再维护 |
| `KRIG_GraphView_Spec_v1.2_patch.md` | v1.1 → v1.2 修订过程留痕，不再维护 |
| [docs/note/Schema-Reference.md](../note/Schema-Reference.md) | **Atom 数据形态权威参考**——GraphNode.label / GraphEdge.label 与 note.doc_content 共享同一格式 |

---

*KRIG Design Spec · GraphView v1.2 · 2026-04-25*
