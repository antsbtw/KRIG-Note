/**
 * 布局算法接口（视图算法层）。
 *
 * 位置是纯函数的产物：layout(geometries, intensions, presentations) → positions。
 * 不持久化算法输出，每次加载或切换 layout 重算。
 *
 * B3.4 起所有内置算法走 ELK（详见 docs/graph/KRIG-Graph-Layout-Spec.md）。
 * compute 接口异步化（ELK 跑在 WebWorker）。
 */
import type { Substance } from '../substance/types';
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../main/storage/types';

export interface LayoutInput {
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
  /** 给算法用的 substance 解析器（v3 物理属性驱动用） */
  substanceResolver: (id: string) => Substance | undefined;
  dimension: 2 | 3;
  bounds?: { width: number; height: number; depth?: number };

  /**
   * B3.4 新增：查询节点 label 实测 bbox（label-aware sizing 用）。
   * 实现：先查 presentation atom 中的 label_bbox 字段；未命中返回 undefined。
   * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §7
   */
  measureLabel?: (geometryId: string) => { width: number; height: number } | undefined;
}

/** B3.4 新增：边路由产物，由 ELK 输出 */
export interface EdgeSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints: Array<{ x: number; y: number }>;
}

export interface LayoutOutput {
  /** key = geometry id；Point 必有，Line/Surface/Volume 由 members 派生 */
  positions: Map<string, { x: number; y: number; z?: number }>;
  /**
   * B3.4 新增：line geometry id → 边路由 sections。
   * 仅 ELK 算法填；纯位置算法（如 manual）省略。
   * projection 通过 customizeLine 取出做折线/贝塞尔渲染。
   */
  edgeSections?: Map<string, EdgeSection[]>;
}

export interface LayoutAlgorithm {
  /** 唯一 id（'force' / 'tree-hierarchy' / 'grid' / ...） */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 支持的维度 */
  supportsDimension: (2 | 3)[];
  /** 计算位置（B3.4 起异步：ELK 跑 WebWorker） */
  compute(input: LayoutInput): Promise<LayoutOutput>;
}
