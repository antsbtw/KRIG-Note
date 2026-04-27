/**
 * SubstanceCatalogueDemo — 内置 substance 视觉对照表（B1）。
 *
 * 用途：
 *   GraphView 进入 Graph 模式时，硬编码渲染所有内置 substance 的实例，
 *   让用户能直接看到每种物质长什么样、关系线的视觉差异、Surface 凸包效果。
 *
 * 不接数据库、不接交互 — 纯静态展示。
 *
 * 布局：
 *   ─ 顶行：4 个 Point substance 横向排开
 *       krig-layer / krig-shell-component / krig-view / krig-concept
 *   ─ 中行：5 条 Line substance 排成阶梯
 *       relation-contains / refs / routes-to / defines / links-to
 *   ─ 底部：1 个 Surface substance 围住几个虚拟节点
 *       krig-grouping
 *
 * Label：每个实例下方显示 substance.id（B1c 实施 SVG 几何 label 后才有）
 */
import * as THREE from 'three';
import { substanceLibrary } from '../substance';
import {
  pointShapeRegistry,
  lineShapeRegistry,
  surfaceShapeRegistry,
} from './shapes';

export interface CatalogueResult {
  /** 顶层 Group，含所有展示实例 */
  root: THREE.Group;
  /** 各实例 group 引用，供后续添加 label 用 */
  instances: Array<{
    substanceId: string;
    label: string;
    object: THREE.Object3D;
    /** label 应放置的世界坐标（每个 shape 自己决定锚点 + group 位置） */
    labelAnchor: THREE.Vector3;
  }>;
}

const POINT_SPACING = 200;
const POINT_ROW_Y = 200;

const LINE_ROW_Y = 0;
const LINE_SPACING = 240;
const LINE_LENGTH = 180;

const SURFACE_ROW_Y = -250;
const SURFACE_NODE_RADIUS = 20;

/**
 * 构建对照表。
 * 调用方需把返回的 `root` 加到 SceneManager.scene。
 */
export function buildSubstanceCatalogue(): CatalogueResult {
  const root = new THREE.Group();
  root.userData.kind = 'demo-catalogue';
  const instances: CatalogueResult['instances'] = [];

  // ── 顶行：Point substances ──
  const pointSubstances = ['krig-layer', 'krig-shell-component', 'krig-view', 'krig-concept'];
  const pointStartX = -((pointSubstances.length - 1) * POINT_SPACING) / 2;

  pointSubstances.forEach((subId, i) => {
    const sub = substanceLibrary.get(subId);
    if (!sub || !sub.visual) return;

    const shapeId = sub.visual.shape ?? 'circle';
    const shape = pointShapeRegistry.get(shapeId);
    const mesh = shape.createMesh(sub.visual);

    // 定位
    mesh.position.set(pointStartX + i * POINT_SPACING, POINT_ROW_Y, 0);
    root.add(mesh);

    // label 锚点：shape 的 contentAnchor + 实例位置
    const localAnchor = shape.getContentAnchor(mesh);
    const worldAnchor = mesh.position.clone().add(localAnchor);

    instances.push({
      substanceId: subId,
      label: sub.label,
      object: mesh,
      labelAnchor: worldAnchor,
    });
  });

  // ── 中行：Line substances（每条线下方有 label）──
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

    // 线段两端点（横向，长度 LINE_LENGTH）
    const start = new THREE.Vector3(cx - LINE_LENGTH / 2, cy, 0);
    const end = new THREE.Vector3(cx + LINE_LENGTH / 2, cy, 0);

    const shape = lineShapeRegistry.get('line');
    const lineObj = shape.createMesh([start, end], sub.visual);
    root.add(lineObj);

    // label 锚点：线段中点稍下方
    const labelAnchor = new THREE.Vector3(cx, cy - 24, 0.5);

    instances.push({
      substanceId: subId,
      label: sub.label,
      object: lineObj,
      labelAnchor,
    });
  });

  // ── 底部：Surface substance（凸包围住几个虚拟节点）──
  const groupingSub = substanceLibrary.get('krig-grouping');
  if (groupingSub && groupingSub.visual) {
    // 5 个虚拟节点（小圆）— 仅用于让 Surface 有凸包顶点
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

    // 先画 Surface（z=-1，会被节点遮住）
    const surfaceShape = surfaceShapeRegistry.get('polygon');
    const surfaceObj = surfaceShape.createMesh(dummyNodePositions, groupingSub.visual);
    root.add(surfaceObj);

    // 再画虚拟节点（用 krig-concept 的视觉）
    const conceptSub = substanceLibrary.get('krig-concept');
    if (conceptSub?.visual) {
      const conceptShape = pointShapeRegistry.get(conceptSub.visual.shape ?? 'circle');
      // 用小尺寸（让它们看起来是"被圈起来"的节点）
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

    // Surface label 在凸包上方
    const labelAnchor = new THREE.Vector3(0, SURFACE_ROW_Y + 80, 0.5);
    instances.push({
      substanceId: 'krig-grouping',
      label: groupingSub.label,
      object: surfaceObj,
      labelAnchor,
    });
  }

  return { root, instances };
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
