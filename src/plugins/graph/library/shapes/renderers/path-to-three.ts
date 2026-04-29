import * as THREE from 'three';
import type { PathCmd, ShapeDef, FillStyle, LineStyle } from '../../types';
import { buildEnv, evalFormula, type EvalEnv } from './formula-eval';

/**
 * SVG path → Three.js mesh / line
 *
 * 不接 SVGLoader,因为我们已经有结构化的 PathCmd[](避免二次 parse)。
 * 走 THREE.ShapePath API,SVG arc 命令需要按 W3C arc implementation notes
 * 转换成圆心 + 起止角(THREE.absarc 的形式)。
 *
 * 输出:
 *   { fill?: THREE.Mesh, stroke?: THREE.Line, group: THREE.Group }
 *
 * fill/stroke 由 ShapeDef.default_style 决定是否出现(type === 'none' 不渲染)。
 * group 是把两者打包到一起的方便 holder,Canvas 直接挂 group 到 scene。
 *
 * 坐标系:Y 向下(对齐 SVG / Canvas screen 习惯),Z=0 为画板平面;描边层 z=0.01
 * 防 z-fighting。
 */
export interface PathToThreeOutput {
  /** 填充 mesh,fill.type === 'none' 时为 null */
  fill: THREE.Mesh | null;
  /** 描边 line,line.type === 'none' 时为 null */
  stroke: THREE.Line | null;
  /** 把两者打包,Canvas 直接挂这个到 scene */
  group: THREE.Group;
}

export interface PathToThreeOptions {
  /** 实际尺寸(覆盖 viewBox) */
  width: number;
  height: number;
  /** 用户 params 覆盖 */
  params?: Record<string, number>;
  /** 样式 override(覆盖 ShapeDef.default_style) */
  fillStyle?: FillStyle;
  lineStyle?: LineStyle;
}

const Z_FILL = 0;
const Z_STROKE = 0.01;

/** Shape → Three 对象;入口 */
export function shapeToThree(shape: ShapeDef, opts: PathToThreeOptions): PathToThreeOutput {
  if (shape.renderer !== 'parametric' || !shape.path) {
    // text label / static-svg / custom 不在这里处理(留给上层各自的渲染路径)
    return makeEmpty();
  }

  const env = buildEnv(shape, opts.width, opts.height, opts.params);
  return pathToThree(shape.path, env, {
    fill: opts.fillStyle ?? shape.default_style?.fill,
    stroke: opts.lineStyle ?? shape.default_style?.line,
  });
}

/** PathCmd[] → Three 对象;主转换器 */
export function pathToThree(
  path: PathCmd[],
  env: EvalEnv,
  style: { fill?: FillStyle; stroke?: LineStyle },
): PathToThreeOutput {
  const shapePath = buildShapePath(path, env);
  const group = new THREE.Group();
  let fill: THREE.Mesh | null = null;
  let stroke: THREE.Line | null = null;

  // ── Fill ──
  const fillStyle = style.fill;
  if (fillStyle && fillStyle.type === 'solid') {
    const shapes = shapePath.toShapes(false);  // false = 不自动检测内外环(我们的 path 简单)
    if (shapes.length > 0) {
      const geom = new THREE.ShapeGeometry(shapes);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(fillStyle.color ?? '#4A90E2'),
        side: THREE.DoubleSide,                   // 防 CW/CCW 法线问题
        transparent: (fillStyle.transparency ?? 0) > 0,
        opacity: 1 - (fillStyle.transparency ?? 0),
      });
      fill = new THREE.Mesh(geom, mat);
      fill.position.z = Z_FILL;
      group.add(fill);
    }
  }

  // ── Stroke ──
  const strokeStyle = style.stroke;
  if (strokeStyle && strokeStyle.type === 'solid') {
    const points = sampleStrokePoints(path, env);
    if (points.length >= 2) {
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(strokeStyle.color ?? '#2E5C8A'),
        linewidth: strokeStyle.width ?? 1.5,        // 注:WebGL 多数实现忽略 linewidth,
                                                    // v1.5+ 改用 Line2 / MeshLine 解决
      });
      stroke = new THREE.Line(geom, mat);
      stroke.position.z = Z_STROKE;
      group.add(stroke);
    }
  }

  return { fill, stroke, group };
}

// ─────────────────────────────────────────────────────────
// PathCmd → THREE.ShapePath(用于 fill 的 ShapeGeometry)
// ─────────────────────────────────────────────────────────

function buildShapePath(path: PathCmd[], env: EvalEnv): THREE.ShapePath {
  const sp = new THREE.ShapePath();
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M': {
        cx = evalFormula(cmd.x, env);
        cy = evalFormula(cmd.y, env);
        startX = cx;
        startY = cy;
        sp.moveTo(cx, cy);
        break;
      }
      case 'L': {
        cx = evalFormula(cmd.x, env);
        cy = evalFormula(cmd.y, env);
        sp.lineTo(cx, cy);
        break;
      }
      case 'A': {
        const rx = evalFormula(cmd.rx, env);
        const ry = evalFormula(cmd.ry, env);
        const x2 = evalFormula(cmd.x, env);
        const y2 = evalFormula(cmd.y, env);
        const large = (cmd['large-arc-flag'] ?? 0) as 0 | 1;
        const sweep = (cmd['sweep-flag'] ?? 1) as 0 | 1;
        applySvgArc(sp, cx, cy, rx, ry, x2, y2, large, sweep);
        cx = x2; cy = y2;
        break;
      }
      case 'Q': {
        const x1 = evalFormula(cmd.x1, env);
        const y1 = evalFormula(cmd.y1, env);
        const x = evalFormula(cmd.x, env);
        const y = evalFormula(cmd.y, env);
        sp.quadraticCurveTo(x1, y1, x, y);
        cx = x; cy = y;
        break;
      }
      case 'C': {
        const x1 = evalFormula(cmd.x1, env);
        const y1 = evalFormula(cmd.y1, env);
        const x2 = evalFormula(cmd.x2, env);
        const y2 = evalFormula(cmd.y2, env);
        const x = evalFormula(cmd.x, env);
        const y = evalFormula(cmd.y, env);
        sp.bezierCurveTo(x1, y1, x2, y2, x, y);
        cx = x; cy = y;
        break;
      }
      case 'Z': {
        // ShapePath 没有显式 close,但 ShapeGeometry 会闭合 — 显式 lineTo 起点更稳
        sp.lineTo(startX, startY);
        cx = startX; cy = startY;
        break;
      }
    }
  }
  return sp;
}

/**
 * SVG 椭圆弧 → THREE.ShapePath.absarc
 *
 * SVG 弧:从 (x1,y1) 到 (x2,y2),椭圆半径 (rx,ry),x 轴旋转 0(我们不用斜椭圆),
 * 加 large-arc-flag 和 sweep-flag。
 *
 * 算法见 W3C SVG implementation notes。这里假设 x-axis-rotation = 0(我们的
 * shape JSON 全部如此)。
 */
function applySvgArc(
  sp: THREE.ShapePath,
  x1: number, y1: number,
  rx: number, ry: number,
  x2: number, y2: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
): void {
  if (rx === 0 || ry === 0) {
    sp.lineTo(x2, y2);
    return;
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  // Step 1: 中点偏移(x-rotation = 0,简化为差值)
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;

  // Step 2: 校正过小半径(SVG 规范要求)
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // Step 3: 椭圆中心(变换坐标系下)
  const sign = largeArc === sweep ? -1 : 1;
  const sq = (rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx) /
             (rx * rx * dy * dy + ry * ry * dx * dx);
  const coef = sign * Math.sqrt(Math.max(0, sq));
  const cxp = coef * (rx * dy / ry);
  const cyp = coef * -(ry * dx / rx);

  // Step 4: 还原中心到原坐标系(x-rotation = 0)
  const cx0 = cxp + (x1 + x2) / 2;
  const cy0 = cyp + (y1 + y2) / 2;

  // Step 5: 起止角度
  const startAngle = Math.atan2((dy - cyp) / ry, (dx - cxp) / rx);
  const endAngle   = Math.atan2((-dy - cyp) / ry, (-dx - cxp) / rx);

  // 处理椭圆(rx !== ry):用 ellipse 而非 absarc
  // sweep=1 → CCW(在 SVG y-down 坐标系中实际是顺时针视觉),THREE.absellipse
  // 的 clockwise 参数方向也跟 y-up/down 有关,这里直接用 THREE 的 EllipseCurve
  // 采样,然后 splineThru 进 ShapePath,语义最清晰
  const curve = new THREE.EllipseCurve(
    cx0, cy0,
    rx, ry,
    startAngle, endAngle,
    sweep === 0,   // SVG sweep=1 表示弧线方向是 angle 增加;THREE clockwise=true 是减
    0,
  );
  // 采样 16 段(够用,折角不可见)
  const points = curve.getPoints(16);
  for (let i = 1; i < points.length; i++) {
    sp.lineTo(points[i].x, points[i].y);
  }
}

// ─────────────────────────────────────────────────────────
// PathCmd → 描边采样点(用于 LineGeometry)
// ─────────────────────────────────────────────────────────

/**
 * 把 path 采样成连续顶点序列。每个 subpath(M 开始)是一段 line strip;
 * 简化处理:整个 path 作为一段 LineSegments 风格不对,改用 Line(连续)+ Z
 * 命令时回到 subpath 起点。
 *
 * 注意:有 Z 的 path 会包含从最后一点回到起点的连线。
 */
function sampleStrokePoints(path: PathCmd[], env: EvalEnv): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;
  const SAMPLES = 16;  // 曲线段采样数

  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M':
        cx = evalFormula(cmd.x, env);
        cy = evalFormula(cmd.y, env);
        startX = cx; startY = cy;
        out.push(new THREE.Vector3(cx, cy, 0));
        break;
      case 'L':
        cx = evalFormula(cmd.x, env);
        cy = evalFormula(cmd.y, env);
        out.push(new THREE.Vector3(cx, cy, 0));
        break;
      case 'A': {
        const rx = evalFormula(cmd.rx, env);
        const ry = evalFormula(cmd.ry, env);
        const x2 = evalFormula(cmd.x, env);
        const y2 = evalFormula(cmd.y, env);
        const large = (cmd['large-arc-flag'] ?? 0) as 0 | 1;
        const sweep = (cmd['sweep-flag'] ?? 1) as 0 | 1;
        const arcPoints = sampleSvgArc(cx, cy, rx, ry, x2, y2, large, sweep, SAMPLES);
        for (const p of arcPoints) out.push(new THREE.Vector3(p.x, p.y, 0));
        cx = x2; cy = y2;
        break;
      }
      case 'Q': {
        const x1 = evalFormula(cmd.x1, env);
        const y1 = evalFormula(cmd.y1, env);
        const x = evalFormula(cmd.x, env);
        const y = evalFormula(cmd.y, env);
        const curve = new THREE.QuadraticBezierCurve(
          new THREE.Vector2(cx, cy),
          new THREE.Vector2(x1, y1),
          new THREE.Vector2(x, y),
        );
        const pts = curve.getPoints(SAMPLES);
        for (let i = 1; i < pts.length; i++) {
          out.push(new THREE.Vector3(pts[i].x, pts[i].y, 0));
        }
        cx = x; cy = y;
        break;
      }
      case 'C': {
        const x1 = evalFormula(cmd.x1, env);
        const y1 = evalFormula(cmd.y1, env);
        const x2 = evalFormula(cmd.x2, env);
        const y2 = evalFormula(cmd.y2, env);
        const x = evalFormula(cmd.x, env);
        const y = evalFormula(cmd.y, env);
        const curve = new THREE.CubicBezierCurve(
          new THREE.Vector2(cx, cy),
          new THREE.Vector2(x1, y1),
          new THREE.Vector2(x2, y2),
          new THREE.Vector2(x, y),
        );
        const pts = curve.getPoints(SAMPLES);
        for (let i = 1; i < pts.length; i++) {
          out.push(new THREE.Vector3(pts[i].x, pts[i].y, 0));
        }
        cx = x; cy = y;
        break;
      }
      case 'Z':
        out.push(new THREE.Vector3(startX, startY, 0));
        cx = startX; cy = startY;
        break;
    }
  }
  return out;
}

/** 与 buildShapePath 里 applySvgArc 同算法,但只返回采样点 */
function sampleSvgArc(
  x1: number, y1: number,
  rxIn: number, ryIn: number,
  x2: number, y2: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
  samples: number,
): THREE.Vector2[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [new THREE.Vector2(x2, y2)];

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const sq = (rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx) /
             (rx * rx * dy * dy + ry * ry * dx * dx);
  const coef = sign * Math.sqrt(Math.max(0, sq));
  const cxp = coef * (rx * dy / ry);
  const cyp = coef * -(ry * dx / rx);
  const cx0 = cxp + (x1 + x2) / 2;
  const cy0 = cyp + (y1 + y2) / 2;
  const startAngle = Math.atan2((dy - cyp) / ry, (dx - cxp) / rx);
  const endAngle   = Math.atan2((-dy - cyp) / ry, (-dx - cxp) / rx);
  const curve = new THREE.EllipseCurve(
    cx0, cy0, rx, ry, startAngle, endAngle, sweep === 0, 0,
  );
  return curve.getPoints(samples);
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function makeEmpty(): PathToThreeOutput {
  return { fill: null, stroke: null, group: new THREE.Group() };
}
