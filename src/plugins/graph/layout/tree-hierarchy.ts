/**
 * Tree Hierarchy 布局算法 — 按 contains 关系递归算每个节点的层级深度。
 *
 * 算法（v1 简化版）：
 *   1. 用 intension atom 中 predicate='contains' 的边构造 父→子 关系图
 *   2. 找根节点（没有任何节点 contains 它的）；如有多个根，每个独立成树
 *   3. BFS 算每个节点的深度（depth）
 *   4. 同深度节点按 id 字典序横向排开（v1 简化，避免布局抖动）
 *   5. y = -depth × ROW_HEIGHT（深度越大 y 越小，根在顶部）
 *      x = (idx_in_row - row_count/2) × COL_WIDTH（每层居中分布）
 *
 * 限制（v1）：
 *   - 不识别 Pattern 容器（Pattern 容器 + 其 members 当作普通节点处理；
 *     B3.2 已经把 members 从 layout 输入剔除了，不会冲突）
 *   - 不处理"环"（contains 不应有环；如出现环，BFS 自动跳过已访问节点）
 *   - 散户节点（没参与任何 contains）放最底层
 *
 * 给"节点中心"算位置，不区分节点尺寸（与 force/grid 一致）。
 */
import { layoutRegistry } from './registry';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const ROW_HEIGHT = 180;     // 每层垂直间距
const COL_WIDTH = 220;      // 同层水平间距

const treeHierarchy: LayoutAlgorithm = {
  id: 'tree-hierarchy',
  label: 'Tree Hierarchy',
  supportsDimension: [2],
  compute(input: LayoutInput): LayoutOutput {
    const positions = new Map<string, { x: number; y: number }>();
    const points = input.geometries.filter((g) => g.kind === 'point');
    if (points.length === 0) return { positions };

    const pointIds = new Set(points.map((p) => p.id));

    // 1. 构造 父→子 边
    const childrenOf = new Map<string, string[]>();
    const parentOf = new Map<string, string>();
    for (const atom of input.intensions) {
      if (atom.predicate !== 'contains') continue;
      const parent = atom.subject_id;
      const child = String(atom.value);
      if (!pointIds.has(parent) || !pointIds.has(child)) continue;
      let list = childrenOf.get(parent);
      if (!list) {
        list = [];
        childrenOf.set(parent, list);
      }
      list.push(child);
      parentOf.set(child, parent);
    }

    // 2. 找根节点（没有 parent 的）
    const roots: string[] = [];
    for (const p of points) {
      if (!parentOf.has(p.id)) roots.push(p.id);
    }
    // 字典序，避免抖动
    roots.sort();

    // 3. BFS 算深度
    const depthOf = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = roots.map((r) => ({ id: r, depth: 0 }));
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depthOf.has(id)) continue;
      depthOf.set(id, depth);
      const children = childrenOf.get(id);
      if (!children) continue;
      for (const c of [...children].sort()) {
        if (!depthOf.has(c)) queue.push({ id: c, depth: depth + 1 });
      }
    }

    // 散户（没在 contains 关系里）= 没 parent 也没 child → 已被当作 root 处理
    // 但有可能是孤立节点（既不在 roots 也不在 BFS 链里，因为根本没 contains）
    // 其实这种情况 roots 里已经有了 — 上面步骤 2 会把它当 root 加入

    // 4. 按 depth 分组排列
    const byDepth = new Map<number, string[]>();
    for (const [id, depth] of depthOf) {
      let row = byDepth.get(depth);
      if (!row) {
        row = [];
        byDepth.set(depth, row);
      }
      row.push(id);
    }
    for (const row of byDepth.values()) row.sort();

    // 5. 算坐标：根在顶部（y 大），深度越大 y 越小
    for (const [depth, row] of byDepth) {
      const count = row.length;
      const startX = -((count - 1) * COL_WIDTH) / 2;
      for (let i = 0; i < count; i++) {
        positions.set(row[i], {
          x: startX + i * COL_WIDTH,
          y: -depth * ROW_HEIGHT,
        });
      }
    }

    return { positions };
  },
};

layoutRegistry.register(treeHierarchy);
