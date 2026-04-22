import { useRef, useEffect, useCallback, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { blockRegistry } from '../../note/registry';
import { registerAllBlocks } from '../../note/blocks/index';
import { buildInputRules } from '../../note/plugins/input-rules';
import { containerKeyboardPlugin } from '../../note/plugins/container-keyboard';
import { slashCommandPlugin } from '../../note/plugins/slash-command';
import { linkClickPlugin } from '../../note/plugins/link-click';
import { blockHandlePlugin } from '../../note/plugins/block-handle';
import { indentPlugin } from '../../note/plugins/indent';
import { pasteMediaPlugin } from '../../note/plugins/paste-media';
import { renderBlockFocusPlugin } from '../../note/plugins/render-block-focus';
import { columnResizing } from 'prosemirror-tables';
import { SlashMenu } from '../../note/components/SlashMenu';
import { FloatingToolbar } from '../../note/components/FloatingToolbar';
import { HandleMenu } from '../../note/components/HandleMenu';
import { ContextMenu } from '../../note/components/ContextMenu';
import { converterRegistry } from '../../note/converters/registry';
import type { Atom } from '../../../shared/types/atom-types';
import '../../note/note.css';

/**
 * ThoughtEditor — NoteEditor 的变种
 *
 * 复用 BlockRegistry 的 schema、converters、nodeViews，
 * 以及全套 overlay 组件（SlashMenu、FloatingToolbar、HandleMenu、ContextMenu）。
 *
 * 排除：thoughtPlugin（避免递归）、titleGuardPlugin、
 *       vocabHighlightPlugin、fromPageDecorationPlugin、
 *       headingCollapsePlugin、blockSelectionPlugin。
 */

// 确保 blocks 注册一次
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

function buildThoughtPlugins(s: ReturnType<typeof getSchema>) {
  const markKeymap: Record<string, any> = {};
  if (s.marks.bold) markKeymap['Mod-b'] = toggleMark(s.marks.bold);
  if (s.marks.italic) markKeymap['Mod-i'] = toggleMark(s.marks.italic);
  if (s.marks.underline) markKeymap['Mod-u'] = toggleMark(s.marks.underline);
  if (s.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(s.marks.strike);
  if (s.marks.code) markKeymap['Mod-e'] = toggleMark(s.marks.code);

  if (s.nodes.hardBreak) {
    markKeymap['Shift-Enter'] = (state: any, dispatch: any) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hardBreak.create()));
      return true;
    };
  }

  const blockPlugins = blockRegistry.buildBlockPlugins();

  return [
    // columnResizing 必须在编辑器装配处手动注册，不能下沉到 tableBlock.plugin：
    // 它有全局 PluginKey（tableColumnResizing$），整个编辑器只能存在一个实例。
    // 见 docs/block/table.md §十二。
    columnResizing({ cellMinWidth: 80, View: null as any }),
    indentPlugin(),
    slashCommandPlugin(),
    linkClickPlugin(),
    containerKeyboardPlugin(),
    ...blockPlugins,
    buildInputRules(s),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap(markKeymap),
    keymap(baseKeymap),
    blockHandlePlugin(),
    pasteMediaPlugin(),
    renderBlockFocusPlugin(),
    history(),
    dropCursor({ color: '#8ab4f8', width: 2 }),
    gapCursor(),
  ];
}

interface ThoughtEditorProps {
  initialContent: Atom[];
  onContentChange: (atoms: Atom[]) => void;
}

export function ThoughtEditor({ initialContent, onContentChange }: ThoughtEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  const handleChange = useCallback(
    (view: EditorView) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const atoms = converterRegistry.docToAtoms(view.state.doc);
        onContentChange(atoms);
      }, 2000);
    },
    [onContentChange],
  );

  useEffect(() => {
    if (!editorRef.current) return;

    const s = getSchema();
    const nodeViews = blockRegistry.buildNodeViews();

    // 从 Atom[] 构建 ProseMirror 文档
    // Thought 不需要 noteTitle，但 converterRegistry.atomsToDoc 会自动插入。
    // 转换后过滤掉 isTitle 节点。
    let doc;
    if (initialContent && initialContent.length > 0) {
      try {
        const pmJson = converterRegistry.atomsToDoc(initialContent);
        // 移除 noteTitle 节点
        if (pmJson.content) {
          pmJson.content = pmJson.content.filter(
            (n: any) => !(n.type === 'textBlock' && n.attrs?.isTitle),
          );
          if (pmJson.content.length === 0) {
            pmJson.content = [{ type: 'textBlock', attrs: { isTitle: false } }];
          }
        }
        doc = s.nodeFromJSON(pmJson);
      } catch {
        doc = s.node('doc', null, [s.node('textBlock', { isTitle: false }, [])]);
      }
    } else {
      doc = s.node('doc', null, [s.node('textBlock', { isTitle: false }, [])]);
    }

    const state = EditorState.create({ doc, plugins: buildThoughtPlugins(s) });
    const view = new EditorView(editorRef.current, {
      state,
      nodeViews: nodeViews as any,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        if (tr.docChanged) handleChange(view);
      },
    });

    viewRef.current = view;
    setEditorView(view);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
      setEditorView(null);
    };
  }, []); // 只创建一次

  return (
    <div className="thought-editor">
      <div ref={editorRef} />
      <SlashMenu view={editorView} />
      <FloatingToolbar view={editorView} />
      <HandleMenu view={editorView} />
      <ContextMenu view={editorView} />
    </div>
  );
}
