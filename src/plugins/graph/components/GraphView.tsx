import { useEffect, useRef, useState, useCallback } from 'react';
import { BasicEngine } from '../engines/BasicEngine';
import type { GraphNode, GraphEdge } from '../engines/GraphEngine';

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
};

// P1 第二段：仍是硬编码假数据（持久化留 P1 第三段）
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
  const [hasSelection, setHasSelection] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BasicEngine | null>(null);

  useEffect(() => {
    const unsub1 = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeGraphId !== undefined) setActiveGraphId(state.activeGraphId);
    });
    const unsub2 = viewAPI.onGraphActiveChanged((graphId) => {
      setActiveGraphId(graphId);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  useEffect(() => {
    if (!activeGraphId || !containerRef.current) return;

    const engine = new BasicEngine();
    engine.mount(containerRef.current);
    engine.setData(DEMO_NODES.map((n) => ({ ...n })), DEMO_EDGES.map((e) => ({ ...e })));
    engine.runLayout().catch((err) => console.error('[GraphView] layout failed:', err));

    // 任何变更后刷新 UI 状态
    const refreshState = () => {
      setHasSelection(engine.getSelected() !== null);
      setCanUndo(engine.canUndo());
      setCanRedo(engine.canRedo());
    };
    engine.onChange = refreshState;
    engineRef.current = engine;

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

  // 键盘快捷键
  useEffect(() => {
    if (!activeGraphId) return;
    const onKey = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      const meta = e.metaKey || e.ctrlKey;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (engine.getSelected()) {
          e.preventDefault();
          engine.deleteSelected();
        }
      } else if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGraphId]);

  // 工具栏 actions
  const handleAddNode = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    // 在视口中心稍偏右的位置添加（避开已有节点堆叠）
    const offset = engine.getNodes().length * 20;
    const id = engine.createNodeAt(offset, offset, `N${engine.getNodes().length + 1}`);
    return id;
  }, []);

  const handleUndo = useCallback(() => engineRef.current?.undo(), []);
  const handleRedo = useCallback(() => engineRef.current?.redo(), []);
  const handleResetView = useCallback(() => engineRef.current?.resetView(), []);
  const handleDeleteSelected = useCallback(() => engineRef.current?.deleteSelected(), []);

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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1e1e1e' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* 左上角图标签 */}
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

      {/* 工具栏 */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          display: 'flex',
          gap: 4,
          background: 'rgba(40,40,40,0.85)',
          padding: 4,
          borderRadius: 4,
          userSelect: 'none',
        }}
      >
        <ToolbarButton onClick={handleAddNode} title="新增节点">+ 节点</ToolbarButton>
        <ToolbarButton onClick={handleDeleteSelected} disabled={!hasSelection} title="删除选中（Delete）">
          删除
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton onClick={handleUndo} disabled={!canUndo} title="撤销 (⌘Z)">↶</ToolbarButton>
        <ToolbarButton onClick={handleRedo} disabled={!canRedo} title="重做 (⌘⇧Z)">↷</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton onClick={handleResetView} title="重置视图">⊙</ToolbarButton>
      </div>

      {/* 提示文字 */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 12,
          fontSize: 11,
          color: '#666',
          pointerEvents: 'none',
          userSelect: 'none',
          lineHeight: 1.5,
        }}
      >
        左键拖动节点 · 节点边缘拖出新边 · 中键/右键拖动平移 · 滚轮缩放
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        color: disabled ? '#555' : '#ccc',
        cursor: disabled ? 'default' : 'pointer',
        padding: '4px 10px',
        fontSize: 12,
        borderRadius: 3,
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = '#333'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <div style={{ width: 1, background: '#555', margin: '4px 2px' }} />;
}
