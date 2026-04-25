# KRIG GraphView Spec v1.2 修订提案（Patch）

> 基于 v1.1（`KRIG_GraphView_Spec_v1.1.md`）的进一步澄清。
> 本文件为 **Diff 补丁稿**，不直接覆盖 v1.1。待你 review 通过后再合并为 v1.2 完整版。
>
> 讨论对齐日期：2026-04-25
> 修订作者：wenwu + Claude

---

## 0. 修订背景

P1 阶段实施过程中，讨论"节点显示文字 / 编辑能力"时浮现出一个**根本性的设计哲学**，原 spec v1.1 没有讲清楚，导致工程方向反复横跳。本次修订把这个哲学固化下来。

**触发本次修订的关键对话**（2026-04-25）：

> 用户：「凡是编辑的地方，都应该和 note block 结合，能够使用所有类型的 note block」
>
> Claude（误判）：以为需要先做"独立 block 实体 + 引用计数"重构，估算 8~10 天工程
>
> 用户：「block 的渲染不是已经完成了吗？图展示就做图展示的工作好了」
>
> 用户：「note 是文本记录和表达的手段，Graph 是图的表达手段。Graph 只负责图方面的实现和表达，必须结合 note 才能完整地构建图谱的功能。Graph Atom = 图属性 + Note Atom 做持久化」

这两句话彻底澄清了 GraphView 与 Note 的关系，并揭示了 v1.1 § 4.6 描述的"独立 block 实体"是**理想态而非现状**，强行实现会引入巨大成本且对当前价值无增益。

---

## 1. 核心修订：产品哲学

### 1.1 Graph 与 Note 的职责分离（NEW）

| 视图 | 负责的表达手段 |
|------|---------------|
| **NoteView** | **内容表达**：文字、公式、代码、图片、表格、列表 = 任意 Block 类型的有序文档 |
| **GraphView** | **结构表达**：节点、关系、布局、视图 = 几何位置 + 拓扑连接 |

**两者关系**：

- 平等、互补、不互相替代
- **GraphView 必须结合 Note 才完整** —— Graph 不重新发明任何文本/富内容表达能力
- 凡是涉及文字 / 富内容的场景，**直接复用 Note 的 Block 体系**（schema、渲染、编辑）

### 1.2 Graph Atom = 图属性 + Note Atom（NEW）

GraphView 的核心数据形态：

```
GraphNode = 图独有属性 + Note Atom
            ↓
            位置 / 类型 / id  +  内容（Atom[]）
            └─ Graph 贡献 ─┘  └─── 直接是 Note 的格式 ───┘

GraphEdge = 图独有属性 + Note Atom
            ↓
            source / target / id  +  内容（Atom[]）
            └─── Graph 贡献 ─┘    └─ 直接是 Note 的格式 ─┘
```

**含义**：

- GraphView **不创造**新的内容数据格式
- 节点 label / 边 label 都是 `Atom[]`（与 Note 的 `note.doc_content` 同形态）
- 用户在节点 label 里能写任意 Block 类型：textBlock / mathBlock / codeBlock / bulletList / 表格 / ...
- 编辑器复用 Note 的 ProseMirror schema（`blockRegistry.buildSchema()`）

### 1.3 设计原则的延伸

v1.1 § 1.2 已有的"职责分离"原则在此扩展为：

| 原则 | v1.1 描述 | v1.2 补充 |
|------|---------|---------|
| 职责分离 | Three.js 负责空间，KRIG Block 负责内容，SurrealDB 负责持久化 | 增加："**Note 负责内容定义、Graph 负责结构定义**。Graph 不重新实现任何内容能力。" |

---

## 2. 数据模型的精确化

### 2.1 GraphNode（修订 v1.1 § 4.2）

**v1.1 原文**：

```typescript
interface GraphNode {
  // ...
  blockIds: string[];   // 关联的 KRIG Block ID 列表（0~N）
  // ...
}
```

**v1.2 修订**：

```typescript
interface GraphNode {
  id: string;
  graphId: string;
  type: string;
  position: { x: number; y: number };
  canvasPosition?: { x: number; y: number; w: number; h: number; zIndex: number };

  // ── 内容（直接复用 Note 的 Atom 数据形态）──
  label: Atom[];   // ProseMirror node JSON 数组，与 note.doc_content 同形态

  meta?: Record<string, unknown>;
}

// Atom 类型直接来自 Note 系统（不重新定义）
type Atom = unknown;  // 实际是 ProseMirror node JSON：{ type, content, attrs, marks }
```

**关键变更**：

- ❌ 删除 `blockIds: string[]`（引用独立 block 实体）
- ✅ 改为 `label: Atom[]`（atom 数组直接内联）
- 默认值：`[{ type: 'textBlock', content: [{ type: 'text', text: '...' }] }]`（一个 textBlock）

### 2.2 GraphEdge（修订 v1.1 § 4.3）

**v1.1 原文**：

```typescript
interface GraphEdge {
  // ...
  label?: string;
  // ...
}
```

**v1.2 修订**：

```typescript
interface GraphEdge {
  id: string;
  graphId: string;
  type?: string;
  source: string;
  target: string;
  label: Atom[];   // 同 GraphNode.label，可写任意 Block 类型
  meta?: Record<string, unknown>;
}
```

### 2.3 SurrealDB 存储结构（修订 v1.1 § 4.4）

**v1.1 原文**：

```
SurrealDB
    ├── graph:[id]
    ├── graph_node:[id]      blockIds（引用 block:[id]）
    ├── graph_edge:[id]
    └── block:[id]           Block 内容（独立存储，已存在）  ← 注：实际未实现
```

**v1.2 修订**：

```
SurrealDB
    ├── graph:[id]
    ├── graph_node:[id]      label 字段直接存 Atom[]（schemaless JSON）
    ├── graph_edge:[id]      label 字段直接存 Atom[]
    └── note:[id]            doc_content 字段存 Atom[]（已存在）

注：
- 不存在独立的 block:[id] 表
- 节点 label / 边 label / Note doc_content 都是同样的 Atom 数据形态
- 三者在 schemaless 字段中独立存储，互不引用
```

---

## 3. v1.1 § 4.6 / 4.7 / 4.8 的处置

v1.1 § 4.6 描述了"Block 独立存储 + 引用计数 + 跨 View 同步"的体系。这一节描述的是**未来理想态**，本次 v1.2 把它从"当前规范"降级为"未来路线"，避免误导实施。

### 3.1 v1.1 § 4.6 "Block 的归属与引用计数" 的处置

**当前（v1.2）状态**：
- Block（atom）是 **note.doc_content 内联数组的成员** 或 **graph_node.label 内联数组的成员**
- **不存在独立的 block:[id] 实体**
- 不需要引用计数机制（atom 不能被跨实体引用）
- 节点 label 改了，不影响任何 note；note 改了 block，不影响任何节点

**未来（spec 路线 P3 阶段）**：
- 当 KRIG 整体决定升级到"独立 block 实体"时（这是跨整个项目的大重构，超出 GraphView 范围），spec § 4.6 的引用计数体系才有意义
- 那时 GraphNode.label 自然从 Atom[] 升级为 BlockId[]，spec § 4.8 的跨 View 同步自动可用
- 该升级不是 GraphView 单独能做的事，与 Note 系统协同推进

### 3.2 v1.1 § 4.7 "节点删除时的 Block 处置" 的处置

**当前（v1.2）状态**：
- 节点删除 = `node.label`（atom 数组）随节点一起删除
- 没有"孤儿 block"问题
- 没有引用计数处置流程

**未来路线**：同 § 3.1。

### 3.3 v1.1 § 4.8 "Note 内编辑 Block → Graph 节点自动更新" 的处置

**当前（v1.2）状态**：
- 不实现这种联动
- NoteView 改 doc_content，GraphView 节点不变
- GraphView 改节点 label，NoteView 不变
- 这是**正确的**：当前 atom 内联模型下，两边的 atom 是各自独立的副本

**未来路线**：同 § 3.1。当 atom 升级为独立 block 实体后，跨 View 同步通过订阅 `block:[id]` 实现。

---

## 4. v1.1 § 7 BlockManager 的简化

v1.1 § 7.1 设计的 BlockManager 假设节点持有 `blockIds`，从独立 block 实体加载内容渲染。v1.2 简化为直接渲染 atom 数组：

### 4.1 简化后的 NodeContentRenderer（替代 BlockManager）

```typescript
class NodeContentRenderer {
  private mountedNodes = new Map<string, CSS2DObject>();

  /** 渲染 atom 数组到节点上 */
  mount(nodeId: string, atoms: Atom[], mesh: THREE.Mesh): void {
    const container = document.createElement('div');
    container.className = 'krig-graph-node-content';

    // 用 readonly ProseMirror EditorView 渲染 atoms
    // schema 直接复用 NoteView 的 blockRegistry
    renderAtomsReadonly(container, atoms);

    const obj = new CSS2DObject(container);
    mesh.add(obj);
    this.mountedNodes.set(nodeId, obj);
  }

  /** 节点 label 内容变化时调用 */
  update(nodeId: string, atoms: Atom[]): void {
    const obj = this.mountedNodes.get(nodeId);
    if (!obj) return;
    renderAtomsReadonly(obj.element, atoms);
  }

  unmount(nodeId: string): void {
    // 清理逻辑
  }
}
```

### 4.2 关键变更

- ❌ 不再有 `BlockManager.mount(nodeId, blockIds, mesh)` 形态
- ✅ 改为 `NodeContentRenderer.mount(nodeId, atoms, mesh)`：直接消费 atom 数组
- ❌ 删除 `BlockCapacity` 概念（'none' / 'single' / 'multiple'）—— 节点 label 总是一个 atom 数组，无须分类
- ❌ 删除 v1.1 § 3.2 抽象方法 `getBlockCapacity()`

### 4.3 LOD 策略保留

v1.1 § 5.3 / § 7.1 的 LOD 策略仍然适用，但渲染方式简化：

| 缩放级别 | 渲染策略 |
|---------|---------|
| > 0.8 | 完整渲染整个 atom 数组（含 mathBlock / codeBlock 等所有 Block） |
| 0.4 ~ 0.8 | 只渲染 atom 数组的第一个 textBlock（标题样） |
| < 0.4 | 隐藏 DOM，只剩节点圆 |
| < 0.15 | 鸟瞰，只剩点 |

---

## 5. v1.1 § 3.3 "BlockCapacity" 的处置

v1.1 § 3.3 给每个 Engine 变种定义了 `getBlockCapacity()` 返回 `'none' | 'single' | 'multiple'`。

v1.2 删除这个概念。理由：

- 节点 label 总是一个 atom 数组（可空、可单 Block、可多 Block）
- "BPMN 网关不挂 Block" 改为：BPMN 网关节点的 label 是空 atom 数组 `[]`
- "BPMN 任务挂多 Block" 改为：BPMN 任务节点的 label 是多 Block 的 atom 数组
- 用统一形态表达所有情况，不需要枚举类型

→ v1.1 § 3.2 抽象类的 `abstract getBlockCapacity()` 删除。

---

## 6. 编辑器复用方案

v1.2 明确规定 GraphView 编辑节点/边内容时**完全复用 NoteView 的 ProseMirror 配置**，不实现简化版编辑器。

### 6.1 复用对象

```typescript
// 来自 src/plugins/note/registry.ts 的 public exports
import { blockRegistry } from '@/plugins/note/registry';
import { registerAllBlocks } from '@/plugins/note/blocks';

// 在 GraphView 内部初始化（一次性）
function getGraphSchema() {
  registerAllBlocks();          // 同 NoteEditor 的初始化
  return blockRegistry.buildSchema();
}
```

### 6.2 不复用对象

- `NoteEditor.tsx` 这个 React 组件不直接复用（它绑定到 noteId 数据流、含 thoughtPlugin / titleGuard / aiSync 等 GraphView 不需要的能力）
- GraphView 自己 new EditorState / EditorView，配置精简的 plugin 列表
- 可使用 `variant: 'thought'` 这种已存在的"无 noteTitle / 无 thoughtPlugin"配置作为参考

### 6.3 编辑入口

按 v1.1 + 用户后续需求，编辑入口要支持多 surface：

| Surface | 触发方式 | 实现 |
|---------|---------|------|
| Context Menu | 右键节点 → "编辑内容" | 弹出小窗口运行 ProseMirror |
| Double Click | 双击节点 label | 同上 |
| Keyboard | 选中节点按 F2 | 同上 |
| Slash Menu | 节点编辑器内输入 `/` | 复用 NoteView 的 SlashMenu |

→ Block 编辑能力一旦在 GraphView 中可用，所有 surface 都能调用。

---

## 7. 修订后的实施路线图（覆盖 v1.1 § 13）

### 已完成（保持不变）

P0 全部 + P1.1~1.7 已完成（见 v1.1 § 13）。

### v1.2 新增 / 调整的 P1 后段任务

| 阶段 | 任务 | 完成标志 |
|------|------|---------|
| **P1 第一段 v1.2**（新） | 节点 label 数据模型从 string 升级到 Atom[] + 持久化适配 + 老数据兼容 | 已有图加载后 label 正确显示 |
| **P1 第一段 v1.2**（新） | NodeContentRenderer：用 readonly ProseMirror 把 atom 数组渲染到 CSS2DObject 的 div 中 | 节点显示富内容（默认是 textBlock 单行） |
| **P1 第二段 v1.2** | 节点编辑器：双击节点弹出可编辑 ProseMirror，复用 blockRegistry.buildSchema() | 用户能在节点里写 mathBlock / codeBlock / bulletList |
| **P1 第二段 v1.2** | 边 label 同样升级为 Atom[] | 边 label 能写公式 / 富文本 |
| **P1 第三段 v1.2** | 注册制 + Context Menu surface | 右键菜单按 surface 注册项目动态生成 |
| **P1 第三段 v1.2** | 基本操作：选中边 / 复制 / 粘贴 / 删除 / 编辑 / 编辑属性 | 所有"基本操作"通过统一注册体系暴露 |

### v1.1 § 13 中废弃 / 推迟的任务

| 任务 | v1.1 状态 | v1.2 处置 |
|------|---------|---------|
| BlockManager（CSS2DRenderer 挂载 blockIds） | P1 任务 | 替换为 NodeContentRenderer，处理 atom 数组 |
| Block 引用计数 | P1 任务 | 推迟到 KRIG 整体的 Block 独立化重构（超出 GraphView 范围） |
| 删除节点处理孤儿 Block | P1 任务 | 当前不存在孤儿（atom 内联），无需处理 |
| 跨 View 同步 | P1 任务 | 推迟到 Block 独立化后 |
| `getBlockCapacity()` 抽象方法 | P1 任务 | 删除该概念 |

---

## 8. Open Questions（v1.2 未定）

| # | 问题 | 计划阶段 |
|---|------|---------|
| 1 | KRIG 整体是否升级到独立 block 实体？时机？ | 未定，超出 GraphView 范围 |
| 2 | 节点挂 Thought | P3，与 v1.1 一致 |
| 3 | 大图性能预算 | P3，与 v1.1 一致 |

---

## 9. 决策留痕（v1.2 新增）

| 决策 | 拍板结论 | 日期 |
|------|---------|------|
| Graph 与 Note 的关系 | 平等 + 互补，Graph 不重造内容能力 | 2026-04-25 |
| GraphNode.label 数据形态 | Atom[] 内联，不引用独立 block 实体 | 2026-04-25 |
| GraphEdge.label 数据形态 | Atom[]，与节点同形态 | 2026-04-25 |
| BlockCapacity 概念 | 删除 | 2026-04-25 |
| NodeContentRenderer 渲染 | 直接消费 atom 数组，复用 blockRegistry schema | 2026-04-25 |
| NoteEditor 组件复用 | 不直接复用组件，复用其 schema/blockRegistry | 2026-04-25 |
| 跨 View 同步 | 推迟到 Block 独立化重构（超出 GraphView） | 2026-04-25 |

---

## 10. 与 v1.1 patch 的关系

v1.1 patch 文档中的"实施期间发现的架构债"节继续有效，v1.2 不重复登记。

新登记的架构债务：

- **v1.1 § 4.6 / 4.7 / 4.8 已写入 spec 但未实施**：本次 v1.2 把它们从"现行规范"降级为"未来路线"。Future spec readers 看到这些章节时应记得它们是 **v1.0 时期的理想态草案**，不是当前实现规范。

---

*KRIG Design Spec · GraphView v1.2 Patch · 2026-04-25*
