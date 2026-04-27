import * as THREE from 'three';
import type { PointShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_RADIUS = 24;
const SEGMENTS = 32;
const DEFAULT_FILL = '#4a90e2';
const DEFAULT_BORDER = '#ffffff';
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';

/**
 * 圆形 shape 渲染器。
 *
 * 输出 Group:
 *   children[0] = fill mesh (CircleGeometry)
 *   children[1] = border line (CircleGeometry edges, LineLoop)
 *
 * 视觉合成：
 *   - radius = visual.size.width / 2（默认 24）
 *   - fill = visual.fill.color / opacity
 *   - border = visual.border.color / width（width 仅 WebGL 1px 限制）
 *
 * 内容锚点：圆下方（-radius - 4），让 label 不遮挡圆。
 */
export class CircleShape implements PointShapeRenderer {
  createMesh(visual: ShapeVisual): THREE.Object3D {
    const radius = (visual.size?.width ?? DEFAULT_RADIUS * 2) / 2;
    const fillColor = visual.fill?.color ?? DEFAULT_FILL;
    const opacity = visual.fill?.opacity ?? 0.92;
    const borderColor = visual.border?.color ?? DEFAULT_BORDER;
    const borderWidth = visual.border?.width ?? 0;

    const group = new THREE.Group();

    // ── fill ──
    const fillGeom = new THREE.CircleGeometry(radius, SEGMENTS);
    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(fillColor),
      transparent: true,
      opacity,
    });
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.userData.role = 'fill';
    fillMesh.userData.defaultColor = fillColor;
    group.add(fillMesh);

    // ── border（border.width > 0 才画）──
    if (borderWidth > 0) {
      const borderPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const angle = (i / SEGMENTS) * Math.PI * 2;
        borderPoints.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          0.01,
        ));
      }
      const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
      const borderMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(borderColor),
        linewidth: borderWidth,
      });
      const borderLine = new THREE.Line(borderGeom, borderMat);
      borderLine.userData.role = 'border';
      group.add(borderLine);
    }

    group.userData.shape = 'circle';
    group.userData.radius = radius;
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
