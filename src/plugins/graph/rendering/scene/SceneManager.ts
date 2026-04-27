/**
 * SceneManager — 极简 Three.js 场景管理（B1a）。
 *
 * 职责：
 *   - 创建场景 + 正交相机 + WebGL 渲染器
 *   - mount 到 DOM 容器
 *   - ResizeObserver 同步 canvas 尺寸 + 相机 aspect
 *   - RAF 渲染循环（仅 dirty 时渲染，节省 GPU）
 *
 * 不职责（B 阶段后续添加）：
 *   - 鼠标交互（拖动 / 缩放 / 平移）— B2 加
 *   - 自动 fit 视图 — B5 加
 *   - 节点 / 边 / 几何体管理 — 上层 GraphRenderer 负责
 *
 * 设计：
 *   相机视野固定 = viewWorldHeight × aspect 世界单位
 *   默认 viewWorldHeight = 800（足够看 4-10 个节点）
 *   B 阶段调用方可手动改 viewWorldHeight 调整缩放
 */
import * as THREE from 'three';

const BG_COLOR = 0x1e1e1e;

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  /** 视野的"世界单位高度"。默认 800 = 看到 800 单位高的范围。 */
  viewWorldHeight = 800;

  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle = 0;
  private dirty = true;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    // 正交相机：mount 时按 aspect 算 frustum
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

    // ResizeObserver 同步尺寸
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.handleResize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    this.resizeObserver.observe(container);

    // 初始尺寸（ResizeObserver 第一次 fire 通常很快但保险起见手动算）
    const rect = container.getBoundingClientRect();
    this.handleResize(rect.width, rect.height);

    this.startRAF();
  }

  unmount(): void {
    this.stopRAF();
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
}
