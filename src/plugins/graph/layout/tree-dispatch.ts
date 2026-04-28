/**
 * Tree 派发器 — 虚拟 layout id `tree`（B4.2 解冻 layered）。
 *
 * 单一对外入口：ViewMode "层级树" 引用 `tree`。
 * 派发逻辑（根据 layoutOptions['layout.edge-style']）：
 *   - 'orthogonal' / 'polyline' / 'splines' → tree-layered（layered 算法）
 *   - 'straight' / 未设置                   → tree-hierarchy（mrtree 算法）
 *
 * 用户通过 Inspector 切边样式，本派发器自动选最合适的底层算法 —— 用户不
 * 感知 mrtree / layered 的区别，只关心"我想要直角边 / 曲线 / 直线"。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md（画板模型，"切边样式 = 切算法"
 * 是实现细节，对用户透明）
 */
import { layoutRegistry } from './registry';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

// 副作用导入 — 确保两个底层算法都已注册（顺序无关）
import './tree-hierarchy';
import './tree-layered';

const tree: LayoutAlgorithm = {
  id: 'tree',
  label: 'Tree (auto-dispatch)',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    const targetId = pickTreeLayout(input.layoutOptions);
    const target = layoutRegistry.get(targetId);
    if (!target) {
      throw new Error(`[tree-dispatch] target layout "${targetId}" not registered`);
    }
    return target.compute(input);
  },
};

/** 根据边样式选底层 layout id。 */
export function pickTreeLayout(options: Record<string, string> | undefined): string {
  const edgeStyle = options?.['layout.edge-style'];
  if (edgeStyle === 'orthogonal' || edgeStyle === 'polyline' || edgeStyle === 'splines') {
    return 'tree-layered';
  }
  // 'straight' 或未设置 → mrtree（默认，更紧凑）
  return 'tree-hierarchy';
}

layoutRegistry.register(tree);
