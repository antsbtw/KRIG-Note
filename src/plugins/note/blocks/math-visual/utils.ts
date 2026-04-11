/**
 * math-visual/utils — 求值、不连续检测、连续段构建、参数提取、数值微分
 */

import * as math from 'mathjs';
import type { Parameter } from './types';
import { latexToMathjs, latexToFunction, latexToFunctionWithEndpoints } from './latex-to-mathjs';
import type { EndpointInfo } from './latex-to-mathjs';

// ─── 求值 ─────────────────────────────────────────────────

export interface EvalResult {
  fn: ((x: number) => number) | null;
  error: string | null;
  endpoints: EndpointInfo[];
}

export function createEvalFn(
  expression: string,
  params: Parameter[],
  sourceLatex?: string,
): EvalResult {
  if (!expression.trim()) return { fn: null, error: null, endpoints: [] };

  // 1. mathjs 编译
  try {
    const compiled = math.compile(expression);
    return {
      fn: (x: number) => {
        const scope: Record<string, number> = { x };
        for (const p of params) scope[p.name] = p.value;
        try {
          const result = compiled.evaluate(scope);
          return typeof result === 'number' && isFinite(result) ? result : NaN;
        } catch {
          return NaN;
        }
      },
      error: null,
      endpoints: [],
    };
  } catch { /* mathjs 编译失败 */ }

  // 2. LaTeX 解析（分段函数优先）
  const piecewise = latexToFunctionWithEndpoints(expression);
  if (piecewise) return { fn: piecewise.evalFn, error: null, endpoints: piecewise.endpoints };

  const fnFromExpr = latexToFunction(expression);
  if (fnFromExpr) return { fn: fnFromExpr, error: null, endpoints: [] };

  // 3. sourceLatex
  if (sourceLatex) {
    const pw = latexToFunctionWithEndpoints(sourceLatex);
    if (pw) return { fn: pw.evalFn, error: null, endpoints: pw.endpoints };

    const fnFromLatex = latexToFunction(sourceLatex);
    if (fnFromLatex) return { fn: fnFromLatex, error: null, endpoints: [] };
  }

  return { fn: null, error: '无法解析此表达式', endpoints: [] };
}

// ─── 不连续检测 ───────────────────────────────────────────

export function detectDiscontinuities(fn: (x: number) => number, xMin: number, xMax: number): number[] {
  const jumps: number[] = [];
  const samples = 2000, h = (xMax - xMin) / samples;
  let prevY = fn(xMin);
  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * h, y = fn(x);
    if (!isFinite(y) || !isFinite(prevY)) { prevY = y; continue; }
    const dy = Math.abs(y - prevY);
    if (dy > Math.max(0.3, Math.abs(h) * 100)) {
      let lo = x - h, hi = x;
      for (let j = 0; j < 40; j++) { const mid = (lo + hi) / 2; if (Math.abs(fn(mid) - fn(lo)) > dy * 0.3) hi = mid; else lo = mid; }
      let jumpX = (lo + hi) / 2;
      const nearest = Math.round(jumpX);
      if (Math.abs(jumpX - nearest) < 0.01) jumpX = nearest;
      jumps.push(jumpX);
    }
    prevY = y;
  }
  return jumps;
}

// ─── 连续段 ───────────────────────────────────────────────

export interface ContSeg {
  domain: [number, number];
  leftEndpoint: { x: number; y: number; closed: boolean };
  rightEndpoint: { x: number; y: number; closed: boolean };
}

export function buildSegments(fn: (x: number) => number, discs: number[], xMin: number, xMax: number): ContSeg[] {
  if (discs.length === 0) return [];
  const sorted = [...discs].sort((a, b) => a - b);
  const eps = 1e-9, domEps = 1e-4;
  const boundaries = [xMin, ...sorted, xMax];
  const segs: ContSeg[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i], b = boundaries[i + 1];
    if (b - a < domEps * 2) continue;
    const domA = i === 0 ? a : a + domEps;
    const domB = i === boundaries.length - 2 ? b : b - domEps;
    const yL = fn(a + eps), yR = fn(b - eps);
    if (!isFinite(yL) || !isFinite(yR)) continue;
    const fA = fn(a), fB = fn(b);
    segs.push({
      domain: [domA, domB],
      leftEndpoint: { x: a, y: yL, closed: isFinite(fA) && Math.abs(fA - yL) < 0.01 },
      rightEndpoint: { x: b, y: yR, closed: isFinite(fB) && Math.abs(fB - yR) < 0.01 },
    });
  }
  return segs;
}

// ─── 参数提取 ─────────────────────────────────────────────

const BUILTIN_NAMES = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sqrt', 'abs', 'log', 'log2', 'log10', 'exp', 'pow',
  'floor', 'ceil', 'round', 'sign', 'min', 'max',
  'pi', 'e', 'PI', 'E', 'i',
  'sinh', 'cosh', 'tanh',
]);

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

// ─── plotType 自动检测 ────────────────────────────────────

import type { PlotType } from './types';

export function detectPlotType(expression: string): { plotType: PlotType; expression: string } {
  const trimmed = expression.trim();
  const vLineMatch = trimmed.match(/^x\s*=\s*(.+)$/);
  if (vLineMatch) {
    const val = Number(vLineMatch[1]);
    if (isFinite(val)) {
      return { plotType: 'vertical-line', expression: String(val) };
    }
  }
  if (trimmed.includes(';') && trimmed.split(';').length === 2) {
    return { plotType: 'parametric', expression: trimmed };
  }
  return { plotType: 'y-of-x', expression: trimmed };
}

// ─── 数值微分 ─────────────────────────────────────────────

export function numericalDerivative(fn: (x: number) => number): (x: number) => number {
  const h = 1e-6;
  return (x: number) => (fn(x + h) - fn(x - h)) / (2 * h);
}

// ─── 刻度步长 ─────────────────────────────────────────────

export function calcLabelStepFromPx(pxPerUnit: number, minPx: number): number {
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
