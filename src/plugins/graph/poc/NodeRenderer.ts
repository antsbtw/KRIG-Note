import * as THREE from 'three';
import type { ShapeRenderer, ContentRenderer, PocNode } from './types';

export class NodeRenderer {
  constructor(
    private shape: ShapeRenderer,
    private content: ContentRenderer,
  ) {}

  async createNode(node: PocNode): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.position.set(node.position.x, node.position.y, 0);
    group.userData.id = node.id;

    const shapeMesh = this.shape.createMesh(node);
    const contentObj = await this.content.render(node.atoms);

    const bbox = this.content.getBBox(contentObj);
    this.shape.fitToContent?.(shapeMesh, bbox);

    const anchor = this.shape.getContentAnchor(shapeMesh);
    contentObj.position.copy(anchor);

    group.add(shapeMesh, contentObj);
    return group;
  }

  dispose(group: THREE.Group): void {
    const [shapeMesh, contentObj] = group.children;
    if (shapeMesh) this.shape.dispose(shapeMesh);
    if (contentObj) this.content.dispose(contentObj);
  }
}
