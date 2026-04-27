/**
 * Grid 布局算法 — 基于 ELK 'box' 算法（B3.4 换芯）。
 *
 * v1.4 阶段手写固定网格；B3.4 替换为 ELK 'box'：
 *   - 节点尺寸感知（不同尺寸节点紧凑排布）
 *   - 自动选择行列数（不再硬编码 sqrt(N)）
 *
 * pinned 节点：'box' 算法不强尊重初始位置，但为了和 force 切换时不丢用户意图，
 *               adapter 仍把 pinned 位置传进去（ELK 当 hint）。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const grid: LayoutAlgorithm = {
  id: 'grid',
  label: 'Grid',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    return runElkLayout(input, {
      elkAlgorithm: 'box',
      extraOptions: {
        'elk.spacing.nodeNode': '40',
        'elk.box.packingMode': 'GROUP_DEC',
      },
    });
  },
};

layoutRegistry.register(grid);
