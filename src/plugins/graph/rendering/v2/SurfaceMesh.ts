/**
 * SurfaceMesh — 创建 Surface 几何体（凸包多边形）。
 *
 * 算法：取所有 members（Point）的 2D 位置，算 2D 凸包（Andrew monotone chain），
 * 用 ShapeGeometry 渲染半透明 fill + LineLoop 渲染边框。
 *
 * Z 层：放在最底（z = -1），不遮挡 Point / Line。
 */
import * as THREE from 'three';
import type { RenderableGeometry } from './types';

const SURFACE_Z = -1;
const PADDING = 24;  // 凸包向外扩散，避免紧贴节点

/** 创建 Surface group。返回 Group 含 fill mesh + 边框 line。 */
export function createSurfaceGroup(
  item: RenderableGeometry,
  memberPositions: Array<{ x: number; y: number }>,
): THREE.Object3D | null {
  if (memberPositions.length < 3) return null;

  // 计算 2D 凸包
  const hull = convexHull2D(memberPositions);
  if (hull.length < 3) return null;

  // 向外扩散 PADDING（按几何中心放射）
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  const expanded = hull.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: p.x + (dx / len) * PADDING,
      y: p.y + (dy / len) * PADDING,
    };
  });

  const group = new THREE.Group();
  group.userData.id = item.geometry.id;
  group.userData.kind = 'surface';
  group.position.z = SURFACE_Z;

  // ── fill ──
  const shape = new THREE.Shape();
  shape.moveTo(expanded[0].x, expanded[0].y);
  for (let i = 1; i < expanded.length; i++) shape.lineTo(expanded[i].x, expanded[i].y);
  shape.lineTo(expanded[0].x, expanded[0].y);

  const fillGeom = new THREE.ShapeGeometry(shape);
  const fillMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(item.visual.fill.color),
    transparent: true,
    opacity: item.visual.fill.opacity,
    side: THREE.DoubleSide,
  });
  const fillMesh = new THREE.Mesh(fillGeom, fillMat);

  // ── border ──
  const borderPoints = expanded.map((p) => new THREE.Vector3(p.x, p.y, 0.01));
  borderPoints.push(borderPoints[0].clone());  // 闭合
  const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
  const borderMat = item.visual.border.style === 'dashed'
    ? new THREE.LineDashedMaterial({
        color: new THREE.Color(item.visual.border.color),
        linewidth: item.visual.border.width,
        dashSize: 8,
        gapSize: 4,
      })
    : new THREE.LineBasicMaterial({
        color: new THREE.Color(item.visual.border.color),
        linewidth: item.visual.border.width,
      });
  const borderLine = new THREE.Line(borderGeom, borderMat);
  if (borderMat instanceof THREE.LineDashedMaterial) {
    borderLine.computeLineDistances();
  }

  group.add(fillMesh, borderLine);
  return group;
}

export function disposeSurfaceGroup(group: THREE.Object3D): void {
  if (!(group instanceof THREE.Group)) return;
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    } else if (child instanceof THREE.Line) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  }
}

// ── 2D 凸包（Andrew monotone chain）──

function convexHull2D(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Array<{ x: number; y: number }> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
