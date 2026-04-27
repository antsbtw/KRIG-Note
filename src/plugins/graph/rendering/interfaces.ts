import type * as THREE from 'three';
import type { Atom } from '../../../lib/atom-serializers/types';

export type HighlightMode = 'default' | 'hover' | 'selected';

/**
 * 形状渲染器接口（模型无关）。
 *
 * 实现按 substance.visual.shape 字段选择具体实现：
 * - 'circle'        → CircleShape
 * - 'hexagon'       → HexagonShape（v2 实施）
 * - 'rounded-rect'  → RoundRectShape（v2 实施）
 * - 'box'           → 同 rounded-rect
 *
 * 所有 ShapeRenderer 接受统一的视觉参数（来自 substance.visual ⊕ presentation atom 合成）。
 */
export interface ShapeRenderer {
  /** 创建形状 mesh，按视觉参数定制颜色 / 尺寸 / 边框等 */
  createMesh(visual: ShapeVisual): THREE.Object3D;

  /**
   * 内容（label）应放置的相对坐标（圆下方 / 矩形中心 / ...）。
   * Three.js 局部坐标系，原点在形状中心。
   */
  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3;

  /** 应用高亮态：default / hover / selected */
  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void;

  dispose(mesh: THREE.Object3D): void;
}

/**
 * 形状视觉参数（来自 substance.visual ⊕ presentation atom 合成）。
 *
 * 不是所有字段都对所有 shape 适用：
 * - 圆只用 fill / border / size.width（半径）
 * - 矩形用 fill / border / size.width / size.height
 * 实现按需读取自己关心的字段。
 */
export interface ShapeVisual {
  fill?: { color?: string; opacity?: number };
  border?: { color?: string; width?: number; style?: 'solid' | 'dashed' | 'dotted' };
  size?: { width?: number; height?: number; depth?: number };
}

/**
 * 内容（label / 数学公式 / etc）渲染器接口。
 *
 * 实现：
 * - SvgGeometryContent：Atom[] → SVG → ShapeGeometry → Mesh（默认）
 */
export interface ContentRenderer {
  /** Atom[] 渲染为 Three.js Object3D */
  render(atoms: Atom[]): Promise<THREE.Object3D>;

  /** 渲染结果的边界盒 */
  getBBox(rendered: THREE.Object3D): THREE.Box3;

  dispose(rendered: THREE.Object3D): void;
}
