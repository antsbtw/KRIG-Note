/**
 * shared — Block 和全屏模式共享的渲染逻辑与工具函数
 */

import React from 'react';
import { Coordinates, useTransformContext } from 'mafs';
import * as math from 'mathjs';
import type { Parameter } from '../types';
import { latexToFunction, latexToFunctionWithEndpoints } from '../latex-to-mathjs';
import type { EndpointInfo } from '../latex-to-mathjs';

// ─── 刻度步长自动计算 ───────────────────────────────────

function calcLabelStepFromPx(pxPerUnit: number, minPx: number): number {
  const bases = [1, 2, 5];
  let mag = 0.001;
  for (let i = 0; i < 20; i++) {
    for (const b of bases) {
      const step = b * mag;
      if (step * pxPerUnit >= minPx) return step;
    }
    mag *= 10;
  }
  return mag;
}

// ─── 垂直线检测 ─────────────────────────────────────────

/**
 * 检测表达式是否是 "x = <常数>" 格式（垂直线）。
 * 支持：x=2, x = -3.5, x = pi 等。
 * 返回常数值，如果不是垂直线返回 null。
 */
export function detectVerticalLine(expression: string): number | null {
  const trimmed = expression.trim();
  // 匹配 x = <数值>
  const match = trimmed.match(/^x\s*=\s*(.+)$/);
  if (!match) return null;
  const val = match[1].trim();
  // 简单数值
  const num = Number(val);
  if (isFinite(num)) return num;
  // 尝试用 mathjs 求值（支持 pi, e, sqrt(2) 等）
  try {
    const result = math.evaluate(val);
    if (typeof result === 'number' && isFinite(result)) return result;
  } catch { /* ignore */ }
  return null;
}

// ─── 求值工具 ───────────────────────────────────────────

export interface EvalResult {
  fn: ((x: number) => number) | null;
  error: string | null;
  endpoints: EndpointInfo[];  // 分段函数的边界端点
}

export function createEvalFn(
  expression: string,
  params: Parameter[],
  sourceLatex?: string,
): EvalResult {
  if (!expression.trim()) return { fn: null, error: null, endpoints: [] };

  // 1. 尝试 mathjs 编译
  try {
    const compiled = math.compile(expression);
    const fn = (x: number) => {
      const scope: Record<string, number> = { x };
      for (const p of params) scope[p.name] = p.value;
      try {
        const result = compiled.evaluate(scope);
        return typeof result === 'number' && isFinite(result) ? result : NaN;
      } catch {
        return NaN;
      }
    };
    // 检测 floor/ceil 表达式 → 生成阶梯端点
    const hasFloorCeil = /\b(floor|ceil)\b/.test(expression);
    return { fn, error: null, endpoints: hasFloorCeil ? [] : [] };
    // floor/ceil 的端点在渲染时根据 domain 动态生成（见 detectStepEndpoints）
  } catch { /* mathjs 编译失败 */ }

  // 2. 尝试把 expression 当作 LaTeX 解析（分段函数优先提取端点）
  const piecewise = latexToFunctionWithEndpoints(expression);
  if (piecewise) return { fn: piecewise.evalFn, error: null, endpoints: piecewise.endpoints };

  const fnFromExpr = latexToFunction(expression);
  if (fnFromExpr) return { fn: fnFromExpr, error: null, endpoints: [] };

  // 3. 如果有 sourceLatex，尝试解析它
  if (sourceLatex) {
    const pw = latexToFunctionWithEndpoints(sourceLatex);
    if (pw) return { fn: pw.evalFn, error: null, endpoints: pw.endpoints };

    const fnFromLatex = latexToFunction(sourceLatex);
    if (fnFromLatex) return { fn: fnFromLatex, error: null, endpoints: [] };
  }

  return { fn: null, error: '无法解析此表达式', endpoints: [] };
}

/**
 * 检测函数的跳跃不连续点 x 坐标。
 * 用于在跳跃点处断开曲线（返回 NaN）避免画出垂直连接线。
 */
export function detectDiscontinuities(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
): number[] {
  const jumps: number[] = [];
  const samples = 2000;
  const h = (xMax - xMin) / samples;
  let prevY = fn(xMin);

  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * h;
    const y = fn(x);
    if (!isFinite(y) || !isFinite(prevY)) { prevY = y; continue; }
    const dy = Math.abs(y - prevY);
    if (dy > Math.max(0.3, Math.abs(h) * 100)) {
      // 二分法精确定位跳跃点
      let lo = x - h, hi = x;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (Math.abs(fn(mid) - fn(lo)) > dy * 0.3) hi = mid; else lo = mid;
      }
      let jumpX = (lo + hi) / 2;
      // snap 到最近的整数（如果误差 < 0.01），处理 floor/ceil 等整数跳跃
      const nearest = Math.round(jumpX);
      if (Math.abs(jumpX - nearest) < 0.01) jumpX = nearest;
      jumps.push(jumpX);
    }
    prevY = y;
  }
  return jumps;
}

/**
 * 包装求值函数：在不连续点附近返回 NaN，使 Plot.OfX 在跳跃处断开曲线。
 */
export function wrapWithDiscontinuities(
  fn: (x: number) => number,
  discontinuities: number[],
  gap = 0.005,
): (x: number) => number {
  if (discontinuities.length === 0) return fn;
  return (x: number) => {
    for (const d of discontinuities) {
      if (Math.abs(x - d) < gap) return NaN;
    }
    return fn(x);
  };
}

/**
 * 连续段：一段曲线 + 左右端点信息。
 * 把每个连续段作为整体处理，端点直接从段的 domain 端取值。
 */
export interface ContinuousSegment {
  domain: [number, number];
  leftEndpoint: { x: number; y: number; closed: boolean };
  rightEndpoint: { x: number; y: number; closed: boolean };
}

/**
 * 将函数分割为连续段，每段包含 domain 和端点开闭信息。
 *
 * 用于 floor/ceil/分段函数等不连续函数的渲染：
 * - 每段用独立的 Plot.OfX + domain 渲染（无垂直连线）
 * - 端点直接从段的 domain 端取值（保证紧贴线段）
 */
export function buildContinuousSegments(
  fn: (x: number) => number,
  discs: number[],
  xMin: number,
  xMax: number,
): ContinuousSegment[] {
  if (discs.length === 0) return [];

  const sorted = [...discs].sort((a, b) => a - b);
  const eps = 1e-9;
  const domainEps = 1e-4; // 段边界微缩，避免 Mafs 采样到跳跃点

  // 构建段边界: [xMin, d0, d1, ..., dn, xMax]
  const boundaries = [xMin, ...sorted, xMax];
  const segments: ContinuousSegment[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    if (b - a < domainEps * 2) continue; // 段太短跳过

    // 段的 domain（微缩）
    const domA = (i === 0) ? a : a + domainEps;
    const domB = (i === boundaries.length - 2) ? b : b - domainEps;

    // 端点 y 值：从段内侧取值（保证在同一段上）
    const yLeft = fn(a + eps);
    const yRight = fn(b - eps);
    if (!isFinite(yLeft) || !isFinite(yRight)) continue;

    // 端点开闭性：f(boundary) 等于段内侧值 → 实心（含端点）
    const fAtA = fn(a);
    const fAtB = fn(b);
    const leftClosed = isFinite(fAtA) && Math.abs(fAtA - yLeft) < 0.01;
    const rightClosed = isFinite(fAtB) && Math.abs(fAtB - yRight) < 0.01;

    segments.push({
      domain: [domA, domB],
      leftEndpoint: { x: a, y: yLeft, closed: leftClosed },
      rightEndpoint: { x: b, y: yRight, closed: rightClosed },
    });
  }

  return segments;
}

export function numericalDerivative(fn: (x: number) => number): (x: number) => number {
  const h = 1e-6;
  return (x: number) => (fn(x + h) - fn(x - h)) / (2 * h);
}

/** 从表达式中提取参数变量名（排除独立变量 x/t/theta 和内置函数） */
export function extractParameters(expression: string): string[] {
  const independentVars = new Set(['x', 't', 'theta']);
  try {
    const parts = expression.includes(';') ? expression.split(';') : [expression];
    const vars = new Set<string>();
    for (const part of parts) {
      const node = math.parse(part.trim());
      node.traverse((n) => {
        if (n.type === 'SymbolNode') {
          const name = (n as math.SymbolNode).name;
          if (!independentVars.has(name) && !BUILTIN_NAMES.has(name)) vars.add(name);
        }
      });
    }
    return Array.from(vars).sort();
  } catch {
    return [];
  }
}

const BUILTIN_NAMES = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sqrt', 'abs', 'log', 'log2', 'log10', 'exp', 'pow',
  'floor', 'ceil', 'round', 'sign', 'min', 'max',
  'pi', 'e', 'PI', 'E', 'i',
  'sinh', 'cosh', 'tanh',
]);

// ─── SmartGrid 组件 ─────────────────────────────────────

export function SmartGrid({
  showGrid,
  showAxes,
  showNumbers,
  userXStep,
  userYStep,
}: {
  showGrid: boolean;
  showAxes: boolean;
  showNumbers: boolean;
  userXStep: number | null;
  userYStep: number | null;
}) {
  const { viewTransform } = useTransformContext();
  const pxPerUnit = Math.abs(viewTransform[0]) || 1;
  const labelStep = calcLabelStepFromPx(pxPerUnit, 50);

  const xLabelStep = userXStep || labelStep;
  const yLabelStep = userYStep || labelStep;

  if (!showGrid && !showAxes) return null;

  return (
    <Coordinates.Cartesian
      xAxis={showAxes ? {
        lines: showGrid ? 1 : false,
        labels: showNumbers
          ? (x: number) => {
              if (Math.abs(x) < 1e-10) return '0';
              return Math.abs(x % xLabelStep) < xLabelStep * 0.01
                ? String(Math.round(x * 1000) / 1000) : '';
            }
          : false,
      } : false}
      yAxis={showAxes ? {
        lines: showGrid ? 1 : false,
        labels: showNumbers
          ? (y: number) => {
              if (Math.abs(y) < 1e-10) return '0';
              return Math.abs(y % yLabelStep) < yLabelStep * 0.01
                ? String(Math.round(y * 1000) / 1000) : '';
            }
          : false,
      } : false}
    />
  );
}

// ─── KaTeX 工具组件 ─────────────────────────────────────

import { useRef, useEffect, useMemo } from 'react';
import katex from 'katex';

/** KaTeX 渲染组件 */
export function KaTeX({ tex, fallback }: { tex: string; fallback?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(tex, ref.current, { throwOnError: false, displayMode: false });
    } catch {
      if (ref.current) ref.current.textContent = fallback || tex;
    }
  }, [tex, fallback]);
  return <span ref={ref} className="mv-fn-expr-tex" />;
}

/** mathjs 表达式 → LaTeX，失败时返回原文 */
export function exprToLatex(expression: string): string | null {
  if (!expression.trim()) return null;
  try {
    return math.parse(expression).toTex();
  } catch { /* not mathjs syntax */ }
  if (expression.includes('\\') || expression.includes('^') || expression.includes('_')) {
    return expression;
  }
  return null;
}

/** 表达式的 KaTeX 展示 */
export function LatexDisplay({ expression }: { expression: string }) {
  const latex = useMemo(() => exprToLatex(expression), [expression]);
  if (!latex) {
    return <span className="mv-fn-expr-text">{expression || '点击输入表达式'}</span>;
  }
  return <KaTeX tex={latex} fallback={expression} />;
}
