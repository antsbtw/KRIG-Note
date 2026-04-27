import { useEffect, useRef, useState } from 'react';
import { GraphRenderer } from '../rendering/GraphRenderer';
import { adapt } from '../rendering/adapter';
import { substanceLibrary } from '../substance';
import { layoutRegistry } from '../layout';
import type {
  GraphRecord,
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../main/storage/types';

/**
 * GraphView — D-data 阶段：接入真实 graph 数据流。
 *
 * 数据流：
 *   activeGraphId 变化
 *      ↓
 *   viewAPI.graphLoadFull(id) → { graph, geometries, intensions, presentations }
 *      ↓
 *   layoutRegistry.compute(...) → positions（layout 写入 position.x/y atom）
 *      ↓
 *   adapter.adapt(...) → RenderableScene
 *      ↓
 *   GraphRenderer.setData(scene)
 *      ↓
 *   场景渲染（shape + label + scene fit）
 *
 * 不接交互（B2 阶段加缩放 / 平移 / 拖动）。
 */

interface LoadedGraph {
  graph: GraphRecord;
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
}

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
  graphLoadFull: (graphId: string) => Promise<LoadedGraph | null>;
  onGraphPresentationChanged?: (cb: (info: { graphId: string }) => void) => () => void;
};

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; warnings: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
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

  // ── GraphRenderer 生命周期 ──
  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new GraphRenderer();
    renderer.mount(containerRef.current);
    rendererRef.current = renderer;
    return () => {
      renderer.unmount();
      rendererRef.current = null;
    };
  }, []);

  // ── 加载 + 渲染 graph 数据 ──
  useEffect(() => {
    if (!activeGraphId) return;
    if (!rendererRef.current) return;

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

        // 1. 算布局位置
        const activeLayout = data.graph.active_layout || 'force';
        const algorithm = layoutRegistry.get(activeLayout);
        if (!algorithm) {
          setError(`layout "${activeLayout}" not registered`);
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

        // 2. 把 layout positions 注入 presentations（作为虚拟 position atom）
        // 仅当 presentation 中没有该 subject 的 position.x 才注入（pinned 优先）
        const existingPositionSubjects = new Set(
          data.presentations
            .filter((p) => p.attribute === 'position.x' && (p.layout_id === '*' || p.layout_id === activeLayout))
            .map((p) => p.subject_id),
        );
        const layoutPresentations: GraphPresentationAtomRecord[] = [];
        for (const [geomId, pos] of layoutResult.positions) {
          if (existingPositionSubjects.has(geomId)) continue;
          layoutPresentations.push(
            { id: `_lyt_${geomId}_x`, graph_id: data.graph.id, layout_id: activeLayout, subject_id: geomId, attribute: 'position.x', value: String(pos.x), value_kind: 'number', updated_at: 0 },
            { id: `_lyt_${geomId}_y`, graph_id: data.graph.id, layout_id: activeLayout, subject_id: geomId, attribute: 'position.y', value: String(pos.y), value_kind: 'number', updated_at: 0 },
          );
          if (pos.z !== undefined) {
            layoutPresentations.push(
              { id: `_lyt_${geomId}_z`, graph_id: data.graph.id, layout_id: activeLayout, subject_id: geomId, attribute: 'position.z', value: String(pos.z), value_kind: 'number', updated_at: 0 },
            );
          }
        }

        // 3. adapter
        const sceneData = adapt({
          graph: data.graph,
          geometries: data.geometries,
          intensions: data.intensions,
          presentations: [...data.presentations, ...layoutPresentations],
          substanceResolver: (id) => substanceLibrary.get(id),
          activeLayout,
        });
        if (myToken !== loadTokenRef.current) return;
        if (!rendererRef.current) return;

        // 4. 渲染
        await rendererRef.current.setData(sceneData);

        if (myToken !== loadTokenRef.current) return;
        setStats({ total: sceneData.instances.length, warnings: sceneData.warnings.length });
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

  // ── 渲染 ──
  // 始终渲染 canvas 容器（让 GraphRenderer 在 mount 阶段就能拿到容器）。
  // !activeGraphId 时显示 empty overlay 覆盖在画布上。

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1e1e1e' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {!activeGraphId && (
        <div style={emptyOverlayStyle}>
          <div style={{ fontSize: 32 }}>🕸</div>
          <div style={{ fontSize: 14 }}>GraphView</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>从左侧选择或新建一个图</div>
        </div>
      )}
      {loading && <div style={overlayStyle}>加载中…</div>}
      {error && <div style={{ ...overlayStyle, color: '#f87171' }}>错误: {error}</div>}
      {activeGraphId && (
        <div style={hintStyle}>
          {stats
            ? `${stats.total} 个几何体${stats.warnings > 0 ? ` · ${stats.warnings} 警告` : ''}`
            : 'Graph'}
        </div>
      )}
    </div>
  );
}

const emptyOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
  gap: 8,
  userSelect: 'none',
  pointerEvents: 'none',
  zIndex: 5,
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
  zIndex: 10,
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
