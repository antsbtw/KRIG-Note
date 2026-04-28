/**
 * Tree 边路由后处理 — 用 React Flow 公式重新生成 edgeSections。
 *
 * 流程：
 *   1. ELK 跑完拿到节点位置（LayoutOutput.positions）
 *   2. 对 input 中每条 line geometry,查 source/target 节点中心位置
 *   3. 根据 edgeStyle + direction 调 generateEdgePath 生成采样点
 *   4. 把采样点封装为 EdgeSection,覆盖 ELK 给的 edgeSections
 *
 * 这样 ELK 只决定节点位置,边的形态由我们的渲染层完全控制。
 */
import { generateEdgePath, positionsFromDirection, type EdgeStyle } from './edge-paths';
import type { EdgeSection, LayoutInput, LayoutOutput } from './types';

/**
 * 后处理 layout 输出:用 edgeStyle 公式重写 edgeSections。
 *
 * - input: 原 LayoutInput(拿 line geometries / layoutOptions)
 * - output: ELK 跑完的 LayoutOutput(拿 positions)
 * - 返回: 新 LayoutOutput,positions 不变,edgeSections 替换为公式生成的采样点序列
 */
export function rewriteTreeEdgeSections(
  input: LayoutInput,
  output: LayoutOutput,
): LayoutOutput {
  const opts = input.layoutOptions ?? {};
  const style = normalizeEdgeStyle(opts['layout.edge-style']);

  const direction = (opts['layout.direction'] as 'DOWN' | 'UP' | 'LEFT' | 'RIGHT' | undefined) ?? 'DOWN';
  const positions = positionsFromDirection(direction);

  const newSections = new Map<string, EdgeSection[]>();
  const lines = input.geometries.filter((g) => g.kind === 'line');

  for (const line of lines) {
    if (line.members.length < 2) continue;
    const srcId = line.members[0];
    const tgtId = line.members[1];
    const srcPos = output.positions.get(srcId);
    const tgtPos = output.positions.get(tgtId);
    if (!srcPos || !tgtPos) continue;

    const points = generateEdgePath(style, {
      sourceX: srcPos.x,
      sourceY: srcPos.y,
      targetX: tgtPos.x,
      targetY: tgtPos.y,
      sourcePosition: positions.source,
      targetPosition: positions.target,
    });
    if (points.length < 2) continue;

    newSections.set(line.id, [
      {
        startPoint: points[0],
        endPoint: points[points.length - 1],
        bendPoints: points.slice(1, -1),
      },
    ]);
  }

  return {
    positions: output.positions,
    edgeSections: newSections,
  };
}

/**
 * 把存量 / 历史 layout.edge-style 值映射到 4 档新值。
 *
 * 之前 4 档:straight / orthogonal / polyline / splines(基于 ELK 边路由)
 * 现在 4 档:straight / step      / smoothstep / bezier (基于 React Flow 公式)
 *
 * orthogonal/polyline → step;splines → bezier;未识别 → bezier(新默认值)。
 * 与 CanvasInspectorTab.normalizeEdgeStyle 同步。
 */
function normalizeEdgeStyle(raw: string | undefined): EdgeStyle {
  switch (raw) {
    case 'straight':
    case 'step':
    case 'smoothstep':
    case 'bezier':
      return raw;
    case 'orthogonal':
    case 'polyline':
      return 'step';
    case 'splines':
      return 'bezier';
    default:
      return 'bezier';
  }
}
