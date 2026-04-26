import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Atom } from '../../../lib/atom-serializers/types';
import { ViewportController } from './ViewportController';
import { InteractionController } from './InteractionController';
import { CommandStack, type Command } from './CommandStack';
import { NodeRenderer } from '../rendering/NodeRenderer';
import { EdgeRenderer } from '../rendering/EdgeRenderer';
import { SvgGeometryContent } from '../rendering/contents/SvgGeometryContent';
import { CircleShape } from '../rendering/shapes/CircleShape';
import { EditOverlay, type EditTarget } from '../rendering/edit/EditOverlay';

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
// v1.3 § 1.2：Atom 类型从 lib 共享层导入（跨视图共享）。
// Atom 即 ProseMirror node JSON：{ type, content?, attrs?, marks?, text? }

export type { Atom };

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

  /** v1.3：节点用 THREE.Group（含 shape mesh + content obj） */
  protected nodeGroups = new Map<string, THREE.Group>();
  protected edgeLines = new Map<string, THREE.Group>();
  /** edgeId → 边 label 的 SVG 几何 Object3D（v1.3 § 9.4） */
  protected edgeLabels = new Map<string, THREE.Object3D>();

  /** v1.3：渲染层共享一个 SvgGeometryContent 实例（L2 GeometryCache 静态共享） */
  private static SHARED_CONTENT = new SvgGeometryContent();

  /** v1.3：NodeRenderer 实例 */
  protected nodeRenderer: NodeRenderer = new NodeRenderer(
    new CircleShape(),
    GraphEngine.SHARED_CONTENT,
  );

  /** v1.3 § 3.4：EdgeRenderer 实例 */
  protected edgeRenderer: EdgeRenderer = new EdgeRenderer(GraphEngine.SHARED_CONTENT);

  /** v1.3 § 7：EditOverlay（编辑模式） */
  protected editOverlay: EditOverlay | null = null;

  protected nodes: GraphNode[] = [];
  protected edges: GraphEdge[] = [];

  protected shapeLib: ShapeLibrary;
  protected layout: LayoutAlgo;

  protected viewport: ViewportController | null = null;
  protected interaction: InteractionController | null = null;
  protected commandStack = new CommandStack();

  protected selectedId: string | null = null;
  protected hoveredId: string | null = null;

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
      () => this.nodeGroups,
      (group) => this.getGroupRadius(group),
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
        onHoverChange: (id) => this.applyHoverHighlight(id),
        onNodeDoubleClick: (id) => this.enterEditMode(id),
      },
    );

    // v1.3 § 7：EditOverlay
    this.editOverlay = new EditOverlay(this.scene, {
      onExit: (target, atoms) => this.handleEditExit(target, atoms),
    });
    this.viewport.attach();
    this.interaction.attach();
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.editOverlay?.dispose();
    this.editOverlay = null;
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
    void this.rerender();
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

  /** 临时隐藏节点 label（编辑时用，避免和 input 重叠）
   *  v1.3：操作 group 的 content child（children[1]），shape 不动 */
  setNodeLabelVisible(id: string, visible: boolean): void {
    const group = this.nodeGroups.get(id);
    const content = group?.children[1];
    if (content) content.visible = visible;
  }

  /** 临时隐藏边 label */
  setEdgeLabelVisible(id: string, visible: boolean): void {
    const obj = this.edgeLabels.get(id);
    if (obj) obj.visible = visible;
  }

  // ── 编辑模式（v1.3 § 7）──

  /** 双击节点进入编辑态：隐藏 content、浮 EditOverlay */
  enterEditMode(nodeId: string): void {
    if (!this.editOverlay) return;
    const node = this.nodes.find((n) => n.id === nodeId);
    const group = this.nodeGroups.get(nodeId);
    if (!node || !group) return;

    // 隐藏 content（保留 shape 圆作背景）
    this.setNodeLabelVisible(nodeId, false);

    // 浮层位置 = 节点中心
    const worldPos = group.position.clone();

    this.editOverlay.enter({
      kind: 'node',
      id: nodeId,
      atoms: node.label,
      worldPos,
    });
  }

  /** EditOverlay 退出回调：commit=true 时把新 atoms 回写并触发 redraw */
  protected handleEditExit(target: EditTarget, atoms: Atom[] | null): void {
    // 恢复 content 可见
    if (target.kind === 'node') {
      this.setNodeLabelVisible(target.id, true);
      if (atoms) {
        this.setNodeLabel(target.id, atoms);
      }
    } else if (target.kind === 'edge') {
      this.setEdgeLabelVisible(target.id, true);
      if (atoms) {
        this.setEdgeLabel(target.id, atoms);
      }
    }
  }

  undo(): void {
    if (this.commandStack.undo()) {
      void this.rerender();
      this.applySelectionHighlight();
    }
  }

  redo(): void {
    if (this.commandStack.redo()) {
      void this.rerender();
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

  /**
   * 高亮优先级（v1.3 § 7.3）：selected > hover > default
   */
  protected applySelectionHighlight(): void {
    for (const [nodeId, group] of this.nodeGroups) {
      this.nodeRenderer.setHighlight(group, this.computeHighlightMode(nodeId));
    }
  }

  /** hover 切换：仅刷新涉及到的节点（避免遍历全部） */
  protected applyHoverHighlight(nodeId: string | null): void {
    const oldId = this.hoveredId;
    this.hoveredId = nodeId;

    if (oldId && oldId !== nodeId) {
      const oldGroup = this.nodeGroups.get(oldId);
      if (oldGroup) this.nodeRenderer.setHighlight(oldGroup, this.computeHighlightMode(oldId));
    }
    if (nodeId) {
      const newGroup = this.nodeGroups.get(nodeId);
      if (newGroup) this.nodeRenderer.setHighlight(newGroup, this.computeHighlightMode(nodeId));
    }
  }

  private computeHighlightMode(nodeId: string): 'default' | 'hover' | 'selected' {
    if (nodeId === this.selectedId) return 'selected';
    if (nodeId === this.hoveredId) return 'hover';
    return 'default';
  }

  // ── 内部：节点拖拽 preview / 边创建 ──

  /** 拖动 preview 期间实时更新 group 位置 + 重画相邻边（不入 Command 栈） */
  protected previewNodePosition(id: string, x: number, y: number): void {
    const group = this.nodeGroups.get(id);
    if (!group) return;
    group.position.set(x, y, 0);
    // 重画相关边（仅 group 位置变了，nodes[].position 在 commit 时再写）
    this.redrawEdgesFor(id);
  }

  /** Command 内部用：把 nodes[].position 真正写下来并刷新渲染 */
  applyNodePosition(id: string, x: number, y: number): void {
    const node = this.nodes.find((n) => n.id === id);
    if (node) {
      node.position = { x, y };
    }
    const group = this.nodeGroups.get(id);
    if (group) {
      group.position.set(x, y, 0);
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

  /**
   * 重画单条边（v1.3 § 3.4：通过 EdgeRenderer 渲染）。
   *
   * fire-and-forget：edge label 异步 SVG 几何，渲染期间无 label，
   * 完成后挂上。token 校验避免拖动期间老 label 出现在新位置。
   */
  protected redrawEdge(edge: GraphEdge): void {
    const oldGroup = this.edgeLines.get(edge.id);
    if (oldGroup) {
      this.scene.remove(oldGroup);
      this.edgeRenderer.dispose(oldGroup);
      this.edgeLines.delete(edge.id);
      this.edgeLabels.delete(edge.id);
    }
    const sourceGroup = this.nodeGroups.get(edge.source);
    const targetGroup = this.nodeGroups.get(edge.target);
    if (!sourceGroup || !targetGroup) return;

    const radius = Math.min(this.getGroupRadius(sourceGroup), this.getGroupRadius(targetGroup));
    const { index, total } = this.computeEdgeBundle(edge);

    // 异步创建：用 per-edge token 避免同一条边的多次 redrawEdge 互相覆盖
    // （拖动期间频繁 redraw 时只保留最新结果）。
    // 注意：每条边独立 token，不会因为画其他边而失效。
    const tokens = this.edgeRedrawTokens;
    const myToken = (tokens.get(edge.id) ?? 0) + 1;
    tokens.set(edge.id, myToken);

    const edgeId = edge.id;
    void this.edgeRenderer
      .createEdge({
        source: sourceGroup.position,
        target: targetGroup.position,
        nodeRadius: radius,
        edgeIndex: index,
        totalEdges: total,
        arrow: true,
        label: edge.label ?? [],
      })
      .then((group) => {
        // 该 edge 已经被新一次 redrawEdge 替代（如拖动期间）
        if (tokens.get(edgeId) !== myToken) {
          this.edgeRenderer.dispose(group);
          return;
        }
        // 边在异步等待期间可能被删除
        if (!this.edges.find((e) => e.id === edgeId)) {
          this.edgeRenderer.dispose(group);
          tokens.delete(edgeId);
          return;
        }
        group.userData = { edgeId };
        this.scene.add(group);
        this.edgeLines.set(edgeId, group);
        const labelObj = group.children[2];
        if (labelObj) this.edgeLabels.set(edgeId, labelObj);
      });
  }

  /** edge 异步渲染 per-edge token（避免拖动期间老 createEdge 回调污染场景） */
  private edgeRedrawTokens = new Map<string, number>();

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

  /** 给定 group，从 shape mesh 的 userData 读半径（CircleShape 在 createMesh 写入） */
  protected getGroupRadius(group: THREE.Group): number {
    const shape = group.children[0];
    if (shape && typeof shape.userData?.radius === 'number') {
      return shape.userData.radius as number;
    }
    return 24;
  }

  // ── Command 内部用的低层增删（不走 Command 栈，外部别直接用） ──

  /** @internal */
  _addNode(node: GraphNode): void {
    if (this.nodes.some((n) => n.id === node.id)) return;
    this.nodes.push(node);
    void this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'node-added', node });
  }

  /** @internal */
  _removeNode(nodeId: string): void {
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    // 同时移除关联边（不发"边删除"事件，由调用方 RemoveNodeCommand 自己管理边的批量增删）
    this.edges = this.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    if (this.selectedId === nodeId) this.selectedId = null;
    void this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'node-removed', nodeId });
  }

  /** @internal */
  _addEdge(edge: GraphEdge): void {
    if (this.edges.some((e) => e.id === edge.id)) return;
    this.edges.push(edge);
    void this.rerender();
    this.applySelectionHighlight();
    this.onChange?.({ type: 'edge-added', edge });
  }

  /** @internal */
  _removeEdge(edgeId: string): void {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
    void this.rerender();
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

  /** 刷新节点的内容渲染（label 改了之后调）。v1.3：走 NodeRenderer.updateContent */
  protected refreshNodeContent(nodeId: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const group = this.nodeGroups.get(nodeId);
    if (!group) return;
    void this.nodeRenderer.updateContent(group, node.label);
  }

  /** 刷新边的内容渲染（label 改了之后调）。v1.3：直接重画整条边 */
  protected refreshEdgeContent(edgeId: string): void {
    const edge = this.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    this.redrawEdge(edge);
  }

  // ── 渲染 ──

  /**
   * 把当前 nodes / edges 渲染到 scene（清旧 + 加新）。外部加载完数据后可调一次。
   *
   * v1.3：节点走 NodeRenderer（异步，含 SVG 序列化 + 字体加载）。
   * 整个方法返回 Promise；同步调用方用 `void this.rerender()` 不阻塞 UI。
   * 节点会按顺序异步出现（首批可能延迟 ~100ms 因为字体冷加载）。
   */
  async rerender(): Promise<void> {
    // 用本地令牌避免重入导致旧 rerender 的节点出现在新场景里
    const token = ++this.rerenderToken;

    for (const group of this.nodeGroups.values()) {
      this.scene.remove(group);
      this.nodeRenderer.dispose(group);
    }
    for (const group of this.edgeLines.values()) {
      this.scene.remove(group);
      this.edgeRenderer.dispose(group);
    }
    this.nodeGroups.clear();
    this.edgeLines.clear();
    this.edgeLabels.clear();

    // 节点：异步并行创建（保留顺序需求时改 for-await）
    const nodeJobs = this.nodes.map(async (node) => {
      const group = await this.nodeRenderer.createNode(node);
      if (token !== this.rerenderToken) {
        // 已被新 rerender 替代，丢弃
        this.nodeRenderer.dispose(group);
        return;
      }
      group.userData.nodeId = node.id;
      this.scene.add(group);
      this.nodeGroups.set(node.id, group);
    });
    await Promise.all(nodeJobs);
    if (token !== this.rerenderToken) return;

    // 边：依赖节点位置，节点全部到位后画
    for (const edge of this.edges) {
      this.redrawEdge(edge);
    }
  }

  /** rerender 重入令牌（避免异步节点创建的并发问题） */
  private rerenderToken = 0;

  protected clearScene(): void {
    for (const group of this.nodeGroups.values()) {
      this.scene.remove(group);
      this.nodeRenderer.dispose(group);
    }
    for (const group of this.edgeLines.values()) {
      this.scene.remove(group);
      this.edgeRenderer.dispose(group);
    }
    this.nodeGroups.clear();
    this.edgeLines.clear();
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

// v1.3 § 3.4：边渲染逻辑提取到 EdgeRenderer 类（src/plugins/graph/rendering/EdgeRenderer.ts）。
// CSS2DRenderer 仅保留作 Phase 3 EditOverlay 浮层渲染器（当前空闲）。
