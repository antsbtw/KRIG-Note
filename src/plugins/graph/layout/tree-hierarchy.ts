/**
 * Tree-Hierarchy 布局算法 — 基于 ELK 'mrtree' 算法。
 *
 * Reingold-Tilford "Tidy Tree" 风格:
 *   - 子树严格不重叠 / 紧凑 / 同构子树画法相同
 *   - 多根树原生支持(KRIG 散户即多根)
 *
 * 边路由:layout 输出的 edgeSections 不被消费(GraphView 在合并 pinned 后用
 * React Flow 公式 generateTreeEdgeSections 重新生成,保证边和节点同源)。
 *
 * 仅识别 `contains` 关系作为父→子边。
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
      currentLayoutId: 'tree',
      extraOptions: {
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.mrtree.spacing.nodeNode': '60',
        'elk.spacing.edgeNode': '20',
        ...resolveLayoutOptions(input.layoutOptions, 'mrtree'),
      },
    });
  },
};

layoutRegistry.register(treeHierarchy);
