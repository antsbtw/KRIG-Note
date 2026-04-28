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
import { substanceLibrary } from '../../substance';

export interface LibraryInspectorTabProps {
  /** GraphView 维护的 user 层 substance 列表 */
  userSubstances: Substance[];
  onRename: (substanceId: string, newLabel: string) => Promise<void>;
  onDelete: (substanceId: string) => Promise<void>;
  /** B4.6：从 substance 的 canvas_snapshot 中删除一个几何体（按 original_id） */
  onRemoveSnapshotGeometry: (substanceId: string, originalId: string) => Promise<void>;
}

export function LibraryInspectorTab({
  userSubstances,
  onRename,
  onDelete,
  onRemoveSnapshotGeometry,
}: LibraryInspectorTabProps) {
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
          onRemoveSnapshotGeometry={(originalId) => onRemoveSnapshotGeometry(s.id, originalId)}
        />
      ))}
      <div style={hintStyle}>双击重命名 · ▸ 展开内容 · 悬停显示删除按钮</div>
    </div>
  );
}

function SubstanceItem({
  substance,
  onRename,
  onDelete,
  onRemoveSnapshotGeometry,
}: {
  substance: Substance;
  onRename: (newLabel: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onRemoveSnapshotGeometry: (originalId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(substance.label);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const snapshot = substance.canvas_snapshot;
  const geometries = snapshot?.geometries ?? [];
  const geomCount = geometries.length;

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
      style={itemContainerStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={itemStyle}>
        {geomCount > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={expandButtonStyle}
            title={expanded ? '收起' : '展开'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
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
      {expanded && geomCount > 0 && (
        <div style={snapshotDetailStyle}>
          {geometries.map((g) => (
            <SnapshotGeometryRow
              key={g.original_id}
              geometry={g}
              onRemove={() => onRemoveSnapshotGeometry(g.original_id)}
              canRemove={geomCount > 1}
            />
          ))}
          <div style={snapshotMetaStyle}>
            layout: <span style={{ color: '#888' }}>{snapshot?.layout_id ?? '?'}</span>
            {snapshot?.layout_params && Object.keys(snapshot.layout_params).length > 0 && (
              <> · params: <span style={{ color: '#888' }}>{Object.keys(snapshot.layout_params).length}</span></>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SnapshotGeometryRow({
  geometry,
  onRemove,
  canRemove,
}: {
  geometry: NonNullable<Substance['canvas_snapshot']>['geometries'] extends (infer T)[] | undefined ? T : never;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const sub = geometry.substance ? substanceLibrary.get(geometry.substance) : undefined;
  const subLabel = sub?.label ?? geometry.substance ?? '(未指定)';

  const handleRemove = () => {
    if (!canRemove) {
      window.alert('至少要保留 1 个几何体');
      return;
    }
    if (window.confirm('从 substance 删除此几何体？此操作不可恢复。')) {
      onRemove();
    }
  };

  return (
    <div
      style={snapshotGeomRowStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={snapshotGeomKindStyle}>{KIND_ICONS[geometry.kind] ?? '?'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={snapshotGeomLabelStyle}>
          {geometry.label || subLabel}
        </div>
        {geometry.label && (
          <div style={snapshotGeomMetaStyle}>{subLabel}</div>
        )}
      </div>
      {hovered && (
        <button onClick={handleRemove} style={snapshotGeomRemoveStyle} title="从 substance 删除">
          ✕
        </button>
      )}
    </div>
  );
}

const KIND_ICONS: Record<string, string> = {
  point: '●',
  line: '─',
  surface: '▭',
  volume: '◧',
};

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

const itemContainerStyle: React.CSSProperties = {
  background: '#0f0f10',
  borderRadius: 3,
  overflow: 'hidden',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
};

const expandButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#888',
  fontSize: 11,
  cursor: 'pointer',
  padding: '0 2px',
  outline: 'none',
  flexShrink: 0,
};

const snapshotDetailStyle: React.CSSProperties = {
  padding: '4px 8px 8px 22px',
  background: '#0a0a0b',
  borderTop: '1px solid #1a1a1c',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const snapshotGeomRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  borderRadius: 2,
  fontSize: 11,
};

const snapshotGeomKindStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  width: 14,
  textAlign: 'center',
};

const snapshotGeomLabelStyle: React.CSSProperties = {
  color: '#bbb',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const snapshotGeomMetaStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 10,
  marginTop: 1,
};

const snapshotGeomRemoveStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#f87171',
  fontSize: 11,
  cursor: 'pointer',
  padding: '0 4px',
  outline: 'none',
};

const snapshotMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  marginTop: 6,
  paddingTop: 4,
  borderTop: '1px solid #1a1a1c',
  fontFamily: 'monospace',
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
