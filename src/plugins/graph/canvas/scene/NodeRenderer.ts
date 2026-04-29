import * as THREE from 'three';
import {
  ShapeRegistry, shapeToThree,
  type ShapeDef, type FillStyle, type LineStyle,
} from '../../library/shapes';
import { SubstanceRegistry } from '../../library/substances';
import type { Instance, InstanceKind, SubstanceComponent } from '../../library/types';
import type { SceneManager } from './SceneManager';
import { renderLine, updateLineGeometry } from './LineRenderer';
import { resolveLineEndpoints } from '../interaction/magnet-snap';

/**
 * NodeRenderer — Canvas instance JSON → Three.js mesh 渲染管线
 *
 * 职责:
 * - 给定 Instance[],为每个 instance 创建一个 THREE.Group(挂到 scene)
 * - 维护 instanceId → THREE.Group 反向索引(M1.2c magnet 跟随、M1.3 拾取用)
 * - 应用 style_overrides(覆盖 fill/line)
 * - **substance 渲染**:展开 components 为多个子 mesh,共用一个 root group,
 *   group.position = instance.position,components 在 group 内按 transform 摆位
 * - 渲染完后调用 SceneManager.fitToContent / fitToBox(memory:必须主动 fit)
 *
 * **不**处理:
 * - line endpoints 驱动(M1.2c)— 当前 line 实例必须有 position + size
 * - substance 包含 substance 的递归嵌套(v1.2)— 当前只支持 component.type='shape'
 * - 选中态视觉、拖动等交互(M1.3)
 */
export class NodeRenderer {
  /** instanceId → 渲染产物(用于增量更新 / 删除 / 跟随) */
  private byId = new Map<string, RenderedNode>();
  /** 原始 Instance 数据(渲染产物只保存简化的 position/size,line 跟随需要原始 endpoints) */
  private instances = new Map<string, Instance>();
  /** 反向索引:被引用的 instance id → 引用它的 line instance id 集合 */
  private lineRefs = new Map<string, Set<string>>();

  constructor(private sceneManager: SceneManager) {}

  /** 全量替换:清掉现有节点,渲染新的 instances 列表 */
  setInstances(instances: Instance[]): void {
    this.clear();
    // 先渲染非 line 实例,line 实例最后(端点解析需要其他 instance 已就位)
    const lines: Instance[] = [];
    for (const inst of instances) {
      if (isLineInstance(inst)) lines.push(inst);
      else this.add(inst);
    }
    for (const inst of lines) this.add(inst);
    this.fitAll();
  }

  /** 增量添加单个 instance(M1.3c 添加模式 / M1.5 反序列化用) */
  add(inst: Instance): void {
    if (this.byId.has(inst.id)) {
      console.warn(`[NodeRenderer] instance ${inst.id} already rendered, replacing`);
      this.remove(inst.id);
    }
    const node = this.renderInstance(inst);
    if (!node) return;
    this.sceneManager.scene.add(node.group);
    this.byId.set(inst.id, node);
    this.instances.set(inst.id, inst);

    // line 实例通过 endpoints 引用其他 instance:登记反向索引
    if (isLineInstance(inst) && inst.endpoints) {
      for (const ep of inst.endpoints) {
        let set = this.lineRefs.get(ep.instance);
        if (!set) { set = new Set(); this.lineRefs.set(ep.instance, set); }
        set.add(inst.id);
      }
    }

    // 新加的非 line instance 可能让某些已有 line(尚未解析端点)能渲染了
    // 但因为 setInstances 已强制 line 后渲染,这种情况只在用户先加 line 后加 shape
    // 时才会发生 — M1 不支持悬空 line,先不处理
  }

  /**
   * 原地替换 instance(Inspector 改属性后调)
   * 重新渲染 mesh + 保留 lineRefs 反向索引(避免引用 line 丢失跟随)
   * 自动 updateLinesFor 让引用 line 跟随尺寸/位置变化
   */
  update(updated: Instance): void {
    const oldNode = this.byId.get(updated.id);
    if (!oldNode) {
      console.warn(`[NodeRenderer] update: instance ${updated.id} not found, falling back to add`);
      this.add(updated);
      return;
    }
    // 销毁旧 mesh,重建新 mesh
    this.sceneManager.scene.remove(oldNode.group);
    disposeGroup(oldNode.group);
    this.byId.delete(updated.id);
    this.instances.set(updated.id, updated);

    const node = this.renderInstance(updated);
    if (!node) return;
    this.sceneManager.scene.add(node.group);
    this.byId.set(updated.id, node);

    // 引用它的 line 重新解析端点
    this.updateLinesFor(updated.id);
  }

  /** 删除某个 instance(M1.3a Delete 用) */
  remove(id: string): void {
    const node = this.byId.get(id);
    if (!node) return;
    this.sceneManager.scene.remove(node.group);
    disposeGroup(node.group);
    this.byId.delete(id);
    this.instances.delete(id);

    // 找出引用这个 instance 的所有 line(被删时这些 line 失去端点 → 一并删除避免悬空)
    // ⚠️ 必须先抓 orphans 再清 lineRefs[id],否则 delete 后查不到了
    const orphans = Array.from(this.lineRefs.get(id) ?? []);

    // 1. 这个 instance 被哪些 line 引用,反向索引清掉
    this.lineRefs.delete(id);
    // 2. 这个 instance 自己若是 line,从所有"被它引用的 instance 的反向集合"里移除
    for (const set of this.lineRefs.values()) set.delete(id);

    // 3. 递归删除悬空的 line
    for (const orphanId of orphans) this.remove(orphanId);
  }

  /**
   * 通知:某个 instance 的 position/size 变了
   * 重新计算所有引用它的 line 的端点几何(M1.3a 拖动时高频调用)
   */
  updateLinesFor(instanceId: string): void {
    // 1. 同步 byId 里 node.position(若该 instance 还存在)
    const node = this.byId.get(instanceId);
    const inst = this.instances.get(instanceId);
    if (node && inst && inst.position) {
      node.position.x = inst.position.x;
      node.position.y = inst.position.y;
      node.group.position.set(inst.position.x, inst.position.y, 0);
    }

    // 2. 重渲染引用它的所有 line
    const lineIds = this.lineRefs.get(instanceId);
    if (!lineIds) return;
    for (const lineId of lineIds) {
      const lineInst = this.instances.get(lineId);
      const lineNode = this.byId.get(lineId);
      if (!lineInst || !lineNode) continue;
      const ep = resolveLineEndpoints(lineInst, (id) => {
        const n = this.byId.get(id);
        const i = this.instances.get(id);
        return n && i ? { node: n, instance: i } : null;
      });
      if (!ep) continue;
      updateLineGeometry(lineNode.group, lineInst.ref, ep.start, ep.end);
    }
  }

  /** 清空所有节点 */
  clear(): void {
    for (const id of Array.from(this.byId.keys())) this.remove(id);
    this.lineRefs.clear();
    this.instances.clear();
  }

  /** 查询 instance 的渲染产物 */
  get(id: string): RenderedNode | undefined {
    return this.byId.get(id);
  }

  /** 查询原始 Instance(M1.3 拖动时改 position 用,M1.5 序列化用) */
  getInstance(id: string): Instance | undefined {
    return this.instances.get(id);
  }

  /** 列出所有已渲染的 instance(原始数据) */
  listInstances(): Instance[] {
    return Array.from(this.instances.values());
  }

  /** 当前所有已渲染的 instance id */
  ids(): string[] {
    return Array.from(this.byId.keys());
  }

  /** 生成一个不冲突的 instance id(M1.3c 添加模式 / M1.4d Combine 用) */
  nextInstanceId(prefix = 'i'): string {
    let n = this.byId.size + 1;
    let id = `${prefix}-${n}`;
    while (this.byId.has(id)) {
      n++;
      id = `${prefix}-${n}`;
    }
    return id;
  }

  /** fit camera 到所有节点 */
  fitAll(): void {
    const ids = Array.from(this.byId.keys());
    if (ids.length === 0) return;
    const box = new THREE.Box3();
    let hasContent = false;
    for (const id of ids) {
      const node = this.byId.get(id);
      if (!node) continue;
      const nodeBox = new THREE.Box3().setFromObject(node.group);
      if (
        Number.isFinite(nodeBox.min.x) && Number.isFinite(nodeBox.min.y) &&
        Number.isFinite(nodeBox.max.x) && Number.isFinite(nodeBox.max.y) &&
        nodeBox.min.x !== Infinity
      ) {
        box.union(nodeBox);
        hasContent = true;
      }
    }
    if (!hasContent) return;
    this.sceneManager.fitToBox({
      minX: box.min.x, minY: box.min.y,
      maxX: box.max.x, maxY: box.max.y,
    });
  }

  // ─────────────────────────────────────────────────────────
  // 渲染细节
  // ─────────────────────────────────────────────────────────

  private renderInstance(inst: Instance): RenderedNode | null {
    if (inst.type === 'shape') {
      return this.renderShapeInstance(inst);
    } else {
      return this.renderSubstanceInstance(inst);
    }
  }

  /** 单个 shape 实例:走 shapeToThree 直接渲染;line 类走端点驱动 */
  private renderShapeInstance(inst: Instance): RenderedNode | null {
    const shape = ShapeRegistry.get(inst.ref);
    if (!shape) {
      console.warn(`[NodeRenderer] shape not found: ${inst.ref} (instance ${inst.id})`);
      return null;
    }

    // line 类 shape:走端点驱动,不用 path-to-three(后者只会渲染 viewBox 内的固定几何)
    if (shape.category === 'line') {
      return this.renderLineShape(inst, shape);
    }

    const { position, size } = ensurePositionSize(inst, shape);
    const out = shapeToThree(shape, {
      width: size.w,
      height: size.h,
      params: inst.params,
      fillStyle: mergeFill(shape.default_style?.fill, inst.style_overrides?.fill),
      lineStyle: mergeLine(shape.default_style?.line, inst.style_overrides?.line),
    });
    out.group.position.set(position.x, position.y, 0);
    out.group.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'shape',
      group: out.group,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...size },
    };
  }

  /** line shape 实例:解析两端世界坐标 → LineRenderer */
  private renderLineShape(inst: Instance, shape: ShapeDef): RenderedNode | null {
    const ep = resolveLineEndpoints(inst, (id) => {
      const n = this.byId.get(id);
      const i = this.instances.get(id);
      return n && i ? { node: n, instance: i } : null;
    });
    if (!ep) {
      console.warn(`[NodeRenderer] line ${inst.id} cannot resolve endpoints`);
      return null;
    }
    const group = renderLine(inst.ref, {
      start: ep.start,
      end: ep.end,
      style: mergeLine(shape.default_style?.line, inst.style_overrides?.line),
    });
    group.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'shape',
      group,
      shapeRef: inst.ref,
      // line 的 position/size 用 bbox 表达(M1.3a 选中态 / 删除可能用)
      position: { x: Math.min(ep.start.x, ep.end.x), y: Math.min(ep.start.y, ep.end.y) },
      size: {
        w: Math.abs(ep.end.x - ep.start.x),
        h: Math.abs(ep.end.y - ep.start.y),
      },
    };
  }

  /** substance 实例:展开 components,各自渲染并按 transform 在 group 内定位 */
  private renderSubstanceInstance(inst: Instance): RenderedNode | null {
    const def = SubstanceRegistry.get(inst.ref);
    if (!def) {
      console.warn(`[NodeRenderer] substance not found: ${inst.ref} (instance ${inst.id})`);
      return null;
    }
    const root = new THREE.Group();
    root.userData.instanceId = inst.id;

    for (const comp of def.components) {
      // v1 只支持 component.type='shape'(详见类注释)
      if (comp.type !== 'shape') {
        console.warn(`[NodeRenderer] substance ${inst.ref} has nested substance (v1 unsupported)`);
        continue;
      }
      const sub = renderComponent(comp, inst);
      if (sub) root.add(sub);
    }

    // 安置 root 到画板坐标
    const { position } = ensurePositionSize(inst, null);
    root.position.set(position.x, position.y, 0);

    return {
      instanceId: inst.id,
      kind: 'substance',
      group: root,
      substanceRef: inst.ref,
      position: { ...position },
      // substance 的整体 size 由 frame component 决定 / 或外层指定
      size: inst.size ? { ...inst.size } : inferSubstanceSize(def),
    };
  }
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

/** 该 instance 是不是 line 类 shape */
function isLineInstance(inst: Instance): boolean {
  if (inst.type !== 'shape') return false;
  const shape = ShapeRegistry.get(inst.ref);
  return shape?.category === 'line';
}

/** 渲染 substance 的一个 shape component */
function renderComponent(comp: SubstanceComponent, inst: Instance): THREE.Group | null {
  const shape = ShapeRegistry.get(comp.ref);
  if (!shape) {
    console.warn(`[NodeRenderer] component shape not found: ${comp.ref}`);
    return null;
  }
  const w = comp.transform.w ?? shape.viewBox.w;
  const h = comp.transform.h ?? shape.viewBox.h;
  const out = shapeToThree(shape, {
    width: w,
    height: h,
    fillStyle: mergeFill(shape.default_style?.fill, comp.style_overrides?.fill as Partial<FillStyle>),
    lineStyle: mergeLine(shape.default_style?.line, comp.style_overrides?.line as Partial<LineStyle>),
  });

  // anchor:center → 把 mesh 中心移到 transform.x/y;否则 transform.x/y 是左上角
  if (comp.transform.anchor === 'center') {
    out.group.position.set(comp.transform.x - w / 2, comp.transform.y - h / 2, 0);
  } else {
    out.group.position.set(comp.transform.x, comp.transform.y, 0);
  }
  out.group.userData.instanceId = inst.id;
  out.group.userData.binding = comp.binding;
  return out.group;
}

/** 必备字段兜底:shape 实例没填 position/size 时,用 viewBox / 0,0 兜底 */
function ensurePositionSize(
  inst: Instance,
  shape: ShapeDef | null,
): { position: { x: number; y: number }; size: { w: number; h: number } } {
  const position = inst.position ?? { x: 0, y: 0 };
  const size = inst.size ?? (shape ? { w: shape.viewBox.w, h: shape.viewBox.h } : { w: 100, h: 100 });
  return { position, size };
}

/** substance 没显式 size 时,用所有 component 的 transform 估一个 bbox */
function inferSubstanceSize(def: { components: SubstanceComponent[] }): { w: number; h: number } {
  let maxX = 0, maxY = 0;
  for (const c of def.components) {
    const w = c.transform.w ?? 0;
    const h = c.transform.h ?? 0;
    const x = c.transform.x + (c.transform.anchor === 'center' ? w / 2 : w);
    const y = c.transform.y + (c.transform.anchor === 'center' ? h / 2 : h);
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { w: maxX || 100, h: maxY || 100 };
}

/** 合并 default_style.fill 和 instance.style_overrides.fill */
function mergeFill(base?: FillStyle, override?: Partial<FillStyle>): FillStyle | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? { type: 'solid' }), ...(override ?? {}) } as FillStyle;
}

function mergeLine(base?: LineStyle, override?: Partial<LineStyle>): LineStyle | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? { type: 'solid' }), ...(override ?? {}) } as LineStyle;
}

/** 递归释放 group 下所有 mesh 的 geometry/material */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else if (mat) mat.dispose();
  });
}

// ─────────────────────────────────────────────────────────
// 导出类型
// ─────────────────────────────────────────────────────────

export interface RenderedNode {
  instanceId: string;
  kind: InstanceKind;
  group: THREE.Group;
  shapeRef?: string;
  substanceRef?: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
}
