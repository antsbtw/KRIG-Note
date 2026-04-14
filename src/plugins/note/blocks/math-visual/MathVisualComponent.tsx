/**
 * MathVisualComponent — 函数可视化主组件
 *
 * 组合子组件和工具函数，负责状态管理和画布渲染。
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Mafs, Plot, Point, Line } from 'mafs';
import 'mafs/core.css';
import * as math from 'mathjs';
import type { FunctionEntry, Parameter, MathVisualData, CanvasConfig, AxisConfig } from './types';
import { createFunctionEntry, DEFAULT_CANVAS_CONFIG, DEFAULT_AXIS_CONFIG } from './types';
import type { EndpointInfo } from './latex-to-mathjs';
import { MathVisualFullscreen } from './fullscreen';
import { showMathVisualPanel } from '../../help-panel/math-visual';
import {
  createEvalFn, detectDiscontinuities, buildSegments,
  extractParameters, detectPlotType, numericalDerivative,
} from './utils';
import {
  SmartGrid, FunctionRow, ParameterSlider, RangeInput,
  InlineEndpoints, FullscreenErrorBoundary, SettingsPanel,
} from './components';

// ─── Props ──────────────────────────────────────────────

interface MathVisualComponentProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
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
      if (updates.expression !== undefined) {
        const detected = detectPlotType(updates.expression);
        updates = { ...updates, plotType: detected.plotType, expression: detected.expression };
      }

      const newFns = fns.map((f) => (f.id === id ? { ...f, ...updates } : f));

      if (updates.expression !== undefined) {
        const allExprs = newFns.filter((f) => f.plotType !== 'vertical-line').map((f) => f.expression);
        const allVarNames = new Set<string>();
        for (const expr of allExprs) {
          for (const v of extractParameters(expr)) allVarNames.add(v);
        }
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
      if (fn.plotType === 'parametric' || fn.plotType === 'polar' || fn.plotType === 'vertical-line') {
        return { fn, evalFn: null, contSegs: [], error: null, endpoints: [] as EndpointInfo[] };
      }
      const result = createEvalFn(fn.expression, parameters, fn.sourceLatex);
      const discs = result.fn ? detectDiscontinuities(result.fn, domain[0], domain[1]) : [];
      const contSegs = result.fn ? buildSegments(result.fn, discs, domain[0], domain[1]) : [];
      return { fn, evalFn: result.fn, contSegs, error: result.error, endpoints: result.endpoints };
    });
  }, [fns, parameters, domain]);

  // ── 画布尺寸 ──

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasWidth(entry.contentRect.width || 600);
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
    const computed = Math.round(canvasWidth * (ySpan / xSpan));
    finalHeight = Math.max(200, Math.min(computed, 800));
  }

  // ── 定义域/值域 ──

  const updateDomain = useCallback(
    (idx: 0 | 1, value: number) => {
      const newDomain: [number, number] = [...domain] as [number, number];
      newDomain[idx] = value;
      if (newDomain[0] >= newDomain[1]) return;
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

  // ── Help 面板插入 ──

  const insertFromHelp = useCallback((expr: string) => {
    const newFn = createFunctionEntry(fns.length, expr);
    const detected = detectPlotType(expr);
    newFn.plotType = detected.plotType;
    newFn.expression = detected.expression;
    if (detected.plotType === 'parametric') {
      newFn.label = newFn.label.replace('(x)', '(t)');
    }
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
  }, [data, fns, parameters, onChange]);

  // ── 渲染 ──

  return (
    <div className="math-visual" onMouseDown={(e) => e.stopPropagation()}>
      {data.title && <div className="mv-block-title">{data.title}</div>}

      <button
        className="mv-fullscreen-btn"
        onClick={() => setFullscreen(true)}
        title="全屏编辑"
      >
        ⛶
      </button>

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
        <button className="mv-add-fn" onClick={addFunction}>+ 添加函数</button>
      </div>

      {/* 参数滑块 */}
      {parameters.length > 0 && (
        <div className="mv-params">
          {parameters.map((p) => (
            <ParameterSlider key={p.name} param={p} onChange={(val) => updateParameter(p.name, val)} />
          ))}
        </div>
      )}

      {/* Mafs 画布 + 浮动工具栏 */}
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

            if (fn.plotType === 'vertical-line') {
              const xVal = Number(fn.expression);
              if (!isFinite(xVal)) return null;
              return (
                <Line.ThroughPoints key={fn.id}
                  point1={[xVal, -1e6]} point2={[xVal, 1e6]}
                  color={fn.color} style={lineStyle} weight={weight} />
              );
            }

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

          {compiledFns.map(({ fn, contSegs }) => {
            if (!fn.visible || contSegs.length === 0) return null;
            const allEps = contSegs.flatMap((seg) => [seg.leftEndpoint, seg.rightEndpoint]);
            return <InlineEndpoints key={`ep-${fn.id}`} endpoints={allEps} color={fn.color} />;
          })}

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
          <button className="mv-fn-btn" onClick={() => onChange({ ...data, domain: [-5, 5], range: [-5, 5], canvas: { ...canvas, height: 350 } })} title="重置视图">
            重置
          </button>
          <div style={{ flex: 1 }} />
          <button className="mv-fn-btn" onClick={() => showMathVisualPanel(insertFromHelp)} title="函数参考">?</button>
          <button className={`mv-fn-btn ${settingsOpen ? 'mv-fn-btn--active' : ''}`} onClick={() => setSettingsOpen(!settingsOpen)} title="显示设置">
            设置
          </button>
        </div>

        {settingsOpen && <SettingsPanel canvas={canvas} axis={axis} setCanvas={setCanvas} setAxis={setAxis} />}
      </div>
    </div>
  );
};
