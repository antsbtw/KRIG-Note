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
  graphGeometryCreate: (record: unknown) => Promise<unknown>;
  graphSetActiveViewMode: (graphId: string, viewModeId: string) => Promise<void>;
  // B4.3 user_substance
  graphUserSubstanceList: () => Promise<Array<{ id: string; substance_id: string; label: string; data: string }>>;
  graphUserSubstanceCreate: (input: { substance_id: string; label: string; data: string }) => Promise<unknown>;
  graphUserSubstanceUpdate: (substance_id: string, fields: { label?: string; data?: string }) => Promise<void>;
  graphUserSubstanceDelete: (substance_id: string) => Promise<void>;
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
  /** B4.3 凝结操作的反馈 toast（成功/失败提示，3.5 秒自动消失） */
  const [forgeToast, setForgeToast] = useState<string | null>(null);
  /** B4.5 user substance 列表（库 Tab 显示用；凝结/重命名/删除时同步更新） */
  const [userSubstances, setUserSubstances] = useState<import('../substance/types').Substance[]>([]);
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

  // ── B4.3 启动时加载 user_substance 注册到 substanceLibrary ──
  // 用 ref 跟踪是否已加载，避免 GraphView 卸载/重挂时重复 register
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const records = await viewAPI.graphUserSubstanceList();
        if (cancelled) return;
        const parsedList: import('../substance/types').Substance[] = [];
        for (const rec of records) {
          try {
            const parsed = JSON.parse(rec.data) as import('../substance/types').Substance;
            substanceLibrary.register(parsed);
            parsedList.push(parsed);
          } catch (err) {
            console.warn('[GraphView] failed to parse user_substance:', rec.substance_id, err);
          }
        }
        setUserSubstances(parsedList);
      } catch (err) {
        console.warn('[GraphView] load user_substance failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      // B4.4：检查目标 substance 是否含 canvas_snapshot
      const targetSubstance = substanceLibrary.get(newSubstanceId);
      const snapshot = targetSubstance?.canvas_snapshot;

      // 单选 + 含 snapshot → 展开（B4.4）
      if (geometryIds.length === 1 && snapshot && snapshot.geometries && snapshot.geometries.length > 0) {
        await expandCanvasSnapshot(graphId, geometryIds[0]!, newSubstanceId, snapshot);
        setReloadTrigger((n) => n + 1);
        return;
      }

      // 多选或无 snapshot → 走原有"仅替换引用"路径
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

      // 多选时若是 user substance 含 snapshot，提示用户没展开
      if (geometryIds.length > 1 && snapshot) {
        setForgeToast('多选时仅替换引用，未展开 canvas_snapshot');
        setTimeout(() => setForgeToast(null), 3500);
      }

      setReloadTrigger((n) => n + 1);
    } catch (err) {
      console.error('[GraphView] replace substance failed:', err);
    }
  };

  /**
   * B4.4 expansion：把 user substance 的 canvas_snapshot 展开到当前图谱。
   *
   * 规则：
   *   - 锚点：snapshot.geometries 第一项 = 当前节点 N（仅替换 substance + visual override）
   *   - 其他项：新建 geometry + atoms，位置 = N.position + relative_position
   *   - 仅展开 point；line/surface 由用户手动连（v1 不复制 connector）
   */
  const expandCanvasSnapshot = async (
    graphId: string,
    anchorGeometryId: string,
    refSubstanceId: string,
    snapshot: NonNullable<import('../substance/types').CanvasSnapshot>,
  ) => {
    if (!snapshot.geometries || snapshot.geometries.length === 0) return;

    // 找当前 anchor 节点位置（layoutPresentations 已注入虚拟 atom，graphAtoms 里也有真值）
    const layoutId = activeLayoutRef.current;
    let anchorX = 0, anchorY = 0;
    for (const p of graphAtoms.presentations) {
      if (p.subject_id !== anchorGeometryId) continue;
      if (!isInLayoutFamily(p.layout_id, layoutId)) continue;
      if (p.attribute === 'position.x') anchorX = parseFloat(p.value);
      else if (p.attribute === 'position.y') anchorY = parseFloat(p.value);
    }

    const tasks: Promise<unknown>[] = [];

    // [0] anchor：snapshot 第一项应用到当前 N 节点
    const [first, ...rest] = snapshot.geometries;
    if (first) {
      // 替换 substance 引用（指向 first.substance；若无则用 user substance 自身 id）
      const targetSubId = first.substance ?? refSubstanceId;
      const existing = graphAtoms.intensions.find(
        (a) => a.subject_id === anchorGeometryId && a.predicate === 'substance',
      );
      if (existing) {
        tasks.push(viewAPI.graphIntensionUpdate(existing.id, { value: targetSubId }));
      } else {
        tasks.push(
          viewAPI.graphIntensionCreate({
            graph_id: graphId,
            subject_id: anchorGeometryId,
            predicate: 'substance',
            value: targetSubId,
            value_kind: 'string',
          }),
        );
      }
      // 写 first 的 visual_overrides（layout_id='*'）
      if (first.visual_overrides) {
        const records = Object.entries(first.visual_overrides).map(([attr, val]) => ({
          graph_id: graphId,
          layout_id: '*',
          subject_id: anchorGeometryId,
          attribute: attr,
          value: val,
          value_kind: inferValueKind(attr),
        }));
        if (records.length > 0) {
          tasks.push(viewAPI.graphPresentationSetBulk(records));
        }
      }
    }

    // [1..N] 其他项：新建 geometry + atoms
    for (const g of rest) {
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 新建 geometry
      tasks.push(
        viewAPI.graphGeometryCreate({
          id: newId,
          graph_id: graphId,
          kind: g.kind,
          members: g.members ?? [],
        }),
      );
      // 写 substance 引用
      if (g.substance) {
        tasks.push(
          viewAPI.graphIntensionCreate({
            graph_id: graphId,
            subject_id: newId,
            predicate: 'substance',
            value: g.substance,
            value_kind: 'string',
          }),
        );
      }
      // 写 label
      if (g.label) {
        tasks.push(
          viewAPI.graphIntensionCreate({
            graph_id: graphId,
            subject_id: newId,
            predicate: 'label',
            value: g.label,
            value_kind: 'string',
          }),
        );
      }
      // 视觉 override + 位置（pinned 在 anchor 周围）
      const presentationRecords: Array<Record<string, unknown>> = [];
      if (g.visual_overrides) {
        for (const [attr, val] of Object.entries(g.visual_overrides)) {
          presentationRecords.push({
            graph_id: graphId,
            layout_id: '*',
            subject_id: newId,
            attribute: attr,
            value: val,
            value_kind: inferValueKind(attr),
          });
        }
      }
      // 位置 = anchor + relative_position（pinned，避免布局算法挪走）
      if (g.relative_position) {
        const x = anchorX + g.relative_position.x;
        const y = anchorY + g.relative_position.y;
        presentationRecords.push(
          { graph_id: graphId, layout_id: layoutId, subject_id: newId, attribute: 'position.x', value: String(x), value_kind: 'number' },
          { graph_id: graphId, layout_id: layoutId, subject_id: newId, attribute: 'position.y', value: String(y), value_kind: 'number' },
          { graph_id: graphId, layout_id: layoutId, subject_id: newId, attribute: 'pinned', value: 'true', value_kind: 'string' },
        );
      }
      if (presentationRecords.length > 0) {
        tasks.push(viewAPI.graphPresentationSetBulk(presentationRecords));
      }
    }

    await Promise.all(tasks);
    setForgeToast(`已展开「${substanceLibrary.get(refSubstanceId)?.label ?? refSubstanceId}」(${snapshot.geometries.length} 项)`);
    setTimeout(() => setForgeToast(null), 3500);
  };

  // ── B4.5 库 Tab：重命名 / 删除 user substance ──
  const handleRenameUserSubstance = async (substanceId: string, newLabel: string) => {
    try {
      // 先在内存里改
      const existing = substanceLibrary.get(substanceId);
      if (!existing) return;
      const updated = { ...existing, label: newLabel };
      // 写 DB（label + data 同步）
      await viewAPI.graphUserSubstanceUpdate(substanceId, {
        label: newLabel,
        data: JSON.stringify(updated),
      });
      // 同步 substanceLibrary 和 state
      substanceLibrary.register(updated);  // 同 id 覆盖
      setUserSubstances((prev) =>
        prev.map((s) => (s.id === substanceId ? updated : s)),
      );
      // 触发重载，让节点显示的 substance label 也刷新
      setReloadTrigger((n) => n + 1);
    } catch (err) {
      console.error('[GraphView] rename user substance failed:', err);
      setForgeToast(`重命名失败：${String(err)}`);
      setTimeout(() => setForgeToast(null), 3500);
    }
  };

  // B4.6：从已凝结 substance 的 canvas_snapshot 删除一个几何体
  // （不重新凝结，只改 snapshot；已经展开过的图谱不受影响 — 那些是独立 atom）
  const handleRemoveSnapshotGeometry = async (substanceId: string, originalId: string) => {
    try {
      const existing = substanceLibrary.get(substanceId);
      if (!existing || !existing.canvas_snapshot?.geometries) return;
      const newGeometries = existing.canvas_snapshot.geometries.filter(
        (g) => g.original_id !== originalId,
      );
      if (newGeometries.length === existing.canvas_snapshot.geometries.length) return;  // 没找到
      const updated = {
        ...existing,
        canvas_snapshot: {
          ...existing.canvas_snapshot,
          geometries: newGeometries,
        },
      };
      // 写 DB（仅更新 data，label 不变）
      await viewAPI.graphUserSubstanceUpdate(substanceId, {
        data: JSON.stringify(updated),
      });
      // 同步 substanceLibrary 和 state
      substanceLibrary.register(updated);
      setUserSubstances((prev) => prev.map((s) => (s.id === substanceId ? updated : s)));
    } catch (err) {
      console.error('[GraphView] remove snapshot geometry failed:', err);
      setForgeToast(`删除失败：${String(err)}`);
      setTimeout(() => setForgeToast(null), 3500);
    }
  };

  const handleDeleteUserSubstance = async (substanceId: string) => {
    try {
      await viewAPI.graphUserSubstanceDelete(substanceId);
      substanceLibrary.unregister(substanceId);
      setUserSubstances((prev) => prev.filter((s) => s.id !== substanceId));
      // 触发重载，让引用此 substance 的节点显示兜底视觉
      setReloadTrigger((n) => n + 1);
      setForgeToast(`已删除`);
      setTimeout(() => setForgeToast(null), 2500);
    } catch (err) {
      console.error('[GraphView] delete user substance failed:', err);
      setForgeToast(`删除失败：${String(err)}`);
      setTimeout(() => setForgeToast(null), 3500);
    }
  };

  // ── B4.3 画板凝结：选区 → user_substance ──
  // 用户在 Inspector 节点 Tab 点"凝结为 Substance"按钮 → 走这里
  // 1. 收集选区几何体的 substance + 视觉 override + 相对位置
  // 2. 拼 Substance 对象（含 canvas_snapshot）
  // 3. 写 user_substance 表 + 运行时 register 到 substanceLibrary
  // 4. setForgeToast 提示成功
  const handleForgeSubstance = async (geometryIds: string[]) => {
    const graphId = activeGraphIdRef.current;
    const layoutId = activeLayoutRef.current;
    if (!graphId || geometryIds.length === 0) return;

    try {
      // 收集选区数据
      const selectedGeoms = graphAtoms.geometries.filter((g) => geometryIds.includes(g.id));
      if (selectedGeoms.length === 0) return;

      // 算选区中心（仅含 point，line/surface 由 members 派生位置）
      const positions = new Map<string, { x: number; y: number }>();
      for (const p of graphAtoms.presentations) {
        if (!geometryIds.includes(p.subject_id)) continue;
        if (!isInLayoutFamily(p.layout_id, layoutId)) continue;
        const cur = positions.get(p.subject_id) ?? { x: 0, y: 0 };
        if (p.attribute === 'position.x') cur.x = parseFloat(p.value);
        else if (p.attribute === 'position.y') cur.y = parseFloat(p.value);
        positions.set(p.subject_id, cur);
      }
      let cx = 0, cy = 0, n = 0;
      for (const pos of positions.values()) {
        cx += pos.x; cy += pos.y; n++;
      }
      if (n > 0) { cx /= n; cy /= n; }

      // 拼 SnapshotGeometry 列表
      const snapshotGeometries = selectedGeoms.map((g) => {
        const subAtom = graphAtoms.intensions.find(
          (a) => a.subject_id === g.id && a.predicate === 'substance',
        );
        const labelAtom = graphAtoms.intensions.find(
          (a) => a.subject_id === g.id && a.predicate === 'label',
        );
        const overrides: Record<string, string> = {};
        for (const p of graphAtoms.presentations) {
          if (p.subject_id !== g.id) continue;
          if (!isInLayoutFamily(p.layout_id, layoutId)) continue;
          // 跳过位置、pinned 类（由 relative_position 单独承载）
          if (p.attribute === 'position.x' || p.attribute === 'position.y' || p.attribute === 'position.z') continue;
          if (p.attribute === 'pinned') continue;
          if (p.attribute.startsWith('label_bbox.')) continue;
          overrides[p.attribute] = p.value;
        }
        const pos = positions.get(g.id);
        return {
          original_id: g.id,
          kind: g.kind,
          members: g.members && g.members.length > 0 ? g.members : undefined,
          substance: subAtom ? String(subAtom.value) : undefined,
          label: labelAtom ? String(labelAtom.value) : undefined,
          visual_overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
          relative_position: pos ? { x: pos.x - cx, y: pos.y - cy } : undefined,
        };
      });

      // 拼 Substance 对象
      const newSubstanceId = `user/forged-${Date.now().toString(36)}`;
      const labelN = (await viewAPI.graphUserSubstanceList()).length + 1;
      const newLabel = `未命名 Substance ${labelN}`;
      const newSubstance = {
        id: newSubstanceId,
        label: newLabel,
        description: `从画板凝结于 ${new Date().toLocaleString()}`,
        origin: 'user' as const,
        canvas_snapshot: {
          layout_id: layoutId,
          layout_params: layoutOptions,
          geometries: snapshotGeometries,
        },
      };

      // 写 DB + 运行时 register + 同步 state
      await viewAPI.graphUserSubstanceCreate({
        substance_id: newSubstanceId,
        label: newLabel,
        data: JSON.stringify(newSubstance),
      });
      substanceLibrary.register(newSubstance);
      setUserSubstances((prev) => [...prev, newSubstance]);

      // Toast 提示
      setForgeToast(`已凝结为「${newLabel}」`);
      setTimeout(() => setForgeToast(null), 3500);
    } catch (err) {
      console.error('[GraphView] forge substance failed:', err);
      setForgeToast(`凝结失败：${String(err)}`);
      setTimeout(() => setForgeToast(null), 3500);
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
        onForgeSubstance={handleForgeSubstance}
        userSubstances={userSubstances}
        onRenameUserSubstance={handleRenameUserSubstance}
        onDeleteUserSubstance={handleDeleteUserSubstance}
        onRemoveSnapshotGeometry={handleRemoveSnapshotGeometry}
      />
      {/* B4.3 凝结操作反馈 toast */}
      {forgeToast && (
        <div style={forgeToastStyle}>{forgeToast}</div>
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

// B4.3 凝结操作反馈 toast
const forgeToastStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 50,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(20, 20, 22, 0.95)',
  color: '#e8eaed',
  fontSize: 12,
  padding: '8px 16px',
  borderRadius: 4,
  border: '1px solid #3b82f6',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  zIndex: 20,
  pointerEvents: 'none',
};
