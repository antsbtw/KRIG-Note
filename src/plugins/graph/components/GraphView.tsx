import { useEffect, useRef, useState } from 'react';
import { GraphRenderer } from '../rendering/GraphRenderer';
import { adapt } from '../rendering/adapter';
import { substanceLibrary } from '../substance';
import { layoutRegistry } from '../layout';
import { viewModeRegistry } from '../viewmode';
import '../projection';  // 副作用：注册 'graph' / 'tree' projection
import { composePatterns } from '../pattern';
import { measureLabels, readExistingBbox as readLabelBboxFromPresentations, type LabelBbox } from '../layout/label-measurer';
import { readGraphLevelLayoutOptions } from '../layout/layout-options';
import { isInLayoutFamily } from '../layout/layout-family';
import { Inspector } from './Inspector';
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

/** 根据 attribute 推断 atom value_kind（B4.2.b 视觉 override 写入用） */
function inferValueKind(attribute: string): 'string' | 'number' {
  if (attribute.endsWith('.width') || attribute.endsWith('.height') || attribute.endsWith('.size') || attribute.endsWith('.opacity') || attribute.endsWith('arrowSize')) {
    return 'number';
  }
  return 'string';
}

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
  graphLoadFull: (graphId: string) => Promise<LoadedGraph | null>;
  onGraphPresentationChanged?: (cb: (info: { graphId: string }) => void) => () => void;
  graphPresentationSetBulk: (records: unknown[]) => Promise<void>;
  graphPresentationDelete: (graphId: string, layoutId: string, subjectId: string, attribute: string) => Promise<void>;
  graphIntensionUpdate: (id: string, fields: unknown) => Promise<void>;
  graphIntensionCreate: (record: unknown) => Promise<unknown>;
  graphSetActiveViewMode: (graphId: string, viewModeId: string) => Promise<void>;
};

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; warnings: number } | null>(null);
  const [activeViewModeId, setActiveViewModeId] = useState<string>('force');

  // B4.2 选中状态
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  /** 框选 overlay：null 表示无；否则是 canvas 内屏幕坐标矩形 */
  const [boxSelectRect, setBoxSelectRect] = useState<
    { x: number; y: number; w: number; h: number } | null
  >(null);
  /** 当前生效的图谱级 layout 参数（Inspector 显示按钮高亮态用） */
  const [layoutOptions, setLayoutOptions] = useState<Record<string, string>>({});
  /** B4.2.b：原始 atom 数据（节点 Tab 读取用 — 当前 substance / 视觉 override） */
  const [graphAtoms, setGraphAtoms] = useState<{
    geometries: GraphGeometryRecord[];
    intensions: GraphIntensionAtomRecord[];
    presentations: GraphPresentationAtomRecord[];
  }>({ geometries: [], intensions: [], presentations: [] });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const loadTokenRef = useRef(0);
  /** 当前 graph 的活动 layout id（drag 写 atom 时用）；activeLayout 与 activeGraphId 同步更新 */
  const activeLayoutRef = useRef<string>('force');
  const activeGraphIdRef = useRef<string | null>(null);
  /** 选中 ref（事件回调里读最新值用） */
  const selectedIdsRef = useRef<ReadonlySet<string>>(selectedIds);
  selectedIdsRef.current = selectedIds;

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

    // B2.3：拖动节点结束 → 写 presentation atom（pinned + position）
    // 让节点固定在用户拖到的位置，下次打开图谱位置保持。
    renderer.setInteractionCallbacks({
      onNodeDragEnd: ({ instanceId, worldX, worldY }) => {
        const graphId = activeGraphIdRef.current;
        const layoutId = activeLayoutRef.current;
        if (!graphId) return;
        void viewAPI.graphPresentationSetBulk([
          {
            graph_id: graphId,
            layout_id: layoutId,
            subject_id: instanceId,
            attribute: 'position.x',
            value: String(worldX),
            value_kind: 'number',
          },
          {
            graph_id: graphId,
            layout_id: layoutId,
            subject_id: instanceId,
            attribute: 'position.y',
            value: String(worldY),
            value_kind: 'number',
          },
          {
            graph_id: graphId,
            layout_id: layoutId,
            subject_id: instanceId,
            attribute: 'pinned',
            value: 'true',
            value_kind: 'text',
          },
        ]).catch((err) => {
          console.error('[GraphView] persist drag failed:', err);
        });
      },
      // B4.2 单击选中
      onSelect: ({ instanceId, modifier }) => {
        if (instanceId === null) {
          // 点空白 = 取消选中（toggle 时也清空，跟 Figma 一致）
          setSelectedIds(new Set());
          return;
        }
        if (modifier === 'replace') {
          setSelectedIds(new Set([instanceId]));
        } else {
          // toggle
          const next = new Set(selectedIdsRef.current);
          if (next.has(instanceId)) next.delete(instanceId);
          else next.add(instanceId);
          setSelectedIds(next);
        }
      },
      // B4.2 框选过程（屏幕坐标 overlay）
      onBoxSelectUpdate: ({ startScreen, currentScreen }) => {
        const x = Math.min(startScreen.x, currentScreen.x);
        const y = Math.min(startScreen.y, currentScreen.y);
        const w = Math.abs(currentScreen.x - startScreen.x);
        const h = Math.abs(currentScreen.y - startScreen.y);
        setBoxSelectRect({ x, y, w, h });
      },
      // B4.2 框选结束
      onBoxSelectEnd: ({ worldRect, modifier }) => {
        setBoxSelectRect(null);
        const r = rendererRef.current;
        if (!r) return;
        const hits = r.hitTestRect(worldRect.minX, worldRect.minY, worldRect.maxX, worldRect.maxY);
        if (modifier === 'replace') {
          setSelectedIds(new Set(hits));
        } else {
          const next = new Set(selectedIdsRef.current);
          for (const id of hits) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
          setSelectedIds(next);
        }
      },
      onBoxSelectCancel: () => {
        setBoxSelectRect(null);
      },
    });

    return () => {
      renderer.unmount();
      rendererRef.current = null;
    };
  }, []);

  // B4.2 状态变更 → 同步 GraphRenderer 高亮
  useEffect(() => {
    rendererRef.current?.setSelectedIds(selectedIds);
  }, [selectedIds]);

  // B4.2 Esc 清空选中
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIds(new Set());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 加载 + 渲染 graph 数据（依赖 reloadTrigger 让 ViewMode 切换也触发重载）──
  const [reloadTrigger, setReloadTrigger] = useState(0);
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

        // 1. Pattern 阶段（spec §3.1 ②）：扫描 Pattern Substance 容器，
        //    算容器内子节点的"相对容器中心"槽位偏移
        const patternResult = composePatterns({
          geometries: data.geometries,
          intensions: data.intensions,
          substanceResolver: (id) => substanceLibrary.get(id),
        });

        // 2. Layout 阶段（spec §3.1 ③）：剔除已被 Pattern 管理的子节点，
        //    剩余节点（容器 + 散户）走 ViewMode.layout
        // ── 解析当前 ViewMode → 决定用哪个 layout 算法 ──
        // 优先 active_view_mode（v1.6 B3）；为空 → 兼容 v1.4/v1.5 的 active_layout
        const viewModeId = data.graph.active_view_mode
          ?? data.graph.active_layout
          ?? 'force';
        const viewMode = viewModeRegistry.get(viewModeId);
        const activeLayout = viewMode?.layout ?? data.graph.active_layout ?? 'force';
        activeGraphIdRef.current = data.graph.id;
        activeLayoutRef.current = activeLayout;
        setActiveViewModeId(viewModeId);
        const algorithm = layoutRegistry.get(activeLayout);
        if (!algorithm) {
          setError(`layout "${activeLayout}" not registered (viewMode=${viewModeId})`);
          setLoading(false);
          return;
        }

        const geometriesForLayout = data.geometries.filter(
          (g) => !patternResult.members.has(g.id),
        );
        const intensionsForLayout = data.intensions.filter(
          (a) => !patternResult.members.has(a.subject_id),
        );

        // ── B3.4.5: label-aware sizing ──
        // 从 presentations 中读已存的 label_bbox，构造 measureLabel 函数喂给 layout
        const labelBboxMap = readLabelBboxFromPresentations(data.presentations);
        const measureLabel = (id: string): LabelBbox | undefined => labelBboxMap.get(id);

        // ── B4.1: 画板模型 — 图谱级 layout 参数 ──
        // 从 presentations 中提取 subject_id=graph_id、attribute='layout.*' 的 atom，
        // 作为图谱级用户调整传给 layout 算法。
        const layoutOptions = readGraphLevelLayoutOptions(data.presentations, data.graph.id, activeLayout);
        setLayoutOptions(layoutOptions);

        // B4.2.b：保存原始 atom 数据供 Inspector 节点 Tab 读取
        setGraphAtoms({
          geometries: data.geometries,
          intensions: data.intensions,
          presentations: data.presentations,
        });

        const layoutResult = await algorithm.compute({
          geometries: geometriesForLayout,
          intensions: intensionsForLayout,
          presentations: data.presentations,
          substanceResolver: (id) => substanceLibrary.get(id),
          dimension: data.graph.dimension ?? 2,
          measureLabel,
          layoutOptions,
        });

        // 3. 合并：Pattern members 最终位置 = 容器 layout 位置 + 相对偏移
        const finalPositions = new Map<string, { x: number; y: number; z?: number }>(layoutResult.positions);
        for (const [memberId, member] of patternResult.members) {
          const containerPos = layoutResult.positions.get(member.containerId);
          if (!containerPos) continue;  // 容器没拿到位置（不应发生，兜底）
          finalPositions.set(memberId, {
            x: containerPos.x + member.offsetX,
            y: containerPos.y + member.offsetY,
            z: containerPos.z,
          });
        }

        // 4. 把 finalPositions 注入 presentations（作为虚拟 position atom）
        // 仅当 presentation 中没有该 subject 的 position.x 才注入（pinned 优先）
        const existingPositionSubjects = new Set(
          data.presentations
            .filter((p) => p.attribute === 'position.x' && isInLayoutFamily(p.layout_id, activeLayout))
            .map((p) => p.subject_id),
        );
        const layoutPresentations: GraphPresentationAtomRecord[] = [];
        for (const [geomId, pos] of finalPositions) {
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
          activeProjection: viewMode?.projection,
          edgeSections: layoutResult.edgeSections,
        });
        if (myToken !== loadTokenRef.current) return;
        if (!rendererRef.current) return;

        // 4. 渲染
        await rendererRef.current.setData(sceneData);

        if (myToken !== loadTokenRef.current) return;
        // B4.2 重新渲染后，把当前选中状态同步给 Renderer（mesh 是新建的，需要重新 highlight）
        rendererRef.current.setSelectedIds(selectedIdsRef.current);
        setStats({ total: sceneData.instances.length, warnings: sceneData.warnings.length });
        setLoading(false);

        // 5. B3.4.5: 异步测量 label bbox（背景任务，不阻塞首次渲染）。
        //    测量完成且差异显著 → 触发 reloadTrigger，让 layout 用新尺寸重排
        void (async () => {
          const newMap = await measureLabels({
            graphId: data.graph.id,
            instances: sceneData.instances,
            presentations: data.presentations,
            writeBack: async (records) => {
              await viewAPI.graphPresentationSetBulk(records);
            },
          });
          if (myToken !== loadTokenRef.current) return;
          // 检查新测量是否引入显著变化（与首次 layout 用的 labelBboxMap 比较）
          let dirty = false;
          for (const [id, bbox] of newMap) {
            const prev = labelBboxMap.get(id);
            if (!prev || Math.abs(prev.width - bbox.width) > 1 || Math.abs(prev.height - bbox.height) > 1) {
              dirty = true;
              break;
            }
          }
          if (dirty) setReloadTrigger((n) => n + 1);
        })();
      } catch (err) {
        console.error('[GraphView] load failed:', err);
        if (myToken === loadTokenRef.current) {
          setError(String(err));
          setLoading(false);
        }
      }
    })();
  }, [activeGraphId, reloadTrigger]);

  // ── ViewMode 切换处理 ──
  const handleViewModeChange = async (newViewModeId: string) => {
    if (!activeGraphId) return;
    if (newViewModeId === activeViewModeId) return;
    try {
      await viewAPI.graphSetActiveViewMode(activeGraphId, newViewModeId);
      setActiveViewModeId(newViewModeId);
      setReloadTrigger((n) => n + 1);  // 触发数据重载（重新算 layout）
    } catch (err) {
      console.error('[GraphView] setActiveViewMode failed:', err);
    }
  };

  // ── B4.2.b Inspector 节点 Tab：写/删节点视觉 override ──
  // 视觉 override atom 使用 layout_id='*'（跨布局，符合 §3.2 A 类约定）
  // 接受 geometryIds 数组：单选传 [id]，多选传所有选中 ids → 批量写一次 IPC
  const handleSetVisualOverride = async (geometryIds: string[], attribute: string, value: string) => {
    const graphId = activeGraphIdRef.current;
    if (!graphId || geometryIds.length === 0) return;
    try {
      await viewAPI.graphPresentationSetBulk(
        geometryIds.map((gid) => ({
          graph_id: graphId,
          layout_id: '*',
          subject_id: gid,
          attribute,
          value,
          value_kind: inferValueKind(attribute),
        })),
      );
      setReloadTrigger((n) => n + 1);
    } catch (err) {
      console.error('[GraphView] set visual override failed:', err);
    }
  };

  const handleClearVisualOverride = async (geometryIds: string[], attribute: string) => {
    const graphId = activeGraphIdRef.current;
    if (!graphId || geometryIds.length === 0) return;
    try {
      // graphPresentationDelete 一次只删一条 → 并发删多条
      await Promise.all(
        geometryIds.map((gid) =>
          viewAPI.graphPresentationDelete(graphId, '*', gid, attribute),
        ),
      );
      setReloadTrigger((n) => n + 1);
    } catch (err) {
      console.error('[GraphView] clear visual override failed:', err);
    }
  };

  // ── B4.2.b Inspector 节点 Tab：替换 substance（支持多选）──
  // 每个节点单独处理：有 substance atom → update，没有 → create
  const handleReplaceSubstance = async (geometryIds: string[], newSubstanceId: string) => {
    const graphId = activeGraphIdRef.current;
    if (!graphId || geometryIds.length === 0) return;
    try {
      const tasks: Promise<unknown>[] = [];
      for (const gid of geometryIds) {
        const existing = graphAtoms.intensions.find(
          (a) => a.subject_id === gid && a.predicate === 'substance',
        );
        if (existing) {
          tasks.push(viewAPI.graphIntensionUpdate(existing.id, { value: newSubstanceId }));
        } else {
          tasks.push(
            viewAPI.graphIntensionCreate({
              graph_id: graphId,
              subject_id: gid,
              predicate: 'substance',
              value: newSubstanceId,
              value_kind: 'string',
            }),
          );
        }
      }
      await Promise.all(tasks);
      setReloadTrigger((n) => n + 1);
    } catch (err) {
      console.error('[GraphView] replace substance failed:', err);
    }
  };

  // ── B4.2 Inspector 写入图谱级 layout 参数 ──
  // 用户在画板 Tab 调整 → 写 atom → 触发重载
  const handleSetLayoutOption = async (attribute: string, value: string) => {
    const graphId = activeGraphIdRef.current;
    const layoutId = activeLayoutRef.current;
    if (!graphId || !layoutId) return;
    try {
      await viewAPI.graphPresentationSetBulk([
        {
          graph_id: graphId,
          layout_id: layoutId,
          subject_id: graphId,
          attribute,
          value,
          value_kind: 'string',
        },
      ]);
      setReloadTrigger((n) => n + 1);
    } catch (err) {
      console.error('[GraphView] set layout option failed:', err, { attribute, value });
    }
  };

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
            ? `${stats.total} 个几何体${stats.warnings > 0 ? ` · ${stats.warnings} 警告` : ''}${selectedIds.size > 0 ? ` · 已选 ${selectedIds.size}` : ''}`
            : 'Graph'}
        </div>
      )}
      {/* B4.2 框选 overlay */}
      {boxSelectRect && (
        <div
          style={{
            position: 'absolute',
            left: boxSelectRect.x,
            top: boxSelectRect.y,
            width: boxSelectRect.w,
            height: boxSelectRect.h,
            border: '1px dashed #60a5fa',
            background: 'rgba(96, 165, 250, 0.1)',
            pointerEvents: 'none',
            zIndex: 8,
          }}
        />
      )}
      {activeGraphId && (
        <div style={viewModeSwitcherStyle}>
          {viewModeRegistry.list().map((vm) => (
            <button
              key={vm.id}
              onClick={() => handleViewModeChange(vm.id)}
              title={vm.description}
              style={{
                ...viewModeButtonStyle,
                ...(vm.id === activeViewModeId ? viewModeButtonActiveStyle : {}),
              }}
            >
              {vm.label}
            </button>
          ))}
        </div>
      )}
      {/* B4.2.a Inspector 编辑器浮窗 */}
      <Inspector
        graphId={activeGraphId}
        layoutId={viewModeRegistry.get(activeViewModeId)?.layout ?? 'force'}
        selectedIds={selectedIds}
        layoutOptions={layoutOptions}
        geometries={graphAtoms.geometries}
        intensions={graphAtoms.intensions}
        presentations={graphAtoms.presentations}
        onSetLayoutOption={handleSetLayoutOption}
        onReplaceSubstance={handleReplaceSubstance}
        onSetVisualOverride={handleSetVisualOverride}
        onClearVisualOverride={handleClearVisualOverride}
      />
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

const viewModeSwitcherStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  display: 'flex',
  gap: 4,
  background: 'rgba(0,0,0,0.55)',
  padding: 4,
  borderRadius: 6,
  zIndex: 10,
  userSelect: 'none',
};

const viewModeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#bbb',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  outline: 'none',
};

const viewModeButtonActiveStyle: React.CSSProperties = {
  background: '#3b82f6',
  color: '#fff',
  borderColor: '#60a5fa',
};
