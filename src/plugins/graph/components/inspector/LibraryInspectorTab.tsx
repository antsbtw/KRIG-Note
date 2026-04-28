/**
 * 库 Tab — 浏览/管理 user 层 substance（B4.5）。
 *
 * 当前显示：
 *   - user_substance 列表（label + 简短 id + 凝结的几何体数量）
 *   - 双击 label inline 重命名
 *   - 悬停显示删除按钮（confirm 后删除）
 *
 * 数据来源：GraphView 维护 userSubstances 中央 state，凝结/删除时触发刷新。
 */
import { useState } from 'react';
import type { Substance } from '../../substance/types';

export interface LibraryInspectorTabProps {
  /** GraphView 维护的 user 层 substance 列表 */
  userSubstances: Substance[];
  onRename: (substanceId: string, newLabel: string) => Promise<void>;
  onDelete: (substanceId: string) => Promise<void>;
}

export function LibraryInspectorTab({ userSubstances, onRename, onDelete }: LibraryInspectorTabProps) {
  if (userSubstances.length === 0) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📚</div>
        <div>暂无凝结的 substance</div>
        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
          在节点 Tab 选中节点 → 点 ⬢ 凝结按钮
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={countStyle}>共 {userSubstances.length} 个</div>
      {userSubstances.map((s) => (
        <SubstanceItem
          key={s.id}
          substance={s}
          onRename={(newLabel) => onRename(s.id, newLabel)}
          onDelete={() => onDelete(s.id)}
        />
      ))}
      <div style={hintStyle}>双击重命名 · 悬停显示删除按钮</div>
    </div>
  );
}

function SubstanceItem({
  substance,
  onRename,
  onDelete,
}: {
  substance: Substance;
  onRename: (newLabel: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(substance.label);
  const [hovered, setHovered] = useState(false);

  const geomCount = substance.canvas_snapshot?.geometries?.length ?? 0;

  const commit = () => {
    setEditing(false);
    if (draft.trim() === '' || draft === substance.label) {
      setDraft(substance.label);
      return;
    }
    void onRename(draft.trim());
  };

  const handleDelete = () => {
    if (window.confirm(`删除「${substance.label}」？此操作不可恢复。`)) {
      void onDelete();
    }
  };

  return (
    <div
      style={itemStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraft(substance.label);
                setEditing(false);
              }
            }}
            style={inputStyle}
          />
        ) : (
          <div onDoubleClick={() => { setDraft(substance.label); setEditing(true); }} style={labelStyle}>
            {substance.label}
          </div>
        )}
        <div style={metaStyle}>
          {geomCount > 0 ? `${geomCount} 个几何体` : '无 snapshot'} · <span style={{ fontFamily: 'monospace' }}>{substance.id.length > 24 ? substance.id.slice(0, 12) + '…' : substance.id}</span>
        </div>
      </div>
      {hovered && !editing && (
        <button onClick={handleDelete} style={deleteButtonStyle} title="删除">
          ✕
        </button>
      )}
    </div>
  );
}

// ── 样式 ──

const emptyStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 12,
  textAlign: 'center',
  padding: '24px 0',
};

const countStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  marginBottom: 4,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  background: '#0f0f10',
  borderRadius: 3,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#e8eaed',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'text',
};

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  marginTop: 2,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#1a1a1c',
  color: '#e8eaed',
  border: '1px solid #3b82f6',
  borderRadius: 3,
  fontSize: 12,
  padding: '2px 6px',
  outline: 'none',
};

const deleteButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#f87171',
  fontSize: 13,
  cursor: 'pointer',
  padding: '0 6px',
  outline: 'none',
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  fontStyle: 'italic',
  marginTop: 8,
  textAlign: 'center',
};
