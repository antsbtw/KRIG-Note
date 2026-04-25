import { useEffect, useRef, useState } from 'react';
import { BasicEngine } from '../engines/BasicEngine';
import type { GraphNode, GraphEdge } from '../engines/GraphEngine';

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
};

// P1 第一段：硬编码假数据，验证渲染管线
const DEMO_NODES: GraphNode[] = [
  { id: 'A', type: 'concept', label: 'A' },
  { id: 'B', type: 'concept', label: 'B' },
  { id: 'C', type: 'concept', label: 'C' },
  { id: 'D', type: 'concept', label: 'D' },
];
const DEMO_EDGES: GraphEdge[] = [
  { id: 'e1', source: 'A', target: 'B' },
  { id: 'e2', source: 'B', target: 'C' },
  { id: 'e3', source: 'C', target: 'D' },
];

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BasicEngine | null>(null);

  // 同步活跃图 id（用于占位提示，引擎数据接入留 P1 第二段）
  useEffect(() => {
    const unsub1 = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeGraphId !== undefined) setActiveGraphId(state.activeGraphId);
    });
    const unsub2 = viewAPI.onGraphActiveChanged((graphId) => {
      setActiveGraphId(graphId);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // 仅在有活跃图时挂载引擎
  useEffect(() => {
    if (!activeGraphId || !containerRef.current) return;

    const engine = new BasicEngine();
    engine.mount(containerRef.current);
    engine.setData(DEMO_NODES, DEMO_EDGES);
    engine.runLayout().catch((err) => {
      console.error('[GraphView] layout failed:', err);
    });
    engineRef.current = engine;

    // 监听容器 resize
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        engine.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [activeGraphId]);

  // 未选状态
  if (!activeGraphId) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#888',
          gap: 8,
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 32 }}>🕸</div>
        <div style={{ fontSize: 14 }}>GraphView</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>从左侧选择或新建一个图</div>
      </div>
    );
  }

  // 已激活：挂载 Three.js canvas
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1e1e1e' }}>
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: 11,
          color: '#888',
          background: 'rgba(30,30,30,0.6)',
          padding: '2px 8px',
          borderRadius: 3,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        BasicEngine · {activeGraphId}
      </div>
    </div>
  );
}
