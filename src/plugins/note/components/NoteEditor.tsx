import { useRef, useEffect, useState, useCallback } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { blockRegistry } from '../registry';
import { registerAllBlocks } from '../blocks/index';
import { noteTitleNodeView } from '../blocks/text-block';
import { buildInputRules } from '../plugins/input-rules';
import { containerKeyboardPlugin } from '../plugins/container-keyboard';
import { slashCommandPlugin } from '../plugins/slash-command';
import { linkClickPlugin, setCurrentNote } from '../plugins/link-click';
import { tableKeymapPlugin } from '../blocks/table';
import { columnResizing } from 'prosemirror-tables';
import { SlashMenu } from './SlashMenu';
import { FloatingToolbar } from './FloatingToolbar';
import { HandleMenu } from './HandleMenu';
import { ContextMenu } from './ContextMenu';
import { blockHandlePlugin } from '../plugins/block-handle';
import { blockSelectionPlugin } from '../plugins/block-selection';
import { indentPlugin } from '../plugins/indent';
import { pasteMediaPlugin } from '../plugins/paste-media';
import { smartPastePlugin } from '../paste/smart-paste-plugin';
import { renderBlockFocusPlugin } from '../plugins/render-block-focus';
import { vocabHighlightPlugin, updateVocabDefs, dispatchVocabUpdate } from '../learning/vocab-highlight-plugin';
import { thoughtPlugin } from '../plugins/thought-plugin';
import { fromPageDecorationPlugin } from '../plugins/from-page-decoration';
import { updateVocabList } from '../learning';
import { buildTestDocument } from '../test-content';
import { createTocIndicator } from '../toc/toc-indicator';
import { headingCollapsePlugin } from '../plugins/heading-collapse';
import { titleGuardPlugin } from '../plugins/title-guard';
import { columnCollapsePlugin } from '../plugins/column-collapse';
import { registerConverterTest } from '../converters/converter-test';
import { converterRegistry } from '../converters/registry';
import type { Atom, NoteTitleContent } from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import { sanitizeAtoms } from '../../../shared/sanitize-atoms';
import '../note.css';

/**
 * NoteEditor — ProseMirror 编辑器 React 组件
 *
 * 从 SurrealDB 加载文档，自动保存。
 * 不再使用内存测试文档。
 */

declare const viewAPI: {
  noteLoad: (id: string) => Promise<any>;
  noteSave: (id: string, docContent: unknown[], title: string) => Promise<void>;
  noteRename: (id: string, title: string) => Promise<void>;
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  notePendingOpen: () => Promise<string | null>;
  setActiveNote: (noteId: string | null, noteTitle?: string) => Promise<void>;
  getActiveNoteId: () => Promise<string | null>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null }) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
  onLoadTestDoc: (callback: () => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  listVocabWords?: () => Promise<{ word: string; definition: string }[]>;
  onVocabChanged?: (callback: (entries: { word: string; definition: string }[]) => void) => () => void;
  // AI Sync
  onMessage: (callback: (message: any) => void) => () => void;
  aiParseMarkdown: (markdown: string) => Promise<{ success: boolean; atoms: any[]; error?: string }>;
};

// 注册所有 Block（只执行一次）
let registered = false;
function ensureRegistered() {
  if (registered) return;
  registerAllBlocks();
  blockRegistry.initConverters();
  registered = true;
}

let schemaCache: ReturnType<typeof blockRegistry.buildSchema> | null = null;
function getSchema() {
  if (!schemaCache) {
    ensureRegistered();
    schemaCache = blockRegistry.buildSchema();
  }
  return schemaCache;
}

/** 构建 ProseMirror 插件列表 */
function buildPlugins(s: ReturnType<typeof getSchema>) {
  const markKeymap: Record<string, any> = {};
  if (s.marks.bold) markKeymap['Mod-b'] = toggleMark(s.marks.bold);
  if (s.marks.italic) markKeymap['Mod-i'] = toggleMark(s.marks.italic);
  if (s.marks.underline) markKeymap['Mod-u'] = toggleMark(s.marks.underline);
  if (s.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(s.marks.strike);
  if (s.marks.code) markKeymap['Mod-e'] = toggleMark(s.marks.code);

  // Cmd+Alt+0/1/2/3 标题切换
  markKeymap['Mod-Alt-0'] = (state: any, dispatch: any) => {
    const { $from } = state.selection;
    if ($from.depth < 1) return false;
    const pos = $from.before(1);
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'textBlock' || node.attrs.isTitle) return false;
    if (!node.attrs.level) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: null }));
    return true;
  };
  for (const level of [1, 2, 3]) {
    markKeymap[`Mod-Alt-${level}`] = (state: any, dispatch: any) => {
      const { $from } = state.selection;
      if ($from.depth < 1) return false;
      const pos = $from.before(1);
      const node = state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'textBlock' || node.attrs.isTitle) return false;
      if (node.attrs.level === level) {
        if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: null }));
      } else {
        if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level }));
      }
      return true;
    };
  }

  // Shift+Cmd+I 首行缩进
  markKeymap['Shift-Mod-i'] = (state: any, dispatch: any) => {
    const { $from } = state.selection;
    if ($from.depth < 1) return false;
    const pos = $from.before(1);
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'textBlock' || node.attrs.isTitle) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: !node.attrs.textIndent }));
    return true;
  };

  // Cmd+Shift+M 添加思考
  markKeymap['Mod-Shift-m'] = (state: any, _dispatch: any, editorView: any) => {
    if (editorView) {
      import('../commands/thought-commands').then(({ addThought }) => addThought(editorView));
    }
    return true;
  };

  if (s.nodes.hardBreak) {
    markKeymap['Shift-Enter'] = (state: any, dispatch: any) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hardBreak.create()));
      return true;
    };
  }

  const blockPlugins = blockRegistry.buildBlockPlugins();

  return [
    columnResizing({ cellMinWidth: 80, View: null as any }),  // 列宽拖拽
    blockSelectionPlugin(),
    indentPlugin(),              // Tab/Shift+Tab — 在 baseKeymap 之前拦截
    slashCommandPlugin(),
    linkClickPlugin(),
    containerKeyboardPlugin(),
    ...blockPlugins,             // Block 专有键盘处理（codeBlock 等）— 在 baseKeymap 之前
    buildInputRules(s),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap(markKeymap),
    keymap(baseKeymap),
    tableKeymapPlugin(),
    blockHandlePlugin(),
    titleGuardPlugin(),
    columnCollapsePlugin(),
    pasteMediaPlugin(),
    smartPastePlugin(),
    renderBlockFocusPlugin(),
    headingCollapsePlugin(),
    vocabHighlightPlugin(),
    fromPageDecorationPlugin,
    thoughtPlugin(),
    history(),
    dropCursor({ color: '#8ab4f8', width: 2 }),
    gapCursor(),
  ];
}

/** 初始加载的顶层 block 数量（约 10 页内容） */
const INITIAL_CHUNK_SIZE = 200;
/** 每次追加的顶层 block 数量 */
const LOAD_MORE_CHUNK_SIZE = 150;

/** 从 doc_content（Atom[]）构建 ProseMirror doc（分片加载） */
function docFromContentChunked(s: ReturnType<typeof getSchema>, docContent: unknown[]): {
  doc: PMNode;
  loadMore: ((count: number) => { nodes: PMNode[]; hasMore: boolean }) | null;
} {
  const atoms = docContent as Atom[];
  // 小文档直接全量加载
  if (atoms.filter(a => !a.parentId).length <= INITIAL_CHUNK_SIZE) {
    try {
      const docJson = converterRegistry.atomsToDoc(atoms);
      return { doc: PMNode.fromJSON(s, docJson), loadMore: null };
    } catch (err) {
      console.error('[NoteEditor] Failed to parse doc_content:', err);
      return { doc: createEmptyDoc(s), loadMore: null };
    }
  }

  // 大文档分片加载
  try {
    const chunked = converterRegistry.atomsToDocChunked(atoms, INITIAL_CHUNK_SIZE);
    const doc = PMNode.fromJSON(s, chunked.doc);

    const loadMore = chunked.hasMore ? (count: number) => {
      const { nodes: jsonNodes, hasMore } = chunked.loadMore(count);
      const pmNodes = jsonNodes.map(n => PMNode.fromJSON(s, n));
      return { nodes: pmNodes, hasMore };
    } : null;

    return { doc, loadMore };
  } catch (err) {
    console.error('[NoteEditor] Failed to parse doc_content (chunked):', err);
    return { doc: createEmptyDoc(s), loadMore: null };
  }
}

/** 创建空文档（noteTitle + 空段落） */
function createEmptyDoc(s: ReturnType<typeof getSchema>): PMNode {
  return s.node('doc', null, [
    s.nodes.textBlock.create({ isTitle: true }),
    s.nodes.textBlock.create(),
  ]);
}

export function NoteEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tocRef = useRef<ReturnType<typeof createTocIndicator> | null>(null);
  const loadSeqRef = useRef(0); // 竞态取消：每次 loadNote 递增
  const loadMoreRef = useRef<((count: number) => { nodes: PMNode[]; hasMore: boolean }) | null>(null);
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fullAtomsRef = useRef<Atom[] | null>(null); // 完整 atoms（分片加载时用于保存未加载部分）
  const loadedTopCountRef = useRef<number>(-1); // 分片加载：已加载的 topLevel atom 数量（-1 = 全量加载）
  const scheduleSaveRef = useRef<() => void>(() => {});

  // 追加更多内容到编辑器末尾
  const appendMoreContent = useCallback(() => {
    const view = viewRef.current;
    const loadMore = loadMoreRef.current;
    if (!view || !loadMore || view.isDestroyed) return;

    const { nodes, hasMore } = loadMore(LOAD_MORE_CHUNK_SIZE);
    if (nodes.length === 0) return;

    // 在文档末尾插入新节点
    const { tr } = view.state;
    for (const node of nodes) {
      tr.insert(tr.doc.content.size, node);
    }
    tr.setMeta('addToHistory', false); // 不计入撤销历史
    view.dispatch(tr);
    loadedTopCountRef.current += nodes.length;

    if (!hasMore) {
      // 所有内容已加载，移除 sentinel
      loadMoreRef.current = null;
      loadedTopCountRef.current = -1;
      sentinelObserverRef.current?.disconnect();
      sentinelRef.current?.remove();
    }
  }, []);

  // 创建/重建编辑器
  const createEditor = useCallback((doc: PMNode) => {
    if (!editorRef.current) return;

    // 清除旧编辑器的 pending save，防止保存到错误文档
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    // 清除旧的 sentinel observer
    sentinelObserverRef.current?.disconnect();
    sentinelRef.current?.remove();

    // 销毁旧编辑器
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const s = getSchema();
    const nodeViews = blockRegistry.buildNodeViews();
    nodeViews['textBlock'] = (node, view, getPos) => {
      if (node.attrs.isTitle) return noteTitleNodeView(node, view, getPos);
      return undefined as any;
    };

    const state = EditorState.create({ doc, plugins: buildPlugins(s) });
    const view = new EditorView(editorRef.current, {
      state,
      nodeViews: nodeViews as any,
      dispatchTransaction(tr) {
        if (view.isDestroyed) return;
        const newState = view.state.apply(tr);
        view.updateState(newState);
        // 文档变化时触发自动保存（排除分片追加的 addToHistory=false 事务）
        if (tr.docChanged && tr.getMeta('addToHistory') !== false) {
          scheduleSaveRef.current();
          tocRef.current?.update();
          // noteTitle 变化时实时同步到 NoteView toolbar
          const titleNode = newState.doc.firstChild;
          if (titleNode?.type.name === 'textBlock' && titleNode.attrs.isTitle) {
            const newTitle = titleNode.textContent || 'Untitled';
            window.dispatchEvent(new CustomEvent('note:title-changed', { detail: newTitle }));
          }
        }
      },
    });

    viewRef.current = view;
    setEditorView(view);

    // TOC 指示器
    if (tocRef.current) tocRef.current.destroy();
    tocRef.current = createTocIndicator(editorRef.current, view);

    // 如果有更多内容待加载，设置 sentinel 元素
    if (loadMoreRef.current) {
      const sentinel = document.createElement('div');
      sentinel.className = 'note-load-more-sentinel';
      sentinel.style.cssText = 'height: 1px; margin-top: -1px;';
      editorRef.current.appendChild(sentinel);
      sentinelRef.current = sentinel;

      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            appendMoreContent();
          }
        }
      }, { rootMargin: '500px' }); // 提前 500px 开始加载
      observer.observe(sentinel);
      sentinelObserverRef.current = observer;
    }
  }, [appendMoreContent]);

  // 加载文档（带竞态取消：快速切换时丢弃过期的异步结果）
  const loadNote = useCallback(async (noteId: string) => {
    console.log('[NoteEditor] loadNote called:', noteId);
    const seq = ++loadSeqRef.current;
    const s = getSchema();
    try {
      const record = await viewAPI.noteLoad(noteId);
      console.log('[NoteEditor] noteLoad returned:', record ? `title="${record.title}", doc_content=${record.doc_content?.length ?? 0} atoms` : 'null');
      if (seq !== loadSeqRef.current) { console.log('[NoteEditor] Stale load, discarding'); return; }
      if (!record || !record.doc_content || record.doc_content.length === 0) {
        loadMoreRef.current = null;
        fullAtomsRef.current = null;
        loadedTopCountRef.current = -1;
        createEditor(createEmptyDoc(s));
      } else {
        const { doc, loadMore } = docFromContentChunked(s, record.doc_content);
        loadMoreRef.current = loadMore;
        // 分片模式下保留原始 atoms 用于部分保存场景
        fullAtomsRef.current = loadMore ? (record.doc_content as Atom[]) : null;
        // 记录初始加载的 topLevel atom 数量
        loadedTopCountRef.current = loadMore ? INITIAL_CHUNK_SIZE : -1;
        createEditor(doc);
      }
      currentNoteIdRef.current = noteId;
      setCurrentNote(noteId);

      // 从 doc 中提取 noteTitle 实际文本，同步到 toolbar 和文件名
      const v = viewRef.current;
      const firstNode = v?.state.doc.firstChild;
      if (firstNode?.type.name === 'textBlock' && firstNode.attrs.isTitle) {
        const docTitle = firstNode.textContent || 'Untitled';
        window.dispatchEvent(new CustomEvent('note:title-changed', { detail: docTitle }));
        viewAPI.setActiveNote(noteId, docTitle);
        // 如果 DB title 与文档标题不一致，仅修正 title 字段（不重新保存全部内容）
        if (record?.title !== docTitle) {
          viewAPI.noteRename(noteId, docTitle);
        }
      } else {
        viewAPI.setActiveNote(noteId, record?.title);
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('[NoteEditor] Failed to load note:', err);
      createEditor(createEmptyDoc(s));
      currentNoteIdRef.current = noteId;
      setCurrentNote(noteId);
    }
  }, [createEditor]);

  // 保存前确保所有内容已加载（防止丢失未渲染的尾部数据）
  const flushRemainingContent = useCallback(() => {
    const view = viewRef.current;
    const loadMore = loadMoreRef.current;
    if (!view || !loadMore || view.isDestroyed) return;

    // 一次性加载所有剩余内容
    let hasMore = true;
    while (hasMore) {
      const result = loadMore(500);
      if (result.nodes.length > 0) {
        const { tr } = view.state;
        for (const node of result.nodes) {
          tr.insert(tr.doc.content.size, node);
        }
        tr.setMeta('addToHistory', false);
        view.dispatch(tr);
      }
      hasMore = result.hasMore;
    }
    loadMoreRef.current = null;
    fullAtomsRef.current = null;
    loadedTopCountRef.current = -1;
    sentinelObserverRef.current?.disconnect();
    sentinelRef.current?.remove();
  }, []);

  // 保存文档
  const saveNote = useCallback(() => {
    const noteId = currentNoteIdRef.current;
    const view = viewRef.current;
    if (!noteId || !view) return;

    const doc = view.state.doc;

    // 提取标题
    let title = 'Untitled';
    doc.forEach((node) => {
      if (node.type.name === 'textBlock' && node.attrs.isTitle && node.textContent) {
        title = node.textContent;
      }
    });

    // PM Doc → Atom[]（编辑器中已加载的部分）
    const loadedAtoms = converterRegistry.docToAtoms(doc);

    // 如果还有未加载的尾部内容，从原始 atoms 中取出拼接（避免 flush 到编辑器导致卡顿）
    const fullAtoms = fullAtomsRef.current;
    const loadedCount = loadedTopCountRef.current;
    if (fullAtoms && loadedCount >= 0) {
      // 从原始 atoms 中找出未加载的 topLevel atoms
      const topLevelAtoms = fullAtoms.filter(a => !a.parentId);
      const unloadedTopIds = new Set(
        topLevelAtoms.slice(loadedCount).map(a => a.id),
      );
      // 递归收集所有后代 atom（容器节点如 columnList > column > block 多级嵌套）
      // 多轮扩展，直到没有新增（处理任意深度嵌套）
      const allIds = new Set(unloadedTopIds);
      let changed = true;
      while (changed) {
        changed = false;
        for (const atom of fullAtoms) {
          if (!allIds.has(atom.id) && atom.parentId && allIds.has(atom.parentId)) {
            allIds.add(atom.id);
            changed = true;
          }
        }
      }
      const tailAtoms = fullAtoms.filter(a => allIds.has(a.id));
      loadedAtoms.push(...tailAtoms);
    }

    viewAPI.noteSave(noteId, loadedAtoms, title);
  }, []);

  // 防抖自动保存（1秒）
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveNote();
      // 保存完成后通知 NoteView（dirty → saved）
      window.dispatchEvent(new CustomEvent('note:saved'));
    }, 1000);
    // 通知 NoteView 有未保存的修改
    window.dispatchEvent(new CustomEvent('note:dirty'));
  }, [saveNote]);
  scheduleSaveRef.current = scheduleSave;

  // 初始化
  useEffect(() => {
    const s = getSchema();

    // 先创建空编辑器
    createEditor(createEmptyDoc(s));

    // 注册 Converter 测试（DevTools console: __testConverters()）
    registerConverterTest(s);

    // 监听打开笔记事件
    const unsubOpen = viewAPI.onNoteOpenInEditor((noteId) => {
      loadNote(noteId);
    });

    // 测试用：直接导入 JSON 文件到编辑器（不走 IPC）
    const onImportJson = (e: Event) => {
      const data = (e as CustomEvent).detail;
      try {
        const pages = data.pages || [];
        const allAtoms: Atom[] = [];
        allAtoms.push(createAtom('noteTitle', {
          children: [{ type: 'text', text: data.bookName || 'Imported' }],
        } as NoteTitleContent));
        for (const page of pages) {
          for (const atom of page.atoms) {
            if (atom.type === 'document') continue;
            allAtoms.push(atom);
          }
        }
        console.log('[NoteEditor] Import JSON: raw atoms:', allAtoms.length, 'types:', allAtoms.map((a: Atom) => a.type));
        const cleaned = sanitizeAtoms(allAtoms);
        console.log('[NoteEditor] After sanitize:', cleaned.length, 'types:', cleaned.map((a: Atom) => a.type));
        const { doc } = docFromContentChunked(s, cleaned);
        loadMoreRef.current = null;
        fullAtomsRef.current = null;
        loadedTopCountRef.current = -1;
        createEditor(doc);
      } catch (err) {
        console.error('[NoteEditor] Import JSON failed:', err);
      }
    };
    window.addEventListener('note:import-json', onImportJson);

    // 恢复上次打开的笔记
    const unsubRestore = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeNoteId) {
        loadNote(state.activeNoteId);
      }
    });

    // 拉取导入时设置的 pending noteId，或恢复上次打开的笔记
    viewAPI.notePendingOpen().then(async (noteId) => {
      if (noteId) {
        console.log('[NoteEditor] Pending note found:', noteId);
        loadNote(noteId);
        return;
      }
      // No pending note — restore last opened note from workspace state
      // Wait for DB to be ready before loading
      const dbReady = await viewAPI.isDBReady();
      if (!dbReady) {
        await new Promise<void>(resolve => {
          const unsub = viewAPI.onDBReady(() => { unsub(); resolve(); });
        });
      }
      if (currentNoteIdRef.current) return; // already loaded by another path
      const activeId = await viewAPI.getActiveNoteId();
      if (activeId && !currentNoteIdRef.current) {
        console.log('[NoteEditor] Restoring last note:', activeId);
        loadNote(activeId);
      }
    });

    // 生词本同步：加载初始词表 + 监听变化
    function applyVocab(entries: { word: string; definition: string }[]) {
      updateVocabDefs(entries);
      updateVocabList(entries as any);
      const view = viewRef.current;
      if (view) {
        dispatchVocabUpdate(view, entries.map(e => e.word));
      }
    }

    viewAPI.listVocabWords?.().then(entries => {
      if (entries) applyVocab(entries);
    });

    const unsubVocab = viewAPI.onVocabChanged?.(applyVocab) || (() => {});

    // 加载测试文档（Help 菜单）
    const unsubTestDoc = viewAPI.onLoadTestDoc(() => {
      currentNoteIdRef.current = null; // 测试文档不保存到数据库
      createEditor(buildTestDocument(s));
    });

    // 标题外部变更同步
    const unsubTitle = viewAPI.onNoteTitleChanged(({ noteId, title }) => {
      if (noteId !== currentNoteIdRef.current) return;
      const view = viewRef.current;
      if (!view) return;
      // 找到 noteTitle 节点并更新
      let titlePos = -1;
      view.state.doc.forEach((node, offset) => {
        if (titlePos < 0 && node.type.name === 'textBlock' && node.attrs.isTitle) {
          titlePos = offset;
        }
      });
      if (titlePos >= 0) {
        const titleNode = view.state.doc.nodeAt(titlePos);
        if (titleNode && titleNode.textContent !== title) {
          const tr = view.state.tr;
          tr.replaceWith(titlePos + 1, titlePos + titleNode.nodeSize - 1,
            title ? s.text(title) : s.text(''));
          view.dispatch(tr);
        }
      }
    });

    // 监听手动保存事件（来自 NoteView Toolbar 的 Save 按钮）
    const manualSaveHandler = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveNote();
      window.dispatchEvent(new CustomEvent('note:saved'));
    };
    window.addEventListener('note:save', manualSaveHandler);

    return () => {
      unsubOpen();
      unsubRestore();
      unsubTestDoc();
      unsubTitle();
      unsubVocab();
      window.removeEventListener('note:import-json', onImportJson);
      window.removeEventListener('note:save', manualSaveHandler);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveNote(); // 关闭前保存
      }
      if (tocRef.current) {
        tocRef.current.destroy();
        tocRef.current = null;
      }
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [createEditor, loadNote, saveNote]);

  // ── AI Sync: listen for 'as:append-turn' ViewMessage ──
  useEffect(() => {
    const unsub = viewAPI.onMessage((msg: any) => {
      if (msg.protocol === 'ai-sync' && msg.action === 'as:append-turn') {
        const view = viewRef.current;
        if (!view || view.isDestroyed) return;
        import('../ai-workflow/sync-note-receiver').then(({ appendTurnToEditor }) => {
          appendTurnToEditor(view, msg.payload);
        });
      }
    });
    return unsub;
  }, []);

  return (
    <div style={styles.container}>
      <div ref={editorRef} style={styles.editor} />
      <SlashMenu view={editorView} />
      <FloatingToolbar view={editorView} />
      <HandleMenu view={editorView} />
      <ContextMenu view={editorView} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    background: '#1a1a1a',
  },
  editor: {
    maxWidth: '900px',
    margin: '0 auto',
    minHeight: '100%',
    position: 'relative' as const,
  },
};
