/**
 * Tree 边路由公式生成 — 用 React Flow 公式生成 edgeSections。
 *
 * 调用时机:GraphView 拿到节点最终位置(layout 输出 + pinned override 合并)后,
 * 用最终位置算边的采样点。这样保证边和节点用**同一坐标**,不会脱节。
 *
 * 公式来源 edge-paths.ts(移植自 React Flow MIT)。4 档:
 *   straight / step / smoothstep / bezier
 */
import { generateEdgePath, positionsFromDirection, type EdgeStyle } from './edge-paths';
import type { GraphGeometryRecord } from '../../../main/storage/types';
import type { EdgeSection } from './types';

/**
 * 根据最终节点位置 + 用户的 edge-style 选择,生成所有 line 几何体的边采样点。
 *
 * - lines: 所有 line geometry(只算 members.length >= 2 的)
 * - positions: 节点最终位置(已合并 pinned override)
 * - layoutOptions: 当前图谱级 layout 参数(读 layout.edge-style + layout.direction)
 * - 返回: line.id → EdgeSection[](首末 + 中间采样点)
 */
export function generateTreeEdgeSections(
  lines: GraphGeometryRecord[],
  positions: Map<string, { x: number; y: number; z?: number }>,
  layoutOptions: Record<string, string> | undefined,
): Map<string, EdgeSection[]> {
  const opts = layoutOptions ?? {};
  const style = normalizeEdgeStyle(opts['layout.edge-style']);
  const direction = (opts['layout.direction'] as 'DOWN' | 'UP' | 'LEFT' | 'RIGHT' | undefined) ?? 'DOWN';
  const handlePositions = positionsFromDirection(direction);

  const out = new Map<string, EdgeSection[]>();
  for (const line of lines) {
    if (line.members.length < 2) continue;
    const srcId = line.members[0];
    const tgtId = line.members[1];
    const srcPos = positions.get(srcId);
    const tgtPos = positions.get(tgtId);
    if (!srcPos || !tgtPos) continue;

    const points = generateEdgePath(style, {
      sourceX: srcPos.x,
      sourceY: srcPos.y,
      targetX: tgtPos.x,
      targetY: tgtPos.y,
      sourcePosition: handlePositions.source,
      targetPosition: handlePositions.target,
    });
    if (points.length < 2) continue;

    out.set(line.id, [
      {
        startPoint: points[0],
        endPoint: points[points.length - 1],
        bendPoints: points.slice(1, -1),
      },
    ]);
  }

  return out;
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
