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
import { linkClickPlugin, setCurrentNote, flushPendingAnchor, canGoBack, goBack } from '../plugins/link-click';
import { tableKeymapPlugin } from '../blocks/table';
import { columnResizing } from 'prosemirror-tables';
import { SlashMenu } from './SlashMenu';
import { FloatingToolbar } from './FloatingToolbar';
import { HandleMenu } from './HandleMenu';
import { ContextMenu } from './ContextMenu';
import { AskAIPanel } from './AskAIPanel';
import { updateSelectionCache, clearSelectionCache, startMouseSelectionTracker } from '../commands/selection-cache';
import { blockHandlePlugin } from '../plugins/block-handle';
import { blockSelectionPlugin } from '../plugins/block-selection';
import { indentPlugin } from '../plugins/indent';
import { pasteMediaPlugin } from '../plugins/paste-media';
import { smartPastePlugin } from '../paste/smart-paste-plugin';
import { renderBlockFocusPlugin } from '../plugins/render-block-focus';
import { vocabHighlightPlugin, updateVocabDefs, dispatchVocabUpdate } from '../learning/vocab-highlight-plugin';
import { thoughtPlugin } from '../plugins/thought-plugin';
import { blockFramePlugin } from '../plugins/block-frame';
import { fromPageDecorationPlugin } from '../plugins/from-page-decoration';
import { updateVocabList } from '../learning';
import { buildTestDocument } from '../test-content';
import { createTocIndicator } from '../toc/toc-indicator';
import { headingCollapsePlugin } from '../plugins/heading-collapse';
import { titleGuardPlugin } from '../plugins/title-guard';
import { columnCollapsePlugin } from '../plugins/column-collapse';
import { registerConverterTest } from '../converters/converter-test';
import { converterRegistry } from '../converters/registry';
import { setTextBlockLevel } from '../commands/set-text-block-level';
import { toggleTextIndent } from '../commands/editor-commands';
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
  noteCreate: (title?: string) => Promise<{ id: string; title: string } | null>;
  noteLoad: (id: string) => Promise<any>;
  noteSave: (id: string, docContent: unknown[], title: string) => Promise<void>;
  noteRename: (id: string, title: string) => Promise<void>;
  noteOpenInEditor: (id: string) => Promise<void>;
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  onNoteDeleted: (callback: (noteId: string) => void) => () => void;
  notePendingOpen: () => Promise<string | null>;
  setActiveNote: (noteId: string | null, noteTitle?: string) => Promise<void>;
  getActiveNoteId: () => Promise<string | null>;
  getMyRole: () => Promise<'primary' | 'companion' | null>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null; rightActiveNoteId?: string | null }) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
  onLoadTestDoc: (callback: () => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  markdownToPMNodes: (markdown: string) => Promise<unknown[]>;
  listVocabWords?: () => Promise<{ word: string; definition: string }[]>;
  onVocabChanged?: (callback: (entries: { word: string; definition: string }[]) => void) => () => void;
  // AI Sync
  onMessage: (callback: (message: any) => void) => () => void;
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  aiParseMarkdown: (markdown: string) => Promise<{ success: boolean; atoms: any[]; error?: string }>;
  aiExtractionCacheWrite?: (payload: any) => Promise<any>;
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

  // 找到光标所在的 textBlock（任意嵌套深度），返回 { pos, node }；
  // 找不到、是标题块、或被选中的不是 textBlock 时返回 null。
  // 与 HandleMenu 的 menu.pos 路径等价：操作总是落在"当前 block"上。
  const resolveTextBlock = (state: any): { pos: number; node: PMNode } | null => {
    const { $from } = state.selection;
    for (let d = $from.depth; d >= 1; d--) {
      const node = $from.node(d);
      if (node.type.name === 'textBlock') {
        if (node.attrs.isTitle) return null;
        return { pos: $from.before(d), node };
      }
    }
    return null;
  };

  // Cmd+Alt+0/1/2/3 标题切换 — 与 HandleMenu 中"切换 textBlock level"走同一函数
  markKeymap['Mod-Alt-0'] = (state: any, dispatch: any) => {
    const target = resolveTextBlock(state);
    if (!target) return false;
    const tr = setTextBlockLevel(state, target.pos, null);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
  for (const level of [1, 2, 3]) {
    markKeymap[`Mod-Alt-${level}`] = (state: any, dispatch: any) => {
      const target = resolveTextBlock(state);
      if (!target) return false;
      const nextLevel = target.node.attrs.level === level ? null : level;
      const tr = setTextBlockLevel(state, target.pos, nextLevel);
      if (!tr) return false;
      if (dispatch) dispatch(tr);
      return true;
    };
  }

  // Shift+Cmd+I 首行缩进 — 与 HandleMenu 中 textIndent toggle 走同一函数
  markKeymap['Shift-Mod-i'] = (_state: any, _dispatch: any, editorView: any) => {
    if (!editorView) return false;
    const target = resolveTextBlock(editorView.state);
    if (!target) return false;
    return toggleTextIndent(editorView, target.pos);
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
    blockFramePlugin(),
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
        // 更新选区缓存（供 ContextMenu 问 AI 等使用）
        updateSelectionCache(view);
        // 文档变化时触发自动保存（排除分片追加的 addToHistory=false 事务）
        if (tr.docChanged && tr.getMeta('addToHistory') !== false) {
          // AI sync: notify peer slot that user is typing (debounce source)
          // Skip when the tr originates from sync insertion itself.
          if (tr.getMeta('ai-sync') !== true) {
            viewAPI.sendToOtherSlot({
              protocol: 'ai-sync',
              action: 'as:note-status',
              payload: {
                open: true,
                lastTypedAt: Date.now(),
                noteId: currentNoteIdRef.current,
              },
            });
          }
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

    // 鼠标选区追踪（ProseMirror 鼠标拖选不经过 dispatchTransaction）
    const cleanupMouseTracker = startMouseSelectionTracker(view);
    (view as any).__cleanupMouseTracker = cleanupMouseTracker;

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
    const seq = ++loadSeqRef.current;
    const s = getSchema();

    // graceful fallback：noteId 不存在或加载失败 → 显示空编辑器 + 清除 session 中的引用
    const fallbackToEmpty = (reason: string) => {
      console.warn(`[NoteEditor] ${reason} — fallback to empty editor`);
      loadMoreRef.current = null;
      fullAtomsRef.current = null;
      loadedTopCountRef.current = -1;
      createEditor(createEmptyDoc(s));
      currentNoteIdRef.current = null;
      setCurrentNote(null);
      // 清除 workspace state 中的陈旧 activeNoteId，避免下次启动又卡在同一个 note
      viewAPI.setActiveNote(null, undefined);
      window.dispatchEvent(new CustomEvent('note:title-changed', { detail: 'Untitled' }));
    };

    try {
      const record = await viewAPI.noteLoad(noteId);
      if (seq !== loadSeqRef.current) { return; }

      // note 不存在 → graceful fallback
      if (!record) {
        fallbackToEmpty(`Note ${noteId} not found in DB`);
        return;
      }

      if (!record.doc_content || record.doc_content.length === 0) {
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

      // 跨文档 block 链接：笔记加载完成后滚动到目标锚点
      const v2 = viewRef.current;
      if (v2) flushPendingAnchor(v2);

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
      // 坏数据导致 schema 解析失败 → 视为加载失败，fallback
      fallbackToEmpty(`Note ${noteId} load threw: ${(err as Error)?.message || err}`);
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
  const saveNote = useCallback(async () => {
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

    await viewAPI.noteSave(noteId, loadedAtoms, title);
  }, []);

  // 防抖自动保存（1秒）
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveNote();
        // 保存完成后通知 NoteView（dirty → saved）
        window.dispatchEvent(new CustomEvent('note:saved'));
      } catch (err) {
        console.error('[NoteEditor] Auto-save failed:', err);
      }
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

    // 监听笔记删除事件：如果是当前编辑的笔记，取消 auto-save 并导航到上一个
    const unsubDeleted = viewAPI.onNoteDeleted((deletedId) => {
      if (currentNoteIdRef.current !== deletedId) return;
      // 取消待执行的 auto-save
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      currentNoteIdRef.current = null;
      // 导航到历史中的上一篇笔记
      if (canGoBack()) {
        goBack();
      } else {
        // 无历史，清除编辑器
        viewRef.current?.destroy();
        viewRef.current = null;
      }
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
        const cleaned = sanitizeAtoms(allAtoms);
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

    // Import Markdown：为每个 .md 文件创建新笔记，最后一个加载到编辑器
    const onImportMarkdown = async (e: Event) => {
      const files = (e as CustomEvent).detail as { markdown: string; title: string }[];
      if (!Array.isArray(files) || files.length === 0) return;
      try {
        for (const { markdown, title } of files) {
          // 创建新笔记
          const note = await viewAPI.noteCreate(title);
          if (!note) { console.error('[NoteEditor] Import Markdown: noteCreate failed'); continue; }

          // Markdown → ProseMirror JSON nodes
          const pmNodes = await viewAPI.markdownToPMNodes(markdown);
          if (!Array.isArray(pmNodes) || pmNodes.length === 0) {
            // 空内容，跳过（笔记已创建，NavSide 可见）
            continue;
          }

          // 构建完整 doc（noteTitle + 转换后的内容节点）
          const titleNode = s.nodes.textBlock.create(
            { isTitle: true },
            title ? s.text(title) : undefined,
          );
          const contentNodes = pmNodes
            .map(n => { try { return PMNode.fromJSON(s, n as any); } catch { return null; } })
            .filter((n): n is PMNode => !!n);
          const doc = s.node('doc', null, [titleNode, ...contentNodes]);

          // 如果正在编辑某笔记，先保存
          if (currentNoteIdRef.current && viewRef.current) {
            await saveNote();
          }

          // 加载到编辑器
          loadMoreRef.current = null;
          fullAtomsRef.current = null;
          loadedTopCountRef.current = -1;
          currentNoteIdRef.current = note.id;
          setCurrentNote(note.id);
          createEditor(doc);

          // 立即保存（将 PM doc 持久化为 Atom[] 到 DB）
          await saveNote();
        }
      } catch (err) {
        console.error('[NoteEditor] Import Markdown failed:', err);
      }
    };
    window.addEventListener('note:import-markdown', onImportMarkdown);

    // 恢复上次打开的笔记（根据所在 slot 选取正确的 noteId）
    const unsubRestore = viewAPI.onRestoreWorkspaceState(async (state: any) => {
      const role = await viewAPI.getMyRole();
      const noteId = role === 'companion' ? state.rightActiveNoteId : state.activeNoteId;
      if (noteId) loadNote(noteId);
    });

    // 拉取导入时设置的 pending noteId，或恢复上次打开的笔记
    viewAPI.notePendingOpen().then(async (noteId) => {
      if (noteId) {
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
    const manualSaveHandler = async () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      try {
        await saveNote();
        window.dispatchEvent(new CustomEvent('note:saved'));
      } catch (err) {
        console.error('[NoteEditor] Manual save failed:', err);
      }
    };
    window.addEventListener('note:save', manualSaveHandler);

    return () => {
      unsubOpen();
      unsubDeleted();
      unsubRestore();
      unsubTestDoc();
      unsubTitle();
      unsubVocab();
      window.removeEventListener('note:import-json', onImportJson);
      window.removeEventListener('note:import-markdown', onImportMarkdown);
      window.removeEventListener('note:save', manualSaveHandler);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveNote(); // 关闭前保存
      }
      if (tocRef.current) {
        tocRef.current.destroy();
        tocRef.current = null;
      }
      clearSelectionCache();
      if (viewRef.current) {
        (viewRef.current as any).__cleanupMouseTracker?.();
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [createEditor, loadNote, saveNote]);

  // ── AI Sync: listen for 'as:append-turn' ViewMessage ──
  // Serialize inserts: insertTurnIntoNote awaits IPC markdown parse, so two
  // turns arriving back-to-back would race and can finish out of order (a
  // shorter second turn lands before a longer first turn). Chain through a
  // single queue so order matches arrival.
  useEffect(() => {
    let queue: Promise<void> = Promise.resolve();
    let lastAppendFingerprint = '';
    let lastAppendAt = 0;
    const writeReceipt = async (payload: any) => {
      try {
        await viewAPI.aiExtractionCacheWrite?.(payload);
      } catch {}
    };
    const unsub = viewAPI.onMessage((msg: any) => {
      if (msg.protocol === 'ai-sync' && msg.action === 'as:append-turn') {
        const sourceId = String(msg.payload?.source?.serviceId || '');
        const turn = msg.payload?.turn || {};
        const extractionId = String(msg.payload?.debug?.extractionId || `note-${Date.now()}`);
        const noteId = currentNoteIdRef.current ?? null;
        const fingerprint = JSON.stringify({
          sourceId,
          index: turn.index ?? null,
          userMessage: turn.userMessage ?? '',
          markdown: turn.markdown ?? '',
        });
        void writeReceipt({
          extractionId,
          stage: 'note-received',
          serviceId: sourceId || 'unknown',
          msgIndex: turn.index ?? -1,
          userMessage: turn.userMessage ?? '',
          markdown: turn.markdown ?? '',
          meta: {
            noteId,
            sourceName: String(msg.payload?.source?.serviceName || ''),
          },
        });
        const now = Date.now();
        if (fingerprint === lastAppendFingerprint && (now - lastAppendAt) < 15000) {
          void writeReceipt({
            extractionId,
            stage: 'note-duplicate-skip',
            serviceId: sourceId || 'unknown',
            msgIndex: turn.index ?? -1,
            userMessage: turn.userMessage ?? '',
            markdown: turn.markdown ?? '',
            meta: { noteId },
          });
          return;
        }
        lastAppendFingerprint = fingerprint;
        lastAppendAt = now;
        queue = queue.then(async () => {
          const view = viewRef.current;
          if (!view || view.isDestroyed || !currentNoteIdRef.current) {
            await writeReceipt({
              extractionId,
              stage: 'note-no-active-note',
              serviceId: sourceId || 'unknown',
              msgIndex: turn.index ?? -1,
              userMessage: turn.userMessage ?? '',
              markdown: turn.markdown ?? '',
              meta: { noteId: currentNoteIdRef.current ?? null },
            });
            // No target note (view torn down, note deleted) — tell peer so
            // it can pause the sync toggle and surface a warning.
            viewAPI.sendToOtherSlot({
              protocol: 'ai-sync',
              action: 'as:insert-failed',
              payload: { reason: 'no-active-note' },
            });
            return;
          }
          await writeReceipt({
            extractionId,
            stage: 'note-insert-start',
            serviceId: sourceId || 'unknown',
            msgIndex: turn.index ?? -1,
            userMessage: turn.userMessage ?? '',
            markdown: turn.markdown ?? '',
            meta: { noteId: currentNoteIdRef.current },
          });
          const { insertTurnIntoNote } = await import('../ai-workflow/sync-note-receiver');
          await insertTurnIntoNote(view, msg.payload);
          await writeReceipt({
            extractionId,
            stage: 'note-insert-success',
            serviceId: sourceId || 'unknown',
            msgIndex: turn.index ?? -1,
            userMessage: turn.userMessage ?? '',
            markdown: turn.markdown ?? '',
            meta: { noteId: currentNoteIdRef.current },
          });
        }).catch(err => {
          console.warn('[SyncNote] insert failed:', err);
          void writeReceipt({
            extractionId,
            stage: 'note-insert-failed',
            serviceId: sourceId || 'unknown',
            msgIndex: turn.index ?? -1,
            userMessage: turn.userMessage ?? '',
            markdown: turn.markdown ?? '',
            meta: {
              noteId: currentNoteIdRef.current ?? null,
              error: String(err),
            },
          });
          viewAPI.sendToOtherSlot({
            protocol: 'ai-sync',
            action: 'as:insert-failed',
            payload: { reason: String(err) },
          });
        });
      } else if (msg.protocol === 'ai-sync' && msg.action === 'as:import-conversation') {
        const { title, turns, source } = msg.payload ?? {} as any;
        if (!Array.isArray(turns) || turns.length === 0) return;
        queue = queue.then(async () => {
          const view = viewRef.current;
          if (!view || view.isDestroyed || !currentNoteIdRef.current) return;

          // Insert title as heading
          const { schema } = view.state;
          const headingType = schema.nodes.heading;
          if (headingType && title) {
            const headingNode = headingType.create(
              { level: 2 },
              [schema.text(String(title))],
            );
            const tr = view.state.tr;
            tr.setMeta('ai-sync', true);
            const pos = view.state.doc.content.size;
            tr.insert(pos, headingNode);
            view.dispatch(tr);
          }

          // Insert each turn sequentially
          const { insertTurnIntoNote } = await import('../ai-workflow/sync-note-receiver');
          for (const turn of turns) {
            await insertTurnIntoNote(view, {
              turn: {
                index: turn.index,
                userMessage: turn.userMessage ?? '',
                markdown: turn.markdown ?? '',
                timestamp: turn.timestamp ?? Date.now(),
              },
              source: source ?? { serviceId: 'claude', serviceName: 'Claude' },
            });
          }
          console.log(`[SyncNote] Imported conversation "${title}": ${turns.length} turns`);
        }).catch(err => {
          console.warn('[SyncNote] import-conversation failed:', err);
        });
      } else if (msg.protocol === 'ai-sync' && msg.action === 'as:probe') {
        // Peer asks "are you open?" — reply immediately.
        viewAPI.sendToOtherSlot({
          protocol: 'ai-sync',
          action: 'as:note-status',
          payload: { open: true, lastTypedAt: 0, noteId: currentNoteIdRef.current },
        });
      }
    });
    return unsub;
  }, []);

  // Broadcast open/close so the AI sync engine can pause when the note
  // view is unmounted (user closed the right slot). Note switches inside
  // this component are announced from within loadNote() — no extra effect
  // needed here.
  useEffect(() => {
    viewAPI.sendToOtherSlot({
      protocol: 'ai-sync',
      action: 'as:note-status',
      payload: { open: true, lastTypedAt: 0, noteId: currentNoteIdRef.current },
    });
    return () => {
      viewAPI.sendToOtherSlot({
        protocol: 'ai-sync',
        action: 'as:note-status',
        payload: { open: false, lastTypedAt: 0, noteId: null },
      });
    };
  }, []);

  return (
    <div style={styles.container}>
      <div ref={editorRef} style={styles.editor} />
      <SlashMenu view={editorView} />
      <FloatingToolbar view={editorView} />
      <HandleMenu view={editorView} />
      <ContextMenu view={editorView} />
      <AskAIPanel view={editorView} />
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
