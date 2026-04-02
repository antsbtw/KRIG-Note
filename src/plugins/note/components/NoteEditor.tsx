import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { blockRegistry } from '../registry';
import { buildTestDocument } from '../test-content';
import { slashCommandPlugin } from '../plugins/slash-command';
import { enterHandlerPlugin } from '../plugins/enter-handler';
import { blockHandlePlugin } from '../plugins/block-handle';
import { headingFoldPlugin } from '../plugins/heading-fold';
import { blockSelectionPlugin } from '../block-ops/block-selection';
import { blockAction } from '../block-ops/block-action';
import { buildInputRules } from '../plugins/input-rules';
import { formatInheritPlugin } from '../plugins/format-inherit';
import { tableKeymapPlugin } from '../blocks/table';
import { goToNextCell } from 'prosemirror-tables';
import { SlashMenu } from './SlashMenu';
import { HandleMenu } from './HandleMenu';
import { FloatingToolbar } from './FloatingToolbar';
import { NotePicker } from './NotePicker';
import { ContextMenu } from './ContextMenu';

/**
 * NoteEditor — ProseMirror 编辑器 React 组件
 *
 * 支持 NoteFile 保存/加载：
 * - 自动保存：内容变化 → debounce 2s → viewAPI.noteSave()
 * - 加载：监听 IPC note:load-into-editor 事件
 */

declare const viewAPI: {
  noteCreate: (title?: string) => Promise<{ id: string }>;
  noteSave: (id: string, docContent: unknown[], title: string) => Promise<void>;
  noteLoad: (id: string) => Promise<{ id: string; title: string; doc_content: unknown[] } | null>;
  noteList: () => Promise<unknown[]>;
  onNoteListChanged: (callback: (list: unknown[]) => void) => () => void;
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  sendToOtherSlot: (message: unknown) => void;
  onMessage: (callback: (message: unknown) => void) => () => void;
  openRightSlot: (workModeId: string) => Promise<void>;
  closeRightSlot: () => Promise<void>;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  onLoadTestDoc: (callback: () => void) => () => void;
  setActiveNote: (noteId: string | null, noteTitle?: string) => Promise<void>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null }) => void) => () => void;
};

// Schema（延迟构建，确保 registerAllBlocks 已调用）
let schema: ReturnType<typeof blockRegistry.buildSchema>;
function getSchema() {
  if (!schema) schema = blockRegistry.buildSchema();
  return schema;
}

export function NoteEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const noteIdRef = useRef<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('');

  // 浏览历史
  const historyStack = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const pushHistory = useCallback((noteId: string) => {
    // 如果不是最新位置，截断前进历史
    if (historyIndex.current < historyStack.current.length - 1) {
      historyStack.current = historyStack.current.slice(0, historyIndex.current + 1);
    }
    // 避免重复
    if (historyStack.current[historyStack.current.length - 1] !== noteId) {
      historyStack.current.push(noteId);
    }
    historyIndex.current = historyStack.current.length - 1;
    setCanGoBack(historyIndex.current > 0);
    setCanGoForward(false);
  }, []);

  const goBack = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current--;
    const noteId = historyStack.current[historyIndex.current];
    setCanGoBack(historyIndex.current > 0);
    setCanGoForward(true);
    viewAPI.noteLoad(noteId).then((note: any) => {
      if (note) loadNote(note.id, note.doc_content, true);
    });
  }, []);

  const goForward = useCallback(() => {
    if (historyIndex.current >= historyStack.current.length - 1) return;
    historyIndex.current++;
    const noteId = historyStack.current[historyIndex.current];
    setCanGoBack(true);
    setCanGoForward(historyIndex.current < historyStack.current.length - 1);
    viewAPI.noteLoad(noteId).then((note: any) => {
      if (note) loadNote(note.id, note.doc_content, true);
    });
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  // 保存当前文档
  const saveCurrentNote = useCallback(() => {
    const view = viewRef.current;
    const noteId = noteIdRef.current;
    if (!view || !noteId || !isDirtyRef.current) return;

    const doc = view.state.doc;
    const docJSON = doc.toJSON();
    // 提取 title（从 noteTitle 节点）
    let title = 'Untitled';
    doc.forEach((node) => {
      if (node.type.name === 'noteTitle' && node.textContent) {
        title = node.textContent;
      }
    });

    viewAPI.noteSave(noteId, docJSON.content || [], title);
    isDirtyRef.current = false;
  }, []);

  // 加载文档到编辑器（skipHistory = true 时不记录历史，用于 back/forward）
  const loadNote = useCallback((noteId: string, docContent: unknown[], skipHistory?: boolean) => {
    const view = viewRef.current;
    if (!view) return;

    // 先保存当前文档
    saveCurrentNote();

    noteIdRef.current = noteId;
    isDirtyRef.current = false;

    // 浏览历史
    if (!skipHistory) pushHistory(noteId);

    try {
      // 从 docContent 重建 ProseMirror Doc
      let doc: PMNode;
      try {
        if (docContent && Array.isArray(docContent) && docContent.length > 0) {
          doc = PMNode.fromJSON(getSchema(), { type: 'doc', content: docContent });
        } else {
          throw new Error('empty content');
        }
      } catch {
        // 解析失败或空内容 → 创建默认文档
        doc = getSchema().node('doc', null, [
          getSchema().node('noteTitle'),
          getSchema().node('paragraph'),
        ]);
      }

      const newState = EditorState.create({
        doc,
        plugins: view.state.plugins,
      });
      view.updateState(newState);

      // 更新标题
      let title = '';
      doc.forEach((node) => {
        if (node.type.name === 'noteTitle' && node.textContent) title = node.textContent;
      });
      setCurrentTitle(title || 'Untitled');

      // 报告给 Workspace（含标题，用于自动更新 tab label）
      viewAPI.setActiveNote(noteId, title || 'Untitled');
    } catch (err) {
      console.error('[NoteEditor] Failed to load doc:', err);
    }
  }, [saveCurrentNote]);

  // 初始化编辑器
  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    const nodeViews = blockRegistry.buildNodeViews();
    const blockPlugins = blockRegistry.buildBlockPlugins();

    // 初始文档：空白笔记（DB 就绪后加载真实笔记，测试文档通过 Help 菜单加载）
    const s = getSchema();
    const doc = s.node('doc', null, [
      s.node('noteTitle'),
      s.node('paragraph'),
    ]);

    // Mark 快捷键
    const markKeymap: Record<string, Command> = {};
    if (s.marks.bold) markKeymap['Mod-b'] = toggleMark(s.marks.bold);
    if (s.marks.italic) markKeymap['Mod-i'] = toggleMark(s.marks.italic);
    if (s.marks.underline) markKeymap['Mod-u'] = toggleMark(s.marks.underline);
    if (s.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(s.marks.strike);
    if (s.marks.code) markKeymap['Mod-e'] = toggleMark(s.marks.code);

    // Shift+Enter → hardBreak（软换行）
    if (s.nodes.hardBreak) {
      markKeymap['Shift-Enter'] = (state, dispatch) => {
        if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hardBreak.create()));
        return true;
      };
    }

    // Heading 折叠快捷键
    markKeymap['Mod-.'] = (state, dispatch) => {
      const { $from } = state.selection;
      if ($from.depth >= 1) {
        const blockNode = $from.node(1);
        if (blockNode.type.name === 'heading') {
          const pos = $from.before(1);
          if (dispatch) {
            dispatch(state.tr.setNodeMarkup(pos, undefined, { ...blockNode.attrs, open: !(blockNode.attrs.open !== false) }));
          }
          return true;
        }
      }
      return false;
    };

    // 列表快捷键（listItem + taskItem 共享）
    const listKeymap: Record<string, Command> = {};
    const listItemType = s.nodes.listItem;
    const taskItemType = s.nodes.taskItem;
    if (listItemType) {
      listKeymap['Enter'] = splitListItem(listItemType);
    }
    if (taskItemType) {
      const prevEnter = listKeymap['Enter'];
      listKeymap['Enter'] = (state, dispatch, view) => {
        if (splitListItem(taskItemType)(state, dispatch)) return true;
        if (prevEnter) return prevEnter(state, dispatch, view);
        return false;
      };
    }
    listKeymap['Tab'] = (state, dispatch, view) => {
      // Table Tab 导航优先
      if (goToNextCell(1)(state, dispatch)) return true;
      if (listItemType && sinkListItem(listItemType)(state, dispatch)) return true;
      if (taskItemType && sinkListItem(taskItemType)(state, dispatch)) return true;
      if (view) {
        const { $from } = state.selection;
        const pos = $from.depth >= 1 ? $from.before(1) : $from.pos;
        return blockAction.indent(view, pos);
      }
      return false;
    };
    listKeymap['Shift-Tab'] = (state, dispatch, view) => {
      if (goToNextCell(-1)(state, dispatch)) return true;
      if (listItemType && liftListItem(listItemType)(state, dispatch)) return true;
      if (taskItemType && liftListItem(taskItemType)(state, dispatch)) return true;
      if (view) {
        const { $from } = state.selection;
        const pos = $from.depth >= 1 ? $from.before(1) : $from.pos;
        return blockAction.outdent(view, pos);
      }
      return false;
    };

    const state = EditorState.create({
      doc,
      plugins: [
        slashCommandPlugin(),
        blockSelectionPlugin(),
        enterHandlerPlugin(),
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
        keymap(markKeymap),
        keymap(listKeymap),
        keymap(baseKeymap),
        buildInputRules(s),
        history(),
        dropCursor(),
        gapCursor(),
        blockHandlePlugin(),
        headingFoldPlugin(),
        tableKeymapPlugin(),
        formatInheritPlugin(),
        ...blockPlugins,
      ],
    });

    const view = new EditorView(editorRef.current, {
      state,
      nodeViews,
      handleDoubleClick(view, pos) {
        // 双击链接 → 打开
        const $pos = view.state.doc.resolve(pos);
        const marks = $pos.marks();
        const linkMark = marks.find((m) => m.type.name === 'link');
        if (!linkMark?.attrs.href) return false;

        const href = linkMark.attrs.href as string;
        if (href.startsWith('krig://note/')) {
          const noteId = href.replace('krig://note/', '');
          viewAPI.noteLoad(noteId).then((note: any) => {
            if (note) loadNote(note.id, note.doc_content);
          });
          return true;
        } else {
          window.open(href, '_blank');
          return true;
        }
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        // 文档变化时标记 dirty + debounce 保存
        if (tr.docChanged && noteIdRef.current) {
          isDirtyRef.current = true;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            saveCurrentNote();
          }, 2000);
        }
      },
    });

    viewRef.current = view;
    setEditorView(view);

    // 监听 NavSide 的笔记加载请求（通过 IPC 路由）
    const unsubOpenNote = viewAPI.onNoteOpenInEditor((noteId: string) => {
      viewAPI.noteLoad(noteId).then((note: any) => {
        if (note) loadNote(note.id, note.doc_content);
      });
    });

    // DB 就绪后加载或创建第一个笔记
    function initFromDB() {
      viewAPI.noteList().then((list: any[]) => {
        if (list.length > 0) {
          viewAPI.noteLoad(list[0].id).then((note: any) => {
            if (note) loadNote(note.id, note.doc_content);
          });
        } else {
          viewAPI.noteCreate('Untitled').then((note: any) => {
            if (note) {
              noteIdRef.current = note.id;
            }
          });
        }
      });
    }

    // 监听 db:ready 事件
    const unsubDB = viewAPI.onDBReady(() => {
      initFromDB();
    });

    // 也主动查询 DB 状态（防止 db:ready 事件在 renderer 加载之前已发送）
    viewAPI.isDBReady().then((ready: boolean) => {
      if (ready) initFromDB();
    });

    // Help → Load Test Document
    const unsubTestDoc = viewAPI.onLoadTestDoc(() => {
      const testDoc = buildTestDocument(getSchema());
      const newState = EditorState.create({
        doc: testDoc,
        plugins: view.state.plugins,
      });
      view.updateState(newState);
      noteIdRef.current = null;
      isDirtyRef.current = false;
    });

    // Workspace 切换 → 恢复该 Workspace 的 activeNoteId
    const unsubRestore = viewAPI.onRestoreWorkspaceState((state: { activeNoteId: string | null }) => {
      if (state.activeNoteId) {
        viewAPI.noteLoad(state.activeNoteId).then((note: any) => {
          if (note) loadNote(note.id, note.doc_content);
        });
      }
    });

    return () => {
      // 退出前保存
      saveCurrentNote();
      unsubOpenNote();
      unsubDB();
      unsubTestDoc();
      unsubRestore();
      view.destroy();
      viewRef.current = null;
      setEditorView(null);
    };
  }, [saveCurrentNote, loadNote]);

  // 菜单互斥
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handleContextOpen = useCallback(() => setContextMenuOpen(true), []);
  const handleContextClose = useCallback(() => setContextMenuOpen(false), []);

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button
          style={{ ...styles.navBtn, ...(canGoBack ? {} : styles.navBtnDisabled) }}
          onMouseDown={(e) => { e.preventDefault(); goBack(); }}
          title="后退"
        >‹</button>
        <button
          style={{ ...styles.navBtn, ...(canGoForward ? {} : styles.navBtnDisabled) }}
          onMouseDown={(e) => { e.preventDefault(); goForward(); }}
          title="前进"
        >›</button>
        <span style={styles.toolbarDot} />
        <span style={styles.toolbarTitle}>{currentTitle || 'Note'}</span>
      </div>

      <div
        ref={editorRef}
        style={styles.editor}
        onDoubleClick={(e) => {
          // 双击空白区域（文档内容之下的 padding）→ 末尾创建新段落
          const view = viewRef.current;
          if (!view) return;
          // 检查点击是否在最后一个 Block 的下方
          const lastChild = view.dom.lastElementChild;
          if (lastChild) {
            const lastRect = lastChild.getBoundingClientRect();
            if (e.clientY > lastRect.bottom) {
              const s = getSchema();
              const endPos = view.state.doc.content.size;
              const tr = view.state.tr.insert(endPos, s.nodes.paragraph.create());
              const newPos = tr.doc.content.size - 1;
              tr.setSelection(TextSelection.create(tr.doc, newPos));
              view.dispatch(tr);
              view.focus();
            }
          }
        }}
      />
      <SlashMenu view={editorView} />
      <HandleMenu view={editorView} />
      {!contextMenuOpen && <FloatingToolbar view={editorView} />}
      <ContextMenu view={editorView} onOpen={handleContextOpen} onClose={handleContextClose} />
      <NotePicker view={editorView} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#1e1e1e',
    position: 'relative',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    height: '36px',
    padding: '0 12px',
    borderBottom: '1px solid #333',
    background: '#252525',
    flexShrink: 0,
  },
  navBtn: {
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: '#e8eaed',
    fontSize: '18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  navBtnDisabled: {
    color: '#555',
    cursor: 'default',
  },
  toolbarDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#4a9eff',
    marginLeft: '4px',
  },
  toolbarTitle: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#e8eaed',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  editor: {
    flex: 1,
    overflow: 'auto',
    width: '100%',
    padding: '24px calc(max(32px, (100% - 800px) / 2))',
    minHeight: '100%',
    outline: 'none',
  },
};
