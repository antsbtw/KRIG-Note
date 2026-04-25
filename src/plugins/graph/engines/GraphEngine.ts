import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ViewportController } from './ViewportController';
import { InteractionController } from './InteractionController';
import { CommandStack, type Command } from './CommandStack';

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

// ── 数据模型（与 SurrealDB schema 对齐，但 P1 阶段暂不接库）──

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
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
  /** nodeId / edgeId → CSS2DObject 容器（label） */
  protected nodeLabels = new Map<string, CSS2DObject>();
  protected edgeLabels = new Map<string, CSS2DObject>();

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
  createNodeAt(x: number, y: number, label?: string): string {
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const node: GraphNode = {
      id,
      type: 'concept',
      label: label ?? id,
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

  /** 改节点 label，入 Command 栈 */
  setNodeLabel(id: string, label: string): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node || node.label === label) return;
    this.commandStack.execute(new SetNodeLabelCommand(this, id, node.label, label));
  }

  /** 改边 label，入 Command 栈 */
  setEdgeLabel(id: string, label: string): void {
    const edge = this.edges.find((e) => e.id === id);
    if (!edge) return;
    const oldLabel = edge.label ?? '';
    if (oldLabel === label) return;
    this.commandStack.execute(new SetEdgeLabelCommand(this, id, oldLabel, label));
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
    // 防止自环 + 重复边
    if (sourceId === targetId) return;
    if (this.edges.some((e) => e.source === sourceId && e.target === targetId)) return;
    const edge: GraphEdge = {
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: sourceId,
      target: targetId,
    };
    this.commandStack.execute(new AddEdgeCommand(this, edge));
  }

  /** 重画跟某个节点相关的所有边（拖动 preview / 节点位置变更后调用） */
  protected redrawEdgesFor(nodeId: string): void {
    const affected = this.edges.filter((e) => e.source === nodeId || e.target === nodeId);
    for (const edge of affected) {
      const oldGroup = this.edgeLines.get(edge.id);
      if (oldGroup) {
        this.scene.remove(oldGroup);
        disposeGroup(oldGroup);
        this.edgeLines.delete(edge.id);
      }
      const sourceMesh = this.nodeMeshes.get(edge.source);
      const targetMesh = this.nodeMeshes.get(edge.target);
      if (!sourceMesh || !targetMesh) continue;
      const radius = Math.min(this.getMeshRadius(sourceMesh), this.getMeshRadius(targetMesh));
      const group = createEdgeLine(sourceMesh.position, targetMesh.position, radius);
      group.userData = { edgeId: edge.id };
      this.scene.add(group);
      this.edgeLines.set(edge.id, group);

      // 边 label 也要重新定位到新中点
      this.attachEdgeLabel(edge.id, edge.label ?? '', sourceMesh.position, targetMesh.position);
    }
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
  _setNodeLabel(id: string, label: string): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    node.label = label;
    // 只更新对应 label DOM，不重渲整个场景
    const obj = this.nodeLabels.get(id);
    if (obj) obj.element.textContent = label || '未命名';
    this.onChange?.({ type: 'node-label-changed', nodeId: id, label });
  }

  /** @internal */
  _setEdgeLabel(id: string, label: string): void {
    const edge = this.edges.find((e) => e.id === id);
    if (!edge) return;
    edge.label = label;
    const obj = this.edgeLabels.get(id);
    if (obj) obj.element.textContent = label;
    this.onChange?.({ type: 'edge-label-changed', edgeId: id, label });
  }

  // ── 渲染 ──

  /** 把当前 nodes / edges 渲染到 scene（清旧 + 加新）。外部加载完数据后可调一次 */
  rerender(): void {
    for (const mesh of this.nodeMeshes.values()) this.scene.remove(mesh);
    for (const group of this.edgeLines.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    for (const obj of this.nodeLabels.values()) {
      obj.parent?.remove(obj);
      obj.element.remove();
    }
    for (const obj of this.edgeLabels.values()) {
      obj.parent?.remove(obj);
      obj.element.remove();
    }
    this.nodeMeshes.clear();
    this.edgeLines.clear();
    this.nodeLabels.clear();
    this.edgeLabels.clear();

    for (const node of this.nodes) {
      const mesh = this.shapeLib.createShape(node);
      const pos = node.position ?? { x: 0, y: 0 };
      mesh.position.set(pos.x, pos.y, 0);
      mesh.userData = { nodeId: node.id };
      this.scene.add(mesh);
      this.nodeMeshes.set(node.id, mesh);

      // node label 挂在 mesh 下方
      const radius = this.getMeshRadius(mesh);
      const labelDom = createNodeLabelDom(node.id, node.label || '未命名');
      const labelObj = new CSS2DObject(labelDom);
      labelObj.position.set(0, -radius - 14, 0);   // 节点正下方
      mesh.add(labelObj);
      this.nodeLabels.set(node.id, labelObj);
    }

    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    for (const edge of this.edges) {
      const sourceMesh = this.nodeMeshes.get(edge.source);
      const targetMesh = this.nodeMeshes.get(edge.target);
      if (!sourceMesh || !targetMesh) continue;
      const targetNode = nodeMap.get(edge.target);
      const sourceNode = nodeMap.get(edge.source);
      const targetSize = targetNode ? this.shapeLib.getNodeSize(targetNode.type) : { width: 60, height: 60 };
      const sourceSize = sourceNode ? this.shapeLib.getNodeSize(sourceNode.type) : { width: 60, height: 60 };
      const radius = Math.min(targetSize.width, targetSize.height, sourceSize.width, sourceSize.height) / 2;
      const group = createEdgeLine(sourceMesh.position, targetMesh.position, radius);
      group.userData = { edgeId: edge.id };
      this.scene.add(group);
      this.edgeLines.set(edge.id, group);

      // edge label 在边的中点（取 source/target mesh 位置中点）
      this.attachEdgeLabel(edge.id, edge.label ?? '', sourceMesh.position, targetMesh.position);
    }
  }

  /** 给定边创建/更新 label CSS2DObject，放到边的中点 */
  protected attachEdgeLabel(
    edgeId: string,
    label: string,
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): void {
    const old = this.edgeLabels.get(edgeId);
    if (old) {
      old.parent?.remove(old);
      old.element.remove();
    }
    const dom = createEdgeLabelDom(edgeId, label);
    const obj = new CSS2DObject(dom);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    obj.position.set(midX, midY, 0);
    this.scene.add(obj);
    this.edgeLabels.set(edgeId, obj);
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
    for (const obj of this.nodeLabels.values()) {
      obj.parent?.remove(obj);
      obj.element.remove();
    }
    for (const obj of this.edgeLabels.values()) {
      obj.parent?.remove(obj);
      obj.element.remove();
    }
    this.nodeMeshes.clear();
    this.edgeLines.clear();
    this.nodeLabels.clear();
    this.edgeLabels.clear();
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
  | { type: 'node-label-changed'; nodeId: string; label: string }
  | { type: 'edge-added'; edge: GraphEdge }
  | { type: 'edge-removed'; edgeId: string }
  | { type: 'edge-label-changed'; edgeId: string; label: string }
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
    private oldLabel: string,
    private newLabel: string,
  ) {}
  execute(): void { this.engine._setNodeLabel(this.nodeId, this.newLabel); }
  undo(): void { this.engine._setNodeLabel(this.nodeId, this.oldLabel); }
}

class SetEdgeLabelCommand implements Command {
  readonly name = 'set-edge-label';
  constructor(
    private engine: GraphEngine,
    private edgeId: string,
    private oldLabel: string,
    private newLabel: string,
  ) {}
  execute(): void { this.engine._setEdgeLabel(this.edgeId, this.newLabel); }
  undo(): void { this.engine._setEdgeLabel(this.edgeId, this.oldLabel); }
}

// ── 边渲染辅助：直线 + 终点箭头 ──

function createEdgeLine(
  from: THREE.Vector3,
  to: THREE.Vector3,
  nodeRadius = 30,
): THREE.Group {
  const group = new THREE.Group();

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return group;

  const ux = dx / len;
  const uy = dy / len;

  const x1 = from.x + ux * nodeRadius;
  const y1 = from.y + uy * nodeRadius;
  const x2 = to.x - ux * nodeRadius;
  const y2 = to.y - uy * nodeRadius;

  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1, y1, -1),
    new THREE.Vector3(x2, y2, -1),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x888888 });
  const line = new THREE.Line(geometry, material);
  group.add(line);

  const angle = Math.atan2(dy, dx);
  const arrowSize = 10;
  const arrowGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-arrowSize, arrowSize / 2, 0),
    new THREE.Vector3(-arrowSize, -arrowSize / 2, 0),
  ]);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.position.set(x2, y2, -0.5);
  arrow.rotation.z = angle;
  group.add(arrow);

  return group;
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

// ── Label 渲染辅助 ──

/**
 * 创建节点 label 元素 — 节点正下方的文字 + 透明背景
 * dataset 标注 { kind: 'node-label', id } 供 GraphView 双击 handler 识别
 */
export function createNodeLabelDom(nodeId: string, label: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'krig-graph-node-label';
  div.dataset.kind = 'node-label';
  div.dataset.nodeId = nodeId;
  div.textContent = label;
  div.style.cssText = `
    color: #e0e0e0;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 2px 6px;
    background: rgba(30,30,30,0.7);
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: auto;
    cursor: text;
    user-select: none;
  `;
  return div;
}

export function createEdgeLabelDom(edgeId: string, label: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'krig-graph-edge-label';
  div.dataset.kind = 'edge-label';
  div.dataset.edgeId = edgeId;
  // 边的 label 默认空字符串显示空 div（便于点中加字），但 textContent 仍写入
  div.textContent = label;
  div.style.cssText = `
    color: #aaa;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 1px 4px;
    background: rgba(30,30,30,0.6);
    border-radius: 2px;
    white-space: nowrap;
    pointer-events: auto;
    cursor: text;
    user-select: none;
    min-width: 8px;
    min-height: 12px;
  `;
  return div;
}
