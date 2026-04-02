import { useState, useEffect, useCallback } from 'react';
import type { WorkModeRegistration } from '../../shared/types';

/** NavSide API（由 preload 注入） */
interface NoteListItem {
  id: string;
  title: string;
  updated_at: number;
}

declare const navSideAPI: {
  listWorkModes: () => Promise<WorkModeRegistration[]>;
  switchWorkMode: (id: string) => Promise<void>;
  toggle: () => Promise<void>;
  openRightSlot: (workModeId: string) => Promise<void>;
  closeRightSlot: () => Promise<void>;
  noteCreate: (title?: string) => Promise<unknown>;
  noteList: () => Promise<NoteListItem[]>;
  noteDelete: (id: string) => Promise<void>;
  onNoteListChanged: (callback: (list: NoteListItem[]) => void) => () => void;
  onDBReady: (callback: () => void) => () => void;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  resizeStart: (screenX: number) => void;
  resizeMove: (screenX: number) => void;
  resizeEnd: () => void;
};

export function NavSide() {
  const [modes, setModes] = useState<WorkModeRegistration[]>([]);
  const [activeWorkModeId, setActiveWorkModeId] = useState<string>('');
  const [noteList, setNoteList] = useState<NoteListItem[]>([]);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    navSideAPI.listWorkModes().then(setModes);

    const unsubscribe = navSideAPI.onStateChanged((data: unknown) => {
      const d = data as { active?: { workModeId: string } };
      if (d.active) {
        setActiveWorkModeId(d.active.workModeId);
      }
    });

    // 监听 NoteFile 列表变更
    const unsubNoteList = navSideAPI.onNoteListChanged((list: NoteListItem[]) => {
      setNoteList(list);
    });

    // 监听 SurrealDB 就绪
    const unsubDB = navSideAPI.onDBReady(() => {
      setDbReady(true);
      navSideAPI.noteList().then(setNoteList);
    });

    return () => { unsubscribe(); unsubNoteList(); unsubDB(); };
  }, []);

  const handleSwitchMode = useCallback((id: string) => {
    navSideAPI.switchWorkMode(id);
  }, []);

  const handleCreateNote = useCallback(() => {
    navSideAPI.noteCreate();
  }, []);

  return (
    <div style={styles.container}>
      {/* Brand Bar */}
      <div style={styles.brandBar}>
        <img src="/logo.jpg" style={styles.brandLogo} alt="KRIG" />
        <span style={styles.brandName}>KRIG</span>
      </div>

      {/* ModeBar */}
      <div style={styles.modeBar}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            style={{
              ...styles.modeTab,
              ...(mode.id === activeWorkModeId ? styles.modeTabActive : {}),
            }}
            onClick={() => handleSwitchMode(mode.id)}
            title={mode.label}
          >
            <span style={styles.modeIcon}>{mode.icon}</span>
            <span style={styles.modeLabel}>{mode.label}</span>
          </button>
        ))}
      </div>

      {/* Action Bar */}
      <div style={styles.actionBar}>
        <span style={styles.actionTitle}>
          {ACTION_BAR_CONFIG[activeWorkModeId]?.title ?? ''}
        </span>
        <div style={styles.actionButtons}>
          {(ACTION_BAR_CONFIG[activeWorkModeId]?.actions ?? []).map((action) => (
            <button
              key={action.id}
              style={styles.actionButton}
              title={action.label}
              onClick={() => action.handler?.()}
            >
              {action.text}
            </button>
          ))}
        </div>
      </div>

      {/* Search（占位） */}
      <div style={styles.search}>
        <input
          style={styles.searchInput}
          placeholder="Search..."
          readOnly
        />
      </div>

      {/* Content List — NoteFile 列表 */}
      <div style={styles.contentList}>
        {!dbReady ? (
          <div style={styles.placeholder}>数据库启动中...</div>
        ) : noteList.length === 0 ? (
          <div style={styles.placeholder}>暂无笔记</div>
        ) : (
          noteList.map((note) => (
            <div
              key={note.id}
              style={styles.noteItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a2a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={styles.noteTitle}>{note.title}</span>
              <span style={styles.noteDate}>
                {new Date(note.updated_at).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </div>

    </div>
  );
}

/**
 * Demo Action Bar 配置
 * 未来由插件通过 ActionBarRegistration 注册，当前用 Demo 数据验证 UI
 */
const ACTION_BAR_CONFIG: Record<string, {
  title: string;
  actions: { id: string; label: string; text: string; handler?: () => void }[];
}> = {
  'demo-a': {
    title: '笔记目录',
    actions: [
      { id: 'new-note', label: '新建笔记', text: '+ 新建', handler: () => navSideAPI.noteCreate() },
      { id: 'open-right-b', label: '打开 PDF 侧栏', text: '📕 右侧', handler: () => navSideAPI.openRightSlot('demo-b') },
      { id: 'close-right', label: '关闭右侧', text: '✕ 关闭', handler: () => navSideAPI.closeRightSlot() },
    ],
  },
  'demo-b': {
    title: 'PDF 文档',
    actions: [
      { id: 'open-right-a', label: '打开 Note 侧栏', text: '📝 右侧', handler: () => navSideAPI.openRightSlot('demo-a') },
      { id: 'close-right', label: '关闭右侧', text: '✕ 关闭', handler: () => navSideAPI.closeRightSlot() },
    ],
  },
  'demo-c': {
    title: '书签',
    actions: [
      { id: 'open-right-a', label: '打开 Note 侧栏', text: '📝 右侧', handler: () => navSideAPI.openRightSlot('demo-a') },
      { id: 'close-right', label: '关闭右侧', text: '✕ 关闭', handler: () => navSideAPI.closeRightSlot() },
    ],
  },
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1a1a1a',
    color: '#e8eaed',
  },
  brandBar: {
    display: 'flex',
    alignItems: 'center',
    height: '40px',
    padding: '0 16px',
    borderBottom: '1px solid #333',
  },
  brandLogo: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    marginRight: '10px',
    objectFit: 'cover',
  },
  brandName: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e8eaed',
  },
  modeBar: {
    display: 'flex',
    flexDirection: 'row',
    gap: '2px',
    padding: '6px 8px',
    borderBottom: '1px solid #333',
  },
  modeTab: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    flex: 1,
    padding: '4px 0',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: '#999',
    fontSize: '11px',
    cursor: 'pointer',
    textAlign: 'center',
    flexDirection: 'column',
  },
  modeTabActive: {
    background: '#333',
    color: '#e8eaed',
  },
  modeIcon: {
    fontSize: '16px',
  },
  modeLabel: {
  },
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '36px',
    padding: '0 16px',
    borderBottom: '1px solid #333',
  },
  actionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#c8a96e',
    flexShrink: 0,
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  actionButton: {
    border: 'none',
    background: 'transparent',
    color: '#c8a96e',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '2px 0',
    whiteSpace: 'nowrap',
  },
  search: {
    padding: '8px',
    borderBottom: '1px solid #333',
  },
  searchInput: {
    width: '100%',
    height: '28px',
    padding: '0 8px',
    border: '1px solid #444',
    borderRadius: '4px',
    background: '#2a2a2a',
    color: '#e8eaed',
    fontSize: '12px',
    outline: 'none',
  },
  contentList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  placeholder: {
    color: '#666',
    fontSize: '12px',
    padding: '16px',
    textAlign: 'center',
  },
  noteItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#e8eaed',
  },
  noteTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noteDate: {
    fontSize: '11px',
    color: '#666',
    flexShrink: 0,
    marginLeft: '8px',
  },
};
