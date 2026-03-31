import { useState, useEffect, useCallback } from 'react';
import type { WorkspaceState } from '../../shared/types';

/** Shell API（由 preload 注入） */
declare const shellAPI: {
  listWorkspaces: () => Promise<{ workspaces: WorkspaceState[]; activeId: string | null }>;
  createWorkspace: () => Promise<WorkspaceState>;
  switchWorkspace: (id: string) => Promise<void>;
  closeWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, label: string) => Promise<void>;
  toggleNavSide: () => Promise<void>;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
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

  const handleCreate = useCallback(() => shellAPI.createWorkspace(), []);
  const handleSwitch = useCallback((id: string) => shellAPI.switchWorkspace(id), []);
  const handleClose = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    shellAPI.closeWorkspace(id);
  }, []);


  return (
    <div style={styles.bar}>
      {/* Workspace Tabs + Create Button */}
      <div style={styles.tabs}>
        {state.workspaces.map((ws) => (
          <div
            key={ws.id}
            style={{
              ...styles.tab,
              ...(ws.id === state.activeId ? styles.tabActive : {}),
            }}
            onClick={() => handleSwitch(ws.id)}
          >
            <span style={styles.tabLabel}>{ws.label}</span>
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
    WebkitAppRegion: 'drag' as unknown as string,
    userSelect: 'none',
  },
  tabs: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    gap: '2px',
    padding: '0 8px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    height: '28px',
    borderRadius: '6px',
    background: '#2a2a2a',
    color: '#999',
    fontSize: '12px',
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag' as unknown as string,
    maxWidth: '180px',
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
    WebkitAppRegion: 'no-drag' as unknown as string,
    flexShrink: 0,
  },
};
