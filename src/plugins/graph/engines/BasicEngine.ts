import * as THREE from 'three';
import dagre from 'dagre';
import { GraphEngine, type ShapeLibrary, type LayoutAlgo, type GraphNode, type GraphEdge } from './GraphEngine';

/**
 * BasicEngine — 验证用最简引擎
 *
 * 圆形节点（默认蓝色，选中红色）+ Dagre 自动布局。
 * 不承担任何业务语义，纯粹为了验证 GraphEngine 父类接口的完整性。
 */

const NODE_RADIUS = 30;
const NODE_SIZE = NODE_RADIUS * 2;

const COLOR_DEFAULT = 0x2d7ff9;
const COLOR_SELECTED = 0xff6b6b;

class BasicShapeLibrary implements ShapeLibrary {
  createShape(_node: GraphNode): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(NODE_RADIUS, 32);
    const material = new THREE.MeshBasicMaterial({ color: COLOR_DEFAULT });
    return new THREE.Mesh(geometry, material);
  }

  applyHighlight(mesh: THREE.Mesh, selected: boolean): void {
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(selected ? COLOR_SELECTED : COLOR_DEFAULT);
  }

  getNodeSize(_type: string): { width: number; height: number } {
    return { width: NODE_SIZE, height: NODE_SIZE };
  }
}

class DagreLayout implements LayoutAlgo {
  name = 'dagre';

  async compute(
    nodes: GraphNode[],
    edges: GraphEdge[],
    shapeLib: ShapeLibrary,
  ): Promise<Map<string, { x: number; y: number }>> {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 80 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of nodes) {
      const size = shapeLib.getNodeSize(node.type);
      g.setNode(node.id, { width: size.width, height: size.height });
    }
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    // 计算图整体中心，把节点坐标平移让画布居中
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    g.nodes().forEach((id) => {
      const n = g.node(id);
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const positions = new Map<string, { x: number; y: number }>();
    g.nodes().forEach((id) => {
      const n = g.node(id);
      // dagre y 轴向下，Three.js 世界坐标 y 轴向上 → 取反
      positions.set(id, { x: n.x - cx, y: -(n.y - cy) });
    });
    return positions;
  }
}

export class BasicEngine extends GraphEngine {
  getShapeLibrary(): ShapeLibrary {
    return new BasicShapeLibrary();
  }

  getLayoutAlgorithm(): LayoutAlgo {
    return new DagreLayout();
  }
}
