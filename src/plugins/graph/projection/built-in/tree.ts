/**
 * Tree Projection — 真树形渲染（B3.4 实装）。
 *
 * 与 'graph' projection 的差别：边走 ELK ORTHOGONAL 直角折线，而非两端直连。
 *
 * 接收 LayoutOutput.edgeSections（由 elk-adapter 输出），从中取
 * startPoint + bendPoints + endPoint 组成多点折线，喂给 LineSegmentShape
 * 的多点折线渲染（详见 B3.4.4）。
 *
 * 没拿到 sections 的 line（e.g. ELK 没 route 它，或是非 contains 边）→
 * 返回 null，走原直线渲染（兜底）。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §5
 *      docs/graph/KRIG-Graph-Pattern-Spec.md §2.6
 */
import type { Projection } from '../types';

export const treeProjection: Projection = {
  id: 'tree',
  label: '层级树',
  description: 'ELK mrtree + ORTHOGONAL 边路由（组织架构图风）',
  edgeStyle: 'orthogonal',

  customizeLine(inst, sections) {
    if (!sections || sections.length === 0) return null;
    // ELK 一条 edge 通常一条 section（无嵌套图谱时）
    const s = sections[0];
    const path: Array<{ x: number; y: number }> = [];
    path.push(s.startPoint);
    for (const bp of s.bendPoints) path.push(bp);
    path.push(s.endPoint);
    return path;
  },
};
