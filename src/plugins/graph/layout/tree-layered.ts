/**
 * Tree-Layered 布局算法 — 基于 ELK 'layered' 算法(Sugiyama 分层)。
 *
 * 与 tree-hierarchy(mrtree)的区别:能扛 DAG(节点多 parent),分层等距。
 *
 * 边路由:同 tree-hierarchy,layout 输出 edgeSections 不消费,GraphView 用
 * React Flow 公式 generateTreeEdgeSections 重新生成。
 *
 * 仅识别 `contains` 关系作为父→子边(同 tree-hierarchy)。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3 + §5
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import { filterToContainsTree } from './tree-shared';
import { resolveLayoutOptions } from './layout-options';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const treeLayered: LayoutAlgorithm = {
  id: 'tree-layered',
  label: 'Tree Layered',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    return runElkLayout(filterToContainsTree(input), {
      elkAlgorithm: 'layered',
      currentLayoutId: 'tree',
      extraOptions: {
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.edgeNode': '20',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        ...resolveLayoutOptions(input.layoutOptions, 'layered'),
      },
    });
  },
};

layoutRegistry.register(treeLayered);
