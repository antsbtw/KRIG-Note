/**
 * GraphRenderer — Basic Graph 视图层的顶层渲染器。
 *
 * 输入：RenderableScene（adapter 输出）
 * 输出：Three.js 场景内的 mesh / line / surface 几何体 + label
 *
 * 职责（视图层，纯渲染）：
 *   - 接 SceneManager（场景 / 相机 / RAF）
 *   - 用 RenderableInstance 调 ShapeRenderer 创建几何体
 *   - 用 substance.labelLayout 算 label 位置
 *   - 用 SvgGeometryContent 渲染 label
 *   - dispose 时释放 GPU 资源
 *
 * 不职责：
 *   - 不读 atom 表（adapter 已处理）
 *   - 不算布局位置（v1 使用 instance.position；v1.5+ 接布局算法）
 *   - 不处理交互（B2+ 才加）
 */
import * as THREE from 'three';
import type { RenderableScene, RenderableInstance } from './adapter/types';
import { SceneManager } from './scene/SceneManager';
import {
  pointShapeRegistry,
  lineShapeRegistry,
  surfaceShapeRegistry,
} from './shapes';
import { labelLayoutRegistry } from './labels';
import { SvgGeometryContent } from './contents/SvgGeometryContent';
import { makeTextLabel } from '../../../lib/atom-serializers/extract';

const LABEL_RENDER_ORDER = 1000;

export class GraphRenderer {
  readonly scene: SceneManager;

  /** 当前场景的所有 mesh，按 instance id 索引 */
  private meshes = new Map<string, THREE.Object3D>();
  /** label objects（按 instance id 索引，dispose 时一并清理） */
  private labels = new Map<string, THREE.Object3D>();
  /** 共享 SVG label 渲染器（v1.3 资产） */
  private contentRenderer = new SvgGeometryContent();
  /** 本次 setData 的 token；异步 label 渲染过期时丢弃 */
  private loadToken = 0;

  constructor() {
    this.scene = new SceneManager();
  }

  mount(container: HTMLElement): void {
    this.scene.mount(container);
  }

  unmount(): void {
    this.clearAll();
    this.scene.unmount();
  }

  /**
   * 替换整个场景内容。
   *
   * 算法（v1 简化：全量替换；v1.5+ 可优化为增量 diff）：
   *   1. 清空现有 mesh + label
   *   2. 第一遍：渲染所有 Point（位置已在 instance.position）
   *   3. 第二遍：渲染所有 Line（端点位置从 members 找）
   *   4. 第三遍：渲染所有 Surface（顶点位置从 members 找）
   *   5. 第一次 fitToContent（基础几何）
   *   6. 异步加 label
   *   7. 加完 label 再 fitToContent（label 扩大 box）
   */
  async setData(sceneData: RenderableScene): Promise<void> {
    const myToken = ++this.loadToken;
    this.clearAll();

    if (sceneData.warnings.length > 0) {
      console.warn('[GraphRenderer] adapter warnings:', sceneData.warnings.length);
      for (const w of sceneData.warnings.slice(0, 5)) console.warn(`  ${w}`);
    }

    // 用 instance id 索引方便 line / surface 找 members 位置
    const byId = new Map<string, RenderableInstance>();
    for (const inst of sceneData.instances) byId.set(inst.id, inst);

    // ── Pass 1: Point ──
    for (const inst of sceneData.instances) {
      if (inst.kind !== 'point') continue;
      this.renderPoint(inst);
    }

    // ── Pass 2: Line ──
    for (const inst of sceneData.instances) {
      if (inst.kind !== 'line') continue;
      this.renderLine(inst, byId);
    }

    // ── Pass 3: Surface ──
    for (const inst of sceneData.instances) {
      if (inst.kind !== 'surface') continue;
      this.renderSurface(inst, byId);
    }

    // ── 第一次 fit（基础几何，无 label） ──
    this.scene.fitToContent();

    // ── Pass 4: label（异步） ──
    for (const inst of sceneData.instances) {
      if (!inst.label) continue;
      try {
        await this.attachLabel(inst);
        if (myToken !== this.loadToken) return;
      } catch (err) {
        console.error(`[GraphRenderer] label render failed for ${inst.id}:`, err);
      }
    }

    if (myToken !== this.loadToken) return;
    // 加完 label 再 fit 一次
    this.scene.fitToContent();
  }

  // ── 私有：渲染单个 Point ──

  private renderPoint(inst: RenderableInstance): void {
    const shapeId = inst.visual.shape ?? 'circle';
    const shape = pointShapeRegistry.get(shapeId);
    if (!shape) {
      console.error('[GraphRenderer] no shape for', shapeId);
      return;
    }
    try {
      const mesh = shape.createMesh(inst.visual);
      mesh.position.set(
        inst.position.x,
        inst.position.y,
        inst.position.z ?? 0,
      );
      mesh.userData.instanceId = inst.id;
      mesh.userData.kind = 'point';
      this.scene.scene.add(mesh);
      this.meshes.set(inst.id, mesh);
    } catch (err) {
      console.error('[GraphRenderer] renderPoint failed for', inst.id, 'shape=', shapeId, err);
    }
  }

  // ── 私有：渲染单个 Line ──

  private renderLine(inst: RenderableInstance, byId: Map<string, RenderableInstance>): void {
    if (inst.members.length < 2) return;

    const points: THREE.Vector3[] = [];
    for (const memberId of inst.members) {
      const member = byId.get(memberId);
      if (!member) continue;
      points.push(new THREE.Vector3(
        member.position.x,
        member.position.y,
        (member.position.z ?? 0) + 0.01,
      ));
    }
    if (points.length < 2) return;

    const shape = lineShapeRegistry.get('line');
    const lineObj = shape.createMesh(points, inst.visual);
    lineObj.userData.instanceId = inst.id;
    lineObj.userData.kind = 'line';
    this.scene.scene.add(lineObj);
    this.meshes.set(inst.id, lineObj);
  }

  // ── 私有：渲染单个 Surface ──

  private renderSurface(inst: RenderableInstance, byId: Map<string, RenderableInstance>): void {
    if (inst.members.length < 3) return;

    const vertices: Array<{ x: number; y: number }> = [];
    for (const memberId of inst.members) {
      const member = byId.get(memberId);
      if (!member) continue;
      vertices.push({ x: member.position.x, y: member.position.y });
    }
    if (vertices.length < 3) return;

    const shape = surfaceShapeRegistry.get('polygon');
    const surfaceObj = shape.createMesh(vertices, inst.visual);
    surfaceObj.userData.instanceId = inst.id;
    surfaceObj.userData.kind = 'surface';
    this.scene.scene.add(surfaceObj);
    this.meshes.set(inst.id, surfaceObj);
  }

  // ── 私有：异步附加 label ──

  private async attachLabel(inst: RenderableInstance): Promise<void> {
    if (!inst.label) return;
    const meshObj = this.meshes.get(inst.id);
    if (!meshObj) return;

    const layoutId = inst.visual.labelLayout ?? 'below-center';
    const layout = labelLayoutRegistry.get(layoutId);

    const atoms = makeTextLabel(inst.label);
    const labelObj = await this.contentRenderer.render(atoms);

    const shapeBounds = new THREE.Box3().setFromObject(meshObj);
    const labelBounds = this.contentRenderer.getBBox(labelObj);
    const { anchor } = layout.compute({
      shapeBounds,
      labelBounds,
      margin: inst.visual.labelMargin,
    });

    const lcx = (labelBounds.min.x + labelBounds.max.x) / 2;
    const lcy = (labelBounds.min.y + labelBounds.max.y) / 2;
    labelObj.position.set(anchor.x - lcx, anchor.y - lcy, anchor.z);

    // label 永远在最上层
    labelObj.renderOrder = LABEL_RENDER_ORDER;
    labelObj.traverse((c) => {
      c.renderOrder = LABEL_RENDER_ORDER;
      if (c instanceof THREE.Mesh && c.material instanceof THREE.Material) {
        c.material.depthTest = false;
        c.material.depthWrite = false;
        c.material.transparent = true;
      }
    });

    this.scene.scene.add(labelObj);
    this.labels.set(inst.id, labelObj);
  }

  // ── 清理 ──

  private clearAll(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.scene.remove(mesh);
      this.disposeObject(mesh);
    }
    this.meshes.clear();

    for (const label of this.labels.values()) {
      this.scene.scene.remove(label);
      this.contentRenderer.dispose(label);
    }
    this.labels.clear();
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        if (o.material instanceof THREE.Material) o.material.dispose();
      }
    });
  }

  // ── 状态查询 ──

  getMesh(instanceId: string): THREE.Object3D | undefined {
    return this.meshes.get(instanceId);
  }

  getInstanceCount(): number {
    return this.meshes.size;
  }
}
