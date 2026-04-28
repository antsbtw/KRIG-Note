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
import { isInLayoutFamily } from './layout-family';

/**
 * 从 presentation atom 中提取图谱级 layout 参数（B4.1）。
 *
 * 命中规则：
 *   - subject_id === graphId（图谱本身的属性，不是节点的）
 *   - layout_id 与 activeLayoutId 同家族（含 '*' 跨布局通用，详见 layout-family.ts）
 *   - attribute 以 'layout.' 开头
 *
 * 同 attribute 多条命中时：activeLayoutId 精确匹配 > tree 家族其他成员 > '*'。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md §3.2
 */
export function readGraphLevelLayoutOptions(
  presentations: GraphPresentationAtomRecord[],
  graphId: string,
  activeLayoutId: string,
): Record<string, string> {
  const wildcard: Record<string, string> = {};
  const family: Record<string, string> = {};
  const specific: Record<string, string> = {};
  for (const p of presentations) {
    if (p.subject_id !== graphId) continue;
    if (!p.attribute.startsWith('layout.')) continue;
    if (!isInLayoutFamily(p.layout_id, activeLayoutId)) continue;
    if (p.layout_id === '*') wildcard[p.attribute] = p.value;
    else if (p.layout_id === activeLayoutId) specific[p.attribute] = p.value;
    else family[p.attribute] = p.value;
  }
  return { ...wildcard, ...family, ...specific };
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
 *   - tree 类(mrtree / layered)消费 direction + spacing.node + spacing.layer
 *   - force 仅消费 spacing.node
 *   - grid(box)仅消费 spacing.node
 *
 * 不再消费 layout.edge-style:边样式由渲染层公式控制(edge-paths.ts),
 * ELK 边路由(elk.edgeRouting)不再使用。
 *
 * 未识别的 key 静默忽略(forward-compat:用户未来可能写 v1.5+ 才支持的 key)。
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
