/**
 * InteractionController — Basic Graph 视图层交互控制器（B2 + B4.2 选中）。
 *
 * 交互模式（Figma 标准）：
 *   idle         默认状态
 *   panning      中键 / 右键按下，或 空格+左键 → 平移相机
 *   dragging     左键命中 Point → 拖动单个节点（mouseup 触发 onNodeDragEnd）
 *   boxSelecting 左键空白拖动 → 框选（mouseup 触发 onBoxSelectEnd）
 *
 * 关键交互（B4.2 改）：
 *   - 左键点节点         单选 + 进入拖动
 *   - 左键点空白         取消所有选中
 *   - 左键拖空白         框选（不再 pan，跟 Figma 一致）
 *   - Shift/Cmd/Ctrl 点  加选/差选
 *   - 空格 + 左键拖      平移
 *   - 中键 / 右键拖      平移
 *   - Esc                清空选中（GraphView 监听 keydown）
 *
 * 滚轮缩放（zoom）独立于模式，任何时候都可触发；以鼠标位置为锚点。
 */
import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';

const ZOOM_FACTOR_PER_WHEEL_DELTA = 0.0015; // 每像素 wheel delta 对应的缩放比例
const ZOOM_MIN_VIEW_HEIGHT = 50;            // 最小视野（最大放大）
const ZOOM_MAX_VIEW_HEIGHT = 50000;         // 最大视野（最小缩小）

/** 命中结果：拖动开始时返回的节点信息 */
export interface NodeHit {
  /** 'point' 节点（可拖动） / 'line' 边（仅选中） / 'surface' 面（仅选中） */
  kind: 'point' | 'line' | 'surface';
  instanceId: string;
  /** 节点在世界坐标的初始位置（用于 drag 起点；line/surface 不用） */
  worldX: number;
  worldY: number;
  /** 命中的 Object3D（拖动时直接更新它的 .position 实时反馈；line/surface 不用） */
  object: THREE.Object3D;
}

/** 命中测试器：上层把"屏幕坐标 → 节点/边"的查询逻辑注入进来 */
export type NodeHitTester = (worldX: number, worldY: number) => NodeHit | null;

export interface InteractionCallbacks {
  /**
   * 拖动节点结束（mouseup）时调用。
   * 调用方负责把 (worldX, worldY) 写入 presentation atom（pinned + position）。
   */
  onNodeDragEnd?: (info: { instanceId: string; worldX: number; worldY: number }) => void;
  /**
   * 拖动过程中调用（节流：每帧最多一次）。
   * 上层可用来更新连接到该节点的边端点。
   */
  onNodeDrag?: (info: { instanceId: string; worldX: number; worldY: number }) => void;

  /**
   * B4.2 选中事件：左键点击松手时触发。
   *
   * @param instanceId  点中的 instance id；空白处点击为 null
   * @param modifier    'replace' 替换选中集；'toggle' 加入/移出（Shift/Cmd/Ctrl）
   *
   * 调用方负责维护 selectedIds 状态 + 调 GraphRenderer.setSelectedIds 同步视觉。
   */
  onSelect?: (info: { instanceId: string | null; modifier: 'replace' | 'toggle' }) => void;

  /**
   * B4.2 框选过程中调用（每帧）：让上层渲染屏幕坐标的虚线矩形。
   * 屏幕坐标是 canvas 内左上原点像素。
   */
  onBoxSelectUpdate?: (info: { startScreen: { x: number; y: number }; currentScreen: { x: number; y: number } }) => void;

  /**
   * B4.2 框选结束（mouseup）：上层根据 worldRect 找命中节点，更新选中集。
   */
  onBoxSelectEnd?: (info: {
    worldRect: { minX: number; minY: number; maxX: number; maxY: number };
    modifier: 'replace' | 'toggle';
  }) => void;

  /** B4.2 框选取消（如鼠标拖出又拖回未触发命中），让上层清掉 overlay。 */
  onBoxSelectCancel?: () => void;
}

export class InteractionController {
  private dom: HTMLElement | null = null;
  private scene: SceneManager;
  private hitTester: NodeHitTester;
  private callbacks: InteractionCallbacks;

  private mode: 'idle' | 'panning' | 'dragging' | 'boxSelecting' = 'idle';
  private spaceHeld = false;

  // panning 状态
  private panStartScreen = { x: 0, y: 0 };
  private panStartCamera = { x: 0, y: 0 };

  // dragging 状态
  private dragNode: NodeHit | null = null;
  private dragStartScreen = { x: 0, y: 0 };
  private dragStartWorld = { x: 0, y: 0 };
  /** B4.2: 拖动节点是否已超过点击阈值（小于阈值松手 = 单击，不算拖动） */
  private dragMoved = false;

  // B4.2 框选状态
  private boxStartScreen = { x: 0, y: 0 };
  private boxStartWorld = { x: 0, y: 0 };
  /** 框选是否已超过启动阈值（小于阈值松手 = 点空白，不算框选） */
  private boxMoved = false;
  /** 框选/单击时按下的修饰键（mouseup 时用） */
  private clickModifier: 'replace' | 'toggle' = 'replace';

  /** 鼠标按下点（空白）后是否已经决定进入哪种模式：'pending' = 还没决定 */
  private pendingClick = false;
  /** 单击 vs 拖动的像素阈值 */
  private static readonly DRAG_THRESHOLD = 3;

  // 绑定的事件 handler 引用（unmount 时移除）
  private onWheel = this.handleWheel.bind(this);
  private onMouseDown = this.handleMouseDown.bind(this);
  private onMouseMove = this.handleMouseMove.bind(this);
  private onMouseUp = this.handleMouseUp.bind(this);
  private onContextMenu = this.handleContextMenu.bind(this);
  private onKeyDown = this.handleKeyDown.bind(this);
  private onKeyUp = this.handleKeyUp.bind(this);

  constructor(scene: SceneManager, hitTester: NodeHitTester, callbacks: InteractionCallbacks = {}) {
    this.scene = scene;
    this.hitTester = hitTester;
    this.callbacks = callbacks;
  }

  attach(dom: HTMLElement): void {
    this.dom = dom;
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('mousedown', this.onMouseDown);
    // mousemove / mouseup 绑 window，保证拖出容器仍然能跟踪
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    dom.addEventListener('contextmenu', this.onContextMenu);
    // 空格键作为"强制平移"修饰键（避开误碰节点）
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (!this.dom) return;
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.dom = null;
  }

  setCallbacks(cb: InteractionCallbacks): void {
    this.callbacks = cb;
  }

  // ── 屏幕 → 世界坐标转换 ──

  /** 从 mouse event 计算 canvas 内坐标（左上原点像素） */
  private screenFromEvent(e: MouseEvent): { x: number; y: number } {
    const rect = this.dom!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** 把 canvas 像素坐标 (x, y) 转成世界坐标 */
  private worldFromScreen(sx: number, sy: number): { x: number; y: number } {
    const rect = this.dom!.getBoundingClientRect();
    const cam = this.scene.camera;
    // NDC: [-1, 1]; canvas y 向下 → world y 向上 取反
    const ndcX = (sx / rect.width) * 2 - 1;
    const ndcY = -((sy / rect.height) * 2 - 1);
    const halfW = (cam.right - cam.left) / 2;
    const halfH = (cam.top - cam.bottom) / 2;
    return {
      x: cam.position.x + ndcX * halfW,
      y: cam.position.y + ndcY * halfH,
    };
  }

  // ── Wheel 缩放（以鼠标位置为锚点） ──

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const screen = this.screenFromEvent(e);
    const worldBefore = this.worldFromScreen(screen.x, screen.y);

    // wheel up（deltaY < 0）= 放大（viewH 变小）；deltaY > 0 = 缩小
    const factor = Math.exp(e.deltaY * ZOOM_FACTOR_PER_WHEEL_DELTA);
    let newViewH = this.scene.viewWorldHeight * factor;
    newViewH = Math.max(ZOOM_MIN_VIEW_HEIGHT, Math.min(ZOOM_MAX_VIEW_HEIGHT, newViewH));
    if (newViewH === this.scene.viewWorldHeight) return;

    this.applyZoom(newViewH);

    // 应用 zoom 后，把相机移动到让"原本鼠标处的世界坐标"仍然在鼠标下方
    const worldAfter = this.worldFromScreen(screen.x, screen.y);
    this.scene.camera.position.x += worldBefore.x - worldAfter.x;
    this.scene.camera.position.y += worldBefore.y - worldAfter.y;
    this.scene.camera.updateProjectionMatrix();

    // 用户已主动控制视图，清掉 fit 缓存（resize 不再 reset 视野）
    this.scene.invalidateFit();
    this.scene.markDirty();
  }

  /** 应用新的 viewWorldHeight，按当前 aspect 重算 frustum */
  private applyZoom(newViewH: number): void {
    const rect = this.dom!.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const aspect = rect.width / rect.height;
    const halfH = newViewH / 2;
    const halfW = halfH * aspect;
    const cam = this.scene.camera;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    this.scene.viewWorldHeight = newViewH;
  }

  // ── MouseDown：判断进入 panning / dragging ──

  private handleMouseDown(e: MouseEvent): void {
    if (this.mode !== 'idle') return;
    const screen = this.screenFromEvent(e);
    const modifier: 'replace' | 'toggle' =
      e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace';
    this.clickModifier = modifier;

    // 中键（1）/ 右键（2）：直接进入 panning
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.startPan(screen);
      return;
    }

    // 左键（0）— Figma 标准：
    //   1) 空格按住 → 平移
    //   2) 命中节点 → dragging（小位移松手 = 单击选中）
    //   3) 未命中（点空白）→ boxSelecting（小位移松手 = 取消选中）
    if (e.button === 0) {
      if (this.spaceHeld) {
        e.preventDefault();
        this.startPan(screen);
        return;
      }
      const world = this.worldFromScreen(screen.x, screen.y);
      const hit = this.hitTester(world.x, world.y);
      if (hit && hit.kind === 'point') {
        // 节点：进入拖动准备（小位移 = 单击选中）
        e.preventDefault();
        this.mode = 'dragging';
        this.dragNode = hit;
        this.dragStartScreen = screen;
        this.dragStartWorld = world;
        this.dragMoved = false;
        if (this.dom) this.dom.style.cursor = 'grabbing';
      } else if (hit) {
        // 边/面：mousedown 不进任何模式，等 mouseup 触发 onSelect
        // 这里临时记到 dragNode（复用单击分发逻辑），但 dragMoved 永远不会变 true
        e.preventDefault();
        this.mode = 'dragging';
        this.dragNode = hit;
        this.dragStartScreen = screen;
        this.dragStartWorld = world;
        this.dragMoved = false;
      } else {
        e.preventDefault();
        // 进入"待定"框选 — 超过阈值才真正开始画框，否则视为点空白
        this.mode = 'boxSelecting';
        this.boxStartScreen = screen;
        this.boxStartWorld = world;
        this.boxMoved = false;
        this.pendingClick = true;
        if (this.dom) this.dom.style.cursor = 'crosshair';
      }
    }
  }

  private startPan(screen: { x: number; y: number }): void {
    this.mode = 'panning';
    this.panStartScreen = screen;
    this.panStartCamera = { x: this.scene.camera.position.x, y: this.scene.camera.position.y };
    if (this.dom) this.dom.style.cursor = 'grabbing';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !this.spaceHeld) {
      this.spaceHeld = true;
      if (this.dom && this.mode === 'idle') this.dom.style.cursor = 'grab';
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      if (this.dom && this.mode === 'idle') this.dom.style.cursor = '';
    }
  }

  // ── MouseMove：根据 mode 更新视图 ──

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dom) return;

    // idle 状态：mouse 在画布上时做命中测试，更新光标（grab on node / 默认）
    if (this.mode === 'idle') {
      this.updateIdleCursor(e);
      return;
    }

    if (this.mode === 'panning') {
      const screen = this.screenFromEvent(e);
      // dx 像素 → dx 世界单位（按当前 frustum 比例）
      const rect = this.dom.getBoundingClientRect();
      const cam = this.scene.camera;
      const worldPerPxX = (cam.right - cam.left) / rect.width;
      const worldPerPxY = (cam.top - cam.bottom) / rect.height;
      const dxScreen = screen.x - this.panStartScreen.x;
      const dyScreen = screen.y - this.panStartScreen.y;
      // 拖动方向 = 视野反向移动
      cam.position.x = this.panStartCamera.x - dxScreen * worldPerPxX;
      cam.position.y = this.panStartCamera.y + dyScreen * worldPerPxY;
      cam.updateProjectionMatrix();
      this.scene.invalidateFit();
      this.scene.markDirty();
      return;
    }

    if (this.mode === 'dragging' && this.dragNode) {
      const screen = this.screenFromEvent(e);
      const dx = screen.x - this.dragStartScreen.x;
      const dy = screen.y - this.dragStartScreen.y;
      // 阈值前不动：避免单击触发 onNodeDrag 改变位置
      if (!this.dragMoved && Math.hypot(dx, dy) < InteractionController.DRAG_THRESHOLD) return;
      // 边/面：阈值后不进入拖动（仅 point 类支持拖动）
      if (this.dragNode.kind !== 'point') return;
      this.dragMoved = true;
      const world = this.worldFromScreen(screen.x, screen.y);
      const newX = this.dragNode.worldX + (world.x - this.dragStartWorld.x);
      const newY = this.dragNode.worldY + (world.y - this.dragStartWorld.y);
      this.dragNode.object.position.x = newX;
      this.dragNode.object.position.y = newY;
      this.scene.markDirty();
      this.callbacks.onNodeDrag?.({
        instanceId: this.dragNode.instanceId,
        worldX: newX,
        worldY: newY,
      });
      return;
    }

    if (this.mode === 'boxSelecting') {
      const screen = this.screenFromEvent(e);
      const dx = screen.x - this.boxStartScreen.x;
      const dy = screen.y - this.boxStartScreen.y;
      if (!this.boxMoved && Math.hypot(dx, dy) < InteractionController.DRAG_THRESHOLD) return;
      this.boxMoved = true;
      this.pendingClick = false;
      this.callbacks.onBoxSelectUpdate?.({
        startScreen: this.boxStartScreen,
        currentScreen: screen,
      });
    }
  }

  /**
   * idle 状态下根据鼠标位置更新光标：
   *   - 鼠标不在容器内 → 不动（让外面 CSS 控制）
   *   - 空格按住 → grab（强制平移修饰）
   *   - 命中节点 → grab（提示可拖）
   *   - 否则 → ''（默认箭头；预留给未来"框选"场景）
   */
  private updateIdleCursor(e: MouseEvent): void {
    if (!this.dom) return;
    const rect = this.dom.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) return;

    if (this.spaceHeld) {
      this.dom.style.cursor = 'grab';
      return;
    }
    const screen = this.screenFromEvent(e);
    const world = this.worldFromScreen(screen.x, screen.y);
    const hit = this.hitTester(world.x, world.y);
    this.dom.style.cursor = hit ? 'grab' : '';
  }

  // ── MouseUp：结束 panning / dragging ──

  private handleMouseUp(e: MouseEvent): void {
    if (this.mode === 'panning') {
      this.mode = 'idle';
      if (this.dom) this.dom.style.cursor = this.spaceHeld ? 'grab' : '';
      return;
    }

    if (this.mode === 'dragging' && e.button === 0) {
      const node = this.dragNode;
      const moved = this.dragMoved;
      this.mode = 'idle';
      this.dragNode = null;
      this.dragMoved = false;
      if (this.dom) this.dom.style.cursor = '';
      if (!node) return;
      if (moved) {
        this.callbacks.onNodeDragEnd?.({
          instanceId: node.instanceId,
          worldX: node.object.position.x,
          worldY: node.object.position.y,
        });
      } else {
        // 单击节点 = 选中
        this.callbacks.onSelect?.({
          instanceId: node.instanceId,
          modifier: this.clickModifier,
        });
      }
      return;
    }

    if (this.mode === 'boxSelecting' && e.button === 0) {
      const wasMoved = this.boxMoved;
      const startWorld = this.boxStartWorld;
      this.mode = 'idle';
      this.boxMoved = false;
      this.pendingClick = false;
      if (this.dom) this.dom.style.cursor = '';

      if (!wasMoved) {
        // 点空白 = 取消选中（modifier 不影响）
        this.callbacks.onSelect?.({
          instanceId: null,
          modifier: 'replace',
        });
        return;
      }

      // 框选结束 — 算 world rect
      const screen = this.screenFromEvent(e);
      const endWorld = this.worldFromScreen(screen.x, screen.y);
      const minX = Math.min(startWorld.x, endWorld.x);
      const maxX = Math.max(startWorld.x, endWorld.x);
      const minY = Math.min(startWorld.y, endWorld.y);
      const maxY = Math.max(startWorld.y, endWorld.y);
      this.callbacks.onBoxSelectEnd?.({
        worldRect: { minX, minY, maxX, maxY },
        modifier: this.clickModifier,
      });
    }
  }

  /** 阻止右键菜单（右键拖动用） */
  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }
}
