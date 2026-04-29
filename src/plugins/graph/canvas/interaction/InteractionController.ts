import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { NodeRenderer, RenderedNode } from '../scene/NodeRenderer';
import type { Instance } from '../../library/types';

/**
 * InteractionController — 鼠标 / 键盘交互
 *
 * v1 范围:
 * - 单选(click)/ 多选(Shift/Cmd-click)
 * - 拖动 selected nodes(line 实例不能直接拖,要靠两端 instance 移动)
 * - 删除 selected(Delete / Backspace)
 * - 选中态视觉:一层 LineSegments 矩形线框 overlay
 *
 * 不做(留 v1.1):
 * - 框选(drag-select)
 * - 拖动 line 端点(line 端点拾取)
 * - Cmd+Z 撤销 / Cmd+C/V 复制粘贴
 *
 * 不做(M1.3b/c 接管):
 * - pan / zoom(M1.3b)
 * - "添加模式"点击空白实例化(M1.3c)
 */
export class InteractionController {
  private container: HTMLElement;
  private sceneManager: SceneManager;
  private nodeRenderer: NodeRenderer;
  /** id → 原始 Instance(供拖动时改 position 用) */
  private getInstance: (id: string) => Instance | undefined;
  /** 拖动结束的回调(M1.5 持久化用) */
  private onChange?: () => void;

  /** 当前选中的 instance id 集合 */
  private selected = new Set<string>();
  /** instanceId → overlay group(选中态线框) */
  private overlays = new Map<string, THREE.LineSegments>();

  /** 拖动状态 */
  private dragging: {
    startWorld: { x: number; y: number };
    /** 拖动开始时各 selected instance 的原始 position 快照 */
    snapshots: Map<string, { x: number; y: number }>;
  } | null = null;

  /** 待清理的 listener 取消器 */
  private unsubscribers: Array<() => void> = [];

  constructor(opts: {
    container: HTMLElement;
    sceneManager: SceneManager;
    nodeRenderer: NodeRenderer;
    getInstance: (id: string) => Instance | undefined;
    onChange?: () => void;
  }) {
    this.container = opts.container;
    this.sceneManager = opts.sceneManager;
    this.nodeRenderer = opts.nodeRenderer;
    this.getInstance = opts.getInstance;
    this.onChange = opts.onChange;
    this.attachListeners();
  }

  // ─────────────────────────────────────────────────────────
  // 公开 API
  // ─────────────────────────────────────────────────────────

  /** 获取当前选区(只读) */
  getSelection(): string[] {
    return Array.from(this.selected);
  }

  /** 程序化设置选区(主用 M1.4 Inspector 同步状态) */
  setSelection(ids: string[]): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.refreshOverlays();
  }

  clearSelection(): void {
    this.setSelection([]);
  }

  /** 移除所有 listener;CanvasView unmount 时调用 */
  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    for (const overlay of this.overlays.values()) {
      this.sceneManager.scene.remove(overlay);
      overlay.geometry.dispose();
      const m = overlay.material;
      if (Array.isArray(m)) for (const x of m) x.dispose(); else (m as THREE.Material).dispose();
    }
    this.overlays.clear();
    this.selected.clear();
    this.dragging = null;
  }

  // ─────────────────────────────────────────────────────────
  // 事件挂载
  // ─────────────────────────────────────────────────────────

  private attachListeners(): void {
    // 容器要能收键盘事件,设 tabIndex
    if (this.container.tabIndex < 0) this.container.tabIndex = 0;

    const onMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
    const onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
    const onMouseUp   = (e: MouseEvent) => this.handleMouseUp(e);
    const onKeyDown   = (e: KeyboardEvent) => this.handleKeyDown(e);

    this.container.addEventListener('mousedown', onMouseDown);
    // mousemove / mouseup 挂到 window:鼠标拖出容器仍要继续接收
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.container.addEventListener('keydown', onKeyDown);

    this.unsubscribers.push(
      () => this.container.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.container.removeEventListener('keydown', onKeyDown),
    );
  }

  // ─────────────────────────────────────────────────────────
  // 鼠标
  // ─────────────────────────────────────────────────────────

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;  // 只处理左键
    this.container.focus();      // 抢键盘焦点(用于 Delete)

    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);
    const hit = this.hitTest(world);

    const additive = e.shiftKey || e.metaKey;
    if (hit) {
      if (additive) {
        if (this.selected.has(hit)) this.selected.delete(hit);
        else this.selected.add(hit);
      } else {
        if (!this.selected.has(hit)) {
          this.selected.clear();
          this.selected.add(hit);
        }
        // 已选中且非 additive:不变(下面拖动)
      }
      this.refreshOverlays();
      this.startDrag(world);
    } else {
      // 空白处:清选区(下一步 M1.3b 接管成 pan)
      if (!additive) this.clearSelection();
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);
    const dx = world.x - this.dragging.startWorld.x;
    const dy = world.y - this.dragging.startWorld.y;

    for (const [id, snap] of this.dragging.snapshots) {
      const inst = this.getInstance(id);
      if (!inst || !inst.position) continue;
      inst.position.x = snap.x + dx;
      inst.position.y = snap.y + dy;
      // 通知 NodeRenderer 同步 group.position 并重渲染引用 line
      this.nodeRenderer.updateLinesFor(id);
    }
    this.refreshOverlays();
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.dragging) {
      const moved = !!this.dragging.snapshots.size;
      this.dragging = null;
      if (moved) this.onChange?.();
    }
  }

  // ─────────────────────────────────────────────────────────
  // 键盘
  // ─────────────────────────────────────────────────────────

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected.size === 0) return;
      e.preventDefault();
      const ids = Array.from(this.selected);
      this.selected.clear();
      for (const id of ids) {
        // 移除 overlay
        const overlay = this.overlays.get(id);
        if (overlay) {
          this.sceneManager.scene.remove(overlay);
          overlay.geometry.dispose();
          const m = overlay.material;
          if (Array.isArray(m)) for (const x of m) x.dispose(); else (m as THREE.Material).dispose();
          this.overlays.delete(id);
        }
        // NodeRenderer.remove 会级联删引用 line
        this.nodeRenderer.remove(id);
      }
      this.onChange?.();
    } else if (e.key === 'Escape') {
      this.clearSelection();
    }
  }

  // ─────────────────────────────────────────────────────────
  // hit-test / 拖动 / overlay
  // ─────────────────────────────────────────────────────────

  /** AABB hit-test;返回最上层(后渲染)被命中的 instance id,否则 null */
  private hitTest(world: { x: number; y: number }): string | null {
    let best: { id: string; area: number } | null = null;
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      const { position, size } = node;
      // line 的 size 可能是 0(start==end),用一个 padding 让命中带容忍
      if (size.w === 0 && size.h === 0) continue;
      const padding = isLineKind(node) ? 8 : 0;
      const x1 = position.x - padding;
      const y1 = position.y - padding;
      const x2 = position.x + size.w + padding;
      const y2 = position.y + size.h + padding;
      if (world.x >= x1 && world.x <= x2 && world.y >= y1 && world.y <= y2) {
        // 选最小面积(假设小的在更上层 / 更精确)
        const area = size.w * size.h;
        if (!best || area < best.area) best = { id, area };
      }
    }
    return best?.id ?? null;
  }

  private startDrag(startWorld: { x: number; y: number }): void {
    const snapshots = new Map<string, { x: number; y: number }>();
    for (const id of this.selected) {
      const inst = this.getInstance(id);
      if (!inst || !inst.position) continue;  // line 没 position,不参与拖动
      snapshots.set(id, { x: inst.position.x, y: inst.position.y });
    }
    if (snapshots.size === 0) {
      this.dragging = null;
      return;
    }
    this.dragging = { startWorld, snapshots };
  }

  /** 同步 overlays 到当前 selected 集合 */
  private refreshOverlays(): void {
    // 删掉不在 selected 里的 overlay
    for (const [id, overlay] of Array.from(this.overlays)) {
      if (!this.selected.has(id) || !this.nodeRenderer.get(id)) {
        this.sceneManager.scene.remove(overlay);
        overlay.geometry.dispose();
        const m = overlay.material;
        if (Array.isArray(m)) for (const x of m) x.dispose(); else (m as THREE.Material).dispose();
        this.overlays.delete(id);
      }
    }
    // 加上新的 / 更新已有的(几何随 position/size 变)
    for (const id of this.selected) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      const existing = this.overlays.get(id);
      if (existing) {
        // 复用 mesh,刷新顶点
        const points = selectionRectPoints(node);
        const positions = new Float32Array(points.length * 3);
        for (let i = 0; i < points.length; i++) {
          positions[i * 3] = points[i].x;
          positions[i * 3 + 1] = points[i].y;
          positions[i * 3 + 2] = SELECTION_Z;
        }
        existing.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        existing.geometry.attributes.position.needsUpdate = true;
        existing.geometry.computeBoundingSphere();
      } else {
        const overlay = makeSelectionOverlay(node);
        this.sceneManager.scene.add(overlay);
        this.overlays.set(id, overlay);
      }
    }
  }

  /** event 屏幕坐标 → 容器内坐标 */
  private toContainerCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

const SELECTION_Z = 0.02;            // 比 stroke(0.01)高,确保覆盖在最上
const SELECTION_COLOR = 0x4A90E2;
const SELECTION_PADDING = 4;          // 选中线框比节点本身略大,视觉清楚

function isLineKind(node: RenderedNode): boolean {
  return !!node.shapeRef && node.shapeRef.startsWith('krig.line.');
}

function makeSelectionOverlay(node: RenderedNode): THREE.LineSegments {
  const points = selectionRectPoints(node);
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    positions[i * 3] = points[i].x;
    positions[i * 3 + 1] = points[i].y;
    positions[i * 3 + 2] = SELECTION_Z;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: SELECTION_COLOR, linewidth: 2 });
  return new THREE.LineSegments(geom, mat);
}

/** 4 段虚线?暂用实线 4 段连续矩形(LineSegments 每两点一段) */
function selectionRectPoints(node: RenderedNode): Array<{ x: number; y: number }> {
  const x1 = node.position.x - SELECTION_PADDING;
  const y1 = node.position.y - SELECTION_PADDING;
  const x2 = node.position.x + node.size.w + SELECTION_PADDING;
  const y2 = node.position.y + node.size.h + SELECTION_PADDING;
  // 4 边 = 8 个顶点(LineSegments 每对相邻顶点画一段)
  return [
    { x: x1, y: y1 }, { x: x2, y: y1 },     // top
    { x: x2, y: y1 }, { x: x2, y: y2 },     // right
    { x: x2, y: y2 }, { x: x1, y: y2 },     // bottom
    { x: x1, y: y2 }, { x: x1, y: y1 },     // left
  ];
}
