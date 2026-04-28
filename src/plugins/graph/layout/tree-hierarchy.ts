/**
 * Tree-Hierarchy 布局算法 — 基于 ELK 'mrtree' 算法（B3.4 换芯）。
 *
 * Reingold-Tilford "Tidy Tree" 风格：
 *   - 子树严格不重叠 / 紧凑 / 同构子树画法相同
 *   - 多根树原生支持（KRIG 散户即多根）
 *   - 边：算法内部直线路由（不支持 ORTHOGONAL；要直角边用 tree-layered）
 *
 * 仅识别 `contains` 关系作为父→子边。其他关系（refs / relates-to / ...）
 * tree projection 暂不显示（v1.9+ 可加 "show non-tree edges" 选项）。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3 + §5
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import { filterToContainsTree } from './tree-shared';
import { resolveLayoutOptions } from './layout-options';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const treeHierarchy: LayoutAlgorithm = {
  id: 'tree-hierarchy',
  label: 'Tree Hierarchy',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    return runElkLayout(filterToContainsTree(input), {
      elkAlgorithm: 'mrtree',
      currentLayoutId: 'tree-hierarchy',
      extraOptions: {
        // ELK y 向下 + adapter 翻 y → DOWN 后根在上、子在下
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.mrtree.spacing.nodeNode': '60',
        'elk.spacing.edgeNode': '20',
        // 用户在画板上的图谱级参数覆盖默认（B4.1）
        ...resolveLayoutOptions(input.layoutOptions, 'mrtree'),
      },
    });
  },
};

layoutRegistry.register(treeHierarchy);
