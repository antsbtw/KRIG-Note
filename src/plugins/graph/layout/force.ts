/**
 * Force 布局算法 — 基于 ELK 'force' 算法（B3.4 换芯）。
 *
 * v1.4 阶段曾基于 d3-force 手写；B3.4 替换为 ELK 'force'：
 *   - 应力收敛 + 自适应步长（手写版没有）
 *   - 节点尺寸感知（避免大节点重叠）
 *   - WebWorker 不阻塞主线程
 *
 * pinned 节点：通过 elk-adapter 读 presentation atom，作为初始位置 hint；
 *              ELK 'force' 算法尊重初始位置（不强制置中）。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import { resolveLayoutOptions } from './layout-options';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const force: LayoutAlgorithm = {
  id: 'force',
  label: 'Force',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    return runElkLayout(input, {
      elkAlgorithm: 'force',
      currentLayoutId: 'force',
      extraOptions: {
        'elk.spacing.nodeNode': '80',
        'elk.force.iterations': '300',
        'elk.force.repulsion': '5.0',
        ...resolveLayoutOptions(input.layoutOptions, 'force'),
      },
    });
  },
};

layoutRegistry.register(force);
