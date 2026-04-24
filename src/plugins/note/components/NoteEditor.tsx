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
import { linkClickPlugin, flushPendingAnchor, canGoBack, goBack } from '../plugins/link-click';
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
 * L1 编辑器内核对外暴露的命令句柄。
 * Step 1 (feature/noteview-layer-refactor)：双轨期，NoteEditor 内部仍保留
 * 现有 viewAPI 路径；外层容器可通过 onReady 捕获 handle 用于按需拉取数据。
 */
export interface NoteEditorHandle {
  /** 逃生舱：当前 ProseMirror EditorView。销毁期间可能为 null。 */
  view: EditorView | null;
  /** 按需把当前文档序列化为 Atom[]（拉模式，避免 onDocChanged 里同步 O(N) 转换）。 */
  getDocAtoms: () => Atom[];
  /** 取当前 noteTitle 节点的文本（空则返回 'Untitled'）。 */
  getTitle: () => string;
  /** 用 Atom[] 重建整个文档。 */
  replaceDoc: (atoms: Atom[]) => void;
  /** 在指定位置（缺省为文末）插入一段 atoms。 */
  insertAtoms: (atoms: Atom[], pos?: number) => void;
  /** 让编辑器获得焦点。 */
  focus: () => void;
  /** 滚动到指定顶层 block 索引（书签跳转用）。 */
  scrollToTopBlockIndex: (index: number) => void;
  /** 当前 scroll 顶部可见的顶层 block 索引（用于持久化阅读位置）。 */
  getTopBlockIndexAtScroll: () => number;
  /** 外部重命名：把编辑器里的 noteTitle 节点文本改为指定值（不派发 dirty）。 */
  setTitleText: (text: string) => void;
  /** 触发 link-click 插件的 pending anchor 滚动（跨文档 block 链接）。 */
  flushPendingAnchor: () => void;
  /** 当前顶层 block 数量（供书签面板做失效清理）。 */
  getTopBlockCount: () => number;
  /** AI Sync：把一条对话轮次插到文末（内部调 insertTurnIntoNote，带 ai-sync meta）。 */
  insertAiTurn: (payload: unknown) => Promise<void>;
  /** AI Sync：在文末插入一个 heading（import-conversation 用）。 */
  insertHeadingAtEnd: (title: string, level?: number) => void;
  /** 加载测试文档（Help 菜单）—— 不进 DB，直接替换编辑器内容。 */
  loadTestDocument: () => void;
}

/**
 * NoteEditor props。Step 1 全部可选 —— 外层传入即使用推模式的"脏信号"，
 * 不传则完全沿用现有 viewAPI 路径，行为零变化。
 */
export interface NoteEditorProps {
  /**
   * 文档内容变化（tr.docChanged=true）时的轻量信号。不传递数据，序列化成本归 NoteView。
   * info.aiSync 区分"AI Sync 插入"vs"用户实际编辑"；NoteView 用它决定是否广播
   * typing note-status（避免自反射）。
   */
  onDocChanged?: (info: { aiSync: boolean }) => void;
  /** noteTitle 节点文本变化时触发。 */
  onTitleChanged?: (title: string) => void;
  /** 编辑器首次就绪时回调，外层可保存 handle 供后续命令式操作。 */
  onReady?: (handle: NoteEditorHandle) => void;
  /** 当前编辑的笔记 id —— AI Sync 的协议 payload 需要带上，用于跨 slot 投递识别。 */
  activeNoteId?: string | null;
  /**
   * 变体：
   * - 'note' (默认)：完整 Note 能力，含 noteTitle 节点、titleGuard、thoughtPlugin
   * - 'thought'：作为 NoteView 的变体，无 noteTitle、禁用 titleGuard/thoughtPlugin
   *   （thoughtPlugin 自嵌套会递归），其余编辑能力全部继承
   */
  variant?: 'note' | 'thought';
}

/**
 * NoteEditor — ProseMirror 编辑器 React 组件
 *
 * 从 SurrealDB 加载文档，自动保存。
 * 不再使用内存测试文档。
 */

declare const viewAPI: {
  // NoteEditor 自身还用到的 viewAPI（Import Markdown + 生词本 + 删除导航）
  noteCreate: (title?: string) => Promise<{ id: string; title: string } | null>;
  noteSave: (id: string, docContent: unknown[], title: string) => Promise<void>;
  noteOpenInEditor: (id: string) => Promise<void>;
  onNoteDeleted: (callback: (noteId: string) => void) => () => void;
  markdownToPMNodes: (markdown: string) => Promise<unknown[]>;
  listVocabWords?: () => Promise<{ word: string; definition: string }[]>;
  onVocabChanged?: (callback: (entries: { word: string; definition: string }[]) => void) => () => void;
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
function buildPlugins(s: ReturnType<typeof getSchema>, variant: 'note' | 'thought') {
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

  const isThought = variant === 'thought';

  return [
    // columnResizing 必须在编辑器装配处手动注册，不能下沉到 tableBlock.plugin：
    // 它有全局 PluginKey（tableColumnResizing$），整个编辑器只能存在一个实例。
    // 见 docs/block/table.md §十二。
    columnResizing({ cellMinWidth: 80, View: null as any }),
    blockSelectionPlugin(),
    indentPlugin(),              // Tab/Shift+Tab — 在 baseKeymap 之前拦截
    slashCommandPlugin(),
    linkClickPlugin(),
    containerKeyboardPlugin(),
    ...blockPlugins,             // Block 专有键盘/行为（codeBlock Tab、tableKeymap、tableEditing 等）— 在 baseKeymap 之前
    buildInputRules(s),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap(markKeymap),
    keymap(baseKeymap),
    blockHandlePlugin(),
    // Thought 变体跳过 titleGuardPlugin（无 noteTitle 节点可守护）
    // 和 thoughtPlugin（避免自嵌套递归）；其余编辑能力完整继承
    ...(isThought ? [] : [titleGuardPlugin()]),
    columnCollapsePlugin(),
    pasteMediaPlugin(),
    smartPastePlugin(),
    renderBlockFocusPlugin(),
    headingCollapsePlugin(),
    vocabHighlightPlugin(),
    fromPageDecorationPlugin,
    ...(isThought ? [] : [thoughtPlugin()]),
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

/**
 * Thought 变体：converterRegistry.atomsToDoc 会硬补一个 isTitle=true 的 noteTitle
 * 节点，这里在加载时剥掉，并保证至少有一个 textBlock。
 */
function stripNoteTitleFromDocJson(docJson: any): any {
  if (!docJson?.content) return docJson;
  const filtered = docJson.content.filter(
    (n: any) => !(n.type === 'textBlock' && n.attrs?.isTitle),
  );
  docJson.content = filtered.length > 0
    ? filtered
    : [{ type: 'textBlock', attrs: { isTitle: false } }];
  return docJson;
}

/** 从 doc_content（Atom[]）构建 ProseMirror doc（分片加载） */
function docFromContentChunked(
  s: ReturnType<typeof getSchema>,
  docContent: unknown[],
  variant: 'note' | 'thought' = 'note',
): {
  doc: PMNode;
  loadMore: ((count: number) => { nodes: PMNode[]; hasMore: boolean }) | null;
} {
  const atoms = docContent as Atom[];
  const isThought = variant === 'thought';
  // 小文档直接全量加载
  if (atoms.filter(a => !a.parentId).length <= INITIAL_CHUNK_SIZE) {
    try {
      let docJson = converterRegistry.atomsToDoc(atoms);
      if (isThought) docJson = stripNoteTitleFromDocJson(docJson);
      return { doc: PMNode.fromJSON(s, docJson), loadMore: null };
    } catch (err) {
      console.error('[NoteEditor] Failed to parse doc_content:', err);
      return { doc: createEmptyDoc(s, variant), loadMore: null };
    }
  }

  // 大文档分片加载（Thought 场景下不会走这里 —— 单条 thought 很小 —— 但保持一致性）
  try {
    const chunked = converterRegistry.atomsToDocChunked(atoms, INITIAL_CHUNK_SIZE);
    const initialDocJson = isThought ? stripNoteTitleFromDocJson(chunked.doc) : chunked.doc;
    const doc = PMNode.fromJSON(s, initialDocJson);

    const loadMore = chunked.hasMore ? (count: number) => {
      const { nodes: jsonNodes, hasMore } = chunked.loadMore(count);
      const pmNodes = jsonNodes.map(n => PMNode.fromJSON(s, n));
      return { nodes: pmNodes, hasMore };
    } : null;

    return { doc, loadMore };
  } catch (err) {
    console.error('[NoteEditor] Failed to parse doc_content (chunked):', err);
    return { doc: createEmptyDoc(s, variant), loadMore: null };
  }
}

/** 创建空文档。variant='thought' 时不创建 noteTitle 节点。 */
function createEmptyDoc(
  s: ReturnType<typeof getSchema>,
  variant: 'note' | 'thought' = 'note',
): PMNode {
  if (variant === 'thought') {
    return s.node('doc', null, [s.nodes.textBlock.create()]);
  }
  return s.node('doc', null, [
    s.nodes.textBlock.create({ isTitle: true }),
    s.nodes.textBlock.create(),
  ]);
}

/** 找 scroll 容器顶部可见的顶层 block 索引（0 = 第一个顶层 block） */
function getTopBlockIndexAtScroll(view: EditorView, scrollContainer: HTMLElement): number {
  if (view.isDestroyed) return 0;
  const r = scrollContainer.getBoundingClientRect();
  const result = view.posAtCoords({ left: r.left + 16, top: r.top + 4 });
  if (!result) return 0;
  const doc = view.state.doc;
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const size = doc.child(i).nodeSize;
    if (result.pos < offset + size) return i;
    offset += size;
  }
  return Math.max(0, doc.childCount - 1);
}

/** 把 scroll 容器滚到指定索引的顶层 block */
/** 从 view + fullAtomsRef 生成全量 atoms（含未加载尾部）。
 *  提取为 module 级 helper 供 buildHandle 和 TOC getAtoms 共享。 */
function buildFullAtoms(
  view: EditorView | null,
  fullAtoms: Atom[] | null,
  loadedCount: number,
): Atom[] {
  if (!view || view.isDestroyed) return [];
  const loadedAtoms = converterRegistry.docToAtoms(view.state.doc);
  if (fullAtoms && loadedCount >= 0) {
    const topLevelAtoms = fullAtoms.filter(a => !a.parentId);
    const unloadedTopIds = new Set(topLevelAtoms.slice(loadedCount).map(a => a.id));
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
    loadedAtoms.push(...fullAtoms.filter(a => allIds.has(a.id)));
  }
  return loadedAtoms;
}

function scrollToTopBlockIndex(view: EditorView, scrollContainer: HTMLElement, index: number): void {
  if (view.isDestroyed || index <= 0) return;
  const doc = view.state.doc;
  if (index >= doc.childCount) return;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  try {
    const coords = view.coordsAtPos(pos + 1);
    const r = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTop += coords.top - r.top;
  } catch { /* ignore */ }
}

export function NoteEditor(props: NoteEditorProps = {}) {
  const { onDocChanged, onTitleChanged, onReady, activeNoteId, variant = 'note' } = props;
  const isThought = variant === 'thought';
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const tocRef = useRef<ReturnType<typeof createTocIndicator> | null>(null);
  const loadMoreRef = useRef<((count: number) => { nodes: PMNode[]; hasMore: boolean }) | null>(null);
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fullAtomsRef = useRef<Atom[] | null>(null); // 完整 atoms（分片加载时用于保存未加载部分）
  const loadedTopCountRef = useRef<number>(-1); // 分片加载：已加载的 topLevel atom 数量（-1 = 全量加载）
  // Step 1：外层回调 ref 化 —— 不进 useEffect 依赖数组，避免回调身份变化
  // 导致整个编辑器重 init（会清空已加载的笔记内容和标题）。
  const onDocChangedRef = useRef(onDocChanged);
  const onTitleChangedRef = useRef(onTitleChanged);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onDocChangedRef.current = onDocChanged; }, [onDocChanged]);
  useEffect(() => { onTitleChangedRef.current = onTitleChanged; }, [onTitleChanged]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  const handleEmittedRef = useRef(false);
  // Step 3：接收外层传入的 activeNoteId，供 AI Sync / dispatchTransaction 的
  // note-status payload 使用。NoteView 在 loadNote 成功后通过 prop 下传。
  useEffect(() => {
    currentNoteIdRef.current = activeNoteId ?? null;
  }, [activeNoteId]);

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

    const state = EditorState.create({ doc, plugins: buildPlugins(s, variant) });
    const view = new EditorView(editorRef.current, {
      state,
      nodeViews: nodeViews as any,
      dispatchTransaction(tr) {
        if (view.isDestroyed) return;
        const newState = view.state.apply(tr);
        view.updateState(newState);
        // 更新选区缓存（供 ContextMenu 问 AI 等使用）
        updateSelectionCache(view);
        // 文档变化时发脏信号（排除分片追加的 addToHistory=false 事务）
        if (tr.docChanged && tr.getMeta('addToHistory') !== false) {
          const aiSync = tr.getMeta('ai-sync') === true;
          // 向外层发脏信号（推拉结合的"推"），NoteView 负责防抖 + 写盘 + typing 广播
          onDocChangedRef.current?.({ aiSync });
          tocRef.current?.update();
          // noteTitle 变化通过 prop 回调通知 NoteView（Thought 无标题，跳过）
          if (!isThought) {
            const titleNode = newState.doc.firstChild;
            if (titleNode?.type.name === 'textBlock' && titleNode.attrs.isTitle) {
              const newTitle = titleNode.textContent || 'Untitled';
              onTitleChangedRef.current?.(newTitle);
            }
          }
        }
      },
    });

    viewRef.current = view;
    setEditorView(view);

    // 鼠标选区追踪（ProseMirror 鼠标拖选不经过 dispatchTransaction）
    const cleanupMouseTracker = startMouseSelectionTracker(view);
    (view as any).__cleanupMouseTracker = cleanupMouseTracker;

    // TOC 指示器（Thought 单条文档太短，不需要）
    if (tocRef.current) tocRef.current.destroy();
    tocRef.current = isThought
      ? null
      : createTocIndicator(
          editorRef.current,
          view,
          () => buildFullAtoms(viewRef.current, fullAtomsRef.current, loadedTopCountRef.current),
        );

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
  }, [appendMoreContent, variant, isThought]);

  // Step 1：命令句柄 —— 外层通过 onReady 拿到，用于按需拉取数据或命令式操作
  const buildHandle = useCallback((): NoteEditorHandle => ({
    get view() { return viewRef.current; },
    getDocAtoms: () => buildFullAtoms(viewRef.current, fullAtomsRef.current, loadedTopCountRef.current),
    getTitle: () => {
      const view = viewRef.current;
      if (!view || view.isDestroyed) return 'Untitled';
      let title = 'Untitled';
      view.state.doc.forEach((node) => {
        if (node.type.name === 'textBlock' && node.attrs.isTitle && node.textContent) {
          title = node.textContent;
        }
      });
      return title;
    },
    replaceDoc: (atoms: Atom[]) => {
      const s = getSchema();
      loadMoreRef.current = null;
      fullAtomsRef.current = null;
      loadedTopCountRef.current = -1;
      if (!atoms || atoms.length === 0) {
        createEditor(createEmptyDoc(s, variant));
        return;
      }
      const { doc, loadMore } = docFromContentChunked(s, atoms, variant);
      loadMoreRef.current = loadMore;
      fullAtomsRef.current = loadMore ? atoms : null;
      loadedTopCountRef.current = loadMore ? INITIAL_CHUNK_SIZE : -1;
      createEditor(doc);
    },
    insertAtoms: (atoms: Atom[], pos?: number) => {
      const view = viewRef.current;
      if (!view || view.isDestroyed || !atoms || atoms.length === 0) return;
      try {
        const s = getSchema();
        const docJson = converterRegistry.atomsToDoc(atoms);
        const tmpDoc = PMNode.fromJSON(s, docJson);
        const tr = view.state.tr;
        const insertPos = typeof pos === 'number' ? pos : view.state.doc.content.size;
        // 取出临时 doc 的 content 插入（跳过外层 doc 节点本身）
        tmpDoc.content.forEach(node => { tr.insert(insertPos, node); });
        view.dispatch(tr);
      } catch (err) {
        console.error('[NoteEditor] insertAtoms failed:', err);
      }
    },
    focus: () => { viewRef.current?.focus(); },
    scrollToTopBlockIndex: (index: number) => {
      const view = viewRef.current;
      const scrollContainer = editorRef.current?.parentElement;
      if (!view || view.isDestroyed || !scrollContainer) return;
      scrollToTopBlockIndex(view, scrollContainer, index);
    },
    getTopBlockIndexAtScroll: () => {
      const view = viewRef.current;
      const scrollContainer = editorRef.current?.parentElement;
      if (!view || view.isDestroyed || !scrollContainer) return 0;
      return getTopBlockIndexAtScroll(view, scrollContainer);
    },
    setTitleText: (text: string) => {
      const view = viewRef.current;
      if (!view || view.isDestroyed) return;
      const s = getSchema();
      let titlePos = -1;
      view.state.doc.forEach((node, offset) => {
        if (titlePos < 0 && node.type.name === 'textBlock' && node.attrs.isTitle) {
          titlePos = offset;
        }
      });
      if (titlePos < 0) return;
      const titleNode = view.state.doc.nodeAt(titlePos);
      if (!titleNode || titleNode.textContent === text) return;
      const tr = view.state.tr;
      tr.replaceWith(
        titlePos + 1,
        titlePos + titleNode.nodeSize - 1,
        text ? s.text(text) : s.text(''),
      );
      view.dispatch(tr);
    },
    flushPendingAnchor: () => {
      const view = viewRef.current;
      if (view && !view.isDestroyed) flushPendingAnchor(view);
    },
    getTopBlockCount: () => {
      const view = viewRef.current;
      if (!view || view.isDestroyed) return 0;
      return view.state.doc.childCount;
    },
    insertAiTurn: async (payload: unknown) => {
      const view = viewRef.current;
      if (!view || view.isDestroyed) return;
      const { insertTurnIntoNote } = await import('../ai-workflow/sync-note-receiver');
      await insertTurnIntoNote(view, payload as any);
    },
    insertHeadingAtEnd: (title: string, level = 2) => {
      const view = viewRef.current;
      if (!view || view.isDestroyed || !title) return;
      const { schema } = view.state;
      const headingType = schema.nodes.heading;
      if (!headingType) return;
      const headingNode = headingType.create({ level }, [schema.text(String(title))]);
      const tr = view.state.tr;
      tr.setMeta('ai-sync', true);
      tr.insert(view.state.doc.content.size, headingNode);
      view.dispatch(tr);
    },
    loadTestDocument: () => {
      const s = getSchema();
      loadMoreRef.current = null;
      fullAtomsRef.current = null;
      loadedTopCountRef.current = -1;
      createEditor(buildTestDocument(s));
    },
  }), [createEditor, variant]);

  // 初始化
  useEffect(() => {
    const s = getSchema();

    // 先创建空编辑器
    createEditor(createEmptyDoc(s, variant));

    // Step 1：编辑器首次就绪后 emit handle（一次性，走 ref 避免重 init）
    if (!handleEmittedRef.current && onReadyRef.current) {
      handleEmittedRef.current = true;
      onReadyRef.current(buildHandle());
    }

    // 注册 Converter 测试（DevTools console: __testConverters()）
    registerConverterTest(s);

    // Thought 变体：以下全是 Note 专属业务（笔记删除导航、Import JSON/Markdown、
    // 生词本同步），对 Thought 不适用 —— 直接跳过注册，只保留编辑器内核
    if (isThought) {
      return () => {
        if (tocRef.current) { tocRef.current.destroy(); tocRef.current = null; }
        clearSelectionCache();
        if (viewRef.current) {
          (viewRef.current as any).__cleanupMouseTracker?.();
          viewRef.current.destroy();
          viewRef.current = null;
        }
      };
    }

    // Step 3：笔记被删除时若是当前笔记，走历史返回或 destroy 编辑器。
    // onNoteDeleted 的业务状态清理（activeNoteId/pending save）由 NoteView 负责；
    // 这里只管编辑器 view 的物理清理（无历史可回的情况）。
    const unsubDeleted = viewAPI.onNoteDeleted((deletedId) => {
      if (currentNoteIdRef.current !== deletedId) return;
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

    // Import Markdown：为每个 .md 文件创建新笔记；最后通过 noteOpenInEditor
    // 打开，让 NoteEditor/NoteView 通过正常事件流同步（activeNoteIdRef 等状态）
    const saveDocToNote = async (noteId: string, doc: PMNode) => {
      let title = 'Untitled';
      doc.forEach((node) => {
        if (node.type.name === 'textBlock' && node.attrs.isTitle && node.textContent) {
          title = node.textContent;
        }
      });
      const atoms = converterRegistry.docToAtoms(doc);
      await viewAPI.noteSave(noteId, atoms, title);
    };
    const onImportMarkdown = async (e: Event) => {
      const files = (e as CustomEvent).detail as { markdown: string; title: string }[];
      if (!Array.isArray(files) || files.length === 0) return;
      try {
        let lastNoteId: string | null = null;
        for (const { markdown, title } of files) {
          const note = await viewAPI.noteCreate(title);
          if (!note) { console.error('[NoteEditor] Import Markdown: noteCreate failed'); continue; }

          const pmNodes = await viewAPI.markdownToPMNodes(markdown);
          if (!Array.isArray(pmNodes) || pmNodes.length === 0) {
            lastNoteId = note.id; // 空笔记也算最后一个
            continue;
          }

          const titleNode = s.nodes.textBlock.create(
            { isTitle: true },
            title ? s.text(title) : undefined,
          );
          const contentNodes = pmNodes
            .map(n => { try { return PMNode.fromJSON(s, n as any); } catch { return null; } })
            .filter((n): n is PMNode => !!n);
          const doc = s.node('doc', null, [titleNode, ...contentNodes]);

          // 把新 doc 直接序列化写盘到新笔记（不经过编辑器渲染）
          await saveDocToNote(note.id, doc);
          lastNoteId = note.id;
        }
        // 最后打开最后一个新建笔记，走正常事件流让 NoteView 同步 activeNoteIdRef
        if (lastNoteId) {
          viewAPI.noteOpenInEditor(lastNoteId);
        }
      } catch (err) {
        console.error('[NoteEditor] Import Markdown failed:', err);
      }
    };
    window.addEventListener('note:import-markdown', onImportMarkdown);

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


    return () => {
      unsubDeleted();
      unsubVocab();
      window.removeEventListener('note:import-json', onImportJson);
      window.removeEventListener('note:import-markdown', onImportMarkdown);
      // 关闭前 flush pending save 由 NoteView 负责
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
  }, [createEditor, buildHandle, variant]);

  return (
    <div
      className={isThought ? 'note-editor note-editor--thought' : 'note-editor'}
      style={isThought ? styles.thoughtContainer : styles.container}
    >
      <div ref={editorRef} style={isThought ? styles.thoughtEditor : styles.editor} />
      <SlashMenu view={editorView} />
      <FloatingToolbar view={editorView} />
      <HandleMenu view={editorView} />
      <ContextMenu view={editorView} />
      {/* AskAIPanel 依赖 Note 的问 AI 流程，Thought 不需要 */}
      {!isThought && <AskAIPanel view={editorView} />}
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
  // Thought 变体：尺寸由外层 ThoughtCard 控制，透明背景 + 内容自适应高度
  thoughtContainer: {
    width: '100%',
    background: 'transparent',
    position: 'relative' as const,
  },
  thoughtEditor: {
    position: 'relative' as const,
  },
};
