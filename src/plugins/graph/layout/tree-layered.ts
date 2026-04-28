/**
 * Tree-Layered 布局算法 — 基于 ELK 'layered' 算法（Sugiyama 分层）。
 *
 * 与 tree-hierarchy（mrtree）的区别：
 *   - mrtree：紧凑 Tidy Tree，但只吃纯树，边路由不可定制（始终直线）
 *   - layered：能扛 DAG（节点多 parent），且支持真直角边路由（ORTHOGONAL）
 *     视觉上是"组织架构图"风：水平等距分层、可选直角折线/曲线/折线
 *
 * 仅识别 `contains` 关系作为父→子边（同 tree-hierarchy）。
 *
 * 派发：通常通过虚拟 `tree` layout 调用，根据用户在画板上选的边样式
 *      （layout.edge-style）自动选 mrtree 还是 layered。详见 tree-dispatch.ts。
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
      // pinned 用虚拟 'tree' 作为命名空间，让 mrtree/layered 切换时 pin 共享
      currentLayoutId: 'tree',
      extraOptions: {
        // ELK y 向下 + adapter 翻 y → DOWN 后根在上、子在下
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.edgeNode': '20',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        // 用户在画板上的图谱级参数覆盖默认（B4.1）
        ...resolveLayoutOptions(input.layoutOptions, 'layered'),
      },
    });
  },
};

layoutRegistry.register(treeLayered);
