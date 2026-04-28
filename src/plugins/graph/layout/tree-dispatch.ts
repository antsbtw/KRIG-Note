/**
 * Tree 派发器 — 虚拟 layout id `tree`。
 *
 * 单一对外入口:ViewMode "层级树" 引用 `tree`,内部转发到 `tree-hierarchy`(mrtree)。
 *
 * 历史遗留:之前根据 layout.edge-style 在 mrtree / layered 之间分派,试图借
 * ELK 不同算法的边路由实现 4 种边样式。现在边样式完全由渲染层公式控制
 * (edge-paths.ts 移植自 React Flow),不再依赖 ELK 边路由,所以始终用 mrtree
 * (更紧凑的 Tidy Tree)做布局。
 *
 * tree-layered 仍保留作为独立 layout id,留给后续场景(DAG / 多父节点)用。
 */
import { layoutRegistry } from './registry';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

// 副作用导入 — 确保底层算法已注册
import './tree-hierarchy';
import './tree-layered';

const tree: LayoutAlgorithm = {
  id: 'tree',
  label: 'Tree (auto-dispatch)',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    const target = layoutRegistry.get('tree-hierarchy');
    if (!target) {
      throw new Error('[tree-dispatch] tree-hierarchy not registered');
    }
    return target.compute(input);
  },
};

layoutRegistry.register(tree);
