import { useState, useEffect, useCallback, useRef } from 'react';
import type { WorkspaceState } from '../../shared/types';

/** Shell API（由 preload 注入） */
declare const shellAPI: {
  listWorkspaces: () => Promise<{ workspaces: WorkspaceState[]; activeId: string | null }>;
  createWorkspace: () => Promise<WorkspaceState>;
  switchWorkspace: (id: string) => Promise<void>;
  closeWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, label: string) => Promise<void>;
  reorderWorkspaces: (ids: string[]) => Promise<void>;
  toggleNavSide: () => Promise<void>;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  onProgressStart: (callback: (payload: unknown) => void) => () => void;
  onProgressUpdate: (callback: (payload: unknown) => void) => () => void;
  onProgressDone: (callback: (payload: unknown) => void) => () => void;
};

interface WorkspaceBarState {
  workspaces: WorkspaceState[];
  activeId: string | null;
}

export function WorkspaceBar() {
  const [state, setState] = useState<WorkspaceBarState>({
    workspaces: [],
    activeId: null,
  });

  // 双击重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 初始加载 + 状态监听
  useEffect(() => {
    shellAPI.listWorkspaces().then((data) => {
      setState({ workspaces: data.workspaces, activeId: data.activeId });
    });

    const unsubscribe = shellAPI.onStateChanged((data: unknown) => {
      const d = data as { workspaces: WorkspaceState[]; activeId: string | null };
      setState({ workspaces: d.workspaces, activeId: d.activeId });
    });

    return unsubscribe;
  }, []);

  // 重命名自动聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // 拖拽排序
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(id);
  }, [dragId]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;

    const ids = state.workspaces.map((ws) => ws.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;

    // 移动
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    shellAPI.reorderWorkspaces(ids);

    setDragId(null);
    setDropTargetId(null);
  }, [dragId, state.workspaces]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTargetId(null);
  }, []);

  const handleCreate = useCallback(() => shellAPI.createWorkspace(), []);
  const handleSwitch = useCallback((id: string) => shellAPI.switchWorkspace(id), []);
  const handleClose = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    shellAPI.closeWorkspace(id);
  }, []);

  const startRename = useCallback((ws: WorkspaceState) => {
    setRenamingId(ws.id);
    setRenameValue(ws.label);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      shellAPI.renameWorkspace(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  return (
    <div style={styles.bar}>
      {/* Workspace Tabs + Create Button */}
      <div style={styles.tabs}>
        {state.workspaces.map((ws) => (
          <div
            key={ws.id}
            draggable={renamingId !== ws.id}
            onDragStart={(e) => handleDragStart(e, ws.id)}
            onDragOver={(e) => handleDragOver(e, ws.id)}
            onDrop={(e) => handleDrop(e, ws.id)}
            onDragEnd={handleDragEnd}
            style={{
              ...styles.tab,
              ...(ws.id === state.activeId ? styles.tabActive : {}),
              ...(dragId === ws.id ? { opacity: 0.4 } : {}),
              ...(dropTargetId === ws.id ? { borderLeft: '2px solid #4a9eff' } : {}),
            }}
            onClick={() => handleSwitch(ws.id)}
            onDoubleClick={(e) => { e.stopPropagation(); startRename(ws); }}
          >
            {renamingId === ws.id ? (
              <input
                ref={renameInputRef}
                style={styles.renameInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span style={styles.tabLabel}>{ws.label}</span>
            )}
            <button
              style={styles.closeButton}
              onClick={(e) => handleClose(ws.id, e)}
            >
              ×
            </button>
          </div>
        ))}
        <button style={styles.createButton} onClick={handleCreate} title="New Workspace">
          +
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: '36px',
    background: '#1e1e1e',
    borderBottom: '1px solid #333',
    WebkitAppRegion: 'drag',
    userSelect: 'none',
  },
  tabs: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    gap: '1px',
    padding: 0,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    height: '28px',
    borderRadius: 0,
    background: '#2a2a2a',
    color: '#999',
    fontSize: '12px',
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag',
    maxWidth: '220px',
  },
  tabActive: {
    background: '#3a3a3a',
    color: '#e8eaed',
  },
  tabLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  renameInput: {
    flex: 1,
    background: '#1e1e1e',
    border: '1px solid #4a9eff',
    borderRadius: '3px',
    color: '#e8eaed',
    fontSize: '12px',
    padding: '1px 4px',
    outline: 'none',
    maxWidth: '160px',
  },
  closeButton: {
    marginLeft: '6px',
    width: '16px',
    height: '16px',
    border: 'none',
    background: 'transparent',
    color: '#666',
    fontSize: '14px',
    cursor: 'pointer',
    lineHeight: '14px',
    padding: 0,
  },
  createButton: {
    width: '28px',
    height: '28px',
    border: 'none',
    background: 'transparent',
    color: '#999',
    fontSize: '18px',
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag',
    flexShrink: 0,
  },
};
