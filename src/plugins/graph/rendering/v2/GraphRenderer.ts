/**
 * GraphRenderer — v2 渲染层顶层协调器。
 *
 * 职责：
 *   - 持有 SceneManager + Three.js 场景
 *   - 接受四态数据（geometries + intensions + presentations）+ 布局位置
 *   - 调 composer 合成视觉，调 PointMesh / LineMesh / SurfaceMesh 创建几何
 *   - 管理 mesh 生命周期（mount / setData / dispose）
 *
 * 不负责：
 *   - 拖动 / 选中（D10 由 DragController 接入）
 *   - 视觉合成的算法本身（在 composer.ts）
 *   - 布局算法（在 layout/）
 */
import * as THREE from 'three';
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../../main/storage/types';
import { SceneManager } from './SceneManager';
import { compose } from './composer';
import { createPointGroup, disposePointGroup } from './PointMesh';
import { createLineMesh, disposeLineMesh } from './LineMesh';
import { createSurfaceGroup, disposeSurfaceGroup } from './SurfaceMesh';
import type { RenderableGeometry } from './types';

export interface GraphRendererInput {
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
  /** 布局引擎算出的位置（key = geometry id；仅 Point 必填） */
  positions: Map<string, { x: number; y: number; z?: number }>;
}

export class GraphRenderer {
  readonly scene: SceneManager;

  /** 已挂载到场景的 mesh，按 geometry id 索引 */
  private meshes = new Map<string, THREE.Object3D>();
  /** 已合成的 RenderableGeometry，按 id 索引（外部组件可读） */
  private composed = new Map<string, RenderableGeometry>();
  /** 当前加载的 token，用于丢弃过期的异步 setData 结果 */
  private loadToken = 0;

  constructor() {
    this.scene = new SceneManager();
  }

  mount(container: HTMLElement): void {
    this.scene.mount(container);
  }

  unmount(): void {
    this.clearMeshes();
    this.scene.unmount();
  }

  /**
   * 设置整张图的数据。
   *
   * 异步：Point 的 SVG label 渲染需要等字体加载。
   * 调用时清空所有现有 mesh 再重新创建（v1 简化策略；后续可优化为 diff）。
   */
  async setData(input: GraphRendererInput): Promise<void> {
    const myToken = ++this.loadToken;
    this.clearMeshes();

    // ── 1. 合成视觉 ──
    const { geometries: composedMap } = compose(input.geometries, input.intensions, input.presentations);

    // 把布局算出的位置覆盖到 composed（presentation atom 已有的 position 优先级低于布局）
    // 布局算法已经读了 presentation 中的 pinned，所以布局产物已经是"已尊重 pin 的位置"。
    for (const [id, pos] of input.positions) {
      const item = composedMap.get(id);
      if (item) {
        item.position = pos;
      }
    }

    if (myToken !== this.loadToken) return;
    this.composed = composedMap;

    // ── 2. 先创建所有 Point（含异步 label 渲染） ──
    const points = input.geometries.filter((g) => g.kind === 'point');
    for (const g of points) {
      const item = composedMap.get(g.id);
      if (!item) continue;
      try {
        const group = await createPointGroup(item);
        if (myToken !== this.loadToken) return;
        this.scene.scene.add(group);
        this.meshes.set(g.id, group);
      } catch (err) {
        console.error(`[GraphRenderer] failed to create point ${g.id}:`, err);
      }
    }

    // ── 3. 创建所有 Line（依赖 Point 已有位置） ──
    const lines = input.geometries.filter((g) => g.kind === 'line');
    for (const g of lines) {
      const item = composedMap.get(g.id);
      if (!item) continue;
      const memberPositions = g.members.map((mid) => composedMap.get(mid)?.position).filter(
        (p): p is { x: number; y: number; z?: number } => !!p,
      );
      if (memberPositions.length < 2) continue;
      const line = createLineMesh(item, memberPositions);
      if (line) {
        this.scene.scene.add(line);
        this.meshes.set(g.id, line);
      }
    }

    // ── 4. 创建所有 Surface（凸包算法依赖 Point 位置） ──
    const surfaces = input.geometries.filter((g) => g.kind === 'surface');
    for (const g of surfaces) {
      const item = composedMap.get(g.id);
      if (!item) continue;
      const memberPositions = g.members.map((mid) => composedMap.get(mid)?.position).filter(
        (p): p is { x: number; y: number } => !!p,
      );
      if (memberPositions.length < 3) continue;
      const surface = createSurfaceGroup(item, memberPositions);
      if (surface) {
        this.scene.scene.add(surface);
        this.meshes.set(g.id, surface);
      }
    }

    if (myToken !== this.loadToken) return;
    this.scene.markDirty();

    // 自动 fit 视图（首次加载时）
    this.scene.fitView();
  }

  /** 清空所有几何体 */
  clearMeshes(): void {
    for (const [id, mesh] of this.meshes) {
      this.scene.scene.remove(mesh);
      const kind = mesh.userData.kind as string;
      if (kind === 'point') disposePointGroup(mesh as THREE.Group);
      else if (kind === 'line') disposeLineMesh(mesh);
      else if (kind === 'surface') disposeSurfaceGroup(mesh);
      void id;
    }
    this.meshes.clear();
    this.composed.clear();
    this.scene.markDirty();
  }

  /** 暴露：按 geometry id 查 mesh（D10 拖动用） */
  getMesh(id: string): THREE.Object3D | undefined {
    return this.meshes.get(id);
  }

  /** 暴露：按 geometry id 查合成结果 */
  getComposed(id: string): RenderableGeometry | undefined {
    return this.composed.get(id);
  }

  /** 暴露：所有合成结果 */
  getAllComposed(): ReadonlyMap<string, RenderableGeometry> {
    return this.composed;
  }
}
