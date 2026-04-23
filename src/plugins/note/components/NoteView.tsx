import { useState, useEffect, useCallback, useRef } from 'react';
import { NoteEditor, type NoteEditorHandle } from './NoteEditor';
import { SlotToggle } from '../../../shared/components/SlotToggle';
import { OpenFilePopup } from '../../../shared/components/OpenFilePopup';
import type { FileItem } from '../../../shared/components/OpenFilePopup';
import { canGoBack, canGoForward, goBack, goForward, setCurrentNote } from '../plugins/link-click';
import { showBookmarksPanel, hideBookmarksPanel } from '../help-panel/bookmarks';
import { APP_CONFIG } from '../../../shared/app-config';
import type { Atom } from '../../../shared/types/atom-types';

/** Note 内书签（跟 main 侧的 NoteBookmark 对齐） */
interface NoteBookmark {
  id: string;
  block_index: number;
  label: string;
  created_at: number;
}

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
  noteLoad: (id: string) => Promise<{
    title?: string;
    doc_content?: Atom[];
    bookmarks?: NoteBookmark[];
    last_view_block_index?: number;
  } | null>;
  noteList: () => Promise<Array<{ id: string; title: string }>>;
  noteOpenInEditor: (id: string) => Promise<void>;
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  onNoteDeleted: (callback: (noteId: string) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
  noteSave: (id: string, docContent: unknown[], title: string) => Promise<void>;
  noteSaveLastView: (id: string, blockIndex: number) => Promise<void>;
  noteSaveBookmarks: (id: string, bookmarks: unknown[]) => Promise<void>;
  noteRename: (id: string, title: string) => Promise<void>;
  setActiveNote: (noteId: string | null, noteTitle?: string) => Promise<void>;
  notePendingOpen: () => Promise<string | null>;
  getActiveNoteId: () => Promise<string | null>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null; rightActiveNoteId?: string | null }) => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
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
  // Step 1（feature/noteview-layer-refactor）：捕获 NoteEditor handle
  const editorHandleRef = useRef<NoteEditorHandle | null>(null);
  // onReady 必须保持引用稳定：NoteEditor 的初始化 useEffect 依赖它，
  // 若每次 NoteView render 都传新函数会导致 editor 被反复 re-init，丢失内容/标题。
  const handleEditorReady = useCallback((handle: NoteEditorHandle) => {
    editorHandleRef.current = handle;
  }, []);

  // Step 2：NoteView 承接保存编排 —— 独立跟踪 noteId + 1s 防抖
  // 关键陷阱：
  // (1) Cmd+S 立即保存时，必须清 pending timer，否则 1s 后会重复写盘
  // (2) 切笔记时，pending save 必须 flush 到"旧 noteId"，不能让新笔记的 atoms
  //     被写到老笔记的 key 下 —— 所以切换时先 flush，再更新 activeNoteIdRef
  const activeNoteIdRef = useRef<string | null>(null);
  // Step 3：activeNoteId 也作为 state，用于作为 NoteEditor prop 下传
  // （AI Sync 的 note-status payload 需要它）。ref + state 双存，
  // ref 用于同步读取（防抖、竞态），state 用于 render。
  const [activeNoteIdState, setActiveNoteIdState] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<boolean>(false); // flush 去重：正在写盘时跳过新的 schedule
  // Step 3：loadNote 竞态保护 —— 快速切换时丢弃过期的异步结果
  const loadSeqRef = useRef(0);
  // Step 3：书签列表 + 面板状态（每个 note 独立）
  const bookmarksRef = useRef<NoteBookmark[]>([]);
  const bookmarksPanelOpenRef = useRef<boolean>(false);

  /** 立即把当前编辑器内容写盘到指定 noteId。幂等，会清掉 pending timer。 */
  const flushSave = useCallback(async (targetNoteId: string | null) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const handle = editorHandleRef.current;
    if (!targetNoteId || !handle || !handle.view) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const atoms = handle.getDocAtoms();
      const title = handle.getTitle();
      await viewAPI.noteSave(targetNoteId, atoms, title);
      const idx = handle.getTopBlockIndexAtScroll();
      viewAPI.noteSaveLastView(targetNoteId, idx).catch(() => { /* ignore */ });
      setDirty(false);
    } catch (err) {
      console.error('[NoteView] save failed:', err);
    } finally {
      savingRef.current = false;
    }
  }, []);

  /** 编辑器脏信号 → 启动 1s 防抖 → 到点 flush 到"当时的" activeNoteId */
  const scheduleSave = useCallback(() => {
    setDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      // 捕获当前 activeNoteId（防抖到点时可能已切笔记，此处以当前值为准）
      void flushSave(activeNoteIdRef.current);
    }, 1000);
  }, [flushSave]);

  /** 生成书签默认 label：取该顶层 block 的前 30 字，空则用"第 N 块" */
  const deriveBookmarkLabel = useCallback((blockIndex: number): string => {
    const view = editorHandleRef.current?.view;
    if (!view || view.isDestroyed || blockIndex >= view.state.doc.childCount) {
      return `第 ${blockIndex + 1} 块`;
    }
    const text = view.state.doc.child(blockIndex).textContent.trim();
    if (!text) return `第 ${blockIndex + 1} 块`;
    return text.length > 30 ? text.slice(0, 30) + '…' : text;
  }, []);

  /** 打开书签面板（会先清理失效书签） */
  const openBookmarksPanel = useCallback(() => {
    const handle = editorHandleRef.current;
    const noteId = activeNoteIdRef.current;
    // 清理失效书签（blockIndex 超出当前 doc）
    if (handle) {
      const maxIdx = handle.getTopBlockCount() - 1;
      const cleaned = bookmarksRef.current.filter(b => b.block_index <= maxIdx);
      if (cleaned.length !== bookmarksRef.current.length) {
        bookmarksRef.current = cleaned;
        if (noteId) viewAPI.noteSaveBookmarks(noteId, cleaned).catch(() => {});
      }
    }
    showBookmarksPanel({
      bookmarks: bookmarksRef.current,
      onAddCurrent: () => {
        const h = editorHandleRef.current;
        const nid = activeNoteIdRef.current;
        if (!h || !h.view || h.view.isDestroyed || !nid) return;
        // 优先光标所在 block，退化到 scroll 顶部可见块
        const { $from } = h.view.state.selection;
        const blockIndex = $from.depth >= 1 ? $from.index(0) : h.getTopBlockIndexAtScroll();
        if (blockIndex < 0) return;
        if (bookmarksRef.current.some(b => b.block_index === blockIndex)) {
          // 已存在则重新 render 让用户看到
          if (bookmarksPanelOpenRef.current) openBookmarksPanel();
          return;
        }
        const bm: NoteBookmark = {
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          block_index: blockIndex,
          label: deriveBookmarkLabel(blockIndex),
          created_at: Date.now(),
        };
        bookmarksRef.current = [...bookmarksRef.current, bm];
        viewAPI.noteSaveBookmarks(nid, bookmarksRef.current).catch(() => {});
        if (bookmarksPanelOpenRef.current) openBookmarksPanel(); // 重 render
      },
      onJump: (bmId) => {
        const bm = bookmarksRef.current.find(b => b.id === bmId);
        if (bm) editorHandleRef.current?.scrollToTopBlockIndex(bm.block_index);
      },
      onRemove: (bmId) => {
        const nid = activeNoteIdRef.current;
        bookmarksRef.current = bookmarksRef.current.filter(b => b.id !== bmId);
        if (nid) viewAPI.noteSaveBookmarks(nid, bookmarksRef.current).catch(() => {});
        if (bookmarksPanelOpenRef.current) openBookmarksPanel();
      },
      onRename: (bmId, newLabel) => {
        const nid = activeNoteIdRef.current;
        bookmarksRef.current = bookmarksRef.current.map(b =>
          b.id === bmId ? { ...b, label: newLabel } : b,
        );
        if (nid) viewAPI.noteSaveBookmarks(nid, bookmarksRef.current).catch(() => {});
        if (bookmarksPanelOpenRef.current) openBookmarksPanel();
      },
    });
    bookmarksPanelOpenRef.current = true;
  }, [deriveBookmarkLabel]);

  /**
   * Step 3：加载笔记 —— 竞态取消，fallback 到空编辑器，
   * 恢复书签 + 阅读位置 + 同步标题到 DB。
   */
  const loadNote = useCallback(async (noteId: string) => {
    const handle = editorHandleRef.current;
    if (!handle) return;
    const seq = ++loadSeqRef.current;

    const fallbackToEmpty = (reason: string) => {
      console.warn(`[NoteView] ${reason} — fallback to empty editor`);
      handle.replaceDoc([]);
      activeNoteIdRef.current = null;
      setActiveNoteIdState(null);
      setCurrentNote(null);
      viewAPI.setActiveNote(null, undefined);
      setNoteTitle('Untitled');
      bookmarksRef.current = [];
      if (bookmarksPanelOpenRef.current) {
        hideBookmarksPanel();
        bookmarksPanelOpenRef.current = false;
      }
    };

    try {
      const record = await viewAPI.noteLoad(noteId);
      if (seq !== loadSeqRef.current) return;
      if (!record) {
        fallbackToEmpty(`Note ${noteId} not found in DB`);
        return;
      }

      handle.replaceDoc(record.doc_content ?? []);
      activeNoteIdRef.current = noteId;
      setActiveNoteIdState(noteId);
      setCurrentNote(noteId);

      // 书签
      bookmarksRef.current = Array.isArray(record.bookmarks) ? record.bookmarks : [];
      if (bookmarksPanelOpenRef.current) {
        hideBookmarksPanel();
        bookmarksPanelOpenRef.current = false;
      }

      // 跨文档 block 链接的 pending anchor 跳转
      handle.flushPendingAnchor();

      // 从 doc 中提取实际标题，同步到 toolbar + DB（若 DB 标题过期）
      const docTitle = handle.getTitle();
      setNoteTitle(docTitle);
      viewAPI.setActiveNote(noteId, docTitle);
      if (record.title !== docTitle) {
        viewAPI.noteRename(noteId, docTitle).catch(() => {});
      }

      // 恢复阅读位置（双重 rAF 等 scroll 容器布局完成）
      const savedIdx = record.last_view_block_index;
      if (typeof savedIdx === 'number' && savedIdx > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (loadSeqRef.current === seq) {
              editorHandleRef.current?.scrollToTopBlockIndex(savedIdx);
            }
          });
        });
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('[NoteView] loadNote failed:', err);
      fallbackToEmpty(`Note ${noteId} load threw: ${(err as Error)?.message || err}`);
    }
  }, []);

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
      // Step 2：切笔记前 flush pending save 到"旧 noteId"
      // 避免新笔记的 atoms 被写到老笔记 key 下的竞态
      const prevId = activeNoteIdRef.current;
      if (prevId && prevId !== noteId) {
        await flushSave(prevId);
      } else if (saveTimerRef.current) {
        // 同一笔记被再次打开，清掉 pending（loadNote 会重置内容）
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setDirty(false);
      refreshNav();
      setHasActiveNote(true);
      setLibraryEmpty(false);
      // Step 3：由 NoteView 直接负责加载（原 NoteEditor.loadNote 已搬过来）
      await loadNote(noteId);
      // 通知 Thought 面板加载对应 thoughts
      viewAPI.sendToOtherSlot({
        protocol: 'note-thought',
        action: 'thought:note-loaded',
        payload: { noteId },
      });
    });

    // Step 3：外部重命名同步到编辑器 noteTitle 节点
    const unsubTitle = viewAPI.onNoteTitleChanged((data) => {
      if (data.noteId !== activeNoteIdRef.current) return;
      setNoteTitle(data.title);
      editorHandleRef.current?.setTitleText(data.title);
    });

    // Step 2：笔记被删除时，取消 pending save 并清 activeNoteIdRef
    // 不在这里写盘 —— 笔记已删，写了也无意义，且 noteSave 会报错
    const unsubDeleted = viewAPI.onNoteDeleted((deletedId) => {
      if (activeNoteIdRef.current !== deletedId) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      activeNoteIdRef.current = null;
      setActiveNoteIdState(null);
      setDirty(false);
    });

    // Cmd+S 手动保存 —— 立即 flush，清 pending timer
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void flushSave(activeNoteIdRef.current);
      }
    };
    window.addEventListener('keydown', keyHandler);

    // Step 3：书签面板 toggle
    const togglePanelHandler = () => {
      if (bookmarksPanelOpenRef.current) {
        hideBookmarksPanel();
        bookmarksPanelOpenRef.current = false;
      } else {
        openBookmarksPanel();
      }
    };
    window.addEventListener('note:bookmark-toggle-panel', togglePanelHandler);

    // Step 3：启动恢复 —— notePendingOpen（导入路径）优先，其次 restore workspace state
    // 走 viewAPI.noteOpenInEditor 触发事件流（和用户点 NavSide 等同），不直接 loadNote
    const unsubRestore = viewAPI.onRestoreWorkspaceState(async (state) => {
      const role = await viewAPI.getMyRole();
      const noteId = role === 'companion' ? state.rightActiveNoteId : state.activeNoteId;
      if (noteId && !activeNoteIdRef.current) viewAPI.noteOpenInEditor(noteId);
    });
    viewAPI.notePendingOpen().then(async (noteId) => {
      if (noteId) {
        viewAPI.noteOpenInEditor(noteId);
        return;
      }
      const dbReady = await viewAPI.isDBReady();
      if (!dbReady) {
        await new Promise<void>(resolve => {
          const unsub = viewAPI.onDBReady(() => { unsub(); resolve(); });
        });
      }
      if (activeNoteIdRef.current) return;
      const activeId = await viewAPI.getActiveNoteId();
      if (activeId && !activeNoteIdRef.current) {
        viewAPI.noteOpenInEditor(activeId);
      }
    });

    return () => {
      unsubOpen(); unsubTitle(); unsubDeleted(); unsubRestore();
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('note:bookmark-toggle-panel', togglePanelHandler);
      if (bookmarksPanelOpenRef.current) {
        hideBookmarksPanel();
        bookmarksPanelOpenRef.current = false;
      }
      // 卸载前 flush pending save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void flushSave(activeNoteIdRef.current);
      }
    };
  }, [refreshNav, flushSave, loadNote, openBookmarksPanel]);

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
          onClick={() => void flushSave(activeNoteIdRef.current)}
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
        <NoteEditor
          onReady={handleEditorReady}
          onDocChanged={scheduleSave}
          onTitleChanged={setNoteTitle}
          activeNoteId={activeNoteIdState}
        />
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
