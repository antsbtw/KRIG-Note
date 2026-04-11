/**
 * math-utils — 数值计算工具（积分、零点、极值、拐点检测）
 *
 * 全部使用数值方法，不依赖符号计算。
 */

import type { FeaturePoint, FeaturePointType } from '../types';

type EvalFn = (x: number) => number;

// ─── 数值导数 ───────────────────────────────────────────

/** 中心差分求一阶导数 */
export function derivative(fn: EvalFn, x: number, h = 1e-7): number {
  return (fn(x + h) - fn(x - h)) / (2 * h);
}

/** 中心差分求二阶导数 */
export function secondDerivative(fn: EvalFn, x: number, h = 1e-5): number {
  return (fn(x + h) - 2 * fn(x) + fn(x - h)) / (h * h);
}

// ─── 数值积分（Simpson 法则） ────────────────────────────

/**
 * 自适应 Simpson 积分
 * @param fn - 被积函数
 * @param a - 左边界
 * @param b - 右边界
 * @param n - 分割数（偶数，默认 200）
 */
export function integrate(fn: EvalFn, a: number, b: number, n = 200): number {
  if (a >= b) return 0;
  // 确保 n 为偶数
  if (n % 2 !== 0) n++;
  const h = (b - a) / n;
  let sum = fn(a) + fn(b);
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    const y = fn(x);
    if (!isFinite(y)) continue;
    sum += (i % 2 === 0 ? 2 : 4) * y;
  }
  return (h / 3) * sum;
}

// ─── 零点检测 ────────────────────────────────────────────

/** 二分法求零点（精确化） */
function bisect(fn: EvalFn, a: number, b: number, tol = 1e-10, maxIter = 50): number {
  let fa = fn(a);
  for (let i = 0; i < maxIter; i++) {
    const mid = (a + b) / 2;
    const fm = fn(mid);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return mid;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

// ─── 特征点扫描 ─────────────────────────────────────────

interface DetectOptions {
  types?: Set<FeaturePointType>;  // 要检测的类型，默认全部
}

/**
 * 扫描函数在 [xMin, xMax] 范围内的特征点（零点、极值、拐点）
 *
 * 算法：均匀采样，检测符号变化：
 * - 零点：f(x) 符号变化
 * - 极值：f'(x) 符号变化
 * - 拐点：f''(x) 符号变化
 */
export function detectFeaturePoints(
  fn: EvalFn,
  functionId: string,
  xMin: number,
  xMax: number,
  opts: DetectOptions = {},
): FeaturePoint[] {
  const types = opts.types || new Set<FeaturePointType>(['zero', 'maximum', 'minimum', 'inflection']);
  const points: FeaturePoint[] = [];
  const samples = 500;
  const h = (xMax - xMin) / samples;

  let prevY = fn(xMin);
  let prevDy = derivative(fn, xMin);
  let prevD2y = secondDerivative(fn, xMin);

  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * h;
    const y = fn(x);
    const dy = derivative(fn, x);
    const d2y = secondDerivative(fn, x);

    if (!isFinite(y) || !isFinite(prevY)) {
      prevY = y; prevDy = dy; prevD2y = d2y;
      continue;
    }

    // 零点: f(x) 符号变化
    if (types.has('zero') && isFinite(prevY) && prevY * y < 0) {
      const xZero = bisect(fn, x - h, x);
      const yZero = fn(xZero);
      if (isFinite(yZero) && Math.abs(yZero) < 0.01) {
        points.push({
          id: `feat-${functionId}-zero-${points.length}`,
          functionId, x: xZero, y: yZero, type: 'zero', auto: true,
        });
      }
    }

    // 极值: f'(x) 符号变化
    if (isFinite(prevDy) && isFinite(dy) && prevDy * dy < 0) {
      const xCrit = bisect((t) => derivative(fn, t), x - h, x);
      const yCrit = fn(xCrit);
      if (isFinite(yCrit)) {
        if (types.has('maximum') && prevDy > 0 && dy < 0) {
          points.push({
            id: `feat-${functionId}-max-${points.length}`,
            functionId, x: xCrit, y: yCrit, type: 'maximum', auto: true,
          });
        } else if (types.has('minimum') && prevDy < 0 && dy > 0) {
          points.push({
            id: `feat-${functionId}-min-${points.length}`,
            functionId, x: xCrit, y: yCrit, type: 'minimum', auto: true,
          });
        }
      }
    }

    // 拐点: f''(x) 符号变化
    if (types.has('inflection') && isFinite(prevD2y) && isFinite(d2y) && prevD2y * d2y < 0) {
      const xInflect = bisect((t) => secondDerivative(fn, t), x - h, x);
      const yInflect = fn(xInflect);
      if (isFinite(yInflect)) {
        points.push({
          id: `feat-${functionId}-infl-${points.length}`,
          functionId, x: xInflect, y: yInflect, type: 'inflection', auto: true,
        });
      }
    }

    prevY = y; prevDy = dy; prevD2y = d2y;
  }

  return points;
}

// ─── 导出工具 ────────────────────────────────────────────

/**
 * 将 Mafs SVG 画布导出为 PNG Blob
 * @param svgElement - Mafs 渲染的 SVG 元素
 * @param scale - 缩放倍数（默认 2x Retina）
 */
export function svgToPngBlob(svgElement: SVGSVGElement, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { width, height } = svgElement.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas not supported'));

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('PNG conversion failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG load failed'));
    };
    img.src = url;
  });
}
