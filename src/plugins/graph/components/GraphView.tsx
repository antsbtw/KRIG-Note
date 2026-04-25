import { useEffect, useRef, useState, useCallback } from 'react';
import { BasicEngine } from '../engines/BasicEngine';
import type { GraphNode, GraphEdge, Atom, ChangeEvent } from '../engines/GraphEngine';
import { ensureAtomLabel, makeTextLabel, extractPlainText } from '../engines/GraphEngine';

// ── DB 持久化形态（v1.2：label 字段是 atom 数组，但兼容 v1.1 的 string） ──

interface GraphNodeRecord {
  id: string;
  graph_id: string;
  type: string;
  label: Atom[] | string;   // v1.2 = Atom[]；旧数据 = string，加载时升级
  position_x: number;
  position_y: number;
  meta?: Record<string, unknown>;
}

interface GraphEdgeRecord {
  id: string;
  graph_id: string;
  type?: string;
  source: string;
  target: string;
  label?: Atom[] | string;
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

// ── 转换工具：DB 记录 ↔ Engine 数据 ──
// 关键点：DB label 字段可能是 string（v1.1 老数据）或 Atom[]（v1.2）。
// ensureAtomLabel 统一升级为 Atom[]。

function recordToNode(r: GraphNodeRecord): GraphNode {
  return {
    id: r.id,
    type: r.type || 'concept',
    label: ensureAtomLabel(r.label),
    position: { x: r.position_x, y: r.position_y },
  };
}

function recordToEdge(r: GraphEdgeRecord): GraphEdge {
  return {
    id: r.id,
    source: r.source,
    target: r.target,
    label: ensureAtomLabel(r.label),
  };
}

function nodeToRecord(graphId: string, n: GraphNode): GraphNodeRecord {
  return {
    id: n.id,
    graph_id: graphId,
    type: n.type,
    label: n.label,   // 直接存 Atom[]（schemaless DB 接受 JSON 数组）
    position_x: n.position?.x ?? 0,
    position_y: n.position?.y ?? 0,
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

      // 直接消费 DB 数据，新图初始为空白（用户通过 + 节点 / 右键自己创建）
      const nodes: GraphNode[] = data.nodes.map(recordToNode);
      const edges: GraphEdge[] = data.edges.map(recordToEdge);

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

    // 双击 label DOM → 替换成 input → 提交时调 engine.setNodeLabel/setEdgeLabel
    const containerEl = containerRef.current;
    const onDblClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.dataset?.kind) return;
      const kind = target.dataset.kind;
      const eng = engineRef.current;
      if (!eng) return;

      // 双击 label 进入纯文本编辑模式（v1.2 第一段）。
      // 提交后用 makeTextLabel 包成 textBlock atom，整体替换原 atom 数组。
      // 注：这丢失原 atom 数组里的非文本内容（如 mathBlock）。完整 ProseMirror
      //   编辑器会在 P1 v1.2 第二段加入。
      if (kind === 'node-label' && target.dataset.nodeId) {
        e.preventDefault();
        e.stopPropagation();
        const nid = target.dataset.nodeId;
        eng.setNodeLabelVisible(nid, false);
        editLabelInPlace(target, target.textContent ?? '', (newText) => {
          eng.setNodeLabelVisible(nid, true);
          eng.setNodeLabel(nid, makeTextLabel(newText));
        }, () => {
          eng.setNodeLabelVisible(nid, true);
        });
      } else if (kind === 'edge-label' && target.dataset.edgeId) {
        e.preventDefault();
        e.stopPropagation();
        const eid = target.dataset.edgeId;
        eng.setEdgeLabelVisible(eid, false);
        editLabelInPlace(target, target.textContent ?? '', (newText) => {
          eng.setEdgeLabelVisible(eid, true);
          eng.setEdgeLabel(eid, makeTextLabel(newText));
        }, () => {
          eng.setEdgeLabelVisible(eid, true);
        });
      }
    };
    containerEl.addEventListener('dblclick', onDblClick);

    return () => {
      ++loadTokenRef.current;
      ro.disconnect();
      containerEl.removeEventListener('dblclick', onDblClick);
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
      case 'node-label-changed': {
        const node = engine.getNodes().find((n) => n.id === event.nodeId);
        if (node) await viewAPI.graphNodeSave(nodeToRecord(graphId, node));
        break;
      }
      case 'edge-label-changed': {
        const edge = engine.getEdges().find((e) => e.id === event.edgeId);
        if (edge) await viewAPI.graphEdgeSave(edgeToRecord(graphId, edge));
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

// ── Label inline 编辑 ──

/**
 * 把一个 label DOM 临时替换成 input；blur/Enter 提交、Esc 取消。
 * 注意：CSS2DRenderer 每帧覆盖 label.style.display，所以隐藏 label 不能靠
 * 改 display，要让调用方改 CSS2DObject.visible。这里我们直接把 input 放在
 * label 旁边（label 已被 visible=false 隐藏），不再 try to hide label。
 */
function editLabelInPlace(
  labelEl: HTMLElement,
  initial: string,
  onCommit: (newText: string) => void,
  onCancel?: () => void,
): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  // 复制原 label 的样式
  input.style.cssText = labelEl.style.cssText;
  input.style.cursor = 'text';
  input.style.outline = '1px solid #4a90e2';
  input.style.minWidth = '60px';
  input.style.font = 'inherit';
  // 用绝对定位让 input 出现在 label 原位
  // labelEl 已被 CSS2DRenderer 设 transform 定位；input 作为兄弟节点直接
  // 复用 labelEl 的 transform 效果有点 hack，更稳的做法是用 fixed + 计算
  // labelEl 的 boundingClientRect
  const rect = labelEl.getBoundingClientRect();
  input.style.position = 'fixed';
  input.style.left = `${rect.left}px`;
  input.style.top = `${rect.top}px`;
  input.style.transform = 'none';
  input.style.zIndex = '1000';

  document.body.appendChild(input);
  input.focus();
  input.select();

  let committed = false;
  const cleanup = () => {
    if (input.parentElement) input.parentElement.removeChild(input);
  };
  const commit = () => {
    if (committed) return;
    committed = true;
    cleanup();
    onCommit(input.value);
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    cleanup();
    onCancel?.();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
  });
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
