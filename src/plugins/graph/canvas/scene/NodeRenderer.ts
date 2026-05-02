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
import { TextRenderer } from './TextRenderer';
import { textNodeAtomsToPmJson, isTextNodeRef } from '../edit/atom-bridge';

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
  /** 共享的文字节点 SVG 渲染器(M2.1) */
  private textRenderer = new TextRenderer();
  /** 文字节点异步 SVG 渲染的 token(M2.1):update/remove 时递增,stale resolve 丢弃 */
  private textRenderTokens = new Map<string, number>();
  /**
   * 文字节点 size 自适应完成后的回调(M2.1).
   * 给 CanvasView 用:在 adapt 完成时刷新 HandlesOverlay 的 currentNode 引用,
   * 否则选中边框永远停在初始 size 上(adapt 是 async,setTarget 在它之前).
   */
  private onTextNodeResized?: (instanceId: string) => void;

  constructor(private sceneManager: SceneManager) {}

  setOnTextNodeResized(cb: (instanceId: string) => void): void {
    this.onTextNodeResized = cb;
  }

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
    this.textRenderTokens.clear();
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
      // 文字节点(M2.1):走 TextRenderer SVG → mesh 路径
      if (isTextNodeRef(inst.ref)) {
        return this.renderTextInstance(inst);
      }
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

  /**
   * 文字节点(M2.1):内容是 NoteView 同源 Atom[](inst.doc).
   *
   * 渲染时机:atomsToSvg 是 async,首帧返回**占位 group**(含一个隐形 hit-area
   * 矩形 + 一个灰色轻量 placeholder),保证 fitToContent / hit-test 不算偏;
   * 真实 SVG mesh 异步 resolve 后替换 inner 的渲染层 children.
   *
   * 重生成保护:每个 instance 维护 textRenderToken,update/remove 后递增,
   * stale 的 async resolve 直接丢弃.
   */
  private renderTextInstance(inst: Instance): RenderedNode | null {
    const { position, size } = ensurePositionSize(inst, null);
    const safeSize = {
      w: Math.max(1, size.w),
      h: Math.max(1, size.h),
    };

    // inner group 三层(从下到上):
    //   - bg(可选,M2.2 Sticky):style_overrides.fill 实色背景
    //   - hitArea:透明 hit-area(覆盖整个 size,捕获 glyph 间空隙点击)
    //   - contentSlot:SVG mesh 异步填入
    const innerGroup = new THREE.Group();

    // ── 背景层(M2.2 Sticky):style_overrides.fill 提供时画一层实色 plane ──
    // 用 renderOrder 强制画顺序,不依赖 children 顺序 / depthWrite
    const bgFill = inst.style_overrides?.fill;
    if (bgFill?.type === 'solid' && bgFill.color) {
      const bgGeo = new THREE.PlaneGeometry(safeSize.w, safeSize.h);
      const bgMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(bgFill.color),
        side: THREE.DoubleSide,
      });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.position.set(safeSize.w / 2, safeSize.h / 2, -0.01);
      bgMesh.renderOrder = -1;  // 比文字(默认 0)低,确保先画(被覆盖)
      bgMesh.userData.isTextBackground = true;
      innerGroup.add(bgMesh);
    }

    // ── 隐形 hit-area(覆盖整个 size,捕获 glyph 之间的空隙点击)──
    const hitGeo = new THREE.PlaneGeometry(safeSize.w, safeSize.h);
    const hitMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(safeSize.w / 2, safeSize.h / 2, 0);
    hitMesh.userData.isTextHitArea = true;
    innerGroup.add(hitMesh);

    // ── content slot(SVG mesh 在此填入)──
    const contentSlot = new THREE.Group();
    contentSlot.userData.isTextContentSlot = true;
    innerGroup.add(contentSlot);

    // outer/inner 嵌套(沿用 M1.x.1 旋转架构)
    const outerGroup = wrapForRotation(innerGroup, position, safeSize, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;

    // ── 异步触发 SVG mesh 渲染 ──
    const token = (this.textRenderTokens.get(inst.id) ?? 0) + 1;
    this.textRenderTokens.set(inst.id, token);

    const pmJsonAtoms = textNodeAtomsToPmJson(inst.doc);
    if (pmJsonAtoms.length > 0) {
      // M2.2 Sticky:有 BG 色 → 按亮度选深 / 浅文字
      // 无 BG(Text 节点)用默认 undefined → atom-serializer fallback #dddddd
      const bgColor = (bgFill?.type === 'solid' && bgFill.color) ? bgFill.color : null;
      const defaultTextColor = bgColor ? pickReadableTextColor(bgColor) : undefined;
      void this.textRenderer.render(pmJsonAtoms, { width: safeSize.w, defaultTextColor }).then((svgGroup) => {
        if (this.textRenderTokens.get(inst.id) !== token) {
          this.textRenderer.dispose(svgGroup);
          return;
        }
        const current = this.byId.get(inst.id);
        if (!current) {
          this.textRenderer.dispose(svgGroup);
          return;
        }

        // 1. 在 attach 之前测 SVG 本地 bbox(避开 matrixWorld 时序问题)
        //    svgGroup 的局部坐标系就是 SVG path 自身,bbox.max.y 直接 = 内容高度
        svgGroup.updateMatrixWorld(true);
        const localBbox = new THREE.Box3().setFromObject(svgGroup);
        const contentH = (Number.isFinite(localBbox.max.y) && Number.isFinite(localBbox.min.y))
          ? localBbox.max.y - localBbox.min.y
          : 0;

        // 2. 抵消 TextRenderer 内的 group.scale.y = -1(canvas SceneManager 已通过
        //    frustum top<bottom 实现 Y 翻转,SVG path 坐标本身就是 Y-down,无需再翻)
        svgGroup.scale.y = 1;
        svgGroup.position.set(0, 0, 0.01);
        // 给 svgGroup 内所有 mesh 设 renderOrder=1,保证画在 BG(-1) / hitArea(0) 之上
        svgGroup.traverse((obj) => { obj.renderOrder = 1; });
        contentSlot.add(svgGroup);

        // 3. 内容溢出自适应(对齐 Freeform 文字框行为,宽度用户控制,高度跟内容)
        if (contentH > 0) {
          this.adaptTextNodeSizeToContent(inst.id, current, contentH);
        }
      }).catch((e) => {
        console.warn(`[Canvas.text] async render failed`, e);
      });
    }

    return {
      instanceId: inst.id,
      kind: 'shape',
      group: outerGroup,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...safeSize },
      rotation: inst.rotation ?? 0,
    };
  }

  /**
   * 文字节点内容溢出时,把 size.h 扩到 SVG bbox 实际高度.
   *
   * 做法:测量 contentSlot 的世界 bbox 高度 → 与 RenderedNode.size.h 比较
   * → 若超出则:
   *   1. 替换 hit-area mesh(几何尺寸固定,只能新建)
   *   2. 更新 RenderedNode.size.h(让 HandlesOverlay / hit-test 拿到新尺寸)
   *   3. 同步 instance.size.h(让下次 serialize 写盘新值)
   *   4. 触发引用 line 重新计算
   */
  private adaptTextNodeSizeToContent(
    instanceId: string,
    rendered: RenderedNode,
    contentH: number,
  ): void {
    // size_lock.h=true 时跳过自适应高度(用户已拖 N/S handle 或 Sticky 默认 lock)
    const inst = this.instances.get(instanceId);
    if (inst?.size_lock?.h) return;

    const padding = 8;
    const newH = Math.ceil(contentH + padding);

    if (newH <= rendered.size.h + 1) return;

    // outer / inner 嵌套(wrapForRotation):
    // outer.position = (px + w/2, py + h/2)
    // inner.position = (-w/2, -h/2)
    // 改 size.h 时这两处都得同步(否则 bbox 中心算错,节点会上下偏移)
    const outer = rendered.group;
    const inner = outer.children[0] as THREE.Group | undefined;
    if (!inner) return;
    const oldH = rendered.size.h;
    outer.position.y += (newH - oldH) / 2;
    inner.position.y = -newH / 2;

    // 重建 hit-area mesh(PlaneGeometry size 写死了无法 in-place 改)
    const oldHitMesh = inner.children.find(
      (c) => (c as THREE.Mesh).userData?.isTextHitArea,
    ) as THREE.Mesh | undefined;
    if (oldHitMesh) {
      oldHitMesh.geometry.dispose();
      const newGeo = new THREE.PlaneGeometry(rendered.size.w, newH);
      oldHitMesh.geometry = newGeo;
      oldHitMesh.position.set(rendered.size.w / 2, newH / 2, 0);
    }

    // 同步 BG mesh(M2.2 Sticky):它和 hitMesh 一样固定尺寸,size 变了要重建,
    // 否则黄底/位置偏(背景留旧 size 区域,文字溢到背景外看着像内容丢失)
    const oldBgMesh = inner.children.find(
      (c) => (c as THREE.Mesh).userData?.isTextBackground,
    ) as THREE.Mesh | undefined;
    if (oldBgMesh) {
      oldBgMesh.geometry.dispose();
      const newBgGeo = new THREE.PlaneGeometry(rendered.size.w, newH);
      oldBgMesh.geometry = newBgGeo;
      oldBgMesh.position.set(rendered.size.w / 2, newH / 2, -0.01);
    }

    // 更新 RenderedNode.size + instance.size(后者影响序列化 + 选中边框)
    rendered.size.h = newH;
    const persistInst = this.instances.get(instanceId);
    if (persistInst && persistInst.size) {
      persistInst.size.h = newH;
    }

    // 引用此节点的 line 端点更新(若有 magnet 连过来)
    this.updateLinesFor(instanceId);

    // 通知上层(给 CanvasView 用,刷新 HandlesOverlay 的 currentNode)
    this.onTextNodeResized?.(instanceId);
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

/**
 * 递归释放 group 下所有 mesh 的 geometry/material.
 *
 * 跳过 userData.sharedAsset = true 的 mesh:它们的 geometry/material 由
 * 静态 LRU 缓存共享管理(如 TextRenderer 的 SVG mesh),disposeGroup 不能
 * dispose,否则缓存里其他持有同引用的 mesh 会变空.
 */
/**
 * Sticky 黄底 / 红底 / 蓝底等不同色块上,文字色按亮度配对(WCAG 风格).
 * 浅色背景用深字 #222,深色背景用浅字 #eee.
 *
 * 算法:CSS 颜色 → RGB → relative luminance(简化版,sRGB 通道平均加权).
 * 阈值 0.5:>= 浅色 → 深字,< 深色 → 浅字.
 */
function pickReadableTextColor(bgCss: string): string {
  // 简单解析 #RRGGBB / #RGB,其他形式(rgb(),named)→ fallback 深字
  const rgb = parseHexColor(bgCss);
  if (!rgb) return '#222';
  // ITU-R BT.601 luma 加权 — 廉价但够 sticky 调色盘 7 色用
  const luma = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luma >= 0.5 ? '#222' : '#eee';
}

function parseHexColor(css: string): { r: number; g: number; b: number } | null {
  const s = css.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 6) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    if (h.length === 3) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
  }
  return null;
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj.userData?.sharedAsset) return;
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
