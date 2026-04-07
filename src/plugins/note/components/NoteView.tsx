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
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
};

export function NoteView() {
  const [noteTitle, setNoteTitle] = useState('');
  const [navState, setNavState] = useState({ back: false, forward: false });

  const refreshNav = useCallback(() => {
    setNavState({ back: canGoBack(), forward: canGoForward() });
  }, []);

  useEffect(() => {
    const unsubOpen = viewAPI.onNoteOpenInEditor(() => {
      refreshNav();
    });

    const unsubTitle = viewAPI.onNoteTitleChanged((data) => {
      setNoteTitle(data.title);
    });

    return () => { unsubOpen(); unsubTitle(); };
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
};
