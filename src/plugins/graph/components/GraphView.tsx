import { useEffect, useRef, useState } from 'react';
import { GraphRenderer } from '../rendering/v2';
import { layoutRegistry } from '../layout';
import { substanceLibrary } from '../substance';
import type {
  GraphRecord,
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../main/storage/types';

/**
 * GraphView — 知识图谱视图（v1.4 graph-import 重构后 v2 渲染层）。
 *
 * 数据流：
 *   1. 监听 activeGraphId 变化
 *   2. viewAPI.graphLoadFull(id) → { graph, geometries, intensions, presentations }
 *   3. layoutRegistry.get(graph.active_layout).compute(...) → positions
 *   4. GraphRenderer.setData(...)
 *
 * 交互（D9 step2 仅缩放平移；拖动留 D10）：
 *   - 滚轮：缩放
 *   - 中键 / 右键拖动：平移
 *   - 双击空白：重置视图（D10 添加）
 */

interface LoadedGraph {
  graph: GraphRecord;
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
}

interface GraphStats {
  geometries: number;
  isEmpty: boolean;
}

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
  graphLoadFull: (graphId: string) => Promise<LoadedGraph | null>;
  onGraphPresentationChanged: (cb: (info: { graphId: string }) => void) => () => void;
};

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  /** 加载 token，用于丢弃过期的异步加载结果 */
  const loadTokenRef = useRef(0);

  // ── activeGraphId 同步 ──
  useEffect(() => {
    const unsub1 = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeGraphId !== undefined) setActiveGraphId(state.activeGraphId);
    });
    const unsub2 = viewAPI.onGraphActiveChanged((graphId) => {
      setActiveGraphId(graphId);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // ── GraphRenderer 生命周期：跟随 activeGraphId ──
  useEffect(() => {
    if (!activeGraphId || !containerRef.current) return;

    let renderer: GraphRenderer;
    try {
      renderer = new GraphRenderer();
      renderer.mount(containerRef.current);
      rendererRef.current = renderer;
    } catch (err) {
      console.error('[GraphView] failed to create/mount GraphRenderer:', err);
      setError(`renderer init failed: ${String(err)}`);
      return;
    }

    return () => {
      try {
        renderer.unmount();
      } catch (err) {
        console.error('[GraphView] unmount error:', err);
      }
      rendererRef.current = null;
    };
  }, [activeGraphId]);

  // ── 数据加载：activeGraphId 变化或 presentation 变化时重新加载 ──
  useEffect(() => {
    if (!activeGraphId || !rendererRef.current) return;

    const myToken = ++loadTokenRef.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await viewAPI.graphLoadFull(activeGraphId);
        if (myToken !== loadTokenRef.current) return;
        if (!data) {
          setError(`graph ${activeGraphId} not found`);
          setLoading(false);
          return;
        }

        // 算布局
        const layoutId = data.graph.active_layout || 'force';
        const algorithm = layoutRegistry.get(layoutId);
        if (!algorithm) {
          setError(`layout algorithm "${layoutId}" not registered`);
          setLoading(false);
          return;
        }

        const layoutResult = algorithm.compute({
          geometries: data.geometries,
          intensions: data.intensions,
          presentations: data.presentations,
          substanceResolver: (id) => substanceLibrary.get(id),
          dimension: data.graph.dimension ?? 2,
        });

        if (myToken !== loadTokenRef.current) return;
        if (!rendererRef.current) return;

        await rendererRef.current.setData({
          geometries: data.geometries,
          intensions: data.intensions,
          presentations: data.presentations,
          positions: layoutResult.positions,
        });

        if (myToken !== loadTokenRef.current) return;
        setStats({ geometries: data.geometries.length, isEmpty: data.geometries.length === 0 });
        setLoading(false);
      } catch (err) {
        console.error('[GraphView] load failed:', err);
        if (myToken === loadTokenRef.current) {
          setError(String(err));
          setLoading(false);
        }
      }
    })();
  }, [activeGraphId]);

  // ── 监听 presentation 变化（拖动 / Reset Layout 等触发） ──
  useEffect(() => {
    const unsub = viewAPI.onGraphPresentationChanged((info) => {
      if (info.graphId !== activeGraphId) return;
      // 重新加载（v1 简化：每次变化全量 reload；后续优化为增量）
      const myToken = ++loadTokenRef.current;
      void (async () => {
        if (!activeGraphId || !rendererRef.current) return;
        const data = await viewAPI.graphLoadFull(activeGraphId);
        if (!data || myToken !== loadTokenRef.current || !rendererRef.current) return;

        const layoutId = data.graph.active_layout || 'force';
        const algorithm = layoutRegistry.get(layoutId);
        if (!algorithm) return;
        const layoutResult = algorithm.compute({
          geometries: data.geometries,
          intensions: data.intensions,
          presentations: data.presentations,
          substanceResolver: (id) => substanceLibrary.get(id),
          dimension: data.graph.dimension ?? 2,
        });
        if (myToken !== loadTokenRef.current || !rendererRef.current) return;
        await rendererRef.current.setData({
          geometries: data.geometries,
          intensions: data.intensions,
          presentations: data.presentations,
          positions: layoutResult.positions,
        });
      })();
    });
    return unsub;
  }, [activeGraphId]);

  // ── 渲染 ──

  if (!activeGraphId) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 32 }}>🕸</div>
        <div style={{ fontSize: 14 }}>GraphView</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>从左侧选择或新建一个图</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1e1e1e' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {loading && (
        <div style={overlayStyle}>加载中…</div>
      )}
      {error && (
        <div style={{ ...overlayStyle, color: '#f87171' }}>错误: {error}</div>
      )}
      {!loading && !error && stats?.isEmpty && (
        <div style={emptyGraphStyle}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14, marginBottom: 4, color: '#aaa' }}>这张图还是空的</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            从 Markdown 导入（D11 实施）或手动添加节点（v1.5+）
          </div>
        </div>
      )}
      <div style={hintStyle}>
        {stats && `${stats.geometries} 个几何体 · `}滚轮缩放 · 中键/右键拖动平移
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
  gap: 8,
  userSelect: 'none',
  background: '#1e1e1e',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  fontSize: 12,
  color: '#aaa',
  background: 'rgba(0,0,0,0.6)',
  padding: '4px 10px',
  borderRadius: 4,
  pointerEvents: 'none',
};

const hintStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  fontSize: 11,
  color: '#888',
  background: 'rgba(0,0,0,0.5)',
  padding: '4px 10px',
  borderRadius: 4,
  pointerEvents: 'none',
  userSelect: 'none',
  zIndex: 10,
};

const emptyGraphStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
  userSelect: 'none',
  pointerEvents: 'none',
  zIndex: 5,
};
