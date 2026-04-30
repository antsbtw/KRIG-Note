/// <reference types="vite/client" />
import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { NodeRenderer, RenderedNode } from '../scene/NodeRenderer';
import type { HandlesOverlay, HandleKind } from '../scene/HandlesOverlay';
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
  private handlesOverlay: HandlesOverlay;
  /** id → 原始 Instance(供拖动时改 position 用) */
  private getInstance: (id: string) => Instance | undefined;
  /** 拖动结束的回调(M1.5 持久化用) */
  private onChange?: () => void;

  /** 当前选中的 instance id 集合 */
  private selected = new Set<string>();
  /** instanceId → overlay LineLoop(选中态线框) */
  private overlays = new Map<string, THREE.LineLoop>();

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

  /** Resize 状态(8 个边/角 handle 之一) */
  private resizing: {
    instanceId: string;
    handle: Exclude<HandleKind, 'rotate'>;
    /** mouse-down 时的世界坐标 */
    startWorld: { x: number; y: number };
    /** mouse-down 时节点 position / size / rotation 快照 */
    startPos: { x: number; y: number };
    startSize: { w: number; h: number };
    startRotation: number;
  } | null = null;

  /** Rotation 状态(rotation handle) */
  private rotating: {
    instanceId: string;
    /** 节点 bbox 中心(世界坐标) */
    centerWorld: { x: number; y: number };
    /** mouse-down 时鼠标 → 中心连线的角度(度数,顺时针,与 Instance.rotation 同向) */
    startAngle: number;
    /** mouse-down 时节点的 rotation 快照 */
    startRotation: number;
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

  /**
   * Undo/Redo 历史栈
   * 每个原子操作(add / delete / drag end / resize end / rotate end)前调
   * pushHistory() 记录当前 instances 全量快照(v1 数据小,直接全量复制)
   *
   * Cmd+Z 弹 undoStack 顶部 → 应用,把"当前状态"压到 redoStack
   * Cmd+Shift+Z 反之
   */
  private undoStack: Instance[][] = [];
  private redoStack: Instance[][] = [];
  private static readonly HISTORY_LIMIT = 50;

  constructor(opts: {
    container: HTMLElement;
    sceneManager: SceneManager;
    nodeRenderer: NodeRenderer;
    handlesOverlay: HandlesOverlay;
    getInstance: (id: string) => Instance | undefined;
    onChange?: () => void;
    onAddModeChange?: (spec: AddModeSpec | null) => void;
    onSelectionChange?: (ids: string[]) => void;
    onNodeDoubleClick?: (id: string) => void;
  }) {
    this.container = opts.container;
    this.sceneManager = opts.sceneManager;
    this.nodeRenderer = opts.nodeRenderer;
    this.handlesOverlay = opts.handlesOverlay;
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

    // Handle 命中优先(只有单选时 HandlesOverlay 有 target)
    const handleHit = this.handlesOverlay.hitTest(screen.x, screen.y);
    const handleTarget = this.handlesOverlay.getTarget();
    if (handleHit && handleTarget) {
      if (handleHit === 'rotate') {
        this.startRotate(handleTarget, world);
      } else {
        this.startResize(handleTarget, handleHit, world);
      }
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
    this.pushHistory();

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
    if (this.resizing) {
      this.setCursor('grabbing');
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.applyResize(world);
      return;
    }

    if (this.rotating) {
      this.setCursor('grabbing');
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.applyRotate(world, e.shiftKey);
      return;
    }

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

    // 既不在 drag 也不在 pan:hover hit-test 切 cursor(handle / grab / default)
    // 添加模式由 enterAddMode/exitAddMode 设 crosshair,不在这里覆盖
    if (this.addMode) return;
    // 鼠标在容器外时 toContainerCoords 会给负值,此时不切;只在容器内
    const rect = this.container.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) return;
    const screen = this.toContainerCoords(e);
    // handle hover 优先于节点 hover
    const handleHit = this.handlesOverlay.hitTest(screen.x, screen.y);
    if (handleHit) {
      this.setCursor(cursorForHandle(handleHit, this.handlesOverlay.getTarget()?.rotation ?? 0));
      return;
    }
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);
    const hit = this.hitTest(world);
    this.setCursor(hit ? 'grab' : 'default');
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.resizing) {
      this.resizing = null;
      this.onChange?.();
    }
    if (this.rotating) {
      this.rotating = null;
      this.onChange?.();
    }
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
    // Cmd/Ctrl + Z / Shift+Z(undo / redo)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected.size === 0) return;
      e.preventDefault();
      this.pushHistory();
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

  /**
   * OBB hit-test:把 world 点逆变换到节点本地坐标(中心为原点),再做 AABB 测试。
   * 这样旋转后的节点也能精确命中,不会出现"鼠标在 shape 内但点不中"。
   * 返回最上层(后渲染)被命中的 instance id,否则 null
   */
  private hitTest(world: { x: number; y: number }): string | null {
    let best: { id: string; area: number } | null = null;
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      const { position, size } = node;
      // line 的 size 可能是 0(start==end),用一个 padding 让命中带容忍
      if (size.w === 0 && size.h === 0) continue;
      const padding = isLineKind(node) ? 8 : 0;

      // bbox 中心(世界坐标)
      const cx = position.x + size.w / 2;
      const cy = position.y + size.h / 2;
      // world → 本地:平移到中心 + 逆旋转
      const dx = world.x - cx;
      const dy = world.y - cy;
      const rad = -((node.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      // 本地 AABB 测试
      const halfW = size.w / 2 + padding;
      const halfH = size.h / 2 + padding;
      if (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH) {
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
    this.pushHistory();
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

  /** 进入 resize 状态:记录起始尺寸/位置/旋转,后续 mousemove 应用 delta */
  private startResize(
    node: RenderedNode,
    handle: Exclude<HandleKind, 'rotate'>,
    startWorld: { x: number; y: number },
  ): void {
    this.pushHistory();
    this.resizing = {
      instanceId: node.instanceId,
      handle,
      startWorld,
      startPos: { x: node.position.x, y: node.position.y },
      startSize: { w: node.size.w, h: node.size.h },
      startRotation: node.rotation ?? 0,
    };
  }

  /** 进入 rotate 状态:记录中心 + 起始角度 */
  private startRotate(node: RenderedNode, startWorld: { x: number; y: number }): void {
    this.pushHistory();
    const cx = node.position.x + node.size.w / 2;
    const cy = node.position.y + node.size.h / 2;
    // atan2 在 Y-flip 世界里:角度 = atan2(world.y - cy, world.x - cx) * 180/π
    // (Y 向下 = 度数顺时针增长,与 Instance.rotation 同向)
    const startAngle = (Math.atan2(startWorld.y - cy, startWorld.x - cx) * 180) / Math.PI;
    this.rotating = {
      instanceId: node.instanceId,
      centerWorld: { x: cx, y: cy },
      startAngle,
      startRotation: node.rotation ?? 0,
    };
  }

  /**
   * 应用 resize:支持 8 个 handle + 已旋转节点
   * 算法:把 mouse delta 转回节点本地坐标(去 startRotation),按 handle 类型
   * 调整 local 半宽/半高 + 中心位移,再把中心位移转回世界坐标更新 position
   */
  private applyResize(world: { x: number; y: number }): void {
    const r = this.resizing;
    if (!r) return;
    const inst = this.getInstance(r.instanceId);
    if (!inst || !inst.position || !inst.size) return;

    // 起始 bbox 中心(世界)
    const startCx = r.startPos.x + r.startSize.w / 2;
    const startCy = r.startPos.y + r.startSize.h / 2;

    // 鼠标 delta(世界)
    const dx = world.x - r.startWorld.x;
    const dy = world.y - r.startWorld.y;

    // delta 转本地坐标(逆 rotation)
    const rad = (-r.startRotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ldx = dx * cos - dy * sin;
    const ldy = dx * sin + dy * cos;

    // handle → 该 handle 在本地坐标的方向(sx/sy ∈ {-1, 0, 1})
    // sx=-1 表示 west 边(左),+1 表示 east 边(右);sy 同理 north/south
    const dir = handleDir(r.handle);
    const isCorner = dir.x !== 0 && dir.y !== 0;

    // 起始本地半宽/半高
    const startHW = r.startSize.w / 2;
    const startHH = r.startSize.h / 2;
    const minHalf = 5; // 最小半宽,避免缩到 0/负
    let newHW = startHW;
    let newHH = startHH;
    let centerShiftX = 0;  // 本地中心位移
    let centerShiftY = 0;

    if (isCorner) {
      // 角 handle = 等比缩放:沿对角线方向投影
      const startHX = dir.x * startHW;
      const startHY = dir.y * startHH;
      const newHX = startHX + ldx;
      const newHY = startHY + ldy;
      const startLen = Math.hypot(startHX, startHY);
      const proj = (newHX * startHX + newHY * startHY) / startLen;
      const ratio = Math.max(minHalf / Math.min(startHW, startHH), proj / startLen);
      newHW = startHW * ratio;
      newHH = startHH * ratio;
      centerShiftX = dir.x * (newHW - startHW) / 2;
      centerShiftY = dir.y * (newHH - startHH) / 2;
    } else {
      // 边 handle = 单边缩放
      if (dir.x !== 0) {
        newHW = Math.max(minHalf, startHW + dir.x * ldx);
        centerShiftX = dir.x * (newHW - startHW) / 2;
      }
      if (dir.y !== 0) {
        newHH = Math.max(minHalf, startHH + dir.y * ldy);
        centerShiftY = dir.y * (newHH - startHH) / 2;
      }
    }

    // 本地中心位移转回世界
    const cosBack = Math.cos((r.startRotation * Math.PI) / 180);
    const sinBack = Math.sin((r.startRotation * Math.PI) / 180);
    const wShiftX = centerShiftX * cosBack - centerShiftY * sinBack;
    const wShiftY = centerShiftX * sinBack + centerShiftY * cosBack;

    const newCx = startCx + wShiftX;
    const newCy = startCy + wShiftY;
    const newW = newHW * 2;
    const newH = newHH * 2;

    inst.size.w = newW;
    inst.size.h = newH;
    inst.position.x = newCx - newW / 2;
    inst.position.y = newCy - newH / 2;
    this.nodeRenderer.update(inst);
    // update 重建了 group,HandlesOverlay 持有的旧 RenderedNode 失效 → 刷新
    this.handlesOverlay.setTarget(this.nodeRenderer.get(r.instanceId) ?? null);
    this.refreshOverlays();
  }

  /** 应用 rotate:计算当前角度 - 起始角度,加到 startRotation 上 */
  private applyRotate(world: { x: number; y: number }, snap: boolean): void {
    const r = this.rotating;
    if (!r) return;
    const inst = this.getInstance(r.instanceId);
    if (!inst) return;

    const curAngle = (Math.atan2(world.y - r.centerWorld.y, world.x - r.centerWorld.x) * 180) / Math.PI;
    let newRot = r.startRotation + (curAngle - r.startAngle);
    // 归一化到 [-180, 180]
    while (newRot > 180) newRot -= 360;
    while (newRot < -180) newRot += 360;
    if (snap) {
      // Shift 按住 → 吸附到 15 度倍数
      newRot = Math.round(newRot / 15) * 15;
    }

    inst.rotation = newRot;
    this.nodeRenderer.update(inst);
    this.handlesOverlay.setTarget(this.nodeRenderer.get(r.instanceId) ?? null);
    this.refreshOverlays();
  }

  // ─────────────────────────────────────────────────────────
  // Undo / Redo
  // ─────────────────────────────────────────────────────────

  /** 在原子操作前调:把当前 instances 全量快照压入 undo stack,清 redo stack */
  private pushHistory(): void {
    const snap = this.nodeRenderer.listInstances().map(cloneInstance);
    this.undoStack.push(snap);
    if (this.undoStack.length > InteractionController.HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    // 新分支操作 → redo 栈作废
    this.redoStack = [];
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    // 当前状态进 redo
    this.redoStack.push(this.nodeRenderer.listInstances().map(cloneInstance));
    this.applySnapshot(prev);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.nodeRenderer.listInstances().map(cloneInstance));
    this.applySnapshot(next);
  }

  /** 把一份 instances 快照加载回画板:清空,逐个 add,清选区,触发持久化 */
  private applySnapshot(snap: Instance[]): void {
    // 1. 中断进行中的拖动 / resize / rotate(避免回放后状态错乱)
    this.dragging = null;
    this.resizing = null;
    this.rotating = null;

    // 2. 清画板
    this.nodeRenderer.clear();
    // 3. 重新 add(NodeRenderer.add 会走完整渲染管线)
    for (const inst of snap) this.nodeRenderer.add(cloneInstance(inst));

    // 4. 清选区 + handles + overlays
    this.selected.clear();
    for (const [, overlay] of this.overlays) {
      this.sceneManager.scene.remove(overlay);
      disposeOverlayGroup(overlay);
    }
    this.overlays.clear();
    this.handlesOverlay.setTarget(null);
    this.notifySelectionChanged();

    // 5. 触发持久化(把回放后的状态保存)
    this.onChange?.();
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
        // 复用 LineLoop,更新 4 个顶点(node.position/size 可能变了)
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
const SELECTION_PADDING = 0;          // 边框紧贴 shape 边

/** 滚轮灵敏度:exp(-deltaY * k) 是 zoom factor。k=0.001 时 deltaY=100 → 0.905x(缩小) */
const WHEEL_ZOOM_SENSITIVITY = 0.001;
/** 最大放大:zoom = 50(画板内容放大 50 倍,1 世界单位 = 50 CSS 像素) */
const MAX_ZOOM = 50;
/** 最小缩小:zoom = 0.05(画板内容缩小 20 倍,1 世界单位 = 0.05 CSS 像素) */
const MIN_ZOOM = 0.05;

function isLineKind(node: RenderedNode): boolean {
  return !!node.shapeRef && node.shapeRef.startsWith('krig.line.');
}

/** Instance 深拷贝(undo/redo 快照用;v1 数据结构简单,structuredClone 够用) */
function cloneInstance(inst: Instance): Instance {
  return structuredClone(inst);
}

/** Handle 的方向向量(本地坐标;Y 向下) */
function handleDir(h: Exclude<HandleKind, 'rotate'>): { x: number; y: number } {
  switch (h) {
    case 'nw': return { x: -1, y: -1 };
    case 'n':  return { x:  0, y: -1 };
    case 'ne': return { x:  1, y: -1 };
    case 'e':  return { x:  1, y:  0 };
    case 'se': return { x:  1, y:  1 };
    case 's':  return { x:  0, y:  1 };
    case 'sw': return { x: -1, y:  1 };
    case 'w':  return { x: -1, y:  0 };
  }
}

/**
 * 给 handle hover/drag 选择 cursor。
 * 节点旋转后 handle 视觉位置变了,cursor 也要相应旋转
 * (rotation 折算到最近的 8 方位,挑对应 cursor)
 */
function cursorForHandle(h: HandleKind, rotationDeg: number): string {
  if (h === 'rotate') return 'grab';
  // 把 handle 方向旋转到当前角度后,看落在哪个 8 方位 bucket
  const baseDeg: Record<Exclude<HandleKind, 'rotate'>, number> = {
    n: -90, ne: -45, e: 0, se: 45, s: 90, sw: 135, w: 180, nw: -135,
  };
  let deg = (baseDeg[h] + rotationDeg + 360 + 22.5) % 360;
  const bucket = Math.floor(deg / 45);  // 0..7
  // bucket 0..7 → e, se, s, sw, w, nw, n, ne
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize',
                   'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return cursors[bucket];
}

/** 释放 LineLoop 的 geometry/material */
function disposeOverlayGroup(loop: THREE.LineLoop): void {
  loop.geometry.dispose();
  const m = loop.material;
  if (Array.isArray(m)) for (const x of m) x.dispose(); else (m as THREE.Material).dispose();
}

/**
 * 选中边框 overlay:用 LineLoop 描节点 bbox 边框
 * (之前用 4 个 PlaneGeometry mesh 在 Y-flip frustum 下偶发渲染异常,
 *  且 handles 已是清晰的选中视觉指示,边框只需轻量 1px 蓝线)
 */
function makeSelectionOverlay(node: RenderedNode): THREE.LineLoop {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: SELECTION_COLOR });
  const loop = new THREE.LineLoop(geom, mat);
  rebuildSelectionBorder(loop, node);
  return loop;
}

/**
 * 更新 LineLoop 的 4 个顶点(初始 mount + 每次 size/position 变更都用)
 * 节点旋转时,4 顶点绕 bbox 中心做对应旋转(OBB),让边框紧贴旋转后的 shape
 */
function rebuildSelectionBorder(loop: THREE.LineLoop, node: RenderedNode): void {
  const cx = node.position.x + node.size.w / 2;
  const cy = node.position.y + node.size.h / 2;
  const halfW = node.size.w / 2 + SELECTION_PADDING;
  const halfH = node.size.h / 2 + SELECTION_PADDING;
  const rad = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const z = SELECTION_Z;

  // 4 个本地角点(相对中心),经 rotation 转回世界
  const corners: Array<[number, number]> = [
    [-halfW, -halfH],   // 左上
    [ halfW, -halfH],   // 右上
    [ halfW,  halfH],   // 右下
    [-halfW,  halfH],   // 左下
  ];
  const attr = loop.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < 4; i++) {
    const [lx, ly] = corners[i];
    arr[i * 3]     = cx + lx * cos - ly * sin;
    arr[i * 3 + 1] = cy + lx * sin + ly * cos;
    arr[i * 3 + 2] = z;
  }
  attr.needsUpdate = true;
  loop.geometry.computeBoundingSphere();
}
