/**
 * MathVisualFullscreen — 全屏工作台 overlay
 *
 * 三栏布局：左侧函数面板 | 中央 Mafs 画布 | 右侧属性面板
 * 集成 5 个工具：标注、切线、积分、极值检测、导出
 */

import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { Mafs, Plot, Line } from 'mafs';
import type {
  MathVisualData, CanvasConfig, ToolMode,
  TangentLine, NormalLine, IntegralRegion, FeaturePoint, FeaturePointType, Annotation,
} from '../types';
import { DEFAULT_CANVAS_CONFIG, DEFAULT_AXIS_CONFIG } from '../types';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { createEvalFn, numericalDerivative, SmartGrid, detectVerticalLine, detectDiscontinuities, buildContinuousSegments } from './shared';
import type { ContinuousSegment } from './shared';
import { AnnotationTool } from './tools/AnnotationTool';
import { TangentTool } from './tools/TangentTool';
import { NormalTool } from './tools/NormalTool';
import { IntegralTool } from './tools/IntegralTool';
import { FeatureTool } from './tools/FeatureTool';
import { HoverCoords } from './tools/HoverCoords';
import { RiemannTool } from './tools/RiemannTool';
import type { RiemannMode } from './tools/RiemannTool';
import { EndpointMarkers } from './tools/EndpointMarkers';
import { LegendOverlay } from './tools/LegendOverlay';
import { detectFeaturePoints, svgToPngBlob } from './math-utils';
import * as math from 'mathjs';

interface MathVisualFullscreenProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
  onClose: () => void;
}

export const MathVisualFullscreen: React.FC<MathVisualFullscreenProps> = ({
  data,
  onChange,
  onClose,
}) => {
  const { functions: fns, domain, range, parameters, annotations } = data;
  const tangentLines = data.tangentLines || [];
  const normalLines = data.normalLines || [];
  const integralRegions = data.integralRegions || [];
  const featurePoints = data.featurePoints || [];

  const canvas: CanvasConfig = {
    ...DEFAULT_CANVAS_CONFIG,
    ...(data.canvas || {}),
    axis: { ...DEFAULT_AXIS_CONFIG, ...((data.canvas || {}) as Partial<CanvasConfig>).axis },
  };
  const axis = canvas.axis;

  // ── 工具状态（不持久化） ──
  const [toolMode, setToolMode] = useState<ToolMode>('move');
  const [selectedTangentId, setSelectedTangentId] = useState<string | null>(null);
  const [selectedNormalId, setSelectedNormalId] = useState<string | null>(null);
  const [selectedIntegralId, setSelectedIntegralId] = useState<string | null>(null);
  const [selectedAnnotationIdx, setSelectedAnnotationIdx] = useState<number | null>(null);
  const [selectedAnnotationIdxs, setSelectedAnnotationIdxs] = useState<Set<number>>(new Set());
  const [featureVisibleTypes, setFeatureVisibleTypes] = useState<Set<FeaturePointType>>(
    new Set(['zero', 'maximum', 'minimum', 'inflection']),
  );

  // 黎曼和配置
  const [riemannConfig, setRiemannConfig] = useState<{ n: number; mode: RiemannMode } | null>(null);

  // 动画播放状态
  const [animating, setAnimating] = useState<{ paramName: string; speed: number } | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 框选拖拽状态
  const [boxSelectStart, setBoxSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<{ x: number; y: number } | null>(null);

  // 阻止编辑器事件穿透
  const stopPropagation = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
  }, []);

  // 画布高度（ResizeObserver 测量容器）
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(600);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height - 32;
        if (h > 100) setCanvasHeight(Math.round(h));
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── 编译函数 ──

  const compiledFns = useMemo(() => {
    return fns.map((fn) => {
      // 参数方程和极坐标在渲染时直接编译，不需要 createEvalFn
      if (fn.plotType === 'parametric' || fn.plotType === 'polar' || fn.plotType === 'vertical-line') {
        return { fn, evalFn: null, contSegs: [], error: null, endpoints: [] };
      }
      const result = createEvalFn(fn.expression, parameters, fn.sourceLatex);
      // 检测不连续点 → 构建连续段（每段含 domain + 端点开闭信息）
      const discs = result.fn ? detectDiscontinuities(result.fn, domain[0], domain[1]) : [];
      const contSegs = result.fn ? buildContinuousSegments(result.fn, discs, domain[0], domain[1]) : [];
      return { fn, evalFn: result.fn, contSegs, error: result.error, endpoints: result.endpoints };
    });
  }, [fns, parameters, domain]);

  // evalFns map: functionId → evalFn
  const evalFnMap = useMemo(() => {
    const map = new Map<string, (x: number) => number>();
    for (const c of compiledFns) {
      if (c.evalFn) map.set(c.fn.id, c.evalFn);
    }
    return map;
  }, [compiledFns]);

  // fnColors map
  const fnColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const fn of fns) map.set(fn.id, fn.color);
    return map;
  }, [fns]);

  const viewX: [number, number] = domain;
  const viewY: [number, number] = range;

  // ── 切线操作 ──

  const addTangent = useCallback((functionId: string, x: number) => {
    const newTl: TangentLine = {
      id: `tl-${Date.now()}`,
      functionId, x, fixed: false, showSlope: true,
    };
    const newList = [...tangentLines, newTl];
    onChange({ ...data, tangentLines: newList });
    setSelectedTangentId(newTl.id);
  }, [data, tangentLines, onChange]);

  const updateTangent = useCallback((id: string, updates: Partial<TangentLine>) => {
    const newList = tangentLines.map((tl) => tl.id === id ? { ...tl, ...updates } : tl);
    onChange({ ...data, tangentLines: newList });
  }, [data, tangentLines, onChange]);

  const removeTangent = useCallback((id: string) => {
    onChange({ ...data, tangentLines: tangentLines.filter((tl) => tl.id !== id) });
    if (selectedTangentId === id) setSelectedTangentId(null);
  }, [data, tangentLines, selectedTangentId, onChange]);

  const selectedTangent = tangentLines.find((tl) => tl.id === selectedTangentId) || null;

  // ── 法线操作 ──

  const addNormal = useCallback((functionId: string, x: number) => {
    const newNl: NormalLine = {
      id: `nl-${Date.now()}`,
      functionId, x, fixed: false, showSlope: true,
    };
    const newList = [...normalLines, newNl];
    onChange({ ...data, normalLines: newList });
    setSelectedNormalId(newNl.id);
  }, [data, normalLines, onChange]);

  const updateNormal = useCallback((id: string, updates: Partial<NormalLine>) => {
    const newList = normalLines.map((nl) => nl.id === id ? { ...nl, ...updates } : nl);
    onChange({ ...data, normalLines: newList });
  }, [data, normalLines, onChange]);

  const removeNormal = useCallback((id: string) => {
    onChange({ ...data, normalLines: normalLines.filter((nl) => nl.id !== id) });
    if (selectedNormalId === id) setSelectedNormalId(null);
  }, [data, normalLines, selectedNormalId, onChange]);

  const selectedNormal = normalLines.find((nl) => nl.id === selectedNormalId) || null;

  // ── 积分操作 ──

  const addIntegral = useCallback((functionId: string, a: number, b: number) => {
    const newIr: IntegralRegion = {
      id: `ir-${Date.now()}`,
      functionId, a, b, showValue: true,
    };
    const newList = [...integralRegions, newIr];
    onChange({ ...data, integralRegions: newList });
    setSelectedIntegralId(newIr.id);
  }, [data, integralRegions, onChange]);

  const updateIntegral = useCallback((id: string, updates: Partial<IntegralRegion>) => {
    const newList = integralRegions.map((ir) => ir.id === id ? { ...ir, ...updates } : ir);
    onChange({ ...data, integralRegions: newList });
  }, [data, integralRegions, onChange]);

  const removeIntegral = useCallback((id: string) => {
    onChange({ ...data, integralRegions: integralRegions.filter((ir) => ir.id !== id) });
    if (selectedIntegralId === id) setSelectedIntegralId(null);
  }, [data, integralRegions, selectedIntegralId, onChange]);

  const selectedIntegral = integralRegions.find((ir) => ir.id === selectedIntegralId) || null;

  // ── 标注操作 ──

  const addAnnotation = useCallback((functionId: string, x: number) => {
    const newAnn: Annotation = { x, functionId, label: '', showCoord: true };
    const newList = [...annotations, newAnn];
    onChange({ ...data, annotations: newList });
    setSelectedAnnotationIdx(newList.length - 1);
  }, [data, annotations, onChange]);

  const updateAnnotation = useCallback((idx: number, updates: Partial<Annotation>) => {
    const newList = annotations.map((a, i) => i === idx ? { ...a, ...updates } : a);
    onChange({ ...data, annotations: newList });
  }, [data, annotations, onChange]);

  const removeAnnotation = useCallback((idx: number) => {
    onChange({ ...data, annotations: annotations.filter((_, i) => i !== idx) });
    if (selectedAnnotationIdx === idx) setSelectedAnnotationIdx(null);
  }, [data, annotations, selectedAnnotationIdx, onChange]);

  const selectedAnnotation = selectedAnnotationIdx !== null ? annotations[selectedAnnotationIdx] || null : null;

  // ── 极值检测 ──

  const runFeatureDetection = useCallback(() => {
    const allPoints: FeaturePoint[] = [];
    for (const c of compiledFns) {
      if (!c.evalFn || !c.fn.visible) continue;
      const pts = detectFeaturePoints(c.evalFn, c.fn.id, domain[0], domain[1], {
        types: featureVisibleTypes,
      });
      allPoints.push(...pts);
    }
    onChange({ ...data, featurePoints: allPoints });
  }, [compiledFns, domain, featureVisibleTypes, data, onChange]);

  // 进入特征点模式时自动检测
  useEffect(() => {
    if (toolMode === 'feature') runFeatureDetection();
  }, [toolMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFeatureType = useCallback((type: FeaturePointType) => {
    setFeatureVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // ── 导出 ──

  const handleExport = useCallback(async (mode: 'copy' | 'download') => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return;
    try {
      const blob = await svgToPngBlob(svgEl as SVGSVGElement);
      if (mode === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'math-visual.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[MathVisual] 导出失败:', err);
    }
  }, []);

  // ── SVG 导出 ──

  const handleExportSvg = useCallback(() => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (data.title || 'math-visual') + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [data.title]);

  // ── 动画播放 ──

  // 保持最新 data 的 ref（动画 interval 中使用）
  const dataRef = useRef(data);
  dataRef.current = data;

  const startAnimation = useCallback((paramName: string, speed = 0.05) => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);
    setAnimating({ paramName, speed });

    animTimerRef.current = setInterval(() => {
      const cur = dataRef.current;
      const newParams = cur.parameters.map((p) => {
        if (p.name !== paramName) return p;
        let newVal = p.value + speed;
        if (newVal > p.max) newVal = p.min;
        if (newVal < p.min) newVal = p.max;
        return { ...p, value: Math.round(newVal * 100) / 100 };
      });
      onChange({ ...cur, parameters: newParams });
    }, 50);
  }, [onChange]);

  const stopAnimation = useCallback(() => {
    if (animTimerRef.current) {
      clearInterval(animTimerRef.current);
      animTimerRef.current = null;
    }
    setAnimating(null);
  }, []);

  // 组件卸载时清除动画
  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, []);

  // ── 画布点击处理（根据工具模式分发） ──

  /** 将页面坐标转为数学坐标 */
  const pageToMath = useCallback((e: React.MouseEvent): { mathX: number; mathY: number } | null => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    return {
      mathX: viewX[0] + relX * (viewX[1] - viewX[0]),
      mathY: viewY[1] - relY * (viewY[1] - viewY[0]),  // y 轴反转
    };
  }, [viewX, viewY]);

  /** 检查点击位置是否靠近某个已有标注，返回标注索引或 -1 */
  const findNearbyAnnotation = useCallback((mathX: number, mathY: number): number => {
    const xThreshold = (viewX[1] - viewX[0]) * 0.02; // 2% 视口宽度
    const yThreshold = (viewY[1] - viewY[0]) * 0.02;
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      const fn = evalFnMap.get(ann.functionId);
      if (!fn) continue;
      const annY = fn(ann.x);
      if (!isFinite(annY)) continue;
      if (Math.abs(ann.x - mathX) < xThreshold && Math.abs(annY - mathY) < yThreshold) {
        return i;
      }
    }
    return -1;
  }, [annotations, evalFnMap, viewX, viewY]);

  // ── 框选处理 ──

  /** 将页面坐标转为 SVG 内相对坐标（px，不是数学坐标） */
  const pageToSvgPx = useCallback((e: React.MouseEvent) => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (toolMode !== 'select') return;
    const pos = pageToSvgPx(e);
    if (pos) {
      setBoxSelectStart(pos);
      setBoxSelectEnd(pos);
    }
  }, [toolMode, pageToSvgPx]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (toolMode !== 'select' || !boxSelectStart) return;
    const pos = pageToSvgPx(e);
    if (pos) setBoxSelectEnd(pos);
  }, [toolMode, boxSelectStart, pageToSvgPx]);

  const handleCanvasMouseUp = useCallback(() => {
    if (toolMode !== 'select' || !boxSelectStart || !boxSelectEnd) {
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
      return;
    }

    // 将框选区域的 px 坐标转为数学坐标
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) { setBoxSelectStart(null); setBoxSelectEnd(null); return; }
    const rect = svgEl.getBoundingClientRect();

    const toMathX = (px: number) => viewX[0] + (px / rect.width) * (viewX[1] - viewX[0]);
    const toMathY = (px: number) => viewY[1] - (px / rect.height) * (viewY[1] - viewY[0]);

    const x1 = Math.min(toMathX(boxSelectStart.x), toMathX(boxSelectEnd.x));
    const x2 = Math.max(toMathX(boxSelectStart.x), toMathX(boxSelectEnd.x));
    const y1 = Math.min(toMathY(boxSelectStart.y), toMathY(boxSelectEnd.y));
    const y2 = Math.max(toMathY(boxSelectStart.y), toMathY(boxSelectEnd.y));

    // 找出所有在框选区域内的标注点
    const selected = new Set<number>();
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      const fn = evalFnMap.get(ann.functionId);
      if (!fn) continue;
      const annY = fn(ann.x);
      if (!isFinite(annY)) continue;
      if (ann.x >= x1 && ann.x <= x2 && annY >= y1 && annY <= y2) {
        selected.add(i);
      }
    }
    setSelectedAnnotationIdxs(selected);
    setBoxSelectStart(null);
    setBoxSelectEnd(null);
  }, [toolMode, boxSelectStart, boxSelectEnd, annotations, evalFnMap, viewX, viewY]);

  // ── 批量删除 ──

  const removeSelectedAnnotations = useCallback(() => {
    const newAnns = annotations.filter((_, i) => !selectedAnnotationIdxs.has(i));
    onChange({ ...data, annotations: newAnns });
    setSelectedAnnotationIdxs(new Set());
    setSelectedAnnotationIdx(null);
  }, [data, annotations, selectedAnnotationIdxs, onChange]);

  // ── 画布点击处理（根据工具模式分发） ──

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (toolMode === 'move' || toolMode === 'export' || toolMode === 'select') return;

    const coords = pageToMath(e);
    if (!coords) return;
    const { mathX, mathY } = coords;

    // 获取第一个可见函数 id
    const firstVisibleFn = fns.find((fn) => fn.visible && evalFnMap.has(fn.id));
    if (!firstVisibleFn) return;

    switch (toolMode) {
      case 'annotate': {
        // 先检查是否点击了已有标注
        const nearIdx = findNearbyAnnotation(mathX, mathY);
        if (nearIdx >= 0) {
          setSelectedAnnotationIdx(nearIdx);
        } else {
          addAnnotation(firstVisibleFn.id, mathX);
        }
        break;
      }
      case 'tangent':
        addTangent(firstVisibleFn.id, mathX);
        break;
      case 'normal':
        addNormal(firstVisibleFn.id, mathX);
        break;
      case 'integral': {
        // 创建一个小区间，用户可拖动调整
        const halfWidth = (viewX[1] - viewX[0]) * 0.05;
        addIntegral(firstVisibleFn.id, mathX - halfWidth, mathX + halfWidth);
        break;
      }
      // feature 不需要点击处理
    }
  }, [toolMode, fns, evalFnMap, viewX, pageToMath, findNearbyAnnotation, addAnnotation, addTangent, addIntegral]);

  // ── Esc 退出 + Delete/Backspace 删除选中对象 ──
  // 必须在所有 useCallback 之后，避免 TDZ 错误
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (toolMode !== 'move') {
          setToolMode('move');
        } else {
          onClose();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (toolMode === 'select' && selectedAnnotationIdxs.size > 0) {
          removeSelectedAnnotations();
        } else if (toolMode === 'annotate' && selectedAnnotationIdx !== null) {
          removeAnnotation(selectedAnnotationIdx);
        } else if (toolMode === 'tangent' && selectedTangentId) {
          removeTangent(selectedTangentId);
        } else if (toolMode === 'normal' && selectedNormalId) {
          removeNormal(selectedNormalId);
        } else if (toolMode === 'integral' && selectedIntegralId) {
          removeIntegral(selectedIntegralId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, toolMode, selectedAnnotationIdx, selectedAnnotationIdxs, selectedTangentId, selectedNormalId, selectedIntegralId,
      removeAnnotation, removeSelectedAnnotations, removeTangent, removeNormal, removeIntegral]);

  return (
    <div
      className="mv-fullscreen-overlay"
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
    >
      {/* 顶部栏 */}
      <div className="mv-fullscreen-header">
        <span className="mv-fullscreen-title">MathVisual 工作台</span>
        {data.title && (
          <span className="mv-fullscreen-chart-title">{data.title}</span>
        )}
        <div style={{ flex: 1 }} />
        <button className="mv-fullscreen-close" onClick={onClose} title="关闭 (Esc)">
          ×
        </button>
      </div>

      {/* 三栏主体 */}
      <div className="mv-fullscreen-body">
        {/* 左侧面板 */}
        <LeftPanel
          data={data}
          onChange={onChange}
          toolMode={toolMode}
          onToolChange={setToolMode}
          onExport={handleExport}
          onExportSvg={handleExportSvg}
          onRerunFeatures={runFeatureDetection}
          animating={animating}
          onStartAnimation={startAnimation}
          onStopAnimation={stopAnimation}
        />

        {/* 中央画布 */}
        <div
          className={`mv-fullscreen-canvas ${toolMode !== 'move' ? 'mv-fullscreen-canvas--tool' : ''} ${toolMode === 'select' ? 'mv-fullscreen-canvas--select' : ''}`}
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        >
          <Mafs
            viewBox={{ x: viewX, y: viewY }}
            preserveAspectRatio={false}
            height={canvasHeight}
            zoom={toolMode === 'move'}
            pan={toolMode === 'move'}
          >
            <SmartGrid
              showGrid={canvas.showGrid}
              showAxes={axis.showAxes}
              showNumbers={axis.showNumbers}
              userXStep={axis.xStep}
              userYStep={axis.yStep}
            />

            {/* 函数曲线 */}
            {compiledFns.map(({ fn, evalFn, contSegs }) => {
              if (!fn.visible) return null;
              const lineStyle = fn.style === 'dotted' ? 'dashed' : fn.style;
              const weight = fn.lineWidth || 2.5;

              // 垂直线: x = c
              if (fn.plotType === 'vertical-line') {
                const xVal = detectVerticalLine(fn.expression) ?? Number(fn.expression);
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
                    // 有不连续点：每段独立绘制 + 端点标记
                    contSegs.map((seg, si) => (
                      <React.Fragment key={`${fn.id}-seg-${si}`}>
                        <Plot.OfX y={evalFn} domain={seg.domain}
                          color={fn.color} style={lineStyle} weight={weight} />
                      </React.Fragment>
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

            {/* 开闭端点标记（从连续段的端点信息渲染） */}
            {compiledFns.map(({ fn, contSegs }) => {
              if (!fn.visible || contSegs.length === 0) return null;
              const allEps = contSegs.flatMap((seg) => [seg.leftEndpoint, seg.rightEndpoint]);
              return <EndpointMarkers key={`ep-${fn.id}`} endpoints={allEps} color={fn.color} />;
            })}

            {/* 标注点 */}
            <AnnotationTool
              annotations={annotations}
              evalFns={evalFnMap}
              pointSize={canvas.pointSize || 6}
              selectedIdx={toolMode === 'annotate' ? selectedAnnotationIdx : null}
              selectedIdxs={toolMode === 'select' ? selectedAnnotationIdxs : new Set()}
              onSelect={(idx) => setSelectedAnnotationIdx(idx)}
              onMove={(idx, newX) => updateAnnotation(idx, { x: newX })}
            />

            {/* 切线 */}
            {tangentLines.length > 0 && (
              <TangentTool
                tangentLines={tangentLines}
                evalFns={evalFnMap}
                fnColors={fnColorMap}
                onUpdate={updateTangent}
              />
            )}

            {/* 法线 */}
            {normalLines.length > 0 && (
              <NormalTool
                normalLines={normalLines}
                evalFns={evalFnMap}
                fnColors={fnColorMap}
                onUpdate={updateNormal}
              />
            )}

            {/* 积分区域 */}
            {integralRegions.length > 0 && (
              <IntegralTool
                regions={integralRegions}
                evalFns={evalFnMap}
                fnColors={fnColorMap}
                onUpdate={updateIntegral}
              />
            )}

            {/* 特征点 */}
            {featurePoints.length > 0 && toolMode === 'feature' && (
              <FeatureTool
                points={featurePoints}
                visibleTypes={featureVisibleTypes}
              />
            )}

            {/* 悬停坐标（移动模式下显示） */}
            {toolMode === 'move' && (
              <HoverCoords
                evalFns={evalFnMap}
                fnColors={fnColorMap}
                visibleFnIds={new Set(fns.filter((f) => f.visible && !f.plotType).map((f) => f.id))}
              />
            )}

            {/* 黎曼和（如果有积分区域且选中，显示矩形逼近） */}
            {riemannConfig && selectedIntegral && (
              <RiemannTool
                fn={evalFnMap.get(selectedIntegral.functionId)!}
                a={Math.min(selectedIntegral.a, selectedIntegral.b)}
                b={Math.max(selectedIntegral.a, selectedIntegral.b)}
                n={riemannConfig.n}
                mode={riemannConfig.mode}
                color={selectedIntegral.color || fnColorMap.get(selectedIntegral.functionId) || '#2D7FF9'}
                showSum={true}
              />
            )}
          </Mafs>

          {/* 框选矩形 */}
          {boxSelectStart && boxSelectEnd && (
            <div
              className="mv-box-select-rect"
              style={{
                left: Math.min(boxSelectStart.x, boxSelectEnd.x),
                top: Math.min(boxSelectStart.y, boxSelectEnd.y),
                width: Math.abs(boxSelectEnd.x - boxSelectStart.x),
                height: Math.abs(boxSelectEnd.y - boxSelectStart.y),
              }}
            />
          )}

          {/* 底部坐标栏 */}
          <div className="mv-fullscreen-coords">
            <span>x: [{domain[0]}, {domain[1]}]</span>
            <span>y: [{range[0]}, {range[1]}]</span>
            {toolMode !== 'move' && (
              <span className="mv-fullscreen-coords-tool">
                工具: {toolMode}
              </span>
            )}
          </div>
        </div>

        {/* 图例（多曲线时显示，定位在 body 层避免被画布 overflow:hidden 截断） */}
        <LegendOverlay functions={fns} />

        {/* 右侧属性面板 */}
        <RightPanel
          toolMode={toolMode}
          annotations={annotations}
          evalFns={evalFnMap}
          selectedAnnotation={selectedAnnotation}
          selectedAnnotationIdx={selectedAnnotationIdx}
          selectedAnnotationIdxs={selectedAnnotationIdxs}
          onSelectAnnotation={(idx) => setSelectedAnnotationIdx(idx)}
          onUpdateAnnotation={updateAnnotation}
          onRemoveAnnotation={removeAnnotation}
          onRemoveSelectedAnnotations={removeSelectedAnnotations}
          selectedTangent={selectedTangent}
          onUpdateTangent={updateTangent}
          onRemoveTangent={removeTangent}
          selectedNormal={selectedNormal}
          onUpdateNormal={updateNormal}
          onRemoveNormal={removeNormal}
          selectedIntegral={selectedIntegral}
          onUpdateIntegral={updateIntegral}
          onRemoveIntegral={removeIntegral}
          riemannConfig={riemannConfig}
          onRiemannChange={setRiemannConfig}
          featureVisibleTypes={featureVisibleTypes}
          onToggleFeatureType={toggleFeatureType}
        />
      </div>
    </div>
  );
};
