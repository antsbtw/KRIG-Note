import { useEffect, useState } from 'react';

/**
 * GraphView — 知识图谱视图。
 *
 * v1.4 graph-import 重构期占位状态（D2 一刀切完成）：
 *   - 旧 v1.3 渲染管线（BasicEngine + GraphNodeRecord/EdgeRecord + graphLoadData/graphNodeSave/...）
 *     已**全部删除**（无技术债，无兼容包袱）
 *   - 新四态数据模型（graph_geometry + graph_intension_atom + graph_presentation_atom）
 *     + Substance Library + LayoutEngine 待 D9-D10 接入
 *   - 期间 GraphView 仅显示占位界面，告知用户重构进度
 *
 * 待恢复功能（D9-D10）：
 *   - 接入 viewAPI.graphLoadFull → 渲染 geometries
 *   - 接入 LayoutEngine 算位置
 *   - 接入 Substance Library 渲染合成
 *   - 拖动写 presentation atom（pinned + position.*）
 *   - GraphToolbar：layout 切换 / reset
 */

declare const viewAPI: {
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
};

export function GraphView() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);

  useEffect(() => {
    const unsub1 = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeGraphId !== undefined) setActiveGraphId(state.activeGraphId);
    });
    const unsub2 = viewAPI.onGraphActiveChanged((graphId) => {
      setActiveGraphId(graphId);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

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
          background: '#1e1e1e',
        }}
      >
        <div style={{ fontSize: 32 }}>🕸</div>
        <div style={{ fontSize: 14 }}>GraphView</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>从左侧选择或新建一个图</div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#1e1e1e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        userSelect: 'none',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
      <div style={{ fontSize: 14, marginBottom: 4, color: '#ccc' }}>GraphView 重构中</div>
      <div style={{ fontSize: 12, opacity: 0.7, textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
        v1.4 graph-import 数据模型重构（四态分立）已切换。
        渲染层正在接入新数据流（D9-D10）。
      </div>
      <div style={{ fontSize: 11, opacity: 0.4, marginTop: 16 }}>
        active graph: {activeGraphId}
      </div>
    </div>
  );
}
