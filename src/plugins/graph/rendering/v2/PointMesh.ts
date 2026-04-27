/**
 * PointMesh — 创建 Point 几何体的 Three.js Group。
 *
 * Group 结构（与 v1.3 NodeRenderer 对齐）:
 *   group.children[0] = shape mesh（圆 / 六边形 / 矩形）
 *   group.children[1] = content object（label SVG 几何）
 *
 * 形状选择按 visual.shape 字段 → ShapeRegistry。
 */
import * as THREE from 'three';
import type { ShapeRenderer, ShapeVisual } from '../interfaces';
import { CircleShape } from '../shapes/CircleShape';
import { SvgGeometryContent } from '../contents/SvgGeometryContent';
import { makeTextLabel } from '../../../../lib/atom-serializers/extract';
import type { RenderableGeometry } from './types';

// ── ShapeRenderer 注册表（按 visual.shape 字段选） ──

const shapeRegistry = new Map<string, ShapeRenderer>();
shapeRegistry.set('circle', new CircleShape());
// hexagon / rounded-rect / box 等 v1.5+ 加，目前回退到 circle

function getShapeRenderer(shapeId: string): ShapeRenderer {
  return shapeRegistry.get(shapeId) ?? shapeRegistry.get('circle')!;
}

// ── 共享 ContentRenderer（SVG label 渲染）──

const contentRenderer = new SvgGeometryContent();

/** 创建 Point group。返回 Promise 因为 SVG content 异步加载字体 */
export async function createPointGroup(item: RenderableGeometry): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.userData.id = item.geometry.id;
  group.userData.kind = 'point';

  if (item.position) {
    group.position.set(item.position.x, item.position.y, 0);
  }

  // ── shape ──
  const shape = getShapeRenderer(item.visual.shape);
  const shapeVisual: ShapeVisual = {
    fill: item.visual.fill,
    border: item.visual.border,
    size: item.visual.size,
  };
  const shapeMesh = shape.createMesh(shapeVisual);

  // ── content (label) ──
  if (item.label) {
    const atoms = makeTextLabel(item.label);
    const contentObj = await contentRenderer.render(atoms);
    const anchor = shape.getContentAnchor(shapeMesh);
    contentObj.position.copy(anchor);
    group.add(shapeMesh, contentObj);
  } else {
    // 没有 label：仍然占位 children[1]，保持索引稳定
    group.add(shapeMesh, new THREE.Group());
  }

  return group;
}

/** 释放 Point group 的 GPU 资源 */
export function disposePointGroup(group: THREE.Group): void {
  const [shapeMesh, contentObj] = group.children;
  if (shapeMesh) {
    const shape = getShapeRenderer((group.userData.shape as string) ?? 'circle');
    shape.dispose(shapeMesh);
  }
  if (contentObj) {
    contentRenderer.dispose(contentObj);
  }
}
