import * as THREE from 'three';

/**
 * GraphEngine — L5 GraphView 内部的渲染引擎抽象基类
 *
 * P1 第一段：仅渲染骨架（场景 / 相机 / 渲染循环 / 节点-边管理 / 布局）。
 * 交互、持久化、Block 挂载留待后续段。
 */

// ── 数据模型（与 SurrealDB schema 对齐，但 P1.1 暂不接库）──

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
  /** 创建节点的 Three.js mesh */
  createShape(node: GraphNode): THREE.Mesh;
  /** 选中态高亮切换 */
  applyHighlight(mesh: THREE.Mesh, selected: boolean): void;
  /** 节点尺寸（供布局用） */
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
  protected container: HTMLElement | null = null;
  protected animationId: number | null = null;

  /** nodeId → mesh（用于增删改查） */
  protected nodeMeshes = new Map<string, THREE.Mesh>();
  /** edgeId → line（包括箭头组） */
  protected edgeLines = new Map<string, THREE.Group>();

  protected nodes: GraphNode[] = [];
  protected edges: GraphEdge[] = [];

  protected shapeLib: ShapeLibrary;
  protected layout: LayoutAlgo;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e1e);

    // 正交相机：节点尺寸不随距离变化
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.set(0, 0, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });

    // 由具体变种提供
    this.shapeLib = this.getShapeLibrary();
    this.layout = this.getLayoutAlgorithm();
  }

  // ── 变种必须实现 ──
  abstract getShapeLibrary(): ShapeLibrary;
  abstract getLayoutAlgorithm(): LayoutAlgo;

  // ── 生命周期 ──

  mount(container: HTMLElement): void {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    // 容器初始可能尺寸为 0（布局未完成），给一个保险默认值，
    // ResizeObserver 后续会对齐到真实尺寸
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    this.resize(w, h);
    this.startRenderLoop();
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clearScene();
    this.renderer.dispose();
    if (this.container && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.container = null;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    // 正交相机以"屏幕中心为 (0,0)，1px = 1 世界单位"
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // 第三参数 updateStyle=true（默认）：同时更新 canvas CSS 尺寸，
    // 否则 canvas CSS 尺寸保留 HTML5 默认 300×150，画布显示就错位
    this.renderer.setSize(width, height);
  }

  // ── 节点/边管理 ──

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.clearScene();
    this.nodes = nodes;
    this.edges = edges;
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

  /** 把当前 nodes / edges 渲染到 scene（清旧 + 加新） */
  protected rerender(): void {
    // 清空旧 mesh / line
    for (const mesh of this.nodeMeshes.values()) this.scene.remove(mesh);
    for (const line of this.edgeLines.values()) this.scene.remove(line);
    this.nodeMeshes.clear();
    this.edgeLines.clear();

    // 节点
    for (const node of this.nodes) {
      const mesh = this.shapeLib.createShape(node);
      const pos = node.position ?? { x: 0, y: 0 };
      mesh.position.set(pos.x, pos.y, 0);
      mesh.userData = { nodeId: node.id };
      this.scene.add(mesh);
      this.nodeMeshes.set(node.id, mesh);
    }

    // 边
    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    for (const edge of this.edges) {
      const sourceMesh = this.nodeMeshes.get(edge.source);
      const targetMesh = this.nodeMeshes.get(edge.target);
      if (!sourceMesh || !targetMesh) continue;
      const targetNode = nodeMap.get(edge.target);
      const sourceNode = nodeMap.get(edge.source);
      const targetSize = targetNode ? this.shapeLib.getNodeSize(targetNode.type) : { width: 60, height: 60 };
      const sourceSize = sourceNode ? this.shapeLib.getNodeSize(sourceNode.type) : { width: 60, height: 60 };
      // 用较小半径作为退避距离，圆/矩形通用近似
      const radius = Math.min(targetSize.width, targetSize.height, sourceSize.width, sourceSize.height) / 2;
      const group = createEdgeLine(sourceMesh.position, targetMesh.position, radius);
      group.userData = { edgeId: edge.id };
      this.scene.add(group);
      this.edgeLines.set(edge.id, group);
    }
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
      group.traverse((obj) => {
        if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else (obj.material as THREE.Material).dispose();
        }
      });
    }
    this.nodeMeshes.clear();
    this.edgeLines.clear();
  }

  // ── 渲染循环 ──

  protected startRenderLoop(): void {
    const tick = () => {
      this.renderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(tick);
    };
    tick();
  }
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

  // 单位方向向量
  const ux = dx / len;
  const uy = dy / len;

  // 线段的真实端点：从 from 到 to，但两端各退 nodeRadius，避免穿入节点
  const x1 = from.x + ux * nodeRadius;
  const y1 = from.y + uy * nodeRadius;
  const x2 = to.x - ux * nodeRadius;
  const y2 = to.y - uy * nodeRadius;

  // 直线段
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1, y1, -1),
    new THREE.Vector3(x2, y2, -1),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x888888 });
  const line = new THREE.Line(geometry, material);
  group.add(line);

  // 箭头：尖端在节点边缘 (x2, y2)，三角形向 -x 方向延伸（rotation 后指向 to）
  const angle = Math.atan2(dy, dx);
  const arrowSize = 10;
  const arrowGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-arrowSize, arrowSize / 2, 0),
    new THREE.Vector3(-arrowSize, -arrowSize / 2, 0),
  ]);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.position.set(x2, y2, -0.5);   // 略高于线段，避免被遮
  arrow.rotation.z = angle;
  group.add(arrow);

  return group;
}
