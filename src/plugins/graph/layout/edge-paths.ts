/**
 * Edge path generators — 4 种边样式的数学公式。
 *
 * 直接移植自 React Flow（@xyflow/system，MIT License）：
 *   - getStraightPath:  packages/system/src/utils/edges/straight-edge.ts
 *   - getBezierPath:    packages/system/src/utils/edges/bezier-edge.ts
 *   - getSmoothStepPath: packages/system/src/utils/edges/smoothstep-edge.ts
 *
 * 与 React Flow 的差别：
 *   - React Flow 输出 SVG path 字符串；本模块输出 `Array<{ x, y }>` 采样点序列，
 *     供 Three.js LineSegmentShape 直接消费。
 *   - 平滑曲线（bezier / smoothstep 的圆角段）在本模块内**采样**为离散点
 *     （CURVE_SAMPLES 段），而不是 SVG `C` / `Q` 命令。
 *
 * 4 档命名严格对齐 React Flow：
 *   straight    — 直线（中心连中心）
 *   step        — 直角折线（borderRadius=0 的 smoothstep）
 *   smoothstep  — 圆角直角（borderRadius=5 的 smoothstep）
 *   bezier      — 单条三次 Bezier（父→子，handle 切线方向）
 *
 * 直角/圆角直角的方向感来自 sourcePosition / targetPosition（Top/Bottom/Left/Right）。
 * 根据 layout direction 调用方传入正确的 source/target position：
 *   DOWN  → source=Bottom, target=Top
 *   UP    → source=Top,    target=Bottom
 *   RIGHT → source=Right,  target=Left
 *   LEFT  → source=Left,   target=Right
 */

export type EdgeStyle = 'straight' | 'step' | 'smoothstep' | 'bezier';

export type Position = 'left' | 'top' | 'right' | 'bottom';

export interface Point {
  x: number;
  y: number;
}

/** 曲线采样段数（bezier 全段 + smoothstep 每个圆角段） */
const CURVE_SAMPLES = 24;

/** 圆角拐角半径（默认 5,与 React Flow 默认一致） */
const DEFAULT_BORDER_RADIUS = 5;

/** smoothstep / step 的 handle gap（节点边沿到第一段折点的偏移）。React Flow 默认 20。 */
const DEFAULT_OFFSET = 20;

// ───────────────────────── 公开 API ─────────────────────────

export interface EdgePathParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

/**
 * 根据 edgeStyle 生成边的采样点序列。
 *
 * 返回 `Array<{ x, y }>`,首点 = source,末点 = target。
 * straight: 长度 2;step: 长度 4-6;smoothstep: 长度 ~50(圆角采样);bezier: 长度 26。
 */
export function generateEdgePath(style: EdgeStyle, params: EdgePathParams): Point[] {
  switch (style) {
    case 'straight':
      return getStraightPathPoints(params);
    case 'step':
      return getSmoothStepPathPoints(params, 0);
    case 'smoothstep':
      return getSmoothStepPathPoints(params, DEFAULT_BORDER_RADIUS);
    case 'bezier':
      return getBezierPathPoints(params);
  }
}

// ───────────────────────── straight ─────────────────────────

function getStraightPathPoints({ sourceX, sourceY, targetX, targetY }: EdgePathParams): Point[] {
  return [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];
}

// ───────────────────────── bezier ─────────────────────────
//
// 移植自 React Flow bezier-edge.ts。
// 关键公式：
//   sourceControl / targetControl 由 calculateControlOffset 决定:
//     - 当节点"正向"对齐时,offset = 0.5 * distance
//     - 当节点"反向"重叠时,offset = curvature * 25 * sqrt(-distance)（避免曲线打转）
//   curvature 默认 0.25(同 React Flow)。

const BEZIER_CURVATURE = 0.25;

function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return 0.5 * distance;
  }
  return curvature * 25 * Math.sqrt(-distance);
}

function getControlWithCurvature(
  pos: Position,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  c: number,
): [number, number] {
  switch (pos) {
    case 'left':
      return [x1 - calculateControlOffset(x1 - x2, c), y1];
    case 'right':
      return [x1 + calculateControlOffset(x2 - x1, c), y1];
    case 'top':
      return [x1, y1 - calculateControlOffset(y1 - y2, c)];
    case 'bottom':
      return [x1, y1 + calculateControlOffset(y2 - y1, c)];
  }
}

function getBezierPathPoints({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgePathParams): Point[] {
  const [c1x, c1y] = getControlWithCurvature(
    sourcePosition,
    sourceX,
    sourceY,
    targetX,
    targetY,
    BEZIER_CURVATURE,
  );
  const [c2x, c2y] = getControlWithCurvature(
    targetPosition,
    targetX,
    targetY,
    sourceX,
    sourceY,
    BEZIER_CURVATURE,
  );
  // 三次 Bezier 采样
  const points: Point[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    points.push(cubicBezier(t, sourceX, sourceY, c1x, c1y, c2x, c2y, targetX, targetY));
  }
  return points;
}

function cubicBezier(
  t: number,
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0x + 3 * uu * t * p1x + 3 * u * tt * p2x + ttt * p3x,
    y: uuu * p0y + 3 * uu * t * p1y + 3 * u * tt * p2y + ttt * p3y,
  };
}

// ───────────────────────── step / smoothstep ─────────────────────────
//
// 移植自 React Flow smoothstep-edge.ts。
// 流程:
//   1. getPoints 生成正交折线的所有"折点"(handle 端点 + gap 偏移点 + 中间点)
//   2. 沿折点序列拼路径:每两段直线之间用半径 = borderRadius 的圆角连接
//      (borderRadius = 0 → 纯尖角 step 模式)
//   3. 圆角段用 quadratic Bezier 采样为离散点

const HANDLE_DIRECTIONS: Record<Position, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

function getDirection(source: Point, sourcePosition: Position, target: Point): Point {
  if (sourcePosition === 'left' || sourcePosition === 'right') {
    return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }
  return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 };
}

function distance(a: Point, b: Point): number {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

/**
 * 生成正交折线所有折点,返回 [source, ...gappedSource?, ...intermediatePoints, ...gappedTarget?, target]。
 *
 * 严格移植自 React Flow getPoints(stepPosition=0.5, center 默认)。
 */
function getStepPoints(params: EdgePathParams, offset: number): Point[] {
  const source: Point = { x: params.sourceX, y: params.sourceY };
  const target: Point = { x: params.targetX, y: params.targetY };
  const sourcePosition = params.sourcePosition;
  const targetPosition = params.targetPosition;
  const stepPosition = 0.5;

  const sourceDir = HANDLE_DIRECTIONS[sourcePosition];
  const targetDir = HANDLE_DIRECTIONS[targetPosition];
  const sourceGapped: Point = {
    x: source.x + sourceDir.x * offset,
    y: source.y + sourceDir.y * offset,
  };
  const targetGapped: Point = {
    x: target.x + targetDir.x * offset,
    y: target.y + targetDir.y * offset,
  };
  const dir = getDirection(sourceGapped, sourcePosition, targetGapped);
  const dirAccessor: 'x' | 'y' = dir.x !== 0 ? 'x' : 'y';
  const currDir = dir[dirAccessor];

  let points: Point[] = [];
  let centerX: number;
  let centerY: number;
  const sourceGapOffset: Point = { x: 0, y: 0 };
  const targetGapOffset: Point = { x: 0, y: 0 };

  if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
    // 反向 handle —— 默认情形
    if (dirAccessor === 'x') {
      centerX = sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition;
      centerY = (sourceGapped.y + targetGapped.y) / 2;
    } else {
      centerX = (sourceGapped.x + targetGapped.x) / 2;
      centerY = sourceGapped.y + (targetGapped.y - sourceGapped.y) * stepPosition;
    }
    const verticalSplit: Point[] = [
      { x: centerX, y: sourceGapped.y },
      { x: centerX, y: targetGapped.y },
    ];
    const horizontalSplit: Point[] = [
      { x: sourceGapped.x, y: centerY },
      { x: targetGapped.x, y: centerY },
    ];
    if (sourceDir[dirAccessor] === currDir) {
      points = dirAccessor === 'x' ? verticalSplit : horizontalSplit;
    } else {
      points = dirAccessor === 'x' ? horizontalSplit : verticalSplit;
    }
  } else {
    const sourceTarget: Point[] = [{ x: sourceGapped.x, y: targetGapped.y }];
    const targetSource: Point[] = [{ x: targetGapped.x, y: sourceGapped.y }];
    if (dirAccessor === 'x') {
      points = sourceDir.x === currDir ? targetSource : sourceTarget;
    } else {
      points = sourceDir.y === currDir ? sourceTarget : targetSource;
    }

    if (sourcePosition === targetPosition) {
      const diff = Math.abs(source[dirAccessor] - target[dirAccessor]);
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff);
        if (sourceDir[dirAccessor] === currDir) {
          sourceGapOffset[dirAccessor] =
            (sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1) * gapOffset;
        } else {
          targetGapOffset[dirAccessor] =
            (targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1) * gapOffset;
        }
      }
    }

    if (sourcePosition !== targetPosition) {
      const dirAccessorOpposite: 'x' | 'y' = dirAccessor === 'x' ? 'y' : 'x';
      const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccessorOpposite];
      const sourceGtTargetOppo =
        sourceGapped[dirAccessorOpposite] > targetGapped[dirAccessorOpposite];
      const sourceLtTargetOppo =
        sourceGapped[dirAccessorOpposite] < targetGapped[dirAccessorOpposite];
      const flipSourceTarget =
        (sourceDir[dirAccessor] === 1 &&
          ((!isSameDir && sourceGtTargetOppo) || (isSameDir && sourceLtTargetOppo))) ||
        (sourceDir[dirAccessor] !== 1 &&
          ((!isSameDir && sourceLtTargetOppo) || (isSameDir && sourceGtTargetOppo)));
      if (flipSourceTarget) {
        points = dirAccessor === 'x' ? sourceTarget : targetSource;
      }
    }
  }

  const gappedSource: Point = {
    x: sourceGapped.x + sourceGapOffset.x,
    y: sourceGapped.y + sourceGapOffset.y,
  };
  const gappedTarget: Point = {
    x: targetGapped.x + targetGapOffset.x,
    y: targetGapped.y + targetGapOffset.y,
  };

  return [
    source,
    ...(gappedSource.x !== points[0].x || gappedSource.y !== points[0].y ? [gappedSource] : []),
    ...points,
    ...(gappedTarget.x !== points[points.length - 1].x ||
    gappedTarget.y !== points[points.length - 1].y
      ? [gappedTarget]
      : []),
    target,
  ];
}

/**
 * 在折点序列基础上,根据 borderRadius 在每个拐角处采样圆弧。
 * borderRadius=0 → 直接返回折点(尖角 step 模式)
 * borderRadius>0 → 拐角处用 quadratic Bezier 采样替换为弧线点
 */
function getSmoothStepPathPoints(params: EdgePathParams, borderRadius: number): Point[] {
  const points = getStepPoints(params, DEFAULT_OFFSET);
  if (points.length < 3 || borderRadius <= 0) {
    return points;
  }

  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];

    // 与 React Flow getBend 同逻辑:bendSize = min(distance(a,b)/2, distance(b,c)/2, borderRadius)
    const bendSize = Math.min(distance(a, b) / 2, distance(b, c) / 2, borderRadius);

    // 拐角共线 → 直接用 b
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
      result.push(b);
      continue;
    }

    // a→b 是水平段(a.y === b.y)还是垂直段(a.x === b.x)
    const aHorizontal = a.y === b.y;

    let p0: Point; // 圆角起点
    let p2: Point; // 圆角终点
    if (aHorizontal) {
      const xDir = a.x < c.x ? -1 : 1;
      const yDir = a.y < c.y ? 1 : -1;
      p0 = { x: b.x + bendSize * xDir, y: b.y };
      p2 = { x: b.x, y: b.y + bendSize * yDir };
    } else {
      const xDir = a.x < c.x ? 1 : -1;
      const yDir = a.y < c.y ? -1 : 1;
      p0 = { x: b.x, y: b.y + bendSize * yDir };
      p2 = { x: b.x + bendSize * xDir, y: b.y };
    }

    // 加入直线段终点 p0
    result.push(p0);
    // 采样圆角 quadratic Bezier(控制点 = b)
    const arcSamples = Math.max(4, Math.ceil(CURVE_SAMPLES / 4));
    for (let j = 1; j <= arcSamples; j++) {
      const t = j / arcSamples;
      result.push(quadraticBezier(t, p0, b, p2));
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function quadraticBezier(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

// ───────────────────────── helpers ─────────────────────────

/**
 * 根据 layout direction 推导 source/target 的 handle 位置。
 *
 * DOWN  父在上、子在下,父 handle = bottom,子 handle = top
 * UP    父在下、子在上,父 handle = top,   子 handle = bottom
 * RIGHT 父在左、子在右,父 handle = right, 子 handle = left
 * LEFT  父在右、子在左,父 handle = left,  子 handle = right
 */
export function positionsFromDirection(
  direction: 'DOWN' | 'UP' | 'LEFT' | 'RIGHT',
): { source: Position; target: Position } {
  switch (direction) {
    case 'DOWN':
      return { source: 'bottom', target: 'top' };
    case 'UP':
      return { source: 'top', target: 'bottom' };
    case 'RIGHT':
      return { source: 'right', target: 'left' };
    case 'LEFT':
      return { source: 'left', target: 'right' };
  }
}
