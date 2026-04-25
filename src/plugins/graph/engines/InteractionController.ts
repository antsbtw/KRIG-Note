import * as THREE from 'three';
import type { ViewportController } from './ViewportController';

/**
 * InteractionController — 节点的点击/拖拽，以及节点边缘拖出新边
 *
 * 与 ViewportController 协作：
 * - 左键按在节点中心区域 → 拖动该节点
 * - 左键按在节点边缘 → 拖出一条临时边，松开时若落在另一个节点上则创建边
 * - 左键按在空白区域 → 让 ViewportController 平移画布
 * - 单击节点（无拖动）→ 选中
 * - 单击空白（无拖动）→ 取消选中
 *
 * 所有"产生数据变更"的动作通过回调通知外部（GraphEngine 再走 CommandStack）。
 */

const EDGE_HANDLE_RATIO = 0.7;  // 距离中心 > radius * 0.7 算边缘（连接点）
const DRAG_THRESHOLD = 3;       // 像素，超过才算拖动（否则视作点击）

export interface InteractionCallbacks {
  /** 拖拽开始（实时 preview，不入 CommandStack） */
  onNodeDragStart: (nodeId: string, fromX: number, fromY: number) => void;
  /** 拖拽中（实时刷新位置） */
  onNodeDragMove: (nodeId: string, x: number, y: number) => void;
  /** 拖拽结束（入 CommandStack）；fromX/Y 是起点用于 undo */
  onNodeDragEnd: (nodeId: string, fromX: number, fromY: number, toX: number, toY: number) => void;
  /** 单击选中 / 取消选中 */
  onSelect: (nodeId: string | null) => void;
  /** 拖出新边并落在目标节点上（入 CommandStack） */
  onEdgeCreate: (sourceId: string, targetId: string) => void;
}

export class InteractionController {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private dragMode: 'none' | 'node' | 'edge' = 'none';
  private dragNodeId: string | null = null;
  private dragStartScreen = { x: 0, y: 0 };
  private dragStartWorld = { x: 0, y: 0 };
  private dragNodeStart = { x: 0, y: 0 };
  private dragMoved = false;

  /** 拖出新边时的"幽灵线" */
  private ghostEdge: THREE.Line | null = null;

  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;

  constructor(
    private domElement: HTMLElement,
    private camera: THREE.OrthographicCamera,
    private scene: THREE.Scene,
    private viewport: ViewportController,
    private getNodeMeshes: () => Map<string, THREE.Mesh>,
    private getNodeRadius: (mesh: THREE.Mesh) => number,
    private callbacks: InteractionCallbacks,
  ) {
    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);
  }

  attach(): void {
    this.domElement.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mouseup', this.boundMouseUp);
    // 让 viewport 知道：左键按在节点上时不平移，按空白时平移
    this.viewport.shouldAllowLeftPan = (e: MouseEvent) => {
      return this.pickNodeAtScreen(e.clientX, e.clientY) === null;
    };
  }

  detach(): void {
    this.domElement.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mouseup', this.boundMouseUp);
    this.removeGhostEdge();
  }

  /** 屏幕坐标 → 命中节点 id（顶端优先），不命中返回 null */
  private pickNodeAtScreen(screenX: number, screenY: number): string | null {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = Array.from(this.getNodeMeshes().values());
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const top = hits[0].object;
    return (top.userData?.nodeId as string) ?? null;
  }

  /** 在节点上点击时，命中点距中心 > radius*RATIO 算边缘（用于拖出新边） */
  private isOnNodeEdge(mesh: THREE.Mesh, worldX: number, worldY: number): boolean {
    const cx = mesh.position.x;
    const cy = mesh.position.y;
    const r = this.getNodeRadius(mesh);
    const d = Math.hypot(worldX - cx, worldY - cy);
    return d > r * EDGE_HANDLE_RATIO;
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;  // 只处理左键

    const nodeId = this.pickNodeAtScreen(e.clientX, e.clientY);
    if (!nodeId) return;  // 空白处由 ViewportController 处理平移

    e.preventDefault();
    e.stopPropagation();

    const mesh = this.getNodeMeshes().get(nodeId)!;
    const world = this.viewport.screenToWorld(e.clientX, e.clientY);

    this.dragNodeId = nodeId;
    this.dragStartScreen = { x: e.clientX, y: e.clientY };
    this.dragStartWorld = world;
    this.dragNodeStart = { x: mesh.position.x, y: mesh.position.y };
    this.dragMoved = false;

    if (this.isOnNodeEdge(mesh, world.x, world.y)) {
      this.dragMode = 'edge';
    } else {
      this.dragMode = 'node';
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.dragMode === 'none') return;

    const dxScreen = e.clientX - this.dragStartScreen.x;
    const dyScreen = e.clientY - this.dragStartScreen.y;
    if (!this.dragMoved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD) return;
    this.dragMoved = true;

    const world = this.viewport.screenToWorld(e.clientX, e.clientY);

    if (this.dragMode === 'node' && this.dragNodeId) {
      // 拖动节点：用 mesh 的初始位置 + 鼠标在世界坐标的位移
      const newX = this.dragNodeStart.x + (world.x - this.dragStartWorld.x);
      const newY = this.dragNodeStart.y + (world.y - this.dragStartWorld.y);
      this.callbacks.onNodeDragMove(this.dragNodeId, newX, newY);
      if (!this.dragMoved) {
        this.callbacks.onNodeDragStart(this.dragNodeId, this.dragNodeStart.x, this.dragNodeStart.y);
      }
    } else if (this.dragMode === 'edge' && this.dragNodeId) {
      // 拖出新边：更新幽灵线
      this.updateGhostEdge(this.dragNodeStart.x, this.dragNodeStart.y, world.x, world.y);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.dragMode === 'none') return;

    const wasDragMode = this.dragMode;
    const wasNodeId = this.dragNodeId;
    const moved = this.dragMoved;

    // 重置状态先（避免后续回调里再次进入）
    this.dragMode = 'none';
    this.dragNodeId = null;
    this.removeGhostEdge();

    if (!moved) {
      // 单击节点
      this.callbacks.onSelect(wasNodeId);
      return;
    }

    if (wasDragMode === 'node' && wasNodeId) {
      const world = this.viewport.screenToWorld(e.clientX, e.clientY);
      const finalX = this.dragNodeStart.x + (world.x - this.dragStartWorld.x);
      const finalY = this.dragNodeStart.y + (world.y - this.dragStartWorld.y);
      this.callbacks.onNodeDragEnd(
        wasNodeId,
        this.dragNodeStart.x,
        this.dragNodeStart.y,
        finalX,
        finalY,
      );
    } else if (wasDragMode === 'edge' && wasNodeId) {
      const targetId = this.pickNodeAtScreen(e.clientX, e.clientY);
      if (targetId && targetId !== wasNodeId) {
        this.callbacks.onEdgeCreate(wasNodeId, targetId);
      }
    }
  }

  /** 处理画布空白处单击 — 由 GraphEngine 转发（因为 viewport 也吃 mousedown） */
  handleBlankClick(): void {
    this.callbacks.onSelect(null);
  }

  // ── 幽灵线 ──

  private updateGhostEdge(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.ghostEdge) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x1, y1, 0),
        new THREE.Vector3(x2, y2, 0),
      ]);
      const material = new THREE.LineDashedMaterial({
        color: 0x4a90e2,
        dashSize: 6,
        gapSize: 4,
      });
      this.ghostEdge = new THREE.Line(geometry, material);
      this.ghostEdge.computeLineDistances();
      this.scene.add(this.ghostEdge);
    } else {
      const positions = new Float32Array([x1, y1, 0, x2, y2, 0]);
      const attr = this.ghostEdge.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.array = positions;
      attr.needsUpdate = true;
      this.ghostEdge.geometry.setDrawRange(0, 2);
      this.ghostEdge.geometry.boundingSphere = null;
      this.ghostEdge.geometry.boundingBox = null;
      this.ghostEdge.computeLineDistances();
    }
  }

  private removeGhostEdge(): void {
    if (this.ghostEdge) {
      this.scene.remove(this.ghostEdge);
      this.ghostEdge.geometry.dispose();
      (this.ghostEdge.material as THREE.Material).dispose();
      this.ghostEdge = null;
    }
  }
}
