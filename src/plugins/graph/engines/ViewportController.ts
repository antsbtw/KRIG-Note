import * as THREE from 'three';

/**
 * ViewportController — 2D 画布的缩放与平移
 *
 * - 滚轮：缩放（围绕鼠标位置）
 * - 中键拖拽 / Space + 左键 / 右键拖拽：平移
 * - 修改 camera.zoom 与 camera.position.x/y，不改世界坐标
 */

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_SPEED = 0.0015;

export class ViewportController {
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camStartX = 0;
  private camStartY = 0;

  private boundWheel: (e: WheelEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;

  /** 用于拒绝平移的回调 — 比如左键点击在节点上时不应触发画布平移 */
  shouldAllowLeftPan: (e: MouseEvent) => boolean = () => false;

  constructor(
    private camera: THREE.OrthographicCamera,
    private domElement: HTMLElement,
  ) {
    this.boundWheel = this.onWheel.bind(this);
    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);
    this.boundContextMenu = (e: MouseEvent) => e.preventDefault();
  }

  attach(): void {
    this.domElement.addEventListener('wheel', this.boundWheel, { passive: false });
    this.domElement.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mouseup', this.boundMouseUp);
    this.domElement.addEventListener('contextmenu', this.boundContextMenu);
  }

  detach(): void {
    this.domElement.removeEventListener('wheel', this.boundWheel);
    this.domElement.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mouseup', this.boundMouseUp);
    this.domElement.removeEventListener('contextmenu', this.boundContextMenu);
  }

  /** 屏幕坐标 → 世界坐标（考虑当前 zoom + camera.position） */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.domElement.getBoundingClientRect();
    const localX = screenX - rect.left;
    const localY = screenY - rect.top;
    // canvas 中心为视口原点
    const ndcX = localX - rect.width / 2;
    const ndcY = rect.height / 2 - localY;  // y 轴反向
    // 应用 zoom 和 camera position
    return {
      x: ndcX / this.camera.zoom + this.camera.position.x,
      y: ndcY / this.camera.zoom + this.camera.position.y,
    };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    // 围绕鼠标位置缩放：缩放前后该屏幕点的世界坐标保持不变
    const before = this.screenToWorld(e.clientX, e.clientY);

    const factor = Math.exp(-e.deltaY * ZOOM_SPEED);
    let nextZoom = this.camera.zoom * factor;
    nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    this.camera.zoom = nextZoom;
    this.camera.updateProjectionMatrix();

    // 缩放后的同一屏幕点的新世界坐标
    const after = this.screenToWorld(e.clientX, e.clientY);
    // 平移相机让 before == after（视觉上鼠标点固定）
    this.camera.position.x += before.x - after.x;
    this.camera.position.y += before.y - after.y;
  }

  private onMouseDown(e: MouseEvent): void {
    // 中键 / 右键 → 平移
    // 左键 → 由 shouldAllowLeftPan 决定（一般空白处允许，节点上不允许）
    const isPanButton =
      e.button === 1 ||                            // 中键
      e.button === 2 ||                            // 右键
      (e.button === 0 && this.shouldAllowLeftPan(e));

    if (!isPanButton) return;

    e.preventDefault();
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.camStartX = this.camera.position.x;
    this.camStartY = this.camera.position.y;
    this.domElement.style.cursor = 'grabbing';
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const dx = (e.clientX - this.dragStartX) / this.camera.zoom;
    const dy = (e.clientY - this.dragStartY) / this.camera.zoom;
    // 屏幕 y 向下、世界 y 向上
    this.camera.position.x = this.camStartX - dx;
    this.camera.position.y = this.camStartY + dy;
  }

  private onMouseUp(_e: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.domElement.style.cursor = '';
  }

  /** 重置视口到初始状态 */
  reset(): void {
    this.camera.zoom = 1;
    this.camera.position.x = 0;
    this.camera.position.y = 0;
    this.camera.updateProjectionMatrix();
  }
}
