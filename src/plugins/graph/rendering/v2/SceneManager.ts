/**
 * SceneManager — Three.js 场景 + 相机 + 渲染器 + 缩放平移。
 *
 * 视口模型：正交相机（图谱是 2D，z 仅用作分层 sorting）。
 * 平移：鼠标中键 / 右键拖动。
 * 缩放：滚轮（以鼠标位置为中心）。
 * 重置视图：自动 fit 所有几何体到视口（带 padding）。
 */
import * as THREE from 'three';

const BG_COLOR = 0x1e1e1e;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.1;
const FIT_PADDING = 100;  // pixels

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle = 0;
  private dirty = true;

  // 平移状态
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private cameraStart = { x: 0, y: 0 };

  /** 当前视野的"世界单位高度"（决定缩放倍数）。fitView / 滚轮缩放修改它。 */
  private viewWorldHeight = 1000;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    // 正交相机：frustum 在 mount 时按容器 aspect 调整
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    this.camera.position.set(0, 0, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.outline = 'none';

    // ResizeObserver 同步 canvas 尺寸 + 相机
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.handleResize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    this.resizeObserver.observe(container);

    // 初始尺寸
    const rect = container.getBoundingClientRect();
    this.handleResize(rect.width, rect.height);

    // 交互事件
    this.renderer.domElement.addEventListener('wheel', this.handleWheel, { passive: false });
    this.renderer.domElement.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    // 启动渲染循环
    this.startRAF();
  }

  unmount(): void {
    this.stopRAF();
    this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
    this.renderer.domElement.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.container && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.container = null;
  }

  /** 标记需要重新渲染（变更场景内容时调） */
  markDirty(): void {
    this.dirty = true;
  }

  /** 自动 fit 全部几何体到视口（含 padding） */
  fitView(): void {
    const box = new THREE.Box3();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Group && obj.userData.kind === 'point') {
        // Point group：用其中心 + 假定半径作为框
        const r = (obj.children[0]?.userData?.radius as number) ?? 30;
        box.expandByPoint(new THREE.Vector3(obj.position.x - r, obj.position.y - r, 0));
        box.expandByPoint(new THREE.Vector3(obj.position.x + r, obj.position.y + r, 0));
      } else if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        const objBox = new THREE.Box3().setFromObject(obj);
        if (!objBox.isEmpty()) box.union(objBox);
      }
    });

    if (box.isEmpty()) return;

    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const containerRect = this.container?.getBoundingClientRect();
    if (!containerRect) return;
    const cw = containerRect.width;
    const ch = containerRect.height;

    // 计算需要的世界视野高度：让 box 含 padding 完全可见
    // 内容世界宽 / aspect 和内容世界高 取大者作为新 viewWorldHeight
    const aspect = cw / ch;
    const neededByWidth = (size.x + FIT_PADDING * 2) / aspect;
    const neededByHeight = size.y + FIT_PADDING * 2;
    this.viewWorldHeight = Math.max(neededByWidth, neededByHeight);

    // 锁定缩放在 ZOOM_MAX 上限内
    const minWorldHeight = ch / ZOOM_MAX;
    if (this.viewWorldHeight < minWorldHeight) this.viewWorldHeight = minWorldHeight;

    // 应用：调整 frustum + 移动相机到 box 中心
    const halfH = this.viewWorldHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.position.set(center.x, center.y, 10);
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  // ── 内部 ──

  /**
   * 同步 canvas 尺寸 + 相机 aspect。
   *
   * 设计：保留 viewWorldHeight 不变（即"用户感知的缩放"不变），
   *      只按 aspect 算 viewWorldWidth。
   *      camera.position 不动（保留用户视野中心 / fitView 设的中心）。
   */
  /**
   * 同步 canvas 尺寸 + 相机 aspect。
   *
   * 设计：保留 viewWorldHeight 不变（即"用户感知的缩放"不变），
   *      只按 aspect 算 viewWorldWidth。
   *      camera.position 不动（保留用户视野中心 / fitView 设的中心）。
   */
  private handleResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfH = this.viewWorldHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  private startRAF(): void {
    const tick = () => {
      this.rafHandle = requestAnimationFrame(tick);
      if (this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopRAF(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

  // ── 缩放（滚轮） ──

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.container) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 当前世界坐标系：camera.position 是中心，frustum 是相对范围
    // 鼠标对应的世界坐标
    const worldX = this.camera.position.x + this.camera.left + (mouseX / rect.width) * (this.camera.right - this.camera.left);
    const worldY = this.camera.position.y + this.camera.top - (mouseY / rect.height) * (this.camera.top - this.camera.bottom);

    // 计算新 viewWorldHeight
    const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newHeight = this.viewWorldHeight * factor;

    // 限制缩放范围
    const minHeight = rect.height / ZOOM_MAX;
    const maxHeight = rect.height / ZOOM_MIN;
    if (newHeight < minHeight || newHeight > maxHeight) return;

    this.viewWorldHeight = newHeight;
    const aspect = rect.width / rect.height;
    const halfH = newHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;

    // 让鼠标指向的世界坐标在缩放前后保持不变 — 调相机 position
    // 缩放后：worldX = camera.position.x + camera.left + (mouseX / rect.width) * (camera.right - camera.left)
    // 解出 camera.position.x
    this.camera.position.x = worldX - this.camera.left - (mouseX / rect.width) * (this.camera.right - this.camera.left);
    this.camera.position.y = worldY - this.camera.top + (mouseY / rect.height) * (this.camera.top - this.camera.bottom);

    this.camera.updateProjectionMatrix();
    this.markDirty();
  };

  // ── 平移（鼠标左键空白处 / 中键 / 右键） ──
  //
  // 左键空白处：拖动平移（v1 简化：节点 / 边都还不响应 hit-test，所以左键全画布拖动）
  // 中键 / 右键：始终拖动平移
  // D10 加节点拖动后会改为：左键命中节点 = 拖节点；空白 = 拖画布

  private handleMouseDown = (e: MouseEvent): void => {
    // v1 简化：任意按钮都触发画布平移（没有节点 hit-test）
    // D10 加节点拖动后改为：左键命中节点 = 拖节点；空白 = 拖画布
    e.preventDefault();
    this.isPanning = true;
    this.panStart = { x: e.clientX, y: e.clientY };
    this.cameraStart = { x: this.camera.position.x, y: this.camera.position.y };
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isPanning || !this.container) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const dx = (e.clientX - this.panStart.x) / rect.width * (this.camera.right - this.camera.left);
    const dy = (e.clientY - this.panStart.y) / rect.height * (this.camera.top - this.camera.bottom);

    this.camera.position.x = this.cameraStart.x - dx;
    this.camera.position.y = this.cameraStart.y + dy;
    this.camera.updateMatrixWorld();
    this.markDirty();
  };

  private handleMouseUp = (): void => {
    this.isPanning = false;
  };
}
