/**
 * v2 渲染层内部类型。
 *
 * 这些类型描述"已合成的视觉参数"（substance.visual ⊕ presentation atom），
 * 由 composer 计算得出，喂给 PointMesh / LineMesh / SurfaceMesh 创建实际 Three.js Mesh。
 */
import type { GraphGeometryRecord } from '../../../../main/storage/types';
import type { Substance } from '../../substance/types';

/** 一条已合成视觉参数的几何体 */
export interface RenderableGeometry {
  geometry: GraphGeometryRecord;
  /** 节点 label 文本（来自 intension atom predicate=label） */
  label?: string;
  /** 引用的 substance（解析后） */
  substance?: Substance;
  /** 已合成的视觉参数（substance.visual + presentation 覆盖） */
  visual: ResolvedVisual;
  /** 几何中心位置（layout 算出，仅 Point 必填；Line/Surface 由 members 派生） */
  position?: { x: number; y: number; z?: number };
  /** Point 才有：是否被钉住（拖动后写入） */
  pinned?: boolean;
}

/**
 * 合成后的完整视觉参数。
 *
 * 所有字段都有默认值（在 composer 里兜底），下游不需判断 undefined。
 */
export interface ResolvedVisual {
  shape: string;                      // 'circle' | 'hexagon' | 'rounded-rect' | ...
  fill: { color: string; opacity: number };
  border: { color: string; width: number; style: 'solid' | 'dashed' | 'dotted' };
  text: { color: string; size: number; weight: number };
  size: { width: number; height: number; depth?: number };
}
