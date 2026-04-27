/**
 * Tree-Hierarchy 布局算法 — 基于 ELK 'mrtree' 算法（B3.4 换芯）。
 *
 * B3.3 阶段手写 BFS + 字典序，子树重叠、不紧凑。B3.4 替换为 ELK 'mrtree'：
 *   - Reingold-Tilford "Tidy Tree" 风格（业界标准）
 *   - 子树严格不重叠 / 紧凑 / 同构子树画法相同
 *   - 多根树原生支持（KRIG 散户即多根）
 *   - 边路由 ORTHOGONAL（直角折线，组织架构图风），输出 sections.bendPoints
 *
 * 仅识别 `contains` 关系作为父→子边。其他关系（refs / relates-to / ...）
 * tree projection 暂不显示（v1.9+ 可加 "show non-tree edges" 选项）。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §3 + §5
 */
import { layoutRegistry } from './registry';
import { runElkLayout } from './elk-adapter';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const treeHierarchy: LayoutAlgorithm = {
  id: 'tree-hierarchy',
  label: 'Tree Hierarchy',
  supportsDimension: [2],
  async compute(input: LayoutInput): Promise<LayoutOutput> {
    // 仅保留 contains 类 line：mrtree 把"边"当父→子方向
    const containsLineIds = collectContainsLineIds(input);
    const filteredInput: LayoutInput = {
      ...input,
      geometries: input.geometries.filter(
        (g) => g.kind !== 'line' || containsLineIds.has(g.id),
      ),
    };

    return runElkLayout(filteredInput, {
      elkAlgorithm: 'mrtree',
      extraOptions: {
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '60',
        'elk.mrtree.spacing.nodeNode': '60',
        'elk.spacing.edgeNode': '20',
      },
    });
  },
};

/** 找出所有"由 contains predicate 衍生"的 line geometry id。 */
function collectContainsLineIds(input: LayoutInput): Set<string> {
  // contains predicate 的 intension atom：subject = parent, value = child
  // 对应的 line geometry：members = [parent, child]
  // 简化：所有 line 的两端如果在 contains atom 中作为 (parent, child) 出现，则视为 contains 边
  const containsPairs = new Set<string>();
  for (const atom of input.intensions) {
    if (atom.predicate !== 'contains') continue;
    containsPairs.add(`${atom.subject_id}→${String(atom.value)}`);
  }
  const result = new Set<string>();
  for (const g of input.geometries) {
    if (g.kind !== 'line' || g.members.length < 2) continue;
    const key = `${g.members[0]}→${g.members[1]}`;
    if (containsPairs.has(key)) result.add(g.id);
  }
  return result;
}

layoutRegistry.register(treeHierarchy);
