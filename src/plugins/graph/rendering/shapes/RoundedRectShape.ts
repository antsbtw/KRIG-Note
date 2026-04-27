import * as THREE from 'three';
import type { PointShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 56;
const DEFAULT_RADIUS_RATIO = 0.15;  // 圆角半径 = min(w,h) * ratio
const DEFAULT_FILL = '#2a4a6a';
const DEFAULT_BORDER = '#4a7aaa';
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';

/**
 * 圆角矩形 shape 渲染器（krig-shell-component 用）。
 *
 * 输出 Group:
 *   children[0] = fill mesh (ShapeGeometry of rounded rect)
 *   children[1] = border line (LineLoop along rounded edge)
 *
 * 视觉合成：
 *   - width = visual.size.width（默认 100）
 *   - height = visual.size.height（默认 56）
 *   - 圆角 radius = min(w, h) * 0.15
 *   - fill / border 同上
 *
 * 内容锚点：矩形中心（label 在矩形内）。
 */
export class RoundedRectShape implements PointShapeRenderer {
  createMesh(visual: ShapeVisual): THREE.Object3D {
    const w = visual.size?.width ?? DEFAULT_WIDTH;
    const h = visual.size?.height ?? DEFAULT_HEIGHT;
    const r = Math.min(w, h) * DEFAULT_RADIUS_RATIO;
    const fillColor = visual.fill?.color ?? DEFAULT_FILL;
    const opacity = visual.fill?.opacity ?? 0.92;
    const borderColor = visual.border?.color ?? DEFAULT_BORDER;
    const borderWidth = visual.border?.width ?? 0;

    const group = new THREE.Group();

    // 圆角矩形 Shape（Three.js Shape API）
    const shape = makeRoundedRectShape(w, h, r);

    // ── fill ──
    const fillGeom = new THREE.ShapeGeometry(shape);
    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(fillColor),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.userData.role = 'fill';
    fillMesh.userData.defaultColor = fillColor;
    group.add(fillMesh);

    // ── border ──
    if (borderWidth > 0) {
      const points = shape.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0.01));
      points.push(points[0].clone());
      const borderGeom = new THREE.BufferGeometry().setFromPoints(points);
      const borderMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(borderColor),
        linewidth: borderWidth,
      });
      const borderLine = new THREE.Line(borderGeom, borderMat);
      borderLine.userData.role = 'border';
      group.add(borderLine);
    }

    group.userData.shape = 'rounded-rect';
    group.userData.width = w;
    group.userData.height = h;
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

/** 构造圆角矩形 Shape（中心在原点） */
function makeRoundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);

  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}
