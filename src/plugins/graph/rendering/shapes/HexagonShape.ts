import * as THREE from 'three';
import type { PointShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_RADIUS = 32;
const DEFAULT_FILL = '#1a1a1a';
const DEFAULT_BORDER = '#888888';
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';

/**
 * 六边形 shape 渲染器（krig-layer 用）。
 *
 * 输出 Group:
 *   children[0] = fill mesh (ShapeGeometry of hexagon)
 *   children[1] = border line (LineLoop of hexagon edges)
 *
 * 视觉合成：
 *   - radius = visual.size.width / 2（默认 32 = 64/2）
 *   - fill = visual.fill.color / opacity
 *   - border = visual.border.color / width
 *
 * "尖朝上"几何（pointy-top）— 6 个顶点逆时针：
 *   顶点 i 角度 = π/2 + i * π/3
 *
 * 内容锚点：六边形下方（让 label 不遮挡）。
 */
export class HexagonShape implements PointShapeRenderer {
  createMesh(visual: ShapeVisual): THREE.Object3D {
    const radius = (visual.size?.width ?? DEFAULT_RADIUS * 2) / 2;
    const fillColor = visual.fill?.color ?? DEFAULT_FILL;
    const opacity = visual.fill?.opacity ?? 0.92;
    const borderColor = visual.border?.color ?? DEFAULT_BORDER;
    const borderWidth = visual.border?.width ?? 0;

    const group = new THREE.Group();

    // 6 顶点（pointy-top）
    const vertices: THREE.Vector2[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 2 + (i * Math.PI) / 3;
      vertices.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ));
    }

    // ── fill ──
    const shape = new THREE.Shape(vertices);
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
      const borderPoints = vertices.map((v) => new THREE.Vector3(v.x, v.y, 0.01));
      borderPoints.push(borderPoints[0].clone());  // 闭合
      const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
      const borderMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(borderColor),
        linewidth: borderWidth,
      });
      const borderLine = new THREE.Line(borderGeom, borderMat);
      borderLine.userData.role = 'border';
      group.add(borderLine);
    }

    group.userData.shape = 'hexagon';
    group.userData.radius = radius;
    return group;
  }

  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3 {
    const r = (mesh.userData.radius as number) ?? DEFAULT_RADIUS;
    return new THREE.Vector3(0, -r - 6, 0.1);
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
