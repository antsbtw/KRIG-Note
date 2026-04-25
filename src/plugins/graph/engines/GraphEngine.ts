import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ViewportController } from './ViewportController';
import { InteractionController } from './InteractionController';
import { CommandStack, type Command } from './CommandStack';
import { NodeContentRenderer } from './NodeContentRenderer';

/**
 * GraphEngine — L5 GraphView 内部的渲染引擎抽象基类
 *
 * 提供：
 * - Three.js 场景 / 相机 / 渲染循环 / 节点-边渲染
 * - ViewportController：滚轮缩放 + 中右键平移
 * - InteractionController：左键拾取 → 点击选中 / 拖动节点 / 拖出新边
 * - CommandStack：所有数据变更走 Command，支持 undo/redo
 *
 * 数据持久化（SurrealDB）由外层 GraphView 通过 onChange 回调对接。
 */

// ── 数据模型 ──
// spec v1.2 § 4.2 / 4.3：label 从 string 升级为 Atom[]，复用 Note 的内容数据形态。
// Atom 即 ProseMirror node JSON：{ type, content?, attrs?, marks?, text? }

/** Atom = ProseMirror node JSON。直接复用 Note 的 doc_content 元素形态。 */
export type Atom = unknown;

export interface GraphNode {
  id: string;
  type: string;
  label: Atom[];   // atom 数组，默认形态：[{ type: 'textBlock', content: [{ type: 'text', text: '...' }] }]
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: Atom[];   // 同 GraphNode.label
}

// ── Atom 工具函数 ──

/** 创建一个只含纯文本的 textBlock atom（默认节点/边 label 形态） */
export function makeTextLabel(text: string): Atom[] {
  if (!text) return [{ type: 'textBlock', content: [] }];
  return [{ type: 'textBlock', content: [{ type: 'text', text }] }];
}

/** 从 atom 数组提取纯文本（用于 fallback 显示 / debug） */
export function extractPlainText(atoms: Atom[] | undefined | null): string {
  if (!atoms || !Array.isArray(atoms)) return '';
  const out: string[] = [];
  function walk(node: any): void {
    if (!node) return;
    if (typeof node === 'string') { out.push(node); return; }
    if (typeof node.text === 'string') out.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  }
  atoms.forEach(walk);
  return out.join('');
}

/** 把任意输入归一化为合法 atom 数组。老数据兼容：string → textBlock atom */
export function ensureAtomLabel(value: unknown): Atom[] {
  if (Array.isArray(value)) return value as Atom[];
  if (typeof value === 'string') return makeTextLabel(value);
  return makeTextLabel('');
}

// ── 引擎接口 ──

export interface ShapeLibrary {
  createShape(node: GraphNode): THREE.Mesh;
  applyHighlight(mesh: THREE.Mesh, selected: boolean): void;
  getNodeSize(type: string): { width: number; height: number };
}

export interface LayoutAlgo {
  name: string;
  compute(
    nodes: GraphNode[],
    edges: GraphEdge[],
    shapeLib: ShapeLibrary,
  ): Promise<Map<string, { x: number; y: number }>>;
}

// ── 基类 ──

export abstract class GraphEngine {
  protected scene: THREE.Scene;
  protected camera: THREE.OrthographicCamera;
  protected renderer: THREE.WebGLRenderer;
  protected css2dRenderer: CSS2DRenderer;
  protected container: HTMLElement | null = null;
  protected animationId: number | null = null;

  protected nodeMeshes = new Map<string, THREE.Mesh>();
  protected edgeLines = new Map<string, THREE.Group>();
  /** spec v1.2 § 7：节点 / 边的 atom 数组渲染器（复用 NoteView blockRegistry schema） */
  protected contentRenderer = new NodeContentRenderer();

  protected nodes: GraphNode[] = [];
  protected edges: GraphEdge[] = [];

  protected shapeLib: ShapeLibrary;
  protected layout: LayoutAlgo;

  protected viewport: ViewportController | null = null;
  protected interaction: InteractionController | null = null;
  protected commandStack = new CommandStack();

  protected selectedId: string | null = null;

  /** 数据变更回调（外层接 SurrealDB） */
  onChange: ((event: ChangeEvent) => void) | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e1e);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.set(0, 0, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });

    this.css2dRenderer = new CSS2DRenderer();
    // CSS2DRenderer 的 dom 是 div，需要绝对定位覆盖在 webgl canvas 上，
    // 但不能拦截鼠标事件（让 wheel/click 正常落到 webgl canvas）
    const css2dDom = this.css2dRenderer.domElement;
    css2dDom.style.position = 'absolute';
    css2dDom.style.top = '0';
    css2dDom.style.left = '0';
    css2dDom.style.pointerEvents = 'none';

    this.shapeLib = this.getShapeLibrary();
    this.layout = this.getLayoutAlgorithm();
  }

  // ── 变种必须实现 ──
  abstract getShapeLibrary(): ShapeLibrary;
  abstract getLayoutAlgorithm(): LayoutAlgo;

  // ── 生命周期 ──

  mount(container: HTMLElement): void {
    this.container = container;
    // container 必须 position:relative 让 CSS2DRenderer 的绝对定位生效
    if (!container.style.position) container.style.position = 'relative';
    container.appendChild(this.renderer.domElement);
    container.appendChild(this.css2dRenderer.domElement);
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    this.resize(w, h);
    this.startRenderLoop();

    // 安装控制器
    this.viewport = new ViewportController(this.camera, this.renderer.domElement);
    this.interaction = new InteractionController(
      this.renderer.domElement,
      this.camera,
      this.scene,
      this.viewport,
      () => this.nodeMeshes,
      (mesh) => this.getMeshRadius(mesh),
      {
        onNodeDragStart: () => { /* 拖动 preview，无需特殊处理 */ },
        onNodeDragMove: (id, x, y) => this.previewNodePosition(id, x, y),
        onNodeDragEnd: (id, fromX, fromY, toX, toY) => {
          // 起点和终点几乎相同时不入栈（避免无意义的"移动 0 像素"撤销项）
          if (Math.hypot(toX - fromX, toY - fromY) < 1) return;
          // execute 而非 push：execute 会调 applyNodePosition 触发
          // onChange('node-moved') 落库；preview 期间 mesh 已就位，
          // applyNodePosition 内部只是把 nodes[].position 同步并重算边
          this.commandStack.execute(new MoveNodeCommand(this, id, fromX, fromY, toX, toY));
        },
        onSelect: (id) => this.setSelected(id),
        onEdgeCreate: (sourceId, targetId) => this.addEdgeBySource(sourceId, targetId),
      },
    );
    this.viewport.attach();
    this.interaction.attach();
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.interaction?.detach();
    this.viewport?.detach();
    this.clearScene();
    this.renderer.dispose();
    if (this.container) {
      if (this.renderer.domElement.parentElement === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
      if (this.css2dRenderer.domElement.parentElement === this.container) {
        this.container.removeChild(this.css2dRenderer.domElement);
      }
    }
    this.container = null;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    this.css2dRenderer.setSize(width, height);
  }

  // ── 数据查询 ──

  getNodes(): readonly GraphNode[] { return this.nodes; }
  getEdges(): readonly GraphEdge[] { return this.edges; }
  getSelected(): string | null { return this.selectedId; }
  canUndo(): boolean { return this.commandStack.canUndo(); }
  canRedo(): boolean { return this.commandStack.canRedo(); }

  // ── 数据写入（不走 Command，给 Command 内部用 + 初始加载用） ──

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.clearScene();
    this.nodes = [...nodes];
    this.edges = [...edges];
    this.selectedId = null;
    this.commandStack.clear();
  }

  /** 跑布局算法把节点坐标算出来，再渲染 */
  async runLayout(): Promise<void> {
    const positions = await this.layout.compute(this.nodes, this.edges, this.shapeLib);
    for (const node of this.nodes) {
      const pos = positions.get(node.id);
      if (pos) node.position = pos;
    }
    this.rerender();
  }

  // ── 公开 mutate API（外部调用走 Command） ──

  /** 在世界坐标 (x, y) 添加一个节点（自增 id），入 Command 栈 */
  createNodeAt(x: number, y: number, labelText?: string): string {
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const node: GraphNode = {
      id,
      type: 'concept',
      label: makeTextLabel(labelText ?? '新节点'),
      position: { x, y },
    };
    this.commandStack.execute(new AddNodeCommand(this, node));
    return id;
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    const id = this.selectedId;
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    // 找出关联的边（都要一起删除以维持图完整性）
    const relatedEdges = this.edges.filter((e) => e.source === id || e.target === id);
    this.commandStack.execute(new RemoveNodeCommand(this, node, relatedEdges));
    this.selectedId = null;
  }

  /** 改节点 label（Atom[] 形态），入 Command 栈 */
  setNodeLabel(id: string, label: Atom[]): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    // 浅比较：JSON 序列化对比足够（atom 数组结构有限）
    if (JSON.stringify(node.label) === JSON.stringify(label)) return;
    this.commandStack.execute(new SetNodeLabelCommand(this, id, node.label, label));
  }

  /** 便捷方法：用纯文本设置节点 label（封装为 textBlock atom） */
  setNodeLabelText(id: string, text: string): void {
    this.setNodeLabel(id, makeTextLabel(text));
  }

  /** 改边 label（Atom[] 形态），入 Command 栈 */
  setEdgeLabel(id: string, label: Atom[]): void {
    const edge = this.edges.find((e) => e.id === id);
    if (!edge) return;
    const oldLabel = edge.label ?? [];
    if (JSON.stringify(oldLabel) === JSON.stringify(label)) return;
    this.commandStack.execute(new SetEdgeLabelCommand(this, id, oldLabel, label));
  }

  /** 便捷方法：用纯文本设置边 label */
  setEdgeLabelText(id: string, text: string): void {
    this.setEdgeLabel(id, makeTextLabel(text));
  }

  /** 临时隐藏节点 label（编辑时用，避免和 input 重叠） */
  setNodeLabelVisible(id: string, visible: boolean): void {
    this.contentRenderer.setNodeLabelVisible(id, visible);
  }

  /** 临时隐藏边 label */
  setEdgeLabelVisible(id: string, visible: boolean): void {
    this.contentRenderer.setEdgeLabelVisible(id, visible);
  }

  /** 获取节点 label DOM（GraphView 双击编辑时用） */
  getNodeLabelElement(id: string): HTMLElement | null {
    return this.contentRenderer.getNodeLabelElement(id);
  }

  /** 获取边 label DOM */
  getEdgeLabelElement(id: string): HTMLElement | null {
    return this.contentRenderer.getEdgeLabelElement(id);
  }

  undo(): void {
    if (this.commandStack.undo()) {
      this.rerender();
      this.applySelectionHighlight();
    }
  }

  redo(): void {
    if (this.commandStack.redo()) {
      this.rerender();
      this.applySelectionHighlight();
    }
  }

  resetView(): void {
    this.viewport?.reset();
  }

  // ── 选中状态 ──

  protected setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.applySelectionHighlight();
    this.onChange?.({ type: 'selection', selectedId: id });
  }

  protected applySelectionHighlight(): void {
    for (const [nodeId, mesh] of this.nodeMeshes) {
      this.shapeLib.applyHighlight(mesh, nodeId === this.selectedId);
    }
  }

  // ── 内部：节点拖拽 preview / 边创建 ──

  /** 拖动 preview 期间实时更新 mesh 位置 + 重画相邻边（不入 Command 栈） */
  protected previewNodePosition(id: string, x: number, y: number): void {
    const mesh = this.nodeMeshes.get(id);
    if (!mesh) return;
    mesh.position.set(x, y, 0);
    // 重画相关边（仅 mesh 位置变了，nodes[].position 在 commit 时再写）
    this.redrawEdgesFor(id);
  }

  /** Command 内部用：把 nodes[].position 真正写下来并刷新渲染 */
  applyNodePosition(id: string, x: number, y: number): void {
    const node = this.nodes.find((n) => n.id === id);
    if (node) {
      node.position = { x, y };
    }
    const mesh = this.nodeMeshes.get(id);
    if (mesh) {
      mesh.position.set(x, y, 0);
    }
    this.redrawEdgesFor(id);
    this.onChange?.({ type: 'node-moved', nodeId: id, x, y });
  }

  /** 边创建（拖出新边到目标节点）— 入 Command 栈 */
  protected addEdgeBySource(sourceId: string, targetId: string): void {
    // 多重图：允许两节点之间多条不同语义的边（夫妻+同事+同学）
    // 仅禁止自环（节点指向自己），用户用 Cmd+Z 可撤销重复添加
    if (sourceId === targetId) return;
    const edge: GraphEdge = {
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: sourceId,
      target: targetId,
      label: makeTextLabel(''),  // 空 label，用户按需双击添加
    };
    this.commandStack.execute(new AddEdgeCommand(this, edge));
  }

  /** 重画跟某个节点相关的所有边（拖动 preview / 节点位置变更后调用） */
  protected redrawEdgesFor(nodeId: string): void {
    const affected = this.edges.filter((e) => e.source === nodeId || e.target === nodeId);
    for (const edge of affected) {
      this.redrawEdge(edge);
    }
  }

  /** 重画单条边（包括 bundle 内同伴边的索引可能未变也照画一次，便于统一逻辑） */
  protected redrawEdge(edge: GraphEdge): void {
    const oldGroup = this.edgeLines.get(edge.id);
    if (oldGroup) {
      this.scene.remove(oldGroup);
      disposeGroup(oldGroup);
      this.edgeLines.delete(edge.id);
    }
    const sourceMesh = this.nodeMeshes.get(edge.source);
    const targetMesh = this.nodeMeshes.get(edge.target);
    if (!sourceMesh || !targetMesh) return;
    const radius = Math.min(this.getMeshRadius(sourceMesh), this.getMeshRadius(targetMesh));
    const { index, total } = this.computeEdgeBundle(edge);
    const { group, labelPos } = createEdgeLine(
      sourceMesh.position,
      targetMesh.position,
      radius,
      index,
      total,
    );
    group.userData = { edgeId: edge.id };
    this.scene.add(group);
    this.edgeLines.set(edge.id, group);

    // 边 label 在弧线中点（直线时退化为直线中点）
    this.attachEdgeLabelAt(edge.id, edge.label ?? [], labelPos.x, labelPos.y);
  }

  /**
   * 计算同一对节点（无序对）之间的所有边及当前边的索引。
   * 用于多重图弧线偏移计算。源/目标互换的边也算同一组（视觉上重叠）。
   *
   * 排序规则：先按 (source, target) 字典序，再按 edge.id —— 保证两次渲染索引稳定，
   * 避免每次拖动都重排导致弧线"跳动"。
   */
  protected computeEdgeBundle(edge: GraphEdge): { index: number; total: number } {
    const a = edge.source < edge.target ? edge.source : edge.target;
    const b = edge.source < edge.target ? edge.target : edge.source;
    const sameBundle = this.edges
      .filter((e) => {
        const ea = e.source < e.target ? e.source : e.target;
        const eb = e.source < e.target ? e.target : e.source;
        return ea === a && eb === b;
      })
      .sort((x, y) => x.id.localeCompare(y.id));
    return { index: sameBundle.findIndex((e) => e.id === edge.id), total: sameBundle.length };
  }

  /** 给定 mesh，估算它的"半径"（圆/矩形通用近似 — 取边界球半径） */
  protected getMeshRadius(mesh: THREE.Mesh): number {
    const node = this.nodes.find((n) => n.id === (mesh.userData?.nodeId as string));
    if (node) {
      const size = this.shapeLib.getNodeSize(node.type);
      return Math.min(size.width, size.height) / 2;
    }
    return 30;
  }

  // ── Command 内部用的低层增删（不走 Command 栈，外部别直接用） ──

  /** @internal */
  _addNode(node: GraphNode): void {
    if (this.nodes.some((n) => n.id === node.id)) return;
    this.nodes.push(node);
    this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'node-added', node });
  }

  /** @internal */
  _removeNode(nodeId: string): void {
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    // 同时移除关联边（不发"边删除"事件，由调用方 RemoveNodeCommand 自己管理边的批量增删）
    this.edges = this.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    if (this.selectedId === nodeId) this.selectedId = null;
    this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'node-removed', nodeId });
  }

  /** @internal */
  _addEdge(edge: GraphEdge): void {
    if (this.edges.some((e) => e.id === edge.id)) return;
    this.edges.push(edge);
    this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'edge-added', edge });
  }

  /** @internal */
  _removeEdge(edgeId: string): void {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
    this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'edge-removed', edgeId });
  }

  /** @internal */
  _setNodeLabel(id: string, label: Atom[]): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    node.label = label;
    // 重新渲染该节点的内容容器
    this.refreshNodeContent(id);
    this.onChange?.({ type: 'node-label-changed', nodeId: id, label });
  }

  /** @internal */
  _setEdgeLabel(id: string, label: Atom[]): void {
    const edge = this.edges.find((e) => e.id === id);
    if (!edge) return;
    edge.label = label;
    this.refreshEdgeContent(id);
    this.onChange?.({ type: 'edge-label-changed', edgeId: id, label });
  }

  /** 刷新节点的内容渲染（label 改了之后调）。spec v1.2：完整 atom 数组渲染 */
  protected refreshNodeContent(nodeId: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.contentRenderer.updateNodeLabel(nodeId, node.label);
  }

  /** 刷新边的内容渲染 */
  protected refreshEdgeContent(edgeId: string): void {
    const edge = this.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    this.contentRenderer.updateEdgeLabel(edgeId, edge.label);
  }

  // ── 渲染 ──

  /** 把当前 nodes / edges 渲染到 scene（清旧 + 加新）。外部加载完数据后可调一次 */
  rerender(): void {
    for (const mesh of this.nodeMeshes.values()) this.scene.remove(mesh);
    for (const group of this.edgeLines.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    this.contentRenderer.disposeAll();
    this.nodeMeshes.clear();
    this.edgeLines.clear();

    for (const node of this.nodes) {
      const mesh = this.shapeLib.createShape(node);
      const pos = node.position ?? { x: 0, y: 0 };
      mesh.position.set(pos.x, pos.y, 0);
      mesh.userData = { nodeId: node.id };
      this.scene.add(mesh);
      this.nodeMeshes.set(node.id, mesh);

      // node label 挂在 mesh 下方，用 ProseMirror readonly 渲染完整 atom 数组
      const radius = this.getMeshRadius(mesh);
      const labelObj = this.contentRenderer.mountNodeLabel(node.id, node.label, mesh);
      labelObj.position.set(0, -radius - 14, 0);   // 节点正下方
    }

    for (const edge of this.edges) {
      this.redrawEdge(edge);
    }
  }

  /** 给定边创建/更新 label CSS2DObject，放到指定位置（弧线中点 / 直线中点） */
  protected attachEdgeLabelAt(
    edgeId: string,
    label: Atom[],
    x: number,
    y: number,
  ): void {
    this.contentRenderer.mountEdgeLabel(edgeId, label, this.scene, x, y);
  }

  protected clearScene(): void {
    for (const mesh of this.nodeMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
    }
    for (const group of this.edgeLines.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    this.contentRenderer.disposeAll();
    this.nodeMeshes.clear();
    this.edgeLines.clear();
  }

  protected startRenderLoop(): void {
    const tick = () => {
      this.renderer.render(this.scene, this.camera);
      this.css2dRenderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(tick);
    };
    tick();
  }
}

// ── 数据变更事件 ──

export type ChangeEvent =
  | { type: 'node-added'; node: GraphNode }
  | { type: 'node-removed'; nodeId: string }
  | { type: 'node-moved'; nodeId: string; x: number; y: number }
  | { type: 'node-label-changed'; nodeId: string; label: Atom[] }
  | { type: 'edge-added'; edge: GraphEdge }
  | { type: 'edge-removed'; edgeId: string }
  | { type: 'edge-label-changed'; edgeId: string; label: Atom[] }
  | { type: 'selection'; selectedId: string | null };

// ── Commands ──

class AddNodeCommand implements Command {
  readonly name = 'add-node';
  constructor(private engine: GraphEngine, private node: GraphNode) {}
  execute(): void { this.engine._addNode(this.node); }
  undo(): void { this.engine._removeNode(this.node.id); }
}

class RemoveNodeCommand implements Command {
  readonly name = 'remove-node';
  constructor(
    private engine: GraphEngine,
    private node: GraphNode,
    private relatedEdges: GraphEdge[],
  ) {}
  execute(): void {
    // _removeNode 会同时移除关联边的 nodes/edges 数组，所以这里直接调它
    this.engine._removeNode(this.node.id);
  }
  undo(): void {
    this.engine._addNode(this.node);
    for (const edge of this.relatedEdges) {
      this.engine._addEdge(edge);
    }
  }
}

class AddEdgeCommand implements Command {
  readonly name = 'add-edge';
  constructor(private engine: GraphEngine, private edge: GraphEdge) {}
  execute(): void { this.engine._addEdge(this.edge); }
  undo(): void { this.engine._removeEdge(this.edge.id); }
}

class MoveNodeCommand implements Command {
  readonly name = 'move-node';
  constructor(
    private engine: GraphEngine,
    private nodeId: string,
    private fromX: number,
    private fromY: number,
    private toX: number,
    private toY: number,
  ) {}
  execute(): void { this.engine.applyNodePosition(this.nodeId, this.toX, this.toY); }
  undo(): void { this.engine.applyNodePosition(this.nodeId, this.fromX, this.fromY); }
}

class SetNodeLabelCommand implements Command {
  readonly name = 'set-node-label';
  constructor(
    private engine: GraphEngine,
    private nodeId: string,
    private oldLabel: Atom[],
    private newLabel: Atom[],
  ) {}
  execute(): void { this.engine._setNodeLabel(this.nodeId, this.newLabel); }
  undo(): void { this.engine._setNodeLabel(this.nodeId, this.oldLabel); }
}

class SetEdgeLabelCommand implements Command {
  readonly name = 'set-edge-label';
  constructor(
    private engine: GraphEngine,
    private edgeId: string,
    private oldLabel: Atom[],
    private newLabel: Atom[],
  ) {}
  execute(): void { this.engine._setEdgeLabel(this.edgeId, this.newLabel); }
  undo(): void { this.engine._setEdgeLabel(this.edgeId, this.oldLabel); }
}

// ── 边渲染辅助：直线/弧线 + 终点箭头 ──

/** 同一对节点之间相邻边的法向偏移间距（世界坐标） */
const EDGE_CURVE_SPACING = 28;
/** 二次贝塞尔曲线分段数（数值越大越平滑、性能越低） */
const BEZIER_SEGMENTS = 24;

/**
 * 计算第 k 条边（共 N 条）的法向偏移系数。
 * - N=1 → [0]                直线
 * - N=2 → [-0.5, +0.5]        两侧对称
 * - N=3 → [-1, 0, +1]
 * - N=4 → [-1.5, -0.5, +0.5, +1.5]
 * 通用：k - (N-1)/2
 */
function curveOffsetFactor(edgeIndex: number, totalEdges: number): number {
  return edgeIndex - (totalEdges - 1) / 2;
}

/**
 * 创建一条边的渲染（直线或弧线）+ 终点箭头。
 * 同时返回 label 应放置的位置（弧的中点）。
 */
function createEdgeLine(
  from: THREE.Vector3,
  to: THREE.Vector3,
  nodeRadius: number,
  edgeIndex = 0,
  totalEdges = 1,
): { group: THREE.Group; labelPos: { x: number; y: number } } {
  const group = new THREE.Group();
  const labelPos = { x: 0, y: 0 };

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { group, labelPos };

  // 单位方向向量与单位法向量
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;  // 法向量（左转 90°）
  const ny = ux;

  // 端点退避（不穿入节点圆）
  const startX = from.x + ux * nodeRadius;
  const startY = from.y + uy * nodeRadius;
  const endX = to.x - ux * nodeRadius;
  const endY = to.y - uy * nodeRadius;

  const offsetFactor = curveOffsetFactor(edgeIndex, totalEdges);
  const offset = offsetFactor * EDGE_CURVE_SPACING;

  let arrowAngle: number;
  if (Math.abs(offset) < 0.01) {
    // 直线
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(startX, startY, -1),
      new THREE.Vector3(endX, endY, -1),
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0x888888 });
    group.add(new THREE.Line(geometry, material));

    labelPos.x = (startX + endX) / 2;
    labelPos.y = (startY + endY) / 2;
    arrowAngle = Math.atan2(dy, dx);
  } else {
    // 二次贝塞尔弧线
    // 控制点 = 直线中点 + 法向偏移
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const ctrlX = midX + nx * offset;
    const ctrlY = midY + ny * offset;

    // 采样 BEZIER_SEGMENTS+1 个点
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= BEZIER_SEGMENTS; i++) {
      const t = i / BEZIER_SEGMENTS;
      const oneMinusT = 1 - t;
      const x = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * ctrlX + t * t * endX;
      const y = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * ctrlY + t * t * endY;
      points.push(new THREE.Vector3(x, y, -1));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x888888 });
    group.add(new THREE.Line(geometry, material));

    // label 位置 = 弧线中点（t=0.5 时的贝塞尔点）
    labelPos.x = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX;
    labelPos.y = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;

    // 箭头方向 = 弧线在终点的切线 = B'(1) = 2 * (end - ctrl)
    const tangentX = endX - ctrlX;
    const tangentY = endY - ctrlY;
    arrowAngle = Math.atan2(tangentY, tangentX);
  }

  // 箭头（尖端在 endX, endY，沿切线方向）
  const arrowSize = 10;
  const arrowGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-arrowSize, arrowSize / 2, 0),
    new THREE.Vector3(-arrowSize, -arrowSize / 2, 0),
  ]);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.position.set(endX, endY, -0.5);
  arrow.rotation.z = arrowAngle;
  group.add(arrow);

  return { group, labelPos };
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else (obj.material as THREE.Material).dispose();
    }
  });
}

// 注：v1.1 时期的 createNodeLabelDom / createEdgeLabelDom helper 已删除。
// spec v1.2 § 7：label 渲染统一委托给 NodeContentRenderer（用 ProseMirror
// readonly view 渲染 atom 数组），样式/dataset 标注由 NodeContentRenderer 内部处理。
