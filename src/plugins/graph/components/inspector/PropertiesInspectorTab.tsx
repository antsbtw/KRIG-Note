/**
 * 属性 Tab — 选中点/边的语义属性编辑（占位）。
 *
 * 与"布局 Tab"分工：
 *   布局   视觉相关（substance / 形状 / 颜色 / 尺寸 / 位置 …）
 *   属性   语义相关（label 文本 / intension predicates / 备注 …）
 *
 * 当前为占位实现，待后续按需展开 Label 编辑、intension atom CRUD 等。
 */

export interface PropertiesInspectorTabProps {
  selectedIds: ReadonlySet<string>;
}

export function PropertiesInspectorTab({ selectedIds }: PropertiesInspectorTabProps) {
  if (selectedIds.size === 0) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
        <div>点击节点或边以编辑</div>
      </div>
    );
  }

  return (
    <div style={placeholderStyle}>
      属性编辑（label 文本 / intension）即将上线
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 12,
  textAlign: 'center',
  padding: '24px 0',
};

const placeholderStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 12,
  fontStyle: 'italic',
  textAlign: 'center',
  padding: '24px 0',
};
