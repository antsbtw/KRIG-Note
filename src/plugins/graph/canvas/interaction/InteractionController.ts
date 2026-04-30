/// <reference types="vite/client" />
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
  private overlays = new Map<string, THREE.Group>();

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
    /** mouse-down 时 zoom(用于把 screen delta 转世界 delta) */
    startZoom: number;
  } | null = null;

  /** 添加模式 — 用户从 Picker 选了一个 shape/substance,等点击画布放置 */
  private addMode: AddModeSpec | null = null;
  /** 添加模式状态变化回调(给 UI 同步光标 / 提示) */
  private onAddModeChange?: (spec: AddModeSpec | null) => void;
  /** 选区变化回调(给 Inspector 同步显隐) */
  private onSelectionChange?: (ids: string[]) => void;
  /** 节点双击回调(给 Inspector 打开用) */
  private onNodeDoubleClick?: (id: string) => void;

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
    onNodeDoubleClick?: (id: string) => void;
  }) {
    this.container = opts.container;
    this.sceneManager = opts.sceneManager;
    this.nodeRenderer = opts.nodeRenderer;
    this.getInstance = opts.getInstance;
    this.onChange = opts.onChange;
    this.onAddModeChange = opts.onAddModeChange;
    this.onSelectionChange = opts.onSelectionChange;
    this.onNodeDoubleClick = opts.onNodeDoubleClick;
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
    this.setCursor('crosshair');
    this.onAddModeChange?.(spec);
  }

  /** 退出添加模式(ESC / 点空白外、点完一次后自动调用) */
  exitAddMode(): void {
    if (!this.addMode) return;
    this.addMode = null;
    this.setCursor('default');
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
      disposeOverlayGroup(overlay);
    }
    this.overlays.clear();
    this.selected.clear();
    this.dragging = null;
    this.panning = null;
    if (this.addMode) {
      this.addMode = null;
    }
    this.container.style.cursor = '';
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
    const onDblClick  = (e: MouseEvent) => this.handleDoubleClick(e);

    this.container.addEventListener('mousedown', onMouseDown);
    // mousemove / mouseup 挂到 window:鼠标拖出容器仍要继续接收
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.container.addEventListener('keydown', onKeyDown);
    // wheel passive=false 才能 preventDefault(否则 macOS 双指会触发 history navigation)
    this.container.addEventListener('wheel', onWheel, { passive: false });
    this.container.addEventListener('dblclick', onDblClick);

    this.unsubscribers.push(
      () => this.container.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.container.removeEventListener('keydown', onKeyDown),
      () => this.container.removeEventListener('wheel', onWheel),
      () => this.container.removeEventListener('dblclick', onDblClick),
    );
  }

  /** 双击节点 → 触发 onNodeDoubleClick(给 Inspector 打开用)*/
  private handleDoubleClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.addMode) return;
    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);
    const hit = this.hitTest(world);
    if (hit) this.onNodeDoubleClick?.(hit);
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
      this.placeInstance(world, screen);
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
  private placeInstance(world: { x: number; y: number }, _clickScreen?: { x: number; y: number }): void {
    const spec = this.addMode;
    if (!spec) return;

    const size = resolveDefaultSize(spec);
    const id = this.nodeRenderer.nextInstanceId();
    const position = { x: world.x - size.w / 2, y: world.y - size.h / 2 };
    // 调试日志已删除(M1 验证期间用过,坐标对齐已确认)。
    // 留 clickScreen 参数保持 API 一致,M2 加 marquee select 可能再用
    const instance: Instance = {
      id,
      type: spec.kind,
      ref: spec.ref,
      // 居中对齐到点击位置(用户感知"放在我点的地方")
      position,
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
      this.setCursor('grabbing');
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
      this.setCursor('grabbing');
      const screen = this.toContainerCoords(e);
      const dxScreen = screen.x - this.panning.startScreen.x;
      const dyScreen = screen.y - this.panning.startScreen.y;
      // 屏幕 → 世界 delta 直接除 zoom(zoom = "1 世界单位 / 1 CSS 像素")
      const dxWorld = dxScreen / this.panning.startZoom;
      const dyWorld = dyScreen / this.panning.startZoom;
      // pan:鼠标向右拖,viewCenter 应向左移(画面跟手指走)
      this.sceneManager.setView(
        this.panning.startCenter.x - dxWorld,
        this.panning.startCenter.y - dyWorld,
        this.panning.startZoom,
      );
      return;
    }

    // 既不在 drag 也不在 pan:hover hit-test 切 cursor(grab vs default)
    // 添加模式由 enterAddMode/exitAddMode 设 crosshair,不在这里覆盖
    if (this.addMode) return;
    // 鼠标在容器外时 toContainerCoords 会给负值,此时不切;只在容器内
    const rect = this.container.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) return;
    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);
    const hit = this.hitTest(world);
    this.setCursor(hit ? 'grab' : 'default');
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
    // mouseup 后恢复:hover 检测会在下一个 mousemove 立即纠正,这里先清成 default
    if (!this.addMode) this.setCursor('default');
  }

  /** 设置容器 cursor;只在变化时写 DOM 避免高频回流 */
  private currentCursor = '';
  private setCursor(cursor: string): void {
    if (this.currentCursor === cursor) return;
    this.currentCursor = cursor;
    this.container.style.cursor = cursor;
  }

  // ─────────────────────────────────────────────────────────
  // 滚轮(zoom-to-cursor)
  // ─────────────────────────────────────────────────────────

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();   // 阻止 macOS 双指 history navigation
    const view = this.sceneManager.getView();
    if (view.zoom <= 0) return;

    // deltaY > 0:向下滚 = 缩小(zoom 减小)
    // deltaY < 0:向上滚 = 放大(zoom 增大)
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
    const newZoom = view.zoom * factor;

    // 限制 zoom 范围(防数值爆炸或归零)
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    if (clampedZoom === view.zoom) return;

    // zoom-to-cursor:让鼠标下的世界点保持在原屏幕位置
    // newCenter = cursorWorld - (cursorWorld - oldCenter) * (oldZoom / newZoom)
    const screen = this.toContainerCoords(e);
    const cursorWorld = this.sceneManager.screenToWorld(screen.x, screen.y);
    const ratio = view.zoom / clampedZoom;
    const newCenterX = cursorWorld.x - (cursorWorld.x - view.centerX) * ratio;
    const newCenterY = cursorWorld.y - (cursorWorld.y - view.centerY) * ratio;
    this.sceneManager.setView(newCenterX, newCenterY, clampedZoom);
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
          disposeOverlayGroup(overlay);
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
      startZoom: view.zoom,
    };
  }

  /** 同步 overlays 到当前 selected 集合 */
  private refreshOverlays(): void {
    // 删掉不在 selected 里的 overlay
    for (const [id, overlay] of Array.from(this.overlays)) {
      if (!this.selected.has(id) || !this.nodeRenderer.get(id)) {
        this.sceneManager.scene.remove(overlay);
        disposeOverlayGroup(overlay);
        this.overlays.delete(id);
      }
    }
    // 加上新的 / 更新已有的(几何随 position/size 变)
    for (const id of this.selected) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      const existing = this.overlays.get(id);
      if (existing) {
        // 复用 group,重建 4 条边 mesh(node.position/size 可能变了)
        rebuildSelectionBorder(existing, node);
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
const SELECTION_BORDER_WIDTH = 2;    // 边框线宽(世界坐标);用 mesh 拼实现,
                                      // 不依赖 LineBasicMaterial.linewidth(macOS
                                      // WebGL 多数实现忽略这个属性,永远 1px)

/** 滚轮灵敏度:exp(-deltaY * k) 是 zoom factor。k=0.001 时 deltaY=100 → 0.905x(缩小) */
const WHEEL_ZOOM_SENSITIVITY = 0.001;
/** 最大放大:zoom = 50(画板内容放大 50 倍,1 世界单位 = 50 CSS 像素) */
const MAX_ZOOM = 50;
/** 最小缩小:zoom = 0.05(画板内容缩小 20 倍,1 世界单位 = 0.05 CSS 像素) */
const MIN_ZOOM = 0.05;

function isLineKind(node: RenderedNode): boolean {
  return !!node.shapeRef && node.shapeRef.startsWith('krig.line.');
}

/** 释放 overlay group 内所有子 mesh 的 geometry/material */
function disposeOverlayGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) x.dispose(); else (m as THREE.Material).dispose();
  }
}

/**
 * 选中边框 overlay:用 4 个细矩形 fill mesh 拼成边框,而不是 LineSegments
 * 因为 LineBasicMaterial.linewidth 在 macOS WebGL 多数实现里被忽略(永远 1px),
 * 看不清。用 mesh 边宽可控、跨平台稳定。
 */
function makeSelectionOverlay(node: RenderedNode): THREE.Group {
  const group = new THREE.Group();
  rebuildSelectionBorder(group, node);
  return group;
}

/** 重建 group 内的 4 条边 mesh(初始 mount + 每次 size/position 变更都用) */
function rebuildSelectionBorder(group: THREE.Group, node: RenderedNode): void {
  // 清掉旧子节点
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) x.dispose(); else (m as THREE.Material).dispose();
  }

  const x1 = node.position.x - SELECTION_PADDING;
  const y1 = node.position.y - SELECTION_PADDING;
  const x2 = node.position.x + node.size.w + SELECTION_PADDING;
  const y2 = node.position.y + node.size.h + SELECTION_PADDING;
  const w = SELECTION_BORDER_WIDTH;

  const mat = new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, transparent: false });
  // 4 条边 mesh:top / right / bottom / left
  const edges: Array<[number, number, number, number]> = [
    [x1 - w / 2, y1 - w / 2, x2 + w / 2, y1 + w / 2],   // top
    [x2 - w / 2, y1 - w / 2, x2 + w / 2, y2 + w / 2],   // right
    [x1 - w / 2, y2 - w / 2, x2 + w / 2, y2 + w / 2],   // bottom
    [x1 - w / 2, y1 - w / 2, x1 + w / 2, y2 + w / 2],   // left
  ];
  for (const [ex1, ey1, ex2, ey2] of edges) {
    const ew = ex2 - ex1;
    const eh = ey2 - ey1;
    const geom = new THREE.PlaneGeometry(ew, eh);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(ex1 + ew / 2, ey1 + eh / 2, SELECTION_Z);
    group.add(mesh);
  }
}
