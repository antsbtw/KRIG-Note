import * as THREE from 'three';

export type Atom = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Atom[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export interface ShapeRenderer {
  createMesh(node: PocNode): THREE.Object3D;
  fitToContent?(mesh: THREE.Object3D, contentBBox: THREE.Box3): void;
  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3;
  dispose(mesh: THREE.Object3D): void;
}

export interface ContentRenderer {
  render(atoms: Atom[]): Promise<THREE.Object3D>;
  getBBox(rendered: THREE.Object3D): THREE.Box3;
  dispose(rendered: THREE.Object3D): void;
}

export type PocNode = {
  id: string;
  position: { x: number; y: number };
  atoms: Atom[];
};
