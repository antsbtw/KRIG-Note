/**
 * InteractionController — Basic Graph 视图层交互控制器（B2）。
 *
 * 三种交互模式：
 *   idle      默认状态
 *   panning   中键 / 右键按下 → 平移相机
 *   dragging  左键命中 Point → 拖动单个节点（mouseup 触发 onNodeDragEnd）
 *
 * 滚轮缩放（zoom）独立于模式，任何时候都可触发；
 * 以鼠标位置为锚点：缩放后世界坐标下鼠标指向的点保持不动。
 *
 * 不职责：
 *   - 不管 mesh 表（GraphRenderer 通过 hitTestNode 回调暴露）
 *   - 不写 presentation atom（onNodeDragEnd 把 (id, x, y) 抛给上层，由 GraphView 调 IPC）
 *   - 不动 SceneManager 的 RAF / 渲染（只调 markDirty）
 *
 * 设计：
 *   InteractionController 只读 SceneManager.camera + .markDirty + .invalidateFit；
 *   不直接访问 SceneManager.scene；命中测试由调用方注入 hitTester（避免环依赖）。
 */
import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';

const ZOOM_FACTOR_PER_WHEEL_DELTA = 0.0015; // 每像素 wheel delta 对应的缩放比例
const ZOOM_MIN_VIEW_HEIGHT = 50;            // 最小视野（最大放大）
const ZOOM_MAX_VIEW_HEIGHT = 50000;         // 最大视野（最小缩小）

/** 命中结果：拖动开始时返回的节点信息 */
export interface NodeHit {
  instanceId: string;
  /** 节点在世界坐标的初始位置（用于 drag 起点） */
  worldX: number;
  worldY: number;
  /** 命中的 Object3D（拖动时直接更新它的 .position 实时反馈） */
  object: THREE.Object3D;
}

/** 命中测试器：上层把"屏幕坐标 → 节点"的查询逻辑注入进来 */
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
}

export class InteractionController {
  private dom: HTMLElement | null = null;
  private scene: SceneManager;
  private hitTester: NodeHitTester;
  private callbacks: InteractionCallbacks;

  private mode: 'idle' | 'panning' | 'dragging' = 'idle';
  private spaceHeld = false;

  // panning 状态
  private panStartScreen = { x: 0, y: 0 };
  private panStartCamera = { x: 0, y: 0 };

  // dragging 状态
  private dragNode: NodeHit | null = null;
  private dragStartScreen = { x: 0, y: 0 };
  private dragStartWorld = { x: 0, y: 0 };

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

    // 中键（1）/ 右键（2）：直接进入 panning（鼠标用户的快捷路径）
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.startPan(screen);
      return;
    }

    // 左键（0）：
    //   1) 空格按住 → 强制 panning（避开误碰节点的修饰键）
    //   2) 命中节点 → dragging
    //   3) 未命中（点空白）→ panning（macOS 触摸板友好的默认）
    if (e.button === 0) {
      if (this.spaceHeld) {
        e.preventDefault();
        this.startPan(screen);
        return;
      }
      const world = this.worldFromScreen(screen.x, screen.y);
      const hit = this.hitTester(world.x, world.y);
      if (hit) {
        e.preventDefault();
        this.mode = 'dragging';
        this.dragNode = hit;
        this.dragStartScreen = screen;
        this.dragStartWorld = world;
        if (this.dom) this.dom.style.cursor = 'grabbing';
      } else {
        e.preventDefault();
        this.startPan(screen);
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
      const world = this.worldFromScreen(screen.x, screen.y);
      // 节点新位置 = 节点起始位置 + (鼠标当前 world - 鼠标按下时 world)
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
      // 任何按键起来都结束 panning（不挑剔哪个键开始的）
      this.mode = 'idle';
      if (this.dom) this.dom.style.cursor = this.spaceHeld ? 'grab' : '';
      return;
    }
    if (this.mode === 'dragging' && e.button === 0) {
      const node = this.dragNode;
      this.mode = 'idle';
      this.dragNode = null;
      if (this.dom) this.dom.style.cursor = '';
      if (node) {
        this.callbacks.onNodeDragEnd?.({
          instanceId: node.instanceId,
          worldX: node.object.position.x,
          worldY: node.object.position.y,
        });
      }
    }
  }

  /** 阻止右键菜单（右键拖动用） */
  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }
}
