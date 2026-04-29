import * as THREE from 'three';

/**
 * SceneManager — Three.js 底座
 *
 * 职责:
 * - 创建 scene + 正交相机 + WebGLRenderer
 * - 处理容器 resize(ResizeObserver)
 * - 处理 Retina(setPixelRatio + setSize 第三参 true)
 * - RAF 渲染循环
 * - fitToContent(NaN 防御)
 * - dispose
 *
 * **不**做:节点渲染管线(M1.2b)、交互(M1.3)、UI(M1.4)。
 *
 * 坐标系约定(对齐 path-to-three.ts):
 * - X 向右,Y **向下**,Z 朝外(正交相机看 -Z)。所有 shape mesh 都是 z=0 平面
 *   上的 2D 几何。
 * - "世界坐标"等于 Canvas 像素坐标(画板坐标系):shape mesh.position 直接
 *   等于其在画板上的左上角(或 transform.x/y 对应的锚点)。
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private rafHandle: number | null = null;
  private disposed = false;

  /** 当前画板的世界坐标视口(camera frustum 中心 + 宽高,单位:画板像素) */
  private viewCenter = { x: 0, y: 0 };
  private viewWidth = 0;   // 画板坐标系下 camera 看到的宽
  private viewHeight = 0;

  constructor(container: HTMLElement) {
    if (!container) {
      throw new Error('[SceneManager] container is required');
    }
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1e1e1e');

    // 正交相机(2D 画板专用)。frustum 由 fitToContent 或 setView 决定;
    // 默认占位一个像素的 frustum,后续 first-resize 会立刻修正。
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.z = 10;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(this.renderer.domElement);

    // ResizeObserver:容器变了同步 renderer + camera
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // 立刻处理一次 resize(初始尺寸)
    this.handleResize();

    // 起 RAF
    this.startRAF();
  }

  // ─────────────────────────────────────────────────────────
  // resize / camera
  // ─────────────────────────────────────────────────────────

  private handleResize(): void {
    if (this.disposed) return;
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    // ⚠️ 第三参数必须 true,否则 Retina canvas DOM 撑成 2 倍 CSS 像素超出容器
    this.renderer.setSize(clientWidth, clientHeight, true);

    // viewWidth/viewHeight 默认锁定到容器像素大小(zoom=1)
    if (this.viewWidth === 0 || this.viewHeight === 0) {
      this.viewWidth = clientWidth;
      this.viewHeight = clientHeight;
      this.viewCenter = { x: clientWidth / 2, y: clientHeight / 2 };
    }
    this.applyCamera();
  }

  /** 把 viewCenter / viewWidth / viewHeight 应用到 camera frustum */
  private applyCamera(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;

    // Y 向下:top < bottom(在 OrthographicCamera 里 top 比 bottom 数值大,
    // 但我们的世界 Y 向下,所以传 -Y 给 camera 实现"看下来 Y 增加"的视觉)。
    // 做法:camera.up = (0, -1, 0),frustum 用世界坐标直接传。
    const halfW = this.viewWidth / 2;
    const halfH = this.viewHeight / 2;
    this.camera.left = this.viewCenter.x - halfW;
    this.camera.right = this.viewCenter.x + halfW;
    this.camera.top = this.viewCenter.y - halfH;     // Y 向下:top 比 bottom 小
    this.camera.bottom = this.viewCenter.y + halfH;
    this.camera.position.x = this.viewCenter.x;
    this.camera.position.y = this.viewCenter.y;
    this.camera.up.set(0, -1, 0);
    this.camera.lookAt(this.viewCenter.x, this.viewCenter.y, 0);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 把 camera 视口设为 [x1..x2] × [y1..y2](世界坐标),自动 padding 10%
   * 适配画板尺寸到容器尺寸(letterbox,保持比例)。
   *
   * ⚠️ NaN 防御:setFromObject(scene) 含退化几何时返回 NaN box,导致
   * camera frustum 全 NaN,画面空白。4 分量 isFinite 检查不过则跳过。
   */
  fitToBox(box: { minX: number; minY: number; maxX: number; maxY: number }, padding = 0.1): boolean {
    if (
      !Number.isFinite(box.minX) || !Number.isFinite(box.minY) ||
      !Number.isFinite(box.maxX) || !Number.isFinite(box.maxY)
    ) {
      console.warn('[SceneManager] fitToBox skipped: non-finite box', box);
      return false;
    }
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w <= 0 || h <= 0) {
      console.warn('[SceneManager] fitToBox skipped: zero/negative size', box);
      return false;
    }
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const padW = w * (1 + padding);
    const padH = h * (1 + padding);
    // letterbox:按容器宽高比放大,保证 padW/padH 都装得下
    const { clientWidth, clientHeight } = this.container;
    const containerAspect = clientWidth / clientHeight;
    const boxAspect = padW / padH;
    let viewW: number, viewH: number;
    if (boxAspect > containerAspect) {
      viewW = padW;
      viewH = padW / containerAspect;
    } else {
      viewH = padH;
      viewW = padH * containerAspect;
    }
    this.viewCenter = { x: cx, y: cy };
    this.viewWidth = viewW;
    this.viewHeight = viewH;
    this.applyCamera();
    return true;
  }

  /** 用 scene 的 bounding box 触发 fitToBox(便利方法) */
  fitToContent(padding = 0.1): boolean {
    const box = new THREE.Box3();
    box.setFromObject(this.scene);
    return this.fitToBox(
      { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y },
      padding,
    );
  }

  /** 直接设视口中心 + 宽(高按容器比例自适应);用于 pan / zoom 控制 */
  setView(centerX: number, centerY: number, viewWidth: number): void {
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(viewWidth) || viewWidth <= 0) {
      console.warn('[SceneManager] setView ignored:', { centerX, centerY, viewWidth });
      return;
    }
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0) return;
    const aspect = clientWidth / clientHeight;
    this.viewCenter = { x: centerX, y: centerY };
    this.viewWidth = viewWidth;
    this.viewHeight = viewWidth / aspect;
    this.applyCamera();
  }

  getView(): { centerX: number; centerY: number; viewWidth: number; viewHeight: number } {
    return {
      centerX: this.viewCenter.x,
      centerY: this.viewCenter.y,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 屏幕 ↔ 世界坐标互转(交互模块要用)
  // ─────────────────────────────────────────────────────────

  /** CSS 像素的容器内坐标 → 世界坐标 */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return { x: 0, y: 0 };
    const ndcX = (screenX / clientWidth) * 2 - 1;
    const ndcY = (screenY / clientHeight) * 2 - 1;
    // 与 applyCamera 中的 frustum 对齐:left/right + top/bottom 已经是世界坐标
    const halfW = this.viewWidth / 2;
    const halfH = this.viewHeight / 2;
    return {
      x: this.viewCenter.x + ndcX * halfW,
      y: this.viewCenter.y + ndcY * halfH,
    };
  }

  /** 世界坐标 → CSS 像素的容器内坐标 */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const { clientWidth, clientHeight } = this.container;
    const halfW = this.viewWidth / 2;
    const halfH = this.viewHeight / 2;
    const ndcX = (worldX - this.viewCenter.x) / halfW;
    const ndcY = (worldY - this.viewCenter.y) / halfH;
    return {
      x: ((ndcX + 1) / 2) * clientWidth,
      y: ((ndcY + 1) / 2) * clientHeight,
    };
  }

  // ─────────────────────────────────────────────────────────
  // RAF
  // ─────────────────────────────────────────────────────────

  private startRAF(): void {
    const tick = () => {
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  // ─────────────────────────────────────────────────────────
  // dispose
  // ─────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.resizeObserver.disconnect();
    // 清理 scene 上的 geometry / material / textures
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else if (material) {
        material.dispose();
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
