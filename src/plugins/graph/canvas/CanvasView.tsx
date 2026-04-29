import { useEffect, useRef, useState, useCallback } from 'react';
import { SceneManager } from './scene/SceneManager';
import { NodeRenderer } from './scene/NodeRenderer';
import { InteractionController, type AddModeSpec } from './interaction/InteractionController';
import { Toolbar } from './ui/Toolbar/Toolbar';
import { ShapeRegistry } from '../library/shapes';
import { SubstanceRegistry } from '../library/substances';
import type { Instance } from '../library/types';

/**
 * CanvasView — Graph view 主组件(canvas variant)
 *
 * 结构:Toolbar(顶部 36px,M1.4a 完成)+ 全屏 Canvas 容器 + Empty overlay
 *
 * 关键约束(对齐 memory):
 * - canvas-container div 始终 mount(empty/canvas 用 overlay 切换),否则
 *   ref 时机错过让 SceneManager 永远不挂(feedback_canvas_container_must_always_render)
 * - SceneManager 内部处理 Retina + ResizeObserver(feedback_threejs_retina_setsize)
 */

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const nodeRendererRef = useRef<NodeRenderer | null>(null);
  const interactionRef = useRef<InteractionController | null>(null);

  // Toolbar 显示用的 React state(从 imperative SceneManager / InteractionController 同步)
  const [zoomLevel, setZoomLevel] = useState(1);
  const [addMode, setAddMode] = useState<AddModeSpec | null>(null);

  // SceneManager / NodeRenderer / InteractionController 生命周期
  useEffect(() => {
    if (!containerRef.current) return;
    // bootstrap library(幂等,多次调用安全)
    ShapeRegistry.bootstrap();
    SubstanceRegistry.bootstrap();

    const sm = new SceneManager(containerRef.current);
    const nr = new NodeRenderer(sm);
    const ic = new InteractionController({
      container: containerRef.current,
      sceneManager: sm,
      nodeRenderer: nr,
      getInstance: (id) => nr.getInstance(id),
      onChange: () => {
        // M1.5 接持久化时,这里 schedule save
      },
      onAddModeChange: (spec) => setAddMode(spec),
    });
    sceneManagerRef.current = sm;
    nodeRendererRef.current = nr;
    interactionRef.current = ic;

    // M1.2b dev self-check:走真实 instance JSON → NodeRenderer 全管线
    nr.setInstances(devSelfCheckInstances());

    // Zoom 显示:轮询 sceneManager.getView()(SceneManager 没暴露事件)
    // 用 setInterval(150ms)而非 RAF — toolbar 上 % 数字不需要 60fps 精度,
    // setInterval 比 RAF setState 开销更可控;只在实际变化时 setState 减少 React 工作
    let lastReported = -1;
    const baseViewWidth = sm.getView().viewWidth || 1;
    const zoomTimer = window.setInterval(() => {
      const cur = sm.getView();
      if (cur.viewWidth <= 0) return;
      const z = baseViewWidth / cur.viewWidth;
      // 只在 % 取整后变化时更新,避免高频微调
      const pct = Math.round(z * 100);
      if (pct === lastReported) return;
      lastReported = pct;
      setZoomLevel(z);
    }, 150);

    return () => {
      window.clearInterval(zoomTimer);
      ic.dispose();
      nr.clear();
      sm.dispose();
      sceneManagerRef.current = null;
      nodeRendererRef.current = null;
      interactionRef.current = null;
    };
  }, []);

  // ── Toolbar 回调 ──
  const handleAddShape = useCallback(() => {
    interactionRef.current?.enterAddMode({
      kind: 'shape',
      ref: 'krig.basic.roundRect',  // M1.4b 接通 LibraryPicker 后改成 picker 选什么用什么
    });
  }, []);
  const handleAddSubstance = useCallback(() => {
    interactionRef.current?.enterAddMode({
      kind: 'substance',
      ref: 'library.text-card',     // M1.4b 接通 LibraryPicker 后改成 picker 选什么用什么
    });
  }, []);
  const handleFit = useCallback(() => {
    nodeRendererRef.current?.fitAll();
  }, []);
  const handleClose = useCallback(() => {
    (window as { viewAPI?: { closeSelf?: () => void } }).viewAPI?.closeSelf?.();
  }, []);

  return (
    <div style={styles.container}>
      <Toolbar
        title="Canvas"
        zoomLevel={zoomLevel}
        addModeRef={addMode?.ref ?? null}
        onAddShape={handleAddShape}
        onAddSubstance={handleAddSubstance}
        onFit={handleFit}
        onClose={handleClose}
      />

      {/* Canvas 容器:始终 mount,SceneManager 在 useEffect 里挂 renderer */}
      <div style={styles.canvasWrap}>
        <div ref={containerRef} style={styles.canvasContainer} />
      </div>
    </div>
  );
}

/**
 * Dev self-check:用真实 instance JSON 走 NodeRenderer 全管线
 * 包含 shape 实例 + substance 实例 + style override + params override
 * M1.5 接通 Canvas note 持久化后,这部分由反序列化产物替代
 */
function devSelfCheckInstances(): Instance[] {
  return [
    // 1. shape 实例(roundRect)
    {
      id: 'dev-1',
      type: 'shape',
      ref: 'krig.basic.roundRect',
      position: { x: 50, y: 50 },
      size: { w: 200, h: 100 },
      params: { r: 0.2 },
    },
    // 2. shape 实例 + style override(diamond,自定义颜色)
    {
      id: 'dev-2',
      type: 'shape',
      ref: 'krig.basic.diamond',
      position: { x: 320, y: 50 },
      size: { w: 120, h: 100 },
      style_overrides: {
        fill: { color: '#e8a8c0' },
      },
    },
    // 3. shape 实例(ellipse)
    {
      id: 'dev-3',
      type: 'shape',
      ref: 'krig.basic.ellipse',
      position: { x: 500, y: 50 },
      size: { w: 100, h: 100 },
    },
    // 4. substance 实例(family.person — 多 component 组合)
    {
      id: 'dev-4',
      type: 'substance',
      ref: 'library.family.person',
      position: { x: 50, y: 220 },
      props: { label: '贾宝玉', gender: 'M' },
    },
    // 5. substance 实例(text-card)
    {
      id: 'dev-5',
      type: 'substance',
      ref: 'library.text-card',
      position: { x: 280, y: 220 },
      props: { label: 'Hello' },
    },
    // 6. line 实例:elbow 连 dev-1(roundRect)→ dev-3(ellipse),验证 magnet 吸附
    {
      id: 'dev-line-1',
      type: 'shape',
      ref: 'krig.line.elbow',
      endpoints: [
        { instance: 'dev-1', magnet: 'E' },
        { instance: 'dev-3', magnet: 'W' },
      ],
    },
    // 7. line 实例:straight 连 dev-4 → dev-5(substance 间连线,走 frame 的 magnets)
    {
      id: 'dev-line-2',
      type: 'shape',
      ref: 'krig.line.straight',
      endpoints: [
        { instance: 'dev-4', magnet: 'E' },
        { instance: 'dev-5', magnet: 'W' },
      ],
    },
  ];
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1e1e1e',
    color: '#e8eaed',
  },
  canvasWrap: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  canvasContainer: {
    width: '100%',
    height: '100%',
  },
};
