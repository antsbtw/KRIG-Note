/**
 * 布局算法接口（视图算法层）。
 *
 * 位置是纯函数的产物：layout(geometries, intensions, presentations) → positions。
 * 不持久化算法输出，每次加载或切换 layout 重算。
 *
 * v1 实现：force / grid / manual
 * v1.5+：tree / radial / circle / sugiyama
 * v2.0：force-3d
 *
 * 详细设计见 docs/graph/KRIG-Graph-Import-Spec.md §2
 */
import type { Substance } from '../substance/types';

// 临时复用现有 GraphNodeRecord/EdgeRecord 类型（D2 数据层重构后改为 GraphGeometryRecord 等新类型）
// 这里先用占位符，避免循环依赖
export interface GeometryInput {
  id: string;
  graph_id: string;
  kind: 'point' | 'line' | 'surface' | 'volume';
  members: string[];
}

export interface IntensionInput {
  subject_id: string;
  predicate: string;
  value: string;
  value_kind: string;
}

export interface PresentationInput {
  layout_id: string;
  subject_id: string;
  attribute: string;
  value: string;
  value_kind: string;
}

export interface LayoutInput {
  geometries: GeometryInput[];
  intensions: IntensionInput[];
  presentations: PresentationInput[];
  /** 给算法用的 substance 解析器（v3 物理属性驱动用） */
  substanceResolver: (id: string) => Substance | undefined;
  dimension: 2 | 3;
  bounds?: { width: number; height: number; depth?: number };
}

export interface LayoutOutput {
  /** key = geometry id；Point 必有，Line/Surface/Volume 由 members 派生 */
  positions: Map<string, { x: number; y: number; z?: number }>;
}

export interface LayoutAlgorithm {
  /** 唯一 id（'force' / 'tree' / 'manual' ...） */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 支持的维度 */
  supportsDimension: (2 | 3)[];
  /** 计算位置（纯函数） */
  compute(input: LayoutInput): LayoutOutput;
}
