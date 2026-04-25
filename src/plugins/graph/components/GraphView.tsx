import { useEffect, useRef, useState, useCallback } from 'react';
import { BasicEngine } from '../engines/BasicEngine';
import type { GraphNode, GraphEdge, ChangeEvent } from '../engines/GraphEngine';

interface GraphNodeRecord {
  id: string;
  graph_id: string;
  type: string;
  label: string;
  position_x: number;
  position_y: number;
  block_ids?: string[];
  meta?: Record<string, unknown>;
}

interface GraphEdgeRecord {
  id: string;
  graph_id: string;
  type?: string;
  source: string;
  target: string;
  label?: string;
  meta?: Record<string, unknown>;
}

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
  graphLoadData: (graphId: string) => Promise<{ nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] }>;
  graphNodeSave: (node: GraphNodeRecord) => Promise<void>;
  graphNodeDelete: (graphId: string, nodeId: string) => Promise<void>;
  graphEdgeSave: (edge: GraphEdgeRecord) => Promise<void>;
  graphEdgeDelete: (graphId: string, edgeId: string) => Promise<void>;
};

// ── 转换工具 ──

function recordToNode(r: GraphNodeRecord): GraphNode {
  return {
    id: r.id,
    type: r.type || 'concept',
    label: r.label || '',
    position: { x: r.position_x, y: r.position_y },
  };
}

function recordToEdge(r: GraphEdgeRecord): GraphEdge {
  return {
    id: r.id,
    source: r.source,
    target: r.target,
    label: r.label,
  };
}

function nodeToRecord(graphId: string, n: GraphNode): GraphNodeRecord {
  return {
    id: n.id,
    graph_id: graphId,
    type: n.type,
    label: n.label,
    position_x: n.position?.x ?? 0,
    position_y: n.position?.y ?? 0,
    block_ids: [],
    meta: {},
  };
}

function edgeToRecord(graphId: string, e: GraphEdge): GraphEdgeRecord {
  return {
    id: e.id,
    graph_id: graphId,
    source: e.source,
    target: e.target,
    label: e.label,
    meta: {},
  };
}

// ── 新图初始种子（首次加载图为空时写入） ──

function seedNodes(): GraphNode[] {
  return [
    { id: `n-${Date.now()}-a`, type: 'concept', label: '节点 1', position: { x: -150, y: 0 } },
    { id: `n-${Date.now()}-b`, type: 'concept', label: '节点 2', position: { x: 0, y: 0 } },
    { id: `n-${Date.now()}-c`, type: 'concept', label: '节点 3', position: { x: 150, y: 0 } },
  ];
}

function seedEdges(nodes: GraphNode[]): GraphEdge[] {
  return [
    { id: `e-${Date.now()}-1`, source: nodes[0].id, target: nodes[1].id },
    { id: `e-${Date.now()}-2`, source: nodes[1].id, target: nodes[2].id },
  ];
}

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BasicEngine | null>(null);
  /** 每个 graphId 对应的 engine 生命周期 token，避免异步加载结果应用到旧引擎 */
  const loadTokenRef = useRef(0);
  /** 引导加载期间不回写（避免把刚 load 的数据再写回） */
  const loadingRef = useRef(false);

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
    engineRef.current = engine;

    const refreshState = () => {
      setHasSelection(engine.getSelected() !== null);
      setCanUndo(engine.canUndo());
      setCanRedo(engine.canRedo());
    };

    // onChange：每次数据变更都落库
    engine.onChange = (event: ChangeEvent) => {
      refreshState();
      // 引导加载期间不回写（避免把刚 load 的数据又写一遍）
      if (loadingRef.current) return;
      void persistChange(activeGraphId, engine, event);
    };

    // 加载图数据
    const myToken = ++loadTokenRef.current;
    loadingRef.current = true;
    setLoading(true);

    (async () => {
      const data = await viewAPI.graphLoadData(activeGraphId);
      if (myToken !== loadTokenRef.current) return;  // 已切到别的图，丢弃

      let nodes: GraphNode[];
      let edges: GraphEdge[];

      if (data.nodes.length === 0 && data.edges.length === 0) {
        // 首次打开：写入种子并 load
        nodes = seedNodes();
        edges = seedEdges(nodes);
        await Promise.all([
          ...nodes.map((n) => viewAPI.graphNodeSave(nodeToRecord(activeGraphId, n))),
          ...edges.map((e) => viewAPI.graphEdgeSave(edgeToRecord(activeGraphId, e))),
        ]);
      } else {
        nodes = data.nodes.map(recordToNode);
        edges = data.edges.map(recordToEdge);
      }

      if (myToken !== loadTokenRef.current) return;
      engine.setData(nodes, edges);
      // 已有持久化坐标的节点 → 不跑布局；否则补一次自动布局
      const hasAllPositions = nodes.every((n) => n.position);
      if (hasAllPositions) {
        engine.rerender();
      } else {
        await engine.runLayout();
      }
      loadingRef.current = false;
      setLoading(false);
      refreshState();
    })().catch((err) => {
      console.error('[GraphView] load failed:', err);
      loadingRef.current = false;
      setLoading(false);
    });

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        engine.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ++loadTokenRef.current;
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [activeGraphId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 键盘
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

  const handleAddNode = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const offset = engine.getNodes().length * 20;
    engine.createNodeAt(offset, offset, `节点 ${engine.getNodes().length + 1}`);
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
        BasicEngine · {activeGraphId}{loading ? ' · 加载中…' : ''}
      </div>

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

// ── 持久化派发 ──

async function persistChange(graphId: string, engine: BasicEngine, event: ChangeEvent): Promise<void> {
  try {
    switch (event.type) {
      case 'node-added': {
        await viewAPI.graphNodeSave(nodeToRecord(graphId, event.node));
        break;
      }
      case 'node-removed': {
        await viewAPI.graphNodeDelete(graphId, event.nodeId);
        break;
      }
      case 'node-moved': {
        const node = engine.getNodes().find((n) => n.id === event.nodeId);
        if (node) await viewAPI.graphNodeSave(nodeToRecord(graphId, node));
        break;
      }
      case 'edge-added': {
        await viewAPI.graphEdgeSave(edgeToRecord(graphId, event.edge));
        break;
      }
      case 'edge-removed': {
        await viewAPI.graphEdgeDelete(graphId, event.edgeId);
        break;
      }
      case 'selection':
        // 选中态不持久化
        break;
    }
  } catch (err) {
    console.error('[GraphView] persist failed:', event, err);
  }
}

// ── UI 组件 ──

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
