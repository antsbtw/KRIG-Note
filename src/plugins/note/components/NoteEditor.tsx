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
import { tableKeymapPlugin } from '../blocks/table';
import { SlashMenu } from './SlashMenu';
import { FloatingToolbar } from './FloatingToolbar';
import { HandleMenu } from './HandleMenu';
import { ContextMenu } from './ContextMenu';
import { blockHandlePlugin } from '../plugins/block-handle';
import { blockSelectionPlugin } from '../plugins/block-selection';
import { indentPlugin } from '../plugins/indent';
import { pasteMediaPlugin } from '../plugins/paste-media';
import { renderBlockFocusPlugin } from '../plugins/render-block-focus';
import { vocabHighlightPlugin, updateVocabDefs, dispatchVocabUpdate } from '../learning/vocab-highlight-plugin';
import { updateVocabList } from '../learning';
import { buildTestDocument } from '../test-content';
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
  onNoteOpenInEditor: (callback: (noteId: string) => void) => () => void;
  setActiveNote: (noteId: string | null, noteTitle?: string) => Promise<void>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null }) => void) => () => void;
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => () => void;
  onLoadTestDoc: (callback: () => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  listVocabWords?: () => Promise<{ word: string; definition: string }[]>;
  onVocabChanged?: (callback: (entries: { word: string; definition: string }[]) => void) => () => void;
};

// 注册所有 Block（只执行一次）
let registered = false;
function ensureRegistered() {
  if (registered) return;
  registerAllBlocks();
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

  if (s.nodes.hardBreak) {
    markKeymap['Shift-Enter'] = (state: any, dispatch: any) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hardBreak.create()));
      return true;
    };
  }

  const blockPlugins = blockRegistry.buildBlockPlugins();

  return [
    blockSelectionPlugin(),
    indentPlugin(),              // Tab/Shift+Tab — 在 baseKeymap 之前拦截
    slashCommandPlugin(),
    containerKeyboardPlugin(),
    ...blockPlugins,             // Block 专有键盘处理（codeBlock 等）— 在 baseKeymap 之前
    buildInputRules(s),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap(markKeymap),
    keymap(baseKeymap),
    tableKeymapPlugin(),
    blockHandlePlugin(),
    pasteMediaPlugin(),
    renderBlockFocusPlugin(),
    vocabHighlightPlugin(),
    history(),
    dropCursor({ color: '#8ab4f8', width: 2 }),
    gapCursor(),
  ];
}

/** 从 doc_content JSON 构建 ProseMirror doc */
function docFromJSON(s: ReturnType<typeof getSchema>, docContent: unknown[]): PMNode {
  try {
    return PMNode.fromJSON(s, { type: 'doc', content: docContent });
  } catch (err) {
    console.error('[NoteEditor] Failed to parse doc_content:', err);
    // 回退到空文档
    return createEmptyDoc(s);
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

  // 创建/重建编辑器
  const createEditor = useCallback((doc: PMNode) => {
    if (!editorRef.current) return;

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
        const newState = view.state.apply(tr);
        view.updateState(newState);
        // 文档变化时触发自动保存
        if (tr.docChanged) scheduleSave();
      },
    });

    viewRef.current = view;
    setEditorView(view);
  }, []);

  // 加载文档
  const loadNote = useCallback(async (noteId: string) => {
    const s = getSchema();
    try {
      const record = await viewAPI.noteLoad(noteId);
      if (!record || !record.doc_content || record.doc_content.length === 0) {
        createEditor(createEmptyDoc(s));
      } else {
        createEditor(docFromJSON(s, record.doc_content));
      }
      currentNoteIdRef.current = noteId;
      viewAPI.setActiveNote(noteId, record?.title);
    } catch (err) {
      console.error('[NoteEditor] Failed to load note:', err);
      createEditor(createEmptyDoc(s));
      currentNoteIdRef.current = noteId;
    }
  }, [createEditor]);

  // 保存文档
  const saveNote = useCallback(() => {
    const noteId = currentNoteIdRef.current;
    const view = viewRef.current;
    if (!noteId || !view) return;

    const doc = view.state.doc;
    const docJSON = doc.toJSON();
    const docContent = docJSON.content || [];

    // 提取标题
    let title = 'Untitled';
    doc.forEach((node) => {
      if (node.type.name === 'textBlock' && node.attrs.isTitle && node.textContent) {
        title = node.textContent;
      }
    });

    viewAPI.noteSave(noteId, docContent, title);
  }, []);

  // 防抖自动保存（1秒）
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveNote, 1000);
  }, [saveNote]);

  // 初始化
  useEffect(() => {
    const s = getSchema();

    // 先创建空编辑器
    createEditor(createEmptyDoc(s));

    // 监听打开笔记事件
    const unsubOpen = viewAPI.onNoteOpenInEditor((noteId) => {
      loadNote(noteId);
    });

    // 恢复上次打开的笔记
    const unsubRestore = viewAPI.onRestoreWorkspaceState((state) => {
      if (state.activeNoteId) {
        loadNote(state.activeNoteId);
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

    return () => {
      unsubOpen();
      unsubRestore();
      unsubTestDoc();
      unsubTitle();
      unsubVocab();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveNote(); // 关闭前保存
      }
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [createEditor, loadNote, saveNote]);

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
