/// <reference types="vite/client" />
import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { NodeRenderer, RenderedNode } from '../scene/NodeRenderer';
import type { HandlesOverlay, HandleKind } from '../scene/HandlesOverlay';
import type { Instance, InstanceKind } from '../../library/types';
import { ShapeRegistry } from '../../library/shapes';
import { SubstanceRegistry } from '../../library/substances';
import { findClosestMagnet, listMagnets, MAGNET_SNAP_RADIUS_PX } from './magnet-snap';
import { renderLine, updateLineGeometry, generateLinePoints, setLineHighlight } from '../scene/LineRenderer';
import { isTextNodeRef } from '../edit/atom-bridge';

/** 文字节点(krig.text.label)只允许左右 resize;高度由内容自动撑 */
const TEXT_NODE_RESIZE_HANDLES = new Set<Exclude<HandleKind, 'rotate'>>(['e', 'w']);

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

  /** Marquee 框选状态(M1.x.9,单指空白拖动) */
  private marquee: {
    /** mouse-down 时的世界坐标 */
    startWorld: { x: number; y: number };
    /** 当前世界坐标(随 mousemove 更新) */
    currentWorld: { x: number; y: number };
    /** 框选 overlay group(画半透明蓝色矩形) */
    overlayGroup: THREE.Group;
    /** 是否 additive(Shift/Cmd 按住时加到现有 selection,否则替换) */
    additive: boolean;
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

  /** 画 line 状态(M1.x.7,addMode + line spec 触发) */
  private drawingLine: {
    /** 起点 magnet 所属 instance id */
    startInstanceId: string;
    /** 起点 magnet id */
    startMagnetId: string;
    /** 起点世界坐标(按 instance + magnet 解析,绑定后不再变) */
    startWorld: { x: number; y: number };
    /** 当前预览 line ref(同 addMode.spec.ref) */
    lineRef: string;
    /** 预览 line 的 THREE.Group(挂在 sceneManager.scene) */
    previewGroup: THREE.Group;
  } | null = null;

  /** Magnet 提示 overlay:hover shape / 画 line 时显示该 shape 的 magnet 点 */
  private magnetHints = new Map<string, THREE.Group>();

  /** 当前 hover 高亮的 line id(用于切换时还原前一个的颜色) */
  private hoveredLineId: string | null = null;

  /**
   * Line 端点 handle:line 单选时显示 2 个端点小圆(替代常规 8 resize handle)
   * 仅当选中实例是 line 时存在;切换选区时清掉
   */
  private lineEndpointHandles: {
    instanceId: string;
    /** 端点 0 / 端点 1 各一个 mesh */
    handles: [THREE.Mesh, THREE.Mesh];
    group: THREE.Group;
  } | null = null;

  /** Rewire 状态(拖 line 端点改连接) */
  private rewiring: {
    instanceId: string;
    /** 拖的是哪一端(0 = endpoints[0], 1 = endpoints[1]) */
    endpointIndex: 0 | 1;
    /** 起始 endpoints 快照(失败 / ESC 时还原) */
    startEndpoints: [
      { instance: string; magnet: string },
      { instance: string; magnet: string },
    ];
  } | null = null;

  /** 添加模式 — 用户从 Picker 选了一个 shape/substance,等点击画布放置 */
  private addMode: AddModeSpec | null = null;
  /** 添加模式状态变化回调(给 UI 同步光标 / 提示) */
  private onAddModeChange?: (spec: AddModeSpec | null) => void;
  /** 选区变化回调(给 Inspector 同步显隐) */
  private onSelectionChange?: (ids: string[]) => void;
  /** 节点双击回调(给 Inspector 打开用) */
  private onNodeDoubleClick?: (id: string) => void;
  /** 右键 / 双指点击回调(给 ContextMenu 打开用,viewport 像素坐标) */
  private onContextMenu?: (x: number, y: number, selectedIds: string[]) => void;

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
    onContextMenu?: (x: number, y: number, selectedIds: string[]) => void;
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
    this.onContextMenu = opts.onContextMenu;
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
    this.cancelDrawingLine();
    this.clearMagnetHints();
    this.setCursor('default');
    this.onAddModeChange?.(null);
  }

  /** 当前是否在添加模式 */
  isAddMode(): boolean {
    return this.addMode !== null;
  }

  /**
   * 删除当前选中的实例(给 ContextMenu 等外部调用)
   * 与 Delete 键路径一致:pushHistory + 级联删 line + 通知选区变化
   */
  deleteSelected(): void {
    if (this.selected.size === 0) return;
    this.pushHistory();
    const ids = Array.from(this.selected);
    this.selected.clear();
    for (const id of ids) {
      const overlay = this.overlays.get(id);
      if (overlay) {
        this.sceneManager.scene.remove(overlay);
        disposeOverlayGroup(overlay);
        this.overlays.delete(id);
      }
      this.nodeRenderer.remove(id);
    }
    this.notifySelectionChanged();
    this.onChange?.();
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
    this.cancelMarquee();
    this.cancelDrawingLine();
    this.cancelRewire();
    this.clearMagnetHints();
    this.clearLineEndpointHandles();
    this.hoveredLineId = null;
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
    const onCtxMenu   = (e: MouseEvent) => this.handleContextMenu(e);

    this.container.addEventListener('mousedown', onMouseDown);
    // mousemove / mouseup 挂到 window:鼠标拖出容器仍要继续接收
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.container.addEventListener('keydown', onKeyDown);
    // wheel passive=false 才能 preventDefault(否则 macOS 双指会触发 history navigation)
    this.container.addEventListener('wheel', onWheel, { passive: false });
    this.container.addEventListener('dblclick', onDblClick);
    this.container.addEventListener('contextmenu', onCtxMenu);

    this.unsubscribers.push(
      () => this.container.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.container.removeEventListener('keydown', onKeyDown),
      () => this.container.removeEventListener('wheel', onWheel),
      () => this.container.removeEventListener('dblclick', onDblClick),
      () => this.container.removeEventListener('contextmenu', onCtxMenu),
    );
  }

  /**
   * 右键 / trackpad 双指点击 → 弹 ContextMenu
   * - 命中节点(且未选中):先选中再弹
   * - 命中节点(已选中):保留多选状态弹(让用户对多选执行 combine 等)
   * - 命中空白:不弹(M1 范围;v1.1 可加"添加..."等空白菜单)
   */
  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.addMode || this.drawingLine || this.rewiring || this.marquee) return;
    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);
    const hit = this.hitTest(world);
    if (!hit) return; // 空白处:暂不弹(v1)

    // 如果右键的节点不在 selected 中,先单选它(类比 macOS 文件管理器)
    if (!this.selected.has(hit)) {
      this.selected.clear();
      this.selected.add(hit);
      this.refreshOverlays();
      this.notifySelectionChanged();
    }
    // viewport 像素坐标传给 React(ContextMenu 用 position: fixed)
    this.onContextMenu?.(e.clientX, e.clientY, Array.from(this.selected));
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

    // 添加模式:优先级最高
    if (this.addMode) {
      // line 类 shape 走"press-drag-release 画线"模式:
      // mousedown 必须在某 magnet 16px 内,否则取消(不创建悬空 line)
      if (this.isAddingLine()) {
        this.tryStartDrawingLine(world);
        return;
      }
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

    // line 端点 handle 命中(单选 line 时显示)→ 进入 rewire 状态
    const epIdx = this.hitTestLineEndpointHandle(world);
    if (epIdx !== null && this.lineEndpointHandles) {
      this.startRewire(this.lineEndpointHandles.instanceId, epIdx);
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
      // 空白处:非 additive 清选区,进入框选(marquee select)
      // pan 走 wheel 事件(macOS 双指拖动),不再占用单指 mousedown
      if (!additive) this.clearSelection();
      this.startMarquee(world, additive);
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
    // 文字节点(M2.1):创建时初始化空 doc 字段(NoteView 同源)
    // 双击节点会进入编辑态(M2.1.6)
    if (spec.ref === 'krig.text.label') {
      instance.doc = [];
    }
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
    // 画 line 中:更新预览 line 终点(吸附到附近 magnet 或跟鼠标)
    if (this.drawingLine) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.updateDrawingLine(world);
      return;
    }

    // Rewire 中:更新被拖端点(吸附到附近 magnet 或跟鼠标)
    if (this.rewiring) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.updateRewire(world);
      return;
    }

    // addMode 是 line 时:hover 显示候选 shape 的 magnet 点提示
    if (this.isAddingLine()) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.refreshMagnetHintsForHover(world);
      return;
    }

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

    if (this.marquee) {
      this.setCursor('crosshair');
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.marquee.currentWorld = world;
      rebuildMarqueeOverlay(this.marquee.overlayGroup, this.marquee.startWorld, world);
      return;
    }

    // 既不在 drag 也不在 marquee:hover hit-test 切 cursor(handle / grab / default)
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

    // hover 命中 line → 高亮(若是 line);切换或离开则还原
    const hitNode = hit ? this.nodeRenderer.get(hit) : null;
    const newHoveredLine = hitNode && isLineKind(hitNode) ? hit : null;
    if (newHoveredLine !== this.hoveredLineId) {
      // 还原旧
      if (this.hoveredLineId) {
        const old = this.nodeRenderer.get(this.hoveredLineId);
        if (old) setLineHighlight(old.group, false);
      }
      // 高亮新
      if (newHoveredLine) {
        const node = this.nodeRenderer.get(newHoveredLine);
        if (node) setLineHighlight(node.group, true);
      }
      this.hoveredLineId = newHoveredLine;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.drawingLine) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.tryFinishDrawingLine(world);
      return;
    }
    if (this.rewiring) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.tryFinishRewire(world);
      return;
    }
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
    if (this.marquee) {
      this.finishMarquee();
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

    // macOS 手势规约:
    // - 双指 pinch  → wheel + ctrlKey=true  → zoom-to-cursor
    // - 双指拖动    → wheel + ctrlKey=false → pan
    // - 鼠标滚轮    → wheel + ctrlKey=false,但 deltaMode=DOM_DELTA_LINE
    //   (双指拖动是 DOM_DELTA_PIXEL),用 deltaMode 兼容物理鼠标 zoom
    const isPinchZoom = e.ctrlKey;
    const isMouseWheel = e.deltaMode !== 0; // 0 = DOM_DELTA_PIXEL(trackpad)

    if (isPinchZoom || isMouseWheel) {
      // ── Zoom-to-cursor ──
      // pinch 单次 deltaY 很小(~10px),物理鼠标滚轮一格 deltaY 较大(~100+),
      // 两者用不同灵敏度:pinch 5x 加倍,鼠标滚轮保持原值
      const sensitivity = isPinchZoom
        ? WHEEL_ZOOM_SENSITIVITY * 5
        : WHEEL_ZOOM_SENSITIVITY;
      const factor = Math.exp(-e.deltaY * sensitivity);
      const newZoom = view.zoom * factor;
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      if (clampedZoom === view.zoom) return;

      const screen = this.toContainerCoords(e);
      const cursorWorld = this.sceneManager.screenToWorld(screen.x, screen.y);
      const ratio = view.zoom / clampedZoom;
      const newCenterX = cursorWorld.x - (cursorWorld.x - view.centerX) * ratio;
      const newCenterY = cursorWorld.y - (cursorWorld.y - view.centerY) * ratio;
      this.sceneManager.setView(newCenterX, newCenterY, clampedZoom);
    } else {
      // ── Pan(双指拖动)──
      // wheel deltaX/Y 是屏幕像素增量(trackpad 双指拖)→ 转世界坐标
      const dxWorld = e.deltaX / view.zoom;
      const dyWorld = e.deltaY / view.zoom;
      this.sceneManager.setView(
        view.centerX + dxWorld,
        view.centerY + dyWorld,
        view.zoom,
      );
    }
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
      // 优先级:取消 marquee → 取消 rewire → 取消画线 → 取消添加模式 → 清选区
      if (this.marquee) {
        this.cancelMarquee();
      } else if (this.rewiring) {
        this.cancelRewire();
      } else if (this.drawingLine) {
        this.cancelDrawingLine();
      } else if (this.addMode) {
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
    // 优先检测 line(走"距离曲线",阈值小,不易抢 shape 命中);
    // 然后检测 shape(走 OBB AABB)
    const lineThreshold = LINE_HIT_THRESHOLD_PX / Math.max(this.sceneManager.getView().zoom, 0.01);
    let bestLine: { id: string; dist: number } | null = null;
    let bestShape: { id: string; area: number } | null = null;

    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;

      if (isLineKind(node)) {
        // line:距离曲线采样点的最小距离 < 阈值才算命中
        const inst = this.getInstance(id);
        if (!inst) continue;
        const ep = this.resolveLineWorldEndpoints(inst);
        if (!ep) continue;
        const pts = generateLinePoints(inst.ref, ep.start, ep.end);
        const dist = distancePointToPolyline(world.x, world.y, pts);
        if (dist <= lineThreshold && (!bestLine || dist < bestLine.dist)) {
          bestLine = { id, dist };
        }
        continue;
      }

      // shape:OBB AABB
      const { position, size } = node;
      if (size.w === 0 && size.h === 0) continue;
      const cx = position.x + size.w / 2;
      const cy = position.y + size.h / 2;
      const dx = world.x - cx;
      const dy = world.y - cy;
      const rad = -((node.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const halfW = size.w / 2;
      const halfH = size.h / 2;
      if (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH) {
        const area = size.w * size.h;
        if (!bestShape || area < bestShape.area) bestShape = { id, area };
      }
    }
    // line 优先(line 在 shape 之上的视觉,且通常 line 距离阈值很小,
    // 命中 line 时用户必然是在精确点 line)
    return bestLine?.id ?? bestShape?.id ?? null;
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

  // ─────────────────────────────────────────────────────────
  // 画 line(M1.x.7)
  // ─────────────────────────────────────────────────────────

  /** 当前 addMode 是否在添加 line 类 shape */
  private isAddingLine(): boolean {
    if (!this.addMode || this.addMode.kind !== 'shape') return false;
    const shape = ShapeRegistry.get(this.addMode.ref);
    return shape?.category === 'line';
  }

  /** 收集所有候选 magnet 节点(供 findClosestMagnet 用) */
  private allMagnetCandidates(): Array<{ node: RenderedNode; instance: Instance }> {
    const out: Array<{ node: RenderedNode; instance: Instance }> = [];
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      const inst = this.getInstance(id);
      if (node && inst) out.push({ node, instance: inst });
    }
    return out;
  }

  /** 屏幕像素 → 世界距离(用于 magnet 吸附半径换算) */
  private snapRadiusWorld(): number {
    const zoom = this.sceneManager.getView().zoom;
    return MAGNET_SNAP_RADIUS_PX / Math.max(zoom, 0.01);
  }

  /** mousedown 在 magnet 附近 → 起手画线;否则取消 addMode */
  private tryStartDrawingLine(world: { x: number; y: number }): void {
    if (!this.addMode) return;
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
    );
    if (!closest) {
      // 没命中 magnet:不创建悬空 line,直接取消 addMode
      this.exitAddMode();
      return;
    }
    const lineRef = this.addMode.ref;
    const startWorld = { x: closest.magnet.x, y: closest.magnet.y };
    // 创建预览 line(start = magnet, end = magnet,长度 0)
    const previewGroup = renderLine(lineRef, {
      start: startWorld,
      end: startWorld,
    });
    this.sceneManager.scene.add(previewGroup);
    this.drawingLine = {
      startInstanceId: closest.magnet.instanceId,
      startMagnetId: closest.magnet.magnetId,
      startWorld,
      lineRef,
      previewGroup,
    };
  }

  /** mousemove:更新预览 line 终点(吸附附近 magnet 或跟鼠标) */
  private updateDrawingLine(world: { x: number; y: number }): void {
    if (!this.drawingLine) return;
    const exclude = new Set([this.drawingLine.startInstanceId]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    const end = closest ? { x: closest.magnet.x, y: closest.magnet.y } : world;
    updateLineGeometry(
      this.drawingLine.previewGroup,
      this.drawingLine.lineRef,
      this.drawingLine.startWorld,
      end,
    );
  }

  /** mouseup:落点在 magnet 附近 → 创建 line;否则取消 */
  private tryFinishDrawingLine(world: { x: number; y: number }): void {
    if (!this.drawingLine) return;
    const drawing = this.drawingLine;
    // 清掉预览 line(无论成败)
    this.sceneManager.scene.remove(drawing.previewGroup);
    disposeLineGroup(drawing.previewGroup);
    this.drawingLine = null;

    const exclude = new Set([drawing.startInstanceId]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    if (!closest) {
      // 落空:不创建 line,直接退出 addMode
      this.exitAddMode();
      return;
    }

    // 创建带 endpoints 的 line instance
    this.pushHistory();
    const id = this.nodeRenderer.nextInstanceId();
    const instance: Instance = {
      id,
      type: 'shape',
      ref: drawing.lineRef,
      endpoints: [
        { instance: drawing.startInstanceId, magnet: drawing.startMagnetId },
        { instance: closest.magnet.instanceId, magnet: closest.magnet.magnetId },
      ],
    };
    this.nodeRenderer.add(instance);

    // 选中新创建的 line + 退出 addMode
    this.selected.clear();
    this.selected.add(id);
    this.refreshOverlays();
    this.notifySelectionChanged();
    this.exitAddMode();
    this.onChange?.();
  }

  /** ESC / unmount 时取消画 line(清掉预览 group) */
  private cancelDrawingLine(): void {
    if (!this.drawingLine) return;
    this.sceneManager.scene.remove(this.drawingLine.previewGroup);
    disposeLineGroup(this.drawingLine.previewGroup);
    this.drawingLine = null;
  }

  // ─────────────────────────────────────────────────────────
  // Rewire(M1.x.7b)— 拖 line 端点改连接
  // ─────────────────────────────────────────────────────────

  /** 进入 rewire 状态:记录 line 实例 + 拖的哪一端 + 起始 endpoints 快照 */
  private startRewire(instanceId: string, endpointIndex: 0 | 1): void {
    const inst = this.getInstance(instanceId);
    if (!inst || !inst.endpoints) return;
    this.pushHistory();
    this.rewiring = {
      instanceId,
      endpointIndex,
      startEndpoints: [
        { ...inst.endpoints[0] },
        { ...inst.endpoints[1] },
      ],
    };
    // 进 rewire 时显示所有候选 shape 的 magnet 点(除 line 自身的另一端 instance,
    // 避免连到原 instance 的另一个 magnet 也算"重连同一节点"— 这是允许的,
    // 但视觉上要让用户看到所有候选)
    this.showMagnetHintsFor((id) => id !== instanceId);
  }

  /**
   * mousemove:line 几何跟随鼠标(吸附附近 magnet 或跟手),不改 Instance.endpoints
   * (避免 endpoints 字段不支持"自由坐标"的限制)。直接改 line group 的几何 buffer。
   * mouseup 命中 magnet 才正式写 endpoints。
   */
  private updateRewire(world: { x: number; y: number }): void {
    if (!this.rewiring) return;
    const inst = this.getInstance(this.rewiring.instanceId);
    if (!inst || !inst.endpoints) return;
    const node = this.nodeRenderer.get(this.rewiring.instanceId);
    if (!node) return;

    // 解析另一端的世界坐标(rewire 中固定不动)
    const otherIdx = this.rewiring.endpointIndex === 0 ? 1 : 0;
    const otherEp = this.rewiring.startEndpoints[otherIdx];
    const otherPair = (() => {
      const n = this.nodeRenderer.get(otherEp.instance);
      const i = this.getInstance(otherEp.instance);
      return n && i ? { node: n, instance: i } : null;
    })();
    if (!otherPair) return;
    const otherMagnet = listMagnets(otherPair.node, otherPair.instance)
      .find((m) => m.magnetId === otherEp.magnet);
    if (!otherMagnet) return;
    const fixedEnd = { x: otherMagnet.x, y: otherMagnet.y };

    // 找被拖端的位置:吸附附近 magnet,否则跟鼠标
    const exclude = new Set([otherEp.instance]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    const draggedEnd = closest
      ? { x: closest.magnet.x, y: closest.magnet.y }
      : { x: world.x, y: world.y };

    // 根据拖的是哪端,组装 start/end
    const start = this.rewiring.endpointIndex === 0 ? draggedEnd : fixedEnd;
    const end = this.rewiring.endpointIndex === 0 ? fixedEnd : draggedEnd;

    // 直接改 line group 的几何(不动 Instance.endpoints)
    updateLineGeometry(node.group, inst.ref, start, end);

    // 同步更新 endpoint handles 的位置(被拖端跟着鼠标 / magnet)
    if (this.lineEndpointHandles &&
        this.lineEndpointHandles.instanceId === this.rewiring.instanceId) {
      this.lineEndpointHandles.handles[this.rewiring.endpointIndex]
        .position.set(draggedEnd.x, draggedEnd.y, MAGNET_HINT_Z);
    }
  }

  /** mouseup:落点是否吸附到 magnet;落空则还原原 endpoints */
  private tryFinishRewire(world: { x: number; y: number }): void {
    if (!this.rewiring) return;
    const r = this.rewiring;
    this.rewiring = null;
    this.clearMagnetHints();
    const inst = this.getInstance(r.instanceId);
    if (!inst || !inst.endpoints) return;

    const otherIdx = r.endpointIndex === 0 ? 1 : 0;
    const otherInst = r.startEndpoints[otherIdx].instance;
    const exclude = new Set([otherInst]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    if (closest) {
      // 写入新 endpoints + 重新渲染线 + 持久化
      inst.endpoints[r.endpointIndex] = {
        instance: closest.magnet.instanceId,
        magnet: closest.magnet.magnetId,
      };
      // updateLinesFor 只刷线几何,不重建 group(保留 lineEndpointHandles)
      this.nodeRenderer.updateLinesFor(closest.magnet.instanceId);
      this.refreshOverlays();   // 刷新 endpoint handles 位置
      this.onChange?.();
    } else {
      // 落空:还原原 endpoints + 用原 endpoints 刷几何
      inst.endpoints[0] = { ...r.startEndpoints[0] };
      inst.endpoints[1] = { ...r.startEndpoints[1] };
      // 用任一端 instance 触发 updateLinesFor
      this.nodeRenderer.updateLinesFor(r.startEndpoints[0].instance);
      this.refreshOverlays();
      if (this.undoStack.length > 0) this.undoStack.pop();
    }
  }

  /** ESC / unmount:还原起始 endpoints */
  private cancelRewire(): void {
    if (!this.rewiring) return;
    const r = this.rewiring;
    this.rewiring = null;
    this.clearMagnetHints();
    const inst = this.getInstance(r.instanceId);
    if (inst && inst.endpoints) {
      inst.endpoints[0] = { ...r.startEndpoints[0] };
      inst.endpoints[1] = { ...r.startEndpoints[1] };
      this.nodeRenderer.updateLinesFor(r.startEndpoints[0].instance);
      this.refreshOverlays();
    }
    if (this.undoStack.length > 0) this.undoStack.pop();
  }

  // ─────────────────────────────────────────────────────────
  // Marquee 框选(M1.x.9)
  // ─────────────────────────────────────────────────────────

  private startMarquee(startWorld: { x: number; y: number }, additive: boolean): void {
    const overlayGroup = new THREE.Group();
    rebuildMarqueeOverlay(overlayGroup, startWorld, startWorld);
    this.sceneManager.scene.add(overlayGroup);
    this.marquee = {
      startWorld,
      currentWorld: startWorld,
      overlayGroup,
      additive,
    };
  }

  /** mouseup:计算框选矩形内的 shape,加入 selected */
  private finishMarquee(): void {
    if (!this.marquee) return;
    const { startWorld, currentWorld, additive, overlayGroup } = this.marquee;
    this.marquee = null;
    this.sceneManager.scene.remove(overlayGroup);
    disposeMarqueeOverlay(overlayGroup);

    // 框选矩形的 AABB(可能反向拖)
    const minX = Math.min(startWorld.x, currentWorld.x);
    const maxX = Math.max(startWorld.x, currentWorld.x);
    const minY = Math.min(startWorld.y, currentWorld.y);
    const maxY = Math.max(startWorld.y, currentWorld.y);

    // 太小的框(单击空白)→ 当作"清选区"已经在 mousedown 处理;这里不动
    if (maxX - minX < 2 && maxY - minY < 2) {
      this.notifySelectionChanged();
      return;
    }

    // 找所有 shape 中心落在框内的(line 用 bbox 中心;substance 同 shape)
    if (!additive) this.selected.clear();
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      const cx = node.position.x + node.size.w / 2;
      const cy = node.position.y + node.size.h / 2;
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
        this.selected.add(id);
      }
    }
    this.refreshOverlays();
    this.notifySelectionChanged();
  }

  private cancelMarquee(): void {
    if (!this.marquee) return;
    this.sceneManager.scene.remove(this.marquee.overlayGroup);
    disposeMarqueeOverlay(this.marquee.overlayGroup);
    this.marquee = null;
  }

  /**
   * hover 显示 magnet 提示:
   * - 画线中:显示除起点 instance 外所有 shape 的 magnet 点
   * - 仅 addMode 是 line(未起手):只显示鼠标 hover 的 shape 的 magnet 点
   */
  private refreshMagnetHintsForHover(world: { x: number; y: number }): void {
    if (this.drawingLine) {
      // 画线中:显示所有候选 shape 的 magnet,除了起点 instance
      this.showMagnetHintsFor((id) => id !== this.drawingLine!.startInstanceId);
      return;
    }
    // 起手前:鼠标接近 shape(命中 OR 在吸附范围内)→ 显该 shape 的 magnet
    // 不能只依赖 hitTest:magnet 在 shape 边缘,鼠标接近 magnet 时常常已在 shape 外
    const proximityIds = this.findShapesNearMouse(world);
    if (proximityIds.size === 0) {
      this.clearMagnetHints();
      return;
    }
    this.showMagnetHintsFor((id) => proximityIds.has(id));
  }

  /**
   * 找鼠标附近的 shape:命中本体 + 距任意 magnet ≤ snapRadius
   * 用于"鼠标接近边缘 magnet 时"也能显示候选 shape 的所有 magnets
   */
  private findShapesNearMouse(world: { x: number; y: number }): Set<string> {
    const radius = this.snapRadiusWorld();
    const ids = new Set<string>();
    // 1. hit 命中 shape 本体
    const hit = this.hitTest(world);
    if (hit) ids.add(hit);
    // 2. 距任意 magnet 在 radius 内的 shape
    for (const { node, instance } of this.allMagnetCandidates()) {
      if (ids.has(instance.id)) continue;
      const magnets = listMagnets(node, instance);
      for (const m of magnets) {
        const d = Math.hypot(world.x - m.x, world.y - m.y);
        if (d <= radius) {
          ids.add(instance.id);
          break;
        }
      }
    }
    return ids;
  }

  /** 在指定 instance 上显示 magnet 点(过滤函数返回 true 的 instance 才显) */
  private showMagnetHintsFor(filter: (id: string) => boolean): void {
    const wantedIds = new Set<string>();
    for (const id of this.nodeRenderer.ids()) {
      if (!filter(id)) continue;
      const node = this.nodeRenderer.get(id);
      const inst = this.getInstance(id);
      if (!node || !inst) continue;
      // 没 magnets 的 shape 跳过(line 类 / 无定义)
      if (listMagnets(node, inst).length === 0) continue;
      wantedIds.add(id);
    }
    // 删多余
    for (const [id, group] of Array.from(this.magnetHints)) {
      if (!wantedIds.has(id)) {
        this.sceneManager.scene.remove(group);
        disposeMagnetHintGroup(group);
        this.magnetHints.delete(id);
      }
    }
    // 加新 / 更新已有(magnet 位置可能因节点拖动 / 旋转变化)
    for (const id of wantedIds) {
      const node = this.nodeRenderer.get(id)!;
      const inst = this.getInstance(id)!;
      const existing = this.magnetHints.get(id);
      if (existing) {
        rebuildMagnetHintDots(existing, node, inst);
      } else {
        const group = makeMagnetHintGroup(node, inst);
        this.sceneManager.scene.add(group);
        this.magnetHints.set(id, group);
      }
    }
  }

  private clearMagnetHints(): void {
    for (const group of this.magnetHints.values()) {
      this.sceneManager.scene.remove(group);
      disposeMagnetHintGroup(group);
    }
    this.magnetHints.clear();
  }

  /** 进入 resize 状态:记录起始尺寸/位置/旋转,后续 mousemove 应用 delta */
  private startResize(
    node: RenderedNode,
    handle: Exclude<HandleKind, 'rotate'>,
    startWorld: { x: number; y: number },
  ): void {
    // 文字节点防御:只允许左右 handle resize;HandlesOverlay 已 filter 不显示
    // N/S/4 角 handle,这里是双保险(避免未来 hitTest 改动 / 键盘触发等绕过)
    if (isTextNodeRef(node.shapeRef) && !TEXT_NODE_RESIZE_HANDLES.has(handle)) return;
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

  /**
   * 强制刷新选中态 overlays(选区线框 + line endpoint handles).
   * 文字节点 async 渲染完成扩 size 后,CanvasView 用这个让线框跟上.
   */
  refreshSelectionOverlays(): void {
    this.refreshOverlays();
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
    // line 实例不显矩形选中边框(它的 bbox 是端点 AABB,框个矩形没意义);
    // 选中视觉用 LineRenderer 自身高亮即可(M1.x.8 再做)
    for (const id of this.selected) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      if (isLineKind(node)) continue;
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
    // 单选 line 时显示 2 个端点 handle(供 rewire);其它情况清掉
    this.refreshLineEndpointHandles();
  }

  /** 单选 line 时显示 2 个端点 handle(rewire 入口) */
  private refreshLineEndpointHandles(): void {
    const ids = Array.from(this.selected);
    const single = ids.length === 1 ? this.nodeRenderer.get(ids[0]) : null;
    const isLine = single && isLineKind(single);
    if (!isLine) {
      this.clearLineEndpointHandles();
      return;
    }
    const inst = this.getInstance(single.instanceId);
    if (!inst) return;
    // 解析端点世界坐标
    const ep = this.resolveLineWorldEndpoints(inst);
    if (!ep) {
      this.clearLineEndpointHandles();
      return;
    }
    if (this.lineEndpointHandles && this.lineEndpointHandles.instanceId === single.instanceId) {
      // 复用,只更新位置(端点 magnet 可能因节点拖动变化)
      this.lineEndpointHandles.handles[0].position.set(ep.start.x, ep.start.y, MAGNET_HINT_Z);
      this.lineEndpointHandles.handles[1].position.set(ep.end.x, ep.end.y, MAGNET_HINT_Z);
    } else {
      // 切换 instance:清旧建新
      this.clearLineEndpointHandles();
      const group = new THREE.Group();
      const h0 = makeEndpointHandleMesh();
      const h1 = makeEndpointHandleMesh();
      h0.position.set(ep.start.x, ep.start.y, MAGNET_HINT_Z);
      h1.position.set(ep.end.x, ep.end.y, MAGNET_HINT_Z);
      group.add(h0);
      group.add(h1);
      this.sceneManager.scene.add(group);
      this.lineEndpointHandles = {
        instanceId: single.instanceId,
        handles: [h0, h1],
        group,
      };
    }
  }

  private clearLineEndpointHandles(): void {
    if (!this.lineEndpointHandles) return;
    this.sceneManager.scene.remove(this.lineEndpointHandles.group);
    for (const m of this.lineEndpointHandles.handles) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lineEndpointHandles = null;
  }

  /** 解析一条 line 实例两端的世界坐标(走 magnet-snap.resolveLineEndpoints) */
  private resolveLineWorldEndpoints(
    inst: Instance,
  ): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
    if (!inst.endpoints) return null;
    // 直接用 magnet-snap 的 helper
    const _resolveOther = (id: string) => {
      const n = this.nodeRenderer.get(id);
      const i = this.getInstance(id);
      return n && i ? { node: n, instance: i } : null;
    };
    // 复用现有 resolveMagnet
    const a = inst.endpoints[0];
    const b = inst.endpoints[1];
    const aPair = _resolveOther(a.instance);
    const bPair = _resolveOther(b.instance);
    if (!aPair || !bPair) return null;
    const start = listMagnets(aPair.node, aPair.instance).find((m) => m.magnetId === a.magnet);
    const end = listMagnets(bPair.node, bPair.instance).find((m) => m.magnetId === b.magnet);
    if (!start || !end) return null;
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }

  /** Hit-test:屏幕坐标 → line 端点 index(0 / 1),否则 null */
  private hitTestLineEndpointHandle(world: { x: number; y: number }): 0 | 1 | null {
    if (!this.lineEndpointHandles) return null;
    const handles = this.lineEndpointHandles.handles;
    // endpoint handle 视觉半径 6 世界单位,hit 半径放宽到 12 世界单位
    // (低 zoom 下 = 小 px 也好点;不用 snapRadiusWorld 因为那是屏幕像素折算,
    //  端点本身就是世界坐标固定大小,折算反而 zoom 大时半径过大抢 shape)
    const radius = 12;
    for (let i = 0; i < 2; i++) {
      const p = handles[i].position;
      const d = Math.hypot(world.x - p.x, world.y - p.y);
      if (d <= radius) return i as 0 | 1;
    }
    return null;
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
    // 文字节点(M2.1):宽 200 / 高 40 — 对齐 Freeform "Type to enter text" 视觉尺寸
    if (spec.ref === 'krig.text.label') return { w: 200, h: 40 };
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
/** Line hit-test 阈值(屏幕像素;距离曲线采样点 ≤ 此值算命中) */
const LINE_HIT_THRESHOLD_PX = 10;

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

// ─────────────────────────────────────────────────────────
// 画 line(M1.x.7)helpers
// ─────────────────────────────────────────────────────────

const MAGNET_HINT_COLOR = 0x4A90E2;
const MAGNET_HINT_RADIUS_PX = 4;       // 屏幕像素 — 通过 group.scale=1/zoom 折算
const MAGNET_HINT_Z = 0.04;            // 略低于 handles(0.05),不抢交互

/** 释放预览 line group 的 geometry/material(LineRenderer 输出 group 内含 1 条 Line) */
function disposeLineGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const line = child as THREE.Line;
    if (line.geometry) line.geometry.dispose();
    const m = line.material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
}

/** 创建一个节点的 magnet 提示 group(N/S/E/W 等点) */
function makeMagnetHintGroup(node: RenderedNode, inst: Instance): THREE.Group {
  const group = new THREE.Group();
  rebuildMagnetHintDots(group, node, inst);
  return group;
}

/**
 * 重建 group 内的 magnet 点 mesh
 * 每个 magnet 一个 CircleGeometry,顶点是世界坐标(已含 rotation 变换);
 * 半径用世界坐标(因为 group.scale=1,不像 HandlesOverlay 那样用 1/zoom)
 * — 简化处理:小圆,zoom 很小时也看得见
 */
function rebuildMagnetHintDots(group: THREE.Group, node: RenderedNode, inst: Instance): void {
  // 清旧
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
  // listMagnets 已含 rotation 变换的世界坐标
  const dots = listMagnets(node, inst);
  for (const m of dots) {
    // 半径取 max(节点半最小边的 0.04, 4 世界单位),保证视觉可见
    const r = Math.max(Math.min(node.size.w, node.size.h) * 0.04, 4);
    const geom = new THREE.CircleGeometry(r, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: MAGNET_HINT_COLOR,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(m.x, m.y, MAGNET_HINT_Z);
    group.add(mesh);
  }
  // 防御:radius 用了像素的话(MAGNET_HINT_RADIUS_PX)留作未来切到 1/zoom 缩放体系的入口
  void MAGNET_HINT_RADIUS_PX;
}

function disposeMagnetHintGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
}

/**
 * 点到折线最短距离:把折线拆成连续线段,逐段算点-线段距离,取最小
 * line 的曲线渲染前已采样为多段折线(generateLinePoints 输出),所以这个就够
 */
function distancePointToPolyline(
  px: number, py: number,
  pts: Array<{ x: number; y: number }>,
): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y);
  let minD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distancePointToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < minD) minD = d;
  }
  return minD;
}

/** 点到线段距离(标准公式) */
function distancePointToSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Line endpoint handle:line 选中时显示在两端的小蓝圆,供用户拖拽 rewire
 * 半径 6 世界单位(在低 zoom 下也清晰可点);颜色比 magnet hint 更深
 */
function makeEndpointHandleMesh(): THREE.Mesh {
  const geom = new THREE.CircleGeometry(6, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2E5C8A,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geom, mat);
}

// ─────────────────────────────────────────────────────────
// Marquee 框选 helpers(M1.x.9)
// ─────────────────────────────────────────────────────────

const MARQUEE_FILL_COLOR = 0x4A90E2;
const MARQUEE_BORDER_COLOR = 0x4A90E2;
const MARQUEE_Z = 0.03;

/** 重建框选 overlay:1 个半透明 fill mesh + 1 个 LineLoop 边框 */
function rebuildMarqueeOverlay(
  group: THREE.Group,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  // 清旧
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if ('geometry' in child) (child as THREE.Mesh).geometry?.dispose();
    const m = (child as THREE.Mesh).material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  // 半透明蓝色 fill
  const fillGeom = new THREE.PlaneGeometry(w, h);
  const fillMat = new THREE.MeshBasicMaterial({
    color: MARQUEE_FILL_COLOR,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);
  fill.position.set(minX + w / 2, minY + h / 2, MARQUEE_Z);
  group.add(fill);

  // 边框(LineLoop)
  const borderGeom = new THREE.BufferGeometry();
  borderGeom.setAttribute('position', new THREE.Float32BufferAttribute([
    minX, minY, MARQUEE_Z,
    maxX, minY, MARQUEE_Z,
    maxX, maxY, MARQUEE_Z,
    minX, maxY, MARQUEE_Z,
  ], 3));
  const borderMat = new THREE.LineBasicMaterial({ color: MARQUEE_BORDER_COLOR });
  const border = new THREE.LineLoop(borderGeom, borderMat);
  border.renderOrder = 2;
  group.add(border);
}

function disposeMarqueeOverlay(group: THREE.Group): void {
  for (const child of group.children) {
    if ('geometry' in child) (child as THREE.Mesh).geometry?.dispose();
    const m = (child as THREE.Mesh).material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
}
