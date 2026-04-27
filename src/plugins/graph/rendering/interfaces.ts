import type * as THREE from 'three';
import type { Atom } from '../../../lib/atom-serializers/types';

export type HighlightMode = 'default' | 'hover' | 'selected';

/**
 * 形状视觉参数（来自 substance.visual ⊕ presentation atom 合成）。
 *
 * 不是所有字段都对所有 shape 适用：
 * - 圆只用 fill / border / size.width（半径 = width/2）
 * - 矩形用 fill / border / size.width / size.height
 * - 线只用 border（fill 忽略）
 * 实现按需读取自己关心的字段。
 */
export interface ShapeVisual {
  fill?: { color?: string; opacity?: number };
  border?: { color?: string; width?: number; style?: 'solid' | 'dashed' | 'dotted' };
  text?: { color?: string; size?: number; font?: string; weight?: number };
  size?: { width?: number; height?: number; depth?: number };
  /** Line 类 shape 用：箭头方向 */
  arrow?: 'none' | 'forward' | 'backward' | 'both';
  /** 箭头大小（世界单位） */
  arrowSize?: number;
}

// ── Point 类形状（圆 / 多边形 / 矩形 / 球等） ──

/**
 * Point 形状渲染器：固定形状，用视觉参数定制。
 *
 * 实现按 substance.visual.shape 字段选择：
 * - 'circle'        → CircleShape
 * - 'hexagon'       → HexagonShape
 * - 'rounded-rect'  → RoundedRectShape
 * - 'box'           → RoundedRectShape (alias)
 */
export interface PointShapeRenderer {
  /** 创建形状 mesh */
  createMesh(visual: ShapeVisual): THREE.Object3D;
  /** 应用高亮态 */
  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void;
  dispose(mesh: THREE.Object3D): void;
}

// ── Line 类形状 ──

/**
 * Line 形状渲染器：根据端点位置 + 视觉参数创建线段。
 *
 * v1 简化：直线连接首尾两端点。
 * v1.5+：可加曲线 / 弧线偏移（多重图）/ 箭头。
 */
export interface LineShapeRenderer {
  /**
   * 创建 line mesh。
   * @param points 至少 2 个端点（世界坐标）
   * @param visual 视觉参数（border 决定线型）
   */
  createMesh(points: THREE.Vector3[], visual: ShapeVisual): THREE.Object3D;
  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void;
  dispose(mesh: THREE.Object3D): void;
}

// ── Surface 类形状 ──

/**
 * Surface 形状渲染器：根据顶点位置创建凸包多边形。
 *
 * v1：2D 凸包（Andrew monotone chain）+ ShapeGeometry fill + LineLoop 边框。
 */
export interface SurfaceShapeRenderer {
  /**
   * 创建 surface mesh。
   * @param vertices 至少 3 个顶点（世界坐标，将算凸包）
   * @param visual 视觉参数（fill 决定填充，border 决定边框）
   */
  createMesh(vertices: Array<{ x: number; y: number }>, visual: ShapeVisual): THREE.Object3D;
  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void;
  dispose(mesh: THREE.Object3D): void;
}

// ── 内容（label）渲染器 ──

/**
 * 内容渲染器接口（label / 公式 / etc）。
 *
 * 实现：
 * - SvgGeometryContent：Atom[] → SVG → ShapeGeometry → Mesh（默认）
 */
export interface ContentRenderer {
  render(atoms: Atom[]): Promise<THREE.Object3D>;
  getBBox(rendered: THREE.Object3D): THREE.Box3;
  dispose(rendered: THREE.Object3D): void;
}

// ── 旧 ShapeRenderer 类型保留作向后兼容（== PointShapeRenderer） ──
// 既有的 CircleShape 仍可用，新代码直接用 PointShapeRenderer
export type ShapeRenderer = PointShapeRenderer;
