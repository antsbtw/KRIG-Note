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
import { InteractionController, type NodeHit, type InteractionCallbacks } from './interaction/InteractionController';
import { projectionRegistry } from '../projection';

const LABEL_RENDER_ORDER = 1000;
/** Line 的 z 平面：低于 point（z=0），高于 surface（z=-1）。让节点 shape 视觉上压在线之上 */
const LINE_Z = -0.5;

/** 点 (px, py) 到线段 [(ax, ay), (bx, by)] 的最短距离（B4.2.b 边 hit-test 用） */
function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  // 投影参数 t（限制到 [0,1]）
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export class GraphRenderer {
  readonly scene: SceneManager;

  /** 当前场景的所有 mesh，按 instance id 索引 */
  private meshes = new Map<string, THREE.Object3D>();
  /** Point 类 instance 的渲染态信息（drag 时定位 + label 同步用） */
  private points = new Map<string, RenderableInstance>();
  /** Line / Surface 的 RenderableInstance（drag 时按 members 重建几何用） */
  private connectors = new Map<string, RenderableInstance>();
  /** 反向索引：pointId → 引用它的 line / surface id 集合（drag 时找受影响的连接物） */
  private pointToConnectors = new Map<string, Set<string>>();
  /** label objects（按 instance id 索引，dispose 时一并清理） */
  private labels = new Map<string, THREE.Object3D>();
  /** label 在 shape 内的"相对偏移"（drag 时跟随用） */
  private labelOffsets = new Map<string, { dx: number; dy: number; z: number }>();
  /** 共享 SVG label 渲染器（v1.3 资产） */
  private contentRenderer = new SvgGeometryContent();
  /** 本次 setData 的 token；异步 label 渲染过期时丢弃 */
  private loadToken = 0;
  /** B2 交互控制器（mount 时创建，unmount 时销毁） */
  private interaction: InteractionController | null = null;
  /** B4.2 当前选中的 instance id 集合（视觉反馈用，状态主存在 GraphView） */
  private selectedIds = new Set<string>();

  constructor() {
    this.scene = new SceneManager();
  }

  mount(container: HTMLElement): void {
    this.scene.mount(container);
    this.interaction = new InteractionController(
      this.scene,
      (worldX, worldY) => this.hitTestAny(worldX, worldY),
    );
    this.interaction.attach(this.scene.renderer.domElement);
  }

  unmount(): void {
    this.interaction?.detach();
    this.interaction = null;
    this.clearAll();
    this.scene.unmount();
  }

  /** 设置交互回调（GraphView 注入持久化逻辑） */
  setInteractionCallbacks(callbacks: InteractionCallbacks): void {
    this.interaction?.setCallbacks({
      onNodeDrag: (info) => {
        // 拖动时同步：label + 连接到该节点的 line / surface
        this.moveLabelWithNode(info.instanceId, info.worldX, info.worldY);
        this.updateConnectorsFor(info.instanceId);
        callbacks.onNodeDrag?.(info);
      },
      onNodeDragEnd: callbacks.onNodeDragEnd,
      // B4.2 选中事件透传
      onSelect: callbacks.onSelect,
      onBoxSelectUpdate: callbacks.onBoxSelectUpdate,
      onBoxSelectEnd: callbacks.onBoxSelectEnd,
      onBoxSelectCancel: callbacks.onBoxSelectCancel,
    });
  }

  // ── 命中测试 ──

  /**
   * 综合命中：先尝试节点，再尝试边/面。
   * 节点优先 — 如果点击位置同时在节点和边上，返回节点（节点总是浮在边之上）。
   */
  private hitTestAny(worldX: number, worldY: number): NodeHit | null {
    return this.hitTestPoint(worldX, worldY) ?? this.hitTestEdge(worldX, worldY);
  }

  /**
   * 找到包含 (worldX, worldY) 的最上层 Point。
   *
   * 简化策略：遍历 points，用 mesh 的世界 Box3 测试包含；
   * 命中多个时取"包围盒最小"的那个（小节点压在大节点之上时优先选小的）。
   */
  private hitTestPoint(worldX: number, worldY: number): NodeHit | null {
    let best: { hit: NodeHit; area: number } | null = null;
    const tmp = new THREE.Box3();
    for (const [id] of this.points) {
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      tmp.setFromObject(mesh);
      if (tmp.isEmpty()) continue;
      if (
        worldX >= tmp.min.x && worldX <= tmp.max.x &&
        worldY >= tmp.min.y && worldY <= tmp.max.y
      ) {
        const area = (tmp.max.x - tmp.min.x) * (tmp.max.y - tmp.min.y);
        if (!best || area < best.area) {
          best = {
            hit: {
              kind: 'point',
              instanceId: id,
              worldX: mesh.position.x,
              worldY: mesh.position.y,
              object: mesh,
            },
            area,
          };
        }
      }
    }
    return best?.hit ?? null;
  }

  /**
   * 找到距离 (worldX, worldY) 足够近的边（line connector）。
   *
   * 算法：遍历 line connectors，对每条 line 的连续顶点对求"点到线段距离"，
   * 取最小距离 < EDGE_HIT_THRESHOLD 的那条。
   * 阈值用世界单位 — 跟当前缩放有关；理想情况下应换屏幕像素，但 v1 简化用固定值。
   */
  private hitTestEdge(worldX: number, worldY: number): NodeHit | null {
    const EDGE_HIT_THRESHOLD = 8;  // 世界单位
    let best: { id: string; mesh: THREE.Object3D; dist: number } | null = null;

    for (const [id, inst] of this.connectors) {
      if (inst.kind !== 'line') continue;  // surface 命中暂不支持
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      // 拿 line 的实际顶点（用 inst.members 末位置作为端点；bendPoints 在 mesh 内不易取，
      // 这里用 members 端点连成的折线近似 — 直角折线情况下不准但够用，曲线情况会偏差大）
      const pts: Array<{ x: number; y: number }> = [];
      for (const mid of inst.members) {
        const m = this.meshes.get(mid);
        if (m) pts.push({ x: m.position.x, y: m.position.y });
      }
      if (pts.length < 2) continue;
      // 逐段算最小距离
      let minSeg = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointToSegmentDistance(worldX, worldY, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
        if (d < minSeg) minSeg = d;
      }
      if (minSeg < EDGE_HIT_THRESHOLD && (!best || minSeg < best.dist)) {
        best = { id, mesh, dist: minSeg };
      }
    }
    if (!best) return null;
    return {
      kind: 'line',
      instanceId: best.id,
      worldX,
      worldY,
      object: best.mesh,
    };
  }

  // ── B4.2 选中状态（视觉反馈） ──

  /**
   * 同步选中状态：旧选中的恢复 default，新选中的设为 selected。
   * 调用方（GraphView）维护 selectedIds 主状态，每次变更全量传过来。
   */
  setSelectedIds(ids: Iterable<string>): void {
    const next = new Set(ids);
    // 取消旧选中
    for (const id of this.selectedIds) {
      if (next.has(id)) continue;
      this.applyHighlight(id, 'default');
    }
    // 应用新选中
    for (const id of next) {
      if (this.selectedIds.has(id)) continue;
      this.applyHighlight(id, 'selected');
    }
    this.selectedIds = next;
    this.scene.markDirty();
  }

  /** 取出当前选中（只读）。 */
  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds;
  }

  /** 调用 shape 的 setHighlight 改材质。 */
  private applyHighlight(instanceId: string, mode: 'default' | 'hover' | 'selected'): void {
    const mesh = this.meshes.get(instanceId);
    if (!mesh) return;
    const point = this.points.get(instanceId);
    if (point) {
      const shapeId = point.visual.shape ?? 'circle';
      const renderer = pointShapeRegistry.get(shapeId);
      renderer.setHighlight(mesh, mode);
      return;
    }
    // line / surface 选中（B4.2 边选中预留，本步暂不暴露 UI）
    const conn = this.connectors.get(instanceId);
    if (conn) {
      const registry = conn.kind === 'line' ? lineShapeRegistry : surfaceShapeRegistry;
      const shapeId = conn.visual.shape ?? (conn.kind === 'line' ? 'line' : 'convex-hull');
      const renderer = registry.get(shapeId);
      renderer.setHighlight(mesh, mode);
    }
  }

  /**
   * 把世界坐标矩形内的所有 Point instance id 找出来（用于框选）。
   *
   * 简单实现：遍历 points，用 mesh 的世界 Box3 跟矩形交集判断。
   * 触碰即算命中（不要求节点完全在框内 —— Figma 默认行为）。
   */
  hitTestRect(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const out: string[] = [];
    const tmp = new THREE.Box3();
    for (const [id] of this.points) {
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      tmp.setFromObject(mesh);
      if (tmp.isEmpty()) continue;
      // AABB 与选区矩形相交（不要求完全包含）
      if (tmp.max.x < minX || tmp.min.x > maxX) continue;
      if (tmp.max.y < minY || tmp.min.y > maxY) continue;
      out.push(id);
    }
    return out;
  }

  /** 拖动节点时把 label 跟着挪（label 与 shape 的相对偏移 = labelOffsets） */
  private moveLabelWithNode(instanceId: string, worldX: number, worldY: number): void {
    const label = this.labels.get(instanceId);
    const offset = this.labelOffsets.get(instanceId);
    if (!label || !offset) return;
    label.position.set(worldX + offset.dx, worldY + offset.dy, offset.z);
  }

  /**
   * 拖动节点时同步连接到该节点的 line / surface。
   *
   * 实现：dispose 旧 mesh → 用当前所有 mesh 的最新位置重建 line / surface。
   * 简单粗暴，对 v1 量级（~50 几何体）够用；性能瓶颈在 v1.5+ 优化为顶点 buffer in-place 更新。
   */
  private updateConnectorsFor(pointId: string): void {
    const connectorIds = this.pointToConnectors.get(pointId);
    if (!connectorIds || connectorIds.size === 0) return;

    for (const connectorId of connectorIds) {
      const inst = this.connectors.get(connectorId);
      if (!inst) continue;
      const oldMesh = this.meshes.get(connectorId);
      if (!oldMesh) continue;

      // 用最新 mesh 位置组装顶点
      const livePositions = inst.members.map((mid) => {
        const m = this.meshes.get(mid);
        if (m) return { x: m.position.x, y: m.position.y, z: m.position.z };
        // 兜底用 instance.position（理论上不会走到）
        const member = this.points.get(mid);
        return member?.position ?? { x: 0, y: 0, z: 0 };
      });

      this.scene.scene.remove(oldMesh);
      this.disposeObject(oldMesh);

      let newMesh: THREE.Object3D;
      if (inst.kind === 'line') {
        if (livePositions.length < 2) continue;
        // 拖动期间走直线兜底：ELK bendPoints 已过时（节点位置变了，
        // 原折线无效），松手后下次 layout 重算才能恢复正确折线。
        const pts = this.clipLineEndpointsToShapes(
          inst.members,
          livePositions.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
        );
        newMesh = lineShapeRegistry.get('line').createMesh(pts, inst.visual);
      } else if (inst.kind === 'surface') {
        if (livePositions.length < 3) continue;
        const verts = livePositions.map((p) => ({ x: p.x, y: p.y }));
        newMesh = surfaceShapeRegistry.get('polygon').createMesh(verts, inst.visual);
      } else {
        continue;
      }

      newMesh.userData.instanceId = inst.id;
      newMesh.userData.kind = inst.kind;
      this.scene.scene.add(newMesh);
      this.meshes.set(inst.id, newMesh);
    }
    this.scene.markDirty();
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
    // B3.4: 让 projection 介入折线/曲线渲染（tree projection 用 ELK ORTHOGONAL bendPoints）
    const projection = sceneData.activeProjection
      ? projectionRegistry.get(sceneData.activeProjection)
      : undefined;
    for (const inst of sceneData.instances) {
      if (inst.kind !== 'line') continue;
      this.renderLine(inst, byId, projection, sceneData.edgeSections);
    }

    // ── Pass 3: Surface ──
    for (const inst of sceneData.instances) {
      if (inst.kind !== 'surface') continue;
      this.renderSurface(inst, byId);
    }

    // ── 第一次 fit（基础几何，无 label） ──
    // 切换 ViewMode 时 fitBox 必须重新计算（不残留上次视角）
    this.scene.invalidateFit();
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
    // 加完 label 再 fit 一次（label 退化几何会被 SceneManager 防御性跳过）
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
      this.points.set(inst.id, inst);
    } catch (err) {
      console.error('[GraphRenderer] renderPoint failed for', inst.id, 'shape=', shapeId, err);
    }
  }

  // ── 私有：渲染单个 Line ──

  private renderLine(
    inst: RenderableInstance,
    byId: Map<string, RenderableInstance>,
    projection?: { customizeLine?: (i: RenderableInstance, sections: any) => Array<{ x: number; y: number }> | null },
    edgeSections?: RenderableScene['edgeSections'],
  ): void {
    if (inst.members.length < 2) return;

    let points: THREE.Vector3[];

    // B3.4: projection 介入折线/曲线（tree projection 取 ELK bendPoints）
    const projectionPath = projection?.customizeLine?.(inst, edgeSections?.get(inst.id));
    if (projectionPath && projectionPath.length >= 2) {
      // 首末两端裁剪到节点 shape 边缘,中间 bendPoints / 曲线采样点不动。
      // 否则 bezier 曲线/直线的端点在节点中心,箭头会被节点 mesh 遮住。
      const clippedPath = [...projectionPath];
      const first = clippedPath[0];
      const second = clippedPath[1];
      const last = clippedPath[clippedPath.length - 1];
      const secondLast = clippedPath[clippedPath.length - 2];
      const startMesh = this.meshes.get(inst.members[0]);
      const endMesh = this.meshes.get(inst.members[inst.members.length - 1]);
      if (startMesh) {
        const c = clipPointToBox(second, first, startMesh);
        if (c) clippedPath[0] = c;
      }
      if (endMesh) {
        const c = clipPointToBox(secondLast, last, endMesh);
        if (c) clippedPath[clippedPath.length - 1] = c;
      }
      points = clippedPath.map((p) => new THREE.Vector3(p.x, p.y, LINE_Z));
    } else {
      // 原直线管线：member 中心 + 端点裁剪
      const centers: Array<{ x: number; y: number; z: number }> = [];
      for (const memberId of inst.members) {
        const member = byId.get(memberId);
        if (!member) continue;
        centers.push({
          x: member.position.x,
          y: member.position.y,
          z: member.position.z ?? 0,
        });
      }
      if (centers.length < 2) return;
      points = this.clipLineEndpointsToShapes(inst.members, centers);
    }

    const shape = lineShapeRegistry.get('line');
    const lineObj = shape.createMesh(points, inst.visual);
    lineObj.userData.instanceId = inst.id;
    lineObj.userData.kind = 'line';
    this.scene.scene.add(lineObj);
    this.meshes.set(inst.id, lineObj);
    this.connectors.set(inst.id, inst);
    for (const memberId of inst.members) this.indexConnectorMembership(memberId, inst.id);
  }

  /**
   * 把 line 两端从节点中心裁到节点 shape 的边缘。
   *
   * 算法：用每个端点 mesh 的世界 Box3（轴对齐近似）求射线交点：
   *   从 A 中心 → B 中心 的射线，与 A 的 box 求出射点 = A 端的裁剪点；
   *   反向同理。
   *
   * 多端点 line 的中间点不裁，只裁首尾。z 取 LINE_Z（在 point 之下、surface 之上）。
   */
  private clipLineEndpointsToShapes(
    memberIds: string[],
    centers: Array<{ x: number; y: number; z: number }>,
  ): THREE.Vector3[] {
    const result = centers.map((c) => new THREE.Vector3(c.x, c.y, LINE_Z));
    if (result.length < 2) return result;

    // 首端：从 [1] 射向 [0]，求与 [0] 的 box 交点
    const startMesh = this.meshes.get(memberIds[0]);
    if (startMesh) {
      const clipped = clipPointToBox(centers[1], centers[0], startMesh);
      if (clipped) result[0].set(clipped.x, clipped.y, LINE_Z);
    }
    // 末端：从 [n-2] 射向 [n-1]，求与 [n-1] 的 box 交点
    const last = memberIds.length - 1;
    const endMesh = this.meshes.get(memberIds[last]);
    if (endMesh) {
      const clipped = clipPointToBox(centers[last - 1], centers[last], endMesh);
      if (clipped) result[last].set(clipped.x, clipped.y, LINE_Z);
    }
    return result;
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
    this.connectors.set(inst.id, inst);
    for (const memberId of inst.members) this.indexConnectorMembership(memberId, inst.id);
  }

  private indexConnectorMembership(pointId: string, connectorId: string): void {
    let set = this.pointToConnectors.get(pointId);
    if (!set) {
      set = new Set();
      this.pointToConnectors.set(pointId, set);
    }
    set.add(connectorId);
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
    const labelX = anchor.x - lcx;
    const labelY = anchor.y - lcy;
    labelObj.position.set(labelX, labelY, anchor.z);

    // 记录 label 与 shape 中心的偏移（drag 时跟随用）
    this.labelOffsets.set(inst.id, {
      dx: labelX - meshObj.position.x,
      dy: labelY - meshObj.position.y,
      z: anchor.z,
    });

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
    this.points.clear();
    this.connectors.clear();
    this.pointToConnectors.clear();

    for (const label of this.labels.values()) {
      this.scene.scene.remove(label);
      this.contentRenderer.dispose(label);
    }
    this.labels.clear();
    this.labelOffsets.clear();
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

// ── 工具：从节点中心向外射线求与 box 的交点 ──

/**
 * 求"从 from 射向 to" 这条射线，与 to 节点的世界 Box3 在 to 一侧的交点。
 *
 * 用途：把线段端点从节点中心裁到节点 box 边缘。
 * 算法：参数 t ∈ [0, 1]，在 |dx|/halfW 和 |dy|/halfH 中取较大者作为 box 击中比例。
 *
 * 退化处理：如果 from 与 to 重合或 box 退化（min===max），返回 null（调用方保留原中心点）。
 */
function clipPointToBox(
  from: { x: number; y: number },
  to: { x: number; y: number },
  toMesh: THREE.Object3D,
): { x: number; y: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-3) return null;

  const box = new THREE.Box3().setFromObject(toMesh);
  if (box.isEmpty()) return null;
  const halfW = (box.max.x - box.min.x) / 2;
  const halfH = (box.max.y - box.min.y) / 2;
  if (halfW < 1e-3 || halfH < 1e-3) return null;

  // 单位方向（from → to）
  const ux = dx / len;
  const uy = dy / len;

  // 求 to 中心沿 -unit 方向到 box 边的距离 t：
  // 沿 x 方向 t_x = halfW / |ux|；沿 y 方向 t_y = halfH / |uy|；取较小
  const tx = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
  const t = Math.min(tx, ty);

  return { x: to.x - ux * t, y: to.y - uy * t };
}
