### KRIG GraphView Spec v1.1 修订提案（Patch）

> 基于 v1.0（`KRIG_GraphView_Spec.md`）的讨论结果，形成本次修订提案。
> 本文件为 **Diff 补丁稿**，不直接覆盖 v1.0。待你 review 通过后再合并为 v1.1 完整版。
>
> 讨论对齐日期：2026-04-24
> 修订作者：wenwu + Claude

---

## 0. 修订总览

本次 v1.0 → v1.1 的核心变更：

| 变更 | 影响范围 |
|------|---------|
| **C1. 命名分层**：L5 视图类型 `GraphView` vs 引擎基类 `GraphEngine` | 全文术语、代码接口 |
| **C2. 数据模型补表**：新增 `graph:[id]` 主表、`hostNoteId` 字段 | 第 4 节 |
| **C3. 图 ↔ Note 关系**：可选绑定（方案 C）+ Block 引用计数 | 第 4、9 节 |
| **C4. 默认变种 = Knowledge**：变种切换严格模式 | 第 3、11 节 |
| **C5. 新增章节"L5 集成"**：html 入口 / IPC / NavSide / Workmode 注册 | 新增第 12 节 |
| **C6. 每 Workspace 1 个 GraphView**：进入后切换变种 | 第 3、12 节 |
| **C7. 节点挂 Thought**：暂定保留可能性，不在 v1.1 实现 | 新增 Open Questions |

---

## C1. 命名分层

### 背景

v1.0 中 `GraphView` 同时指代两件事：
- **L5 视图类型**：和 NoteView / EBookView / WebView / ThoughtView 同级的 `WebContentsView`
- **引擎抽象基类**：内部可插拔的渲染框架，派生 BPMN / Knowledge / MindMap 等变种

这两层混在一个名字里，后续代码和文档都会歧义。v1.1 明确分层：

```
┌─ L5 GraphView（WebContentsView，一个 Workspace 内 1 个实例）
│
│   graph.html → src/plugins/graph/renderer.tsx
│
│   └─ 内部持有一个 GraphEngine 实例（L5 内部的渲染框架）
│       │
│       └─ GraphEngine（抽象基类）
│           ├── KnowledgeEngine（默认变种）
│           ├── BPMNEngine
│           ├── MindMapEngine
│           ├── TimelineEngine
│           ├── CanvasEngine
│           └── BasicEngine（验证用最简实现）
```

### 术语规则

| 层级 | 术语 | 说明 |
|------|------|------|
| L5 视图 | **GraphView** | 工作空间层面的视图类型，对应 `ViewType = 'graph'` |
| 引擎基类 | **GraphEngine** | L5 GraphView 内部的渲染引擎抽象 |
| 引擎变种 | **KnowledgeEngine** / **BPMNEngine** / ... | 具体业务语义的引擎实现 |
| 图实例 | **Graph**（数据层） | SurrealDB 中的 `graph:[id]` 记录，存元数据 |

### v1.0 → v1.1 术语替换表

| v1.0 原文 | v1.1 新术语 |
|-----------|------------|
| GraphView（作为抽象基类） | GraphEngine |
| BasicGraphView | BasicEngine |
| BPMNView | BPMNEngine |
| KnowledgeView | KnowledgeEngine |
| MindMapView | MindMapEngine |
| TimelineView | TimelineEngine |
| CanvasView | CanvasEngine |
| GraphView（作为 L5 视图） | GraphView（保留不变） |

**v1.0 第 2 节"变种继承关系"对应改为**：

```
GraphEngine（抽象基类，L5 GraphView 内部使用）
    │
    ├── BasicEngine         ← 最简变种，用于验证父类接口
    ├── KnowledgeEngine     ← 知识图谱（默认变种）
    ├── BPMNEngine          ← BPMN 流程图
    ├── MindMapEngine       ← 思维导图
    ├── TimelineEngine      ← 时间轴
    └── CanvasEngine        ← 自由画布
```

**v1.0 第 3.2 节"父类与变种的边界"代码块**：
- `abstract class GraphView` → `abstract class GraphEngine`
- 其余接口不变

**v1.0 第 11 节"BasicGraphView 验证用最简变种"**：
- 标题改为 "BasicEngine（验证用最简引擎）"
- 内容不变，只是类名从 `BasicGraphView extends GraphView` 改为 `BasicEngine extends GraphEngine`

---

## C2. 数据模型补表：`graph:[id]` 主表

### 背景

v1.0 第 4.3 节只定义了 `graph_node` / `graph_edge` / `block` 三张表，缺少"图本身"的元数据记录。`loadFromSurreal(graphId)` 的 `graphId` 指向哪张表没有说。

### v1.1 数据模型（替换 v1.0 第 4 节）

#### 4.1 Graph（图主体）

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

#### 4.2 GraphNode（节点）

沿用 v1.0 定义，**但移除 `blockId?`，改为引用数组**（支持单节点挂多 Block 场景，如 BPMN 的"任务 + 审批人"）：

```typescript
interface GraphNode {
  id:        string;
  graphId:   string;             // 属于哪个图（新增：便于查询）
  type:      string;             // 由变种定义
  label:     string;
  blockIds:  string[];           // v1.0 的 blockId 改为数组，允许 0~N 个
  position?: { x: number; y: number };
  canvasPosition?: { x: number; y: number; w: number; h: number; zIndex: number };
  meta?:     Record<string, unknown>;
}
```

> ⚠️ **默认形态**：大多数变种（Knowledge / MindMap）下，一个节点 0 或 1 个 Block，`blockIds` 长度 ≤ 1。多 Block 是为未来 BPMN 等预留能力，v1.1 的 BasicEngine / KnowledgeEngine 实现按单 Block 处理即可。

#### 4.3 GraphEdge（边）

沿用 v1.0 定义，**新增 `graphId` 字段**：

```typescript
interface GraphEdge {
  id:       string;
  graphId:  string;              // 新增
  type:     string;
  source:   string;
  target:   string;
  label?:   string;
  meta?:    Record<string, unknown>;
}
```

#### 4.4 SurrealDB 存储结构（替换 v1.0 第 4.3 节）

```
SurrealDB
    ├── graph:[id]               图主体（新增）
    │     id / title / variant / hostNoteId / createdAt / updatedAt / meta
    │
    ├── graph_node:[id]          节点实体
    │     id / graphId / type / label / blockIds / position / canvasPosition / meta
    │
    ├── graph_edge:[id]          边实体（SurrealDB 原生 RELATE）
    │     id / graphId / type / source / target / label / meta
    │
    └── block:[id]               Block 内容（已存在，独立存储）
          type / content / ...
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

-- 节点写入（可同时引用多个 Block）
CREATE graph_node:concept_ai SET
  graphId  = 'graph:knowledge_001',
  type     = 'concept',
  label    = '人工智能',
  blockIds = ['block:note_xyz', 'block:note_abc'],
  position = { x: 240, y: 120 };

-- 边写入（SurrealDB 原生图关系）
RELATE graph_node:concept_ai -> graph_edge:relates_001 -> graph_node:concept_ml
  SET graphId = 'graph:knowledge_001',
      type    = 'relates_to',
      label   = '包含';
```

---

## C3. 图 ↔ Note 关系 & Block 引用计数

### 背景

v1.0 缺这一块的语义定义。v1.1 采纳方案 C：**图可选绑定 Note，Block 用引用计数决定生命周期**。

### 新增节：4.5 图与 Note 的关系

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

### 新增节：4.6 Block 的归属与引用计数

Block 在系统中有两种逻辑归属，由**数据事实**而非字段标记决定：

| Block 归属 | 判定条件 | 生命周期由谁决定 |
|-----------|---------|---------------|
| **Note 原生 Block** | 该 block:[id] 出现在某个 note 的 atom 树里 | Note（从 atom 树删除时决定） |
| **图节点独占 Block** | 该 block:[id] 不在任何 note 的 atom 树里，仅被 graph_node.blockIds 引用 | 引用计数（图节点解除最后一个引用时决定） |

**引用计数来源**：

```typescript
function getBlockReferenceCount(blockId: string): {
  inNotes:      number;   // 出现在多少个 note 的 atom 树里
  inGraphNodes: number;   // 被多少个 graph_node.blockIds 引用
  total:        number;
}
```

> 反向索引由一张单独的 `block_ref:[blockId]` 表或 SurrealDB 的图关系维护，**不在 block 本身存引用计数**（避免写放大）。具体实现留给 P1 阶段，v1.1 spec 只定语义。

### 节点删除时的 Block 处置

替换 v1.0 第 9 节"SurrealAdapter.deleteNode" 的语义：

```typescript
async deleteNode(nodeId: string, options?: {
  cleanOrphanBlock?: boolean;   // 默认 true，询问用户
}): Promise<{ removedBlockIds: string[] }> {
  // 1. 取出该节点的 blockIds
  // 2. 解除节点对这些 block 的引用
  // 3. 对每个 blockId：
  //    a. 若该 block 还在某个 note 的 atom 树里 → 保留
  //    b. 若 inNotes=0 且 inGraphNodes=0 → 孤儿 block
  //         - options.cleanOrphanBlock=true → 删除
  //         - 否则保留（可后续"垃圾回收"）
  // 4. 删除 graph_node 记录及关联的 graph_edge
  // 5. 返回被删除的 blockIds（用于 UI 提示）
}
```

### Note 内编辑 Block → Graph 节点自动更新

Block 是独立存储（v1.0 已定），NoteView 和 GraphView 都订阅同一个 block:[id]：

```
NoteView 编辑 block:xyz
     ↓
  main 进程 block:update 事件广播
     ↓
  GraphView 订阅者收到
     ↓
  BlockManager 重新渲染对应 CSS2DObject（所有引用该 block 的节点）
```

> 这里的订阅机制需要 main 进程的 BlockStore 支持"引用反向索引"。v1.1 spec 不展开实现，只规定语义：**Block 修改对所有引用方实时可见**。

---

## C4. 默认变种 = Knowledge，变种切换严格模式

### 背景

v1.0 对"用户进入 GraphView 看到什么"没有回答。v1.1 明确：

### 新增节：3.3 默认变种与切换策略

**新建图**：默认 `variant = 'knowledge'`，直接进入 KnowledgeEngine 渲染。

**KnowledgeEngine 默认配置**：

| 配置项 | 值 |
|--------|-----|
| 节点形状 | 圆形（主概念）/ 圆角矩形（实体） |
| 节点尺寸 | 80×80 / 120×60 |
| 默认边类型 | `relates_to` |
| 布局算法 | Force-directed |
| 允许任意节点间连线 | 是 |
| 节点默认挂 Block | 是（单 Block） |

**变种切换（严格模式）**：

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

严格模式规则：

- 若 `blockers.length > 0` → **切换失败**，弹出详情列表，提示用户手动调整或清空后再切换
- 若 `blockers.length === 0` → 切换成功，仅更新 `graph.variant`、重新跑布局、重新渲染节点/边
- 节点/边的**数据不会在切换过程中被修改**，只是换了渲染方式

> 严格模式的代价：用户初期探索时可能频繁遇到"切不过去"。缓解方案留给后续 UX 迭代（如提供"预览切换效果"或"导出为新图"的逃生口），v1.1 spec 不展开。

### 变种注册机制

新增节：3.4 GraphEngine 变种注册

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

对标 [src/main/view/registry.ts](src/main/view/registry.ts) 和 [src/main/workmode/registry.ts](src/main/workmode/registry.ts) 的注册模式。

---

## C5. 新增章节：L5 集成

以下内容作为 **v1.1 的第 12 节** 追加到 Spec 末尾（v1.0 的"实施路线图"节前插入）。

### 12. L5 集成

作为 L5 视图类型，GraphView 必须接入 KRIG 现有的 Shell / Workspace / NavSide / IPC / Workmode 体系。本节列出所有集成点。

#### 12.1 文件与入口

对标 NoteView / EBookView 的组织方式：

| 项 | 路径 | 说明 |
|----|------|------|
| HTML 入口 | `graph.html` | 放在项目根，对标 `note.html` / `ebook.html` |
| Renderer 入口 | `src/plugins/graph/renderer.tsx` | 对标 [src/plugins/note/renderer.tsx](src/plugins/note/renderer.tsx) |
| 根组件 | `src/plugins/graph/components/GraphView.tsx` | L5 视图的 React 根组件 |
| 引擎目录 | `src/plugins/graph/engines/` | 存放 GraphEngine 基类及各变种 |
| Preload | `src/main/preload/view.ts` | 复用统一 View preload（不新增） |
| Vite 配置 | `vite.graph.config.mts` | 独立 bundle（Three.js 不污染其他 View） |

#### 12.2 IPC 通道

前缀 `graph:`，在 `src/shared/types.ts` 的 `IPC.GRAPH_*` 统一定义：

| 通道 | 方向 | 用途 |
|------|------|------|
| `graph:load-graph` | main → graph | 加载指定 graphId 的图数据 |
| `graph:new-graph` | main → graph | 新建空白图（variant='knowledge'） |
| `graph:save-request` | main → graph | 请求保存 |
| `graph:state-changed` | graph → main | 标题 / 保存状态变化 |
| `graph:switch-variant` | graph → main | 请求切换变种（触发兼容性检查） |
| `graph:block-updated` | main → graph | 某个 block:[id] 被外部修改，要求重渲染 |
| `graph:set-host-note` | graph → main | 设置 / 清除 hostNoteId |
| `graph:send-to-ai` | graph → main | 将选中节点/子图发送到 AI（对标 `note:send-to-ai`） |
| `graph:close` | graph ↔ main | 关闭图视图 |

#### 12.3 NavSide 集成

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

#### 12.4 Workmode 注册

```typescript
// src/main/workmode/registry.ts
registerWorkmode({
  id: 'graph',
  name: '图谱',
  defaultLayout: 'graph-only',
  allowedLayouts: ['graph-only', 'graph+note'],
});
```

**Layout Mode 新增**（对标 [docs/视图层级定义.md](docs/视图层级定义.md) § 2.5）：

| Layout Mode | Left Slot | Right Slot | NavMode | 说明 |
|-------------|-----------|-----------|---------|------|
| `graph-only` | GraphView | — | graph | 默认，专注图谱 |
| `graph+note` | GraphView | NoteView | graph | 绑定图（hostNoteId）时自动切到此布局 |

> `note+graph`、`web+graph` 已在视图层级定义 v1.0 中作为二等公民存在，v1.1 不改动。

#### 12.5 Workspace 上限

| View 类型 | 每 Workspace 上限 |
|-----------|------------------|
| GraphView | **1**（变种在视图内切换，不同图通过 NavSide 切换） |

#### 12.6 与其他 View 的互通（跨 View 消息）

所有跨 View 通信经 main 路由，遵循 [docs/视图层级定义.md](docs/视图层级定义.md) § 四：

| 模式 | 源 View | 目标 View | 数据 | 触发 |
|------|---------|----------|------|------|
| **节点内容同步** | NoteView (编辑 Block) | GraphView | block:[id] 更新事件 | Block 改动 |
| **节点内容同步（反向）** | GraphView (编辑节点 Block) | NoteView | block:[id] 更新事件 | Block 改动 |
| **AI 对话** | GraphView | WebView | 选中节点/子图的 Markdown 摘要 | 用户发送 |
| **宿主联动** | GraphView (hostNoteId) | NoteView | 打开 hostNote | 用户点击图属性里的宿主链接 |
| **从 Note 建图** | NoteView | GraphView | 选中的概念/实体 → 新建/添加节点 | 用户 → "提取到图谱" |

#### 12.7 持久化与 Workspace Snapshot

Workspace 切换时，GraphView 的状态随 Workspace 一起隐藏/显示（遵循 L5 生命周期）。

**需在 WorkspaceSnapshot 中记录**：
- 当前打开的 `graphId`
- 视图相机状态（zoom / pan）不持久化到 Snapshot，只在内存
- 选中节点不持久化

**不在 Snapshot 中**：
- 图数据本身（永远从 SurrealDB 读）

---

## C6. 每 Workspace 1 个 GraphView

由 C5 § 12.5 已覆盖。这里补充理由：

- 不同变种的图共享同一个 GraphView 实例，通过变种切换切换渲染
- 不同的图（不同 graphId）通过 NavSide 列表切换，复用同一个 GraphView 实例
- 避免左右双图带来的 UX 复杂度（用户很难同时编辑两张图）

**替代的"对比看图"需求**怎么办？

- 方案 A：两个 Workspace，每个开一张图（推荐）
- 方案 B：未来若有强需求，上限改 2 即可（数据模型不变）

v1.1 按方案 A。

---

## C7. 节点挂 Thought（延后决策）

作为 **Open Question**，v1.1 不定实现，但在数据模型上不阻断：

- `GraphNode.meta` 是 `Record<string, unknown>`，可承载未来的 `thoughtIds`
- Thought 当前锚点类型为 note 的 block 和 ebook 的 highlight（见 [docs/视图层级定义.md](docs/视图层级定义.md) § 3.4）
- 若支持，需新增第三种锚点类型 `graph_node_anchor`

**决策时机**：等 P3 阶段，看 KnowledgeEngine 实际使用中是否有"在节点上做批注"的强需求。

---

## 修订后的实施路线图

替换 v1.0 第 12 节：

| 阶段 | 任务 | 完成标志 |
|------|------|---------|
| **P0** | L5 GraphView 骨架（html / renderer / preload 接入） | 能在 Workspace 打开空白 GraphView |
| **P0** | GraphEngine 父类骨架 + SceneManager | Three.js 场景正常渲染 |
| **P0** | `graph:[id]` 主表 + SurrealAdapter 读写 | 图可新建 / 加载 / 保存 |
| **P0** | NavSide GraphPanel + Workmode 注册 | 用户能从 NavSide 新建和打开图 |
| **P1** | BasicEngine（验证用最简引擎） | 父类接口验证清单全通过（见 v1.0 § 11） |
| **P1** | CSS2DRenderer + BlockManager + 引用计数 | Block 可挂载、可删除孤儿 |
| **P1** | DagreLayout | BasicEngine 默认布局可用 |
| **P1** | LOD 切换 | 缩放时正确降级 |
| **P1** | Block 跨 View 同步（NoteView ↔ GraphView） | Note 编辑 Block 实时反映到图节点 |
| **P2** | KnowledgeEngine（默认变种） | 新建图默认进入 Knowledge，Force-directed 可用 |
| **P2** | InteractionHandler + CommandStack | 拖拽、连线、撤销/重做 |
| **P2** | 变种注册机制 + 严格切换 | 变种可注册、切换兼容性检查可用 |
| **P2** | 图 ↔ Note 绑定（hostNoteId） | `graph+note` 布局可用 |
| **P3** | BPMNEngine / MindMapEngine / ... | 按需实现 |
| **P3** | 节点挂 Thought（如决策通过） | Thought 第三种锚点类型 |

---

## Open Questions（v1.1 未定，留待后续）

1. **节点挂 Thought 的实现时机与语义**（C7）
2. **Block 引用反向索引的具体存储方案**（`block_ref:[id]` 表 vs SurrealDB RELATE vs 内存索引）
3. **孤儿 Block 回收策略**：用户删节点时弹窗询问？还是后台 GC？还是永久保留？
4. **变种切换失败时的 UX 逃生口**：是否提供"克隆为新图并切换"的替代路径
5. **大图性能预算**：节点数 / 边数 / CSS2DObject 上限，超过如何降级（目前只有缩放 LOD，未按节点总数降级）
6. **Three.js bundle 大小控制**：是否用 tree-shaking / 按需加载（尤其 OrbitControls / CSS2DRenderer 等子模块）

---

## 附录：v1.1 讨论决策留痕

| 决策 | 拍板结论 | 日期 |
|------|---------|------|
| 图 ↔ Note 关系 | 方案 C：可选绑定（hostNoteId） | 2026-04-24 |
| 节点删除不删 Block | 引用计数 + 可选清理孤儿 | 2026-04-24 |
| Block 多节点引用 | 支持 | 2026-04-24 |
| Note 编辑 Block → 图节点同步 | 支持，实时 | 2026-04-24 |
| 默认变种 | Knowledge | 2026-04-24 |
| 变种切换策略 | 严格（不兼容时拒绝） | 2026-04-24 |
| 每 Workspace GraphView 数 | 1 | 2026-04-24 |
| 引擎基类命名 | GraphEngine | 2026-04-24 |
| 节点挂 Thought | 延后（P3 再定） | 2026-04-24 |

---

*KRIG Design Spec · GraphView v1.1 Patch · 2026-04-24*
