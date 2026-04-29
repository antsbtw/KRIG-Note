import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { NodeRenderer, RenderedNode } from '../scene/NodeRenderer';
import type { Instance, InstanceKind } from '../../library/types';
import { ShapeRegistry } from '../../library/shapes';
import { SubstanceRegistry } from '../../library/substances';

/**
 * InteractionController — 鼠标 / 键盘交互
 *
 * v1 范围:
 * - 单选(click)/ 多选(Shift/Cmd-click)
 * - 拖动 selected nodes(line 实例不能直接拖,要靠两端 instance 移动)
 * - 删除 selected(Delete / Backspace)
 * - 选中态视觉:一层 LineSegments 矩形线框 overlay
 * - **pan**:空白处拖动平移视口
 * - **zoom**:滚轮缩放,光标位置作为缩放中心
 *
 * 不做(留 v1.1):
 * - 框选(drag-select)— 与 pan 在空白拖动语义冲突,以 modifier 区分留 v1.1
 * - 拖动 line 端点(line 端点拾取)
 * - Cmd+Z 撤销 / Cmd+C/V 复制粘贴
 *
 * 不做(M1.3c 接管):
 * - "添加模式"点击空白实例化
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

  /** 拖动节点状态 */
  private dragging: {
    startWorld: { x: number; y: number };
    /** 拖动开始时各 selected instance 的原始 position 快照 */
    snapshots: Map<string, { x: number; y: number }>;
  } | null = null;

  /** Pan 视口状态 */
  private panning: {
    /** mouse-down 时的容器内屏幕坐标 */
    startScreen: { x: number; y: number };
    /** mouse-down 时 SceneManager 的 viewCenter 快照(世界坐标) */
    startCenter: { x: number; y: number };
    /** mouse-down 时 viewWidth(用于把 screen delta 转世界 delta) */
    startViewWidth: number;
  } | null = null;

  /** 添加模式 — 用户从 Picker 选了一个 shape/substance,等点击画布放置 */
  private addMode: AddModeSpec | null = null;
  /** 添加模式状态变化回调(给 UI 同步光标 / 提示) */
  private onAddModeChange?: (spec: AddModeSpec | null) => void;
  /** 选区变化回调(给 Inspector 同步显隐) */
  private onSelectionChange?: (ids: string[]) => void;

  /** 待清理的 listener 取消器 */
  private unsubscribers: Array<() => void> = [];

  constructor(opts: {
    container: HTMLElement;
    sceneManager: SceneManager;
    nodeRenderer: NodeRenderer;
    getInstance: (id: string) => Instance | undefined;
    onChange?: () => void;
    onAddModeChange?: (spec: AddModeSpec | null) => void;
    onSelectionChange?: (ids: string[]) => void;
  }) {
    this.container = opts.container;
    this.sceneManager = opts.sceneManager;
    this.nodeRenderer = opts.nodeRenderer;
    this.getInstance = opts.getInstance;
    this.onChange = opts.onChange;
    this.onAddModeChange = opts.onAddModeChange;
    this.onSelectionChange = opts.onSelectionChange;
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
    this.notifySelectionChanged();
  }

  clearSelection(): void {
    this.setSelection([]);
  }

  /** 通知监听者选区变化(选择 / 多选 / 删除 / 添加模式新建后都要) */
  private notifySelectionChanged(): void {
    this.onSelectionChange?.(Array.from(this.selected));
  }

  /**
   * 进入添加模式:用户在 Picker 选了一个 shape/substance,等点击画布放置
   * UI 通常会:把光标变 crosshair、show 一个提示("Click to place")
   */
  enterAddMode(spec: AddModeSpec): void {
    this.addMode = spec;
    this.container.style.cursor = 'crosshair';
    this.onAddModeChange?.(spec);
  }

  /** 退出添加模式(ESC / 点空白外、点完一次后自动调用) */
  exitAddMode(): void {
    if (!this.addMode) return;
    this.addMode = null;
    this.container.style.cursor = '';
    this.onAddModeChange?.(null);
  }

  /** 当前是否在添加模式 */
  isAddMode(): boolean {
    return this.addMode !== null;
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
    this.panning = null;
    if (this.addMode) {
      this.container.style.cursor = '';
      this.addMode = null;
    }
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
    const onWheel     = (e: WheelEvent) => this.handleWheel(e);

    this.container.addEventListener('mousedown', onMouseDown);
    // mousemove / mouseup 挂到 window:鼠标拖出容器仍要继续接收
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.container.addEventListener('keydown', onKeyDown);
    // wheel passive=false 才能 preventDefault(否则 macOS 双指会触发 history navigation)
    this.container.addEventListener('wheel', onWheel, { passive: false });

    this.unsubscribers.push(
      () => this.container.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.container.removeEventListener('keydown', onKeyDown),
      () => this.container.removeEventListener('wheel', onWheel),
    );
  }

  // ─────────────────────────────────────────────────────────
  // 鼠标
  // ─────────────────────────────────────────────────────────

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;  // 只处理左键
    this.container.focus();      // 抢键盘焦点(用于 Delete / Escape)

    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);

    // 添加模式:优先级最高,无论命中节点还是空白都视作"放置"
    if (this.addMode) {
      this.placeInstance(world);
      return;
    }

    const hit = this.hitTest(world);
    const additive = e.shiftKey || e.metaKey;
    if (hit) {
      if (additive) {
        if (this.selected.has(hit)) this.selected.delete(hit);
        else this.selected.add(hit);
        this.notifySelectionChanged();
      } else {
        if (!this.selected.has(hit)) {
          this.selected.clear();
          this.selected.add(hit);
          this.notifySelectionChanged();
        }
        // 已选中且非 additive:不变(下面拖动)
      }
      this.refreshOverlays();
      this.startDrag(world);
    } else {
      // 空白处:非 additive 清选区(setSelection 内已 notify),然后进入 pan
      if (!additive) this.clearSelection();
      this.startPan(screen);
    }
  }

  /** 添加模式下点击画布:把当前 spec 实例化到点击的世界坐标 */
  private placeInstance(world: { x: number; y: number }): void {
    const spec = this.addMode;
    if (!spec) return;

    const size = resolveDefaultSize(spec);
    const id = this.nodeRenderer.nextInstanceId();
    const instance: Instance = {
      id,
      type: spec.kind,
      ref: spec.ref,
      // 居中对齐到点击位置(用户感知"放在我点的地方")
      position: { x: world.x - size.w / 2, y: world.y - size.h / 2 },
      size,
    };
    this.nodeRenderer.add(instance);

    // 选中新建的 instance,退出添加模式,通知数据变化
    this.selected.clear();
    this.selected.add(id);
    this.refreshOverlays();
    this.notifySelectionChanged();
    this.exitAddMode();
    this.onChange?.();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.dragging) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      const dx = world.x - this.dragging.startWorld.x;
      const dy = world.y - this.dragging.startWorld.y;
      for (const [id, snap] of this.dragging.snapshots) {
        const inst = this.getInstance(id);
        if (!inst || !inst.position) continue;
        inst.position.x = snap.x + dx;
        inst.position.y = snap.y + dy;
        this.nodeRenderer.updateLinesFor(id);
      }
      this.refreshOverlays();
      return;
    }

    if (this.panning) {
      const screen = this.toContainerCoords(e);
      const dxScreen = screen.x - this.panning.startScreen.x;
      const dyScreen = screen.y - this.panning.startScreen.y;
      // 屏幕 → 世界比例:viewWidth / containerWidth
      const containerW = this.container.clientWidth;
      const containerH = this.container.clientHeight;
      if (containerW === 0 || containerH === 0) return;
      const aspect = containerW / containerH;
      const viewW = this.panning.startViewWidth;
      const viewH = viewW / aspect;
      const dxWorld = (dxScreen / containerW) * viewW;
      const dyWorld = (dyScreen / containerH) * viewH;
      // pan:鼠标向右拖,viewCenter 应向左移(画面跟手指走)
      this.sceneManager.setView(
        this.panning.startCenter.x - dxWorld,
        this.panning.startCenter.y - dyWorld,
        viewW,
      );
      return;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.dragging) {
      const moved = !!this.dragging.snapshots.size;
      this.dragging = null;
      if (moved) this.onChange?.();
    }
    if (this.panning) {
      this.panning = null;
      // pan 不影响数据,不触发 onChange
    }
  }

  // ─────────────────────────────────────────────────────────
  // 滚轮(zoom-to-cursor)
  // ─────────────────────────────────────────────────────────

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();   // 阻止 macOS 双指 history navigation
    const view = this.sceneManager.getView();
    if (view.viewWidth <= 0) return;

    // deltaY > 0:向下滚 = 缩小(zoom out,viewWidth 增大)
    // deltaY < 0:向上滚 = 放大(zoom in,viewWidth 减小)
    const factor = Math.exp(e.deltaY * WHEEL_ZOOM_SENSITIVITY);
    const newViewWidth = view.viewWidth * factor;

    // 限制 zoom 范围(防止数值爆炸或归零)
    const containerW = this.container.clientWidth || 1;
    const minViewWidth = containerW / MAX_ZOOM;     // 最大放大倍数
    const maxViewWidth = containerW * MAX_ZOOM_OUT; // 最大缩小倍数
    const clampedViewWidth = Math.max(minViewWidth, Math.min(maxViewWidth, newViewWidth));
    if (clampedViewWidth === view.viewWidth) return;

    // zoom-to-cursor:让鼠标下世界点保持在原屏幕位置
    const screen = this.toContainerCoords(e);
    const cursorWorld = this.sceneManager.screenToWorld(screen.x, screen.y);
    const ratio = clampedViewWidth / view.viewWidth;
    const newCenterX = cursorWorld.x - (cursorWorld.x - view.centerX) * ratio;
    const newCenterY = cursorWorld.y - (cursorWorld.y - view.centerY) * ratio;
    this.sceneManager.setView(newCenterX, newCenterY, clampedViewWidth);
    // overlay 顶点是世界坐标,zoom 不需要刷新它们(camera 自然把它们映射到屏幕)
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
      this.notifySelectionChanged();
      this.onChange?.();
    } else if (e.key === 'Escape') {
      // 优先级:取消添加模式 → 清选区
      if (this.addMode) {
        this.exitAddMode();
      } else {
        this.clearSelection();
      }
    }
    // M1.3c dev 快捷键(1/2/3 = roundRect/diamond/family.person)已删除 —
    // M1.4b LibraryPicker 上线后,picker 是规范入口
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

  private startPan(startScreen: { x: number; y: number }): void {
    const view = this.sceneManager.getView();
    this.panning = {
      startScreen,
      startCenter: { x: view.centerX, y: view.centerY },
      startViewWidth: view.viewWidth,
    };
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
// 添加模式
// ─────────────────────────────────────────────────────────

/**
 * 描述"要添加什么":由 UI(LibraryPicker)交给 InteractionController
 *
 * - kind:'shape' 或 'substance'
 * - ref:Library 中的资源 id(krig.basic.roundRect / library.family.person 等)
 * - defaultSize:可选;省略时按 shape.viewBox 或 substance 推断尺寸
 */
export interface AddModeSpec {
  kind: InstanceKind;
  ref: string;
  defaultSize?: { w: number; h: number };
}

/** 解析新实例的 size:优先 defaultSize,其次按资源类型推断 */
function resolveDefaultSize(spec: AddModeSpec): { w: number; h: number } {
  if (spec.defaultSize) return spec.defaultSize;
  if (spec.kind === 'shape') {
    const shape = ShapeRegistry.get(spec.ref);
    if (shape) {
      // 大多数 shape 用 100x100 太小,放大到一个对用户视觉合适的默认值
      // line 类比较特殊:start/end 默认拉开 200 像素
      if (shape.category === 'line') return { w: 200, h: 100 };
      return { w: 160, h: 100 };
    }
  } else {
    // substance:从 components 估 bbox
    const def = SubstanceRegistry.get(spec.ref);
    if (def) {
      let maxX = 0, maxY = 0;
      for (const c of def.components) {
        const w = c.transform.w ?? 0;
        const h = c.transform.h ?? 0;
        const right = c.transform.x + (c.transform.anchor === 'center' ? w / 2 : w);
        const bottom = c.transform.y + (c.transform.anchor === 'center' ? h / 2 : h);
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
      }
      if (maxX > 0 && maxY > 0) return { w: maxX, h: maxY };
    }
  }
  return { w: 100, h: 100 };
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

const SELECTION_Z = 0.02;            // 比 stroke(0.01)高,确保覆盖在最上
const SELECTION_COLOR = 0x4A90E2;
const SELECTION_PADDING = 4;          // 选中线框比节点本身略大,视觉清楚

/** 滚轮灵敏度:exp(deltaY * k) 是 zoom factor。k=0.001 时 deltaY=100 → 1.105x */
const WHEEL_ZOOM_SENSITIVITY = 0.001;
/** 最大放大:画板内容相对容器最大放大 50 倍(viewWidth = container/50) */
const MAX_ZOOM = 50;
/** 最大缩小:画板内容相对容器最大缩小 20 倍(viewWidth = container*20) */
const MAX_ZOOM_OUT = 20;

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
