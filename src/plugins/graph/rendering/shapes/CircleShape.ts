import * as THREE from 'three';
import type { ShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_RADIUS = 24;
const SEGMENTS = 32;
const DEFAULT_FILL = '#4a90e2';
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';

/**
 * 圆形 shape 渲染器。
 *
 * 视觉合成：
 *   - radius 来自 visual.size.width / 2（默认 48 / 2 = 24）
 *   - fill 来自 visual.fill.color（默认 #4a90e2）
 *   - opacity 来自 visual.fill.opacity（默认 0.85）
 *   - border 暂不实现（v1 圆不画边框，v1.5+ 加 LineLoop）
 *
 * 内容锚点：圆心下方 -radius - 4。
 */
export class CircleShape implements ShapeRenderer {
  createMesh(visual: ShapeVisual): THREE.Object3D {
    const radius = (visual.size?.width ?? DEFAULT_RADIUS * 2) / 2;
    const fillColor = visual.fill?.color ?? DEFAULT_FILL;
    const opacity = visual.fill?.opacity ?? 0.85;

    const geom = new THREE.CircleGeometry(radius, SEGMENTS);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(fillColor),
      transparent: true,
      opacity,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.shape = 'circle';
    mesh.userData.radius = radius;
    mesh.userData.defaultColor = fillColor;
    return mesh;
  }

  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3 {
    const r = (mesh.userData.radius as number) ?? DEFAULT_RADIUS;
    return new THREE.Vector3(0, -r - 4, 0.1);
  }

  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void {
    if (!(mesh instanceof THREE.Mesh)) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    switch (mode) {
      case 'hover':
        mat.color.set(HIGHLIGHT_HOVER);
        break;
      case 'selected':
        mat.color.set(HIGHLIGHT_SELECTED);
        break;
      default:
        mat.color.set((mesh.userData.defaultColor as string) ?? DEFAULT_FILL);
    }
  }

  dispose(mesh: THREE.Object3D): void {
    if (mesh instanceof THREE.Mesh) {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
  }
}
