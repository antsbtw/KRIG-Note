/**
 * Grid 布局算法 — 把所有 Point 几何体按方阵排列。
 *
 * 用途：调试 / fallback / 节点位置可预测的小图。
 * 行为：忽略 pin（grid 是结构化布局，pin 在 grid 下没意义）。
 *       但为了和 force 切换时不丢用户意图，pinned=true 的节点仍然按 grid 摆。
 */
import { layoutRegistry } from './registry';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const SPACING = 200;

const grid: LayoutAlgorithm = {
  id: 'grid',
  label: 'Grid',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    const points = input.geometries.filter((g) => g.kind === 'point');
    const positions = new Map<string, { x: number; y: number }>();

    if (points.length === 0) return { positions };

    const cols = Math.ceil(Math.sqrt(points.length));
    const offsetX = -((cols - 1) * SPACING) / 2;
    const offsetY = -((Math.ceil(points.length / cols) - 1) * SPACING) / 2;

    for (let i = 0; i < points.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.set(points[i].id, {
        x: offsetX + col * SPACING,
        y: offsetY + row * SPACING,
      });
    }
    return { positions };
  },
};

layoutRegistry.register(grid);
