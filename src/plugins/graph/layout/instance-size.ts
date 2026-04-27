/**
 * 节点占位框计算（含 label 空间）。
 *
 * 用法：layout adapter 在喂给 ELK 前调一下，得到"节点 + label 整体占位框"
 * 的 width/height，让 ELK 排间距时不挤压 label。
 *
 * 算法（详见 docs/graph/KRIG-Graph-Layout-Spec.md §7.7）：
 *   - 没 measureLabel 命中 → 用 substance.size 兜底（B3.4.5 之前的行为）
 *   - 有命中：
 *     · inside-* → 取 substance.size 与 (label + 2*margin) 的较大者
 *     · above/below-center → 高度叠加（substance.height + label.height + margin）
 *     · left/right-of → 宽度叠加（substance.width + label.width + margin）
 *
 * label_bbox 来自 LayoutInput.measureLabel（B3.4.5：异步测量后写入 presentation atom）。
 */
import type { Substance } from '../substance/types';

/** 默认节点尺寸（substance 没声明 size 时） */
export const DEFAULT_NODE_WIDTH = 120;
export const DEFAULT_NODE_HEIGHT = 60;

/** label 与 shape 边的内/外间距 */
const DEFAULT_INNER_MARGIN = 12;
const DEFAULT_OUTER_MARGIN = 8;

export interface BoxSize {
  width: number;
  height: number;
}

/**
 * 计算节点（含 label）总占位框。
 *
 * @param substance 该节点的 substance（含 visual.size + visual.labelLayout）
 * @param labelBbox label 实测 bbox（来自 measureLabel；undefined = 没测过/兜底）
 */
export function getInstanceBoxSize(
  substance: Substance | undefined,
  labelBbox: BoxSize | undefined,
): BoxSize {
  const baseW = substance?.visual?.size?.width ?? DEFAULT_NODE_WIDTH;
  const baseH = substance?.visual?.size?.height ?? DEFAULT_NODE_HEIGHT;

  if (!labelBbox) return { width: baseW, height: baseH };

  const labelLayout = substance?.visual?.labelLayout ?? 'below-center';
  const margin = substance?.visual?.labelMargin;

  switch (labelLayout) {
    case 'inside-center':
    case 'inside-top': {
      const m = margin ?? DEFAULT_INNER_MARGIN;
      return {
        width: Math.max(baseW, labelBbox.width + 2 * m),
        height: Math.max(baseH, labelBbox.height + 2 * m),
      };
    }
    case 'above-center':
    case 'below-center': {
      const m = margin ?? DEFAULT_OUTER_MARGIN;
      return {
        width: Math.max(baseW, labelBbox.width),
        height: baseH + labelBbox.height + m,
      };
    }
    case 'left-of':
    case 'right-of': {
      const m = margin ?? DEFAULT_OUTER_MARGIN;
      return {
        width: baseW + labelBbox.width + m,
        height: Math.max(baseH, labelBbox.height),
      };
    }
    default:
      // 未知 labelLayout：按 below-center 兜底
      return {
        width: Math.max(baseW, labelBbox.width),
        height: baseH + labelBbox.height + DEFAULT_OUTER_MARGIN,
      };
  }
}
