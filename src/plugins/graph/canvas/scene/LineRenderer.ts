import * as THREE from 'three';
import type { LineStyle } from '../../library/types';

/**
 * LineRenderer — 端点驱动的 line 渲染
 *
 * 与 path-to-three.ts 的区别:
 * - path-to-three 渲染 ShapeDef.path 内部的固定几何(viewBox 0..w/h),适合 fill 类
 *   shape;line 实例若直接用 path-to-three,得不到"两端动态跟随 magnet"的效果
 * - LineRenderer 接受两端世界坐标,直接生成两端跟随的 line geometry
 *
 * 支持 3 种 line ref:
 * - krig.line.straight:直线
 * - krig.line.elbow:三段直角(横-竖-横,中点 50%;水平距离短于阈值时退化为竖-横-竖)
 * - krig.line.curved:三次贝塞尔(控制点在两端水平 1/3 处)
 *
 * 输出:THREE.Line(world coordinate),group.position 在 (0,0),不需要
 * 外层平移(顶点已是世界坐标)。
 */

const Z_LINE = 0.005;        // 比 fill(z=0)高,比 stroke(z=0.01)低,避免遮蔽
const SAMPLES = 24;          // 曲线段采样数

export interface LineRenderOptions {
  start: { x: number; y: number };
  end: { x: number; y: number };
  style?: LineStyle;
}

/** 渲染一条 line(返回 THREE.Group 包一个 THREE.Line) */
export function renderLine(ref: string, opts: LineRenderOptions): THREE.Group {
  const { start, end, style } = opts;
  const group = new THREE.Group();
  const points = generatePoints(ref, start, end);
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(style?.color ?? '#2E5C8A'),
    linewidth: style?.width ?? 1.5,
  });
  const line = new THREE.Line(geom, mat);
  line.position.z = Z_LINE;
  group.add(line);
  return group;
}

/** 不重新建 mesh,只更新顶点缓冲(M1.3 拖动时高频调用,避免抖动) */
export function updateLineGeometry(
  group: THREE.Group,
  ref: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  const line = group.children[0] as THREE.Line | undefined;
  if (!line) return;
  const points = generatePoints(ref, start, end);
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    positions[i * 3]     = points[i].x;
    positions[i * 3 + 1] = points[i].y;
    positions[i * 3 + 2] = points[i].z;
  }
  const geom = line.geometry;
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.attributes.position.needsUpdate = true;
  geom.computeBoundingSphere();
}

// ─────────────────────────────────────────────────────────
// 顶点生成
// ─────────────────────────────────────────────────────────

function generatePoints(
  ref: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): THREE.Vector3[] {
  switch (ref) {
    case 'krig.line.elbow':
      return generateElbow(start, end);
    case 'krig.line.curved':
      return generateCurved(start, end);
    case 'krig.line.straight':
    default:
      return [new THREE.Vector3(start.x, start.y, 0), new THREE.Vector3(end.x, end.y, 0)];
  }
}

/**
 * Elbow:三段直角折线
 * 默认 horizontal-first(横→竖→横),折点在水平中点
 * 当 |dx| < |dy| / 2 时切换为 vertical-first(竖→横→竖),避免退化为窄锯齿
 */
function generateElbow(
  start: { x: number; y: number },
  end: { x: number; y: number },
): THREE.Vector3[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy) / 2;
  if (horizontalFirst) {
    const midX = start.x + dx / 2;
    return [
      new THREE.Vector3(start.x, start.y, 0),
      new THREE.Vector3(midX,    start.y, 0),
      new THREE.Vector3(midX,    end.y,   0),
      new THREE.Vector3(end.x,   end.y,   0),
    ];
  } else {
    const midY = start.y + dy / 2;
    return [
      new THREE.Vector3(start.x, start.y, 0),
      new THREE.Vector3(start.x, midY,    0),
      new THREE.Vector3(end.x,   midY,    0),
      new THREE.Vector3(end.x,   end.y,   0),
    ];
  }
}

/**
 * Curved:三次贝塞尔
 * 控制点放在两端 X 方向 1/3 处的 Y(让曲线"挂"在两端,符合 family-tree 习惯)
 */
function generateCurved(
  start: { x: number; y: number },
  end: { x: number; y: number },
): THREE.Vector3[] {
  const dx = end.x - start.x;
  const c1 = new THREE.Vector2(start.x + dx / 3, start.y);
  const c2 = new THREE.Vector2(end.x - dx / 3, end.y);
  const curve = new THREE.CubicBezierCurve(
    new THREE.Vector2(start.x, start.y),
    c1, c2,
    new THREE.Vector2(end.x, end.y),
  );
  const pts = curve.getPoints(SAMPLES);
  return pts.map((p) => new THREE.Vector3(p.x, p.y, 0));
}
