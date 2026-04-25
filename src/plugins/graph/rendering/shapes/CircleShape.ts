import * as THREE from 'three';
import type { ShapeRenderer, HighlightMode } from '../interfaces';
import type { GraphNode } from '../../engines/GraphEngine';

const DEFAULT_RADIUS = 24;
const SEGMENTS = 32;
const DEFAULT_COLOR = 0x4a90e2;
const HIGHLIGHT_HOVER = 0xffaa3b;
const HIGHLIGHT_SELECTED = 0x55cc88;

/**
 * 图谱默认形状：圆。
 *
 * 内容锚点：圆心下方 (0, -radius - 4, 0.1)，内容垂直摆放。
 * fitToContent: no-op（圆固定半径，不随内容调整）。
 *
 * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 8.2。
 */
export class CircleShape implements ShapeRenderer {
  constructor(private radius = DEFAULT_RADIUS) {}

  createMesh(_node: GraphNode): THREE.Object3D {
    const geom = new THREE.CircleGeometry(this.radius, SEGMENTS);
    const mat = new THREE.MeshBasicMaterial({
      color: DEFAULT_COLOR,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.shape = 'circle';
    mesh.userData.radius = this.radius;
    mesh.userData.defaultColor = DEFAULT_COLOR;
    return mesh;
  }

  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3 {
    const r = (mesh.userData.radius as number) ?? this.radius;
    return new THREE.Vector3(0, -r - 4, 0.1);
  }

  /**
   * 应用高亮（v1.3 § 7.3）。
   * - default: 蓝
   * - hover: 橙
   * - selected: 绿
   */
  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void {
    if (!(mesh instanceof THREE.Mesh)) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    switch (mode) {
      case 'hover':
        mat.color.setHex(HIGHLIGHT_HOVER);
        break;
      case 'selected':
        mat.color.setHex(HIGHLIGHT_SELECTED);
        break;
      default:
        mat.color.setHex((mesh.userData.defaultColor as number) ?? DEFAULT_COLOR);
    }
  }

  dispose(mesh: THREE.Object3D): void {
    if (mesh instanceof THREE.Mesh) {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
  }
}
