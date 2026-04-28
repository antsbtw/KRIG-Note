/**
 * Tree-Hierarchy 布局算法 — 基于 ELK 'mrtree' 算法。
 *
 * Reingold-Tilford "Tidy Tree" 风格:
 *   - 子树严格不重叠 / 紧凑 / 同构子树画法相同
 *   - 多根树原生支持(KRIG 散户即多根)
 *
 * 边路由:ELK mrtree 内部产生的 bendPoints 不可定制,我们**完全不用**它。
 * 跑完 ELK 拿到节点位置后,调 rewriteTreeEdgeSections 用 React Flow 公式
 * (edge-paths.ts)根据 edge-style 重新生成边的采样点序列。
 *
 * 仅识别 `contains` 关系作为父→子边。其他关系(refs / relates-to / ...)
 * tree projection 暂不显示。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3 + §5
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import { filterToContainsTree } from './tree-shared';
import { resolveLayoutOptions } from './layout-options';
import { rewriteTreeEdgeSections } from './tree-edge-routing';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const treeHierarchy: LayoutAlgorithm = {
  id: 'tree-hierarchy',
  label: 'Tree Hierarchy',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    const filtered = filterToContainsTree(input);
    const elkOutput = await runElkLayout(filtered, {
      elkAlgorithm: 'mrtree',
      // pinned 用虚拟 'tree' 作为命名空间,让 mrtree/layered 切换时 pin 共享
      currentLayoutId: 'tree',
      extraOptions: {
        // ELK y 向下 + adapter 翻 y → DOWN 后根在上、子在下
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.mrtree.spacing.nodeNode': '60',
        'elk.spacing.edgeNode': '20',
        // 用户在画板上的图谱级参数覆盖默认
        ...resolveLayoutOptions(input.layoutOptions, 'mrtree'),
      },
    });
    // 用渲染层公式重写边采样点,丢弃 ELK 给的 bendPoints
    return rewriteTreeEdgeSections(filtered, elkOutput);
  },
};

layoutRegistry.register(treeHierarchy);
