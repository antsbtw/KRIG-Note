import * as THREE from 'three';
import {
  ShapeRegistry, shapeToThree,
  type ShapeDef, type FillStyle, type LineStyle,
} from '../../library/shapes';
import { SubstanceRegistry } from '../../library/substances';
import type { Instance, InstanceKind, SubstanceComponent, SubstanceDef } from '../../library/types';
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
    // node.group 是 outer group(position = bbox 中心),所以同步时要加 size/2
    const node = this.byId.get(instanceId);
    const inst = this.instances.get(instanceId);
    if (node && inst && inst.position) {
      node.position.x = inst.position.x;
      node.position.y = inst.position.y;
      node.group.position.set(
        inst.position.x + node.size.w / 2,
        inst.position.y + node.size.h / 2,
        0,
      );
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
    // outer/inner 嵌套实现 bbox 中心旋转(inner mesh 顶点在 [0..w]×[0..h] 不变,
    // outer 定位到 bbox 中心 + 旋转,inner 偏移 -size/2 让左上角对齐 outer 原点)
    const outerGroup = wrapForRotation(out.group, position, size, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'shape',
      group: outerGroup,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...size },
      rotation: inst.rotation ?? 0,
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

    // 计算 substance 内部缩放:实际 size / 原始 bbox
    // 让 components 跟随 substance 整体 resize
    const baseSize = inferSubstanceSize(def);
    const actualSize = inst.size ? { ...inst.size } : baseSize;
    const scale = {
      x: baseSize.w > 0 ? actualSize.w / baseSize.w : 1,
      y: baseSize.h > 0 ? actualSize.h / baseSize.h : 1,
    };

    // 两 pass:
    // pass 1 渲染普通 shape component(line 暂跳过,要先有其它 component 的 magnet 坐标)
    // pass 2 渲染 line component(用 pass 1 算好的内部 magnet 解析 endpoints)
    const isLineComp = (comp: SubstanceComponent) => {
      const s = ShapeRegistry.get(comp.ref);
      return s?.category === 'line';
    };
    for (const comp of def.components) {
      if (comp.type !== 'shape') {
        console.warn(`[NodeRenderer] substance ${inst.ref} has nested substance (v1 unsupported)`);
        continue;
      }
      if (isLineComp(comp)) continue;
      const sub = renderComponent(comp, inst, scale);
      if (sub) root.add(sub);
    }
    // pass 2:line component
    for (const comp of def.components) {
      if (comp.type !== 'shape') continue;
      if (!isLineComp(comp)) continue;
      const lineGroup = renderLineComponent(comp, def, scale);
      if (lineGroup) root.add(lineGroup);
    }

    // 安置 root 到画板坐标 — outer/inner 嵌套实现 bbox 中心旋转(同 shape 实例)
    const { position } = ensurePositionSize(inst, null);
    const size = actualSize;
    const outerGroup = wrapForRotation(root, position, size, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'substance',
      group: outerGroup,
      substanceRef: inst.ref,
      position: { ...position },
      size,
      rotation: inst.rotation ?? 0,
    };
  }
}

/**
 * outer/inner 嵌套实现 bbox 中心旋转:
 * - outer:position = bbox 中心,rotation.z = -degrees * π/180
 * - inner:原 mesh group,position = (-size.w/2, -size.h/2)(让左上角对齐 outer 原点)
 *
 * 旋转方向约定:rotation > 0 = 用户视觉的顺时针旋转。
 * 由于 SceneManager 用 frustum top<bottom 实现 Y 翻转(Y 向下),Three.js 内部
 * 仍是 Y-up,所以 group.rotation.z 的正方向是逆时针;Y 翻转后 + Z 旋转视觉上
 * 变成顺时针 — 直接 group.rotation.z = degrees * π/180 即可。
 */
function wrapForRotation(
  innerGroup: THREE.Group,
  position: { x: number; y: number },
  size: { w: number; h: number },
  rotationDeg: number,
): THREE.Group {
  const outer = new THREE.Group();
  outer.position.set(position.x + size.w / 2, position.y + size.h / 2, 0);
  outer.rotation.z = (rotationDeg * Math.PI) / 180;
  innerGroup.position.set(-size.w / 2, -size.h / 2, 0);
  outer.add(innerGroup);
  return outer;
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

/**
 * 渲染 substance 的一个 shape component
 * scale: substance 实例 size / 原始 substance bbox 的比例(x, y 各一)
 *        让 component 内容跟随 substance 整体缩放
 */
function renderComponent(
  comp: SubstanceComponent,
  inst: Instance,
  scale: { x: number; y: number },
): THREE.Group | null {
  const shape = ShapeRegistry.get(comp.ref);
  if (!shape) {
    console.warn(`[NodeRenderer] component shape not found: ${comp.ref}`);
    return null;
  }
  const baseW = comp.transform.w ?? shape.viewBox.w;
  const baseH = comp.transform.h ?? shape.viewBox.h;
  const w = baseW * scale.x;
  const h = baseH * scale.y;
  const out = shapeToThree(shape, {
    width: w,
    height: h,
    fillStyle: mergeFill(shape.default_style?.fill, comp.style_overrides?.fill as Partial<FillStyle>),
    lineStyle: mergeLine(shape.default_style?.line, comp.style_overrides?.line as Partial<LineStyle>),
  });

  // 位置也按 scale 缩放(component 内的 x/y 是相对 substance 原点)
  const px = comp.transform.x * scale.x;
  const py = comp.transform.y * scale.y;
  // anchor:center → 把 mesh 中心移到 transform.x/y;否则 transform.x/y 是左上角
  if (comp.transform.anchor === 'center') {
    out.group.position.set(px - w / 2, py - h / 2, 0);
  } else {
    out.group.position.set(px, py, 0);
  }
  out.group.userData.instanceId = inst.id;
  out.group.userData.binding = comp.binding;
  return out.group;
}

/**
 * 渲染 substance 内部的 line component:
 * 用 endpoints 中 "comp:N" 引用同 substance 的其它 component,解析其 magnet 局部坐标
 */
function renderLineComponent(
  comp: SubstanceComponent,
  def: SubstanceDef,
  scale: { x: number; y: number },
): THREE.Group | null {
  if (!comp.endpoints) return null;
  const [a, b] = comp.endpoints;
  const aPos = resolveInternalMagnet(def, a.component, a.magnet, scale);
  const bPos = resolveInternalMagnet(def, b.component, b.magnet, scale);
  if (!aPos || !bPos) return null;
  const shape = ShapeRegistry.get(comp.ref);
  const group = renderLine(comp.ref, {
    start: aPos,
    end: bPos,
    style: mergeLine(shape?.default_style?.line, comp.style_overrides?.line as Partial<LineStyle>),
  });
  return group;
}

/**
 * 解析 substance 内部 component 的 magnet 局部坐标(已应用 scale):
 * "comp:N" → def.components[N] 的 magnet → 局部坐标
 */
function resolveInternalMagnet(
  def: SubstanceDef,
  componentRef: string,
  magnetId: string,
  scale: { x: number; y: number },
): { x: number; y: number } | null {
  const m = /^comp:(\d+)$/.exec(componentRef);
  if (!m) return null;
  const idx = Number(m[1]);
  const comp = def.components[idx];
  if (!comp) return null;
  const shape = ShapeRegistry.get(comp.ref);
  if (!shape) return null;
  const magnet = (shape.magnets ?? []).find((mm) => mm.id === magnetId);
  if (!magnet) return null;
  // component 在 substance 内的本地坐标(应用 scale)
  const baseW = comp.transform.w ?? shape.viewBox.w;
  const baseH = comp.transform.h ?? shape.viewBox.h;
  const w = baseW * scale.x;
  const h = baseH * scale.y;
  const px = comp.transform.x * scale.x;
  const py = comp.transform.y * scale.y;
  // anchor:center 时 (px,py) 是 mesh 中心,否则是左上角
  const left = comp.transform.anchor === 'center' ? px - w / 2 : px;
  const top  = comp.transform.anchor === 'center' ? py - h / 2 : py;
  // magnet 归一化坐标 → 局部坐标
  return {
    x: left + magnet.x * w,
    y: top  + magnet.y * h,
  };
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
  /** 度数;HandlesOverlay 用来同步 rotation handle 位置 */
  rotation?: number;
}
