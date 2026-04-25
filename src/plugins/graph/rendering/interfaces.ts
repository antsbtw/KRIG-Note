import type * as THREE from 'three';
import type { Atom } from '../../../lib/atom-serializers/svg';
import type { GraphNode } from '../engines/GraphEngine';

/**
 * 形状渲染抽象。
 *
 * 实现示例：
 * - CircleShape：图谱节点圆
 * - RoundRectShape：思维导图节点框（独立 spec 实施）
 * - DiamondShape：BPMN 网关
 * - TaskShape / EventShape：BPMN 任务 / 事件
 *
 * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 3.1。
 */
export interface ShapeRenderer {
  /** 根据节点数据创建形状 mesh */
  createMesh(node: GraphNode): THREE.Object3D;

  /**
   * 根据内容 bbox 调整形状尺寸（可选）。
   * - 图谱 CircleShape：no-op（圆固定半径）
   * - 思维导图 RoundRectShape：依据 bbox 调整框宽高
   */
  fitToContent?(mesh: THREE.Object3D, contentBBox: THREE.Box3): void;

  /** 内容应放置的相对坐标（圆下方 / 框中心 / ...） */
  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3;

  dispose(mesh: THREE.Object3D): void;
}

/**
 * 内容渲染抽象。
 *
 * 实现示例：
 * - SvgGeometryContent：SVG 几何（默认显示态）
 * - CssDomContent：CSS2DRenderer 浮层（编辑态，Phase 3 实现）
 *
 * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 3.2。
 */
export interface ContentRenderer {
  /** Atom[] 渲染为 Three.js Object3D */
  render(atoms: Atom[]): Promise<THREE.Object3D>;

  /** 渲染结果的边界盒（供 ShapeRenderer.fitToContent 使用） */
  getBBox(rendered: THREE.Object3D): THREE.Box3;

  dispose(rendered: THREE.Object3D): void;
}

export type HighlightMode = 'default' | 'hover' | 'selected';

/**
 * 形状库：变种通过实现 ShapeLibrary 提供自己的形状集合。
 *
 * 详见 docs/graph/KRIG_GraphView_Spec_v1.3.md § 10.1。
 */
export interface ShapeLibrary {
  getDefaultShape(): ShapeRenderer;
  getShape(nodeType: string): ShapeRenderer;
  registerShape(nodeType: string, renderer: ShapeRenderer): void;
}
