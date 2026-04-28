/**
 * 画板 Tab 内容（B4.2.a 框架占位 → 第 4 步填）。
 *
 * 编辑全图属性：方向 / 间距 / 边样式 / ...
 * 数据流：用户点按钮 → onSetLayoutOption 写 atom → 上层 reload。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md §3.2
 */

export interface CanvasInspectorTabProps {
  graphId: string;
  layoutId: string;
  onSetLayoutOption: (attribute: string, value: string) => Promise<void>;
}

export function CanvasInspectorTab(_props: CanvasInspectorTabProps) {
  return (
    <div style={{ color: '#666', fontSize: 12, padding: '20px 0', textAlign: 'center', fontStyle: 'italic' }}>
      画板 Tab 内容（第 4 步实装）
    </div>
  );
}
