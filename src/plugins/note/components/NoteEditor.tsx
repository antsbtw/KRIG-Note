import { useRef, useEffect, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { blockRegistry } from '../registry';
import { buildTestDocument } from '../test-content';
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
import '../note.css';

/**
 * NoteEditor — ProseMirror 编辑器 React 组件
 *
 * 重建版：三基类架构，干净的插件组织。
 */

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

export function NoteEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    const s = getSchema();
    const nodeViews = blockRegistry.buildNodeViews();
    const blockPlugins = blockRegistry.buildBlockPlugins();

    // textBlock 的 NodeView 条件分发：isTitle → noteTitleNodeView，其他不用 NodeView
    nodeViews['textBlock'] = (node, view, getPos) => {
      if (node.attrs.isTitle) {
        return noteTitleNodeView(node, view, getPos);
      }
      // 非 noteTitle 不使用 NodeView，走 toDOM
      return undefined as any;
    };

    // ── 快捷键 ──
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

    // Shift+Enter → hardBreak
    if (s.nodes.hardBreak) {
      markKeymap['Shift-Enter'] = (state: any, dispatch: any) => {
        if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hardBreak.create()));
        return true;
      };
    }

    // ── 初始文档 ──
    const doc = buildTestDocument(s);

    const state = EditorState.create({
      doc,
      plugins: [
        blockSelectionPlugin(),     // 最高优先级 — ESC 选中 Block
        slashCommandPlugin(),
        containerKeyboardPlugin(),  // Container Enter/Backspace — 在 baseKeymap 之前
        buildInputRules(s),
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
        keymap(markKeymap),
        keymap(baseKeymap),
        tableKeymapPlugin(),
        blockHandlePlugin(),
        history(),
        dropCursor({ color: '#8ab4f8', width: 2 }),
        gapCursor(),
        ...blockPlugins,
      ],
    });

    const view = new EditorView(editorRef.current, {
      state,
      nodeViews: nodeViews as any,
    });

    viewRef.current = view;
    setEditorView(view);

    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorView(null);
    };
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
    position: 'relative' as const,  // block-handle 定位基准
  },
};
