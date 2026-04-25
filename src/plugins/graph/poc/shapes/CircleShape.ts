import * as THREE from 'three';
import type { ShapeRenderer, PocNode } from '../types';

const DEFAULT_RADIUS = 24;
const SEGMENTS = 32;

export class CircleShape implements ShapeRenderer {
  constructor(private radius = DEFAULT_RADIUS) {}

  createMesh(_node: PocNode): THREE.Object3D {
    const geom = new THREE.CircleGeometry(this.radius, SEGMENTS);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4a90e2, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.shape = 'circle';
    mesh.userData.radius = this.radius;
    return mesh;
  }

  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3 {
    const r = mesh.userData.radius ?? this.radius;
    return new THREE.Vector3(0, -r - 4, 0.1);
  }

  dispose(mesh: THREE.Object3D): void {
    if (mesh instanceof THREE.Mesh) {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
  }
}
