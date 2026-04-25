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

type HoverState = 'none' | 'node-center' | 'node-edge';

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

  /** 节点边缘 hover 时的高亮环 */
  private hoverRing: THREE.Mesh | null = null;
  /** 当前 hover 的状态 + 节点 id（None 时 id 为 null） */
  private hoverState: HoverState = 'none';
  private hoverNodeId: string | null = null;
  /** 最近一次 mousemove 事件，rAF 节流用 */
  private pendingMoveEvent: MouseEvent | null = null;
  private rafScheduled = false;

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
    this.hideHoverRing();
    this.domElement.style.cursor = '';
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
      this.domElement.style.cursor = 'crosshair';
    } else {
      this.dragMode = 'node';
      this.domElement.style.cursor = 'grabbing';
    }
    // 拖动开始时清掉 hover ring（避免和拖动视觉混淆）
    this.hideHoverRing();
    this.hoverState = 'none';
    this.hoverNodeId = null;
  }

  private onMouseMove(e: MouseEvent): void {
    // 拖动期间：实时更新 preview / 幽灵线（不节流，要跟手）
    if (this.dragMode !== 'none') {
      const dxScreen = e.clientX - this.dragStartScreen.x;
      const dyScreen = e.clientY - this.dragStartScreen.y;
      if (!this.dragMoved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD) return;
      this.dragMoved = true;

      const world = this.viewport.screenToWorld(e.clientX, e.clientY);
      if (this.dragMode === 'node' && this.dragNodeId) {
        const newX = this.dragNodeStart.x + (world.x - this.dragStartWorld.x);
        const newY = this.dragNodeStart.y + (world.y - this.dragStartWorld.y);
        this.callbacks.onNodeDragMove(this.dragNodeId, newX, newY);
      } else if (this.dragMode === 'edge' && this.dragNodeId) {
        this.updateGhostEdge(this.dragNodeStart.x, this.dragNodeStart.y, world.x, world.y);
      }
      return;
    }

    // 非拖动期间：rAF 节流的 hover 检测
    this.pendingMoveEvent = e;
    if (!this.rafScheduled) {
      this.rafScheduled = true;
      requestAnimationFrame(() => {
        this.rafScheduled = false;
        const ev = this.pendingMoveEvent;
        this.pendingMoveEvent = null;
        if (ev && this.dragMode === 'none') this.updateHover(ev);
      });
    }
  }

  /** rAF 节流的 hover 检测：根据鼠标位置更新 cursor + 高亮环 */
  private updateHover(e: MouseEvent): void {
    const nodeId = this.pickNodeAtScreen(e.clientX, e.clientY);
    if (!nodeId) {
      this.setHoverState('none', null);
      return;
    }
    const mesh = this.getNodeMeshes().get(nodeId);
    if (!mesh) {
      this.setHoverState('none', null);
      return;
    }
    const world = this.viewport.screenToWorld(e.clientX, e.clientY);
    if (this.isOnNodeEdge(mesh, world.x, world.y)) {
      this.setHoverState('node-edge', nodeId);
    } else {
      this.setHoverState('node-center', nodeId);
    }
  }

  /** 状态变化时才更新 cursor / ring（避免无意义重画） */
  private setHoverState(next: HoverState, nodeId: string | null): void {
    if (next === this.hoverState && nodeId === this.hoverNodeId) return;

    this.hoverState = next;
    this.hoverNodeId = nodeId;

    // cursor
    if (next === 'node-center') this.domElement.style.cursor = 'grab';
    else if (next === 'node-edge') this.domElement.style.cursor = 'crosshair';
    else this.domElement.style.cursor = '';

    // 高亮环：仅在 node-edge 时显示
    if (next === 'node-edge' && nodeId) {
      const mesh = this.getNodeMeshes().get(nodeId);
      if (mesh) this.showHoverRing(mesh);
    } else {
      this.hideHoverRing();
    }
  }

  private showHoverRing(targetMesh: THREE.Mesh): void {
    this.hideHoverRing();
    const radius = this.getNodeRadius(targetMesh);
    // 环：内径 = radius+1，外径 = radius+5（节点边缘外一圈）
    const geo = new THREE.RingGeometry(radius + 1, radius + 5, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4a90e2,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(targetMesh.position.x, targetMesh.position.y, 0.5);
    ring.userData = { kind: 'hover-ring' };
    this.scene.add(ring);
    this.hoverRing = ring;
  }

  private hideHoverRing(): void {
    if (!this.hoverRing) return;
    this.scene.remove(this.hoverRing);
    this.hoverRing.geometry.dispose();
    (this.hoverRing.material as THREE.Material).dispose();
    this.hoverRing = null;
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
    // 拖动结束后清光标，由下一次 mousemove 触发的 hover 检测重新设置
    this.domElement.style.cursor = '';

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
