import * as THREE from 'three';
import type { SurfaceShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_FILL = '#444444';
const DEFAULT_BORDER = '#888888';
const PADDING = 24;
const SURFACE_Z = -1;
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';

/**
 * 凸包多边形 shape 渲染器（krig-grouping / Surface 用）。
 *
 * 输入：N (≥ 3) 个顶点（世界坐标）。
 * 算法：Andrew monotone chain 凸包 → 向外扩散 PADDING → ShapeGeometry fill + LineLoop 边框。
 *
 * 输出 Group:
 *   children[0] = fill mesh (半透明多边形)
 *   children[1] = border line (虚线 / 实线边框)
 *
 * Z 层：z = -1，放在最底层不遮挡 Point / Line。
 *
 * 视觉合成：
 *   - fill.color / opacity → 填充
 *   - border.color / width / style → 边框（推荐 dashed）
 */
export class ConvexHullShape implements SurfaceShapeRenderer {
  createMesh(vertices: Array<{ x: number; y: number }>, visual: ShapeVisual): THREE.Object3D {
    const group = new THREE.Group();
    group.position.z = SURFACE_Z;

    if (vertices.length < 3) return group;

    // 计算凸包 + 向外扩散
    const hull = convexHull2D(vertices);
    if (hull.length < 3) return group;
    const expanded = expandHull(hull, PADDING);

    const fillColor = visual.fill?.color ?? DEFAULT_FILL;
    const fillOpacity = visual.fill?.opacity ?? 0.15;
    const borderColor = visual.border?.color ?? DEFAULT_BORDER;
    const borderWidth = visual.border?.width ?? 1;
    const borderStyle = visual.border?.style ?? 'dashed';

    // ── fill ──
    const shape = new THREE.Shape();
    shape.moveTo(expanded[0].x, expanded[0].y);
    for (let i = 1; i < expanded.length; i++) shape.lineTo(expanded[i].x, expanded[i].y);
    shape.lineTo(expanded[0].x, expanded[0].y);

    const fillGeom = new THREE.ShapeGeometry(shape);
    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(fillColor),
      transparent: true,
      opacity: fillOpacity,
      side: THREE.DoubleSide,
    });
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.userData.role = 'fill';
    fillMesh.userData.defaultColor = fillColor;
    group.add(fillMesh);

    // ── border ──
    const borderPoints = expanded.map((p) => new THREE.Vector3(p.x, p.y, 0.01));
    borderPoints.push(borderPoints[0].clone());
    const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);

    let borderMat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    let needsLineDistances = false;
    if (borderStyle === 'dashed') {
      borderMat = new THREE.LineDashedMaterial({
        color: new THREE.Color(borderColor), linewidth: borderWidth,
        dashSize: 8, gapSize: 4,
      });
      needsLineDistances = true;
    } else if (borderStyle === 'dotted') {
      borderMat = new THREE.LineDashedMaterial({
        color: new THREE.Color(borderColor), linewidth: borderWidth,
        dashSize: 2, gapSize: 3,
      });
      needsLineDistances = true;
    } else {
      borderMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(borderColor), linewidth: borderWidth,
      });
    }
    const borderLine = new THREE.Line(borderGeom, borderMat);
    if (needsLineDistances) borderLine.computeLineDistances();
    borderLine.userData.role = 'border';
    group.add(borderLine);

    group.userData.shape = 'convex-hull';
    group.userData.hullCenter = computeCenter(expanded);
    return group;
  }

  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void {
    const fill = (mesh as THREE.Group).children?.find(
      (c) => c.userData.role === 'fill',
    ) as THREE.Mesh | undefined;
    if (!fill) return;
    const mat = fill.material as THREE.MeshBasicMaterial;
    switch (mode) {
      case 'hover':    mat.color.set(HIGHLIGHT_HOVER); break;
      case 'selected': mat.color.set(HIGHLIGHT_SELECTED); break;
      default:         mat.color.set((fill.userData.defaultColor as string) ?? DEFAULT_FILL);
    }
  }

  dispose(mesh: THREE.Object3D): void {
    mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
  }
}

// ── 凸包算法 + 工具函数 ──

/** Andrew monotone chain 2D 凸包 */
function convexHull2D(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (
    o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
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

/** 凸包向外扩散 padding（按几何中心放射） */
function expandHull(
  hull: Array<{ x: number; y: number }>, padding: number,
): Array<{ x: number; y: number }> {
  const c = computeCenter(hull);
  return hull.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: p.x + (dx / len) * padding,
      y: p.y + (dy / len) * padding,
    };
  });
}

function computeCenter(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x: cx, y: cy };
}
