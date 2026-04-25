import { useCallback, useEffect, useState } from 'react';

interface GraphListItem {
  id: string;
  title: string;
  variant: string;
  host_note_id: string | null;
  updated_at: number;
}

declare const navSideAPI: {
  graphList: () => Promise<GraphListItem[]>;
  graphCreate: (title?: string, hostNoteId?: string | null) => Promise<GraphListItem | null>;
  graphRename: (id: string, title: string) => Promise<void>;
  graphDelete: (id: string) => Promise<void>;
  graphSetActive: (id: string | null) => Promise<void>;
  onGraphListChanged: (cb: (list: GraphListItem[]) => void) => () => void;
  onGraphActiveChanged: (cb: (graphId: string | null) => void) => () => void;
  onRestoreWorkspaceState: (cb: (state: { activeGraphId?: string | null }) => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (cb: () => void) => () => void;
  closeRightSlot: () => Promise<void>;
};

const VARIANT_ICONS: Record<string, string> = {
  knowledge: '🕸',
  bpmn: '🔀',
  mindmap: '🌿',
  timeline: '⏱',
  canvas: '🖼',
  basic: '⚪',
};

export function GraphPanel() {
  const [list, setList] = useState<GraphListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 初始拉取列表
  // 注：GraphPanel mount 时 SurrealDB 可能还没 ready，main 端 GRAPH_LIST handler
  // 在 db 未 ready 时 return []，所以第一次拉取可能返回空。需要监听 db:ready
  // 在 db 真正 ready 后重新拉一次。
  useEffect(() => {
    const fetchList = () => {
      navSideAPI.graphList().then(setList).catch(() => {});
    };
    fetchList();  // 立刻试一次（db ready 时直接拿到）
    const unsubDBReady = navSideAPI.onDBReady(fetchList);  // db ready 时再拉一次（兜底）
    const unsubChanged = navSideAPI.onGraphListChanged(setList);
    return () => { unsubDBReady(); unsubChanged(); };
  }, []);

  // 同步 workspace 的 activeGraphId
  // - workspace 切换/恢复时走 RESTORE_WORKSPACE_STATE
  // - 同 workspace 内 set-active 时走 GRAPH_ACTIVE_CHANGED
  useEffect(() => {
    const unsub1 = navSideAPI.onRestoreWorkspaceState((state) => {
      if (state.activeGraphId !== undefined) setActiveId(state.activeGraphId);
    });
    const unsub2 = navSideAPI.onGraphActiveChanged((graphId) => {
      setActiveId(graphId);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  const handleOpen = useCallback(async (id: string) => {
    await navSideAPI.closeRightSlot();
    await navSideAPI.graphSetActive(id);
    setActiveId(id);
  }, []);

  const handleStartRename = useCallback((item: GraphListItem) => {
    setRenamingId(item.id);
    setRenameValue(item.title);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId) return;
    const next = renameValue.trim();
    const cur = list.find((g) => g.id === renamingId);
    if (next && cur && next !== cur.title) {
      await navSideAPI.graphRename(renamingId, next);
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, list]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认删除此图？该操作不可撤销。')) return;
    await navSideAPI.graphDelete(id);
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '4px 0', userSelect: 'none' }}>
      {list.length === 0 && (
        <div style={{ padding: '12px 16px', fontSize: 12, color: '#666' }}>
          暂无图谱。点击上方"+ 新建"创建第一个图。
        </div>
      )}

      {list.map((item) => {
        const isActive = item.id === activeId;
        const isRenaming = item.id === renamingId;
        return (
          <div
            key={item.id}
            onClick={() => !isRenaming && handleOpen(item.id)}
            onDoubleClick={() => handleStartRename(item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              cursor: isRenaming ? 'text' : 'pointer',
              background: isActive ? '#2a2a2a' : 'transparent',
              color: isActive ? '#e0e0e0' : '#bbb',
              fontSize: 13,
            }}
            onMouseEnter={(e) => { if (!isActive && !isRenaming) (e.currentTarget as HTMLDivElement).style.background = '#252525'; }}
            onMouseLeave={(e) => { if (!isActive && !isRenaming) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <span style={{ fontSize: 14, opacity: 0.85 }}>{VARIANT_ICONS[item.variant] ?? '🕸'}</span>
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  background: '#1e1e1e',
                  color: '#e0e0e0',
                  border: '1px solid #555',
                  borderRadius: 3,
                  padding: '2px 6px',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            ) : (
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title || '未命名图谱'}
              </span>
            )}
            {!isRenaming && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                title="删除"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '0 4px',
                  visibility: isActive ? 'visible' : 'hidden',
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
