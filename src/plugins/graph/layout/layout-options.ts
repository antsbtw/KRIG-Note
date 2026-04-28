/**
 * 图谱级 layout 参数解析器（B4.1）。
 *
 * 把 LayoutInput.layoutOptions 里"画板模型"语义的 key（layout.direction 等）
 * 翻译为 ELK 引擎认识的 key（elk.direction 等），生成可注入 ELK extraOptions
 * 的对象。
 *
 * 用户值优先：算法把内部默认 extraOptions 跟本函数返回值合并，后者覆盖前者。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md §3.2
 */
import type { GraphPresentationAtomRecord } from '../../../main/storage/types';
import type { LayoutOptions } from './elk-runner';

/**
 * 从 presentation atom 中提取图谱级 layout 参数（B4.1）。
 *
 * 命中规则：
 *   - subject_id === graphId（图谱本身的属性，不是节点的）
 *   - layout_id === activeLayoutId 或 '*'（'*' 跨布局共享，特定 layout 优先）
 *   - attribute 以 'layout.' 开头
 *
 * 同 attribute 多条命中时：activeLayoutId 优先于 '*'（更具体覆盖通用）。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md §3.2
 */
export function readGraphLevelLayoutOptions(
  presentations: GraphPresentationAtomRecord[],
  graphId: string,
  activeLayoutId: string,
): Record<string, string> {
  const wildcard: Record<string, string> = {};
  const specific: Record<string, string> = {};
  for (const p of presentations) {
    if (p.subject_id !== graphId) continue;
    if (!p.attribute.startsWith('layout.')) continue;
    if (p.layout_id === '*') wildcard[p.attribute] = p.value;
    else if (p.layout_id === activeLayoutId) specific[p.attribute] = p.value;
  }
  return { ...wildcard, ...specific };
}

/** 已识别的图谱级 layout 参数 key（v1）。 */
export const KNOWN_LAYOUT_OPTION_KEYS = [
  'layout.direction',
  'layout.edge-style',
  'layout.spacing.node',
  'layout.spacing.layer',
] as const;

/**
 * 把画板模型 key 映射为 ELK 选项。
 *
 * 算法消费规则：
 *   - tree 类（mrtree / layered）消费所有 4 个
 *   - force 仅消费 spacing.node
 *   - grid（box）仅消费 spacing.node
 *
 * 未识别的 key 静默忽略（forward-compat：用户未来可能写 v1.5+ 才支持的 key）。
 */
export function resolveLayoutOptions(
  options: Record<string, string> | undefined,
  algorithm: 'mrtree' | 'layered' | 'force' | 'box',
): LayoutOptions {
  if (!options) return {};
  const out: LayoutOptions = {};

  const direction = options['layout.direction'];
  if (direction && (algorithm === 'mrtree' || algorithm === 'layered')) {
    if (direction === 'DOWN' || direction === 'UP' || direction === 'LEFT' || direction === 'RIGHT') {
      out['elk.direction'] = direction;
    }
  }

  const edgeStyle = options['layout.edge-style'];
  if (edgeStyle && algorithm === 'layered') {
    const map: Record<string, string> = {
      orthogonal: 'ORTHOGONAL',
      polyline: 'POLYLINE',
      splines: 'SPLINES',
      straight: 'UNDEFINED',
    };
    const elkValue = map[edgeStyle];
    if (elkValue) out['elk.edgeRouting'] = elkValue;
  }

  const spacingNode = options['layout.spacing.node'];
  if (spacingNode && /^\d+(\.\d+)?$/.test(spacingNode)) {
    out['elk.spacing.nodeNode'] = spacingNode;
    if (algorithm === 'mrtree') out['elk.mrtree.spacing.nodeNode'] = spacingNode;
  }

  const spacingLayer = options['layout.spacing.layer'];
  if (spacingLayer && /^\d+(\.\d+)?$/.test(spacingLayer) && algorithm === 'layered') {
    out['elk.layered.spacing.nodeNodeBetweenLayers'] = spacingLayer;
  }

  return out;
}
