/**
 * MathVisualComponent — 函数可视化核心渲染组件
 *
 * 多函数叠加、参数滑块、导数、关键点标注
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Mafs, Coordinates, Plot, Point, Line, useTransformContext } from 'mafs';
import 'mafs/core.css';
import * as math from 'mathjs';
import katex from 'katex';
import type { FunctionEntry, Parameter, Annotation, MathVisualData, ScaleMode, CanvasConfig, AngleUnit, AxisConfig } from './types';
import { createFunctionEntry, FUNCTION_COLORS, DEFAULT_CANVAS_CONFIG, DEFAULT_AXIS_CONFIG } from './types';
import { latexToMathjs, latexToFunction, latexToFunctionWithEndpoints } from './latex-to-mathjs';
import type { EndpointInfo } from './latex-to-mathjs';
import { MathVisualFullscreen } from './fullscreen';
import { showMathVisualPanel, hideMathVisualPanel } from '../../help-panel/math-visual';

// ─── 刻度步长自动计算 ───────────────────────────────────

/**
 * 根据每单位像素数计算标签步长。
 * 从 1, 2, 5, 10, 20, 50... 序列中选最小的、使得相邻标签间距 ≥ minPx 的步长。
 * @param pxPerUnit - 每个数学单位占多少像素
 * @param minPx - 相邻标签的最小像素间距
 */
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

// ─── Props ──────────────────────────────────────────────

interface MathVisualComponentProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
}

// ─── 求值工具 ───────────────────────────────────────────

interface EvalResult {
  fn: ((x: number) => number) | null;
  error: string | null;
  endpoints: EndpointInfo[];
}

function createEvalFn(
  expression: string,
  params: Parameter[],
  sourceLatex?: string,
): EvalResult {
  if (!expression.trim()) return { fn: null, error: null, endpoints: [] };

  // 1. 尝试 mathjs 编译（普通表达式）
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

/** 检测不连续点 x 坐标 */
function detectDiscontinuities(fn: (x: number) => number, xMin: number, xMax: number): number[] {
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

/** 连续段结构 */
interface ContSeg {
  domain: [number, number];
  leftEndpoint: { x: number; y: number; closed: boolean };
  rightEndpoint: { x: number; y: number; closed: boolean };
}

/** 构建连续段（每段含 domain + 端点开闭信息） */
function buildSegments(fn: (x: number) => number, discs: number[], xMin: number, xMax: number): ContSeg[] {
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

/** 检测函数的跳跃不连续端点（floor/ceil/分段函数等） */
function detectStepEndpoints(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
): Array<{ x: number; y: number; closed: boolean }> {
  const result: Array<{ x: number; y: number; closed: boolean }> = [];
  const eps = 1e-9;
  const samples = 2000;
  const h = (xMax - xMin) / samples;
  let prevY = fn(xMin);
  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * h;
    const y = fn(x);
    if (!isFinite(y) || !isFinite(prevY)) { prevY = y; continue; }
    const dy = Math.abs(y - prevY);
    if (dy > Math.max(0.3, Math.abs(h) * 100)) {
      let lo = x - h, hi = x;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (Math.abs(fn(mid) - fn(lo)) > dy * 0.3) hi = mid; else lo = mid;
      }
      let jumpX = (lo + hi) / 2;
      const near = Math.round(jumpX);
      if (Math.abs(jumpX - near) < 0.01) jumpX = near;
      const yLeft = fn(jumpX - eps), yRight = fn(jumpX + eps), yAt = fn(jumpX);
      if (!isFinite(yLeft) || !isFinite(yRight) || !isFinite(yAt)) { prevY = y; continue; }
      if (Math.abs(yAt - yLeft) < 0.01) {
        result.push({ x: jumpX, y: yLeft, closed: true });
        result.push({ x: jumpX, y: yRight, closed: false });
      } else if (Math.abs(yAt - yRight) < 0.01) {
        result.push({ x: jumpX, y: yLeft, closed: false });
        result.push({ x: jumpX, y: yRight, closed: true });
      }
    }
    prevY = y;
  }
  return result;
}

function numericalDerivative(fn: (x: number) => number): (x: number) => number {
  const h = 1e-6;
  return (x: number) => (fn(x + h) - fn(x - h)) / (2 * h);
}

/** 从表达式中提取除 x 以外的变量名 */
function extractParameters(expression: string): string[] {
  // 独立变量：x（普通函数）、t（参数方程）、theta（极坐标）
  const independentVars = new Set(['x', 't', 'theta']);
  try {
    // 参数方程用分号分隔，分别解析
    const parts = expression.includes(';') ? expression.split(';') : [expression];
    const vars = new Set<string>();
    for (const part of parts) {
      const node = math.parse(part.trim());
      node.traverse((n) => {
        if (n.type === 'SymbolNode') {
          const name = (n as math.SymbolNode).name;
          if (!independentVars.has(name) && !isBuiltin(name)) vars.add(name);
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

function isBuiltin(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

// ─── 子组件 ─────────────────────────────────────────────

/**
 * SmartGrid — 根据当前 zoom/pan 状态动态计算刻度步长的坐标网格。
 * 必须作为 <Mafs> 的子组件使用（依赖 useTransformContext）。
 */
function SmartGrid({
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
  // Mafs viewTransform 矩阵 [a, b, c, d, e, f]
  // preserveAspectRatio={false} 时，y 的缩放可能为 0（由 SVG viewBox 控制）
  // 所以统一用 x 方向的 pxPerUnit 作为基准（x/y 对称）
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

/** mathjs 表达式 → LaTeX，失败时返回原文 */
function exprToLatex(expression: string): string | null {
  if (!expression.trim()) return null;
  // 1. 尝试 mathjs → LaTeX
  try {
    return math.parse(expression).toTex();
  } catch { /* not mathjs syntax */ }
  // 2. 表达式本身可能就是 LaTeX（如分段函数），直接返回
  if (expression.includes('\\') || expression.includes('^') || expression.includes('_')) {
    return expression;
  }
  return null;
}

/** KaTeX 渲染组件（通用） */
function KaTeX({ tex, fallback }: { tex: string; fallback?: string }) {
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

/** 表达式的 KaTeX 展示（mathjs → LaTeX） */
function LatexDisplay({ expression }: { expression: string }) {
  const latex = useMemo(() => exprToLatex(expression), [expression]);
  if (!latex) {
    return <span className="mv-fn-expr-text">{expression || '点击输入表达式'}</span>;
  }
  return <KaTeX tex={latex} fallback={expression} />;
}

/** 颜色+线宽弹出面板 */
function StylePopover({
  color,
  lineWidth,
  style,
  onChangeColor,
  onChangeLineWidth,
  onChangeStyle,
}: {
  color: string;
  lineWidth: number;
  style: 'solid' | 'dashed' | 'dotted';
  onChangeColor: (c: string) => void;
  onChangeLineWidth: (w: number) => void;
  onChangeStyle: (s: 'solid' | 'dashed' | 'dotted') => void;
}) {
  const colors = ['#2D7FF9', '#00D4AA', '#FF6B35', '#A855F7', '#EC4899', '#EAB308', '#ef4444', '#8B5CF6', '#06B6D4', '#84CC16'];
  return (
    <div className="mv-style-popover" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mv-style-colors">
        {colors.map((c) => (
          <span
            key={c}
            className={`mv-style-swatch ${c === color ? 'mv-style-swatch--active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => onChangeColor(c)}
          />
        ))}
      </div>
      <div className="mv-style-row">
        <span className="mv-style-label">线宽</span>
        <input
          type="range" min="1" max="6" step="0.5" value={lineWidth}
          className="mv-style-slider"
          onChange={(e) => onChangeLineWidth(Number(e.target.value))}
        />
        <span className="mv-style-value">{lineWidth}</span>
      </div>
      <div className="mv-style-row">
        <span className="mv-style-label">线型</span>
        <div className="mv-style-btns">
          {(['solid', 'dashed', 'dotted'] as const).map((s) => (
            <button key={s} className={`mv-style-btn ${s === style ? 'mv-style-btn--active' : ''}`}
              onClick={() => onChangeStyle(s)}>
              {s === 'solid' ? '━━' : s === 'dashed' ? '╌╌' : '┈┈'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 单条函数编辑行 */
function FunctionRow({
  fn,
  onUpdate,
  onRemove,
  canRemove,
  error,
}: {
  fn: FunctionEntry;
  onUpdate: (updated: Partial<FunctionEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`mv-fn-row ${error ? 'mv-fn-row--error' : ''}`}>
      <span
        className="mv-fn-color mv-fn-color--clickable"
        style={{ backgroundColor: error ? '#ef4444' : fn.color }}
        title={error || '点击修改颜色/线型'}
        onClick={() => setStyleOpen(!styleOpen)}
      />
      {styleOpen && (
        <StylePopover
          color={fn.color}
          lineWidth={fn.lineWidth || 2.5}
          style={fn.style}
          onChangeColor={(c) => onUpdate({ color: c })}
          onChangeLineWidth={(w) => onUpdate({ lineWidth: w })}
          onChangeStyle={(s) => onUpdate({ style: s })}
        />
      )}
      <span className="mv-fn-label">
        <KaTeX tex={fn.plotType === 'vertical-line' ? 'x =' : `${fn.label} =`} />
      </span>
      {editing ? (
        <input
          ref={inputRef}
          className="mv-fn-input"
          value={fn.expression}
          onChange={(e) => onUpdate({ expression: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setEditing(false);
            e.stopPropagation();
          }}
          onPaste={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const clip = e.clipboardData;
            let text = '';

            // 1. 优先从 application/mirro-blocks 提取 LaTeX
            const mirroBlocks = clip.getData('application/mirro-blocks');
            if (mirroBlocks) {
              try {
                const blocks = JSON.parse(mirroBlocks) as Array<Record<string, unknown>>;
                // 递归查找 mathInline / mathBlock 节点
                const findLatex = (nodes: Array<Record<string, unknown>>): string => {
                  for (const n of nodes) {
                    if (n.type === 'mathInline') return ((n.attrs as Record<string, unknown>)?.latex as string) || '';
                    if (n.type === 'mathBlock') {
                      // mathBlock 的 LaTeX 在 content 的 text 节点中
                      const content = n.content as Array<Record<string, unknown>> | undefined;
                      return content?.map(c => (c.text as string) || '').join('') || '';
                    }
                    if (Array.isArray(n.content)) {
                      const found = findLatex(n.content as Array<Record<string, unknown>>);
                      if (found) return found;
                    }
                  }
                  return '';
                };
                text = findLatex(blocks);
              } catch { /* ignore */ }
            }

            // 2. 从 HTML 中提取 data-latex 属性
            if (!text) {
              const html = clip.getData('text/html');
              if (html) {
                const match = html.match(/data-latex="([^"]+)"/);
                if (match) text = match[1];
                if (!text) {
                  const div = document.createElement('div');
                  div.innerHTML = html;
                  text = div.textContent || '';
                }
              }
            }

            // 3. 纯文本
            if (!text) {
              text = clip.getData('text/plain') || '';
            }

            text = text.trim();
            if (!text) return;

            // 去掉 "f(x) = " / "y = " 等前缀
            const eqMatch = text.match(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
            if (eqMatch) text = eqMatch[1].trim();

            // LaTeX → mathjs 转换
            const expr = latexToMathjs(text);
            if (expr) {
              // 转换成功：存 mathjs 表达式，保留原始 LaTeX 用于溯源
              onUpdate({ expression: expr, sourceLatex: text });
            } else {
              // 转换失败（如分段函数）：存原始 LaTeX，createEvalFn 会用 latexToFunction 处理
              onUpdate({ expression: text, sourceLatex: text });
            }
          }}
          autoFocus
        />
      ) : (
        <span
          className="mv-fn-expr"
          onClick={() => setEditing(true)}
          title="点击编辑表达式"
        >
          <LatexDisplay expression={fn.expression} />
        </span>
      )}
      {error && (
        <span className="mv-fn-error" title={error}>!</span>
      )}
      <button
        className={`mv-fn-btn mv-fn-btn-tex ${fn.showDerivative ? 'mv-fn-btn--active' : ''}`}
        onClick={() => onUpdate({ showDerivative: !fn.showDerivative })}
        title="导数"
      >
        <KaTeX tex={`${fn.label.replace('(x)', "'(x)")}`} />
      </button>
      <button
        className={`mv-fn-btn ${fn.visible ? '' : 'mv-fn-btn--hidden'}`}
        onClick={() => onUpdate({ visible: !fn.visible })}
        title={fn.visible ? '隐藏' : '显示'}
      >
        {fn.visible ? '👁' : '👁‍🗨'}
      </button>
      {canRemove && (
        <button
          className="mv-fn-btn mv-fn-btn--remove"
          onClick={onRemove}
          title="移除"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** 参数滑块 */
function ParameterSlider({
  param,
  onChange,
}: {
  param: Parameter;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mv-param-row">
      <span className="mv-param-name">{param.name}</span>
      <input
        type="range"
        className="mv-param-slider"
        min={param.min}
        max={param.max}
        step={param.step}
        value={param.value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="mv-param-value">{param.value.toFixed(2)}</span>
    </div>
  );
}

/** 数值范围输入框（编辑中使用本地 state，失焦或回车时提交） */
function RangeInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // 外部值变化时同步（非编辑态）
  if (!editing && text !== String(value)) {
    setText(String(value));
  }

  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (!isNaN(n) && isFinite(n)) {
      onCommit(n);
    } else {
      setText(String(value)); // 无效输入恢复
    }
  };

  return (
    <input
      className="mv-range-input"
      value={editing ? text : String(value)}
      onChange={(e) => { setEditing(true); setText(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        e.stopPropagation();
      }}
      onFocus={() => setEditing(true)}
    />
  );
}

// ─── Error Boundary（防止全屏组件崩溃导致整个 block 消失） ───

class FullscreenErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[MathVisual] 全屏组件渲染错误:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#181818',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#e0e0e0', gap: 16,
        }}>
          <div style={{ color: '#ef4444', fontSize: 16 }}>全屏模式加载失败</div>
          <div style={{ color: '#888', fontSize: 13, maxWidth: 400, textAlign: 'center' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onClose(); }}
            style={{
              padding: '8px 24px', background: '#333', border: '1px solid #555',
              color: '#e0e0e0', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}
          >
            关闭
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 端点标记子组件（需要 useTransformContext，必须是 Mafs 子组件） */
function InlineEndpoints({ endpoints, color }: {
  endpoints: Array<{ x: number; y: number; closed: boolean }>;
  color: string;
}) {
  const { viewTransform: m } = useTransformContext();
  // Matrix = [a, b, tx, c, d, ty]
  return (
    <g>
      {endpoints.map((ep, i) => {
        const px = ep.x * m[0] + ep.y * m[1] + m[2];
        const py = ep.x * m[3] + ep.y * m[4] + m[5];
        if (ep.closed) {
          return <circle key={i} cx={px} cy={py} r={5} fill={color} />;
        }
        return (
          <g key={i}>
            <circle cx={px} cy={py} r={5} fill="#fff" />
            <circle cx={px} cy={py} r={5} fill="none" stroke={color} strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
}

// ─── 主组件 ─────────────────────────────────────────────

export const MathVisualComponent: React.FC<MathVisualComponentProps> = ({
  data,
  onChange,
}) => {
  const { functions: fns, domain, range, parameters, annotations } = data;
  const canvas: CanvasConfig = {
    ...DEFAULT_CANVAS_CONFIG,
    ...(data.canvas || {}),
    axis: { ...DEFAULT_AXIS_CONFIG, ...((data.canvas || {}) as Partial<CanvasConfig>).axis },
  };
  const axis = canvas.axis;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);


  /** 更新 canvas 配置的快捷方法 */
  const setCanvas = useCallback(
    (patch: Partial<CanvasConfig>) => onChange({ ...data, canvas: { ...canvas, ...patch } }),
    [data, canvas, onChange],
  );
  const setAxis = useCallback(
    (patch: Partial<AxisConfig>) => onChange({ ...data, canvas: { ...canvas, axis: { ...axis, ...patch } } }),
    [data, canvas, axis, onChange],
  );

  // ── 函数管理 ──

  const updateFunction = useCallback(
    (id: string, updates: Partial<FunctionEntry>) => {
      // 表达式变更时，自动检测 plotType
      if (updates.expression !== undefined) {
        const trimmed = updates.expression.trim();
        const vLineMatch = trimmed.match(/^x\s*=\s*(.+)$/);
        if (vLineMatch) {
          const val = Number(vLineMatch[1]);
          if (isFinite(val)) {
            updates = { ...updates, plotType: 'vertical-line', expression: String(val) };
          }
        } else if (trimmed.includes(';') && trimmed.split(';').length === 2) {
          // 分号分隔的两个表达式 → 参数方程 x(t); y(t)
          updates = { ...updates, plotType: 'parametric' };
        } else if (!updates.plotType) {
          updates = { ...updates, plotType: 'y-of-x' };
        }
      }

      const newFns = fns.map((f) => (f.id === id ? { ...f, ...updates } : f));

      // 表达式变更时，重新扫描参数
      if (updates.expression !== undefined) {
        const allExprs = newFns.filter((f) => f.plotType !== 'vertical-line').map((f) => f.expression);
        const allVarNames = new Set<string>();
        for (const expr of allExprs) {
          for (const v of extractParameters(expr)) allVarNames.add(v);
        }
        // 保留已有参数值，添加新参数，移除不再使用的参数
        const newParams: Parameter[] = [];
        for (const name of allVarNames) {
          const existing = parameters.find((p) => p.name === name);
          newParams.push(existing || { name, value: 1, min: -5, max: 5, step: 0.1 });
        }
        onChange({ ...data, functions: newFns, parameters: newParams });
      } else {
        onChange({ ...data, functions: newFns });
      }
    },
    [data, fns, parameters, onChange],
  );

  const addFunction = useCallback(() => {
    const newFn = createFunctionEntry(fns.length);
    onChange({ ...data, functions: [...fns, newFn] });
  }, [data, fns, onChange]);

  const removeFunction = useCallback(
    (id: string) => {
      if (fns.length <= 1) return;
      const newFns = fns.filter((f) => f.id !== id);
      const newAnns = annotations.filter((a) => a.functionId !== id);
      onChange({ ...data, functions: newFns, annotations: newAnns });
    },
    [data, fns, annotations, onChange],
  );

  // ── 参数管理 ──

  const updateParameter = useCallback(
    (name: string, value: number) => {
      const newParams = parameters.map((p) =>
        p.name === name ? { ...p, value } : p,
      );
      onChange({ ...data, parameters: newParams });
    },
    [data, parameters, onChange],
  );

  // ── 编译函数 ──

  const compiledFns = useMemo(() => {
    return fns.map((fn) => {
      // 参数方程和极坐标在渲染时直接编译，不需要 createEvalFn
      if (fn.plotType === 'parametric' || fn.plotType === 'polar' || fn.plotType === 'vertical-line') {
        return { fn, evalFn: null, contSegs: [], error: null, endpoints: [] as EndpointInfo[] };
      }
      const result = createEvalFn(fn.expression, parameters, fn.sourceLatex);
      const discs = result.fn ? detectDiscontinuities(result.fn, domain[0], domain[1]) : [];
      const contSegs = result.fn ? buildSegments(result.fn, discs, domain[0], domain[1]) : [];
      return { fn, evalFn: result.fn, contSegs, error: result.error, endpoints: result.endpoints };
    });
  }, [fns, parameters, domain]);

  // ── 画布高度 ──

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  // 监测容器宽度
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(entry.contentRect.width || 600);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── viewBox 与高度计算 ──

  const xSpan = domain[1] - domain[0];
  const ySpan = range[1] - range[0];

  let viewX: [number, number] = domain;
  let viewY: [number, number] = range;
  let finalHeight = canvas.height;

  if (canvas.scaleMode === 'fit') {
    // fit: 固定高度，自动扩展较小轴以保持 1:1 坐标比例
    const aspectRatio = canvasWidth / canvas.height;
    const dataRatio = xSpan / ySpan;
    if (dataRatio > aspectRatio) {
      const targetYSpan = xSpan / aspectRatio;
      const yCenter = (range[0] + range[1]) / 2;
      viewY = [yCenter - targetYSpan / 2, yCenter + targetYSpan / 2];
    } else {
      const targetXSpan = ySpan * aspectRatio;
      const xCenter = (domain[0] + domain[1]) / 2;
      viewX = [xCenter - targetXSpan / 2, xCenter + targetXSpan / 2];
    }
  } else if (canvas.scaleMode === '1:1') {
    // 1:1: 根据数据比例动态调整画布高度
    const computed = Math.round(canvasWidth * (ySpan / xSpan));
    finalHeight = Math.max(200, Math.min(computed, 800));
  }
  // free: 直接用固定高度 + domain/range，不保持比例

  // ── 定义域/值域 ──

  const updateDomain = useCallback(
    (idx: 0 | 1, value: number) => {
      const newDomain: [number, number] = [...domain] as [number, number];
      newDomain[idx] = value;
      if (newDomain[0] >= newDomain[1]) return; // 无效范围
      onChange({ ...data, domain: newDomain });
    },
    [data, domain, onChange],
  );

  const updateRange = useCallback(
    (idx: 0 | 1, value: number) => {
      const newRange: [number, number] = [...range] as [number, number];
      newRange[idx] = value;
      if (newRange[0] >= newRange[1]) return;
      onChange({ ...data, range: newRange });
    },
    [data, range, onChange],
  );

  return (
    <div className="math-visual" onMouseDown={(e) => e.stopPropagation()}>
      {/* 标题 */}
      {data.title && <div className="mv-block-title">{data.title}</div>}

      {/* 全屏按钮 */}
      <button
        className="mv-fullscreen-btn"
        onClick={() => { console.log('[mathVisual] fullscreen button clicked'); setFullscreen(true); }}
        title="全屏编辑"
      >
        ⛶
      </button>

      {/* 全屏 overlay (portal) */}
      {fullscreen && ReactDOM.createPortal(
        <FullscreenErrorBoundary onClose={() => setFullscreen(false)}>
          <MathVisualFullscreen
            data={data}
            onChange={onChange}
            onClose={() => setFullscreen(false)}
          />
        </FullscreenErrorBoundary>,
        document.body,
      )}

      {/* 函数列表 */}
      <div className="mv-fn-list">
        {fns.map((fn) => {
          const compiled = compiledFns.find((c) => c.fn.id === fn.id);
          return (
            <FunctionRow
              key={fn.id}
              fn={fn}
              onUpdate={(updates) => updateFunction(fn.id, updates)}
              onRemove={() => removeFunction(fn.id)}
              canRemove={fns.length > 1}
              error={compiled?.error ?? null}
            />
          );
        })}
        <button className="mv-add-fn" onClick={addFunction}>
          + 添加函数
        </button>
      </div>

      {/* 参数滑块 */}
      {parameters.length > 0 && (
        <div className="mv-params">
          {parameters.map((p) => (
            <ParameterSlider
              key={p.name}
              param={p}
              onChange={(val) => updateParameter(p.name, val)}
            />
          ))}
        </div>
      )}

      {/* Mafs 画布（含浮动工具栏） */}
      <div className="mv-canvas" ref={canvasRef} style={{ position: 'relative' }}>
        <Mafs
          viewBox={{ x: viewX, y: viewY }}
          preserveAspectRatio={false}
          height={finalHeight}
          zoom={canvas.zoom}
          pan={canvas.pan}
        >
          <SmartGrid
            showGrid={canvas.showGrid}
            showAxes={axis.showAxes}
            showNumbers={axis.showNumbers}
            userXStep={axis.xStep}
            userYStep={axis.yStep}
          />

          {compiledFns.map(({ fn, evalFn, contSegs }) => {
            if (!fn.visible) return null;
            const lineStyle = fn.style as 'solid' | 'dashed';
            const weight = fn.lineWidth || 2.5;

            // 垂直线: x = c
            if (fn.plotType === 'vertical-line') {
              const xVal = Number(fn.expression);
              if (!isFinite(xVal)) return null;
              return (
                <Line.ThroughPoints key={fn.id}
                  point1={[xVal, -1e6]} point2={[xVal, 1e6]}
                  color={fn.color} style={lineStyle} weight={weight} />
              );
            }

            // 参数方程: x(t);y(t)
            if (fn.plotType === 'parametric') {
              const parts = fn.expression.split(';').map((s) => s.trim());
              if (parts.length !== 2) return null;
              try {
                const compiledX = math.compile(parts[0]);
                const compiledY = math.compile(parts[1]);
                const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
                return (
                  <Plot.Parametric key={fn.id}
                    xy={(t: number) => {
                      try {
                        const scope: Record<string, number> = { t };
                        for (const p of parameters) scope[p.name] = p.value;
                        return [compiledX.evaluate(scope) as number, compiledY.evaluate(scope) as number];
                      } catch { return [NaN, NaN]; }
                    }}
                    domain={[tMin, tMax]}
                    color={fn.color} style={lineStyle} weight={weight} />
                );
              } catch { return null; }
            }

            // 极坐标: r(theta)
            if (fn.plotType === 'polar') {
              try {
                const compiled = math.compile(fn.expression);
                const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
                return (
                  <Plot.Parametric key={fn.id}
                    xy={(theta: number) => {
                      try {
                        const scope: Record<string, number> = { theta, t: theta };
                        for (const p of parameters) scope[p.name] = p.value;
                        const r = compiled.evaluate(scope) as number;
                        return [r * Math.cos(theta), r * Math.sin(theta)];
                      } catch { return [NaN, NaN]; }
                    }}
                    domain={[tMin, tMax]}
                    color={fn.color} style={lineStyle} weight={weight} />
                );
              } catch { return null; }
            }

            // 普通函数: y = f(x)
            if (!evalFn) return null;
            return (
              <React.Fragment key={fn.id}>
                {contSegs.length > 0 ? (
                  contSegs.map((seg, si) => (
                    <Plot.OfX key={`${fn.id}-seg-${si}`} y={evalFn}
                      domain={seg.domain} color={fn.color} style={lineStyle} weight={weight} />
                  ))
                ) : (
                  <Plot.OfX y={evalFn} color={fn.color} style={lineStyle} weight={weight} />
                )}
                {fn.showDerivative && (
                  <Plot.OfX y={numericalDerivative(evalFn)}
                    color={fn.color} style="dashed" opacity={0.6} />
                )}
              </React.Fragment>
            );
          })}

          {/* 开闭端点标记（从连续段的端点渲染） */}
          {compiledFns.map(({ fn, contSegs }) => {
            if (!fn.visible || contSegs.length === 0) return null;
            const allEps = contSegs.flatMap((seg) => [seg.leftEndpoint, seg.rightEndpoint]);
            return <InlineEndpoints key={`ep-${fn.id}`} endpoints={allEps} color={fn.color} />;
          })}

          {/* 标注点 */}
          {annotations.map((ann, i) => {
            const compiled = compiledFns.find((c) => c.fn.id === ann.functionId);
            if (!compiled?.evalFn || !compiled.fn.visible) return null;
            const y = compiled.evalFn(ann.x);
            if (!isFinite(y)) return null;
            return (
              <Point key={i} x={ann.x} y={y} color="#FF6B35" svgCircleProps={{ r: canvas.pointSize || 6 }} />
            );
          })}
        </Mafs>

        {/* 浮动工具栏 */}
        <div className="mv-floating-toolbar">
          <div className="mv-range-group">
            <span className="mv-range-label">x</span>
            <RangeInput value={domain[0]} onCommit={(v) => updateDomain(0, v)} />
            <span className="mv-range-sep">~</span>
            <RangeInput value={domain[1]} onCommit={(v) => updateDomain(1, v)} />
          </div>
          <div className="mv-range-group">
            <span className="mv-range-label">y</span>
            <RangeInput value={range[0]} onCommit={(v) => updateRange(0, v)} />
            <span className="mv-range-sep">~</span>
            <RangeInput value={range[1]} onCommit={(v) => updateRange(1, v)} />
          </div>
          <button
            className="mv-fn-btn"
            onClick={() => {
              onChange({ ...data, domain: [-5, 5], range: [-5, 5], canvas: { ...canvas, height: 350 } });
            }}
            title="重置视图"
          >
            重置
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="mv-fn-btn"
            onClick={() => {
              showMathVisualPanel((expr: string) => {
                const newFn = createFunctionEntry(fns.length, expr);
                // 自动检测 plotType
                const trimmed = expr.trim();
                const vLine = trimmed.match(/^x\s*=\s*(.+)$/);
                if (vLine && isFinite(Number(vLine[1]))) {
                  newFn.plotType = 'vertical-line';
                  newFn.expression = String(Number(vLine[1]));
                } else if (trimmed.includes(';') && trimmed.split(';').length === 2) {
                  newFn.plotType = 'parametric';
                  newFn.label = `${newFn.label.replace('(x)', '(t)')}`;
                } else {
                  newFn.plotType = 'y-of-x';
                }
                // 重新扫描所有参数
                const allFns = [...fns, newFn];
                const allExprs = allFns.filter((f) => f.plotType !== 'vertical-line').map((f) => f.expression);
                const allVarNames = new Set<string>();
                for (const e of allExprs) {
                  for (const v of extractParameters(e)) allVarNames.add(v);
                }
                const newParams: Parameter[] = [];
                for (const name of allVarNames) {
                  const existing = parameters.find((p) => p.name === name);
                  newParams.push(existing || { name, value: 1, min: -5, max: 5, step: 0.1 });
                }
                onChange({ ...data, functions: allFns, parameters: newParams });
              });
            }}
            title="函数参考"
          >
            ?
          </button>
          <button
            className={`mv-fn-btn ${settingsOpen ? 'mv-fn-btn--active' : ''}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="显示设置"
          >
            设置
          </button>
        </div>

        {/* 设置面板（浮动） */}
        {settingsOpen && (
        <div className="mv-settings mv-settings--floating">
          {/* ── 画布 ── */}
          <div className="mv-settings-section">画布</div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">比例模式</span>
            <div className="mv-settings-btns">
              {([['fit', '自适应'], ['1:1', '等比 1:1'], ['free', '自由']] as [ScaleMode, string][]).map(([mode, label]) => (
                <button key={mode} className={`mv-settings-btn ${canvas.scaleMode === mode ? 'mv-settings-btn--active' : ''}`}
                  onClick={() => setCanvas({ scaleMode: mode })}>{label}</button>
              ))}
            </div>
          </div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">高度</span>
            <div className="mv-settings-btns">
              {[250, 350, 450, 550].map((h) => (
                <button key={h} className={`mv-settings-btn ${canvas.height === h ? 'mv-settings-btn--active' : ''}`}
                  onClick={() => setCanvas({ height: h })}>{h}</button>
              ))}
              <RangeInput value={canvas.height} onCommit={(v) => setCanvas({ height: Math.max(150, Math.min(Math.round(v), 800)) })} />
              <span className="mv-settings-unit">px</span>
            </div>
          </div>

          {/* ── 坐标轴 ── */}
          <div className="mv-settings-section">坐标轴</div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">显示</span>
            <div className="mv-settings-btns">
              <label className="mv-settings-check">
                <input type="checkbox" checked={axis.showAxes} onChange={(e) => setAxis({ showAxes: e.target.checked })} />坐标轴
              </label>
              <label className="mv-settings-check">
                <input type="checkbox" checked={axis.showAxisArrows} onChange={(e) => setAxis({ showAxisArrows: e.target.checked })} />箭头
              </label>
              <label className="mv-settings-check">
                <input type="checkbox" checked={axis.showNumbers} onChange={(e) => setAxis({ showNumbers: e.target.checked })} />刻度数字
              </label>
            </div>
          </div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">轴标签</span>
            <div className="mv-settings-btns">
              <input className="mv-range-input" style={{ width: 36 }} value={axis.xLabel}
                onChange={(e) => setAxis({ xLabel: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()} />
              <input className="mv-range-input" style={{ width: 36 }} value={axis.yLabel}
                onChange={(e) => setAxis({ yLabel: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()} />
            </div>
          </div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">刻度步长</span>
            <div className="mv-settings-btns">
              <span className="mv-settings-unit">x</span>
              <RangeInput value={axis.xStep ?? 0} onCommit={(v) => setAxis({ xStep: v > 0 ? v : null })} />
              <span className="mv-settings-unit">y</span>
              <RangeInput value={axis.yStep ?? 0} onCommit={(v) => setAxis({ yStep: v > 0 ? v : null })} />
              <span className="mv-settings-unit" style={{ color: '#666' }}>0=自动</span>
            </div>
          </div>

          {/* ── 网格 ── */}
          <div className="mv-settings-section">网格</div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">显示</span>
            <div className="mv-settings-btns">
              <label className="mv-settings-check">
                <input type="checkbox" checked={canvas.showGrid} onChange={(e) => setCanvas({ showGrid: e.target.checked })} />网格线
              </label>
            </div>
          </div>

          {/* ── 交互 ── */}
          <div className="mv-settings-section">交互</div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">操作</span>
            <div className="mv-settings-btns">
              <label className="mv-settings-check">
                <input type="checkbox" checked={canvas.zoom} onChange={(e) => setCanvas({ zoom: e.target.checked })} />滚轮缩放
              </label>
              <label className="mv-settings-check">
                <input type="checkbox" checked={canvas.pan} onChange={(e) => setCanvas({ pan: e.target.checked })} />拖拽平移
              </label>
            </div>
          </div>

          {/* ── 数学 ── */}
          <div className="mv-settings-section">数学</div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">角度单位</span>
            <div className="mv-settings-btns">
              {([['rad', '弧度 rad'], ['deg', '角度 deg']] as [AngleUnit, string][]).map(([unit, label]) => (
                <button key={unit} className={`mv-settings-btn ${canvas.angleUnit === unit ? 'mv-settings-btn--active' : ''}`}
                  onClick={() => setCanvas({ angleUnit: unit })}>{label}</button>
              ))}
            </div>
          </div>
          <div className="mv-settings-row">
            <span className="mv-settings-label">标注点</span>
            <div className="mv-settings-btns">
              {[4, 6, 8, 10].map((s) => (
                <button key={s} className={`mv-settings-btn ${canvas.pointSize === s ? 'mv-settings-btn--active' : ''}`}
                  onClick={() => setCanvas({ pointSize: s })}>{s}px</button>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
