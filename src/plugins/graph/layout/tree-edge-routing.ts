/**
 * Tree 边路由公式生成 — 用 React Flow 公式生成 edgeSections。
 *
 * 调用时机:GraphView 拿到节点最终位置(layout 输出 + pinned override 合并)后,
 * 用最终位置算边的采样点。这样保证边和节点用**同一坐标**,不会脱节。
 *
 * 公式来源 edge-paths.ts(移植自 React Flow MIT)。4 档:
 *   straight / step / smoothstep / bezier
 *
 * 端点裁剪:在公式输入阶段就把 source/target 从节点中心退到节点边缘 +
 * arrowSize 处。否则曲线采样点会"穿过"节点内部 — bezier 公式按"中心→中心"
 * 算的话,曲线在节点附近会先沿 handle 切线方向"卷"进节点再绕出来。
 */
import { generateEdgePath, positionsFromDirection, type EdgeStyle, type Position, type Point } from './edge-paths';
import type { GraphGeometryRecord } from '../../../main/storage/types';
import type { EdgeSection } from './types';

/** 默认箭头尺寸,与 LineSegmentShape DEFAULT_ARROW_SIZE 一致 */
const DEFAULT_ARROW_SIZE = 10;

/**
 * 节点尺寸查询回调(GraphView 提供)。
 * 用于把端点从节点中心退到节点边缘,让 bezier 曲线起讫在节点外。
 */
export type NodeSizeLookup = (nodeId: string) => { width: number; height: number } | undefined;

/**
 * 根据最终节点位置 + 用户的 edge-style 选择,生成所有 line 几何体的边采样点。
 *
 * - lines: 所有 line geometry(只算 members.length >= 2 的)
 * - positions: 节点最终位置(已合并 pinned override)
 * - layoutOptions: 当前图谱级 layout 参数(读 layout.edge-style + layout.direction)
 * - getNodeSize: 节点尺寸查询(用于端点裁剪)。返回 undefined → 用默认值
 * - 返回: line.id → EdgeSection[](首末 + 中间采样点)
 */
export function generateTreeEdgeSections(
  lines: GraphGeometryRecord[],
  positions: Map<string, { x: number; y: number; z?: number }>,
  layoutOptions: Record<string, string> | undefined,
  getNodeSize: NodeSizeLookup,
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

    // 把 source/target 从节点中心退到节点边缘 + arrowSize,让公式输入是
    // "节点外的端点",采样点不会绕进节点内部。
    const srcSize = getNodeSize(srcId);
    const tgtSize = getNodeSize(tgtId);
    const srcEdge = clipToNodeEdge(srcPos, tgtPos, srcSize, handlePositions.source, 0);
    const tgtEdge = clipToNodeEdge(tgtPos, srcPos, tgtSize, handlePositions.target, DEFAULT_ARROW_SIZE);

    const points = generateEdgePath(style, {
      sourceX: srcEdge.x,
      sourceY: srcEdge.y,
      targetX: tgtEdge.x,
      targetY: tgtEdge.y,
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
 * 把节点中心点退到节点 box 边缘(handle 方向),再外推 buffer。
 *
 * 用 handle position(top/bottom/left/right)直接决定退的方向 — 比按
 * "中心连线方向"裁剪更稳定:bezier 公式假设 handle 出发方向固定,裁剪
 * 也按同方向退,公式生成的曲线起讫切线和 handle 方向自然一致。
 */
function clipToNodeEdge(
  center: { x: number; y: number },
  _other: { x: number; y: number },
  size: { width: number; height: number } | undefined,
  handlePosition: Position,
  buffer: number,
): Point {
  if (!size) return { x: center.x, y: center.y };
  const halfW = size.width / 2;
  const halfH = size.height / 2;
  switch (handlePosition) {
    case 'top':    return { x: center.x, y: center.y + halfH + buffer };  // KRIG y 向上,top 是 +y
    case 'bottom': return { x: center.x, y: center.y - halfH - buffer };
    case 'left':   return { x: center.x - halfW - buffer, y: center.y };
    case 'right':  return { x: center.x + halfW + buffer, y: center.y };
  }
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
