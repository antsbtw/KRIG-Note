# KRIG 技术规范 · GraphView 父类

> Design Spec v1.0 · 2026

---

## 1. 概述

GraphView 是 KRIG 所有图类型视图的父类，定义通用的渲染、交互、数据和生命周期能力。所有图变种（BPMNView、KnowledgeView、MindMapView 等）均继承自 GraphView，只覆盖自身特有的形状库、布局算法和交互规则。

### 设计原则

| 原则 | 说明 |
|------|------|
| 父类只做通用事 | 渲染循环、节点/边管理、Block 挂载、SurrealDB 读写，全部在父类实现 |
| 变种只覆盖差异 | 形状库、布局算法、交互规则，由子类覆盖 |
| 职责分离 | Three.js 负责空间，KRIG Block 负责内容，SurrealDB 负责持久化 |
| 接口稳定优先 | 父类接口一旦定稳，变种不需要关心底层实现细节 |
| 可测试性 | BasicGraphView 作为最简变种，用于验证父类接口完整性 |

### 变种继承关系

```
GraphView（父类）
    │
    ├── BasicGraphView      ← 最简变种，用于验证父类接口（优先实现）
    ├── BPMNView            ← BPMN 图模板
    ├── KnowledgeView       ← 知识图谱
    ├── MindMapView         ← 思维导图
    ├── TimelineView        ← 时间轴
    └── CanvasView          ← 自由画布
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
GraphView
    ├── SceneManager        三.js 场景、相机、渲染循环
    ├── NodeManager         节点的增删改查、选中状态
    ├── EdgeManager         边的增删改查、路径计算
    ├── BlockManager        CSS2DRenderer 挂载与 LOD 切换
    ├── LayoutEngine        布局算法的统一入口（可插拔）
    ├── SurrealAdapter      SurrealDB 读写接口
    ├── InteractionHandler  鼠标、键盘、触摸事件
    └── LifecycleManager    mount / dispose / resize
```

### 3.2 父类与变种的边界

```typescript
abstract class GraphView {
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
  abstract getShapeLibrary(): ShapeLibrary;     // 形状库
  abstract getLayoutAlgorithm(): LayoutAlgo;   // 布局算法
  abstract getInteractionRules(): InteractionRules; // 交互规则
}
```

---

## 4. 数据模型

### 4.1 GraphNode（节点）

```typescript
interface GraphNode {
  id:       string;           // SurrealDB 实体 ID，如 "graph_node:abc"
  type:     string;           // 由变种定义，如 "task" / "person" / "concept"
  label:    string;           // 节点显示标签
  blockId?: string;           // 关联的 KRIG Block ID（可选）
  position?: {                // 由布局引擎计算后写入，LLM 输入时不提供
    x: number;
    y: number;
  };
  canvasPosition?: {          // Canvas 自由布局时用户手动拖拽的坐标
    x: number;
    y: number;
    w: number;
    h: number;
    zIndex: number;           // 支持未来 CanvasView 的层叠排序
  };
  meta?: Record<string, unknown>; // 变种自定义扩展字段
}
```

### 4.2 GraphEdge（边）

```typescript
interface GraphEdge {
  id:     string;           // SurrealDB 关系 ID
  type:   string;           // 由变种定义，如 "flow" / "relates_to" / "child_of"
  source: string;           // 源节点 ID
  target: string;           // 目标节点 ID
  label?: string;           // 边标签（可选）
  meta?:  Record<string, unknown>; // 变种自定义扩展字段
}
```

### 4.3 SurrealDB 存储结构

图结构数据与 Block 内容数据独立存储，两条写入流互不干扰：

```
SurrealDB
    ├── graph_node:[id]          节点实体
    │     id / type / label / position / canvasPosition / meta
    │
    ├── graph_edge:[id]          边实体（SurrealDB 原生 RELATE）
    │     id / type / source / target / label / meta
    │
    └── block:[id]               Block 内容（独立存储）
          type / content / ...
```

```surql
-- 节点写入示例
CREATE graph_node:task_001 SET
  type     = 'task',
  label    = '审核申请',
  position = { x: 240, y: 120 },
  meta     = { bpmnType: 'bpmn:Task' };

-- 边写入示例（SurrealDB 原生图关系）
RELATE graph_node:start_001 -> graph_edge:flow_001 -> graph_node:task_001
  SET type = 'flow', label = '';

-- 节点关联 Block
UPDATE graph_node:task_001 SET blockId = 'block:note_xyz';
```

---

## 5. 渲染层设计

### 5.1 相机选型

GraphView 使用**正交相机（OrthographicCamera）**，不使用透视相机：

```typescript
// 正交相机：图的节点大小不随距离变化，符合流程图 / 图谱的认知习惯
const camera = new THREE.OrthographicCamera(
  -width / 2, width / 2,
  height / 2, -height / 2,
  0.1, 1000
);
camera.position.set(0, 0, 100);
```

> 透视相机留给 3D 场景，GraphView 是 2.5D（平面图 + 深度层叠），正交相机是正确选择。

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
// 两个渲染器共享同一个 container，CSS2DRenderer 绝对定位覆盖在上方
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
// 监听相机缩放，触发 LOD 切换
controls.addEventListener('change', () => {
  const zoom = camera.zoom;
  blockManager.setLOD(zoom);
});
```

### 5.4 节点形状库接口（ShapeLibrary）

父类定义接口，变种实现具体形状：

```typescript
interface ShapeLibrary {
  // 根据节点类型创建 Three.js Mesh
  createShape(node: GraphNode): THREE.Mesh;
  // 节点选中时的高亮效果
  applyHighlight(mesh: THREE.Mesh, selected: boolean): void;
  // 节点尺寸（用于布局计算）
  getNodeSize(type: string): { width: number; height: number };
}

// BasicGraphView 的最简实现示例
class BasicShapeLibrary implements ShapeLibrary {
  createShape(node: GraphNode): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(30, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0x2D7FF9 });
    return new THREE.Mesh(geometry, material);
  }
  // ...
}
```

---

## 6. 布局引擎（LayoutEngine）

### 6.1 可插拔接口

```typescript
interface LayoutAlgo {
  name: string;
  // 输入节点和边（无坐标），输出带坐标的节点
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
| BasicGraphView | Dagre | 验证用 |
| BPMNView | Dagre（LR / TB 可选） | 流程图从左到右 |
| KnowledgeView | Force-directed | 关系网络自然聚类 |
| MindMapView | Tree | 层级发散 |
| TimelineView | 线性（自定义） | 时间轴从左到右 |
| CanvasView | 无（手动拖拽） | 用户自由摆放 |

---

## 7. Block 挂载（BlockManager）

### 7.1 挂载原理

```typescript
class BlockManager {
  private css2dRenderer: CSS2DRenderer;
  private mountedBlocks: Map<string, CSS2DObject> = new Map();

  // 将 KRIG Block 挂载到 Three.js 节点上
  mount(nodeId: string, blockId: string, mesh: THREE.Mesh): void {
    const container = document.createElement('div');
    container.className = 'krig-block-overlay';

    // 在 container 内渲染 React Block 组件
    ReactDOM.createRoot(container).render(
      <BlockRenderer blockId={blockId} mode="preview" />
    );

    const css2dObj = new CSS2DObject(container);
    mesh.add(css2dObj);
    this.mountedBlocks.set(nodeId, css2dObj);
  }

  unmount(nodeId: string): void {
    const obj = this.mountedBlocks.get(nodeId);
    if (obj) {
      obj.element.remove();
      obj.parent?.remove(obj);
      this.mountedBlocks.delete(nodeId);
    }
  }

  // LOD 切换
  setLOD(zoom: number): void {
    this.mountedBlocks.forEach((obj, nodeId) => {
      if (zoom > 0.8)       obj.element.dataset.mode = 'full';
      else if (zoom > 0.4)  obj.element.dataset.mode = 'summary';
      else                  obj.element.style.display = 'none';
    });
  }
}
```

### 7.2 坐标同步注意事项

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
  // 两个节点类型之间是否允许连线
  canConnect(sourceType: string, targetType: string): boolean;
  // 节点是否允许挂载 Block
  canAttachBlock(nodeType: string): boolean;
  // 节点是否允许被删除
  canDelete(nodeType: string): boolean;
  // 节点被双击时的行为
  onDoubleClick(node: GraphNode): void;
}
```

### 8.2 父类默认交互

父类实现以下通用交互，变种可覆盖：

| 交互 | 默认行为 |
|------|---------|
| 单击节点 | 选中，高亮显示 |
| 双击节点 | 展开 Block 编辑界面 |
| 拖拽节点 | 更新 canvasPosition，实时重绘相关边 |
| 滚轮 | 缩放，触发 LOD 切换 |
| 中键拖拽 | 平移画布 |
| 节点连接点拖拽 | 创建新边（调用 canConnect 校验） |
| Delete 键 | 删除选中节点或边 |
| Ctrl+Z | 撤销（CommandStack） |

### 8.3 CommandStack（撤销/重做）

所有编辑操作通过 CommandStack 执行，保证撤销/重做能力：

```typescript
interface Command {
  execute(): void;
  undo(): void;
}

class AddNodeCommand implements Command {
  constructor(private view: GraphView, private node: GraphNode) {}
  execute() { this.view.addNode(this.node); }
  undo()    { this.view.removeNode(this.node.id); }
}
```

---

## 9. SurrealAdapter（数据层）

### 9.1 接口定义

```typescript
class SurrealAdapter {
  // 加载图数据（节点 + 边）
  async loadGraph(graphId: string): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }> { ... }

  // 保存节点
  async saveNode(node: GraphNode): Promise<void> { ... }

  // 保存边
  async saveEdge(edge: GraphEdge): Promise<void> { ... }

  // 删除节点（级联删除相关边）
  async deleteNode(id: string): Promise<void> { ... }

  // 删除边
  async deleteEdge(id: string): Promise<void> { ... }

  // 批量保存（编辑完成时调用）
  async saveAll(nodes: GraphNode[], edges: GraphEdge[]): Promise<void> { ... }
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
const view = new BPMNView();       // 创建变种实例

view.mount(containerElement);      // 挂载到 DOM，初始化 Three.js 场景
await view.loadFromSurreal(id);    // 从 SurrealDB 加载图数据
view.runLayout();                  // 执行布局算法，计算节点坐标

// ... 用户交互 ...

await view.saveToSurreal();        // 保存到 SurrealDB
view.dispose();                    // 销毁，清理 Three.js 资源和 DOM
```

### 生命周期钩子

```typescript
abstract class GraphView {
  // 变种可选覆盖的钩子
  protected onBeforeMount(): void {}
  protected onAfterMount(): void {}
  protected onBeforeDispose(): void {}
  protected onNodeAdded(node: GraphNode): void {}
  protected onEdgeAdded(edge: GraphEdge): void {}
  protected onLayoutComplete(): void {}
}
```

---

## 11. BasicGraphView（验证用最简变种）

BasicGraphView 是第一个实现的变种，目的是验证父类接口的完整性，不承担任何业务语义。

```typescript
class BasicGraphView extends GraphView {

  getShapeLibrary(): ShapeLibrary {
    return {
      createShape(node) {
        // 所有节点统一渲染为蓝色圆形
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
      canConnect: () => true,         // 任意节点之间可连线
      canAttachBlock: () => true,     // 任意节点可挂载 Block
      canDelete: () => true,          // 任意节点可删除
      onDoubleClick: (node) => {
        // 展开 Block 编辑
      }
    };
  }
}
```

### BasicGraphView 验证清单

BasicGraphView 跑通以下所有场景，才视为 GraphView 父类接口完整：

- [ ] mount / dispose / resize 生命周期正常
- [ ] 节点增删、选中、高亮
- [ ] 边增删、路径渲染
- [ ] Dagre 布局自动计算坐标
- [ ] CSS2DRenderer Block 挂载与卸载
- [ ] LOD 缩放切换（full / summary / hidden）
- [ ] 节点拖拽 + canvasPosition 更新
- [ ] SurrealDB 加载与保存
- [ ] CommandStack 撤销/重做
- [ ] 坐标同步（Three.js 世界坐标 vs DOM）

---

## 12. 实施路线图

| 阶段 | 任务 | 完成标志 |
|------|------|---------|
| P0 | GraphView 父类骨架 | 接口定义完成，可被继承 |
| P0 | SceneManager + 渲染循环 | Three.js 场景正常渲染 |
| P0 | NodeManager + EdgeManager | 节点和边可增删渲染 |
| P1 | CSS2DRenderer + BlockManager | Block 可挂载到节点 |
| P1 | LOD 切换 | 缩放时正确切换渲染策略 |
| P1 | DagreLayout | 自动布局正常运行 |
| P1 | SurrealAdapter | 图数据可读写 |
| P2 | InteractionHandler | 拖拽、选中、连线交互 |
| P2 | CommandStack | 撤销/重做正常 |
| P2 | BasicGraphView 验证清单全部通过 | **GraphView 父类定稳** |
| P3 | BPMNView | 在已验证父类上实现 BPMN 变种 |

---

*KRIG Design Spec v1.0 · GraphView · 2026*
