/**
 * Tree-Layered 布局算法 — 基于 ELK 'layered' 算法(Sugiyama 分层)。
 *
 * 与 tree-hierarchy(mrtree)的区别:
 *   - mrtree:紧凑 Tidy Tree,纯树
 *   - layered:能扛 DAG(节点多 parent),分层等距
 *
 * 边路由:同 tree-hierarchy,跑完 ELK 后用 rewriteTreeEdgeSections 重写。
 * ELK 内部边路由不再消费(layout.edge-style 由渲染层公式实现)。
 *
 * 仅识别 `contains` 关系作为父→子边(同 tree-hierarchy)。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3 + §5
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import { filterToContainsTree } from './tree-shared';
import { resolveLayoutOptions } from './layout-options';
import { rewriteTreeEdgeSections } from './tree-edge-routing';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const treeLayered: LayoutAlgorithm = {
  id: 'tree-layered',
  label: 'Tree Layered',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    const filtered = filterToContainsTree(input);
    const elkOutput = await runElkLayout(filtered, {
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
    return rewriteTreeEdgeSections(filtered, elkOutput);
  },
};

layoutRegistry.register(treeLayered);
