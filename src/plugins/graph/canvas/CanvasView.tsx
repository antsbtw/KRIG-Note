/// <reference types="vite/client" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { SceneManager } from './scene/SceneManager';
import { NodeRenderer } from './scene/NodeRenderer';
import { HandlesOverlay } from './scene/HandlesOverlay';
import { InteractionController, type AddModeSpec } from './interaction/InteractionController';
import { Toolbar } from './ui/Toolbar/Toolbar';
import { LibraryPicker } from './ui/LibraryPicker/LibraryPicker';
import { FloatingInspector } from './ui/Inspector/FloatingInspector';
import { CreateSubstanceDialog, type CreateSubstanceFormResult } from './ui/dialogs/CreateSubstanceDialog';
import { combineSelectedToSubstance } from './combine';
import { ShapeRegistry } from '../library/shapes';
import { SubstanceRegistry } from '../library/substances';
import { serialize, deserialize, type CanvasDocument } from './persist/serialize';
import type { Instance } from '../library/types';
import type { GraphCanvasRecord } from '../../../shared/types/graph-types';

/**
 * CanvasView — Graph view 主组件(canvas variant)
 *
 * 结构:Toolbar(顶部 36px)+ 全屏 Canvas 容器 + Empty overlay + 浮层(Picker/Inspector/Dialog)
 *
 * 关键约束(对齐 memory):
 * - canvas-container div 始终 mount(empty/canvas 用 overlay 切换),否则
 *   ref 时机错过让 SceneManager 永远不挂(feedback_canvas_container_must_always_render)
 * - SceneManager 内部处理 Retina + ResizeObserver(feedback_threejs_retina_setsize)
 *
 * 持久化(对齐 NoteView pattern):
 * - activeGraphId ref + state 双存:ref 给防抖/竞态同步读取,state 给 render
 * - loadSeqRef 竞态保护:快速切换时丢弃过期的异步结果
 * - flushSave 幂等(清 timer)+ savingRef 去重
 * - scheduleSave 1s 防抖,捕获当时 activeGraphIdRef.current(防抖到点时可能已切)
 * - onGraphOpenInView 切画板:先 flush 旧 → load 新
 */

// 局部 viewAPI 声明(graph 持久化通道)
declare const viewAPI: {
  graphLoad: (id: string) => Promise<GraphCanvasRecord | null>;
  graphSave: (id: string, docContent: unknown, title: string) => Promise<void>;
  graphRename: (id: string, title: string) => Promise<void>;
  graphPendingOpen: () => Promise<string | null>;
  onGraphOpenInView: (callback: (graphId: string) => void) => () => void;
  onGraphDeleted: (callback: (graphId: string) => void) => () => void;
  onGraphTitleChanged: (callback: (data: { graphId: string; title: string }) => void) => () => void;
  closeSelf: () => Promise<void>;
};

const SAVE_DEBOUNCE_MS = 1000;

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const nodeRendererRef = useRef<NodeRenderer | null>(null);
  const handlesOverlayRef = useRef<HandlesOverlay | null>(null);
  const interactionRef = useRef<InteractionController | null>(null);

  // ── 持久化状态 ──
  const activeGraphIdRef = useRef<string | null>(null);
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  // ref + state 双存:flushSave 同步读 ref(防 closure 过期),render 用 state
  const graphTitleRef = useRef<string>('Canvas');
  const [graphTitle, setGraphTitleState] = useState<string>('Canvas');
  const setGraphTitle = useCallback((t: string) => {
    graphTitleRef.current = t;
    setGraphTitleState(t);
  }, []);
  const [dirty, setDirty] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  /** loadGraph 竞态保护:快速切换时丢弃过期的异步结果 */
  const loadSeqRef = useRef(0);
  /** Handle 就绪前到达的 graphId,延迟处理 */
  const pendingGraphIdRef = useRef<string | null>(null);

  // ── Toolbar 显示 state ──
  const [zoomLevel, setZoomLevel] = useState(1);
  const [addMode, setAddMode] = useState<AddModeSpec | null>(null);

  // LibraryPicker 状态(v1 UX 简化:单一 + 添加 入口,无需 section 区分)
  const [pickerState, setPickerState] = useState<{
    open: boolean;
    anchorRect: DOMRect | null;
  }>({ open: false, anchorRect: null });

  // Inspector / 选区
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Inspector 默认隐藏,双击节点才打开;打开后跟随选中切换;× 关闭 */
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [combineDialogOpen, setCombineDialogOpen] = useState(false);

  // ── 持久化函数(放在 useEffect 之前,因为 InteractionController 的 onChange 需要)──

  /** 立即把当前画板内容写盘到指定 graphId。幂等,会清掉 pending timer */
  const flushSave = useCallback(async (targetGraphId: string | null) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const sm = sceneManagerRef.current;
    const nr = nodeRendererRef.current;
    if (!targetGraphId || !sm || !nr) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const doc = serialize(nr, sm);
      await viewAPI.graphSave(targetGraphId, doc, graphTitleRef.current);
      setDirty(false);
    } catch (err) {
      console.error('[CanvasView] save failed:', err);
    } finally {
      savingRef.current = false;
    }
  }, []);

  /** 编辑信号 → 启动 1s 防抖 → 到点 flush 到"当时"的 activeGraphId */
  const scheduleSave = useCallback(() => {
    setDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave(activeGraphIdRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  /** 加载某画板到当前 SceneManager(竞态保护) */
  const loadGraph = useCallback(async (graphId: string) => {
    const sm = sceneManagerRef.current;
    const nr = nodeRendererRef.current;
    if (!sm || !nr) {
      // 渲染基础设施未就绪,暂存,等 useEffect 完成 mount 后再派发
      pendingGraphIdRef.current = graphId;
      return;
    }
    const seq = ++loadSeqRef.current;

    const fallbackToEmpty = (reason: string) => {
      console.warn(`[CanvasView] ${reason} — fallback to empty canvas`);
      nr.clear();
      activeGraphIdRef.current = null;
      setActiveGraphId(null);
      setGraphTitle('Canvas');
    };

    try {
      const record = await viewAPI.graphLoad(graphId);
      if (seq !== loadSeqRef.current) return;
      if (!record) {
        fallbackToEmpty(`Graph ${graphId} not found in DB`);
        return;
      }
      const doc = (record.doc_content ?? null) as CanvasDocument | null;
      if (doc) {
        const result = deserialize(doc, nr, sm);
        if (result.warnings.length > 0) {
          console.warn('[CanvasView] deserialize warnings:', result.warnings);
        }
        if (result.skipped.length > 0) {
          console.warn('[CanvasView] skipped invalid instances:', result.skipped);
        }
      } else {
        nr.clear();
      }
      activeGraphIdRef.current = graphId;
      setActiveGraphId(graphId);
      setGraphTitle(record.title || 'Untitled Canvas');
      setDirty(false);
      // 切画板 reset Inspector(避免上一个画板双击留下的 open=true 残留)
      setInspectorOpen(false);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('[CanvasView] loadGraph failed:', err);
      fallbackToEmpty(`Graph ${graphId} load threw: ${(err as Error)?.message || err}`);
    }
  }, []);

  // ── SceneManager / NodeRenderer / InteractionController 生命周期 ──
  useEffect(() => {
    if (!containerRef.current) return;
    ShapeRegistry.bootstrap();
    SubstanceRegistry.bootstrap();

    const sm = new SceneManager(containerRef.current);
    const nr = new NodeRenderer(sm);
    const handles = new HandlesOverlay(sm);
    const ic = new InteractionController({
      container: containerRef.current,
      sceneManager: sm,
      nodeRenderer: nr,
      handlesOverlay: handles,
      getInstance: (id) => nr.getInstance(id),
      onChange: () => scheduleSave(),
      onAddModeChange: (spec) => setAddMode(spec),
      onSelectionChange: (ids) => {
        setSelectedIds(ids);
        // 选区清空(用户点空白)→ 关 Inspector + 隐藏 handles
        if (ids.length === 0) {
          setInspectorOpen(false);
          handles.setTarget(null);
        } else if (ids.length === 1) {
          // 单选 → 显示该节点的 resize / rotation handles
          const node = nr.get(ids[0]);
          handles.setTarget(node ?? null);
        } else {
          // 多选 → 不显示 handles(M1 范围限制)
          handles.setTarget(null);
        }
      },
      onNodeDoubleClick: () => setInspectorOpen(true),
    });
    sceneManagerRef.current = sm;
    nodeRendererRef.current = nr;
    handlesOverlayRef.current = handles;
    interactionRef.current = ic;

    // 处理 mount 前到达的 pendingGraphId
    const pending = pendingGraphIdRef.current;
    if (pending) {
      pendingGraphIdRef.current = null;
      void loadGraph(pending);
    }
    // 没有持久化 graph 时,canvas 保持空白,empty overlay 显示提示;
    // dev fixture 已删除(M1.5b.6 接通真实持久化后不再需要)

    // Zoom 显示:轮询 sceneManager.getView().zoom,取整变化才 setState
    let lastReported = -1;
    const zoomTimer = window.setInterval(() => {
      const cur = sm.getView();
      if (cur.zoom <= 0) return;
      const pct = Math.round(cur.zoom * 100);
      if (pct === lastReported) return;
      lastReported = pct;
      setZoomLevel(cur.zoom);
    }, 150);

    return () => {
      // unmount 前 flush pending save 到旧 graphId
      void flushSave(activeGraphIdRef.current);
      window.clearInterval(zoomTimer);
      ic.dispose();
      handles.dispose();
      nr.clear();
      sm.dispose();
      sceneManagerRef.current = null;
      nodeRendererRef.current = null;
      handlesOverlayRef.current = null;
      interactionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Graph 打开 / 删除 / 标题变更 监听 ──
  useEffect(() => {
    // 启动时拉一次 pending(NavSide create-canvas 可能在 view 之前)
    void viewAPI.graphPendingOpen().then((id) => {
      if (id) void loadGraph(id);
    }).catch(() => { /* ignore */ });

    const unsubOpen = viewAPI.onGraphOpenInView(async (graphId) => {
      // 切画板前 flush 旧 graphId 的 pending save
      const prevId = activeGraphIdRef.current;
      if (prevId && prevId !== graphId) {
        await flushSave(prevId);
      } else if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setDirty(false);
      await loadGraph(graphId);
    });

    const unsubDeleted = viewAPI.onGraphDeleted((graphId) => {
      if (activeGraphIdRef.current === graphId) {
        // 当前画板被删:清空显示
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        nodeRendererRef.current?.clear();
        activeGraphIdRef.current = null;
        setActiveGraphId(null);
        setGraphTitle('Canvas');
        setDirty(false);
      }
    });

    const unsubTitle = viewAPI.onGraphTitleChanged((data) => {
      if (data.graphId === activeGraphIdRef.current) {
        setGraphTitle(data.title);
      }
    });

    return () => {
      unsubOpen();
      unsubDeleted();
      unsubTitle();
    };
  }, [loadGraph, flushSave]);

  // ── Toolbar 回调 ──
  const handleAdd = useCallback((anchorRect: DOMRect) => {
    setPickerState({ open: true, anchorRect });
  }, []);
  const handleFit = useCallback(() => {
    nodeRendererRef.current?.fitAll();
  }, []);
  const handleClose = useCallback(() => {
    void flushSave(activeGraphIdRef.current);
    void viewAPI.closeSelf();
  }, [flushSave]);

  // ── LibraryPicker 回调 ──
  const handlePickerPick = useCallback((spec: AddModeSpec) => {
    setPickerState((s) => ({ ...s, open: false }));
    interactionRef.current?.enterAddMode(spec);
  }, []);
  const handlePickerClose = useCallback(() => {
    setPickerState((s) => ({ ...s, open: false }));
  }, []);

  // ── Inspector ──
  const handleInstanceUpdate = useCallback((id: string, patch: Partial<Instance>) => {
    const nr = nodeRendererRef.current;
    if (!nr) return;
    const inst = nr.getInstance(id);
    if (!inst) return;
    const merged: Instance = {
      ...inst,
      ...patch,
      style_overrides: patch.style_overrides
        ? {
            ...inst.style_overrides,
            ...patch.style_overrides,
          }
        : inst.style_overrides,
    };
    nr.update(merged);
    // update 替换了 RenderedNode 对象,HandlesOverlay 持有旧引用 → 重新 setTarget
    const handles = handlesOverlayRef.current;
    if (handles && handles.getTarget()?.instanceId === id) {
      handles.setTarget(nr.get(id) ?? null);
    }
    scheduleSave();
  }, [scheduleSave]);

  const handleInstanceGet = useCallback(
    (id: string) => nodeRendererRef.current?.getInstance(id),
    [],
  );

  // ── Combine to Substance ──
  const handleOpenCombine = useCallback(() => {
    if (selectedIds.length < 2) return;
    setCombineDialogOpen(true);
  }, [selectedIds]);

  const handleCombineCreate = useCallback(
    (form: CreateSubstanceFormResult) => {
      const nr = nodeRendererRef.current;
      const ic = interactionRef.current;
      if (!nr || !ic) return;
      const result = combineSelectedToSubstance(nr, {
        selectedIds,
        name: form.name,
        category: form.category,
        description: form.description,
      });
      setCombineDialogOpen(false);
      if (!result) {
        console.warn('[Canvas] Combine failed: no eligible shape instances');
        return;
      }
      ic.setSelection([result.newInstanceId]);
      scheduleSave();
    },
    [selectedIds, scheduleSave],
  );

  const handleCombineCancel = useCallback(() => {
    setCombineDialogOpen(false);
  }, []);

  const hasActiveGraph = activeGraphId !== null;

  return (
    <div style={styles.container}>
      <Toolbar
        title={graphTitle + (dirty ? ' •' : '')}
        zoomLevel={zoomLevel}
        addModeRef={addMode?.ref ?? null}
        multiSelected={selectedIds.length >= 2}
        onAdd={handleAdd}
        onFit={handleFit}
        onCombine={handleOpenCombine}
        onClose={handleClose}
      />

      {/* Canvas 容器始终 mount;empty 时 overlay 提示 */}
      <div style={styles.canvasWrap}>
        <div ref={containerRef} style={styles.canvasContainer} />
        {!hasActiveGraph && (
          <div style={styles.emptyOverlay}>
            <div style={styles.emptyIcon}>🎨</div>
            <div style={styles.emptyText}>请从左侧选择或新建画板</div>
            <div style={styles.emptyHint}>NavSide 顶部 · + 画板</div>
          </div>
        )}
      </div>

      {/* Library Picker 浮层 */}
      <LibraryPicker
        open={pickerState.open}
        anchorRect={
          pickerState.anchorRect
            ? {
                left: pickerState.anchorRect.left,
                top: pickerState.anchorRect.top,
                width: pickerState.anchorRect.width,
                height: pickerState.anchorRect.height,
              }
            : null
        }
        onPick={handlePickerPick}
        onClose={handlePickerClose}
      />

      {/* Floating Inspector(浮层,默认隐藏,双击节点才打开;× 关闭) */}
      <FloatingInspector
        open={inspectorOpen}
        selectedIds={selectedIds}
        getInstance={handleInstanceGet}
        onUpdate={handleInstanceUpdate}
        onClose={() => setInspectorOpen(false)}
        onCombine={handleOpenCombine}
      />

      {/* Combine to Substance 对话框 */}
      <CreateSubstanceDialog
        open={combineDialogOpen}
        defaultName={`Substance ${selectedIds.length} items`}
        onCreate={handleCombineCreate}
        onCancel={handleCombineCancel}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--krig-bg-base)',
    color: 'var(--krig-text-primary)',
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
  emptyOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    background: 'var(--krig-bg-base)',
    zIndex: 5,
    pointerEvents: 'none',  // 不挡画布,避免 SceneManager mount 受影响
  },
  emptyIcon: {
    fontSize: 56,
    opacity: 0.4,
  },
  emptyText: {
    fontSize: 14,
    color: 'var(--krig-text-muted)',
  },
  emptyHint: {
    fontSize: 12,
    color: 'var(--krig-text-faint)',
    marginTop: 4,
  },
};
