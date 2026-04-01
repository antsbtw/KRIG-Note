import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorState, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { blockRegistry } from '../registry';
import { slashCommandPlugin } from '../plugins/slash-command';
import { enterHandlerPlugin } from '../plugins/enter-handler';
import { blockHandlePlugin } from '../plugins/block-handle';
import { blockSelectionPlugin } from '../block-ops/block-selection';
import { SlashMenu } from './SlashMenu';
import { HandleMenu } from './HandleMenu';
import { FloatingToolbar } from './FloatingToolbar';
import { ContextMenu } from './ContextMenu';

/**
 * NoteEditor — ProseMirror 编辑器 React 组件
 *
 * 从 BlockRegistry 自动构建 Schema、NodeView、Plugin。
 */

export function NoteEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    const schema = blockRegistry.buildSchema();
    const nodeViews = blockRegistry.buildNodeViews();
    const blockPlugins = blockRegistry.buildBlockPlugins();

    // 初始文档：标题 + 空段落
    const doc = schema.node('doc', null, [
      schema.node('noteTitle'),
      schema.node('paragraph'),
    ]);

    // Mark 快捷键
    const markKeymap: Record<string, Command> = {};
    if (schema.marks.bold) markKeymap['Mod-b'] = toggleMark(schema.marks.bold);
    if (schema.marks.italic) markKeymap['Mod-i'] = toggleMark(schema.marks.italic);
    if (schema.marks.underline) markKeymap['Mod-u'] = toggleMark(schema.marks.underline);
    if (schema.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(schema.marks.strike);
    if (schema.marks.code) markKeymap['Mod-e'] = toggleMark(schema.marks.code);

    // 列表快捷键（Tab/Shift+Tab 缩进，Enter 分裂列表项）
    const listKeymap: Record<string, Command> = {};
    const listItemType = schema.nodes.listItem;
    if (listItemType) {
      listKeymap['Enter'] = splitListItem(listItemType);
      listKeymap['Tab'] = sinkListItem(listItemType);
      listKeymap['Shift-Tab'] = liftListItem(listItemType);
    }

    const state = EditorState.create({
      doc,
      plugins: [
        blockSelectionPlugin(),          // Block 选中（Decorations 方式，不操作 DOM）
        enterHandlerPlugin(),           // Enter 行为
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
        keymap(markKeymap),
        keymap(listKeymap),
        keymap(baseKeymap),
        history(),
        dropCursor(),
        gapCursor(),
        slashCommandPlugin(),
        blockHandlePlugin(),
        ...blockPlugins,
      ],
    });

    const view = new EditorView(editorRef.current, {
      state,
      nodeViews,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
      },
    });

    viewRef.current = view;
    setEditorView(view);

    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorView(null);
    };
  }, []);

  // 菜单互斥：右键菜单打开时隐藏 FloatingToolbar
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handleContextOpen = useCallback(() => setContextMenuOpen(true), []);
  const handleContextClose = useCallback(() => setContextMenuOpen(false), []);

  return (
    <div style={styles.container}>
      <div ref={editorRef} style={styles.editor} />
      <SlashMenu view={editorView} />
      <HandleMenu view={editorView} />
      {!contextMenuOpen && <FloatingToolbar view={editorView} />}
      <ContextMenu view={editorView} onOpen={handleContextOpen} onClose={handleContextClose} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflow: 'auto',
    background: '#1e1e1e',
    position: 'relative',
  },
  editor: {
    width: '100%',
    padding: '24px calc(max(32px, (100% - 800px) / 2))',
    minHeight: '100%',
    outline: 'none',
  },
};
