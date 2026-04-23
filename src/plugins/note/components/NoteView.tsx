import { useState, useEffect, useCallback, useRef } from 'react';
import { NoteEditor } from './NoteEditor';
import { SlotToggle } from '../../../shared/components/SlotToggle';
import { OpenFilePopup } from '../../../shared/components/OpenFilePopup';
import type { FileItem } from '../../../shared/components/OpenFilePopup';
import { canGoBack, canGoForward, goBack, goForward } from '../plugins/link-click';
import { APP_CONFIG } from '../../../shared/app-config';

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
  noteCreate: (title?: string) => Promise<{ id: string; title: string } | null>;
  noteLoad: (id: string) => Promise<{ title?: string } | null>;
  noteList: () => Promise<Array<{ id: string; title: string }>>;
  noteOpenInEditor: (id: string) => Promise<void>;
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
  sendToOtherSlot: (message: any) => void;
  onMessage: (callback: (message: any) => void) => () => void;
  getMyRole: () => Promise<'primary' | 'companion' | null>;
};

export function NoteView() {
  const [noteTitle, setNoteTitle] = useState('');
  const [navState, setNavState] = useState({ back: false, forward: false });
  const [dirty, setDirty] = useState(false);
  // Tracks whether the library has any notes at all. When false + no
  // active note, we show the empty state with a big [+ 新建笔记] button
  // instead of an empty editor. Refreshed on mount and whenever a note
  // is created/opened.
  const [libraryEmpty, setLibraryEmpty] = useState(false);
  const [hasActiveNote, setHasActiveNote] = useState(false);

  const refreshNav = useCallback(() => {
    setNavState({ back: canGoBack(), forward: canGoForward() });
  }, []);

  const loadNoteList = useCallback(async (): Promise<FileItem[]> => {
    const list = await viewAPI.noteList();
    return list.map((n) => ({ id: n.id, title: n.title }));
  }, []);

  const handleOpenNote = useCallback((noteId: string) => {
    viewAPI.noteOpenInEditor(noteId);
  }, []);

  /**
   * Create an untitled note and immediately open it in this editor.
   * Used by the "+" toolbar button. Title is left empty so the user can
   * fill it in; the title bar at the top of NoteEditor shows the placeholder.
   */
  const handleNewNote = useCallback(async () => {
    const note = await viewAPI.noteCreate('');
    if (note) {
      await viewAPI.noteOpenInEditor(note.id);
      setHasActiveNote(true);
      setLibraryEmpty(false);
    }
  }, []);

  /** Refresh the "library has notes" signal. Called on mount. */
  const refreshLibrary = useCallback(async () => {
    try {
      const list = await viewAPI.noteList();
      setLibraryEmpty(!Array.isArray(list) || list.length === 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // Initial library check on mount.
    refreshLibrary();

    const unsubOpen = viewAPI.onNoteOpenInEditor(async (noteId) => {
      refreshNav();
      setHasActiveNote(true);
      setLibraryEmpty(false);
      // 加载笔记标题
      try {
        const record = await viewAPI.noteLoad(noteId);
        if (record?.title) setNoteTitle(record.title);
      } catch { /* ignore */ }

      // 通知 Thought 面板加载对应 thoughts
      viewAPI.sendToOtherSlot({
        protocol: 'note-thought',
        action: 'thought:note-loaded',
        payload: { noteId },
      });
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

    // 监听编辑器内 noteTitle 实时变化
    const onTitleChanged = (e: Event) => {
      setNoteTitle((e as CustomEvent).detail);
    };
    window.addEventListener('note:title-changed', onTitleChanged);

    // 监听 dirty / saved 状态
    const onDirty = () => setDirty(true);
    const onSaved = () => setDirty(false);
    window.addEventListener('note:dirty', onDirty);
    window.addEventListener('note:saved', onSaved);

    return () => {
      unsubOpen(); unsubTitle();
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('note:title-changed', onTitleChanged);
      window.removeEventListener('note:dirty', onDirty);
      window.removeEventListener('note:saved', onSaved);
    };
  }, [refreshNav]);

  // ── 锚定同步：eBook↔Note ──
  // 规则：左主右从 — 只有位于 left slot 的 View 发射 anchor-sync，
  // right slot 仅被动跟随。避免编辑对齐时的反射抖动。
  const slotSideRef = useRef<'primary' | 'companion' | null>(null);

  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressUntil = 0; // 被动滚动后抑制自己发射的时间戳

    viewAPI.getMyRole().then((side) => { slotSideRef.current = side; });

    // 1) 接收 anchor-sync → 滚动到对应 fromPage（两侧都接收）
    const unsubMessage = viewAPI.onMessage((message: any) => {
      if (message?.action !== 'anchor-sync') return;
      const { anchorType, pdfPage } = message.payload || {};
      if (anchorType === 'pdf-page' && typeof pdfPage === 'number') {
        const anchors = document.querySelectorAll<HTMLElement>('[data-from-page]');
        let target: HTMLElement | null = null;
        let closestDist = Infinity;
        for (const el of anchors) {
          const p = parseInt(el.getAttribute('data-from-page') || '0', 10);
          const dist = Math.abs(p - pdfPage);
          if (dist < closestDist) {
            closestDist = dist;
            target = el;
          }
        }
        if (target) {
          suppressUntil = Date.now() + 600;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });

    // 2) 滚动时发送 anchor-sync（仅 primary View，且不在被动滚动抑制窗内）
    const handleScroll = () => {
      if (slotSideRef.current !== 'primary') return;
      if (Date.now() < suppressUntil) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const anchors = document.querySelectorAll<HTMLElement>('[data-from-page]');
        if (anchors.length === 0) return;

        let bestPage = 0;
        let bestTop = Infinity;
        for (const el of anchors) {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.top > -50) {
            if (rect.top < bestTop) {
              bestTop = rect.top;
              bestPage = parseInt(el.getAttribute('data-from-page') || '0', 10);
            }
          }
        }
        if (bestPage > 0) {
          viewAPI.sendToOtherSlot({
            protocol: '',
            action: 'anchor-sync',
            payload: { anchorType: 'pdf-page', pdfPage: bestPage },
          });
        }
      }, 300);
    };

    // 滚动容器是 NoteEditor 的 container div（overflow: auto）
    // 延迟绑定，等 ProseMirror 渲染完成
    let scrollTarget: Element | null = null;
    const bindTimer = setTimeout(() => {
      const pm = document.querySelector('.ProseMirror');
      scrollTarget = pm?.parentElement?.parentElement ?? null;
      scrollTarget?.addEventListener('scroll', handleScroll);
    }, 500);

    return () => {
      clearTimeout(bindTimer);
      unsubMessage();
      scrollTarget?.removeEventListener('scroll', handleScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, []);

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
          style={{ ...styles.saveBtn, opacity: dirty ? 1 : 0.3 }}
          disabled={!dirty}
          onClick={() => window.dispatchEvent(new CustomEvent('note:save'))}
          title="保存 (⌘S)"
        >
          {dirty ? '保存' : '已保存'}
        </button>
        <button
          className="note-toolbar__bookmark-btn"
          style={styles.toolbarIconBtn}
          onClick={() => window.dispatchEvent(new CustomEvent('note:bookmark-toggle-panel'))}
          title="书签：点击记录当前位置并打开列表"
        >
          📑
        </button>
        <button
          style={styles.newBtn}
          onClick={handleNewNote}
          title="新建笔记"
        >
          + 新建
        </button>
        <OpenFilePopup
          label="Open"
          placeholder="搜索笔记..."
          loadItems={loadNoteList}
          onSelect={handleOpenNote}
        />
        <SlotToggle />
        <button
          style={styles.closeSlotBtn}
          onClick={() => (window as any).viewAPI.closeSelf()}
          title="关闭此面板"
        >
          ×
        </button>
      </div>

      {/* Content */}
      {libraryEmpty && !hasActiveNote ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyStateIcon}>📝</div>
          <div style={styles.emptyStateText}>还没有笔记</div>
          <button style={styles.emptyStateBtn} onClick={handleNewNote}>
            + 新建笔记
          </button>
        </div>
      ) : (
        <NoteEditor />
      )}
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
    height: APP_CONFIG.layout.toolbarBtnHeight,
    padding: '0 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  newBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    height: APP_CONFIG.layout.toolbarBtnHeight,
    padding: '0 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  toolbarIconBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    height: APP_CONFIG.layout.toolbarBtnHeight,
    padding: '0 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 12,
    color: '#888',
  },
  emptyStateIcon: {
    fontSize: 48,
    opacity: 0.5,
  },
  emptyStateText: {
    fontSize: 14,
  },
  emptyStateBtn: {
    marginTop: 8,
    padding: '8px 20px',
    background: '#3a3a3a',
    border: '1px solid #555',
    borderRadius: 6,
    color: '#e8eaed',
    fontSize: 14,
    cursor: 'pointer',
  },
  closeSlotBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#888',
    fontSize: 16,
    height: APP_CONFIG.layout.toolbarBtnHeight,
    padding: '0 6px',
    cursor: 'pointer',
    flexShrink: 0,
  },
};
