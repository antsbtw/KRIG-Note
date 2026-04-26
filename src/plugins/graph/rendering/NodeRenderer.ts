import * as THREE from 'three';
import type { ShapeRenderer, ContentRenderer, HighlightMode } from './interfaces';
import type { GraphNode, Atom } from '../engines/GraphEngine';

/**
 * NodeRenderer 组合 ShapeRenderer + ContentRenderer，统一管理节点 group。
 *
 * 输出 group 的子元素约定：
 *   group.children[0] = shape mesh（圆/矩形/...）
 *   group.children[1] = content object（SVG 几何 / DOM 浮层）
 *
 * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 3.3。
 */
export class NodeRenderer {
  constructor(
    private shape: ShapeRenderer,
    private content: ContentRenderer,
  ) {}

  async createNode(node: GraphNode): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.userData.id = node.id;
    if (node.position) {
      group.position.set(node.position.x, node.position.y, 0);
    }

    const shapeMesh = this.shape.createMesh(node);
    const contentObj = await this.content.render(node.label);

    // 内容 bbox 反馈给形状（图谱 no-op；思维导图等变种生效）
    const bbox = this.content.getBBox(contentObj);
    this.shape.fitToContent?.(shapeMesh, bbox);

    // 内容定位到形状的内容锚点
    const anchor = this.shape.getContentAnchor(shapeMesh);
    contentObj.position.copy(anchor);

    group.add(shapeMesh, contentObj);
    return group;
  }

  /**
   * 节点 label 变更：替换内容部分，保留 shape 不动。
   * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 5.3。
   */
  async updateContent(group: THREE.Group, atoms: Atom[]): Promise<void> {
    const oldContent = group.children[1];
    const newContent = await this.content.render(atoms);

    if (oldContent) {
      group.remove(oldContent);
      this.content.dispose(oldContent);
    }

    // 重新计算 bbox + 锚点（形状可能变化）
    const shapeMesh = group.children[0];
    if (shapeMesh) {
      const bbox = this.content.getBBox(newContent);
      this.shape.fitToContent?.(shapeMesh, bbox);
      const anchor = this.shape.getContentAnchor(shapeMesh);
      newContent.position.copy(anchor);
    }

    group.add(newContent);
  }

  setHighlight(group: THREE.Group, mode: HighlightMode): void {
    const shapeMesh = group.children[0];
    if (shapeMesh) this.shape.setHighlight(shapeMesh, mode);
  }

  /**
   * 暴露 ContentRenderer 给 EdgeRenderer / EditOverlay 等需要单独渲染内容
   * 但不需要包形状的场景使用（v1.3 § 9.4 边 label）。
   */
  renderContent(atoms: Atom[]): Promise<THREE.Object3D> {
    return this.content.render(atoms);
  }

  disposeContent(rendered: THREE.Object3D): void {
    this.content.dispose(rendered);
  }

  dispose(group: THREE.Group): void {
    const [shapeMesh, contentObj] = group.children;
    if (shapeMesh) this.shape.dispose(shapeMesh);
    if (contentObj) this.content.dispose(contentObj);
  }
}
