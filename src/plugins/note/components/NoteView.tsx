import { useState, useEffect, useCallback } from 'react';
import { NoteEditor } from './NoteEditor';
import { canGoBack, canGoForward, goBack, goForward } from '../plugins/link-click';

/**
 * NoteView — L3 View 组件
 *
 * 结构：Toolbar + Content（NoteEditor）+ Overlays
 * 按照 ui-framework/view.md 定义的 View 结构。
 *
 * Toolbar：后退/前进导航 + 笔记标题
 * Content：NoteEditor（ProseMirror 编辑器）
 * Overlays：由 NoteEditor 内部管理（SlashMenu、FloatingToolbar 等）
 */

declare const viewAPI: {
  noteLoad: (id: string) => Promise<{ title?: string } | null>;
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
};

export function NoteView() {
  const [noteTitle, setNoteTitle] = useState('');
  const [navState, setNavState] = useState({ back: false, forward: false });
  const [dirty, setDirty] = useState(false);

  const refreshNav = useCallback(() => {
    setNavState({ back: canGoBack(), forward: canGoForward() });
  }, []);

  useEffect(() => {
    const unsubOpen = viewAPI.onNoteOpenInEditor(async (noteId) => {
      refreshNav();
      // 加载笔记标题
      try {
        const record = await viewAPI.noteLoad(noteId);
        if (record?.title) setNoteTitle(record.title);
      } catch { /* ignore */ }
    });

    const unsubTitle = viewAPI.onNoteTitleChanged((data) => {
      setNoteTitle(data.title);
    });

    // Cmd+S 手动保存
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('note:save'));
      }
    };
    window.addEventListener('keydown', keyHandler);

    // 监听 dirty / saved 状态
    const onDirty = () => setDirty(true);
    const onSaved = () => setDirty(false);
    window.addEventListener('note:dirty', onDirty);
    window.addEventListener('note:saved', onSaved);

    return () => {
      unsubOpen(); unsubTitle();
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('note:dirty', onDirty);
      window.removeEventListener('note:saved', onSaved);
    };
  }, [refreshNav]);

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button
          style={{ ...styles.navBtn, opacity: navState.back ? 1 : 0.3 }}
          disabled={!navState.back}
          onClick={() => { goBack(); refreshNav(); }}
          title="后退 (⌘[)"
        >
          ‹
        </button>
        <button
          style={{ ...styles.navBtn, opacity: navState.forward ? 1 : 0.3 }}
          disabled={!navState.forward}
          onClick={() => { goForward(); refreshNav(); }}
          title="前进 (⌘])"
        >
          ›
        </button>
        <span style={styles.toolbarTitle}>{noteTitle || 'Note'}</span>
        <div style={{ flex: 1 }} />
        <button
          style={styles.saveBtn}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = () => {
              const file = input.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const data = JSON.parse(reader.result as string);
                  console.log('[NoteView] Import JSON keys:', Object.keys(data));
                  window.dispatchEvent(new CustomEvent('note:import-json', { detail: data }));
                } catch (err) {
                  console.error('[NoteView] JSON parse failed:', err);
                }
              };
              reader.readAsText(file);
            };
            input.click();
          }}
          title="导入 JSON 测试"
        >
          Import JSON
        </button>
        <button
          style={{ ...styles.saveBtn, opacity: dirty ? 1 : 0.3 }}
          disabled={!dirty}
          onClick={() => window.dispatchEvent(new CustomEvent('note:save'))}
          title="保存 (⌘S)"
        >
          {dirty ? '保存' : '已保存'}
        </button>
        <button
          style={styles.closeSlotBtn}
          onClick={() => (window as any).viewAPI.closeSlot()}
          title="关闭此面板"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <NoteEditor />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1e1e1e',
    color: '#e8eaed',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 36,
    padding: '0 12px',
    borderBottom: '1px solid #333',
    background: '#252525',
    flexShrink: 0,
  },
  navBtn: {
    width: 24,
    height: 24,
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  toolbarTitle: {
    fontSize: 13,
    fontWeight: 500,
    marginLeft: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  saveBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    padding: '2px 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  closeSlotBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#888',
    fontSize: 16,
    padding: '0 6px',
    cursor: 'pointer',
    flexShrink: 0,
    lineHeight: '24px',
  },
};
