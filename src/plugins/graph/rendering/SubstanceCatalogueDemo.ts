/**
 * SubstanceCatalogueDemo — 内置 substance 视觉对照表（B1）。
 *
 * 用途：硬编码渲染所有内置 substance，验证：
 *   - 视觉差异化（每种 substance 长什么样）
 *   - Label 布局（每个 substance 引用哪种 LabelLayout）
 *
 * 设计要点（按 B1d 重构）：
 *   - Demo 不算 label anchor —— 每个实例只暴露 shape mesh 引用 + substance id
 *   - attachLabels 用 substance.visual.labelLayout 调用 labelLayoutRegistry 算 anchor
 *   - 切换 layout 只需改 substance 配置，无需改 demo
 *
 * 数据流：
 *   substance → shape mesh（位置已设）
 *   substance.labelLayout → labelLayoutRegistry.compute(shapeBounds, labelBounds) → anchor
 */
import * as THREE from 'three';
import { substanceLibrary } from '../substance';
import {
  pointShapeRegistry,
  lineShapeRegistry,
  surfaceShapeRegistry,
} from './shapes';
import { SvgGeometryContent } from './contents/SvgGeometryContent';
import { makeTextLabel } from '../../../lib/atom-serializers/extract';
import { labelLayoutRegistry } from './labels';

export interface CatalogueResult {
  /** 顶层 Group，含所有展示实例 */
  root: THREE.Group;
  /** 各实例引用（attachLabels 用） */
  instances: Array<{
    substanceId: string;
    label: string;
    /** shape mesh / line / surface group（已加到 root，世界坐标已就位） */
    object: THREE.Object3D;
  }>;
}

const POINT_SPACING = 200;
const POINT_ROW_Y = 280;

const LAYOUT_DEMO_ROW_Y = 100;     // 第二行：6 种 layout 的 demo（inside-top / left-of / right-of）
const LAYOUT_DEMO_SPACING = 240;

const LINE_ROW_Y = -80;
const LINE_SPACING = 240;
const LINE_LENGTH = 180;

const SURFACE_ROW_Y = -300;
const SURFACE_NODE_RADIUS = 20;

export function buildSubstanceCatalogue(): CatalogueResult {
  const root = new THREE.Group();
  root.userData.kind = 'demo-catalogue';
  const instances: CatalogueResult['instances'] = [];

  // ── 顶行：Point substances ──
  const pointSubstances = ['krig-layer', 'krig-shell-component', 'krig-view', 'krig-concept'];
  const pointStartX = -((pointSubstances.length - 1) * POINT_SPACING) / 2;

  pointSubstances.forEach((subId, i) => {
    const sub = substanceLibrary.get(subId);
    if (!sub || !sub.visual) {
      console.warn('[Catalogue] missing substance or visual:', subId);
      return;
    }

    const shapeId = sub.visual.shape ?? 'circle';
    const shape = pointShapeRegistry.get(shapeId);
    const mesh = shape.createMesh(sub.visual);

    const x = pointStartX + i * POINT_SPACING;
    mesh.position.set(x, POINT_ROW_Y, 0);
    root.add(mesh);

    instances.push({
      substanceId: subId,
      label: sub.label,
      object: mesh,
    });
  });

  // ── 第二行：layout 演示（above-center / inside-top / left-of / right-of） ──
  const layoutDemoSubstances = ['demo-above', 'demo-card', 'demo-left', 'demo-right'];
  const layoutDemoStartX = -((layoutDemoSubstances.length - 1) * LAYOUT_DEMO_SPACING) / 2;

  layoutDemoSubstances.forEach((subId, i) => {
    const sub = substanceLibrary.get(subId);
    if (!sub || !sub.visual) return;

    const shapeId = sub.visual.shape ?? 'circle';
    const shape = pointShapeRegistry.get(shapeId);
    const mesh = shape.createMesh(sub.visual);

    const x = layoutDemoStartX + i * LAYOUT_DEMO_SPACING;
    mesh.position.set(x, LAYOUT_DEMO_ROW_Y, 0);
    root.add(mesh);

    instances.push({
      substanceId: subId,
      label: sub.label,
      object: mesh,
    });
  });

  // ── 中行：Line substances ──
  const lineSubstances = [
    'relation-contains',
    'relation-refs',
    'relation-routes-to',
    'relation-defines',
    'relation-links-to',
  ];
  const lineStartX = -((lineSubstances.length - 1) * LINE_SPACING) / 2;

  lineSubstances.forEach((subId, i) => {
    const sub = substanceLibrary.get(subId);
    if (!sub || !sub.visual) return;

    const cx = lineStartX + i * LINE_SPACING;
    const cy = LINE_ROW_Y;
    const start = new THREE.Vector3(cx - LINE_LENGTH / 2, cy, 0);
    const end = new THREE.Vector3(cx + LINE_LENGTH / 2, cy, 0);

    const shape = lineShapeRegistry.get('line');
    const lineObj = shape.createMesh([start, end], sub.visual);
    root.add(lineObj);

    instances.push({
      substanceId: subId,
      label: sub.label,
      object: lineObj,
    });
  });

  // ── 底部：Surface substance ──
  const groupingSub = substanceLibrary.get('krig-grouping');
  if (groupingSub && groupingSub.visual) {
    const dummyNodePositions: Array<{ x: number; y: number }> = [];
    const dummyCount = 5;
    for (let i = 0; i < dummyCount; i++) {
      const angle = (i / dummyCount) * Math.PI * 2;
      const r = 70;
      dummyNodePositions.push({
        x: Math.cos(angle) * r,
        y: SURFACE_ROW_Y + Math.sin(angle) * r * 0.6,
      });
    }

    const surfaceShape = surfaceShapeRegistry.get('polygon');
    const surfaceObj = surfaceShape.createMesh(dummyNodePositions, groupingSub.visual);
    root.add(surfaceObj);

    // 5 个虚拟节点
    const conceptSub = substanceLibrary.get('krig-concept');
    if (conceptSub?.visual) {
      const conceptShape = pointShapeRegistry.get(conceptSub.visual.shape ?? 'circle');
      const smallVisual = {
        ...conceptSub.visual,
        size: { width: SURFACE_NODE_RADIUS * 2, height: SURFACE_NODE_RADIUS * 2 },
      };
      for (const pos of dummyNodePositions) {
        const nodeMesh = conceptShape.createMesh(smallVisual);
        nodeMesh.position.set(pos.x, pos.y, 0);
        root.add(nodeMesh);
      }
    }

    instances.push({
      substanceId: 'krig-grouping',
      label: groupingSub.label,
      object: surfaceObj,
    });
  }

  return { root, instances };
}

/**
 * 异步附加 label 到所有实例。
 *
 * 流程（每个实例）：
 *   1. SvgGeometryContent.render(label 文字) → labelObj
 *   2. 算 labelObj 的 bbox
 *   3. 算 shape mesh 的世界坐标 bbox
 *   4. labelLayoutRegistry.get(substance.labelLayout).compute(shape, label) → anchor
 *   5. labelObj.position = anchor - label 中心偏移（让 label 几何中心对齐 anchor）
 */
export async function attachLabels(result: CatalogueResult): Promise<void> {
  const contentRenderer = new SvgGeometryContent();

  for (const inst of result.instances) {
    try {
      const sub = substanceLibrary.get(inst.substanceId);
      const layoutId = sub?.visual?.labelLayout ?? 'below-center';
      const layout = labelLayoutRegistry.get(layoutId);

      // 渲染 label mesh（v1.3 SvgGeometryContent，不变）
      const atoms = makeTextLabel(inst.label);
      const labelObj = await contentRenderer.render(atoms);

      // shape 世界坐标 bbox
      const shapeBounds = new THREE.Box3().setFromObject(inst.object);

      // label 自身 bbox（local，包含 group.scale.y=-1 翻转）
      const labelBounds = contentRenderer.getBBox(labelObj);

      // 用 layout 算 anchor
      const margin = sub?.visual?.labelMargin;
      const { anchor } = layout.compute({ shapeBounds, labelBounds, margin });

      // labelObj 的本地原点在 SVG (0,0)（左上）；
      // 让 label 几何中心对齐 anchor —— 减去 labelBounds 中心
      const lcx = (labelBounds.min.x + labelBounds.max.x) / 2;
      const lcy = (labelBounds.min.y + labelBounds.max.y) / 2;
      labelObj.position.set(anchor.x - lcx, anchor.y - lcy, anchor.z);

      // 让 label 永远渲染在最上层：
      // 1. renderOrder 高（同 group 内后画）
      // 2. material.depthTest = false（不参与深度测试，永远在前）
      // 3. material.depthWrite = false（不写深度，不阻挡后画的）
      labelObj.renderOrder = 1000;
      labelObj.traverse((c) => {
        c.renderOrder = 1000;
        if (c instanceof THREE.Mesh) {
          // 注意：SvgGeometryContent 用共享 material 缓存；这里改的是缓存对象，
          // 影响后续所有 label 渲染（这正是想要的，所有 label 都在最上）
          if (c.material instanceof THREE.Material) {
            c.material.depthTest = false;
            c.material.depthWrite = false;
            c.material.transparent = true;
          }
        }
      });

      result.root.add(labelObj);
    } catch (err) {
      console.error('[Catalogue] label render FAILED for', inst.substanceId, err);
    }
  }
}

/** 释放整个 demo 的 GPU 资源 */
export function disposeSubstanceCatalogue(root: THREE.Group): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) obj.material.dispose();
    }
  });
}
