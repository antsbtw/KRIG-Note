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

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    // 正交相机：left/right/top/bottom 在 mount 时按容器尺寸调整
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
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        const objBox = new THREE.Box3().setFromObject(obj);
        if (!objBox.isEmpty()) box.union(objBox);
      } else if (obj instanceof THREE.Group && obj.userData.kind === 'point') {
        // Point group：用其中心 + 假定半径作为框
        const r = (obj.children[0]?.userData?.radius as number) ?? 30;
        box.expandByPoint(new THREE.Vector3(obj.position.x - r, obj.position.y - r, 0));
        box.expandByPoint(new THREE.Vector3(obj.position.x + r, obj.position.y + r, 0));
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

    // 计算所需缩放：内容尺寸 + padding 应该等于容器尺寸
    const scaleX = cw / (size.x + FIT_PADDING * 2);
    const scaleY = ch / (size.y + FIT_PADDING * 2);
    const scale = Math.min(scaleX, scaleY, ZOOM_MAX);

    // 设置相机
    this.camera.left = -cw / 2 / scale;
    this.camera.right = cw / 2 / scale;
    this.camera.top = ch / 2 / scale;
    this.camera.bottom = -ch / 2 / scale;
    this.camera.position.set(center.x, center.y, 10);
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  // ── 内部 ──

  private handleResize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    // 保留当前缩放（用 right-left 算 scale）
    const scale = (this.camera.right - this.camera.left) / Math.max(width, 1);
    this.camera.left = -width / 2 * scale;
    this.camera.right = width / 2 * scale;
    this.camera.top = height / 2 * scale;
    this.camera.bottom = -height / 2 * scale;
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

    // 屏幕坐标 → 世界坐标
    const worldBeforeX = this.camera.left + (mouseX / rect.width) * (this.camera.right - this.camera.left);
    const worldBeforeY = this.camera.top - (mouseY / rect.height) * (this.camera.top - this.camera.bottom);

    const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newWidth = (this.camera.right - this.camera.left) * factor;
    const newHeight = (this.camera.top - this.camera.bottom) * factor;

    // 限制缩放范围（用相机 width 间接控制）
    const minWidth = rect.width / ZOOM_MAX;
    const maxWidth = rect.width / ZOOM_MIN;
    if (newWidth < minWidth || newWidth > maxWidth) return;

    // 让鼠标指向的世界坐标在缩放前后保持不变
    const newLeft = worldBeforeX - (mouseX / rect.width) * newWidth;
    const newTop = worldBeforeY + (mouseY / rect.height) * newHeight;

    this.camera.left = newLeft;
    this.camera.right = newLeft + newWidth;
    this.camera.top = newTop;
    this.camera.bottom = newTop - newHeight;
    this.camera.updateProjectionMatrix();
    this.markDirty();
  };

  // ── 平移（鼠标中键 / 右键） ──

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 1 && e.button !== 2) return;  // 仅中键 / 右键
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
