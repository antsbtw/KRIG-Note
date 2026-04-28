/**
 * Tree Projection — 真树形渲染。
 *
 * 与 'graph' projection 的差别:边走多点折线/曲线,而非两端直连。
 *
 * 接收 LayoutOutput.edgeSections(由 tree 类布局算法在 ELK 输出后用
 * React Flow 公式 rewriteTreeEdgeSections 生成),从中取 startPoint +
 * bendPoints + endPoint 组成多点序列,喂给 LineSegmentShape 渲染。
 *
 * 4 种边样式(straight / step / smoothstep / bezier)都通过这个序列承载:
 *   - straight: bendPoints 为空,只有首末两点
 *   - step:     bendPoints 是直角折线的拐点
 *   - smoothstep: bendPoints 包括圆角段的 quadratic Bezier 采样点
 *   - bezier:   bendPoints 是三次 Bezier 沿 t 采样的点列
 *
 * 没拿到 sections 的 line(如非 contains 边)→ 返回 null,走原直线渲染(兜底)。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §5
 *      docs/graph/KRIG-Graph-Pattern-Spec.md §2.6
 */
import type { Projection } from '../types';

export const treeProjection: Projection = {
  id: 'tree',
  label: '层级树',
  description: '层级树渲染(节点 ELK mrtree + 边 React Flow 公式)',
  edgeStyle: 'orthogonal',

  customizeLine(inst, sections) {
    if (!sections || sections.length === 0) return null;
    // 一条 edge 一条 section
    const s = sections[0];
    const path: Array<{ x: number; y: number }> = [];
    path.push(s.startPoint);
    for (const bp of s.bendPoints) path.push(bp);
    path.push(s.endPoint);
    return path;
  },
};
